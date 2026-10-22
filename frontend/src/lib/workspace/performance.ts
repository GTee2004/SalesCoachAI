import { countDays, isDateKey, shiftDateKey } from '#/lib/admin/usage'
import type { WorkspaceRole } from '#/lib/auth/workspace-roles'

export const TEAM_PERIODS = ['7d', '30d', '90d'] as const
export type TeamPeriod = (typeof TEAM_PERIODS)[number]
export const DEFAULT_TEAM_PERIOD: TeamPeriod = '30d'

export const teamPeriodLabels: Record<TeamPeriod, string> = {
  '7d': '7 ngày',
  '30d': '30 ngày',
  '90d': '90 ngày',
}

/**
 * Shortest custom range. A window this narrow still hides who practiced on a
 * given day, so a manager cannot use the picker to single out one person's day.
 */
export const TEAM_RANGE_MIN_DAYS = 7
/** Longest custom range, so one request cannot scan the whole history. */
export const TEAM_RANGE_MAX_DAYS = 365

/** A preset ending today, or a custom period of whole days, both included. */
export type TeamRangeSelection =
  { period: TeamPeriod } | { from: string; to: string }

export type TeamRangeProblem =
  'incomplete' | 'reversed' | 'future' | 'too_short' | 'too_long'

export const teamRangeProblems: Record<TeamRangeProblem, string> = {
  incomplete: 'Chọn đủ ngày bắt đầu và ngày kết thúc.',
  reversed: 'Ngày bắt đầu phải trước hoặc trùng ngày kết thúc.',
  future: 'Ngày kết thúc không được sau hôm nay.',
  too_short: `Khoảng thời gian tối thiểu là ${TEAM_RANGE_MIN_DAYS} ngày.`,
  too_long: `Khoảng thời gian tối đa là ${TEAM_RANGE_MAX_DAYS} ngày.`,
}

/** Why a custom range cannot be shown; null when it can. */
export function teamRangeProblem(
  from: string,
  to: string,
  today: string,
): TeamRangeProblem | null {
  if (!isDateKey(from) || !isDateKey(to)) return 'incomplete'
  if (from > to) return 'reversed'
  if (to > today) return 'future'
  const days = countDays(from, to)
  if (days < TEAM_RANGE_MIN_DAYS) return 'too_short'
  return days > TEAM_RANGE_MAX_DAYS ? 'too_long' : null
}

export const TEAM_VIEWS = ['basic', 'advanced'] as const
export type TeamView = (typeof TEAM_VIEWS)[number]
export const DEFAULT_TEAM_VIEW: TeamView = 'basic'

export const teamViewLabels: Record<TeamView, string> = {
  basic: 'Cơ bản',
  advanced: 'Nâng cao',
}

const periodDays: Record<TeamPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 }

/**
 * Days per chart point, aiming for 7 to 14 points: a day for up to two weeks,
 * two for a month, five for six weeks, then about a ninth of the range.
 */
function trendBucketDays(days: number) {
  if (days <= 14) return 1
  if (days <= 28) return 2
  if (days <= 45) return 5
  return Math.ceil(days / 9)
}

/** Sessions kept per member for the recent-sessions list. */
export const RECENT_SESSIONS = 8

/** No completed practice for this long marks a member as inactive. */
export const INACTIVE_DAYS = 14
/** A score change of at least this many points counts as a real trend. */
export const TREND_POINTS = 5

export type TeamMemberStatus =
  'inactive' | 'declining' | 'improving' | 'steady' | 'new'

export interface TeamPeriodRange {
  from: string
  to: string
  previousFrom: string
  previousTo: string
}

/** The window `from`..`to` and the window of equal length right before it. */
function windowRange(from: string, to: string): TeamPeriodRange {
  const days = countDays(from, to)
  return {
    from,
    to,
    previousFrom: shiftDateKey(from, -days),
    previousTo: shiftDateKey(from, -1),
  }
}

/** Current and previous windows of equal length, ending on `today` (inclusive). */
export function teamPeriodRange(
  period: TeamPeriod,
  today: string,
): TeamPeriodRange {
  return windowRange(shiftDateKey(today, -(periodDays[period] - 1)), today)
}

/** Callers must have checked a custom range with `teamRangeProblem`. */
export function resolveTeamRange(
  selection: TeamRangeSelection,
  today: string,
): TeamPeriodRange {
  return 'period' in selection
    ? teamPeriodRange(selection.period, today)
    : windowRange(selection.from, selection.to)
}

/** Raw counters for one window; sums stay additive so the team can be rolled up. */
export interface TeamWindowTotals {
  sessions: number
  scored: number
  scoreSum: number
  objectiveAssessed: number
  objectiveAchieved: number
}

export const emptyWindow: TeamWindowTotals = {
  sessions: 0,
  scored: 0,
  scoreSum: 0,
  objectiveAssessed: 0,
  objectiveAchieved: 0,
}

export const averageScore = (totals: TeamWindowTotals) =>
  totals.scored ? totals.scoreSum / totals.scored : null

export const achievedRate = (totals: TeamWindowTotals) =>
  totals.objectiveAssessed
    ? (totals.objectiveAchieved / totals.objectiveAssessed) * 100
    : null

export interface TeamTrendPoint {
  from: string
  to: string
  sessions: number
  averageScore: number | null
}

/** One day of completed sessions, as read from the database. */
export interface TeamDailyRow {
  day: string
  sessions: number
  scored: number
  scoreSum: number
}

export type ObjectionHandling = 'handled' | 'partially_handled' | 'not_handled'

/** How often one kind of objection came up, and how the team dealt with it. */
export interface TeamObjectionStat {
  category: string
  raised: number
  handled: number
  partiallyHandled: number
  notHandled: number
}

/** A critical error one or more members keep making. */
export interface TeamCriticalError {
  competencyId: string
  competencyName: string
  errorId: string
  description: string
  sessions: number
  members: Array<{ userId: string; name: string; sessions: number }>
}

export type ObjectiveOutcome =
  'achieved' | 'partially_achieved' | 'not_achieved'

export interface TeamRecentSession {
  sessionId: string
  practiceTitle: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  completedAt: string
  score: number | null
  objectiveOutcome: ObjectiveOutcome | null
  /** The one takeaway the AI coach left for this session. */
  coachingPoint: string | null
}

export type PracticeCallType = 'cold_call' | 'warm_call'
export type PracticeDifficulty = TeamRecentSession['difficulty']

/** Insights the buyer hid that the salesperson found or missed. */
export interface DiscoveryTotals {
  discovered: number
  missed: number
}

export const discoveryRate = (totals: DiscoveryTotals) => {
  const total = totals.discovered + totals.missed
  return total ? (totals.discovered / total) * 100 : null
}

export interface TeamScenarioStat {
  practiceId: string
  title: string
  callType: PracticeCallType
  difficulty: PracticeDifficulty
  sessions: number
  /** Distinct members who tried it. */
  members: number
  averageScore: number | null
  objectiveAchievedRate: number | null
}

export interface TeamPracticeHealth {
  completed: number
  abandoned: number
  /** Time on completed calls, in seconds; 0 when none were timed. */
  practiceSeconds: number
  timedSessions: number
}

/** Team mean of a competency's session scores in this window and the one before. */
export interface TeamCompetencyChange {
  current: number | null
  previous: number | null
}

export interface TeamMemberMix {
  callType: PracticeCallType
  difficulty: PracticeDifficulty
  sessions: number
}

export interface TeamNextPractice {
  reason: string
  competencyCode: string | null
  practiceType: PracticeCallType | null
  suggestedPracticeTitle: string | null
}

export interface TeamMemberAdvanced {
  objections: TeamObjectionStat[]
  discovery: DiscoveryTotals
  mix: TeamMemberMix[]
  nextPractice: TeamNextPractice | null
}

/** Only computed for the advanced view. */
export interface TeamAdvanced {
  scenarios: TeamScenarioStat[]
  discovery: DiscoveryTotals
  health: TeamPracticeHealth
  /** By skill column id; a skill nobody scored in the window has none. */
  competencyChange: Partial<Record<string, TeamCompetencyChange>>
  /** By user id. */
  members: Record<string, TeamMemberAdvanced>
}

export interface TeamMemberRow {
  memberId: string
  userId: string
  name: string
  email: string
  role: WorkspaceRole
  joinedAt: Date
  current: TeamWindowTotals
  previous: TeamWindowTotals
  /** Latest completed session in this workspace, whatever the period. */
  lastPracticedAt: Date | null
  /** Latest signed-in day or practice start, as YYYY-MM-DD. */
  lastActiveDate: string | null
  /** Latest score 0-100 in the period by skill column id; absent when unscored. */
  mastery: Partial<Record<string, number>>
  /** Scored sessions in the period behind each skill, by skill column id. */
  masteryEvidence: Partial<Record<string, number>>
  /** Newest first, whatever the period. */
  recentSessions: TeamRecentSession[]
}

/**
 * A skill is a competency within one call type, as on the learner's own
 * performance page, so cold and warm call scores never pool.
 */
export interface TeamSkill {
  id: string
  competencyId: string
  code: string
  name: string
  callType: PracticeCallType
}

export const skillColumnId = (
  competencyId: string,
  callType: PracticeCallType,
) => `${competencyId}:${callType}`

export interface TeamCompetencyColumn extends TeamSkill {
  /** Mean latest score of the members who were scored; null when nobody was. */
  teamAverage: number | null
  assessedMembers: number
}

export interface TeamMember {
  memberId: string
  userId: string
  name: string
  email: string
  role: WorkspaceRole
  status: TeamMemberStatus
  sessions: number
  previousSessions: number
  averageScore: number | null
  previousAverageScore: number | null
  objectiveAchievedRate: number | null
  lastPracticedAt: string | null
  lastActiveDate: string | null
  /** Latest score in the period by skill column id; null when unscored. */
  mastery: Record<string, number | null>
  /** Scored sessions in the period behind each skill; 0 when unscored. */
  masteryEvidence: Record<string, number>
  recentSessions: TeamRecentSession[]
  weakest: (TeamSkill & { score: number }) | null
  strongest: (TeamSkill & { score: number }) | null
}

export interface TeamPerformance {
  workspaceId: string
  selection: TeamRangeSelection
  view: TeamView
  range: TeamPeriodRange
  generatedAt: string
  kpis: {
    activeMembers: number
    totalMembers: number
    previousActiveMembers: number
    sessions: number
    previousSessions: number
    averageScore: number | null
    previousAverageScore: number | null
    objectiveAchievedRate: number | null
    previousObjectiveAchievedRate: number | null
    inactiveMembers: number
  }
  /** Null in the basic view. */
  advanced: TeamAdvanced | null
  trend: TeamTrendPoint[]
  /** Most raised first; only objections that were raised at least once. */
  objections: TeamObjectionStat[]
  /** Most frequent first. */
  criticalErrors: TeamCriticalError[]
  competencies: TeamCompetencyColumn[]
  members: TeamMember[]
}

/** Why a member needs a manager's attention, most urgent first. */
export function classifyMember(
  row: Pick<TeamMemberRow, 'current' | 'previous' | 'lastPracticedAt'>,
  joinedAt: Date,
  now: Date,
): TeamMemberStatus {
  const idleSince = now.getTime() - INACTIVE_DAYS * 86_400_000
  const lastPractice = row.lastPracticedAt?.getTime()
  if (lastPractice === undefined) {
    // Give brand-new members the same grace period before flagging them.
    return joinedAt.getTime() > idleSince ? 'new' : 'inactive'
  }
  if (lastPractice < idleSince) return 'inactive'
  const current = averageScore(row.current)
  const previous = averageScore(row.previous)
  if (current === null || previous === null) return 'steady'
  if (current - previous <= -TREND_POINTS) return 'declining'
  if (current - previous >= TREND_POINTS) return 'improving'
  return 'steady'
}

/**
 * Splits the period into equal buckets, oldest first, empty ones included. A
 * range that does not divide evenly ends with a shorter last bucket.
 */
export function buildTrend(
  range: TeamPeriodRange,
  days: TeamDailyRow[],
): TeamTrendPoint[] {
  const total = countDays(range.from, range.to)
  const size = trendBucketDays(total)
  return Array.from({ length: Math.ceil(total / size) }, (_, index) => {
    const from = shiftDateKey(range.from, index * size)
    const last = shiftDateKey(from, size - 1)
    const to = last > range.to ? range.to : last
    const inside = days.filter((row) => row.day >= from && row.day <= to)
    const scored = inside.reduce((sum, row) => sum + row.scored, 0)
    return {
      from,
      to,
      sessions: inside.reduce((sum, row) => sum + row.sessions, 0),
      averageScore: scored
        ? inside.reduce((sum, row) => sum + row.scoreSum, 0) / scored
        : null,
    }
  })
}

const statusRank: Record<TeamMemberStatus, number> = {
  inactive: 0,
  declining: 1,
  new: 2,
  steady: 3,
  improving: 4,
}

/** Needs-attention first; within a status, the lowest scores come first. */
function compareMembers(a: TeamMember, b: TeamMember) {
  return (
    statusRank[a.status] - statusRank[b.status] ||
    (a.averageScore ?? Infinity) - (b.averageScore ?? Infinity) ||
    a.name.localeCompare(b.name, 'vi')
  )
}

export function buildTeamPerformance(input: {
  workspaceId: string
  selection: TeamRangeSelection
  view: TeamView
  advanced: TeamAdvanced | null
  range: TeamPeriodRange
  now: Date
  members: TeamMemberRow[]
  competencies: TeamSkill[]
  days: TeamDailyRow[]
  objections: TeamObjectionStat[]
  criticalErrors: TeamCriticalError[]
}): TeamPerformance {
  const { members: rows, now } = input

  const columns: TeamCompetencyColumn[] = input.competencies.map(
    (competency) => {
      const scores = rows.flatMap((row) => row.mastery[competency.id] ?? [])
      return {
        ...competency,
        teamAverage: scores.length
          ? scores.reduce((sum, score) => sum + score, 0) / scores.length
          : null,
        assessedMembers: scores.length,
      }
    },
  )

  const members = rows
    .map((row): TeamMember => {
      const mastery = Object.fromEntries(
        columns.map((column) => [column.id, row.mastery[column.id] ?? null]),
      )
      const assessed = columns.flatMap((column) => {
        const score = mastery[column.id]
        return score === null
          ? []
          : [
              {
                id: column.id,
                competencyId: column.competencyId,
                code: column.code,
                name: column.name,
                callType: column.callType,
                score,
              },
            ]
      })
      // Ties break on column order so the label is stable between reloads.
      const weakest = assessed.reduce<(typeof assessed)[number] | null>(
        (low, item) => (!low || item.score < low.score ? item : low),
        null,
      )
      const strongest = assessed.reduce<(typeof assessed)[number] | null>(
        (high, item) => (!high || item.score > high.score ? item : high),
        null,
      )
      return {
        memberId: row.memberId,
        userId: row.userId,
        name: row.name,
        email: row.email,
        role: row.role,
        status: classifyMember(row, row.joinedAt, now),
        sessions: row.current.sessions,
        previousSessions: row.previous.sessions,
        averageScore: averageScore(row.current),
        previousAverageScore: averageScore(row.previous),
        objectiveAchievedRate: achievedRate(row.current),
        lastPracticedAt: row.lastPracticedAt?.toISOString() ?? null,
        lastActiveDate: row.lastActiveDate,
        mastery,
        masteryEvidence: Object.fromEntries(
          columns.map((column) => [
            column.id,
            row.masteryEvidence[column.id] ?? 0,
          ]),
        ),
        recentSessions: row.recentSessions,
        weakest,
        strongest,
      }
    })
    .sort(compareMembers)

  const sum = (pick: (row: TeamMemberRow) => TeamWindowTotals) =>
    rows.reduce<TeamWindowTotals>(
      (total, row) => {
        const window = pick(row)
        return {
          sessions: total.sessions + window.sessions,
          scored: total.scored + window.scored,
          scoreSum: total.scoreSum + window.scoreSum,
          objectiveAssessed: total.objectiveAssessed + window.objectiveAssessed,
          objectiveAchieved: total.objectiveAchieved + window.objectiveAchieved,
        }
      },
      { ...emptyWindow },
    )
  const current = sum((row) => row.current)
  const previous = sum((row) => row.previous)

  return {
    workspaceId: input.workspaceId,
    selection: input.selection,
    view: input.view,
    advanced: input.advanced,
    range: input.range,
    generatedAt: now.toISOString(),
    kpis: {
      activeMembers: rows.filter((row) => row.current.sessions > 0).length,
      totalMembers: rows.length,
      previousActiveMembers: rows.filter((row) => row.previous.sessions > 0)
        .length,
      sessions: current.sessions,
      previousSessions: previous.sessions,
      averageScore: averageScore(current),
      previousAverageScore: averageScore(previous),
      objectiveAchievedRate: achievedRate(current),
      previousObjectiveAchievedRate: achievedRate(previous),
      inactiveMembers: members.filter((member) => member.status === 'inactive')
        .length,
    },
    trend: buildTrend(input.range, input.days),
    objections: [...input.objections].sort(
      (a, b) => b.raised - a.raised || a.category.localeCompare(b.category),
    ),
    criticalErrors: input.criticalErrors,
    competencies: columns,
    members,
  }
}
