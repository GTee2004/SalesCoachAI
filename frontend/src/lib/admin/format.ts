import type { UsageBucket, UsageGranularity, UsagePeriod } from './contracts'
import { APP_TIME_ZONE } from './usage'

type UsagePeriodBucket = Pick<UsageBucket, 'date' | 'endDate'>

// Locale and time zone are always explicit so the server render and the
// browser produce the same text.
const count = new Intl.NumberFormat('vi-VN')
const decimal = new Intl.NumberFormat('vi-VN', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const clock = new Intl.DateTimeFormat('vi-VN', {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const clockWithSeconds = new Intl.DateTimeFormat('vi-VN', {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
const dayAndClock = new Intl.DateTimeFormat('vi-VN', {
  timeZone: APP_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const WEEKDAYS = [
  'Chủ nhật',
  'Thứ hai',
  'Thứ ba',
  'Thứ tư',
  'Thứ năm',
  'Thứ sáu',
  'Thứ bảy',
]

// Spend runs from fractions of a cent per call to dollars per month.
const usd = [2, 3, 4].map(
  (digits) =>
    new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }),
)

export const formatCount = (value: number) => count.format(value)

/** "12,34 US$"; small amounts keep enough digits to tell them apart. */
export function formatUsd(value: number) {
  const magnitude = Math.abs(value)
  const format =
    magnitude === 0 || magnitude >= 1
      ? usd[0]
      : magnitude >= 0.01
        ? usd[1]
        : usd[2]
  return format.format(value)
}

/** "1,2 triệu", "45,6 nghìn", or the count itself under a thousand. */
export function formatCompact(value: number) {
  if (value >= 1e6) return `${formatDecimal(value / 1e6)} triệu`
  if (value >= 1e3) return `${formatDecimal(value / 1e3)} nghìn`
  return formatCount(Math.round(value))
}
export const formatDecimal = (value: number) => decimal.format(value)
export const formatClock = (iso: string) => clock.format(new Date(iso))
export const formatClockWithSeconds = (iso: string) =>
  clockWithSeconds.format(new Date(iso))

/** "06/10 14:30"; the locale's own order puts the time first. */
export function formatDayAndClock(iso: string) {
  const parts = Object.fromEntries(
    dayAndClock
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  )
  return `${parts.day}/${parts.month} ${parts.hour}:${parts.minute}`
}

/** "6/10" from a YYYY-MM-DD key. */
export function formatDayShort(dateKey: string) {
  const [, month, day] = dateKey.split('-')
  return `${Number(day)}/${Number(month)}`
}

/** "Thứ ba, 06/10" from a YYYY-MM-DD key. */
export function formatDayLong(dateKey: string) {
  const [, month, day] = dateKey.split('-')
  const weekday = WEEKDAYS[new Date(`${dateKey}T00:00:00Z`).getUTCDay()]
  return `${weekday}, ${day}/${month}`
}

/**
 * "9/9 – 8/10", or "9/9/2025 – 8/10/2026" once a day falls outside the year
 * of `today`, where the short form would be ambiguous. One day is "8/10".
 */
export function formatPeriod(period: UsagePeriod, today: string) {
  const year = today.slice(0, 4)
  const withYear = !period.from.startsWith(year) || !period.to.startsWith(year)
  const day = (dateKey: string) =>
    withYear
      ? `${formatDayShort(dateKey)}/${dateKey.slice(0, 4)}`
      : formatDayShort(dateKey)
  return period.from === period.to
    ? day(period.from)
    : `${day(period.from)} – ${day(period.to)}`
}

/** Axis label of a chart bucket: "9/9" for a day or week, "9/2026" for a month. */
export function formatBucketShort(
  bucket: UsagePeriodBucket,
  granularity: UsageGranularity,
) {
  if (granularity !== 'month') return formatDayShort(bucket.date)
  const [year, month] = bucket.date.split('-')
  return `${Number(month)}/${year}`
}

/**
 * Full name of a chart bucket: "Thứ ba, 06/10", "5/10 – 11/10" or
 * "Tháng 9/2026". A month cut short by the period shows its days instead.
 */
export function formatBucketLong(
  bucket: UsagePeriodBucket,
  granularity: UsageGranularity,
  today: string,
) {
  if (granularity === 'day') return formatDayLong(bucket.date)
  const period = { from: bucket.date, to: bucket.endDate }
  if (granularity === 'week') return formatPeriod(period, today)
  const [year, month] = bucket.date.split('-')
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0))
  const wholeMonth =
    bucket.date.endsWith('-01') &&
    bucket.endDate === lastDay.toISOString().slice(0, 10)
  return wholeMonth
    ? `Tháng ${Number(month)}/${year}`
    : `${formatDayShort(period.from)}/${year} – ${formatDayShort(period.to)}/${year}`
}

/** "850 ms" under a second, "1,2 giây" from there on. */
export function formatLatency(ms: number) {
  const rounded = Math.round(ms)
  return rounded < 1000
    ? `${formatCount(rounded)} ms`
    : `${formatDecimal(rounded / 1000)} giây`
}

/** "08:31" for a call, "1:02:05" once it passes an hour. */
export function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${String(minutes).padStart(2, '0')}:${seconds}`
}

/** The two largest units: "6 ngày 4 giờ", "3 giờ 12 phút", "5 phút". */
export function formatUptime(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (days) return `${days} ngày ${hours} giờ`
  if (hours) return `${hours} giờ ${minutes} phút`
  return minutes ? `${minutes} phút` : 'dưới 1 phút'
}

export interface Change {
  direction: 'up' | 'down' | 'flat'
  text: string
}

/**
 * Change against the previous period: relative for counts, absolute for values
 * that are already a rate or a score. Null when there is nothing to compare.
 */
export function describeChange(
  current: number | null,
  previous: number | null,
  mode: 'percent' | 'points',
  unit: string,
): Change | null {
  if (current == null || previous == null) return null
  if (mode === 'percent' && previous === 0) return null
  const difference =
    mode === 'percent'
      ? ((current - previous) / previous) * 100
      : current - previous
  if (Math.abs(difference) < 0.05)
    return { direction: 'flat', text: 'Không đổi' }
  const up = difference > 0
  return {
    direction: up ? 'up' : 'down',
    text: `${up ? '▲ +' : '▼ −'}${formatDecimal(Math.abs(difference))}${unit}`,
  }
}
