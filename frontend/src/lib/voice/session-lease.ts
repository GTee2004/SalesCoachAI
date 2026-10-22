import { z } from 'zod'
import type { SessionEndReason } from '#/db/schema'
import type { VoiceEvent } from './contracts'

export const connectionLeaseSchema = z.object({
  attemptId: z.string().uuid(),
  status: z.enum(['connecting', 'connected', 'interrupted']),
  leaseUntil: z.string().datetime({ offset: true }),
  resumeUntil: z.string().datetime({ offset: true }).optional(),
  /** When the connection was found lost; leases saved before it lack it. */
  interruptedAt: z.string().datetime({ offset: true }).optional(),
  reason: z.string().optional(),
  sequence: z.number().int().nonnegative().default(0),
  reconnectSeconds: z.number().positive().max(300).default(60),
})
export type ConnectionLease = z.infer<typeof connectionLeaseSchema>

export function applyConnectionEvent(
  lease: ConnectionLease,
  event: VoiceEvent,
): ConnectionLease {
  if (event.attemptId !== lease.attemptId || event.sequence <= lease.sequence)
    return lease
  if (lease.status === 'interrupted') return lease
  if (event.type === 'session.lease') {
    const until = z
      .string()
      .datetime({ offset: true })
      .safeParse(event.payload.leaseUntil)
    if (!until.success) return lease
    return {
      ...lease,
      status: 'connected',
      leaseUntil: until.data,
      sequence: event.sequence,
    }
  }
  if (event.type !== 'session.state') return lease
  if (event.payload.status === 'active')
    return { ...lease, sequence: event.sequence }
  if (!['ended', 'failed'].includes(String(event.payload.status))) return lease
  // Explicit End owns completion and scoring. Its HTTP handler holds the
  // operation lock while the backend flushes events, so ingestion never waits
  // for that lock or calls End recursively.
  if (
    ['user_ended', 'reconnected', 'start_state_changed'].includes(
      String(event.payload.reason),
    )
  )
    return lease
  const grace = z
    .number()
    .positive()
    .max(300)
    .safeParse(event.payload.reconnectSeconds)
  const seconds = grace.success ? grace.data : lease.reconnectSeconds
  return {
    ...lease,
    status: 'interrupted',
    sequence: event.sequence,
    reason: String(event.payload.reason ?? 'connection_lost'),
    interruptedAt: event.occurredAt,
    resumeUntil: new Date(
      Date.parse(event.occurredAt) + seconds * 1000,
    ).toISOString(),
  }
}

export function expireConnectionLease(
  lease: ConnectionLease,
  now: number,
): ConnectionLease {
  if (lease.status === 'interrupted' || Date.parse(lease.leaseUntil) > now)
    return lease
  return {
    ...lease,
    status: 'interrupted',
    reason: 'connection_lease_expired',
    interruptedAt: lease.leaseUntil,
    // Use the persisted deadline, so downtime cannot extend the grace period.
    resumeUntil: new Date(
      Date.parse(lease.leaseUntil) + lease.reconnectSeconds * 1000,
    ).toISOString(),
  }
}

export function shouldAbandonConnection(
  lease: ConnectionLease,
  now: number,
): boolean {
  return (
    lease.status === 'interrupted' &&
    lease.resumeUntil !== undefined &&
    Date.parse(lease.resumeUntil) <= now
  )
}

/**
 * The learner's side went away: the browser closed, went offline or slept.
 * A lease that expires without a reported loss means the voice backend stopped
 * reporting, so it stays a technical error like every other reason.
 */
const learnerSideReasons = new Set(['client_disconnected', 'heartbeat_timeout'])

/** How an interrupted practice whose grace ran out is recorded. */
export function abandonedOutcome(lease: ConnectionLease): {
  endReason: Extract<SessionEndReason, 'connection_lost' | 'technical_error'>
  completedAt: Date
} {
  const lostAt = lease.interruptedAt
    ? Date.parse(lease.interruptedAt)
    : Date.parse(lease.resumeUntil ?? lease.leaseUntil) -
      lease.reconnectSeconds * 1000
  return {
    endReason: learnerSideReasons.has(lease.reason ?? '')
      ? 'connection_lost'
      : 'technical_error',
    // When the call stopped, not when grace ran out or cleanup noticed.
    completedAt: new Date(lostAt),
  }
}
