import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  describeChange,
  formatBucketLong,
  formatBucketShort,
  formatClock,
  formatDayAndClock,
  formatDayLong,
  formatDayShort,
  formatDuration,
  formatPeriod,
  formatUptime,
} from './format'

test('day keys render without depending on the machine time zone', () => {
  assert.equal(formatDayShort('2026-10-06'), '6/10')
  assert.equal(formatDayLong('2026-10-06'), 'Thứ ba, 06/10')
  assert.equal(formatClock('2026-10-05T17:05:00Z'), '00:05')
  assert.equal(formatDayAndClock('2026-10-05T17:05:00Z'), '06/10 00:05')
})

test('a period shows the year only when a day is outside this year', () => {
  const today = '2026-10-06'
  assert.equal(
    formatPeriod({ from: '2026-09-09', to: '2026-10-06' }, today),
    '9/9 – 6/10',
  )
  assert.equal(
    formatPeriod({ from: '2026-10-06', to: '2026-10-06' }, today),
    '6/10',
  )
  assert.equal(
    formatPeriod({ from: '2025-12-25', to: '2026-01-07' }, today),
    '25/12/2025 – 7/1/2026',
  )
})

test('chart buckets are named after their day, week or month', () => {
  const today = '2026-10-06'
  const day = { date: '2026-10-06', endDate: '2026-10-06' }
  const week = { date: '2026-09-28', endDate: '2026-10-04' }
  const month = { date: '2025-02-01', endDate: '2025-02-28' }
  const cutMonth = { date: '2026-10-01', endDate: '2026-10-06' }
  assert.equal(formatBucketShort(day, 'day'), '6/10')
  assert.equal(formatBucketShort(week, 'week'), '28/9')
  assert.equal(formatBucketShort(month, 'month'), '2/2025')
  assert.equal(formatBucketLong(day, 'day', today), 'Thứ ba, 06/10')
  assert.equal(formatBucketLong(week, 'week', today), '28/9 – 4/10')
  assert.equal(formatBucketLong(month, 'month', today), 'Tháng 2/2025')
  assert.equal(
    formatBucketLong(cutMonth, 'month', today),
    '1/10/2026 – 6/10/2026',
  )
})

test('durations and uptime keep the two most useful units', () => {
  assert.equal(formatDuration(511), '08:31')
  assert.equal(formatDuration(3725), '1:02:05')
  assert.equal(formatUptime(6 * 86_400 + 4 * 3600 + 120), '6 ngày 4 giờ')
  assert.equal(formatUptime(3 * 3600 + 12 * 60), '3 giờ 12 phút')
  assert.equal(formatUptime(20), 'dưới 1 phút')
})

test('change is relative for counts and absolute for rates', () => {
  assert.deepEqual(describeChange(110, 100, 'percent', '%'), {
    direction: 'up',
    text: '▲ +10,0%',
  })
  assert.deepEqual(describeChange(78, 80.5, 'points', ' điểm %'), {
    direction: 'down',
    text: '▼ −2,5 điểm %',
  })
  assert.deepEqual(describeChange(5, 5, 'percent', '%'), {
    direction: 'flat',
    text: 'Không đổi',
  })
})

test('there is no change to show without a previous value', () => {
  assert.equal(describeChange(12, 0, 'percent', '%'), null)
  assert.equal(describeChange(70, null, 'points', ' điểm'), null)
})
