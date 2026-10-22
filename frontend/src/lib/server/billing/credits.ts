import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt, gte, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { db } from '#/db'
import {
  creditGrants,
  creditLedger,
  creditReservations,
  member,
  workspaceProfiles,
  workspaceSeatAssignments,
  workspaceSubscriptions,
  subscriptionPeriods,
} from '#/db/schema'
import type { SeatAssignReason, SeatRevokeReason } from '#/db/schema'
import { getAllowancePeriod } from './periods'

const MAX_SESSION_SECONDS = 15 * 60
// A call runs up to this much longer to give back time lost to a voice service
// outage, which is not charged. Matches the voice backend's limit.
const MAX_OUTAGE_EXTENSION_SECONDS = 5 * 60
/** The most active time one attempt can report, extension included. */
export const MAX_ATTEMPT_ACTIVE_SECONDS =
  MAX_SESSION_SECONDS + MAX_OUTAGE_EXTENSION_SECONDS
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function refreshPendingSubscriptionInTransaction(
  tx: DatabaseTransaction,
  workspaceId: string,
  now: Date,
) {
  const subscription = (
    await tx
      .select()
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
      .for('update')
  ).at(0)
  if (
    !subscription ||
    subscription.currentPeriodEnd > now ||
    !subscription.pendingPlan ||
    !subscription.pendingInterval ||
    !subscription.pendingSeatQuantity
  )
    return subscription

  const nextPeriod = await tx.query.subscriptionPeriods.findFirst({
    where: and(
      eq(subscriptionPeriods.workspaceId, workspaceId),
      gte(subscriptionPeriods.startsAt, subscription.currentPeriodEnd),
      lte(subscriptionPeriods.startsAt, now),
    ),
    orderBy: (period, { asc }) => [asc(period.startsAt)],
  })
  if (!nextPeriod) return subscription

  await tx
    .update(workspaceSubscriptions)
    .set({
      plan: nextPeriod.plan,
      interval: nextPeriod.interval,
      seatQuantity: nextPeriod.seatQuantity,
      currentPeriodStart: nextPeriod.startsAt,
      currentPeriodEnd: nextPeriod.endsAt,
      pendingPlan: null,
      pendingInterval: null,
      pendingSeatQuantity: null,
      status: 'active',
      cancelAtPeriodEnd: false,
      updatedAt: now,
    })
    .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
  return {
    ...subscription,
    plan: nextPeriod.plan,
    interval: nextPeriod.interval,
    seatQuantity: nextPeriod.seatQuantity,
    currentPeriodStart: nextPeriod.startsAt,
    currentPeriodEnd: nextPeriod.endsAt,
    pendingPlan: null,
    pendingInterval: null,
    pendingSeatQuantity: null,
    status: 'active' as const,
    cancelAtPeriodEnd: false,
  }
}

export async function refreshPendingSubscription(workspaceId: string) {
  await db.transaction((tx) =>
    refreshPendingSubscriptionInTransaction(tx, workspaceId, new Date()),
  )
}

async function ensureMonthlyGrant(
  tx: DatabaseTransaction,
  input: { workspaceId: string; userId: string; now: Date },
) {
  const profile = await tx.query.workspaceProfiles.findFirst({
    where: eq(workspaceProfiles.workspaceId, input.workspaceId),
  })
  if (!profile)
    throw new Response('Không gian làm việc không tồn tại.', { status: 404 })

  const subscription = await refreshPendingSubscriptionInTransaction(
    tx,
    input.workspaceId,
    input.now,
  )
  const subscriptionIsActive =
    subscription?.status === 'active' &&
    subscription.currentPeriodEnd > input.now

  let minutes: number
  let anchor: Date
  let seatNumber: number | null = null
  if (profile.kind === 'personal') {
    if (profile.personalOwnerUserId !== input.userId)
      throw new Response('Tài khoản cá nhân không hợp lệ.', { status: 403 })
    minutes = subscriptionIsActive && subscription.plan === 'pro' ? 150 : 15
    anchor = subscriptionIsActive
      ? subscription.currentPeriodStart
      : profile.createdAt
  } else {
    if (
      !subscriptionIsActive ||
      subscription.plan !== 'business' ||
      subscription.seatQuantity < 2
    )
      throw new Response('Gói Business của không gian làm việc đã hết hạn.', {
        status: 402,
      })
    const assignment = await tx.query.workspaceSeatAssignments.findFirst({
      where: and(
        eq(workspaceSeatAssignments.workspaceId, input.workspaceId),
        eq(workspaceSeatAssignments.userId, input.userId),
        isNull(workspaceSeatAssignments.revokedAt),
      ),
    })
    if (!assignment)
      throw new Response(
        'Bạn chưa được cấp suất luyện tập trong không gian làm việc này.',
        {
          status: 403,
        },
      )
    seatNumber = assignment.seatNumber
    minutes = 300
    anchor = subscription.currentPeriodStart
  }

  const period = getAllowancePeriod(anchor, input.now)
  const grantKey =
    profile.kind === 'company'
      ? `included:${input.workspaceId}:seat:${seatNumber}:${period.startsAt.toISOString()}`
      : `included:${input.workspaceId}:${input.userId}:${period.startsAt.toISOString()}`
  const newGrant = await tx
    .insert(creditGrants)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      seatNumber,
      type: 'included',
      grantKey,
      totalSeconds: minutes * 60,
      remainingSeconds: minutes * 60,
      periodStart: period.startsAt,
      expiresAt: period.endsAt,
    })
    .onConflictDoNothing()
    .returning({ id: creditGrants.id })
  if (newGrant.length) {
    await tx.insert(creditLedger).values({
      grantId: newGrant[0].id,
      idempotencyKey: `grant:${grantKey}`,
      deltaSeconds: minutes * 60,
      reason: 'monthly_included',
    })
  }
  return period
}

export async function ensureIncludedAllowance(
  workspaceId: string,
  userId: string,
) {
  return db.transaction(async (tx) => {
    const profile = await tx.query.workspaceProfiles.findFirst({
      where: eq(workspaceProfiles.workspaceId, workspaceId),
    })
    if (!profile) return
    if (profile.kind === 'personal') {
      await ensureMonthlyGrant(tx, { workspaceId, userId, now: new Date() })
      return
    }
    const now = new Date()
    await refreshPendingSubscriptionInTransaction(tx, workspaceId, now)
    const subscription = await tx.query.workspaceSubscriptions.findFirst({
      where: and(
        eq(workspaceSubscriptions.workspaceId, workspaceId),
        eq(workspaceSubscriptions.plan, 'business'),
        eq(workspaceSubscriptions.status, 'active'),
        gt(workspaceSubscriptions.currentPeriodEnd, now),
      ),
    })
    const seat = await tx.query.workspaceSeatAssignments.findFirst({
      where: and(
        eq(workspaceSeatAssignments.workspaceId, workspaceId),
        eq(workspaceSeatAssignments.userId, userId),
        isNull(workspaceSeatAssignments.revokedAt),
      ),
    })
    if (subscription && seat)
      await ensureMonthlyGrant(tx, { workspaceId, userId, now })
  })
}

export async function reservePracticeCredits(input: {
  workspaceId: string
  userId: string
  sessionId: string
  attemptId: string
}) {
  return db.transaction(async (tx) => {
    // Serialize a learner's starts and seat top-up consumption across app workers.
    await tx
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, input.workspaceId),
          eq(member.userId, input.userId),
        ),
      )
      .for('update')
    const now = new Date()
    const stale = await tx
      .select({ reservation: creditReservations, grant: creditGrants })
      .from(creditReservations)
      .innerJoin(creditGrants, eq(creditGrants.id, creditReservations.grantId))
      .where(
        and(
          eq(creditGrants.workspaceId, input.workspaceId),
          isNull(creditReservations.settledAt),
          lt(
            creditReservations.createdAt,
            new Date(now.getTime() - 30 * 60_000),
          ),
        ),
      )
      .for('update')
    for (const { reservation, grant } of stale) {
      await tx
        .update(creditGrants)
        .set({
          reservedSeconds: sql`${creditGrants.reservedSeconds} - ${reservation.reservedSeconds}`,
        })
        .where(eq(creditGrants.id, grant.id))
      await tx
        .update(creditReservations)
        .set({ settledSeconds: 0, settledAt: now })
        .where(eq(creditReservations.id, reservation.id))
    }
    await ensureMonthlyGrant(tx, { ...input, now })
    const profile = await tx.query.workspaceProfiles.findFirst({
      where: eq(workspaceProfiles.workspaceId, input.workspaceId),
    })
    const assignedSeat =
      profile?.kind === 'company'
        ? await tx.query.workspaceSeatAssignments.findFirst({
            where: and(
              eq(workspaceSeatAssignments.workspaceId, input.workspaceId),
              eq(workspaceSeatAssignments.userId, input.userId),
              isNull(workspaceSeatAssignments.revokedAt),
            ),
          })
        : null
    const grantOwnership =
      profile?.kind === 'company'
        ? or(
            and(
              eq(creditGrants.userId, input.userId),
              or(
                and(
                  eq(creditGrants.type, 'included'),
                  eq(creditGrants.seatNumber, assignedSeat?.seatNumber ?? -1),
                ),
                eq(creditGrants.type, 'topup'),
                eq(creditGrants.type, 'adjustment'),
              ),
            ),
            isNull(creditGrants.userId),
          )
        : or(eq(creditGrants.userId, input.userId), isNull(creditGrants.userId))
    const rows = await tx
      .select()
      .from(creditGrants)
      .where(
        and(
          eq(creditGrants.workspaceId, input.workspaceId),
          grantOwnership,
          gt(creditGrants.remainingSeconds, 0),
          or(isNull(creditGrants.expiresAt), gt(creditGrants.expiresAt, now)),
        ),
      )
      .orderBy(asc(creditGrants.expiresAt), asc(creditGrants.createdAt))
      .for('update')

    let remaining = Math.min(
      MAX_SESSION_SECONDS,
      rows.reduce(
        (sum, grant) => sum + grant.remainingSeconds - grant.reservedSeconds,
        0,
      ),
    )
    if (remaining <= 0)
      throw new Response('Hạn mức luyện tập đã hết. Hãy mua thêm phút.', {
        status: 402,
      })
    const reserved: number[] = []
    for (const grant of rows) {
      if (remaining <= 0) break
      const available = Math.max(
        0,
        grant.remainingSeconds - grant.reservedSeconds,
      )
      const seconds = Math.min(remaining, available)
      if (!seconds) continue
      await tx
        .update(creditGrants)
        .set({ reservedSeconds: grant.reservedSeconds + seconds })
        .where(eq(creditGrants.id, grant.id))
      await tx.insert(creditReservations).values({
        sessionId: input.sessionId,
        attemptId: input.attemptId,
        grantId: grant.id,
        reservedSeconds: seconds,
      })
      reserved.push(seconds)
      remaining -= seconds
    }
    return {
      maxDurationSeconds: reserved.reduce((sum, seconds) => sum + seconds, 0),
    }
  })
}

/**
 * Splits an attempt's charge across its reservations, in reservation order.
 * The charge is the active time minus the waived time, which the voice service
 * measured as lost to its own failures. A call may run past its reservation by
 * that waived time, so the waived total is recorded whole on the first
 * reservation rather than fitted into reserved seconds.
 */
export function allocateSettlement(
  reservedSeconds: readonly number[],
  activeSeconds: number,
  waivedSeconds: number,
) {
  const waived = Math.min(waivedSeconds, activeSeconds)
  let unallocated = activeSeconds - waived
  return reservedSeconds.map((reserved, index) => {
    const consumed = Math.min(unallocated, reserved)
    unallocated -= consumed
    return { consumed, waived: index === 0 ? waived : 0 }
  })
}

export async function settlePracticeCredits(input: {
  sessionId: string
  attemptId: string
  activeSeconds: number
  /** Part of `activeSeconds` not charged because the voice service failed. */
  waivedSeconds?: number
}) {
  const activeSeconds = Math.max(
    0,
    Math.min(MAX_ATTEMPT_ACTIVE_SECONDS, Math.floor(input.activeSeconds)),
  )
  const waivedSeconds = Math.max(
    0,
    Math.min(activeSeconds, Math.floor(input.waivedSeconds ?? 0)),
  )
  await db.transaction(async (tx) => {
    const reservations = await tx
      .select({ reservation: creditReservations, grant: creditGrants })
      .from(creditReservations)
      .innerJoin(creditGrants, eq(creditGrants.id, creditReservations.grantId))
      .where(
        and(
          eq(creditReservations.sessionId, input.sessionId),
          eq(creditReservations.attemptId, input.attemptId),
          isNull(creditReservations.settledAt),
        ),
      )
      .orderBy(asc(creditReservations.createdAt))
      .for('update')
    if (!reservations.length) return

    const allocation = allocateSettlement(
      reservations.map(({ reservation }) => reservation.reservedSeconds),
      activeSeconds,
      waivedSeconds,
    )
    for (const [index, { reservation, grant }] of reservations.entries()) {
      const { consumed, waived } = allocation[index]
      await tx
        .update(creditGrants)
        .set({
          remainingSeconds: grant.remainingSeconds - consumed,
          reservedSeconds: grant.reservedSeconds - reservation.reservedSeconds,
        })
        .where(eq(creditGrants.id, grant.id))
      await tx
        .update(creditReservations)
        .set({
          settledSeconds: consumed,
          waivedSeconds: waived,
          settledAt: new Date(),
        })
        .where(eq(creditReservations.id, reservation.id))
      if (consumed) {
        await tx
          .insert(creditLedger)
          .values({
            grantId: grant.id,
            idempotencyKey: `usage:${input.sessionId}:${input.attemptId}:${grant.id}`,
            deltaSeconds: -consumed,
            reason: 'practice_usage',
            sessionId: input.sessionId,
            attemptId: input.attemptId,
          })
          .onConflictDoNothing()
      }
    }
  })
}

export async function releasePracticeReservation(input: {
  sessionId: string
  attemptId: string
}) {
  await settlePracticeCredits({ ...input, activeSeconds: 0 })
}

type SeatAssignment = {
  workspaceId: string
  userId: string
  assignedBy: string | null
  reason: SeatAssignReason
}

// `assignedBy: null` is a system action (accepting an invitation, the first
// Business payment); otherwise only the workspace owner may assign a seat.
export async function assignWorkspaceSeat(input: SeatAssignment) {
  return db.transaction((tx) => assignSeatInTransaction(tx, input))
}

export async function assignSeatInTransaction(
  tx: DatabaseTransaction,
  input: SeatAssignment,
) {
  const workspace = (
    await tx
      .select()
      .from(workspaceSubscriptions)
      .where(
        and(
          eq(workspaceSubscriptions.workspaceId, input.workspaceId),
          eq(workspaceSubscriptions.plan, 'business'),
          eq(workspaceSubscriptions.status, 'active'),
          gt(workspaceSubscriptions.currentPeriodEnd, new Date()),
        ),
      )
      .for('update')
  ).at(0)
  if (!workspace)
    throw new Response('Gói Business chưa được kích hoạt.', { status: 409 })
  if (input.assignedBy !== null) {
    const owner = await tx.query.member.findFirst({
      where: and(
        eq(member.organizationId, input.workspaceId),
        eq(member.userId, input.assignedBy),
        eq(member.role, 'owner'),
      ),
    })
    if (!owner)
      throw new Response('Chỉ chủ sở hữu có thể cấp suất.', { status: 403 })
  }
  const target = await tx.query.member.findFirst({
    where: and(
      eq(member.organizationId, input.workspaceId),
      eq(member.userId, input.userId),
    ),
  })
  if (!target)
    throw new Response('Thành viên chưa thuộc không gian làm việc.', {
      status: 404,
    })
  const activeAssignments = await tx
    .select({ seatNumber: workspaceSeatAssignments.seatNumber })
    .from(workspaceSeatAssignments)
    .where(
      and(
        eq(workspaceSeatAssignments.workspaceId, input.workspaceId),
        isNull(workspaceSeatAssignments.revokedAt),
      ),
    )
  const activeSeatCount = activeAssignments.length
  // Descending order puts an open stint (null revokedAt) first, then the most
  // recently closed one, whose seat the member gets back when it is free.
  const latest = await tx.query.workspaceSeatAssignments.findFirst({
    where: and(
      eq(workspaceSeatAssignments.workspaceId, input.workspaceId),
      eq(workspaceSeatAssignments.userId, input.userId),
    ),
    orderBy: (assignment, { desc }) => [desc(assignment.revokedAt)],
  })
  if (latest && !latest.revokedAt) return
  const seatLimit = Math.min(
    workspace.seatQuantity,
    workspace.pendingSeatQuantity ?? workspace.seatQuantity,
  )
  if (activeSeatCount >= seatLimit)
    throw new Response('Đã sử dụng hết số suất trả phí.', { status: 409 })
  const occupiedSeats = new Set(
    activeAssignments.map((assignment) => assignment.seatNumber),
  )
  const seatNumber =
    latest &&
    latest.seatNumber <= seatLimit &&
    !occupiedSeats.has(latest.seatNumber)
      ? latest.seatNumber
      : Array.from({ length: seatLimit }, (_, index) => index + 1).find(
          (candidate) => !occupiedSeats.has(candidate),
        )
  if (!seatNumber)
    throw new Response('Không còn suất trả phí khả dụng.', { status: 409 })

  const now = new Date()
  const [{ id: assignmentId }] = await tx
    .insert(workspaceSeatAssignments)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      seatNumber,
      assignedAt: now,
      assignedByUserId: input.assignedBy,
      assignReason: input.reason,
    })
    .returning({ id: workspaceSeatAssignments.id })

  const nowPeriod = getAllowancePeriod(workspace.currentPeriodStart, now)
  const currentGrant = (
    await tx
      .select()
      .from(creditGrants)
      .where(
        and(
          eq(creditGrants.workspaceId, input.workspaceId),
          eq(creditGrants.type, 'included'),
          eq(creditGrants.seatNumber, seatNumber),
          eq(creditGrants.periodStart, nowPeriod.startsAt),
        ),
      )
      .for('update')
  ).at(0)
  if (currentGrant && currentGrant.userId !== input.userId) {
    await tx
      .update(creditGrants)
      .set({ userId: input.userId })
      .where(eq(creditGrants.id, currentGrant.id))
    await tx.insert(creditLedger).values({
      grantId: currentGrant.id,
      idempotencyKey: `seat:${assignmentId}:${randomUUID()}`,
      deltaSeconds: 0,
      reason: 'seat_reassignment',
      fromUserId: currentGrant.userId,
      toUserId: input.userId,
    })
  }
}

// `revokedBy: null` means the actor is unknown to the caller.
export async function revokeWorkspaceSeat(input: {
  workspaceId: string
  userId: string
  revokedBy: string | null
  reason: SeatRevokeReason
}) {
  await db
    .update(workspaceSeatAssignments)
    .set({
      revokedAt: new Date(),
      revokedByUserId: input.revokedBy,
      revokeReason: input.reason,
    })
    .where(
      and(
        eq(workspaceSeatAssignments.workspaceId, input.workspaceId),
        eq(workspaceSeatAssignments.userId, input.userId),
        isNull(workspaceSeatAssignments.revokedAt),
      ),
    )
}
