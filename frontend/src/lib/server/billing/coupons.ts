import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#/db'
import {
  billingOrders,
  couponRedemptions,
  coupons,
  organization,
  user,
} from '#/db/schema'
import type { z } from 'zod'
import { applyDiscount, normalizeCouponCode } from '#/lib/billing/coupons'
import type {
  createCouponSchema,
  updateCouponSchema,
} from '#/lib/billing/coupon-schemas'
import type {
  AdminCoupon,
  CouponRedemption,
  CouponOrderType,
  PublicCoupon,
} from '#/lib/billing/coupons'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = DatabaseTransaction | typeof db
type CouponRow = typeof coupons.$inferSelect

// Statuses in which an order still holds its coupon. Cancelled, void and
// failed orders release it, so abandoned checkouts do not burn a limit.
const HOLDING_STATUSES = ['pending', 'paid', 'review'] as const

const invalid = () =>
  new Response('Mã giảm giá không hợp lệ hoặc đã hết hạn.', { status: 400 })

async function countHeld(
  executor: Executor,
  couponId: string,
  workspaceId?: string,
) {
  const [row] = await executor
    .select({ held: sql<number>`count(*)::int` })
    .from(couponRedemptions)
    .innerJoin(billingOrders, eq(billingOrders.id, couponRedemptions.orderId))
    .where(
      and(
        eq(couponRedemptions.couponId, couponId),
        workspaceId
          ? eq(couponRedemptions.workspaceId, workspaceId)
          : undefined,
        inArray(billingOrders.status, [...HOLDING_STATUSES]),
      ),
    )
  return row.held
}

// Unknown, disabled, not-yet-valid and expired codes share one message so the
// endpoint does not confirm which codes exist.
async function assertRedeemable(
  executor: Executor,
  coupon: CouponRow | undefined,
  workspaceId: string,
  now: Date,
): Promise<CouponRow> {
  if (
    !coupon ||
    !coupon.active ||
    (coupon.startsAt && coupon.startsAt > now) ||
    (coupon.expiresAt && coupon.expiresAt <= now)
  )
    throw invalid()
  if (
    coupon.maxRedemptions !== null &&
    (await countHeld(executor, coupon.id)) >= coupon.maxRedemptions
  )
    throw new Response('Mã giảm giá đã hết lượt sử dụng.', { status: 409 })
  if (
    (await countHeld(executor, coupon.id, workspaceId)) >=
    coupon.maxRedemptionsPerWorkspace
  )
    throw new Response('Không gian làm việc này đã sử dụng mã giảm giá này.', {
      status: 409,
    })
  return coupon
}

function toPublic(coupon: CouponRow): PublicCoupon {
  return {
    code: coupon.code,
    name: coupon.name,
    discountType: coupon.discountType,
    value: coupon.value,
    maxDiscountVnd: coupon.maxDiscountVnd,
    appliesTo: coupon.appliesTo,
  }
}

// Read-only check for the billing page. Checkout validates again under a lock,
// so a preview is never a promise.
export async function previewCoupon(input: {
  code: string
  workspaceId: string
}): Promise<PublicCoupon> {
  const coupon = await db.query.coupons.findFirst({
    where: eq(coupons.code, normalizeCouponCode(input.code)),
  })
  return toPublic(
    await assertRedeemable(db, coupon, input.workspaceId, new Date()),
  )
}

// Called inside the checkout transaction. The coupon row lock serializes
// concurrent checkouts so the limits cannot be overshot.
export async function reserveCoupon(
  tx: DatabaseTransaction,
  input: {
    code: string
    workspaceId: string
    orderType: CouponOrderType
    subtotalVnd: number
    now: Date
  },
) {
  const coupon = (
    await tx
      .select()
      .from(coupons)
      .where(eq(coupons.code, normalizeCouponCode(input.code)))
      .for('update')
  ).at(0)
  await assertRedeemable(tx, coupon, input.workspaceId, input.now)
  if (!coupon || !coupon.appliesTo.includes(input.orderType))
    throw new Response('Mã giảm giá không áp dụng cho sản phẩm này.', {
      status: 409,
    })
  const { discountVnd, totalVnd } = applyDiscount(coupon, input.subtotalVnd)
  if (discountVnd <= 0) throw invalid()
  return { coupon, discountVnd, totalVnd }
}

export async function recordRedemption(
  tx: DatabaseTransaction,
  input: {
    couponId: string
    orderId: string
    workspaceId: string
    userId: string
    discountVnd: number
  },
) {
  await tx.insert(couponRedemptions).values(input)
}

// ---- Admin management -------------------------------------------------------

function isUniqueViolation(error: unknown) {
  const code = error as { code?: unknown; cause?: { code?: unknown } } | null
  return code?.code === '23505' || code?.cause?.code === '23505'
}

const dateOrNull = (value: string | null) => (value ? new Date(value) : null)

export async function listCoupons(): Promise<Array<AdminCoupon>> {
  const rows = await db.query.coupons.findMany({
    orderBy: [desc(coupons.createdAt)],
    limit: 500,
  })
  if (!rows.length) return []
  const held = await db
    .select({
      couponId: couponRedemptions.couponId,
      held: sql<number>`count(*)::int`,
    })
    .from(couponRedemptions)
    .innerJoin(billingOrders, eq(billingOrders.id, couponRedemptions.orderId))
    .where(inArray(billingOrders.status, [...HOLDING_STATUSES]))
    .groupBy(couponRedemptions.couponId)
  const heldById = new Map(held.map((row) => [row.couponId, row.held]))
  return rows.map((coupon) => ({
    ...toPublic(coupon),
    id: coupon.id,
    startsAt: coupon.startsAt?.toISOString() ?? null,
    expiresAt: coupon.expiresAt?.toISOString() ?? null,
    maxRedemptions: coupon.maxRedemptions,
    maxRedemptionsPerWorkspace: coupon.maxRedemptionsPerWorkspace,
    active: coupon.active,
    redeemed: heldById.get(coupon.id) ?? 0,
    createdAt: coupon.createdAt.toISOString(),
  }))
}

// Newest first. Cancelled orders are listed too, marked as not counted, so an
// admin can see why a limit is or is not reached.
export async function listCouponRedemptions(
  couponId: string,
): Promise<Array<CouponRedemption>> {
  const rows = await db
    .select({
      id: couponRedemptions.id,
      createdAt: couponRedemptions.createdAt,
      userName: user.name,
      userEmail: user.email,
      workspaceName: organization.name,
      invoice: billingOrders.orderInvoiceNumber,
      orderStatus: billingOrders.status,
      amountVnd: billingOrders.amountVnd,
      discountVnd: couponRedemptions.discountVnd,
    })
    .from(couponRedemptions)
    .innerJoin(billingOrders, eq(billingOrders.id, couponRedemptions.orderId))
    .innerJoin(user, eq(user.id, couponRedemptions.userId))
    .innerJoin(organization, eq(organization.id, couponRedemptions.workspaceId))
    .where(eq(couponRedemptions.couponId, couponId))
    .orderBy(desc(couponRedemptions.createdAt))
    .limit(200)
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    counted: (HOLDING_STATUSES as ReadonlyArray<string>).includes(
      row.orderStatus,
    ),
  }))
}

export async function createCoupon(
  input: z.infer<typeof createCouponSchema>,
  adminUserId: string,
) {
  if (input.expiresAt && new Date(input.expiresAt) <= new Date())
    throw new Response('Ngày hết hạn phải ở tương lai.', { status: 400 })
  try {
    const [created] = await db
      .insert(coupons)
      .values({
        code: input.code,
        name: input.name,
        discountType: input.discountType,
        value: input.value,
        maxDiscountVnd: input.maxDiscountVnd,
        appliesTo: input.appliesTo,
        startsAt: dateOrNull(input.startsAt),
        expiresAt: dateOrNull(input.expiresAt),
        maxRedemptions: input.maxRedemptions,
        maxRedemptionsPerWorkspace: input.maxRedemptionsPerWorkspace,
        createdByUserId: adminUserId,
      })
      .returning({ id: coupons.id })
    console.info('Admin created a coupon', {
      adminId: adminUserId,
      couponId: created.id,
      code: input.code,
    })
    return created
  } catch (error) {
    if (isUniqueViolation(error))
      throw new Response('Mã giảm giá này đã tồn tại.', { status: 409 })
    throw error
  }
}

// Code, type and value are deliberately not editable: past orders reference
// the coupon and must stay explainable. Create a new coupon instead.
export async function updateCoupon(
  input: z.infer<typeof updateCouponSchema>,
  adminUserId: string,
) {
  const updated = (
    await db
      .update(coupons)
      .set({
        name: input.name,
        active: input.active,
        appliesTo: input.appliesTo,
        startsAt: dateOrNull(input.startsAt),
        expiresAt: dateOrNull(input.expiresAt),
        maxRedemptions: input.maxRedemptions,
        maxRedemptionsPerWorkspace: input.maxRedemptionsPerWorkspace,
      })
      .where(eq(coupons.id, input.id))
      .returning({ id: coupons.id, code: coupons.code })
  ).at(0)
  if (!updated)
    throw new Response('Mã giảm giá không tồn tại.', { status: 404 })
  console.info('Admin updated a coupon', {
    adminId: adminUserId,
    couponId: updated.id,
    code: updated.code,
    active: input.active,
  })
  return updated
}
