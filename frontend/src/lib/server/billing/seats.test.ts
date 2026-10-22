import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeSeatAvailability } from './seats'

const base = {
  subscriptionActive: true,
  seatQuantity: 5,
  pendingSeatQuantity: null,
  used: 2,
  pendingInvitations: 1,
}

test('pending invitations hold a seat', () => {
  assert.deepEqual(computeSeatAvailability(base), {
    active: true,
    limit: 5,
    used: 2,
    pendingInvitations: 1,
    free: 2,
  })
})

test('a seat scheduled to disappear next period is never offered', () => {
  const seats = computeSeatAvailability({ ...base, pendingSeatQuantity: 3 })
  assert.equal(seats.limit, 3)
  assert.equal(seats.free, 0)
})

test('a larger pending quantity does not raise the current limit', () => {
  assert.equal(
    computeSeatAvailability({ ...base, pendingSeatQuantity: 9 }).limit,
    5,
  )
})

test('free seats never go negative when seats are over-committed', () => {
  const seats = computeSeatAvailability({
    ...base,
    used: 5,
    pendingInvitations: 2,
  })
  assert.equal(seats.free, 0)
})

test('without a live subscription there is nothing to invite into', () => {
  const seats = computeSeatAvailability({ ...base, subscriptionActive: false })
  assert.equal(seats.active, false)
  assert.equal(seats.limit, 0)
  assert.equal(seats.free, 0)
})
