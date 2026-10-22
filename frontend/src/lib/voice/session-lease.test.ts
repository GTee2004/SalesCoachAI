import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  abandonedOutcome,
  applyConnectionEvent,
  expireConnectionLease,
  shouldAbandonConnection,
} from './session-lease'
import type { ConnectionLease } from './session-lease'
import type { VoiceEvent } from './contracts'

const now = Date.parse('2026-10-03T10:00:00Z')
const attemptId = '00000000-0000-4000-8000-000000000001'
function lease(): ConnectionLease {
  return {
    attemptId,
    status: 'connecting',
    leaseUntil: new Date(now + 120_000).toISOString(),
    sequence: 0,
    reconnectSeconds: 60,
  }
}
function event(
  payload: VoiceEvent['payload'],
  overrides: Partial<VoiceEvent> = {},
): VoiceEvent {
  return {
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    attemptId,
    sequence: 1,
    type: 'session.state',
    occurredAt: new Date(now).toISOString(),
    payload,
    ...overrides,
  }
}

test('browser loss saves a grace deadline, and duplicate or late events cannot extend it', () => {
  const lost = event({ status: 'ended', reason: 'client_disconnected' })
  const interrupted = applyConnectionEvent(lease(), lost)
  assert.equal(interrupted.status, 'interrupted')
  assert.equal(shouldAbandonConnection(interrupted, now + 59_999), false)
  assert.equal(shouldAbandonConnection(interrupted, now + 60_000), true)
  assert.strictEqual(
    applyConnectionEvent(interrupted, {
      ...lost,
      sequence: 2,
      occurredAt: new Date(now + 50_000).toISOString(),
    }),
    interrupted,
  )
  assert.strictEqual(
    applyConnectionEvent(
      interrupted,
      event(
        { leaseUntil: new Date(now + 300_000).toISOString() },
        { type: 'session.lease', sequence: 3 },
      ),
    ),
    interrupted,
  )
})

test('restart reconciliation uses persisted deadlines, including downtime longer than grace', () => {
  const pending = lease()
  assert.strictEqual(expireConnectionLease(pending, now + 119_999), pending)
  const expired = expireConnectionLease(pending, now + 120_000)
  assert.equal(expired.resumeUntil, new Date(now + 180_000).toISOString())
  assert.equal(shouldAbandonConnection(expired, now + 120_000), false)
  assert.equal(
    shouldAbandonConnection(
      expireConnectionLease(pending, now + 600_000),
      now + 600_000,
    ),
    true,
  )
})

test('renewals survive silence during speech, and reordered heartbeats cannot shorten leases', () => {
  const connected = applyConnectionEvent(
    lease(),
    event(
      { leaseUntil: new Date(now + 40_000).toISOString() },
      { type: 'session.lease', sequence: 10 },
    ),
  )
  assert.equal(connected.status, 'connected')
  assert.strictEqual(expireConnectionLease(connected, now + 39_999), connected)
  assert.strictEqual(
    applyConnectionEvent(
      connected,
      event(
        { leaseUntil: new Date(now + 10_000).toISOString() },
        { type: 'session.lease', sequence: 9 },
      ),
    ),
    connected,
  )
})

test('old attempts cannot change new attempts or persist unbound lifecycle messages', () => {
  const current = lease()
  for (const aid of [undefined, null, crypto.randomUUID()]) {
    assert.strictEqual(
      applyConnectionEvent(
        current,
        event({ status: 'failed' }, { attemptId: aid }),
      ),
      current,
    )
  }
})

test('explicit End and replacement leave completion to the application', () => {
  const current = lease()
  for (const reason of ['user_ended', 'reconnected', 'start_state_changed']) {
    assert.strictEqual(
      applyConnectionEvent(current, event({ status: 'ended', reason })),
      current,
    )
  }
})

test('a learner-side loss is recorded as a lost connection at the time it happened', () => {
  for (const reason of ['client_disconnected', 'heartbeat_timeout']) {
    const lost = applyConnectionEvent(
      lease(),
      event({ status: 'ended', reason, reconnectSeconds: 60 }),
    )
    assert.deepEqual(abandonedOutcome(lost), {
      endReason: 'connection_lost',
      completedAt: new Date(now),
    })
  }
})

test('service failures and an expired lease stay technical errors', () => {
  const failed = applyConnectionEvent(
    lease(),
    event({ status: 'failed', reason: 'provider_failed:tts:connectivity' }),
  )
  assert.equal(abandonedOutcome(failed).endReason, 'technical_error')
  const expired = expireConnectionLease(lease(), now + 200_000)
  assert.deepEqual(abandonedOutcome(expired), {
    endReason: 'technical_error',
    completedAt: new Date(now + 120_000),
  })
})

test('a lease saved before interruptedAt dates the loss from its grace deadline', () => {
  const saved = {
    ...lease(),
    status: 'interrupted' as const,
    reason: 'client_disconnected',
    resumeUntil: new Date(now + 60_000).toISOString(),
  }
  assert.deepEqual(abandonedOutcome(saved).completedAt, new Date(now))
})
