import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '#/db'
import {
  invitation,
  workspaceSeatAssignments,
  workspaceSubscriptions,
} from '#/db/schema'
import { refreshPendingSubscription } from './credits'

export type SeatAvailability = {
  // False when the workspace has no live Business subscription.
  active: boolean
  limit: number
  used: number
  pendingInvitations: number
  free: number
}

// A seat that is scheduled to disappear next period is never offered, which is
// why the limit is the smaller of the current and the pending quantity.
export function computeSeatAvailability(input: {
  subscriptionActive: boolean
  seatQuantity: number
  pendingSeatQuantity: number | null
  used: number
  pendingInvitations: number
}): SeatAvailability {
  const limit = input.subscriptionActive
    ? Math.min(
        input.seatQuantity,
        input.pendingSeatQuantity ?? input.seatQuantity,
      )
    : 0
  return {
    active: input.subscriptionActive,
    limit,
    used: input.used,
    pendingInvitations: input.pendingInvitations,
    free: Math.max(0, limit - input.used - input.pendingInvitations),
  }
}

export async function getSeatAvailability(
  workspaceId: string,
  now = new Date(),
): Promise<SeatAvailability> {
  await refreshPendingSubscription(workspaceId)
  const subscription = await db.query.workspaceSubscriptions.findFirst({
    where: eq(workspaceSubscriptions.workspaceId, workspaceId),
  })
  const [seats, invitations] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(workspaceSeatAssignments)
      .where(
        and(
          eq(workspaceSeatAssignments.workspaceId, workspaceId),
          isNull(workspaceSeatAssignments.revokedAt),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, workspaceId),
          eq(invitation.status, 'pending'),
          gt(invitation.expiresAt, now),
        ),
      ),
  ])
  return computeSeatAvailability({
    subscriptionActive: Boolean(
      subscription &&
      subscription.plan === 'business' &&
      subscription.status === 'active' &&
      subscription.currentPeriodEnd > now,
    ),
    seatQuantity: subscription?.seatQuantity ?? 0,
    pendingSeatQuantity: subscription?.pendingSeatQuantity ?? null,
    used: seats[0]?.count ?? 0,
    pendingInvitations: invitations[0]?.count ?? 0,
  })
}
