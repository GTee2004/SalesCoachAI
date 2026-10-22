import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  COUPON_CODE_PATTERN,
  applyDiscount,
  normalizeCouponCode,
} from './coupons'

test('a percent coupon rounds the discount down to whole dong', () => {
  assert.deepEqual(
    applyDiscount(
      { discountType: 'percent', value: 20, maxDiscountVnd: null },
      299_000,
    ),
    { discountVnd: 59_800, totalVnd: 239_200 },
  )
  assert.deepEqual(
    applyDiscount(
      { discountType: 'percent', value: 33, maxDiscountVnd: null },
      45_001,
    ),
    {
      discountVnd: 14_850,
      totalVnd: 30_151,
    },
  )
})

test('a fixed coupon takes a flat amount off', () => {
  assert.deepEqual(
    applyDiscount(
      { discountType: 'fixed', value: 50_000, maxDiscountVnd: null },
      299_000,
    ),
    { discountVnd: 50_000, totalVnd: 249_000 },
  )
})

test('100% off brings the order to zero', () => {
  assert.deepEqual(
    applyDiscount(
      { discountType: 'percent', value: 100, maxDiscountVnd: null },
      4_990_000,
    ),
    { discountVnd: 4_990_000, totalVnd: 0 },
  )
})

test('a fixed coupon larger than the order is capped and never goes negative', () => {
  assert.deepEqual(
    applyDiscount(
      { discountType: 'fixed', value: 500_000, maxDiscountVnd: null },
      45_000,
    ),
    { discountVnd: 45_000, totalVnd: 0 },
  )
})

test('codes are matched case- and space-insensitively', () => {
  assert.equal(normalizeCouponCode('  welcome-20 '), 'WELCOME-20')
  assert.ok(COUPON_CODE_PATTERN.test('WELCOME-20'))
  assert.ok(!COUPON_CODE_PATTERN.test('AB'))
  assert.ok(!COUPON_CODE_PATTERN.test('has space'))
  assert.ok(!COUPON_CODE_PATTERN.test('-LEADING'))
})

test('a discount never leaves less than the 1,000 dong SePay minimum', () => {
  assert.deepEqual(
    applyDiscount(
      { discountType: 'fixed', value: 44_500, maxDiscountVnd: null },
      45_000,
    ),
    { discountVnd: 44_000, totalVnd: 1_000 },
  )
  assert.deepEqual(
    applyDiscount(
      { discountType: 'fixed', value: 44_000, maxDiscountVnd: null },
      45_000,
    ),
    { discountVnd: 44_000, totalVnd: 1_000 },
  )
  // Exactly zero is still free, and the minimum itself is allowed.
  assert.equal(
    applyDiscount(
      { discountType: 'fixed', value: 45_000, maxDiscountVnd: null },
      45_000,
    ).totalVnd,
    0,
  )
  assert.equal(
    applyDiscount(
      { discountType: 'percent', value: 99, maxDiscountVnd: null },
      45_000,
    ).totalVnd,
    1_000,
  )
})

test('a percent coupon stops at its maximum discount', () => {
  const coupon = {
    discountType: 'percent',
    value: 20,
    maxDiscountVnd: 200_000,
  } as const
  assert.deepEqual(applyDiscount(coupon, 299_000), {
    discountVnd: 59_800,
    totalVnd: 239_200,
  })
  assert.deepEqual(applyDiscount(coupon, 4_990_000), {
    discountVnd: 200_000,
    totalVnd: 4_790_000,
  })
})

test('100% off with a ceiling is free only up to the ceiling', () => {
  const coupon = {
    discountType: 'percent',
    value: 100,
    maxDiscountVnd: 300_000,
  } as const
  assert.equal(applyDiscount(coupon, 299_000).totalVnd, 0)
  assert.equal(applyDiscount(coupon, 499_000).totalVnd, 199_000)
  // A ceiling leaving under SePay's minimum is still trimmed to the minimum.
  assert.deepEqual(applyDiscount(coupon, 300_500), {
    discountVnd: 299_500,
    totalVnd: 1_000,
  })
})
