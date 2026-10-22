import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '#/db'
import {
  practiceSessionCompetencyScores,
  practiceSessionEvaluations,
  practiceSessions,
  practiceSessionTurns,
} from '#/db/schema'
import type { PracticeSession } from '#/db/schema'
import { calculateEvaluation } from '#/lib/practice/scoring'
import { summarizeAssessment } from '#/lib/practice/assessment'
import { getRuntimePractice } from './practice-domain'
import { withSessionOperation } from './practice-sessions'
import { evaluateVoiceTranscript } from './voice-backend'
import { applySessionProfileEvidence } from './learner-profile'
import { recordServiceUsage } from './service-usage'

export async function evaluatePracticeSession(sessionId: string) {
  return withSessionOperation(sessionId, () =>
    evaluatePracticeSessionUnlocked(sessionId),
  )
}

/** Call only while the caller owns the session operation lock. */
export async function evaluatePracticeSessionUnlocked(sessionId: string) {
  const session = await db.query.practiceSessions.findFirst({
    where: and(
      eq(practiceSessions.id, sessionId),
      isNull(practiceSessions.deletedAt),
    ),
  })
  if (!session || session.status !== 'completed')
    throw new Error('Session is not completed')
  const existing = await db.query.practiceSessionEvaluations.findFirst({
    where: eq(practiceSessionEvaluations.sessionId, sessionId),
  })
  if (existing) {
    await tryApplyProfileEvidence(session)
    return existing
  }
  const runtime = await getRuntimePractice(session.practiceId, {
    userId: session.userId,
    workspaceId: session.workspaceId,
  })
  if (!runtime) throw new Error('Practice is unavailable')
  const turns = await db
    .select({
      sequence: practiceSessionTurns.sequence,
      speaker: practiceSessionTurns.speaker,
      text: practiceSessionTurns.text,
    })
    .from(practiceSessionTurns)
    .where(eq(practiceSessionTurns.sessionId, session.id))
    .orderBy(asc(practiceSessionTurns.sequence))
  const transcript = turns.map((turn) => ({
    sequence: turn.sequence,
    speaker:
      turn.speaker === 'salesperson'
        ? ('user' as const)
        : ('assistant' as const),
    text: turn.text,
  }))
  const usageKey = randomUUID()
  const assessment = await evaluateVoiceTranscript(
    {
      practice: {
        id: runtime.practice.id,
        type: runtime.practice.type,
        learnerBrief: runtime.learnerBrief,
        offering: runtime.offering,
      },
      agentConfig: runtime.config,
      competencies: runtime.competencies.map((item) => ({
        code: item.code,
        name: item.name,
        weight: item.weight,
        rubric: item.rubric,
      })),
      turns: transcript,
    },
    (items) =>
      recordServiceUsage({ sessionId, usageKey, source: 'evaluation', items }),
  )
  const result = calculateEvaluation(
    assessment,
    runtime.competencies,
    transcript,
    runtime.config.hiddenInsights.map((item) => item.key),
    runtime.config.objections.map((item) => item.key),
  )
  const { overallScore, assessmentCoverage } = summarizeAssessment(
    runtime.competencies.map((item) => ({
      ...result.competencyScores.find(
        (entry) => entry.competencyCode === item.code,
      )!,
      weight: item.weight,
    })),
  )
  const persisted = await db.transaction(async (tx) => {
    const insertedRows = await tx
      .insert(practiceSessionEvaluations)
      .values({
        sessionId,
        overallScore,
        assessmentCoverage,
        summary: result.summary,
        summaryFindings: result.summaryFindings,
        strengths: result.strengths,
        improvements: result.improvements,
        keyCoachingPoint: result.keyCoachingPoint,
        discoveredInsightKeys: result.discoveredInsightKeys,
        missedInsightKeys: result.missedInsightKeys,
        objectiveOutcome: result.objectiveOutcome,
        objectiveFeedback: result.objectiveFeedback,
        objectiveEvidence: result.objectiveEvidence,
        objectionOutcomes: result.objectionOutcomes,
        nextPracticeRecommendation: null,
      })
      .onConflictDoNothing()
      .returning()
    if (insertedRows.length === 0)
      return (await tx.query.practiceSessionEvaluations.findFirst({
        where: eq(practiceSessionEvaluations.sessionId, sessionId),
      }))!
    const inserted = insertedRows[0]
    for (const item of runtime.competencies) {
      const score = result.competencyScores.find(
        (entry) => entry.competencyCode === item.code,
      )!
      await tx.insert(practiceSessionCompetencyScores).values({
        sessionId,
        competencyId: item.id,
        score: score.score,
        assessmentStatus: score.assessmentStatus,
        feedback: score.feedback,
        evidence: score.evidence,
        findings: score.findings,
        scoringRubric: score.scoringRubric,
        scoreExplanation: score.scoreExplanation,
      })
    }
    return inserted
  })
  await tryApplyProfileEvidence(session)
  return persisted
}

async function tryApplyProfileEvidence(session: PracticeSession) {
  try {
    await applySessionProfileEvidence(
      session.id,
      session.userId,
      session.workspaceId,
    )
  } catch (error) {
    // Evaluation remains valid; a later evaluation retry can reapply this evidence.
    console.error('Learner profile update failed', {
      sessionId: session.id,
      error,
    })
  }
}
