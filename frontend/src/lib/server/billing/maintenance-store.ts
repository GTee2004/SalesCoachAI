import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm'
import type { db } from '#/db'
import { billingOrders } from '#/db/schema'
import { maintenanceRetryDelay } from './order-cancellation'

export function createMaintenanceStore(database: typeof db) {
  const leaseMs = 2 * 60_000

  async function claimOrder(id: string, scheduled: boolean) {
    const now = new Date()
    return (
      await database
        .update(billingOrders)
        .set({
          maintenanceLeaseUntil: new Date(now.getTime() + leaseMs),
          maintenanceLeaseToken: randomUUID(),
          maintenanceAttempts: sql`${billingOrders.maintenanceAttempts} + 1`,
        })
        .where(
          and(
            eq(billingOrders.id, id),
            eq(billingOrders.status, 'pending'),
            or(
              isNull(billingOrders.maintenanceLeaseUntil),
              lte(billingOrders.maintenanceLeaseUntil, now),
            ),
            scheduled ? lte(billingOrders.expiresAt, now) : undefined,
            scheduled ? lte(billingOrders.maintenanceNextAt, now) : undefined,
          ),
        )
        .returning()
    ).at(0)
  }

  async function release(order: typeof billingOrders.$inferSelect) {
    await database
      .update(billingOrders)
      .set({
        maintenanceLeaseToken: null,
        maintenanceLeaseUntil: null,
        maintenanceNextAt: new Date(
          Date.now() + maintenanceRetryDelay(order.maintenanceAttempts),
        ),
      })
      .where(
        and(
          eq(billingOrders.id, order.id),
          eq(billingOrders.maintenanceLeaseToken, order.maintenanceLeaseToken!),
        ),
      )
  }

  async function dueOrders() {
    const now = new Date()
    return database
      .select({ id: billingOrders.id })
      .from(billingOrders)
      .where(
        and(
          eq(billingOrders.status, 'pending'),
          lte(billingOrders.expiresAt, now),
          lte(billingOrders.maintenanceNextAt, now),
          or(
            isNull(billingOrders.maintenanceLeaseUntil),
            lte(billingOrders.maintenanceLeaseUntil, now),
          ),
        ),
      )
      .orderBy(asc(billingOrders.maintenanceNextAt), asc(billingOrders.id))
      .limit(10)
  }

  return { claimOrder, release, dueOrders }
}
