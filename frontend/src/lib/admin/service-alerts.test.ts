import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ServiceCheck, ServiceState } from './contracts'
import { initialAlertState, processAlerts } from './service-alerts'

function checks(voice: ServiceState): ServiceCheck[] {
  return [
    { key: 'web', state: 'up', latencyMs: null },
    { key: 'database', state: 'up', latencyMs: 5 },
    { key: 'voice', state: voice, latencyMs: null },
  ]
}

/** Checks run 30 s apart, the first one at 12:00:00 in Vietnam. */
const at = (index: number) =>
  new Date(Date.UTC(2026, 9, 6, 5, 0, index * 30)).toISOString()

/**
 * The notices handed to delivery on each check, as "service kind@check that
 * raised it". `delivers` tells whether the email of a given check goes out.
 */
async function run(
  sequence: ServiceCheck[][],
  delivers: (index: number) => boolean = () => true,
) {
  let state = initialAlertState()
  const attempts: string[][] = []
  for (const [index, services] of sequence.entries()) {
    const attempted: string[] = []
    state = await processAlerts(state, services, at(index), (notice) => {
      const raisedAt = sequence.findIndex((_, i) => at(i) === notice.since)
      attempted.push(`${notice.service} ${notice.kind}@${raisedAt}`)
      return Promise.resolve(delivers(index))
    })
    attempts.push(attempted)
  }
  return attempts
}

test('an outage alerts once after the threshold and once on recovery', async () => {
  const notices = await run([
    checks('down'),
    checks('down'),
    checks('down'),
    checks('down'),
    checks('up'),
    checks('up'),
  ])
  assert.deepEqual(notices, [
    [],
    [],
    ['voice down@2'],
    [],
    ['voice recovered@4'],
    [],
  ])
})

test('a blip shorter than the threshold stays silent', async () => {
  const notices = await run([checks('down'), checks('down'), checks('up')])
  assert.deepEqual(notices.flat(), [])
})

test('an unknown state neither counts as a failure nor as a recovery', async () => {
  const notices = await run([
    checks('down'),
    checks('down'),
    checks('unknown'),
    checks('up'),
  ])
  assert.deepEqual(notices.flat(), [])
})

test('an outage email that could not be sent is retried until it is', async () => {
  // No admin recipient, or SMTP refusing, on the third and fourth checks.
  const notices = await run(
    Array.from({ length: 7 }, () => checks('down')),
    (index) => index >= 4,
  )
  assert.deepEqual(notices, [
    [],
    [],
    ['voice down@2'],
    ['voice down@2'],
    ['voice down@2'],
    [],
    [],
  ])
})

test('a recovery email is retried and keeps the time the service came back', async () => {
  const notices = await run(
    [
      checks('down'),
      checks('down'),
      checks('down'),
      checks('up'),
      checks('up'),
      checks('up'),
      checks('up'),
    ],
    (index) => index !== 3 && index !== 4,
  )
  assert.deepEqual(notices.slice(2), [
    ['voice down@2'],
    ['voice recovered@3'],
    ['voice recovered@3'],
    ['voice recovered@3'],
    [],
  ])
})

test('an outage that ends before its email went out sends nothing', async () => {
  const notices = await run(
    [
      checks('down'),
      checks('down'),
      checks('down'),
      checks('down'),
      checks('up'),
      checks('up'),
    ],
    (index) => index >= 4,
  )
  assert.deepEqual(notices, [
    [],
    [],
    ['voice down@2'],
    ['voice down@2'],
    [],
    [],
  ])
})

test('a relapse before the recovery email went out stays one incident', async () => {
  const notices = await run(
    [
      checks('down'),
      checks('down'),
      checks('down'),
      checks('up'),
      checks('down'),
      checks('down'),
      checks('down'),
      checks('up'),
      checks('up'),
    ],
    (index) => index !== 3,
  )
  assert.deepEqual(notices, [
    [],
    [],
    ['voice down@2'],
    ['voice recovered@3'],
    [],
    [],
    [],
    ['voice recovered@7'],
    [],
  ])
})

test('each service keeps its own undelivered notice', async () => {
  const databaseDown: ServiceCheck[] = checks('down').map((check) =>
    check.key === 'database' ? { ...check, state: 'down' } : check,
  )
  let state = initialAlertState()
  const delivered: string[] = []
  for (const index of [0, 1, 2, 3]) {
    state = await processAlerts(state, databaseDown, at(index), (notice) => {
      // Only the voice email gets through on the third check.
      const ok = index > 2 || notice.service === 'voice'
      if (ok) delivered.push(`${index}:${notice.service} ${notice.kind}`)
      return Promise.resolve(ok)
    })
  }
  assert.deepEqual(delivered, ['2:voice down', '3:database down'])
})
