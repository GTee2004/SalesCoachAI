import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '#/db'
import { practiceSessions } from '#/db/schema'
import {
  abandonedOutcome,
  applyConnectionEvent,
  connectionLeaseSchema,
  expireConnectionLease,
  shouldAbandonConnection,
} from '#/lib/voice/session-lease'
import type { VoiceEvent } from '#/lib/voice/contracts'

export async function persistConnectionEvent(event: VoiceEvent) {
  return db.transaction(async (tx) => {
    const current = (
      await tx
        .select()
        .from(practiceSessions)
        .where(eq(practiceSessions.id, event.sessionId))
        .for('update')
    ).at(0)
    if (!current) return 'missing' as const
    if (current.deletedAt) return 'deleted' as const
    if (current.status !== 'in_progress') return
    const parsed = connectionLeaseSchema.safeParse(
      current.runtimeMetadata?.voiceConnection,
    )
    if (!parsed.success) return
    const next = applyConnectionEvent(parsed.data, event)
    if (next === parsed.data) return
    await tx
      .update(practiceSessions)
      .set({
        runtimeMetadata: { ...current.runtimeMetadata, voiceConnection: next },
      })
      .where(eq(practiceSessions.id, current.id))
  })
}

type LiveConnection = {
  attemptId?: string
  status: string
  activityLeaseUntil?: string | null
}

export async function reconcileVoiceSessions(
  sessionId?: string,
  lookup?: (sessionId: string) => Promise<LiveConnection | null>,
) {
  const now = Date.now()
  const candidates = await db
    .select({ id: practiceSessions.id })
    .from(practiceSessions)
    .where(
      and(
        eq(practiceSessions.status, 'in_progress'),
        isNull(practiceSessions.deletedAt),
        sessionId ? eq(practiceSessions.id, sessionId) : undefined,
        sql`${practiceSessions.runtimeMetadata}->'voiceConnection' is not null`,
        sql`coalesce(${practiceSessions.runtimeMetadata}->'voiceConnection'->>'resumeUntil', ${practiceSessions.runtimeMetadata}->'voiceConnection'->>'leaseUntil')::timestamptz <= ${new Date(now).toISOString()}::timestamptz`,
      ),
    )
    .limit(100)
  // Independent status reads share one timeout window, even when the backend
  // is unavailable and there is a backlog of expired leases.
  const observations = await Promise.allSettled(
    candidates.map((candidate) =>
      lookup ? lookup(candidate.id) : Promise.resolve(null),
    ),
  )
  for (const [index, candidate] of candidates.entries()) {
    // No DB lock is held during the status read. An ingestion outage can leave
    // a stale persisted lease while the authenticated peer remains alive.
    const observation = observations[index]
    const live = observation.status === 'fulfilled' ? observation.value : null
    await db.transaction(async (tx) => {
      // End/Start may be waiting for backend event ingestion. Skip them;
      // taking a blocking advisory lock here would deadlock that request.
      const result = await tx.execute<{ acquired: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${candidate.id}, 0)) as acquired`,
      )
      if (!result.rows[0]?.acquired) return
      const current = (
        await tx
          .select()
          .from(practiceSessions)
          .where(eq(practiceSessions.id, candidate.id))
          .for('update')
      ).at(0)
      if (!current || current.deletedAt || current.status !== 'in_progress')
        return
      const parsed = connectionLeaseSchema.safeParse(
        current.runtimeMetadata?.voiceConnection,
      )
      if (!parsed.success) return
      const currentLease = parsed.data
      const canRenew =
        live?.status === 'active' &&
        live.attemptId === currentLease.attemptId &&
        live.activityLeaseUntil != null &&
        Date.parse(live.activityLeaseUntil) > now &&
        (currentLease.status !== 'interrupted' ||
          currentLease.reason === 'connection_lease_expired')
      const lease = canRenew
        ? {
            ...currentLease,
            status: 'connected' as const,
            leaseUntil: live.activityLeaseUntil!,
            resumeUntil: undefined,
            interruptedAt: undefined,
            reason: undefined,
          }
        : expireConnectionLease(currentLease, now)
      const abandoned = shouldAbandonConnection(lease, now)
      await tx
        .update(practiceSessions)
        .set({
          runtimeMetadata: {
            ...current.runtimeMetadata,
            voiceConnection: lease,
          },
          ...(abandoned
            ? { status: 'abandoned' as const, ...abandonedOutcome(lease) }
            : {}),
        })
        .where(eq(practiceSessions.id, current.id))
    })
  }
}
