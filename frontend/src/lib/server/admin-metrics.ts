import type { QueryConfig } from 'pg'
import { and, asc, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '#/db'
import { env } from '#/env'
import {
  practiceSessionEvaluations,
  practiceSessions,
  practiceSessionTurns,
  practices,
  serviceUsage,
  user,
  userActivityDays,
} from '#/db/schema'
import type {
  AdminServiceCosts,
  AdminSession,
  AdminSessionTranscript,
  AdminUsage,
  AdminUsageRange,
  AdminVoiceLatency,
  LatencyStageKey,
} from '#/lib/admin/contracts'
import { LATENCY_STAGES, SLOW_REPLY_MS } from '#/lib/admin/contracts'
import { buildServiceCosts } from '#/lib/admin/costs'
import type { CostUsageRow } from '#/lib/admin/costs'
import { LATENCY_STAGE_KEYS, buildVoiceLatency } from '#/lib/admin/latency'
import type {
  LatencyBucketRow,
  LatencyProviderRow,
  LatencyTotalsRow,
  StageColumns,
} from '#/lib/admin/latency'
import {
  APP_TIME_ZONE,
  buildUsage,
  sessionOutcome,
  usagePeriods,
} from '#/lib/admin/usage'
import { ADMIN_ROLE } from '#/lib/auth/roles'
import { sessionOperationActive } from './practice-sessions'
import { reconcileVoiceSessions } from './voice-session-lifecycle'

const ADMIN_RECIPIENT_QUERY_TIMEOUT_MS = 3_000

// Keep backend configuration lazy when there are no expired voice leases.
async function lookupVoiceSession(sessionId: string) {
  const { getVoiceSession } = await import('./voice-backend')
  return getVoiceSession(sessionId)
}

// Usage and recent sessions load together. Share their reconciliation so one
// read cannot skip the other's locked row and aggregate its pre-repair status.
let reconciliation: Promise<void> | undefined

async function reconcileAdminSessions(sessionId?: string) {
  if (sessionId) {
    await reconciliation
    await reconcileVoiceSessions(sessionId, lookupVoiceSession)
    return
  }
  if (!reconciliation) {
    reconciliation = reconcileVoiceSessions(
      undefined,
      lookupVoiceSession,
    ).finally(() => {
      reconciliation = undefined
    })
  }
  await reconciliation
}

// A constant, never user input. Inlined because a bound parameter would make
// the same expression differ between SELECT and GROUP BY.
const timeZone = sql.raw(`'${APP_TIME_ZONE}'`)

/** Local midnight that starts the given YYYY-MM-DD day. */
const dayStart = (day: string) =>
  sql`(${day}::date::timestamp at time zone ${timeZone})`
const dayEnd = (day: string) =>
  sql`((${day}::date + 1)::timestamp at time zone ${timeZone})`

/** A call counts from the moment it started, whatever happened next. */
const startedBetween = (from: string, to: string) =>
  and(
    gte(practiceSessions.startedAt, dayStart(from)),
    lt(practiceSessions.startedAt, dayEnd(to)),
  )

/** Start of the chart bucket that a `day` column falls in. */
const DAY_BUCKET = {
  day: sql.raw('day'),
  // Weeks start on Monday, like `bucketStart`.
  week: sql.raw(`date_trunc('week', day::timestamp)::date`),
  month: sql.raw(`date_trunc('month', day::timestamp)::date`),
}

export async function getAdminUsage(
  range: AdminUsageRange,
  now = new Date(),
): Promise<AdminUsage> {
  await reconcileAdminSessions()
  const periods = usagePeriods(range, now)
  const { from, to, previousFrom } = periods

  // Signed-in days are tracked from the day this table shipped. A practice
  // session also proves a signed-in visit, which covers the days before it.
  const activity = sql`(
    select ${userActivityDays.userId} as user_id, ${userActivityDays.activityDate} as day
    from ${userActivityDays}
    where ${userActivityDays.activityDate} between ${previousFrom}::date and ${to}::date
    union
    select ${practiceSessions.userId}, (${practiceSessions.createdAt} at time zone ${timeZone})::date
    from ${practiceSessions}
    where ${practiceSessions.createdAt} >= ${dayStart(previousFrom)}
      and ${practiceSessions.createdAt} < ${dayEnd(to)}
  ) as activity`

  const [callRows, activityRows, activeUsers, outcomeRows, topPractices] =
    await Promise.all([
      db
        .select({
          day: sql<string>`(${practiceSessions.startedAt} at time zone ${timeZone})::date::text`,
          calls: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${practiceSessions.status} = 'completed')::int`,
          technicalErrors: sql<number>`count(*) filter (where ${practiceSessions.endReason} = 'technical_error')::int`,
          scoreSum: sql<number>`coalesce(sum(${practiceSessionEvaluations.overallScore}), 0)::int`,
          evaluated: sql<number>`count(${practiceSessionEvaluations.overallScore})::int`,
        })
        .from(practiceSessions)
        .leftJoin(
          practiceSessionEvaluations,
          eq(practiceSessionEvaluations.sessionId, practiceSessions.id),
        )
        .where(startedBetween(previousFrom, to))
        .groupBy(sql`1`),
      db.execute<{ bucket: string; users: number }>(
        sql`select ${DAY_BUCKET[periods.granularity]}::text as bucket, count(distinct user_id)::int as users
        from ${activity} where day >= ${from}::date group by 1`,
      ),
      db.execute<{ current: number; previous: number }>(
        sql`select
          count(distinct user_id) filter (where day >= ${from}::date)::int as current,
          count(distinct user_id) filter (where day < ${from}::date)::int as previous
        from ${activity}`,
      ),
      db
        .select({
          status: practiceSessions.status,
          endReason: practiceSessions.endReason,
          count: sql<number>`count(*)::int`,
        })
        .from(practiceSessions)
        .where(startedBetween(from, to))
        .groupBy(practiceSessions.status, practiceSessions.endReason),
      db
        .select({
          id: practices.id,
          title: practices.title,
          type: practices.type,
          calls: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${practiceSessions.status} = 'completed')::int`,
          averageScore: sql<
            number | null
          >`avg(${practiceSessionEvaluations.overallScore})::float`,
        })
        .from(practiceSessions)
        .innerJoin(practices, eq(practices.id, practiceSessions.practiceId))
        .leftJoin(
          practiceSessionEvaluations,
          eq(practiceSessionEvaluations.sessionId, practiceSessions.id),
        )
        .where(startedBetween(from, to))
        .groupBy(practices.id)
        .orderBy(desc(sql`count(*)`), asc(practices.title))
        .limit(5),
    ])

  return buildUsage({
    ...periods,
    callRows,
    activityRows: activityRows.rows,
    activeUsers: activeUsers.rows[0] ?? { current: 0, previous: 0 },
    outcomeRows,
    topPractices,
  })
}

/** Milliseconds a reply spent in the given pipecat stages. */
const stageMs = (stages: readonly string[]) =>
  sql.join(
    stages.map((stage) => sql`coalesce((stages->>${stage})::float, 0)`),
    sql` + `,
  )

const STAGE_MS: Record<LatencyStageKey, SQL> = {
  ...(Object.fromEntries(
    LATENCY_STAGES.map((group) => [group.key, stageMs(group.stages)]),
  ) as Record<Exclude<LatencyStageKey, 'other'>, SQL>),
  // Stages sum to the total; whatever no group names is the rest of it.
  other: sql`greatest(total_ms - (${stageMs(LATENCY_STAGES.flatMap((group) => group.stages))}), 0)`,
}

const p50 = (value: SQL) =>
  sql`percentile_cont(0.5) within group (order by ${value})`
const p95 = (value: SQL) =>
  sql`percentile_cont(0.95) within group (order by ${value})`

export async function getAdminVoiceLatency(
  range: AdminUsageRange,
  now = new Date(),
): Promise<AdminVoiceLatency> {
  const periods = usagePeriods(range, now)
  const { from, to, previousFrom } = periods

  // Every reply of the AI buyer in calls that started in either period. The
  // voice backend saves the latency of a reply that answered the learner; the
  // opener and replies from before latency was recorded have none.
  const replies = sql`replies as (
    select
      (${practiceSessions.startedAt} at time zone ${timeZone})::date as day,
      coalesce(${practiceSessions.runtimeMetadata}->>'ttsProvider', 'unknown') as provider,
      coalesce((${practiceSessionTurns.metadata}->>'interrupted')::boolean, false) as interrupted,
      (${practiceSessionTurns.metadata}->'latency'->>'totalMs')::float as total_ms,
      ${practiceSessionTurns.metadata}->'latency'->'stages' as stages
    from ${practiceSessionTurns}
    inner join ${practiceSessions} on ${practiceSessions.id} = ${practiceSessionTurns.sessionId}
    where ${practiceSessionTurns.speaker} = 'buyer'
      and ${practiceSessions.startedAt} >= ${dayStart(previousFrom)}
      and ${practiceSessions.startedAt} < ${dayEnd(to)}
  )`
  const total = sql.raw('total_ms')
  const inPeriod = sql`day >= ${from}::date`
  // Mean and p95 of every stage, over the measured replies a query keeps.
  const stageColumns = sql.join(
    LATENCY_STAGE_KEYS.flatMap((key) => [
      sql`avg(${STAGE_MS[key]}) as ${sql.identifier(`${key}_avg`)}`,
      sql`${p95(STAGE_MS[key])} as ${sql.identifier(`${key}_p95`)}`,
    ]),
    sql`, `,
  )

  const [totalsRows, bucketRows, stageRows, providerRows] = await Promise.all([
    db.execute<LatencyTotalsRow>(
      sql`with ${replies} select
        ${inPeriod} as current,
        count(total_ms)::int as replies,
        ${p50(total)} as p50,
        ${p95(total)} as p95,
        count(*) filter (where total_ms > ${SLOW_REPLY_MS})::int as slow,
        count(*)::int as "buyerReplies",
        count(*) filter (where interrupted)::int as interrupted
      from replies group by 1`,
    ),
    db.execute<LatencyBucketRow>(
      sql`with ${replies} select
        ${DAY_BUCKET[periods.granularity]}::text as bucket,
        count(total_ms)::int as replies,
        ${p50(total)} as p50,
        ${p95(total)} as p95
      from replies where ${inPeriod} group by 1`,
    ),
    db.execute<StageColumns>(
      sql`with ${replies} select ${stageColumns}
      from replies where ${inPeriod} and total_ms is not null`,
    ),
    db.execute<LatencyProviderRow>(
      sql`with ${replies} select
        provider,
        count(*)::int as replies,
        ${p50(total)} as p50,
        ${p95(total)} as p95,
        ${stageColumns}
      from replies where ${inPeriod} and total_ms is not null
      group by 1
      order by 2 desc, 1`,
    ),
  ])

  return buildVoiceLatency({
    ...periods,
    totalsRows: totalsRows.rows,
    bucketRows: bucketRows.rows,
    stageRow: stageRows.rows[0] ?? null,
    providerRows: providerRows.rows,
  })
}

export async function getAdminServiceCosts(
  range: AdminUsageRange,
  now = new Date(),
): Promise<AdminServiceCosts> {
  const periods = usagePeriods(range, now)
  const { from, to, previousFrom } = periods

  // Spend counts on the day its call started. Usage of a purged session
  // keeps the day it was recorded.
  const day = sql<string>`(coalesce(${practiceSessions.startedAt}, ${serviceUsage.recordedAt}) at time zone ${timeZone})::date`
  const [usageRows, calls] = await Promise.all([
    db
      .select({
        day: sql<string>`${day}::text`,
        source: sql<CostUsageRow['source']>`${serviceUsage.source}`,
        service: sql<CostUsageRow['service']>`${serviceUsage.service}`,
        provider: serviceUsage.provider,
        model: serviceUsage.model,
        audioMs: sql<number>`sum(${serviceUsage.audioMs})::float`,
        characters: sql<number>`sum(${serviceUsage.characters})::float`,
        inputTokens: sql<number>`sum(${serviceUsage.inputTokens})::float`,
        cachedInputTokens: sql<number>`sum(${serviceUsage.cachedInputTokens})::float`,
        outputTokens: sql<number>`sum(${serviceUsage.outputTokens})::float`,
      })
      .from(serviceUsage)
      .leftJoin(
        practiceSessions,
        eq(practiceSessions.id, serviceUsage.sessionId),
      )
      .where(
        and(
          gte(day, sql`${previousFrom}::date`),
          lt(day, sql`(${to}::date + 1)`),
        ),
      )
      .groupBy(sql`1`, sql`2`, sql`3`, sql`4`, sql`5`),
    db
      .select({
        current: sql<number>`count(*) filter (where ${practiceSessions.startedAt} >= ${dayStart(from)})::int`,
        previous: sql<number>`count(*) filter (where ${practiceSessions.startedAt} < ${dayStart(from)})::int`,
      })
      .from(practiceSessions)
      .where(startedBetween(previousFrom, to)),
  ])

  return buildServiceCosts({
    ...periods,
    usageRows,
    calls: calls[0] ?? { current: 0, previous: 0 },
  })
}

async function readSessions(options: { sessionId?: string; limit: number }) {
  await reconcileAdminSessions(options.sessionId)
  const now = Date.now()
  const rows = await db
    .select({
      id: practiceSessions.id,
      status: practiceSessions.status,
      endReason: practiceSessions.endReason,
      startedAt: practiceSessions.startedAt,
      completedAt: practiceSessions.completedAt,
      learnerName: user.name,
      practiceTitle: practices.title,
      overallScore: practiceSessionEvaluations.overallScore,
      evaluatedAt: practiceSessionEvaluations.createdAt,
      evaluationError: sql<
        string | null
      >`${practiceSessions.runtimeMetadata}->>'evaluationError'`,
      operationActive: sessionOperationActive(practiceSessions.id),
    })
    .from(practiceSessions)
    .innerJoin(user, eq(user.id, practiceSessions.userId))
    .innerJoin(practices, eq(practices.id, practiceSessions.practiceId))
    .leftJoin(
      practiceSessionEvaluations,
      eq(practiceSessionEvaluations.sessionId, practiceSessions.id),
    )
    .where(
      and(
        isNotNull(practiceSessions.startedAt),
        options.sessionId
          ? eq(practiceSessions.id, options.sessionId)
          : undefined,
      ),
    )
    .orderBy(desc(practiceSessions.startedAt))
    .limit(options.limit)

  return rows.map((row): AdminSession => {
    const startedAt = row.startedAt!
    // Only a call that is still running lasts until now. Calls abandoned
    // before the end time was stored have no known duration.
    const endedAt =
      row.completedAt?.getTime() ?? (row.status === 'in_progress' ? now : null)
    return {
      id: row.id,
      learnerName: row.learnerName,
      practiceTitle: row.practiceTitle,
      outcome: sessionOutcome(row.status, row.endReason),
      startedAt: startedAt.toISOString(),
      durationSeconds:
        endedAt == null
          ? null
          : Math.max(0, Math.round((endedAt - startedAt.getTime()) / 1000)),
      overallScore: row.overallScore,
      // Like the learner's own feedback: without a result, the evaluation is
      // pending only while End is still working on the session. A process
      // that stopped halfway leaves nothing running.
      evaluation: row.evaluatedAt
        ? 'scored'
        : row.status !== 'completed'
          ? 'none'
          : row.evaluationError || !row.operationActive
            ? 'failed'
            : 'pending',
    }
  })
}

export function listRecentSessions(limit = 10) {
  return readSessions({ limit })
}

/** Who receives outage emails: verified accounts holding the admin role. */
export async function listAdminEmails() {
  const { sql: text, params: values } = db
    .select({ email: user.email })
    .from(user)
    .where(
      and(
        eq(user.emailVerified, true),
        sql`${ADMIN_ROLE} = any(${user.roles})`,
      ),
    )
    .toSQL()
  const client = await db.$client.connect()
  // As with the database health probe, pg owns the query deadline and a
  // failed query destroys its connection instead of occupying the pool.
  const query: QueryConfig & { query_timeout: number } = {
    text,
    values,
    query_timeout: ADMIN_RECIPIENT_QUERY_TIMEOUT_MS,
  }
  try {
    const result = await client.query<{ email: string }>(query)
    client.release()
    return result.rows.map((row) => row.email)
  } catch (error) {
    client.release(true)
    throw error
  }
}

export async function getSessionTranscript(
  sessionId: string,
): Promise<AdminSessionTranscript | null> {
  const session = (await readSessions({ sessionId, limit: 1 })).at(0)
  if (!session) return null
  const turns = await db
    .select()
    .from(practiceSessionTurns)
    .where(eq(practiceSessionTurns.sessionId, sessionId))
    .orderBy(asc(practiceSessionTurns.sequence))
  return {
    session,
    turns: turns.map((turn) => ({
      sequence: turn.sequence,
      speaker: turn.speaker,
      text: turn.text,
      createdAt: turn.createdAt.toISOString(),
      interrupted: turn.metadata?.interrupted === true,
      latencyMs: replyLatencyMs(turn.metadata),
    })),
    traceUrl: langfuseSessionUrl(sessionId),
  }
}

function replyLatencyMs(metadata: Record<string, unknown> | null) {
  const latency = metadata?.latency as { totalMs?: unknown } | undefined
  return typeof latency?.totalMs === 'number' ? latency.totalMs : null
}

/** The voice backend traces each call as a Langfuse session of the same id. */
function langfuseSessionUrl(sessionId: string) {
  if (!env.LANGFUSE_BASE_URL || !env.LANGFUSE_PROJECT_ID) return null
  const base = env.LANGFUSE_BASE_URL.replace(/\/+$/, '')
  return `${base}/project/${encodeURIComponent(env.LANGFUSE_PROJECT_ID)}/sessions/${sessionId}`
}
