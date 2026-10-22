import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '#/db'
import {
  competencies,
  practices,
  practiceAgentConfigs,
  practiceCompetencies,
  practiceSessionCompetencyScores,
  practiceSessionEvaluations,
  practiceSessions,
  practiceSessionTurns,
} from '#/db/schema'
import { buildPerformanceSummary } from '#/lib/practice/performance'
import type {
  PerformanceCatalogPractice,
  PerformanceDifficulty,
  PerformancePeriod,
  PerformanceSessionRecord,
  PerformanceSummary,
} from '#/lib/practice/performance'
import { listLearnerPractices } from './practice-domain'

export async function getPerformanceSummary(
  userId: string,
  workspaceId: string,
  period: PerformancePeriod,
  difficulty: PerformanceDifficulty | null = null,
): Promise<PerformanceSummary> {
  // Repeatable-read keeps session deletion and evaluation persistence from yielding partial summaries.
  const records = await db.transaction(
    async (tx) => {
      const sessions = await tx
        .select()
        .from(practiceSessions)
        .where(
          and(
            eq(practiceSessions.userId, userId),
            eq(practiceSessions.workspaceId, workspaceId),
            eq(practiceSessions.status, 'completed'),
            isNull(practiceSessions.deletedAt),
          ),
        )
      const evaluations = await tx
        .select({ evaluation: practiceSessionEvaluations })
        .from(practiceSessionEvaluations)
        .innerJoin(
          practiceSessions,
          eq(practiceSessionEvaluations.sessionId, practiceSessions.id),
        )
        .where(
          and(
            eq(practiceSessions.userId, userId),
            eq(practiceSessions.workspaceId, workspaceId),
            eq(practiceSessions.status, 'completed'),
            isNull(practiceSessions.deletedAt),
          ),
        )
      const scores = await tx
        .select({
          sessionId: practiceSessionCompetencyScores.sessionId,
          code: competencies.code,
          name: competencies.name,
          assessmentStatus: practiceSessionCompetencyScores.assessmentStatus,
          findings: practiceSessionCompetencyScores.findings,
          rubric: practiceSessionCompetencyScores.scoringRubric,
          weight: practiceCompetencies.weight,
        })
        .from(practiceSessionCompetencyScores)
        .innerJoin(
          practiceSessions,
          eq(practiceSessionCompetencyScores.sessionId, practiceSessions.id),
        )
        .innerJoin(
          competencies,
          eq(practiceSessionCompetencyScores.competencyId, competencies.id),
        )
        .leftJoin(
          practiceCompetencies,
          and(
            eq(practiceCompetencies.practiceId, practiceSessions.practiceId),
            eq(
              practiceCompetencies.competencyId,
              practiceSessionCompetencyScores.competencyId,
            ),
          ),
        )
        .where(
          and(
            eq(practiceSessions.userId, userId),
            eq(practiceSessions.workspaceId, workspaceId),
            eq(practiceSessions.status, 'completed'),
            isNull(practiceSessions.deletedAt),
          ),
        )
      const turns = await tx
        .select({
          sessionId: practiceSessionTurns.sessionId,
          sequence: practiceSessionTurns.sequence,
          speaker: practiceSessionTurns.speaker,
          text: practiceSessionTurns.text,
        })
        .from(practiceSessionTurns)
        .innerJoin(
          practiceSessions,
          eq(practiceSessionTurns.sessionId, practiceSessions.id),
        )
        .where(
          and(
            eq(practiceSessions.userId, userId),
            eq(practiceSessions.workspaceId, workspaceId),
            eq(practiceSessions.status, 'completed'),
            isNull(practiceSessions.deletedAt),
          ),
        )
        .orderBy(asc(practiceSessionTurns.sequence))
      const contextRows = sessions.length
        ? await tx
            .select({
              practice: practices,
              config: practiceAgentConfigs.config,
            })
            .from(practices)
            .leftJoin(
              practiceAgentConfigs,
              eq(practiceAgentConfigs.practiceId, practices.id),
            )
            .where(
              inArray(practices.id, [
                ...new Set(sessions.map((session) => session.practiceId)),
              ]),
            )
        : []
      const practiceById = new Map(
        contextRows.map((row) => [row.practice.id, row]),
      )
      const evaluationBySession = new Map(
        evaluations.map((row) => [row.evaluation.sessionId, row.evaluation]),
      )
      const scoreBySession = new Map<string, typeof scores>()
      for (const score of scores) {
        const group = scoreBySession.get(score.sessionId) ?? []
        group.push(score)
        scoreBySession.set(score.sessionId, group)
      }
      const turnBySession = new Map<
        string,
        { sequence: number; speaker: 'user' | 'assistant'; text: string }[]
      >()
      for (const turn of turns) {
        const group = turnBySession.get(turn.sessionId) ?? []
        group.push({
          sequence: turn.sequence,
          speaker: turn.speaker === 'salesperson' ? 'user' : 'assistant',
          text: turn.text,
        })
        turnBySession.set(turn.sessionId, group)
      }
      return sessions.map((session): PerformanceSessionRecord => {
        const evaluation = evaluationBySession.get(session.id)
        const retained = practiceById.get(session.practiceId)
        return {
          id: session.id,
          userId: session.userId,
          practiceId: session.practiceId,
          status: session.status,
          deletedAt: session.deletedAt?.toISOString() ?? null,
          createdAt: session.createdAt.toISOString(),
          startedAt: session.startedAt?.toISOString() ?? null,
          completedAt: session.completedAt?.toISOString() ?? null,
          context: retained
            ? {
                practice: retained.practice,
                objections:
                  retained.config?.objections.map((item) => ({
                    key: item.key,
                    category: item.category,
                  })) ?? [],
              }
            : null,
          transcript: turnBySession.get(session.id) ?? [],
          evaluation: evaluation
            ? {
                discoveredInsightKeys: evaluation.discoveredInsightKeys,
                missedInsightKeys: evaluation.missedInsightKeys,
                objectiveOutcome: evaluation.objectiveOutcome,
                objectiveEvidence: evaluation.objectiveEvidence,
                objectionOutcomes: evaluation.objectionOutcomes,
                scores: (scoreBySession.get(session.id) ?? []).map((score) => ({
                  code: score.code,
                  name: score.name,
                  weight: score.weight,
                  assessmentStatus: score.assessmentStatus,
                  findings: score.findings,
                  rubric: score.rubric,
                })),
              }
            : null,
        }
      })
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
  const visiblePractices = await listLearnerPractices(userId, workspaceId)
  // Use only current learner-visible practices for next focus; private prompt/config stays server-side.
  const mappings = visiblePractices.length
    ? await db
        .select({
          practiceId: practiceCompetencies.practiceId,
          code: competencies.code,
        })
        .from(practiceCompetencies)
        .innerJoin(
          competencies,
          eq(practiceCompetencies.competencyId, competencies.id),
        )
        .where(
          inArray(
            practiceCompetencies.practiceId,
            visiblePractices.map((item) => item.id),
          ),
        )
    : []
  const catalog: PerformanceCatalogPractice[] = visiblePractices.map(
    (practice) => ({
      id: practice.id,
      title: practice.title,
      type: practice.type,
      difficulty: practice.difficulty,
      competencyCodes: mappings
        .filter((item) => item.practiceId === practice.id)
        .map((item) => item.code),
    }),
  )
  return buildPerformanceSummary(userId, records, catalog, period, difficulty)
}
