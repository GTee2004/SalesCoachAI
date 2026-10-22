import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '#/db'
import {
  competencies,
  learnerCompetencyProfiles,
  practiceSessionCompetencyScores,
  practiceSessions,
} from '#/db/schema'
import { listLearnerPractices } from '#/lib/server/practice-domain'

export async function getCompetencyProfiles(
  userId: string,
  workspaceId: string,
) {
  const assessments = db
    .select({
      competencyId: practiceSessionCompetencyScores.competencyId,
      assessedSessionCount: sql<number>`count(distinct ${practiceSessions.id})`
        .mapWith(Number)
        .as('assessed_session_count'),
      scenarioCount: sql<number>`count(distinct ${practiceSessions.practiceId})`
        .mapWith(Number)
        .as('scenario_count'),
    })
    .from(practiceSessionCompetencyScores)
    .innerJoin(
      practiceSessions,
      eq(practiceSessionCompetencyScores.sessionId, practiceSessions.id),
    )
    .where(
      and(
        eq(practiceSessions.userId, userId),
        eq(practiceSessions.workspaceId, workspaceId),
        eq(practiceSessions.status, 'completed'),
        isNull(practiceSessions.deletedAt),
        isNotNull(practiceSessionCompetencyScores.profileAppliedAt),
        sql`${practiceSessionCompetencyScores.assessmentStatus} in ('observed', 'opportunity_missed')`,
      ),
    )
    .groupBy(practiceSessionCompetencyScores.competencyId)
    .as('assessments')
  const profiles = await db
    .select({
      code: competencies.code,
      name: competencies.name,
      masteryScore: learnerCompetencyProfiles.masteryScore,
      assessedSessionCount:
        sql<number>`coalesce(${assessments.assessedSessionCount}, 0)`.mapWith(
          Number,
        ),
      scenarioCount:
        sql<number>`coalesce(${assessments.scenarioCount}, 0)`.mapWith(Number),
      lastPracticedAt: learnerCompetencyProfiles.lastPracticedAt,
    })
    .from(learnerCompetencyProfiles)
    .innerJoin(
      competencies,
      eq(learnerCompetencyProfiles.competencyId, competencies.id),
    )
    .leftJoin(
      assessments,
      eq(learnerCompetencyProfiles.competencyId, assessments.competencyId),
    )
    .where(
      and(
        eq(learnerCompetencyProfiles.userId, userId),
        eq(learnerCompetencyProfiles.workspaceId, workspaceId),
      ),
    )
  return profiles.map((profile) => ({
    ...profile,
    // Coverage is not calibrated confidence or a claim of consistent behavior.
    evidenceLabel: 'Limited evidence' as const,
    assessmentSummary: `Assessed in ${profile.assessedSessionCount} ${profile.assessedSessionCount === 1 ? 'session' : 'sessions'} across ${profile.scenarioCount} practice ${profile.scenarioCount === 1 ? 'scenario' : 'scenarios'}.`,
  }))
}

export async function getPracticeRecommendations(
  userId: string,
  workspaceId: string,
) {
  const [practices, profiles, recent] = await Promise.all([
    listLearnerPractices(userId, workspaceId),
    getCompetencyProfiles(userId, workspaceId),
    db
      .select({ practiceId: practiceSessions.practiceId })
      .from(practiceSessions)
      .where(
        and(
          eq(practiceSessions.userId, userId),
          eq(practiceSessions.workspaceId, workspaceId),
          eq(practiceSessions.status, 'completed'),
          isNull(practiceSessions.deletedAt),
        ),
      )
      .orderBy(desc(practiceSessions.createdAt))
      .limit(5),
  ])
  const recentIds = new Set(recent.map((item) => item.practiceId))
  return practices
    .map((practice) => {
      const needs = practice.competencies.map((skill) => {
        const profile = profiles.find((item) => item.code === skill.code)
        return 100 - (profile?.masteryScore ?? 50)
      })
      const priority =
        Math.max(0, ...needs) -
        (recentIds.has(practice.id) ? 50 : 0) -
        (practice.difficulty === 'advanced' &&
        profiles.some((profile) => (profile.masteryScore ?? 0) < 60)
          ? 20
          : 0)
      return {
        practice,
        priority,
        reason: practice.competencies.length
          ? `Luyện ${practice.competencies.map((skill) => skill.name).join(', ')}`
          : 'Bài luyện mới',
      }
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3)
}
