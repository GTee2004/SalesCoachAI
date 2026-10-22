import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '#/db'
import {
  competencies,
  member,
  practiceAgentConfigs,
  practiceSessionCompetencyScores,
  practiceSessionEvaluations,
  practiceSessions,
  practices,
  user,
  userActivityDays,
} from '#/db/schema'
import { APP_TIME_ZONE, toDateKey } from '#/lib/admin/usage'
import { getWorkspaceRole } from '#/lib/auth/workspace-roles'
import { COMPETENCY_CATALOGUE } from '#/lib/practice/scorecards'
import {
  buildTeamPerformance,
  emptyWindow,
  RECENT_SESSIONS,
  resolveTeamRange,
  skillColumnId,
} from '#/lib/workspace/performance'
import type {
  DiscoveryTotals,
  ObjectionHandling,
  ObjectiveOutcome,
  PracticeCallType,
  PracticeDifficulty,
  TeamAdvanced,
  TeamCompetencyChange,
  TeamCriticalError,
  TeamDailyRow,
  TeamMemberAdvanced,
  TeamMemberRow,
  TeamNextPractice,
  TeamObjectionStat,
  TeamPeriodRange,
  TeamPracticeHealth,
  TeamRangeSelection,
  TeamRecentSession,
  TeamScenarioStat,
  TeamSkill,
  TeamView,
} from '#/lib/workspace/performance'

// A constant, never user input; see admin-metrics for why it is inlined.
const timeZone = sql.raw(`'${APP_TIME_ZONE}'`)
const dayStart = (day: string) =>
  sql`(${day}::date::timestamp at time zone ${timeZone})`
const dayEnd = (day: string) =>
  sql`((${day}::date + 1)::timestamp at time zone ${timeZone})`

const completedWithin = (from: string, to: string) =>
  sql`${practiceSessions.completedAt} >= ${dayStart(from)} and ${practiceSessions.completedAt} < ${dayEnd(to)}`

/** Counters for one window of completed sessions, aggregated per learner. */
const windowColumns = (from: string, to: string) => {
  const inWindow = completedWithin(from, to)
  return {
    sessions: sql<number>`count(*) filter (where ${inWindow})::int`,
    scored: sql<number>`count(${practiceSessionEvaluations.overallScore}) filter (where ${inWindow})::int`,
    scoreSum: sql<number>`coalesce(sum(${practiceSessionEvaluations.overallScore}) filter (where ${inWindow}), 0)::int`,
    objectiveAssessed: sql<number>`count(${practiceSessionEvaluations.objectiveOutcome}) filter (where ${inWindow})::int`,
    objectiveAchieved: sql<number>`count(*) filter (where ${inWindow} and ${practiceSessionEvaluations.objectiveOutcome} = 'achieved')::int`,
  }
}

/** Completed, not deleted, in this workspace: what counts as practice. */
const countedSession = (workspaceId: string) =>
  sql`${practiceSessions.workspaceId} = ${workspaceId} and ${practiceSessions.status} = 'completed' and ${practiceSessions.deletedAt} is null`

/** Sessions of people who are still members, for team-wide totals. */
const ofMembers = (workspaceId: string) =>
  sql`${practiceSessions.userId} in (select ${member.userId} from ${member} where ${member.organizationId} = ${workspaceId})`

type Handling = ObjectionHandling | null

const emptyObjection = (category: string): TeamObjectionStat => ({
  category,
  raised: 0,
  handled: 0,
  partiallyHandled: 0,
  notHandled: 0,
})

function addOutcome(
  stat: TeamObjectionStat,
  handling: Handling,
  count: number,
) {
  stat.raised += count
  if (handling === 'handled') stat.handled += count
  else if (handling === 'partially_handled') stat.partiallyHandled += count
  else stat.notHandled += count
}

const sortObjections = (list: TeamObjectionStat[]) =>
  list.sort(
    (a, b) => b.raised - a.raised || a.category.localeCompare(b.category),
  )

/**
 * Extra reads for the advanced view. Same rules as the basic ones: only this
 * workspace, only completed and not deleted sessions, only current members.
 */
async function getAdvanced(
  workspaceId: string,
  range: TeamPeriodRange,
  memberIds: Set<string>,
  objectionsByUser: Map<string, Map<string, TeamObjectionStat>>,
): Promise<TeamAdvanced> {
  const inPeriod = completedWithin(range.from, range.to)
  const counted = sql`${countedSession(workspaceId)} and ${ofMembers(workspaceId)}`
  const [
    scenarioRows,
    discoveryRows,
    healthRows,
    changeRows,
    mixRows,
    nextRows,
  ] = await Promise.all([
    db
      .select({
        practiceId: practices.id,
        title: practices.title,
        callType: practices.type,
        difficulty: practices.difficulty,
        sessions: sql<number>`count(*)::int`,
        members: sql<number>`count(distinct ${practiceSessions.userId})::int`,
        averageScore: sql<
          number | null
        >`avg(${practiceSessionEvaluations.overallScore})::float`,
        assessed: sql<number>`count(${practiceSessionEvaluations.objectiveOutcome})::int`,
        achieved: sql<number>`count(*) filter (where ${practiceSessionEvaluations.objectiveOutcome} = 'achieved')::int`,
      })
      .from(practiceSessions)
      .innerJoin(practices, eq(practices.id, practiceSessions.practiceId))
      .leftJoin(
        practiceSessionEvaluations,
        eq(practiceSessionEvaluations.sessionId, practiceSessions.id),
      )
      .where(sql`${counted} and ${inPeriod}`)
      .groupBy(practices.id)
      .orderBy(sql`count(*) desc`, asc(practices.title))
      .limit(12),
    db
      .select({
        userId: practiceSessions.userId,
        discovered: sql<number>`coalesce(sum(jsonb_array_length(${practiceSessionEvaluations.discoveredInsightKeys})), 0)::int`,
        missed: sql<number>`coalesce(sum(jsonb_array_length(${practiceSessionEvaluations.missedInsightKeys})), 0)::int`,
      })
      .from(practiceSessions)
      .innerJoin(
        practiceSessionEvaluations,
        eq(practiceSessionEvaluations.sessionId, practiceSessions.id),
      )
      .where(sql`${counted} and ${inPeriod}`)
      .groupBy(practiceSessions.userId),
    // Abandoned calls never complete, so they are counted by when they began.
    db.execute<{
      completed: number
      abandoned: number
      seconds: number
      timed: number
    }>(
      sql`select
          count(*) filter (where ${practiceSessions.status} = 'completed' and ${practiceSessions.createdAt} >= ${dayStart(range.from)} and ${practiceSessions.createdAt} < ${dayEnd(range.to)})::int as completed,
          count(*) filter (where ${practiceSessions.status} = 'abandoned' and ${practiceSessions.createdAt} >= ${dayStart(range.from)} and ${practiceSessions.createdAt} < ${dayEnd(range.to)})::int as abandoned,
          coalesce(sum(extract(epoch from ${practiceSessions.completedAt} - ${practiceSessions.startedAt})) filter (where ${practiceSessions.status} = 'completed' and ${inPeriod} and ${practiceSessions.startedAt} is not null), 0)::int as seconds,
          count(*) filter (where ${practiceSessions.status} = 'completed' and ${inPeriod} and ${practiceSessions.startedAt} is not null)::int as timed
        from ${practiceSessions}
        where ${practiceSessions.workspaceId} = ${workspaceId}
          and ${practiceSessions.deletedAt} is null
          and ${ofMembers(workspaceId)}`,
    ),
    db
      .select({
        competencyId: practiceSessionCompetencyScores.competencyId,
        callType: practices.type,
        current: sql<
          number | null
        >`avg(${practiceSessionCompetencyScores.score}) filter (where ${completedWithin(range.from, range.to)})::float`,
        previous: sql<
          number | null
        >`avg(${practiceSessionCompetencyScores.score}) filter (where ${completedWithin(range.previousFrom, range.previousTo)})::float`,
      })
      .from(practiceSessions)
      .innerJoin(
        practiceSessionCompetencyScores,
        eq(practiceSessionCompetencyScores.sessionId, practiceSessions.id),
      )
      .innerJoin(practices, eq(practices.id, practiceSessions.practiceId))
      .where(
        sql`${counted} and ${practiceSessionCompetencyScores.score} is not null and ${completedWithin(range.previousFrom, range.to)}`,
      )
      .groupBy(practiceSessionCompetencyScores.competencyId, practices.type),
    db
      .select({
        userId: practiceSessions.userId,
        callType: practices.type,
        difficulty: practices.difficulty,
        sessions: sql<number>`count(*)::int`,
      })
      .from(practiceSessions)
      .innerJoin(practices, eq(practices.id, practiceSessions.practiceId))
      .where(sql`${counted} and ${inPeriod}`)
      .groupBy(practiceSessions.userId, practices.type, practices.difficulty),
    // The newest evaluation that suggested something, whatever the period.
    db.execute<{
      userId: string
      reason: string
      competencyCode: string | null
      practiceType: PracticeCallType | null
      suggestedPracticeTitle: string | null
    }>(
      sql`select distinct on (${practiceSessions.userId})
          ${practiceSessions.userId} as "userId",
          recommendation ->> 'reason' as reason,
          recommendation ->> 'competencyCode' as "competencyCode",
          recommendation ->> 'practiceType' as "practiceType",
          suggested.title as "suggestedPracticeTitle"
        from ${practiceSessions}
        join ${practiceSessionEvaluations} on ${practiceSessionEvaluations.sessionId} = ${practiceSessions.id}
        cross join lateral (select ${practiceSessionEvaluations.nextPracticeRecommendation} as recommendation) as picked
        left join ${practices} as suggested on suggested.id::text = recommendation ->> 'suggestedPracticeId'
          and (suggested.workspace_id = ${workspaceId} or suggested.is_global)
          and suggested.status = 'published'
        where ${countedSession(workspaceId)}
          and recommendation is not null
          and recommendation ->> 'reason' is not null
        order by ${practiceSessions.userId}, ${practiceSessions.completedAt} desc`,
    ),
  ])

  const discoveryByUser = new Map<string, DiscoveryTotals>()
  const team: DiscoveryTotals = { discovered: 0, missed: 0 }
  for (const row of discoveryRows) {
    discoveryByUser.set(row.userId, {
      discovered: row.discovered,
      missed: row.missed,
    })
    team.discovered += row.discovered
    team.missed += row.missed
  }
  const mixByUser = new Map<string, TeamMemberAdvanced['mix']>()
  for (const row of mixRows) {
    const list = mixByUser.get(row.userId) ?? []
    list.push({
      callType: row.callType,
      difficulty: row.difficulty,
      sessions: row.sessions,
    })
    mixByUser.set(row.userId, list)
  }
  const nextByUser = new Map<string, TeamNextPractice>(
    nextRows.rows.map(({ userId, ...next }) => [userId, next]),
  )
  const difficultyOrder: PracticeDifficulty[] = [
    'beginner',
    'intermediate',
    'advanced',
  ]

  const [health = { completed: 0, abandoned: 0, seconds: 0, timed: 0 }] =
    healthRows.rows
  const practiceHealth: TeamPracticeHealth = {
    completed: health.completed,
    abandoned: health.abandoned,
    practiceSeconds: health.seconds,
    timedSessions: health.timed,
  }
  const competencyChange: Record<string, TeamCompetencyChange> = {}
  for (const row of changeRows)
    competencyChange[skillColumnId(row.competencyId, row.callType)] = {
      current: row.current,
      previous: row.previous,
    }

  const scenarios: TeamScenarioStat[] = scenarioRows.map((row) => ({
    practiceId: row.practiceId,
    title: row.title,
    callType: row.callType,
    difficulty: row.difficulty,
    sessions: row.sessions,
    members: row.members,
    averageScore: row.averageScore,
    objectiveAchievedRate: row.assessed
      ? (row.achieved / row.assessed) * 100
      : null,
  }))

  return {
    scenarios,
    discovery: team,
    health: practiceHealth,
    competencyChange,
    members: Object.fromEntries(
      [...memberIds].map((userId) => [
        userId,
        {
          objections: sortObjections([
            ...(objectionsByUser.get(userId)?.values() ?? []),
          ]),
          discovery: discoveryByUser.get(userId) ?? {
            discovered: 0,
            missed: 0,
          },
          mix: (mixByUser.get(userId) ?? []).sort(
            (a, b) =>
              a.callType.localeCompare(b.callType) ||
              difficultyOrder.indexOf(a.difficulty) -
                difficultyOrder.indexOf(b.difficulty),
          ),
          nextPractice: nextByUser.get(userId) ?? null,
        } satisfies TeamMemberAdvanced,
      ]),
    ),
  }
}

/**
 * Team performance for a workspace. Callers must already have checked that the
 * viewer is an owner or manager of `workspaceId`. Every read below is scoped to
 * that workspace, so someone who belongs to several workspaces only shows the
 * practice and mastery they have here.
 */
export async function getTeamPerformance(
  workspaceId: string,
  selection: TeamRangeSelection,
  now = new Date(),
  view: TeamView = 'basic',
) {
  const range = resolveTeamRange(selection, toDateKey(now))

  const inPeriod = completedWithin(range.from, range.to)

  const [
    memberRows,
    sessionRows,
    activityRows,
    masteryRows,
    dayRows,
    objectionRows,
    errorRows,
    recentRows,
  ] = await Promise.all([
    db
      .select({
        memberId: member.id,
        userId: member.userId,
        name: user.name,
        email: user.email,
        role: member.role,
        joinedAt: member.createdAt,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, workspaceId))
      .orderBy(asc(member.createdAt)),
    db
      .select({
        userId: practiceSessions.userId,
        current: windowColumns(range.from, range.to),
        previous: windowColumns(range.previousFrom, range.previousTo),
        lastCompletedAt:
          sql<Date | null>`max(${practiceSessions.completedAt})`.mapWith(
            practiceSessions.completedAt,
          ),
        lastCreatedAt: sql<Date>`max(${practiceSessions.createdAt})`.mapWith(
          practiceSessions.createdAt,
        ),
      })
      .from(practiceSessions)
      .leftJoin(
        practiceSessionEvaluations,
        eq(practiceSessionEvaluations.sessionId, practiceSessions.id),
      )
      .where(
        and(
          eq(practiceSessions.workspaceId, workspaceId),
          eq(practiceSessions.status, 'completed'),
          isNull(practiceSessions.deletedAt),
        ),
      )
      .groupBy(practiceSessions.userId),
    // Sign-ins are not tied to a workspace, so this is the only read here
    // that is not scoped to it; it exposes a day, never where they were.
    db
      .select({
        userId: userActivityDays.userId,
        lastDay: sql<string>`max(${userActivityDays.activityDate})::text`,
      })
      .from(userActivityDays)
      .innerJoin(member, eq(member.userId, userActivityDays.userId))
      .where(eq(member.organizationId, workspaceId))
      .groupBy(userActivityDays.userId),
    // Each skill's latest score in the period, as on the learner's own
    // performance page: per competency and call type, newest session wins.
    db.execute<{
      userId: string
      competencyId: string
      code: string
      name: string
      callType: PracticeCallType
      score: number
      evidence: number
    }>(
      sql`select distinct on (${practiceSessions.userId}, ${practiceSessionCompetencyScores.competencyId}, ${practices.type})
            ${practiceSessions.userId} as "userId",
            ${practiceSessionCompetencyScores.competencyId} as "competencyId",
            ${competencies.code} as code,
            ${competencies.name} as name,
            ${practices.type} as "callType",
            ${practiceSessionCompetencyScores.score} as score,
            (count(*) over (
              partition by ${practiceSessions.userId}, ${practiceSessionCompetencyScores.competencyId}, ${practices.type}
            ))::int as evidence
          from ${practiceSessions}
          join ${practiceSessionCompetencyScores} on ${practiceSessionCompetencyScores.sessionId} = ${practiceSessions.id}
          join ${competencies} on ${competencies.id} = ${practiceSessionCompetencyScores.competencyId}
          join ${practices} on ${practices.id} = ${practiceSessions.practiceId}
          where ${countedSession(workspaceId)} and ${inPeriod}
            and ${practiceSessionCompetencyScores.score} is not null
          order by ${practiceSessions.userId}, ${practiceSessionCompetencyScores.competencyId}, ${practices.type},
            ${practiceSessions.completedAt} desc, ${practiceSessions.id} desc`,
    ),
    db
      .select({
        day: sql<string>`to_char(${practiceSessions.completedAt} at time zone ${timeZone}, 'YYYY-MM-DD')`,
        sessions: sql<number>`count(*)::int`,
        scored: sql<number>`count(${practiceSessionEvaluations.overallScore})::int`,
        scoreSum: sql<number>`coalesce(sum(${practiceSessionEvaluations.overallScore}), 0)::int`,
      })
      .from(practiceSessions)
      .leftJoin(
        practiceSessionEvaluations,
        eq(practiceSessionEvaluations.sessionId, practiceSessions.id),
      )
      .where(sql`${countedSession(workspaceId)} and ${inPeriod}`)
      .groupBy(sql`1`),
    // The category lives in the practice's private buyer config, keyed the
    // same way as the outcomes the evaluation recorded.
    db.execute<{
      userId: string
      category: string | null
      handling: Handling
      count: number
    }>(
      sql`select ${practiceSessions.userId} as "userId", category.value as category, outcome ->> 'handling' as handling, count(*)::int as count
          from ${practiceSessions}
          join ${practiceSessionEvaluations} on ${practiceSessionEvaluations.sessionId} = ${practiceSessions.id}
          left join ${practiceAgentConfigs} on ${practiceAgentConfigs.practiceId} = ${practiceSessions.practiceId}
          cross join lateral jsonb_array_elements(${practiceSessionEvaluations.objectionOutcomes}) as outcome
          left join lateral (
            select spec ->> 'category' as value
            from jsonb_array_elements(${practiceAgentConfigs.config} -> 'objections') as spec
            where spec ->> 'key' = outcome ->> 'key'
            limit 1
          ) as category on true
          where ${countedSession(workspaceId)} and ${inPeriod}
            and (outcome ->> 'raised')::boolean
          group by 1, 2, 3`,
    ),
    db.execute<{
      userId: string
      competencyId: string
      competencyName: string
      errorId: string
      description: string | null
      sessions: number
    }>(
      sql`select ${practiceSessions.userId} as "userId",
            ${practiceSessionCompetencyScores.competencyId} as "competencyId",
            ${competencies.name} as "competencyName",
            finding ->> 'criticalErrorId' as "errorId",
            max((
              select error ->> 'description'
              from jsonb_array_elements(${practiceSessionCompetencyScores.scoringRubric} -> 'criticalErrors') as error
              where error ->> 'id' = finding ->> 'criticalErrorId'
              limit 1
            )) as description,
            count(distinct ${practiceSessions.id})::int as sessions
          from ${practiceSessions}
          join ${practiceSessionCompetencyScores} on ${practiceSessionCompetencyScores.sessionId} = ${practiceSessions.id}
          join ${competencies} on ${competencies.id} = ${practiceSessionCompetencyScores.competencyId}
          cross join lateral jsonb_array_elements(${practiceSessionCompetencyScores.findings}) as finding
          where ${countedSession(workspaceId)} and ${inPeriod}
            and finding ->> 'kind' = 'critical_error'
            and finding ->> 'criticalErrorId' is not null
          group by 1, 2, 3, 4`,
    ),
    db.execute<{
      userId: string
      sessionId: string
      practiceTitle: string
      difficulty: TeamRecentSession['difficulty']
      completedAt: Date
      score: number | null
      objectiveOutcome: ObjectiveOutcome | null
      coachingPoint: string | null
    }>(
      sql`select * from (
            select ${practiceSessions.userId} as "userId",
              ${practiceSessions.id} as "sessionId",
              ${practices.title} as "practiceTitle",
              ${practices.difficulty} as difficulty,
              ${practiceSessions.completedAt} as "completedAt",
              ${practiceSessionEvaluations.overallScore} as score,
              ${practiceSessionEvaluations.objectiveOutcome} as "objectiveOutcome",
              ${practiceSessionEvaluations.keyCoachingPoint} ->> 'text' as "coachingPoint",
              row_number() over (
                partition by ${practiceSessions.userId}
                order by ${practiceSessions.completedAt} desc
              ) as position
            from ${practiceSessions}
            join ${practices} on ${practices.id} = ${practiceSessions.practiceId}
            left join ${practiceSessionEvaluations} on ${practiceSessionEvaluations.sessionId} = ${practiceSessions.id}
            where ${countedSession(workspaceId)}
          ) as ranked
          where position <= ${RECENT_SESSIONS}
          order by "completedAt" desc`,
    ),
  ])

  const sessionsByUser = new Map(sessionRows.map((row) => [row.userId, row]))
  const activityByUser = new Map(
    activityRows.map((row) => [row.userId, row.lastDay]),
  )
  const memberIds = new Set(memberRows.map((row) => row.userId))

  // Only skills somebody here was scored on in the period get a column.
  const columns = new Map<string, TeamSkill>()
  const masteryByUser = new Map<string, Record<string, number>>()
  const evidenceByUser = new Map<string, Record<string, number>>()
  for (const row of masteryRows.rows) {
    if (!memberIds.has(row.userId)) continue
    const id = skillColumnId(row.competencyId, row.callType)
    columns.set(id, {
      id,
      competencyId: row.competencyId,
      code: row.code,
      name: row.name,
      callType: row.callType,
    })
    const mastery = masteryByUser.get(row.userId) ?? {}
    mastery[id] = row.score
    masteryByUser.set(row.userId, mastery)
    const evidence = evidenceByUser.get(row.userId) ?? {}
    evidence[id] = row.evidence
    evidenceByUser.set(row.userId, evidence)
  }
  // Skills in the order they come up during a call, cold calls first.
  const callOrder = (code: string) => {
    const index = COMPETENCY_CATALOGUE.findIndex((item) => item.code === code)
    return index < 0 ? COMPETENCY_CATALOGUE.length : index
  }
  const skills = [...columns.values()].sort(
    (a, b) =>
      callOrder(a.code) - callOrder(b.code) ||
      a.callType.localeCompare(b.callType) ||
      a.name.localeCompare(b.name, 'vi'),
  )

  const recentByUser = new Map<string, TeamRecentSession[]>()
  for (const { userId, completedAt, ...session } of recentRows.rows) {
    const list = recentByUser.get(userId) ?? []
    list.push({ ...session, completedAt: new Date(completedAt).toISOString() })
    recentByUser.set(userId, list)
  }

  const objections = new Map<string, TeamObjectionStat>()
  const objectionsByUser = new Map<string, Map<string, TeamObjectionStat>>()
  for (const row of objectionRows.rows) {
    // Someone who has since left the workspace is not part of the team.
    if (!memberIds.has(row.userId)) continue
    // A practice without a stored category still counts, under its own bucket.
    const category = row.category ?? 'other'
    const own = objectionsByUser.get(row.userId) ?? new Map()
    objectionsByUser.set(row.userId, own)
    for (const totals of [objections, own]) {
      const stat = totals.get(category) ?? emptyObjection(category)
      addOutcome(stat, row.handling, row.count)
      totals.set(category, stat)
    }
  }

  const memberNames = new Map(memberRows.map((row) => [row.userId, row.name]))
  const criticalErrors = new Map<string, TeamCriticalError>()
  for (const row of errorRows.rows) {
    const name = memberNames.get(row.userId)
    // Someone who has since left the workspace is no longer the manager's to coach.
    if (name === undefined) continue
    const key = `${row.competencyId}:${row.errorId}`
    const error = criticalErrors.get(key) ?? {
      competencyId: row.competencyId,
      competencyName: row.competencyName,
      errorId: row.errorId,
      description: row.description ?? row.errorId,
      sessions: 0,
      members: [],
    }
    error.sessions += row.sessions
    error.members.push({
      userId: row.userId,
      name,
      sessions: row.sessions,
    })
    criticalErrors.set(key, error)
  }

  const members: TeamMemberRow[] = memberRows.map((row) => {
    const sessions = sessionsByUser.get(row.userId)
    const lastSeen = [
      activityByUser.get(row.userId),
      sessions ? toDateKey(sessions.lastCreatedAt) : undefined,
    ]
      .filter((day): day is string => Boolean(day))
      .sort()
      .at(-1)
    return {
      ...row,
      role: getWorkspaceRole(row.role),
      current: sessions?.current ?? emptyWindow,
      previous: sessions?.previous ?? emptyWindow,
      lastPracticedAt: sessions?.lastCompletedAt ?? null,
      lastActiveDate: lastSeen ?? null,
      mastery: masteryByUser.get(row.userId) ?? {},
      masteryEvidence: evidenceByUser.get(row.userId) ?? {},
      recentSessions: recentByUser.get(row.userId) ?? [],
    }
  })

  return buildTeamPerformance({
    workspaceId,
    selection,
    view,
    advanced:
      view === 'advanced'
        ? await getAdvanced(workspaceId, range, memberIds, objectionsByUser)
        : null,
    range,
    now,
    members,
    competencies: skills,
    days: dayRows satisfies TeamDailyRow[],
    objections: [...objections.values()],
    criticalErrors: [...criticalErrors.values()]
      .map((error) => ({
        ...error,
        members: error.members
          .sort(
            (a, b) =>
              b.sessions - a.sessions || a.name.localeCompare(b.name, 'vi'),
          )
          .slice(0, 3),
      }))
      .sort(
        (a, b) =>
          b.sessions - a.sessions ||
          a.description.localeCompare(b.description, 'vi'),
      )
      .slice(0, 5),
  })
}
