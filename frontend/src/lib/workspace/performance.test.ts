import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildTeamPerformance,
  buildTrend,
  classifyMember,
  emptyWindow,
  resolveTeamRange,
  teamPeriodRange,
  teamRangeProblem,
} from './performance'
import type { TeamMemberRow, TeamWindowTotals } from './performance'

const now = new Date('2026-10-10T05:00:00Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000)

const window = (
  sessions: number,
  average: number | null,
): TeamWindowTotals => ({
  sessions,
  scored: average === null ? 0 : sessions,
  scoreSum: average === null ? 0 : average * sessions,
  objectiveAssessed: sessions,
  objectiveAchieved: Math.floor(sessions / 2),
})

const row = (overrides: Partial<TeamMemberRow> & { userId: string }) =>
  ({
    memberId: `m-${overrides.userId}`,
    name: overrides.userId,
    email: `${overrides.userId}@example.com`,
    role: 'member',
    joinedAt: daysAgo(200),
    current: emptyWindow,
    previous: emptyWindow,
    lastPracticedAt: null,
    lastActiveDate: null,
    mastery: {},
    masteryEvidence: {},
    recentSessions: [],
    ...overrides,
  }) satisfies TeamMemberRow

test('period windows are equal length and do not overlap', () => {
  assert.deepEqual(teamPeriodRange('7d', '2026-10-10'), {
    from: '2026-10-04',
    to: '2026-10-10',
    previousFrom: '2026-09-27',
    previousTo: '2026-10-03',
  })
  const month = teamPeriodRange('30d', '2026-10-10')
  assert.equal(month.from, '2026-09-11')
  assert.equal(month.previousFrom, '2026-08-12')
  assert.equal(month.previousTo, '2026-09-10')
})

test('members are classified by recency before score trend', () => {
  const trending = { current: window(3, 60), previous: window(3, 80) }

  // Dropping scores do not matter once someone stopped practicing.
  assert.equal(
    classifyMember(
      { ...trending, lastPracticedAt: daysAgo(15) },
      daysAgo(200),
      now,
    ),
    'inactive',
  )
  assert.equal(
    classifyMember(
      { ...trending, lastPracticedAt: daysAgo(2) },
      daysAgo(200),
      now,
    ),
    'declining',
  )
  assert.equal(
    classifyMember(
      {
        current: window(3, 85),
        previous: window(3, 70),
        lastPracticedAt: daysAgo(2),
      },
      daysAgo(200),
      now,
    ),
    'improving',
  )
  // A 4-point wobble is noise, and one period without data is not a trend.
  assert.equal(
    classifyMember(
      {
        current: window(3, 76),
        previous: window(3, 80),
        lastPracticedAt: daysAgo(2),
      },
      daysAgo(200),
      now,
    ),
    'steady',
  )
  assert.equal(
    classifyMember(
      {
        current: window(3, 90),
        previous: emptyWindow,
        lastPracticedAt: daysAgo(2),
      },
      daysAgo(200),
      now,
    ),
    'steady',
  )
})

test('someone who never practiced is new first, inactive after the grace period', () => {
  const never = { current: emptyWindow, previous: emptyWindow }
  assert.equal(
    classifyMember({ ...never, lastPracticedAt: null }, daysAgo(3), now),
    'new',
  )
  assert.equal(
    classifyMember({ ...never, lastPracticedAt: null }, daysAgo(20), now),
    'inactive',
  )
})

test('team roll-up sums raw counters, orders by attention and finds the weakest skill', () => {
  const data = buildTeamPerformance({
    workspaceId: 'w1',
    selection: { period: '30d' },
    view: 'basic',
    advanced: null,
    range: teamPeriodRange('30d', '2026-10-10'),
    now,
    days: [],
    objections: [
      {
        category: 'timing',
        raised: 1,
        handled: 1,
        partiallyHandled: 0,
        notHandled: 0,
      },
      {
        category: 'price',
        raised: 5,
        handled: 2,
        partiallyHandled: 1,
        notHandled: 2,
      },
    ],
    criticalErrors: [],
    competencies: [
      {
        id: 'discovery',
        competencyId: 'c-discovery',
        code: 'discovery',
        name: 'Khám phá nhu cầu',
        callType: 'cold_call',
      },
      {
        id: 'objection',
        competencyId: 'c-objection',
        code: 'objection',
        name: 'Xử lý từ chối',
        callType: 'cold_call',
      },
    ],
    members: [
      row({
        userId: 'steady',
        current: window(4, 80),
        previous: window(4, 78),
        lastPracticedAt: daysAgo(1),
        mastery: { discovery: 80, objection: 70 },
      }),
      row({
        userId: 'idle',
        current: emptyWindow,
        previous: window(2, 50),
        lastPracticedAt: daysAgo(40),
        mastery: { discovery: 40 },
      }),
      row({
        userId: 'falling',
        role: 'admin',
        current: window(2, 50),
        previous: window(2, 70),
        lastPracticedAt: daysAgo(3),
        mastery: { discovery: 60, objection: 30 },
      }),
    ],
  })

  assert.deepEqual(
    data.members.map((member) => [member.userId, member.status]),
    [
      ['idle', 'inactive'],
      ['falling', 'declining'],
      ['steady', 'steady'],
    ],
  )

  // Averages come from session totals, not from averaging member averages.
  assert.deepEqual(
    {
      sessions: data.kpis.sessions,
      previousSessions: data.kpis.previousSessions,
      averageScore: data.kpis.averageScore,
      activeMembers: data.kpis.activeMembers,
      previousActiveMembers: data.kpis.previousActiveMembers,
      totalMembers: data.kpis.totalMembers,
      inactiveMembers: data.kpis.inactiveMembers,
    },
    {
      sessions: 6,
      previousSessions: 8,
      averageScore: (4 * 80 + 2 * 50) / 6,
      activeMembers: 2,
      previousActiveMembers: 3,
      totalMembers: 3,
      inactiveMembers: 1,
    },
  )

  const [discovery, objection] = data.competencies
  assert.equal(discovery.teamAverage, (80 + 40 + 60) / 3)
  assert.equal(discovery.assessedMembers, 3)
  // A member who was never assessed on a skill is left out, not counted as 0.
  assert.equal(objection.teamAverage, (70 + 30) / 2)
  assert.equal(objection.assessedMembers, 2)

  const falling = data.members.find((member) => member.userId === 'falling')
  assert.ok(falling)
  assert.ok(falling.weakest)
  assert.equal(falling.weakest.code, 'objection')
  assert.equal(falling.weakest.callType, 'cold_call')
  assert.equal(falling.strongest?.code, 'discovery')
  const idle = data.members.find((member) => member.userId === 'idle')
  assert.ok(idle)
  assert.equal(idle.mastery.objection, null)
  // Evidence defaults to zero for a skill nobody assessed; the most raised
  // objection leads.
  assert.equal(idle.masteryEvidence.objection, 0)
  assert.deepEqual(
    data.objections.map((stat) => stat.category),
    ['price', 'timing'],
  )
})

test('the trend splits the period into equal buckets and keeps empty ones', () => {
  const range = teamPeriodRange('30d', '2026-10-10')
  const trend = buildTrend(range, [
    { day: '2026-09-11', sessions: 2, scored: 2, scoreSum: 120 },
    { day: '2026-09-15', sessions: 1, scored: 0, scoreSum: 0 },
    { day: '2026-10-10', sessions: 1, scored: 1, scoreSum: 90 },
  ])
  assert.equal(trend.length, 6)
  assert.deepEqual([trend[0].from, trend[0].to], ['2026-09-11', '2026-09-15'])
  assert.deepEqual([trend[5].from, trend[5].to], ['2026-10-06', '2026-10-10'])
  // Scores average over scored sessions only; an unscored one still counts.
  assert.deepEqual([trend[0].sessions, trend[0].averageScore], [3, 60])
  assert.deepEqual([trend[2].sessions, trend[2].averageScore], [0, null])
  assert.equal(trend[5].averageScore, 90)

  assert.equal(buildTrend(teamPeriodRange('7d', '2026-10-10'), []).length, 7)
  assert.equal(buildTrend(teamPeriodRange('90d', '2026-10-10'), []).length, 9)
})

test('an empty team has no averages instead of zeros', () => {
  const data = buildTeamPerformance({
    workspaceId: 'w1',
    selection: { period: '7d' },
    view: 'basic',
    advanced: null,
    range: teamPeriodRange('7d', '2026-10-10'),
    now,
    days: [],
    objections: [],
    criticalErrors: [],
    competencies: [],
    members: [row({ userId: 'solo', joinedAt: daysAgo(1) })],
  })
  assert.equal(data.kpis.averageScore, null)
  assert.equal(data.kpis.objectiveAchievedRate, null)
  assert.equal(data.members[0].status, 'new')
  assert.equal(data.members[0].weakest, null)
})

test('a custom range must be at least a week, in the past and not too long', () => {
  const today = '2026-10-10'
  assert.equal(teamRangeProblem('2026-10-04', '2026-10-10', today), null)
  // Seven days inclusive is the shortest; six is too narrow.
  assert.equal(teamRangeProblem('2026-10-05', '2026-10-10', today), 'too_short')
  assert.equal(teamRangeProblem('2026-10-10', '2026-10-10', today), 'too_short')
  assert.equal(teamRangeProblem('2025-10-11', today, today), null)
  assert.equal(teamRangeProblem('2025-10-10', today, today), 'too_long')
  assert.equal(teamRangeProblem('2026-10-08', '2026-10-01', today), 'reversed')
  assert.equal(teamRangeProblem('2026-10-04', '2026-10-11', today), 'future')
  assert.equal(teamRangeProblem('', '2026-10-10', today), 'incomplete')
  assert.equal(
    teamRangeProblem('2026-02-30', '2026-10-10', today),
    'incomplete',
  )
})

test('a custom range is compared with the equally long one before it', () => {
  assert.deepEqual(
    resolveTeamRange({ from: '2026-09-01', to: '2026-09-10' }, '2026-10-10'),
    {
      from: '2026-09-01',
      to: '2026-09-10',
      previousFrom: '2026-08-22',
      previousTo: '2026-08-31',
    },
  )
  assert.deepEqual(
    resolveTeamRange({ period: '7d' }, '2026-10-10'),
    teamPeriodRange('7d', '2026-10-10'),
  )
})

test('a custom range that does not divide evenly ends with a shorter bucket', () => {
  // 20 days -> two-day buckets, ten of them.
  const even = buildTrend(
    resolveTeamRange({ from: '2026-09-21', to: '2026-10-10' }, '2026-10-10'),
    [],
  )
  assert.equal(even.length, 10)
  // 100 days -> twelve-day buckets; the ninth holds the last four days.
  const range = resolveTeamRange(
    { from: '2026-07-03', to: '2026-10-10' },
    '2026-10-10',
  )
  const trend = buildTrend(range, [
    { day: '2026-10-10', sessions: 2, scored: 2, scoreSum: 150 },
  ])
  assert.equal(trend.length, 9)
  assert.equal(trend[0].from, '2026-07-03')
  assert.equal(trend[8].to, '2026-10-10')
  assert.deepEqual([trend[8].sessions, trend[8].averageScore], [2, 75])
  // Every day lands in exactly one bucket.
  assert.equal(trend[7].to < trend[8].from, true)
})
