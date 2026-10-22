import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { currentUserQueryOptions } from './authQueries'

// The root route reads the identity on every navigation; the server function
// behind it is what records the day's visit.
function visitor(t: TestContext, start: string) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(start) })
  const serverCalls: string[] = []
  const options = {
    ...currentUserQueryOptions,
    queryFn: () => {
      serverCalls.push(new Date().toISOString())
      return Promise.resolve(null)
    },
  }
  const client = new QueryClient()
  return {
    serverCalls,
    navigate: () => client.query(options),
    wait: (minutes: number) => t.mock.timers.tick(minutes * 60_000),
  }
}

test('the first navigation of a new Vietnamese day reaches the server', async (t) => {
  // 23:58 on 6 October in Vietnam.
  const visit = visitor(t, '2026-10-06T16:58:00Z')
  await visit.navigate()
  visit.wait(3)
  await visit.navigate()
  visit.wait(1)
  await visit.navigate()
  assert.deepEqual(visit.serverCalls, [
    '2026-10-06T16:58:00.000Z',
    '2026-10-06T17:01:00.000Z',
  ])
})

test('within a day the identity stays cached for five minutes', async (t) => {
  // Midnight UTC is 07:00 in Vietnam and must not count as a new day.
  const visit = visitor(t, '2026-10-06T23:58:00Z')
  await visit.navigate()
  visit.wait(3)
  await visit.navigate()
  visit.wait(1.5)
  await visit.navigate()
  assert.equal(visit.serverCalls.length, 1)
  visit.wait(1)
  await visit.navigate()
  assert.deepEqual(visit.serverCalls, [
    '2026-10-06T23:58:00.000Z',
    '2026-10-07T00:03:30.000Z',
  ])
})
