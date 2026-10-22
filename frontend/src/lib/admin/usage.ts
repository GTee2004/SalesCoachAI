import { ADMIN_RANGE_MAX_DAYS, ADMIN_RANGE_MIN_DATE } from './contracts'
import type {
  AdminUsage,
  AdminUsageRange,
  PracticeUsage,
  SessionOutcomeKey,
  UsageBucket,
  UsageGranularity,
  UsagePeriod,
  UsageTotals,
} from './contracts'

/** Days are bucketed for the Vietnamese market, not for the server's clock. */
export const APP_TIME_ZONE = 'Asia/Ho_Chi_Minh'

const dateKeyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Calendar day of `instant` in the app time zone, as YYYY-MM-DD. */
export function toDateKey(instant: Date) {
  return dateKeyFormat.format(instant)
}

export function shiftDateKey(key: string, days: number) {
  const shifted = new Date(`${key}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

/** A real calendar day written as YYYY-MM-DD. */
export function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

/** Days from `from` to `to`, both included. */
export function countDays(from: string, to: string) {
  const span = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(span / 86_400_000) + 1
}

export type RangeProblem =
  'incomplete' | 'reversed' | 'future' | 'too_early' | 'too_long'

/** Why a picked period cannot be shown; null when it can. */
export function customRangeProblem(
  from: string,
  to: string,
  today: string,
): RangeProblem | null {
  if (!isDateKey(from) || !isDateKey(to)) return 'incomplete'
  if (from > to) return 'reversed'
  if (to > today) return 'future'
  if (from < ADMIN_RANGE_MIN_DATE) return 'too_early'
  return countDays(from, to) > ADMIN_RANGE_MAX_DAYS ? 'too_long' : null
}

/** The days a range covers when today is `today`. */
export function resolveRange(
  range: AdminUsageRange,
  today: string,
): UsagePeriod {
  return 'days' in range
    ? { from: shiftDateKey(today, -(range.days - 1)), to: today }
    : { from: range.from, to: range.to }
}

/** Up to two months by day, up to a year by week, anything longer by month. */
export function usageGranularity(days: number): UsageGranularity {
  if (days <= 62) return 'day'
  return days <= 365 ? 'week' : 'month'
}

/** First day of the day, week (from Monday) or month that `key` falls in. */
export function bucketStart(key: string, granularity: UsageGranularity) {
  if (granularity === 'day') return key
  if (granularity === 'month') return `${key.slice(0, 7)}-01`
  const weekday = new Date(`${key}T00:00:00Z`).getUTCDay()
  return shiftDateKey(key, -((weekday + 6) % 7))
}

function nextBucketStart(start: string, granularity: UsageGranularity) {
  if (granularity !== 'month')
    return shiftDateKey(start, granularity === 'week' ? 7 : 1)
  const next = new Date(`${start}T00:00:00Z`)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return next.toISOString().slice(0, 10)
}

/** The day, week or month buckets of a period, clipped to its edges. */
export function periodBuckets(
  from: string,
  to: string,
  granularity: UsageGranularity,
) {
  const buckets: Array<{ start: string; date: string; endDate: string }> = []
  for (
    let start = bucketStart(from, granularity);
    start <= to;
    start = nextBucketStart(start, granularity)
  ) {
    const last = shiftDateKey(nextBucketStart(start, granularity), -1)
    buckets.push({
      start,
      date: start < from ? from : start,
      endDate: last > to ? to : last,
    })
  }
  return buckets
}

/**
 * Inclusive day keys of a range, the start of the equally long period before
 * it, and how its chart is bucketed.
 */
export function usagePeriods(range: AdminUsageRange, now: Date) {
  const today = toDateKey(now)
  const { from, to } = resolveRange(range, today)
  const days = countDays(from, to)
  return {
    today,
    from,
    to,
    previousFrom: shiftDateKey(from, -days),
    granularity: usageGranularity(days),
  }
}

export function sessionOutcome(
  status: string,
  endReason: string | null,
): SessionOutcomeKey {
  if (endReason === 'technical_error') return 'technical_error'
  if (endReason === 'connection_lost') return 'connection_lost'
  if (status === 'completed') {
    return endReason === 'learner_ended' ||
      endReason === 'buyer_hung_up' ||
      endReason === 'time_limit' ||
      endReason === 'learner_idle'
      ? endReason
      : 'completed'
  }
  return status === 'abandoned' ? 'abandoned' : 'in_progress'
}

export interface DailyCallRow {
  day: string
  calls: number
  completed: number
  technicalErrors: number
  scoreSum: number
  evaluated: number
}

/**
 * Fills buckets without rows and splits the totals into the two periods.
 * Calls add up from days. Active users are different people, so their rows
 * must already be counted per bucket.
 */
export function buildUsage(input: {
  today: string
  from: string
  to: string
  previousFrom: string
  granularity: UsageGranularity
  /** One row per day with calls, across both periods. */
  callRows: DailyCallRow[]
  /** One row per bucket of the current period, keyed by `bucketStart`. */
  activityRows: Array<{ bucket: string; users: number }>
  activeUsers: { current: number; previous: number }
  outcomeRows: Array<{
    status: string
    endReason: string | null
    count: number
  }>
  topPractices: PracticeUsage[]
}): AdminUsage {
  const { from, to, granularity } = input
  const activity = new Map(input.activityRows.map((row) => [row.bucket, row]))
  const buckets = new Map<string, UsageBucket>()
  for (const { start, date, endDate } of periodBuckets(from, to, granularity)) {
    buckets.set(start, {
      date,
      endDate,
      activeUsers: activity.get(start)?.users ?? 0,
      calls: 0,
      completed: 0,
      technicalErrors: 0,
      incomplete: 0,
    })
  }
  const currentRows = input.callRows.filter(
    (row) => row.day >= from && row.day <= to,
  )
  for (const row of currentRows) {
    const bucket = buckets.get(bucketStart(row.day, granularity))!
    bucket.calls += row.calls
    bucket.completed += row.completed
    bucket.technicalErrors += row.technicalErrors
    bucket.incomplete = bucket.calls - bucket.completed - bucket.technicalErrors
  }

  const totals = (rows: DailyCallRow[], activeUsers: number): UsageTotals => {
    const sum = (pick: (row: DailyCallRow) => number) =>
      rows.reduce((total, row) => total + pick(row), 0)
    const evaluated = sum((row) => row.evaluated)
    return {
      activeUsers,
      calls: sum((row) => row.calls),
      completed: sum((row) => row.completed),
      technicalErrors: sum((row) => row.technicalErrors),
      evaluated,
      averageScore: evaluated ? sum((row) => row.scoreSum) / evaluated : null,
    }
  }

  const outcomes = new Map<SessionOutcomeKey, number>()
  for (const row of input.outcomeRows) {
    const key = sessionOutcome(row.status, row.endReason)
    outcomes.set(key, (outcomes.get(key) ?? 0) + row.count)
  }

  return {
    today: input.today,
    period: { from, to },
    previousPeriod: { from: input.previousFrom, to: shiftDateKey(from, -1) },
    granularity,
    series: [...buckets.values()],
    current: totals(currentRows, input.activeUsers.current),
    previous: totals(
      input.callRows.filter((row) => row.day < from),
      input.activeUsers.previous,
    ),
    outcomes: [...outcomes].map(([key, count]) => ({ key, count })),
    topPractices: input.topPractices,
  }
}
