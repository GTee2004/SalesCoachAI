import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '#/db'
import {
  learnerCompetencyProfiles,
  practiceSessionCompetencyScores,
  practiceSessions,
} from '#/db/schema'

type ProfileTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Always acquire before session rows or profile writes, in both grading and deletion. */
export async function lockLearnerProfile(
  tx: ProfileTransaction,
  userId: string,
  workspaceId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'learner-profile:' + JSON.stringify([workspaceId, userId])}, 0))`,
  )
}

export async function applySessionProfileEvidence(
  sessionId: string,
  userId: string,
  workspaceId: string,
) {
  await db.transaction(async (tx) => {
    await lockLearnerProfile(tx, userId, workspaceId)
    const session = (
      await tx
        .select()
        .from(practiceSessions)
        .where(
          and(
            eq(practiceSessions.id, sessionId),
            eq(practiceSessions.userId, userId),
            eq(practiceSessions.workspaceId, workspaceId),
            eq(practiceSessions.status, 'completed'),
            isNull(practiceSessions.deletedAt),
          ),
        )
        .for('update')
    ).at(0)
    if (!session) return
    // Record application order after obtaining the learner lock, including clock rollback.
    const scores = await tx
      .update(practiceSessionCompetencyScores)
      .set({
        profileAppliedAt: sql`greatest(clock_timestamp(), coalesce((
        select max(e.profile_applied_at) + interval '1 microsecond'
        from practice_session_competency_scores e
        join practice_sessions s on s.id = e.session_id
        where s.user_id = ${userId} and s.workspace_id = ${workspaceId}
      ), clock_timestamp()))`,
      })
      .where(
        and(
          eq(practiceSessionCompetencyScores.sessionId, sessionId),
          isNull(practiceSessionCompetencyScores.profileAppliedAt),
          sql`${practiceSessionCompetencyScores.assessmentStatus} <> 'not_assessed'`,
        ),
      )
      .returning()
    for (const score of scores) {
      await tx
        .insert(learnerCompetencyProfiles)
        .values({
          userId,
          workspaceId,
          competencyId: score.competencyId,
          masteryScore: score.score,
          evidenceCount: 1,
          lastPracticedAt: session.completedAt ?? score.profileAppliedAt,
        })
        .onConflictDoUpdate({
          target: [
            learnerCompetencyProfiles.workspaceId,
            learnerCompetencyProfiles.userId,
            learnerCompetencyProfiles.competencyId,
          ],
          set: {
            masteryScore: sql`round((coalesce(${learnerCompetencyProfiles.masteryScore}, ${score.score}) * 3 + ${score.score})::numeric / 4)::integer`,
            evidenceCount: sql`${learnerCompetencyProfiles.evidenceCount} + 1`,
            lastPracticedAt: session.completedAt ?? score.profileAppliedAt,
            updatedAt: new Date(),
          },
        })
    }
  })
}

/** Caller holds the learner lock; only successfully applied evidence participates. */
export async function rebuildLearnerCompetencies(
  tx: ProfileTransaction,
  userId: string,
  competencyIds: string[],
  workspaceId: string,
) {
  if (!competencyIds.length) return
  const evidence = await tx
    .select({
      competencyId: practiceSessionCompetencyScores.competencyId,
      score: practiceSessionCompetencyScores.score,
      practicedAt:
        sql<Date>`coalesce(${practiceSessions.completedAt}, ${practiceSessionCompetencyScores.profileAppliedAt})`.mapWith(
          practiceSessionCompetencyScores.profileAppliedAt,
        ),
    })
    .from(practiceSessionCompetencyScores)
    .innerJoin(
      practiceSessions,
      eq(practiceSessions.id, practiceSessionCompetencyScores.sessionId),
    )
    .where(
      and(
        eq(practiceSessions.userId, userId),
        eq(practiceSessions.workspaceId, workspaceId),
        eq(practiceSessions.status, 'completed'),
        isNull(practiceSessions.deletedAt),
        isNotNull(practiceSessionCompetencyScores.profileAppliedAt),
        sql`${practiceSessionCompetencyScores.assessmentStatus} <> 'not_assessed'`,
        inArray(practiceSessionCompetencyScores.competencyId, competencyIds),
      ),
    )
    .orderBy(
      asc(practiceSessionCompetencyScores.profileAppliedAt),
      asc(practiceSessionCompetencyScores.sessionId),
    )
  const profiles = new Map<
    string,
    {
      masteryScore: number
      evidenceCount: number
      lastPracticedAt: Date
    }
  >()
  for (const item of evidence) {
    const previous = profiles.get(item.competencyId)
    profiles.set(item.competencyId, {
      masteryScore: previous
        ? Math.round((previous.masteryScore * 3 + item.score!) / 4)
        : item.score!,
      evidenceCount: (previous?.evidenceCount ?? 0) + 1,
      lastPracticedAt: item.practicedAt,
    })
  }
  await tx
    .delete(learnerCompetencyProfiles)
    .where(
      and(
        eq(learnerCompetencyProfiles.userId, userId),
        eq(learnerCompetencyProfiles.workspaceId, workspaceId),
        inArray(learnerCompetencyProfiles.competencyId, competencyIds),
      ),
    )
  if (profiles.size) {
    await tx.insert(learnerCompetencyProfiles).values(
      [...profiles].map(([competencyId, profile]) => ({
        userId,
        workspaceId,
        competencyId,
        ...profile,
      })),
    )
  }
}
