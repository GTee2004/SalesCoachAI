import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  lt,
  sql,
} from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import { db } from '#/db'
import {
  competencies,
  practiceAgentConfigs,
  practiceCompetencies,
  practiceSessionCompetencyScores,
  practiceSessionEvaluations,
  practiceSessions,
  practiceSessionTurns,
  practices,
  salesOfferings,
} from '#/db/schema'
import {
  agentConfigSchema,
  learnerBriefSchema,
  salesOfferingSchema,
} from '#/lib/practice/validation'
import { summarizeAssessment } from '#/lib/practice/assessment'
import { pickKeyCoachingPoint } from '#/lib/practice/coaching'
import { scoreCompetency } from '#/lib/practice/scoring'
import { COMPETENCY_CATALOGUE } from '#/lib/practice/scorecards'
import {
  micTypeSchema,
  practiceFeedbackResultSchema,
  ttsProviderSchema,
  DEFAULT_TTS_PROVIDER,
} from '#/lib/voice/contracts'
import type {
  PracticeFeedbackResult,
  PracticeSessionResponse,
} from '#/lib/voice/contracts'
import type {
  PracticeHistoryInput,
  PracticeHistoryResult,
} from '#/lib/practice/history'
import {
  getLearnerPractice,
  getLearnerPracticeCompetencies,
  learnerBriefView,
  practiceAccess,
  offeringAccess,
} from './practice-domain'
import {
  lockLearnerProfile,
  rebuildLearnerCompetencies,
} from './learner-profile'
import { getWorkspaceForUser } from './workspaces'

/** Cleanup uses the session's workspace, even after another tab switches. */
export async function getOwnedSessionForCleanup({
  userId,
  sessionId,
}: {
  userId: string
  sessionId: string
}) {
  const current = await db.query.practiceSessions.findFirst({
    where: and(
      eq(practiceSessions.id, sessionId),
      eq(practiceSessions.userId, userId),
    ),
  })
  if (!current) return null

  // Ending an existing call needs membership, but must remain possible while
  // a workspace is awaiting payment. This does not grant practice access.
  const workspace = await getWorkspaceForUser(userId, current.workspaceId)
  return workspace ? current : null
}

export async function createPracticeSession(
  userId: string,
  practiceId: string,
  workspaceId: string,
) {
  return db.transaction(async (tx) => {
    const practice = (
      await tx
        .select({ id: practices.id })
        .from(practices)
        .innerJoin(
          salesOfferings,
          eq(practices.salesOfferingId, salesOfferings.id),
        )
        .where(
          and(
            eq(practices.id, practiceId),
            eq(practices.status, 'published'),
            practiceAccess(workspaceId),
            offeringAccess(workspaceId),
          ),
        )
        // SHARE allows simultaneous session creation but blocks the non-key
        // UPDATE used to archive. Hold it until the session insert commits.
        .for('share')
    ).at(0)
    if (!practice) return null
    const created = await tx
      .insert(practiceSessions)
      .values({ userId, practiceId: practice.id, workspaceId })
      .returning({ id: practiceSessions.id, status: practiceSessions.status })
    return created.at(0) ?? null
  })
}

export async function listOwnedPracticeSessions(
  userId: string,
  input: PracticeHistoryInput,
  workspaceId: string,
): Promise<PracticeHistoryResult> {
  const conditions: SQL[] = [
    eq(practiceSessions.userId, userId),
    eq(practiceSessions.workspaceId, workspaceId),
    isNull(practiceSessions.deletedAt),
  ]

  if (input.type !== 'all') conditions.push(eq(practices.type, input.type))
  if (input.evaluation === 'graded')
    conditions.push(isNotNull(practiceSessionEvaluations.overallScore))
  if (input.evaluation === 'ungraded')
    conditions.push(isNull(practiceSessionEvaluations.overallScore))
  if (input.evaluation === 'under_50')
    conditions.push(lt(practiceSessionEvaluations.overallScore, 50))
  if (input.evaluation === '50_79') {
    conditions.push(gte(practiceSessionEvaluations.overallScore, 50))
    conditions.push(lte(practiceSessionEvaluations.overallScore, 79))
  }
  if (input.evaluation === '80_100')
    conditions.push(gte(practiceSessionEvaluations.overallScore, 80))
  if (input.from)
    conditions.push(
      sql`coalesce(${practiceSessions.startedAt}, ${practiceSessions.createdAt}) >= ${new Date(input.from)}`,
    )
  if (input.to)
    conditions.push(
      sql`coalesce(${practiceSessions.startedAt}, ${practiceSessions.createdAt}) <= ${new Date(input.to)}`,
    )

  const where = and(...conditions)
  const [{ total }, rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(practiceSessions)
      .innerJoin(practices, eq(practiceSessions.practiceId, practices.id))
      .innerJoin(
        practiceAgentConfigs,
        eq(practiceAgentConfigs.practiceId, practices.id),
      )
      .leftJoin(
        practiceSessionEvaluations,
        eq(practiceSessionEvaluations.sessionId, practiceSessions.id),
      )
      .where(where)
      .then((result) => result[0] ?? { total: 0 }),
    db
      .select({
        id: practiceSessions.id,
        status: practiceSessions.status,
        createdAt: practiceSessions.createdAt,
        startedAt: practiceSessions.startedAt,
        completedAt: practiceSessions.completedAt,
        score: practiceSessionEvaluations.overallScore,
        title: practices.title,
        type: practices.type,
        difficulty: practices.difficulty,
        offering: salesOfferings.offering,
        agentConfig: practiceAgentConfigs.config,
      })
      .from(practiceSessions)
      .innerJoin(practices, eq(practiceSessions.practiceId, practices.id))
      .innerJoin(
        practiceAgentConfigs,
        eq(practiceAgentConfigs.practiceId, practices.id),
      )
      .leftJoin(
        salesOfferings,
        eq(practices.salesOfferingId, salesOfferings.id),
      )
      .leftJoin(
        practiceSessionEvaluations,
        eq(practiceSessionEvaluations.sessionId, practiceSessions.id),
      )
      .where(where)
      .orderBy(
        desc(
          sql`coalesce(${practiceSessions.startedAt}, ${practiceSessions.createdAt})`,
        ),
        desc(practiceSessions.id),
      )
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
  ])

  return {
    items: rows.map((row) => {
      const agentConfig = agentConfigSchema.parse(row.agentConfig)
      const offering = row.offering
        ? salesOfferingSchema.parse(row.offering)
        : null
      const startedAt = row.startedAt ?? row.createdAt
      const computedDuration = row.completedAt
        ? Math.max(
            0,
            Math.round(
              (row.completedAt.getTime() - startedAt.getTime()) / 1_000,
            ),
          )
        : null
      return {
        id: row.id,
        status: row.status,
        startedAt: startedAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
        durationSeconds: computedDuration,
        score: row.score,
        practice: {
          title: row.title,
          type: row.type,
          difficulty: row.difficulty,
          projectName: offering?.projectName ?? null,
        },
        customer: {
          name: agentConfig.buyer.name,
          addressTerm: agentConfig.buyer.addressTerm,
        },
      }
    }),
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  }
}

export async function deleteOwnedPracticeSession(
  userId: string,
  sessionId: string,
  workspaceId: string,
): Promise<'deleted' | 'unfinished' | 'missing'> {
  return withSessionOperation(sessionId, () =>
    db.transaction(async (tx) => {
      await lockLearnerProfile(tx, userId, workspaceId)
      const current = (
        await tx
          .select()
          .from(practiceSessions)
          .where(
            and(
              eq(practiceSessions.id, sessionId),
              eq(practiceSessions.userId, userId),
              eq(practiceSessions.workspaceId, workspaceId),
            ),
          )
          .for('update')
      ).at(0)
      if (!current) return 'missing'
      if (current.deletedAt) return 'deleted'
      if (current.status !== 'completed' && current.status !== 'abandoned')
        return 'unfinished'
      const scores = await tx
        .select({ competencyId: practiceSessionCompetencyScores.competencyId })
        .from(practiceSessionCompetencyScores)
        .where(
          and(
            eq(practiceSessionCompetencyScores.sessionId, sessionId),
            isNotNull(practiceSessionCompetencyScores.profileAppliedAt),
          ),
        )
      await tx
        .update(practiceSessions)
        .set({ deletedAt: new Date() })
        .where(eq(practiceSessions.id, sessionId))
      await rebuildLearnerCompetencies(
        tx,
        userId,
        scores.map((score) => score.competencyId),
        workspaceId,
      )
      return 'deleted'
    }),
  )
}

export class SessionOperationBusyError extends Error {
  constructor() {
    super('Another operation is already running for this session')
    this.name = 'SessionOperationBusyError'
  }
}

async function acquireSessionLock(sessionId: string) {
  const client = await db.$client.connect()
  try {
    const result = await client.query<{ acquired: boolean }>(
      'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
      [sessionId],
    )
    return { client, acquired: result.rows[0]?.acquired === true }
  } catch (error) {
    client.release()
    throw error
  }
}

async function releaseSessionLock(client: PoolClient, sessionId: string) {
  try {
    await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [
      sessionId,
    ])
  } finally {
    client.release()
  }
}

export async function withSessionOperation<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquireSessionLock(sessionId)
  if (!lock.acquired) {
    lock.client.release()
    throw new SessionOperationBusyError()
  }
  try {
    return await operation()
  } finally {
    await releaseSessionLock(lock.client, sessionId)
  }
}

/**
 * Whether `withSessionOperation` is running for the session, as a condition
 * for queries that list many sessions. It reads `pg_locks` instead of trying
 * the lock, so the reader never makes a concurrent Start or End fail as busy.
 * A bigint advisory key is stored there as its two 32-bit halves.
 */
export function sessionOperationActive(sessionId: SQLWrapper) {
  return sql<boolean>`exists (
    select 1 from pg_locks as held
    where held.locktype = 'advisory'
      and held.granted
      and held.objsubid = 1
      and held.database = (select oid from pg_database where datname = current_database())
      and ((held.classid::bigint << 32) | held.objid::bigint) = hashtextextended(${sessionId}::text, 0)
  )`
}

export async function isSessionOperationActive(sessionId: string) {
  const lock = await acquireSessionLock(sessionId)
  if (!lock.acquired) {
    lock.client.release()
    return true
  }
  await releaseSessionLock(lock.client, sessionId)
  return false
}

type SessionSnapshot = Omit<
  PracticeSessionResponse,
  'signalingUrl' | 'connectionToken' | 'connectionExpiresAt'
>

export async function getOwnedSessionSnapshot({
  userId,
  sessionId,
  workspaceId,
}: {
  userId: string
  sessionId: string
  workspaceId: string
}): Promise<SessionSnapshot | null> {
  const current = await db.query.practiceSessions.findFirst({
    where: and(
      eq(practiceSessions.id, sessionId),
      eq(practiceSessions.userId, userId),
      eq(practiceSessions.workspaceId, workspaceId),
      isNull(practiceSessions.deletedAt),
    ),
  })
  if (!current) return null

  let learnerPractice: PracticeSessionResponse['practice'] =
    await getLearnerPractice(current.practiceId, userId, current.workspaceId)
  if (!learnerPractice) {
    const archivedRows = await db
      .select({
        id: practices.id,
        type: practices.type,
        title: practices.title,
        description: practices.description,
        difficulty: practices.difficulty,
        learnerBrief: practices.learnerBrief,
        estimatedMinutes: practices.estimatedMinutes,
        offering: salesOfferings.offering,
        agentConfig: practiceAgentConfigs.config,
      })
      .from(practices)
      .innerJoin(
        practiceAgentConfigs,
        eq(practiceAgentConfigs.practiceId, practices.id),
      )
      .leftJoin(
        salesOfferings,
        eq(practices.salesOfferingId, salesOfferings.id),
      )
      .where(
        and(
          eq(practices.id, current.practiceId),
          practiceAccess(current.workspaceId),
          offeringAccess(current.workspaceId),
        ),
      )
      .limit(1)
    const archived = archivedRows.at(0)

    if (archived) {
      learnerPractice = {
        id: archived.id,
        type: archived.type,
        title: archived.title,
        description: archived.description,
        difficulty: archived.difficulty,
        learnerBrief: learnerBriefView(
          learnerBriefSchema.parse(archived.learnerBrief),
          agentConfigSchema.parse(archived.agentConfig),
        ),
        offering: archived.offering
          ? salesOfferingSchema.parse(archived.offering)
          : null,
        estimatedMinutes: archived.estimatedMinutes,
        competencies: await getLearnerPracticeCompetencies(
          archived.id,
          archived.type,
        ),
      }
    }
  }

  const turns = await db
    .select()
    .from(practiceSessionTurns)
    .where(eq(practiceSessionTurns.sessionId, current.id))
    .orderBy(asc(practiceSessionTurns.sequence))

  const provider = ttsProviderSchema.safeParse(
    current.runtimeMetadata?.ttsProvider,
  )
  const ttsProvider = provider.success ? provider.data : DEFAULT_TTS_PROVIDER
  const micType = micTypeSchema.safeParse(current.runtimeMetadata?.micType)

  return {
    sessionId: current.id,
    practice: learnerPractice,
    status: current.status,
    ttsProvider,
    micType: micType.success ? micType.data : undefined,
    createdAt: current.createdAt.toISOString(),
    startedAt: current.startedAt?.toISOString() ?? null,
    endedAt: current.completedAt?.toISOString() ?? null,
    endReason: current.endReason,
    transcript: turns.map((turn) => ({
      id: turn.id,
      role: turn.speaker === 'salesperson' ? 'user' : 'assistant',
      text: turn.text,
      final: true,
      timestamp: turn.createdAt.toISOString(),
      sequence: turn.sequence,
      interrupted: turn.metadata?.interrupted === true,
    })),
  }
}

export async function getOwnedSessionFeedback({
  userId,
  sessionId,
  workspaceId,
}: {
  userId: string
  sessionId: string
  workspaceId: string
}): Promise<PracticeFeedbackResult | null> {
  const current = await db.query.practiceSessions.findFirst({
    where: and(
      eq(practiceSessions.id, sessionId),
      eq(practiceSessions.userId, userId),
      eq(practiceSessions.workspaceId, workspaceId),
      isNull(practiceSessions.deletedAt),
    ),
  })
  if (!current) return null

  const evaluation = await db.query.practiceSessionEvaluations.findFirst({
    where: eq(practiceSessionEvaluations.sessionId, sessionId),
  })
  if (!evaluation) {
    if (current.runtimeMetadata?.evaluationError) {
      return { state: 'failed', errorCode: 'evaluation_failed' }
    }
    if (current.status !== 'completed') return { state: 'not-requested' }
    return (await isSessionOperationActive(sessionId))
      ? { state: 'pending' }
      : { state: 'failed', errorCode: 'evaluation_incomplete' }
  }

  const storedScores = await db
    .select({
      code: competencies.code,
      name: competencies.name,
      score: practiceSessionCompetencyScores.score,
      assessmentStatus: practiceSessionCompetencyScores.assessmentStatus,
      feedback: practiceSessionCompetencyScores.feedback,
      evidence: practiceSessionCompetencyScores.evidence,
      findings: practiceSessionCompetencyScores.findings,
      scoringRubric: practiceSessionCompetencyScores.scoringRubric,
      scoreExplanation: practiceSessionCompetencyScores.scoreExplanation,
      weight: practiceCompetencies.weight,
    })
    .from(practiceSessionCompetencyScores)
    .innerJoin(
      competencies,
      eq(practiceSessionCompetencyScores.competencyId, competencies.id),
    )
    .leftJoin(
      practiceCompetencies,
      and(
        eq(practiceCompetencies.practiceId, current.practiceId),
        eq(
          practiceCompetencies.competencyId,
          practiceSessionCompetencyScores.competencyId,
        ),
      ),
    )
    .where(eq(practiceSessionCompetencyScores.sessionId, sessionId))
  // Show skills in the order they come up during a call.
  const callOrder = (code: string) => {
    const index = COMPETENCY_CATALOGUE.findIndex((item) => item.code === code)
    return index < 0 ? COMPETENCY_CATALOGUE.length : index
  }
  // Re-score stored findings so every session follows the current scoring rule.
  const scores = storedScores
    .map((score) => ({
      ...score,
      ...scoreCompetency(
        score.code,
        score.scoringRubric,
        score.findings,
        score.assessmentStatus,
      ),
    }))
    .sort((a, b) => callOrder(a.code) - callOrder(b.code))
  // Weights come from the practice today; without all of them keep the stored total.
  const overallScore = scores.every((score) => score.weight !== null)
    ? summarizeAssessment(
        scores.map((score) => ({ ...score, weight: score.weight! })),
      ).overallScore
    : evaluation.overallScore

  return practiceFeedbackResultSchema.parse({
    state: 'ready',
    overallScore,
    assessmentCoverage: evaluation.assessmentCoverage,
    summary: evaluation.summary,
    summaryFindings: evaluation.summaryFindings,
    strengths: evaluation.strengths,
    improvements: evaluation.improvements,
    // Recomputed from stored findings so older evaluations get the same pick.
    keyCoachingPoint: pickKeyCoachingPoint({
      competencies: scores.map((score) => ({
        ...score,
        weight: score.weight ?? undefined,
      })),
      objectiveOutcome: evaluation.objectiveOutcome,
      objectiveEvidence: evaluation.objectiveEvidence,
      objectionOutcomes: evaluation.objectionOutcomes,
    }),
    discoveredInsightKeys: evaluation.discoveredInsightKeys,
    missedInsightKeys: evaluation.missedInsightKeys,
    objectiveOutcome: evaluation.objectiveOutcome,
    objectiveFeedback: evaluation.objectiveFeedback,
    objectiveEvidence: evaluation.objectiveEvidence,
    objectionOutcomes: evaluation.objectionOutcomes,
    competencyScores: scores,
    recommendation: evaluation.nextPracticeRecommendation,
  })
}
