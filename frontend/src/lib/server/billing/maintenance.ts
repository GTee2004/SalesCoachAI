import { and, eq } from 'drizzle-orm'
import { db } from '#/db'
import { billingOrders } from '#/db/schema'
import { reconcileSepayOrder } from './checkout'
import { cancelSepayOrder, findSepayOrderByInvoice } from './sepay-api'
import { cancelUnpaidOrder } from './order-cancellation'
import { createMaintenanceStore } from './maintenance-store'

const store = createMaintenanceStore(db)

async function processClaim(order: typeof billingOrders.$inferSelect) {
  try {
    return await cancelUnpaidOrder(order, {
      lookup: findSepayOrderByInvoice,
      cancel: cancelSepayOrder,
      reconcile: async (remote) => {
        await reconcileSepayOrder(order, remote)
      },
      status: async () => {
        const current = await db.query.billingOrders.findFirst({
          where: eq(billingOrders.id, order.id),
        })
        if (!current) throw new Error('Billing order disappeared')
        if (
          current.status === 'pending' &&
          (current.maintenanceLeaseToken !== order.maintenanceLeaseToken ||
            !current.maintenanceLeaseUntil ||
            current.maintenanceLeaseUntil <= new Date())
        )
          throw new Response(
            'Đơn đang được kiểm tra ở lượt khác. Vui lòng thử lại sau.',
            { status: 409 },
          )
        return current.status
      },
    })
  } finally {
    // Token fencing prevents a stale invocation releasing another worker's
    // claim. A crashed process leaves an expiring lease, never a permanent lock.
    await store.release(order)
  }
}

export async function cancelBillingOrder(workspaceId: string, invoice: string) {
  const order = await db.query.billingOrders.findFirst({
    where: and(
      eq(billingOrders.workspaceId, workspaceId),
      eq(billingOrders.orderInvoiceNumber, invoice),
    ),
  })
  if (!order) throw new Response('Đơn hàng không tồn tại.', { status: 404 })
  if (order.status !== 'pending') return { status: order.status }
  const claimed = await store.claimOrder(order.id, false)
  if (!claimed)
    throw new Response('Đơn đang được kiểm tra. Vui lòng thử lại sau.', {
      status: 409,
    })
  return { status: await processClaim(claimed) }
}

export async function sweepExpiredBillingOrders() {
  const candidates = await store.dueOrders()
  const result = {
    processed: 0,
    cancelled: 0,
    paid: 0,
    review: 0,
    retry: 0,
    skipped: 0,
  }
  // Bounded batches and two lanes cap provider traffic and endpoint duration.
  // Atomic claims are shared by manual cancellation and every sweep instance.
  const startedAt = Date.now()
  let cursor = 0
  async function lane() {
    while (cursor < candidates.length && Date.now() - startedAt < 40_000) {
      const candidate = candidates[cursor++]
      const order = await store.claimOrder(candidate.id, true)
      if (!order) {
        result.skipped++
        continue
      }
      result.processed++
      try {
        const status = await processClaim(order)
        if (status === 'cancelled' || status === 'paid' || status === 'review')
          result[status]++
        else result.retry++
      } catch (error) {
        result.retry++
        console.warn('[Billing sweep] order needs retry', {
          invoice: order.orderInvoiceNumber,
          status: error instanceof Response ? error.status : 500,
        })
      }
    }
  }
  await Promise.all([lane(), lane()])
  return result
}
