export type BillingInterval = 'monthly' | 'yearly'
export type SubscriptionPlan = 'pro' | 'business'

// SePay accepts payments of 1,000 to 499,000,000 VND. A zero total never
// reaches SePay (a coupon settles it), so only non-zero totals are bounded.
export const SEPAY_MIN_AMOUNT_VND = 1_000
export const SEPAY_MAX_AMOUNT_VND = 499_000_000

export const BUSINESS_MIN_SEATS = 2
export const BUSINESS_MAX_SEATS = 500
export const TOPUP_PRICE_PER_MINUTE_VND = 3_000

export const topupPacks = [
  { code: 'topup_15', minutes: 15, priceVnd: 45_000 },
  { code: 'topup_75', minutes: 75, priceVnd: 225_000 },
  { code: 'topup_150', minutes: 150, priceVnd: 450_000 },
  { code: 'topup_300', minutes: 300, priceVnd: 900_000 },
] as const

export const subscriptions = {
  pro: {
    monthly: { priceVnd: 299_000, minutes: 150 },
    yearly: { priceVnd: 2_990_000, minutes: 150 },
  },
  business: {
    monthly: { priceVnd: 499_000, minutes: 300 },
    yearly: { priceVnd: 4_990_000, minutes: 300 },
  },
} as const

export type CheckoutProduct =
  | {
      type: 'subscription'
      plan: SubscriptionPlan
      interval: BillingInterval
      seatQuantity: number
      priceVnd: number
      includedMinutes: number
      productCode: string
    }
  | {
      type: 'topup'
      minutes: number
      priceVnd: number
      productCode: string
    }

export function getSubscriptionProduct(
  plan: SubscriptionPlan,
  interval: BillingInterval,
  seatQuantity = 1,
): CheckoutProduct {
  const price = subscriptions[plan][interval]
  const quantity = plan === 'business' ? seatQuantity : 1
  return {
    type: 'subscription',
    plan,
    interval,
    seatQuantity: quantity,
    priceVnd: price.priceVnd * quantity,
    includedMinutes: price.minutes,
    productCode: `${plan}_${interval}`,
  }
}

export function getTopupProduct(productCode: string): CheckoutProduct | null {
  const pack = topupPacks.find((item) => item.code === productCode)
  return pack
    ? {
        type: 'topup',
        minutes: pack.minutes,
        priceVnd: pack.priceVnd,
        productCode: pack.code,
      }
    : null
}
