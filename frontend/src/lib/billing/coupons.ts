// Shared by the server (authoritative) and the billing page (preview only).

import { SEPAY_MIN_AMOUNT_VND } from './catalog'

export type CouponDiscountType = 'percent' | 'fixed'
export type CouponOrderType = 'subscription' | 'topup'

export const COUPON_ORDER_TYPES: ReadonlyArray<CouponOrderType> = [
  'subscription',
  'topup',
]

export const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/

// What a customer may learn about a code they typed.
export type PublicCoupon = {
  code: string
  name: string
  discountType: CouponDiscountType
  value: number
  // Ceiling on a percent coupon's discount in VND; null means no ceiling.
  maxDiscountVnd: number | null
  appliesTo: Array<CouponOrderType>
}

// What the admin pages see. Dates are ISO strings so they survive serialization.
export type AdminCoupon = PublicCoupon & {
  id: string
  startsAt: string | null
  expiresAt: string | null
  maxRedemptions: number | null
  maxRedemptionsPerWorkspace: number
  active: boolean
  // Orders currently holding the coupon: pending, paid or under review.
  redeemed: number
  createdAt: string
}

// One order that used a coupon, for the admin's usage list.
export type CouponRedemption = {
  id: string
  createdAt: string
  userName: string
  userEmail: string
  workspaceName: string
  invoice: string
  orderStatus: string
  amountVnd: number
  discountVnd: number
  // Whether the order still holds the coupon against its limits.
  counted: boolean
}

export type CouponStatus =
  'active' | 'disabled' | 'scheduled' | 'expired' | 'exhausted'

export function getCouponStatus(
  coupon: Pick<
    AdminCoupon,
    'active' | 'startsAt' | 'expiresAt' | 'maxRedemptions' | 'redeemed'
  >,
  now: Date,
): CouponStatus {
  if (!coupon.active) return 'disabled'
  if (coupon.startsAt && new Date(coupon.startsAt) > now) return 'scheduled'
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) return 'expired'
  if (
    coupon.maxRedemptions !== null &&
    coupon.redeemed >= coupon.maxRedemptions
  )
    return 'exhausted'
  return 'active'
}

export function normalizeCouponCode(value: string) {
  return value.trim().toUpperCase()
}

export function isCouponOrderType(value: string): value is CouponOrderType {
  return (COUPON_ORDER_TYPES as ReadonlyArray<string>).includes(value)
}

// A percent coupon's discount is limited by its ceiling, and no discount
// exceeds the order, so a large fixed coupon or a 100%
// coupon yields a zero total and nothing is carried over as credit. A total
// below SePay's minimum cannot be paid, so such a discount is trimmed to leave
// the minimum; only an exact zero skips payment.
export function applyDiscount(
  coupon: Pick<PublicCoupon, 'discountType' | 'value' | 'maxDiscountVnd'>,
  subtotalVnd: number,
) {
  const raw =
    coupon.discountType === 'percent'
      ? Math.min(
          Math.floor((subtotalVnd * coupon.value) / 100),
          coupon.maxDiscountVnd ?? Infinity,
        )
      : coupon.value
  const capped = Math.max(0, Math.min(subtotalVnd, raw))
  const remaining = subtotalVnd - capped
  const totalVnd =
    remaining > 0 && remaining < SEPAY_MIN_AMOUNT_VND
      ? Math.min(SEPAY_MIN_AMOUNT_VND, subtotalVnd)
      : remaining
  return { discountVnd: subtotalVnd - totalVnd, totalVnd }
}

export function describeCouponValue(
  coupon: Pick<PublicCoupon, 'discountType' | 'value' | 'maxDiscountVnd'>,
) {
  const money = new Intl.NumberFormat('vi-VN')
  if (coupon.discountType === 'fixed')
    return `Giảm ${money.format(coupon.value)} ₫`
  return coupon.maxDiscountVnd === null
    ? `Giảm ${coupon.value}%`
    : `Giảm ${coupon.value}% (tối đa ${money.format(coupon.maxDiscountVnd)} ₫)`
}
