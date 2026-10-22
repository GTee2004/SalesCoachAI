import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildUsage,
  countDays,
  customRangeProblem,
  sessionOutcome,
  shiftDateKey,
  toDateKey,
  usageGranularity,
  usagePeriods,
} from './usage'

const NOW = new Date('2026-10-06T03:00:00Z')

test('days roll over at midnight in Vietnam, not UTC', () => {
  assert.equal(toDateKey(new Date('2026-10-05T16:59:59Z')), '2026-10-05')
  assert.equal(toDateKey(new Date('2026-10-05T17:00:00Z')), '2026-10-06')
})

test('the previous period has the same length and ends the day before', () => {
  assert.deepEqual(usagePeriods({ days: 7 }, NOW), {
    today: '2026-10-06',
    from: '2026-09-30',
    to: '2026-10-06',
    previousFrom: '2026-09-23',
    granularity: 'day',
  })
})

test('a picked period is compared with the equally long one before it', () => {
  assert.deepEqual(
    usagePeriods({ from: '2026-08-01', to: '2026-08-31' }, NOW),
    {
      today: '2026-10-06',
      from: '2026-08-01',
      to: '2026-08-31',
      previousFrom: '2026-07-01',
      granularity: 'day',
    },
  )
  assert.equal(
    usagePeriods({ from: '2026-10-06', to: '2026-10-06' }, NOW).previousFrom,
    '2026-10-05',
  )
  // Ten years, across three leap days.
  const decade = usagePeriods({ from: '2016-10-07', to: '2026-10-06' }, NOW)
  assert.equal(decade.granularity, 'month')
  assert.equal(
    countDays(decade.previousFrom, shiftDateKey(decade.from, -1)),
    countDays(decade.from, decade.to),
  )
})

test('a picked period must be real, ordered, past and at most ten years', () => {
  const problem = (from: string, to: string) =>
    customRangeProblem(from, to, '2026-10-06')
  assert.equal(problem('2026-09-01', '2026-10-06'), null)
  assert.equal(problem('2026-10-06', '2026-10-06'), null)
  assert.equal(problem('2016-10-07', '2026-10-06'), null)
  assert.equal(problem('', '2026-10-06'), 'incomplete')
  assert.equal(problem('2026-02-30', '2026-10-06'), 'incomplete')
  assert.equal(problem('2026-10-06', '2026-10-01'), 'reversed')
  assert.equal(problem('2026-10-01', '2026-10-07'), 'future')
  assert.equal(problem('1999-12-31', '2001-01-01'), 'too_early')
  assert.equal(problem('2016-10-05', '2026-10-06'), 'too_long')
})

test('long periods are charted by week, then by month', () => {
  assert.equal(usageGranularity(1), 'day')
  assert.equal(usageGranularity(62), 'day')
  assert.equal(usageGranularity(63), 'week')
  assert.equal(usageGranularity(365), 'week')
  assert.equal(usageGranularity(366), 'month')
})

test('a technical error wins over the session status', () => {
  assert.equal(
    sessionOutcome('abandoned', 'technical_error'),
    'technical_error',
  )
  assert.equal(sessionOutcome('completed', 'learner_ended'), 'learner_ended')
  assert.equal(sessionOutcome('completed', null), 'completed')
  assert.equal(sessionOutcome('abandoned', null), 'abandoned')
  assert.equal(sessionOutcome('in_progress', null), 'in_progress')
})

test('a call the buyer ended for silence keeps its own outcome', () => {
  assert.equal(sessionOutcome('completed', 'learner_idle'), 'learner_idle')
})

test('a lost connection is told apart from a technical error', () => {
  assert.equal(
    sessionOutcome('abandoned', 'connection_lost'),
    'connection_lost',
  )
})

const calls = (day: string, count: number) => ({
  day,
  calls: count,
  completed: count,
  technicalErrors: 0,
  scoreSum: 0,
  evaluated: 0,
})
const empty = {
  activityRows: [],
  activeUsers: { current: 0, previous: 0 },
  outcomeRows: [],
  topPractices: [],
}

test('usage fills empty days and keeps the two periods apart', () => {
  const usage = buildUsage({
    today: '2026-10-06',
    from: '2026-09-30',
    to: '2026-10-06',
    previousFrom: '2026-09-23',
    granularity: 'day',
    callRows: [
      // Previous period.
      {
        day: '2026-09-29',
        calls: 4,
        completed: 2,
        technicalErrors: 1,
        scoreSum: 120,
        evaluated: 2,
      },
      {
        day: '2026-10-01',
        calls: 10,
        completed: 7,
        technicalErrors: 1,
        scoreSum: 420,
        evaluated: 6,
      },
      {
        day: '2026-10-06',
        calls: 2,
        completed: 1,
        technicalErrors: 0,
        scoreSum: 80,
        evaluated: 1,
      },
    ],
    activityRows: [{ bucket: '2026-10-01', users: 5 }],
    activeUsers: { current: 6, previous: 3 },
    outcomeRows: [
      { status: 'completed', endReason: 'learner_ended', count: 8 },
      { status: 'abandoned', endReason: 'technical_error', count: 1 },
      { status: 'abandoned', endReason: null, count: 2 },
      { status: 'in_progress', endReason: null, count: 1 },
    ],
    topPractices: [],
  })

  assert.equal(usage.today, '2026-10-06')
  assert.deepEqual(usage.period, { from: '2026-09-30', to: '2026-10-06' })
  assert.deepEqual(usage.previousPeriod, {
    from: '2026-09-23',
    to: '2026-09-29',
  })
  assert.equal(usage.series.length, 7)
  assert.deepEqual(usage.series[0], {
    date: '2026-09-30',
    endDate: '2026-09-30',
    activeUsers: 0,
    calls: 0,
    completed: 0,
    technicalErrors: 0,
    incomplete: 0,
  })
  assert.deepEqual(usage.series[1], {
    date: '2026-10-01',
    endDate: '2026-10-01',
    activeUsers: 5,
    calls: 10,
    completed: 7,
    technicalErrors: 1,
    incomplete: 2,
  })
  assert.deepEqual(usage.current, {
    activeUsers: 6,
    calls: 12,
    completed: 8,
    technicalErrors: 1,
    evaluated: 7,
    averageScore: 500 / 7,
  })
  assert.equal(usage.previous.calls, 4)
  assert.equal(usage.previous.averageScore, 60)
  assert.deepEqual(usage.outcomes, [
    { key: 'learner_ended', count: 8 },
    { key: 'technical_error', count: 1 },
    { key: 'abandoned', count: 2 },
    { key: 'in_progress', count: 1 },
  ])
})

test('weeks run from Monday and stop at the edges of the period', () => {
  // 1 July 2026 is a Wednesday, 30 September a Wednesday too.
  const usage = buildUsage({
    ...empty,
    today: '2026-10-06',
    from: '2026-07-01',
    to: '2026-09-30',
    previousFrom: '2026-03-31',
    granularity: 'week',
    callRows: [
      calls('2026-06-30', 9),
      calls('2026-07-01', 2),
      calls('2026-07-05', 3),
      calls('2026-07-06', 1),
      calls('2026-09-30', 4),
    ],
    activityRows: [{ bucket: '2026-06-29', users: 4 }],
  })
  assert.equal(usage.series.length, 14)
  assert.deepEqual(
    usage.series
      .slice(0, 2)
      .map((week) => [week.date, week.endDate, week.calls, week.activeUsers]),
    [
      ['2026-07-01', '2026-07-05', 5, 4],
      ['2026-07-06', '2026-07-12', 1, 0],
    ],
  )
  const last = usage.series.at(-1)!
  assert.deepEqual(
    [last.date, last.endDate, last.calls],
    ['2026-09-28', '2026-09-30', 4],
  )
  // The day before the period belongs to the comparison, not to week one.
  assert.equal(usage.current.calls, 10)
  assert.equal(usage.previous.calls, 9)
})

test('months are whole calendar months except at the edges', () => {
  const usage = buildUsage({
    ...empty,
    today: '2026-10-06',
    from: '2025-01-15',
    to: '2026-10-06',
    previousFrom: '2023-04-26',
    granularity: 'month',
    callRows: [
      calls('2025-01-20', 1),
      calls('2025-01-31', 2),
      calls('2025-02-01', 5),
      calls('2026-10-06', 7),
    ],
    activityRows: [{ bucket: '2026-10-01', users: 3 }],
  })
  assert.equal(usage.series.length, 22)
  assert.deepEqual(
    usage.series
      .slice(0, 2)
      .map((month) => [month.date, month.endDate, month.calls]),
    [
      ['2025-01-15', '2025-01-31', 3],
      ['2025-02-01', '2025-02-28', 5],
    ],
  )
  const last = usage.series.at(-1)!
  assert.deepEqual(
    [last.date, last.endDate, last.calls, last.activeUsers],
    ['2026-10-01', '2026-10-06', 7, 3],
  )
})

test('a period without scored sessions has no average score', () => {
  const usage = buildUsage({
    ...empty,
    today: '2026-10-06',
    from: '2026-09-30',
    to: '2026-10-06',
    previousFrom: '2026-09-23',
    granularity: 'day',
    callRows: [],
  })
  assert.equal(usage.current.averageScore, null)
})
