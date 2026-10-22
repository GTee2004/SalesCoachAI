import { randomUUID } from 'node:crypto'
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '#/db'
import {
  billingOrders,
  billingPayments,
  billingWebhookEvents,
  creditGrants,
  creditLedger,
  member,
  organization,
  workspaceProfiles,
  workspaceSeatAssignments,
  workspaceSubscriptions,
  subscriptionPeriods,
  user,
} from '#/db/schema'
import {
  BUSINESS_MAX_SEATS,
  BUSINESS_MIN_SEATS,
  SEPAY_MAX_AMOUNT_VND,
  getSubscriptionProduct,
  getTopupProduct,
} from '#/lib/billing/catalog'
import {
  parseSeatAdditionProductCode,
  quoteSeatAddition,
} from '#/lib/billing/proration'
import { normalizeCouponCode } from '#/lib/billing/coupons'
import { recordRedemption, reserveCoupon } from './coupons'
import { getSeatAvailability } from './seats'
import { env } from '#/env'
import { assignSeatInTransaction, refreshPendingSubscription } from './credits'
import { getAllowancePeriod, monthAfter } from './periods'
import { findSepayOrderByInvoice } from './sepay-api'
import type { SepayOrder } from './sepay-client'
import {
  makeSepayCheckoutFields,
  normalizeSepayNotificationType,
  sepayCheckoutUrl,
} from './sepay'

// SePay rejects larger payments (and a coupon trims totals below its minimum),
// so refuse before an order exists rather than hand the customer a dead end.
function assertPayable(amountVnd: number) {
  if (amountVnd > SEPAY_MAX_AMOUNT_VND)
    throw new Response(
      `Giá trị đơn vượt mức thanh toán tối đa ${SEPAY_MAX_AMOUNT_VND.toLocaleString('vi-VN')} ₫. Hãy giảm số suất hoặc liên hệ hỗ trợ.`,
      { status: 400 },
    )
}

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type StartCheckoutInput = {
  userId: string
  workspaceId: string
  idempotencyKey: string
  productCode: string
  seatQuantity: number
  creditRecipientUserId?: string
  expectedSubscriptionPeriodEnd?: string | null
  couponCode?: string
  publicBaseUrl: string
}

export async function createCheckout(input: StartCheckoutInput) {
  if (!env.SEPAY_MERCHANT_ID || !env.SEPAY_SECRET_KEY || !env.SEPAY_IPN_SECRET)
    throw new Response('Thanh toán đang được cấu hình. Vui lòng thử lại sau.', {
      status: 503,
    })

  const workspace = (
    await db
      .select({
        id: organization.id,
        name: organization.name,
        kind: workspaceProfiles.kind,
        personalOwnerUserId: workspaceProfiles.personalOwnerUserId,
        role: member.role,
      })
      .from(organization)
      .innerJoin(
        workspaceProfiles,
        eq(workspaceProfiles.workspaceId, organization.id),
      )
      .innerJoin(member, eq(member.organizationId, organization.id))
      .where(
        and(
          eq(organization.id, input.workspaceId),
          eq(member.userId, input.userId),
        ),
      )
  ).at(0)

  if (!workspace)
    throw new Response('Không gian làm việc không tồn tại.', { status: 404 })
  if (workspace.role !== 'owner')
    throw new Response('Chỉ chủ sở hữu mới có thể thanh toán.', {
      status: 403,
    })
  await refreshPendingSubscription(workspace.id)

  const seatAdditionInterval = parseSeatAdditionProductCode(input.productCode)
  if (seatAdditionInterval) {
    if (workspace.kind !== 'company')
      throw new Response(
        'Chỉ không gian làm việc công ty mới có thể mua thêm suất.',
        {
          status: 409,
        },
      )
    if (input.couponCode)
      throw new Response('Mã giảm giá chưa áp dụng được khi mua thêm suất.', {
        status: 409,
      })
    return createSeatAdditionCheckout(input, workspace.id, seatAdditionInterval)
  }

  const topup = getTopupProduct(input.productCode)
  const isSubscription =
    input.productCode.startsWith('pro_') ||
    input.productCode.startsWith('business_')
  if (!topup && !isSubscription)
    throw new Response('Gói thanh toán không hợp lệ.', { status: 400 })

  const product = topup
    ? topup
    : (() => {
        const [plan, interval] = input.productCode.split('_')
        if (
          (plan !== 'pro' && plan !== 'business') ||
          (interval !== 'monthly' && interval !== 'yearly')
        )
          return null
        return getSubscriptionProduct(plan, interval, input.seatQuantity)
      })()
  if (!product)
    throw new Response('Gói thanh toán không hợp lệ.', { status: 400 })

  if (product.type === 'subscription') {
    const matchesWorkspaceKind =
      (product.plan === 'pro' &&
        workspace.kind === 'personal' &&
        workspace.personalOwnerUserId === input.userId) ||
      (product.plan === 'business' && workspace.kind === 'company')
    if (!matchesWorkspaceKind)
      throw new Response(
        'Pro chỉ dùng trong tài khoản cá nhân; Business cần không gian làm việc công ty.',
        { status: 409 },
      )
    if (
      product.plan === 'business' &&
      (input.seatQuantity < BUSINESS_MIN_SEATS ||
        input.seatQuantity > BUSINESS_MAX_SEATS)
    )
      throw new Response('Business cần từ 2 đến 500 suất trả phí.', {
        status: 400,
      })

    const verification = await reconcilePendingBillingOrders(workspace.id, {
      subscriptionsOnly: true,
      fresh: true,
    })
    if (verification.warning)
      throw new Response(verification.warning, { status: 503 })
    if (verification.recoveredInvoices.length)
      throw new Response(
        'SePay đã xác nhận thanh toán đơn trước. Thông tin gói đã được cập nhật; vui lòng kiểm tra trước khi mua tiếp.',
        { status: 409 },
      )

    const current = await db.query.workspaceSubscriptions.findFirst({
      where: eq(workspaceSubscriptions.workspaceId, workspace.id),
    })
    if (current?.pendingPlan)
      throw new Response(
        'Đã có thay đổi gói được lên lịch cho chu kỳ tiếp theo.',
        { status: 409 },
      )

    if (product.plan === 'business') {
      const activeSeats = await db
        .select({ seatNumber: workspaceSeatAssignments.seatNumber })
        .from(workspaceSeatAssignments)
        .where(
          and(
            eq(workspaceSeatAssignments.workspaceId, workspace.id),
            isNull(workspaceSeatAssignments.revokedAt),
          ),
        )
      if (
        activeSeats.length > product.seatQuantity ||
        activeSeats.some(
          (assignment) => assignment.seatNumber > product.seatQuantity,
        )
      )
        throw new Response(
          'Hãy gán lại thành viên khỏi các suất vượt quá số suất mới.',
          {
            status: 409,
          },
        )
      // Invitations hold a seat each until they are accepted or cancelled.
      const seats = await getSeatAvailability(workspace.id)
      if (activeSeats.length + seats.pendingInvitations > product.seatQuantity)
        throw new Response(
          'Hãy hủy bớt lời mời đang chờ hoặc xóa thành viên trước khi giảm số suất.',
          { status: 409 },
        )
    }
  } else if (workspace.kind === 'company') {
    const subscription = await db.query.workspaceSubscriptions.findFirst({
      where: and(
        eq(workspaceSubscriptions.workspaceId, workspace.id),
        eq(workspaceSubscriptions.plan, 'business'),
        eq(workspaceSubscriptions.status, 'active'),
        gt(workspaceSubscriptions.currentPeriodEnd, new Date()),
      ),
    })
    if (!subscription)
      throw new Response('Kích hoạt gói Business trước khi mua thêm phút.', {
        status: 409,
      })
    if (!input.creditRecipientUserId)
      throw new Response(
        'Chọn thành viên có suất trả phí để nhận phút mua thêm.',
        {
          status: 400,
        },
      )
    const recipientSeat = await db.query.workspaceSeatAssignments.findFirst({
      where: and(
        eq(workspaceSeatAssignments.workspaceId, workspace.id),
        eq(workspaceSeatAssignments.userId, input.creditRecipientUserId),
        isNull(workspaceSeatAssignments.revokedAt),
      ),
    })
    if (!recipientSeat)
      throw new Response('Người nhận cần có suất trả phí đang hoạt động.', {
        status: 409,
      })
  }

  const couponCode = input.couponCode
    ? normalizeCouponCode(input.couponCode)
    : null
  const invoiceNumber = `SC${Date.now().toString(36).toUpperCase()}${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  const order = await db.transaction(async (tx) => {
    await tx
      .select({ workspaceId: workspaceProfiles.workspaceId })
      .from(workspaceProfiles)
      .where(eq(workspaceProfiles.workspaceId, workspace.id))
      .for('update')
    const existing = await tx.query.billingOrders.findFirst({
      where: and(
        eq(billingOrders.workspaceId, workspace.id),
        eq(billingOrders.purchasedByUserId, input.userId),
        eq(billingOrders.idempotencyKey, input.idempotencyKey),
      ),
    })
    const now = new Date()
    if (existing?.status === 'pending' && existing.expiresAt > now)
      return existing
    // A repeated request for an order that a coupon already made free.
    if (existing?.status === 'paid' && existing.amountVnd === 0) return existing
    if (existing?.status === 'paid')
      throw new Response('Đơn hàng này đã được thanh toán.', { status: 409 })
    if (existing)
      throw new Response('Đơn thanh toán trước đã hết hạn. Hãy thử lại.', {
        status: 409,
      })

    if (product.type === 'subscription') {
      // Re-check under the workspace lock: an IPN can arrive between the
      // checkout preflight and this transaction. A stale page must refresh
      // rather than accidentally paying for another renewal.
      const latestSubscription =
        await tx.query.workspaceSubscriptions.findFirst({
          where: eq(workspaceSubscriptions.workspaceId, workspace.id),
        })
      const latestPeriodEnd =
        latestSubscription?.status === 'active' &&
        latestSubscription.currentPeriodEnd > now
          ? latestSubscription.currentPeriodEnd.toISOString()
          : null
      if (
        input.expectedSubscriptionPeriodEnd !== undefined &&
        input.expectedSubscriptionPeriodEnd !== latestPeriodEnd
      )
        throw new Response(
          'Gói của không gian làm việc vừa được cập nhật. Vui lòng kiểm tra lại gói và hạn mức trước khi thanh toán tiếp.',
          { status: 409 },
        )
      const openOrder = await tx.query.billingOrders.findFirst({
        where: and(
          eq(billingOrders.workspaceId, workspace.id),
          inArray(billingOrders.type, ['subscription', 'seat_addition']),
          eq(billingOrders.status, 'pending'),
        ),
      })
      if (openOrder) {
        if (openOrder.expiresAt <= now)
          throw new Response(
            'Phiên thanh toán trước đã hết hạn nhưng chưa xác nhận hủy tại SePay. Nếu đã trả tiền, hãy kiểm tra lại thanh toán; nếu chưa, hãy hủy đơn trước tại SePay hoặc liên hệ hỗ trợ.',
            { status: 409 },
          )
        if (
          openOrder.purchasedByUserId === input.userId &&
          openOrder.productCode === product.productCode &&
          openOrder.seatQuantity === product.seatQuantity &&
          openOrder.amountVnd + openOrder.discountVnd === product.priceVnd &&
          (openOrder.couponCode ?? null) === couponCode
        )
          return openOrder
        throw new Response(
          'Không gian làm việc đang có đơn đăng ký/gia hạn chờ thanh toán. Hãy kiểm tra hoặc hoàn tất đơn trước khi chọn gói khác.',
          { status: 409 },
        )
      }
    }

    // The coupon is checked and counted under its own row lock, so concurrent
    // checkouts cannot exceed its limits. Its discount is capped at the order
    // total: nothing is carried over as credit.
    const discount = couponCode
      ? await reserveCoupon(tx, {
          code: couponCode,
          workspaceId: workspace.id,
          orderType: product.type,
          subtotalVnd: product.priceVnd,
          now,
        })
      : null
    const totalVnd = discount?.totalVnd ?? product.priceVnd
    assertPayable(totalVnd)
    // A zero total is settled here and never goes to SePay, which cannot take
    // a zero-amount payment. The grant is made in the same transaction, so an
    // order is never "paid" without its entitlement.
    const free = totalVnd === 0
    if (free && product.type === 'subscription') {
      const latest = await tx.query.workspaceSubscriptions.findFirst({
        where: eq(workspaceSubscriptions.workspaceId, workspace.id),
      })
      if (latest?.pendingPlan)
        throw new Response(
          'Đã có thay đổi gói được lên lịch cho chu kỳ tiếp theo.',
          { status: 409 },
        )
    }

    const created = (
      await tx
        .insert(billingOrders)
        .values({
          workspaceId: workspace.id,
          purchasedByUserId: input.userId,
          orderInvoiceNumber: invoiceNumber,
          idempotencyKey: input.idempotencyKey,
          type: product.type,
          productCode: product.productCode,
          creditRecipientUserId:
            product.type === 'topup'
              ? workspace.kind === 'personal'
                ? workspace.personalOwnerUserId
                : input.creditRecipientUserId
              : null,
          plan: product.type === 'subscription' ? product.plan : null,
          interval: product.type === 'subscription' ? product.interval : null,
          seatQuantity:
            product.type === 'subscription' ? product.seatQuantity : 1,
          creditMinutes: product.type === 'topup' ? product.minutes : 0,
          amountVnd: totalVnd,
          discountVnd: discount?.discountVnd ?? 0,
          couponCode: discount?.coupon.code ?? null,
          status: free ? 'paid' : 'pending',
          paidAt: free ? now : null,
          providerPayload: free
            ? { source: 'coupon', couponCode: discount?.coupon.code }
            : undefined,
          expiresAt: new Date(now.getTime() + 30 * 60_000),
        })
        .returning()
    ).at(0)
    if (!created) return undefined
    if (discount)
      await recordRedemption(tx, {
        couponId: discount.coupon.id,
        orderId: created.id,
        workspaceId: workspace.id,
        userId: input.userId,
        discountVnd: discount.discountVnd,
      })
    if (free) {
      if (created.type === 'topup') await grantTopup(tx, created)
      else await fulfillSubscription(tx, created)
    }
    return created
  })
  if (!order) throw new Response('Chưa thể tạo đơn hàng.', { status: 500 })

  if (order.amountVnd === 0)
    return { free: true as const, invoice: order.orderInvoiceNumber }
  return checkoutForm(order, input)
}

function checkoutForm(
  order: typeof billingOrders.$inferSelect,
  input: Pick<StartCheckoutInput, 'userId' | 'publicBaseUrl'>,
) {
  return {
    action: sepayCheckoutUrl,
    fields: makeSepayCheckoutFields({
      amountVnd: order.amountVnd,
      invoiceNumber: order.orderInvoiceNumber,
      description: order.productCode,
      customerId: input.userId,
      returnUrl: `${input.publicBaseUrl}/billing?order=${encodeURIComponent(order.orderInvoiceNumber)}`,
    }),
  }
}

// Extra seats take effect as soon as they are paid and are charged only for
// the rest of the term that is already paid, so the period end never moves.
async function createSeatAdditionCheckout(
  input: StartCheckoutInput,
  workspaceId: string,
  interval: 'monthly' | 'yearly',
) {
  const seatsToAdd = input.seatQuantity
  const verification = await reconcilePendingBillingOrders(workspaceId, {
    subscriptionsOnly: true,
    fresh: true,
  })
  if (verification.warning)
    throw new Response(verification.warning, { status: 503 })
  if (verification.recoveredInvoices.length)
    throw new Response(
      'SePay đã xác nhận thanh toán đơn trước. Thông tin gói đã được cập nhật; vui lòng kiểm tra trước khi mua tiếp.',
      { status: 409 },
    )

  const invoiceNumber = `SC${Date.now().toString(36).toUpperCase()}${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  const order = await db.transaction(async (tx) => {
    await tx
      .select({ workspaceId: workspaceProfiles.workspaceId })
      .from(workspaceProfiles)
      .where(eq(workspaceProfiles.workspaceId, workspaceId))
      .for('update')
    const existing = await tx.query.billingOrders.findFirst({
      where: and(
        eq(billingOrders.workspaceId, workspaceId),
        eq(billingOrders.purchasedByUserId, input.userId),
        eq(billingOrders.idempotencyKey, input.idempotencyKey),
      ),
    })
    const now = new Date()
    if (existing?.status === 'pending' && existing.expiresAt > now)
      return existing
    if (existing?.status === 'paid')
      throw new Response('Đơn hàng này đã được thanh toán.', { status: 409 })
    if (existing)
      throw new Response('Đơn thanh toán trước đã hết hạn. Hãy thử lại.', {
        status: 409,
      })

    const subscription = (
      await tx
        .select()
        .from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
        .for('update')
    ).at(0)
    if (
      !subscription ||
      subscription.plan !== 'business' ||
      subscription.status !== 'active' ||
      subscription.currentPeriodEnd <= now
    )
      throw new Response(
        'Gói Business chưa hoạt động. Hãy gia hạn gói trước khi mua thêm suất.',
        { status: 409 },
      )
    if (
      input.expectedSubscriptionPeriodEnd !== undefined &&
      input.expectedSubscriptionPeriodEnd !==
        subscription.currentPeriodEnd.toISOString()
    )
      throw new Response(
        'Gói của không gian làm việc vừa được cập nhật. Vui lòng kiểm tra lại gói và hạn mức trước khi thanh toán tiếp.',
        { status: 409 },
      )
    if (subscription.interval !== interval)
      throw new Response(
        'Chu kỳ thanh toán của không gian làm việc đã thay đổi. Vui lòng tải lại trang.',
        { status: 409 },
      )
    if (subscription.pendingPlan)
      throw new Response(
        'Đã có thay đổi gói được lên lịch cho chu kỳ tiếp theo. Hãy thêm suất sau khi chu kỳ mới bắt đầu.',
        { status: 409 },
      )
    if (subscription.seatQuantity + seatsToAdd > BUSINESS_MAX_SEATS)
      throw new Response(`Business tối đa ${BUSINESS_MAX_SEATS} suất.`, {
        status: 400,
      })

    // An early renewal paid after extra seats would otherwise be compared with
    // the smaller seat count and wrongly schedule a reduction.
    const openOrder = await tx.query.billingOrders.findFirst({
      where: and(
        eq(billingOrders.workspaceId, workspaceId),
        inArray(billingOrders.type, ['subscription', 'seat_addition']),
        eq(billingOrders.status, 'pending'),
      ),
    })
    if (openOrder) {
      if (openOrder.expiresAt <= now)
        throw new Response(
          'Phiên thanh toán trước đã hết hạn nhưng chưa xác nhận hủy tại SePay. Nếu đã trả tiền, hãy kiểm tra lại thanh toán; nếu chưa, hãy hủy đơn trước tại SePay hoặc liên hệ hỗ trợ.',
          { status: 409 },
        )
      // The price of an open order is fixed when it is created, so resuming
      // it ignores the amount a fresh quote would give now.
      if (
        openOrder.type === 'seat_addition' &&
        openOrder.purchasedByUserId === input.userId &&
        openOrder.productCode === input.productCode &&
        openOrder.seatQuantity === seatsToAdd
      )
        return openOrder
      throw new Response(
        'Không gian làm việc đang có đơn đăng ký/gia hạn chờ thanh toán. Hãy kiểm tra hoặc hoàn tất đơn trước khi mua thêm suất.',
        { status: 409 },
      )
    }

    const quote = quoteSeatAddition({
      interval,
      currentPeriodEnd: subscription.currentPeriodEnd,
      seatsToAdd,
      now,
    })
    assertPayable(quote.amountVnd)
    return (
      await tx
        .insert(billingOrders)
        .values({
          workspaceId,
          purchasedByUserId: input.userId,
          orderInvoiceNumber: invoiceNumber,
          idempotencyKey: input.idempotencyKey,
          type: 'seat_addition',
          productCode: input.productCode,
          plan: 'business',
          interval,
          seatQuantity: seatsToAdd,
          amountVnd: quote.amountVnd,
          expiresAt: new Date(now.getTime() + 30 * 60_000),
        })
        .returning()
    ).at(0)
  })
  if (!order) throw new Response('Chưa thể tạo đơn hàng.', { status: 500 })
  return checkoutForm(order, input)
}

async function grantTopup(
  tx: DatabaseTransaction,
  order: typeof billingOrders.$inferSelect,
) {
  if (!order.creditRecipientUserId)
    throw new Error('Top-up order is missing its credit recipient')
  const newGrant = await tx
    .insert(creditGrants)
    .values({
      workspaceId: order.workspaceId,
      userId: order.creditRecipientUserId,
      type: 'topup',
      grantKey: `order:${order.id}`,
      orderId: order.id,
      totalSeconds: order.creditMinutes * 60,
      remainingSeconds: order.creditMinutes * 60,
    })
    .onConflictDoNothing()
    .returning({ id: creditGrants.id })
  if (newGrant.length) {
    await tx.insert(creditLedger).values({
      grantId: newGrant[0].id,
      idempotencyKey: `grant:${order.id}`,
      deltaSeconds: order.creditMinutes * 60,
      reason: 'topup_purchase',
    })
  }
}

async function fulfillSeatAddition(
  tx: DatabaseTransaction,
  order: typeof billingOrders.$inferSelect,
) {
  // Included minutes are granted lazily per seat and allowance month, so the
  // new seats receive a full month's allowance on first use.
  await tx
    .update(workspaceSubscriptions)
    .set({
      seatQuantity: sql`${workspaceSubscriptions.seatQuantity} + ${order.seatQuantity}`,
      updatedAt: new Date(),
    })
    .where(eq(workspaceSubscriptions.workspaceId, order.workspaceId))
}

// The subscription can change between creating an order and its payment
// arriving. Extra seats are only applied to the state they were priced for;
// anything else is parked for manual review rather than guessed at.
async function seatAdditionStillApplies(
  tx: DatabaseTransaction,
  order: typeof billingOrders.$inferSelect,
) {
  await tx
    .select({ workspaceId: workspaceProfiles.workspaceId })
    .from(workspaceProfiles)
    .where(eq(workspaceProfiles.workspaceId, order.workspaceId))
    .for('update')
  const current = (
    await tx
      .select()
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, order.workspaceId))
      .for('update')
  ).at(0)
  return Boolean(
    current &&
    current.plan === 'business' &&
    current.status === 'active' &&
    current.currentPeriodEnd > new Date() &&
    !current.pendingPlan &&
    current.interval === order.interval &&
    current.seatQuantity + order.seatQuantity <= BUSINESS_MAX_SEATS,
  )
}

async function fulfillSubscription(
  tx: DatabaseTransaction,
  order: typeof billingOrders.$inferSelect,
) {
  if (order.plan !== 'pro' && order.plan !== 'business')
    throw new Error('Subscription order is missing its plan')
  if (!order.interval)
    throw new Error('Subscription order is missing its interval')

  const now = new Date()
  const current = (
    await tx
      .select()
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, order.workspaceId))
      .for('update')
  ).at(0)
  const isCurrent = Boolean(
    current && current.status === 'active' && current.currentPeriodEnd > now,
  )
  const sameCurrentProduct = Boolean(
    isCurrent &&
    current &&
    current.plan === order.plan &&
    current.interval === order.interval &&
    current.seatQuantity === order.seatQuantity,
  )
  const startsAfterCurrent = Boolean(
    isCurrent && current && !sameCurrentProduct,
  )
  const start = isCurrent && current ? current.currentPeriodEnd : now
  const end = monthAfter(start, order.interval === 'yearly' ? 12 : 1)

  if (!isCurrent && order.plan === 'pro') {
    const profile = await tx.query.workspaceProfiles.findFirst({
      where: eq(workspaceProfiles.workspaceId, order.workspaceId),
    })
    if (profile?.kind === 'personal' && profile.personalOwnerUserId) {
      const priorIncluded = await tx
        .select()
        .from(creditGrants)
        .where(
          and(
            eq(creditGrants.workspaceId, order.workspaceId),
            eq(creditGrants.userId, profile.personalOwnerUserId),
            eq(creditGrants.type, 'included'),
            gt(creditGrants.expiresAt, now),
          ),
        )
        .for('update')
      const alreadyUsedSeconds = priorIncluded.reduce(
        (sum, grant) => sum + grant.totalSeconds - grant.remainingSeconds,
        0,
      )
      for (const grant of priorIncluded)
        await tx
          .update(creditGrants)
          .set({ expiresAt: now })
          .where(eq(creditGrants.id, grant.id))
      const period = getAllowancePeriod(start, start)
      const allowanceSeconds = Math.max(0, 150 * 60 - alreadyUsedSeconds)
      if (allowanceSeconds > 0) {
        const grant = await tx
          .insert(creditGrants)
          .values({
            workspaceId: order.workspaceId,
            userId: profile.personalOwnerUserId,
            type: 'included',
            grantKey: `included:${order.workspaceId}:${profile.personalOwnerUserId}:${period.startsAt.toISOString()}`,
            totalSeconds: allowanceSeconds,
            remainingSeconds: allowanceSeconds,
            periodStart: period.startsAt,
            expiresAt: period.endsAt,
          })
          .onConflictDoNothing()
          .returning({ id: creditGrants.id })
        if (grant.length) {
          await tx.insert(creditLedger).values({
            grantId: grant[0].id,
            idempotencyKey: `grant:upgrade:${order.id}`,
            deltaSeconds: allowanceSeconds,
            reason: 'upgrade_included',
          })
        }
      }
    }
  }

  await tx
    .insert(workspaceSubscriptions)
    .values({
      workspaceId: order.workspaceId,
      plan: order.plan,
      interval: order.interval,
      status: 'active',
      seatQuantity: order.seatQuantity,
      currentPeriodStart:
        startsAfterCurrent && current
          ? current.currentPeriodStart
          : sameCurrentProduct && current
            ? current.currentPeriodStart
            : start,
      currentPeriodEnd:
        startsAfterCurrent && current ? current.currentPeriodEnd : end,
      cancelAtPeriodEnd: false,
      pendingPlan: startsAfterCurrent ? order.plan : null,
      pendingInterval: startsAfterCurrent ? order.interval : null,
      pendingSeatQuantity: startsAfterCurrent ? order.seatQuantity : null,
    })
    .onConflictDoUpdate({
      target: workspaceSubscriptions.workspaceId,
      set: {
        plan: startsAfterCurrent && current ? current.plan : order.plan,
        interval:
          startsAfterCurrent && current ? current.interval : order.interval,
        status: 'active',
        seatQuantity:
          startsAfterCurrent && current
            ? current.seatQuantity
            : order.seatQuantity,
        currentPeriodStart:
          startsAfterCurrent && current
            ? current.currentPeriodStart
            : sameCurrentProduct && current
              ? current.currentPeriodStart
              : start,
        currentPeriodEnd:
          startsAfterCurrent && current ? current.currentPeriodEnd : end,
        cancelAtPeriodEnd: false,
        pendingPlan: startsAfterCurrent ? order.plan : null,
        pendingInterval: startsAfterCurrent ? order.interval : null,
        pendingSeatQuantity: startsAfterCurrent ? order.seatQuantity : null,
        updatedAt: now,
      },
    })

  await tx
    .insert(subscriptionPeriods)
    .values({
      workspaceId: order.workspaceId,
      orderId: order.id,
      plan: order.plan,
      interval: order.interval,
      seatQuantity: order.seatQuantity,
      startsAt: start,
      endsAt: end,
    })
    .onConflictDoNothing()

  if (order.plan === 'business') {
    // The purchaser takes a seat when the plan starts; a renewal leaves an
    // existing seat untouched. The savepoint keeps a purchaser who left, or a
    // workspace with no free seat, from failing a payment that already landed.
    try {
      await tx.transaction((savepoint) =>
        assignSeatInTransaction(savepoint, {
          workspaceId: order.workspaceId,
          userId: order.purchasedByUserId,
          assignedBy: null,
          reason: 'subscription_activated',
        }),
      )
    } catch (error) {
      if (!(error instanceof Response)) throw error
    }
    await tx
      .update(workspaceProfiles)
      .set({ status: 'ready' })
      .where(eq(workspaceProfiles.workspaceId, order.workspaceId))
  }
}

async function parkPaidOrderForReview(
  tx: DatabaseTransaction,
  input: {
    order: typeof billingOrders.$inferSelect
    eventId: string
    raw: Record<string, unknown>
    orderPayload: Record<string, unknown>
    transactionId: unknown
    transactionAmount: number
    environment: string
    reason: string
  },
) {
  const sepayOrderId = String(
    input.orderPayload.order_id ?? input.orderPayload.id ?? '',
  )
  await tx.insert(billingPayments).values({
    orderId: input.order.id,
    providerTransactionId: String(input.transactionId),
    providerOrderId: sepayOrderId,
    environment: input.environment,
    amountVnd: input.transactionAmount,
    status: 'APPROVED_REVIEW',
    providerPayload: input.raw,
  })
  await tx
    .update(billingOrders)
    .set({
      status: 'review',
      paidAt: new Date(),
      sepayOrderId,
      providerPayload: input.raw,
    })
    .where(eq(billingOrders.id, input.order.id))
  await tx
    .update(billingWebhookEvents)
    .set({ processingError: input.reason, processedAt: new Date() })
    .where(eq(billingWebhookEvents.id, input.eventId))
}

export async function processSepayIpn(
  raw: Record<string, unknown>,
  environment: string,
) {
  const notification = normalizeSepayNotificationType(raw.notification_type)
  const orderPayload = raw.order as Record<string, unknown> | undefined
  const transaction = raw.transaction as Record<string, unknown> | undefined
  if (!orderPayload || !transaction || !notification)
    throw new Response('Invalid SePay notification.', { status: 400 })

  const invoice = orderPayload.order_invoice_number
  const transactionId = transaction.transaction_id
  if (!invoice || !transactionId)
    throw new Response('Missing order reference.', { status: 400 })
  const eventKey = `${String(transactionId)}:${notification}`

  await db.transaction(async (tx) => {
    const insertedEvent = await tx
      .insert(billingWebhookEvents)
      .values({ eventKey, eventType: notification, payload: raw })
      .onConflictDoNothing()
      .returning({ id: billingWebhookEvents.id })
    if (!insertedEvent.length) return

    const order = await tx.query.billingOrders.findFirst({
      where: eq(billingOrders.orderInvoiceNumber, String(invoice)),
    })
    if (!order) {
      await tx
        .update(billingWebhookEvents)
        .set({ processingError: 'unknown_invoice', processedAt: new Date() })
        .where(eq(billingWebhookEvents.id, insertedEvent[0].id))
      return
    }

    const lockedOrder = (
      await tx
        .select()
        .from(billingOrders)
        .where(eq(billingOrders.id, order.id))
        .for('update')
    ).at(0)
    if (!lockedOrder) throw new Error('Billing order disappeared')
    if (notification === 'TRANSACTION_VOID') {
      if (lockedOrder.status === 'paid') {
        await tx
          .update(billingPayments)
          .set({ status: 'VOID', providerPayload: raw })
          .where(eq(billingPayments.orderId, lockedOrder.id))
        await tx
          .update(billingOrders)
          .set({ status: 'review', providerPayload: raw })
          .where(eq(billingOrders.id, lockedOrder.id))
      } else if (lockedOrder.status === 'pending') {
        await tx
          .update(billingOrders)
          .set({ status: 'cancelled', providerPayload: raw })
          .where(eq(billingOrders.id, lockedOrder.id))
      }
      await tx
        .update(billingWebhookEvents)
        .set({
          processingError: 'void_requires_manual_entitlement_review',
          processedAt: new Date(),
        })
        .where(eq(billingWebhookEvents.id, insertedEvent[0].id))
      return
    }

    const orderAmount = Number(orderPayload.order_amount)
    const transactionAmount = Number(transaction.transaction_amount)
    const validPayment =
      orderPayload.order_currency === 'VND' &&
      transaction.transaction_currency === 'VND' &&
      orderPayload.order_status === 'CAPTURED' &&
      transaction.transaction_status === 'APPROVED' &&
      orderAmount === lockedOrder.amountVnd &&
      transactionAmount === lockedOrder.amountVnd
    if (!validPayment) {
      await tx
        .update(billingWebhookEvents)
        .set({
          processingError: 'amount_currency_or_status_mismatch',
          processedAt: new Date(),
        })
        .where(eq(billingWebhookEvents.id, insertedEvent[0].id))
      return
    }

    const priorVoid = await tx.query.billingWebhookEvents.findFirst({
      where: eq(
        billingWebhookEvents.eventKey,
        `${String(transactionId)}:TRANSACTION_VOID`,
      ),
    })
    if (
      priorVoid ||
      lockedOrder.status === 'cancelled' ||
      lockedOrder.status === 'void'
    ) {
      const previousPayment = await tx.query.billingPayments.findFirst({
        where: and(
          eq(billingPayments.environment, environment),
          eq(billingPayments.provider, 'sepay'),
          eq(billingPayments.providerTransactionId, String(transactionId)),
        ),
      })
      if (!previousPayment) {
        await tx.insert(billingPayments).values({
          orderId: lockedOrder.id,
          providerTransactionId: String(transactionId),
          providerOrderId: String(
            orderPayload.order_id ?? orderPayload.id ?? '',
          ),
          environment,
          amountVnd: transactionAmount,
          status: 'APPROVED_REVIEW',
          providerPayload: raw,
        })
      }
      await tx
        .update(billingOrders)
        .set({
          status: 'review',
          paidAt: lockedOrder.paidAt ?? new Date(),
          sepayOrderId: String(orderPayload.order_id ?? orderPayload.id ?? ''),
          providerPayload: raw,
        })
        .where(eq(billingOrders.id, lockedOrder.id))
      await tx
        .update(billingWebhookEvents)
        .set({
          processingError: 'paid_after_cancellation_requires_manual_review',
          processedAt: new Date(),
        })
        .where(eq(billingWebhookEvents.id, insertedEvent[0].id))
      return
    }
    if (lockedOrder.status === 'paid') {
      await tx
        .update(billingWebhookEvents)
        .set({ processedAt: new Date() })
        .where(eq(billingWebhookEvents.id, insertedEvent[0].id))
      return
    }
    if (lockedOrder.status !== 'pending') {
      await tx
        .update(billingWebhookEvents)
        .set({ processingError: 'order_not_pending', processedAt: new Date() })
        .where(eq(billingWebhookEvents.id, insertedEvent[0].id))
      return
    }

    if (lockedOrder.type === 'subscription') {
      await tx
        .select({ workspaceId: workspaceProfiles.workspaceId })
        .from(workspaceProfiles)
        .where(eq(workspaceProfiles.workspaceId, lockedOrder.workspaceId))
        .for('update')
      const currentSubscription = (
        await tx
          .select()
          .from(workspaceSubscriptions)
          .where(
            eq(workspaceSubscriptions.workspaceId, lockedOrder.workspaceId),
          )
          .for('update')
      ).at(0)
      if (currentSubscription?.pendingPlan) {
        await parkPaidOrderForReview(tx, {
          order: lockedOrder,
          eventId: insertedEvent[0].id,
          raw,
          orderPayload,
          transactionId,
          transactionAmount,
          environment,
          reason: 'paid_subscription_change_conflict_review',
        })
        return
      }
    }
    if (
      lockedOrder.type === 'seat_addition' &&
      !(await seatAdditionStillApplies(tx, lockedOrder))
    ) {
      await parkPaidOrderForReview(tx, {
        order: lockedOrder,
        eventId: insertedEvent[0].id,
        raw,
        orderPayload,
        transactionId,
        transactionAmount,
        environment,
        reason: 'paid_seat_addition_conflict_review',
      })
      return
    }

    await tx.insert(billingPayments).values({
      orderId: lockedOrder.id,
      providerTransactionId: String(transactionId),
      providerOrderId: String(orderPayload.order_id ?? orderPayload.id ?? ''),
      environment,
      amountVnd: transactionAmount,
      status: 'APPROVED',
      providerPayload: raw,
    })
    if (lockedOrder.type === 'topup') await grantTopup(tx, lockedOrder)
    else if (lockedOrder.type === 'seat_addition')
      await fulfillSeatAddition(tx, lockedOrder)
    else await fulfillSubscription(tx, lockedOrder)
    await tx
      .update(billingOrders)
      .set({
        status: 'paid',
        paidAt: new Date(),
        sepayOrderId: String(orderPayload.order_id ?? orderPayload.id ?? ''),
        providerPayload: raw,
      })
      .where(eq(billingOrders.id, lockedOrder.id))
    await tx
      .update(billingWebhookEvents)
      .set({ processedAt: new Date() })
      .where(eq(billingWebhookEvents.id, insertedEvent[0].id))
  })
}

type VerificationResult = { recovered: boolean; warning: string | null }
const orderVerifications = new Map<
  string,
  { checkedAt: number; result: Promise<VerificationResult> }
>()

async function verifyPendingOrder(order: typeof billingOrders.$inferSelect) {
  const remote = await findSepayOrderByInvoice(order.orderInvoiceNumber)
  if (!remote) return { recovered: false, warning: null }
  return reconcileSepayOrder(order, remote)
}

export async function reconcileSepayOrder(
  order: typeof billingOrders.$inferSelect,
  remote: SepayOrder,
) {
  if (
    remote.order_invoice_number !== order.orderInvoiceNumber ||
    remote.order_currency !== order.currency ||
    Number(remote.order_amount) !== order.amountVnd
  )
    throw new Response(
      'Thông tin thanh toán không khớp với đơn hàng. Vui lòng liên hệ hỗ trợ trước khi thanh toán lại.',
      { status: 503 },
    )

  if (['CANCELLED', 'CANCELED'].includes(remote.order_status)) {
    // Only a provider-confirmed cancellation can close an unpaid order.
    // The pending predicate protects a concurrent successful IPN.
    await db
      .update(billingOrders)
      .set({
        status: 'cancelled',
        sepayOrderId: remote.order_id,
        providerPayload: {
          verification_source: 'sepay_order_api',
          order: remote,
        },
      })
      .where(
        and(
          eq(billingOrders.id, order.id),
          eq(billingOrders.status, 'pending'),
        ),
      )
    return { recovered: false, warning: null }
  }
  if (remote.order_status !== 'CAPTURED')
    return { recovered: false, warning: null }

  const approved = remote.transactions.filter(
    (transaction) =>
      transaction.transaction_type === 'PAYMENT' &&
      transaction.transaction_status === 'APPROVED' &&
      transaction.transaction_currency === order.currency &&
      Number(transaction.transaction_amount) === order.amountVnd,
  )
  if (approved.length !== 1)
    throw new Response(
      'SePay đã nhận thanh toán nhưng giao dịch cần được đối soát. Vui lòng liên hệ hỗ trợ và không thanh toán lại.',
      { status: 503 },
    )
  const transaction = approved[0]
  // API responses expose an internal transaction id, whereas IPNs can expose
  // a transaction_id. The locked order and unique grants prevent either
  // representation from fulfilling the same purchase twice.
  await processSepayIpn(
    {
      notification_type: 'ORDER_PAID',
      verification_source: 'sepay_order_api',
      order: remote,
      transaction: {
        ...transaction,
        transaction_id: transaction.transaction_id ?? `api:${transaction.id}`,
      },
    },
    env.SEPAY_ENV,
  )
  const updated = await db.query.billingOrders.findFirst({
    where: eq(billingOrders.id, order.id),
  })
  if (updated?.status !== 'paid' && updated?.status !== 'review')
    throw new Response(
      'Thanh toán cần được đối soát. Vui lòng liên hệ hỗ trợ trước khi thanh toán lại.',
      { status: 503 },
    )
  if (env.NODE_ENV !== 'production')
    console.info('[SePay reconciliation] payment verified', {
      invoice: order.orderInvoiceNumber,
      status: updated.status,
    })
  return { recovered: true, warning: null }
}

export async function reconcilePendingBillingOrders(
  workspaceId: string,
  options: {
    invoice?: string
    subscriptionsOnly?: boolean
    fresh?: boolean
  } = {},
) {
  const orders = await db.query.billingOrders.findMany({
    where: and(
      eq(billingOrders.workspaceId, workspaceId),
      eq(billingOrders.status, 'pending'),
      options.subscriptionsOnly
        ? inArray(billingOrders.type, ['subscription', 'seat_addition'])
        : undefined,
    ),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    limit: options.subscriptionsOnly ? 21 : 5,
  })
  if (
    options.invoice &&
    !orders.some((order) => order.orderInvoiceNumber === options.invoice)
  ) {
    const selected = await db.query.billingOrders.findFirst({
      where: and(
        eq(billingOrders.workspaceId, workspaceId),
        eq(billingOrders.orderInvoiceNumber, options.invoice),
        eq(billingOrders.status, 'pending'),
        options.subscriptionsOnly
          ? inArray(billingOrders.type, ['subscription', 'seat_addition'])
          : undefined,
      ),
    })
    if (selected) orders.unshift(selected)
  }
  if (options.subscriptionsOnly && orders.length > 20)
    return {
      recoveredInvoices: [] as string[],
      warnings: [] as Array<{ invoice: string; message: string }>,
      warning:
        'Có nhiều đơn chưa được đối soát. Vui lòng liên hệ hỗ trợ trước khi thanh toán tiếp.',
    }
  const results = await Promise.all(
    orders.map(async (order) => {
      const key = `${env.SEPAY_ENV}:${order.id}`
      let cached = orderVerifications.get(key)
      if (
        !cached ||
        Date.now() - cached.checkedAt >= 15_000 ||
        (options.fresh && cached.checkedAt !== Infinity)
      ) {
        // Infinity marks an in-flight request; share it across polls/checkouts.
        const entry = {
          checkedAt: Infinity,
          result: Promise.resolve<VerificationResult>({
            recovered: false,
            warning: null,
          }),
        }
        entry.result = verifyPendingOrder(order)
          .catch(async (error: unknown) => {
            if (!(error instanceof Response))
              console.error('[SePay reconciliation] failed', {
                orderId: order.id,
              })
            return {
              recovered: false,
              warning:
                error instanceof Response
                  ? await error.text()
                  : 'Chưa thể cập nhật thanh toán. Vui lòng kiểm tra lại sau; không thanh toán lại nếu đã trả tiền.',
            }
          })
          .finally(() => {
            entry.checkedAt = Date.now()
          })
        // Bound the process-local throttle. It is not a financial source of truth.
        if (orderVerifications.size >= 500) {
          for (const [oldKey, oldEntry] of orderVerifications) {
            if (oldEntry.checkedAt !== Infinity) {
              orderVerifications.delete(oldKey)
              break
            }
          }
        }
        orderVerifications.set(key, entry)
        cached = entry
      }
      return { invoice: order.orderInvoiceNumber, ...(await cached.result) }
    }),
  )
  return {
    recoveredInvoices: results
      .filter((result) => result.recovered)
      .map((result) => result.invoice),
    warnings: results.flatMap((result) =>
      result.warning
        ? [{ invoice: result.invoice, message: result.warning }]
        : [],
    ),
    warning:
      results
        .filter((result) => result.warning)
        .map((result) => `Đơn ${result.invoice}: ${result.warning}`)
        .join('\n') || null,
  }
}

export async function getBillingSummary(workspaceId: string, userId: string) {
  const now = new Date()
  const subscription = await db.query.workspaceSubscriptions.findFirst({
    where: eq(workspaceSubscriptions.workspaceId, workspaceId),
  })
  const activeSubscription =
    subscription?.status === 'active' && subscription.currentPeriodEnd > now
      ? subscription
      : null
  const seat = await db.query.workspaceSeatAssignments.findFirst({
    where: and(
      eq(workspaceSeatAssignments.workspaceId, workspaceId),
      eq(workspaceSeatAssignments.userId, userId),
      isNull(workspaceSeatAssignments.revokedAt),
    ),
  })
  const personalProfile = await db.query.workspaceProfiles.findFirst({
    where: eq(workspaceProfiles.workspaceId, workspaceId),
  })
  const allowanceAnchor =
    personalProfile?.kind === 'personal'
      ? activeSubscription?.plan === 'pro'
        ? activeSubscription.currentPeriodStart
        : personalProfile.createdAt
      : activeSubscription && seat
        ? activeSubscription.currentPeriodStart
        : null
  const grantOwnership =
    personalProfile?.kind === 'company'
      ? or(
          and(
            eq(creditGrants.userId, userId),
            or(
              and(
                eq(creditGrants.type, 'included'),
                eq(creditGrants.seatNumber, seat?.seatNumber ?? -1),
              ),
              eq(creditGrants.type, 'topup'),
              eq(creditGrants.type, 'adjustment'),
            ),
          ),
          isNull(creditGrants.userId),
        )
      : or(eq(creditGrants.userId, userId), isNull(creditGrants.userId))
  const grants = await db
    .select({
      type: creditGrants.type,
      seatNumber: creditGrants.seatNumber,
      remainingSeconds: sql<number>`${creditGrants.remainingSeconds} - ${creditGrants.reservedSeconds}`,
      reservedSeconds: creditGrants.reservedSeconds,
    })
    .from(creditGrants)
    .where(
      and(
        eq(creditGrants.workspaceId, workspaceId),
        grantOwnership,
        or(isNull(creditGrants.expiresAt), gt(creditGrants.expiresAt, now)),
      ),
    )
  const members = await db
    .select({
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      paidSeat: workspaceSeatAssignments.id,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(
      workspaceSeatAssignments,
      and(
        eq(workspaceSeatAssignments.workspaceId, member.organizationId),
        eq(workspaceSeatAssignments.userId, member.userId),
        isNull(workspaceSeatAssignments.revokedAt),
      ),
    )
    .where(eq(member.organizationId, workspaceId))

  return {
    workspaceId,
    plan:
      activeSubscription?.plan ??
      (personalProfile?.kind === 'company' && subscription?.plan === 'business'
        ? 'business'
        : 'free'),
    interval:
      activeSubscription?.interval ??
      (personalProfile?.kind === 'company' && subscription?.plan === 'business'
        ? subscription.interval
        : null),
    subscriptionStatus:
      activeSubscription?.status ?? (subscription ? 'expired' : 'free'),
    currentPeriodEnd:
      activeSubscription ||
      (personalProfile?.kind === 'company' && subscription?.plan === 'business')
        ? (subscription?.currentPeriodEnd.toISOString() ?? null)
        : null,
    seatQuantity: activeSubscription?.seatQuantity ?? 0,
    cancelAtPeriodEnd: activeSubscription?.cancelAtPeriodEnd ?? false,
    pendingPlan: activeSubscription?.pendingPlan ?? null,
    pendingInterval: activeSubscription?.pendingInterval ?? null,
    pendingSeatQuantity: activeSubscription?.pendingSeatQuantity ?? null,
    hasSeat: personalProfile?.kind === 'personal' || Boolean(seat),
    members: members.map((item) => ({
      ...item,
      paidSeat: Boolean(item.paidSeat),
    })),
    minutes: {
      refreshAt: allowanceAnchor
        ? getAllowancePeriod(allowanceAnchor, now).endsAt.toISOString()
        : null,
      included: Math.floor(
        grants
          .filter((grant) => grant.type === 'included')
          .reduce((sum, grant) => sum + grant.remainingSeconds, 0) / 60,
      ),
      topup: Math.floor(
        grants
          .filter((grant) => grant.type !== 'included')
          .reduce((sum, grant) => sum + grant.remainingSeconds, 0) / 60,
      ),
    },
  }
}
