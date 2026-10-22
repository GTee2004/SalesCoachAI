import { monthAfter } from '#/lib/server/billing/periods'
import { subscriptions } from './catalog'
import type { BillingInterval } from './catalog'

export type SeatAdditionQuote = {
  seatsToAdd: number
  unitPriceVnd: number
  // Share of one billing interval still left, 1 meaning a whole interval.
  remainingRatio: number
  amountVnd: number
}

const ROUNDING_VND = 1_000

// Extra seats are paid for the time left in the term that is already paid, so
// they expire with the existing seats. A term can span more than one interval
// after an early renewal, which is why the ratio may exceed 1. Rounding up to
// a whole thousand keeps tiny odd amounts out of checkout.
export function quoteSeatAddition(input: {
  interval: BillingInterval
  currentPeriodEnd: Date
  seatsToAdd: number
  now: Date
}): SeatAdditionQuote {
  if (!Number.isInteger(input.seatsToAdd) || input.seatsToAdd < 1)
    throw new RangeError('seatsToAdd must be a positive integer')
  const remainingMs = input.currentPeriodEnd.getTime() - input.now.getTime()
  if (remainingMs <= 0) throw new RangeError('The current period has ended')

  const intervalStart = monthAfter(
    input.currentPeriodEnd,
    input.interval === 'yearly' ? -12 : -1,
  )
  const intervalMs = input.currentPeriodEnd.getTime() - intervalStart.getTime()
  const remainingRatio = remainingMs / intervalMs
  const unitPriceVnd = subscriptions.business[input.interval].priceVnd
  return {
    seatsToAdd: input.seatsToAdd,
    unitPriceVnd,
    remainingRatio,
    amountVnd:
      Math.ceil(
        (unitPriceVnd * input.seatsToAdd * remainingRatio) / ROUNDING_VND,
      ) * ROUNDING_VND,
  }
}

export function seatAdditionProductCode(interval: BillingInterval) {
  return `business_seats_${interval}`
}

export function parseSeatAdditionProductCode(
  code: string,
): BillingInterval | null {
  const match = /^business_seats_(monthly|yearly)$/.exec(code)
  return match ? (match[1] as BillingInterval) : null
}
