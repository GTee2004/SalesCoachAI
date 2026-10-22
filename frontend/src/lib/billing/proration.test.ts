import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseSeatAdditionProductCode,
  quoteSeatAddition,
  seatAdditionProductCode,
} from './proration'

const end = new Date('2026-11-10T00:00:00Z')

test('a seat added at the start of a monthly term costs the full price', () => {
  const quote = quoteSeatAddition({
    interval: 'monthly',
    currentPeriodEnd: end,
    seatsToAdd: 1,
    now: new Date('2026-10-10T00:00:00Z'),
  })
  assert.equal(quote.remainingRatio, 1)
  assert.equal(quote.amountVnd, 499_000)
})

test('half a monthly term left costs about half, rounded up to 1,000', () => {
  // 31 days in the interval; 15.5 days left.
  const quote = quoteSeatAddition({
    interval: 'monthly',
    currentPeriodEnd: end,
    seatsToAdd: 2,
    now: new Date('2026-10-25T12:00:00Z'),
  })
  assert.equal(quote.remainingRatio, 0.5)
  assert.equal(quote.amountVnd, 499_000)
})

test('the price scales with the number of seats', () => {
  const now = new Date('2026-10-10T00:00:00Z')
  const one = quoteSeatAddition({
    interval: 'monthly',
    currentPeriodEnd: end,
    seatsToAdd: 1,
    now,
  })
  const three = quoteSeatAddition({
    interval: 'monthly',
    currentPeriodEnd: end,
    seatsToAdd: 3,
    now,
  })
  assert.equal(three.amountVnd, one.amountVnd * 3)
})

test('yearly terms are pro-rated against the whole year', () => {
  const quote = quoteSeatAddition({
    interval: 'yearly',
    currentPeriodEnd: new Date('2027-10-10T00:00:00Z'),
    seatsToAdd: 1,
    now: new Date('2027-04-10T00:00:00Z'),
  })
  // 183 of 365 days remain.
  assert.ok(quote.remainingRatio > 0.5 && quote.remainingRatio < 0.51)
  assert.equal(quote.amountVnd % 1_000, 0)
  assert.ok(quote.amountVnd > 2_400_000 && quote.amountVnd < 2_600_000)
})

test('an early renewal leaves more than one interval to pay for', () => {
  const quote = quoteSeatAddition({
    interval: 'monthly',
    currentPeriodEnd: new Date('2026-12-10T00:00:00Z'),
    seatsToAdd: 1,
    now: new Date('2026-10-10T00:00:00Z'),
  })
  assert.ok(quote.remainingRatio > 1.9)
  assert.ok(quote.amountVnd > 900_000)
})

test('the last moments of a term still cost at least 1,000', () => {
  const quote = quoteSeatAddition({
    interval: 'monthly',
    currentPeriodEnd: end,
    seatsToAdd: 1,
    now: new Date(end.getTime() - 60_000),
  })
  assert.equal(quote.amountVnd, 1_000)
})

test('invalid requests are rejected', () => {
  const base = {
    interval: 'monthly' as const,
    currentPeriodEnd: end,
    now: new Date('2026-10-10T00:00:00Z'),
  }
  assert.throws(() => quoteSeatAddition({ ...base, seatsToAdd: 0 }), RangeError)
  assert.throws(
    () => quoteSeatAddition({ ...base, seatsToAdd: 1.5 }),
    RangeError,
  )
  assert.throws(
    () => quoteSeatAddition({ ...base, seatsToAdd: 1, now: end }),
    RangeError,
  )
})

test('product codes round-trip', () => {
  assert.equal(seatAdditionProductCode('yearly'), 'business_seats_yearly')
  assert.equal(
    parseSeatAdditionProductCode('business_seats_monthly'),
    'monthly',
  )
  assert.equal(parseSeatAdditionProductCode('business_monthly'), null)
  assert.equal(parseSeatAdditionProductCode('business_seats_weekly'), null)
})
