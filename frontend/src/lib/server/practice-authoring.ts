import { and, eq, inArray } from 'drizzle-orm'
import { db } from '#/db'
import {
  competencies,
  practices,
  salesOfferings,
  practiceAgentConfigs,
  practiceCompetencies,
} from '#/db/schema'
import type { CustomPracticeInput } from '#/lib/practice/authoring'

// Callers must first check canManageWorkspacePractices: any owner or manager
// may delete any of the workspace's practices, not only their own.
export async function deleteCustomPractice(
  practiceId: string,
  workspaceId: string,
) {
  // Preserve practices referenced by call history; archived practices cannot
  // appear in the catalog or be used to create new sessions.
  const deleted = await db
    .update(practices)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(
      and(
        eq(practices.id, practiceId),
        eq(practices.workspaceId, workspaceId),
        eq(practices.isGlobal, false),
      ),
    )
    .returning({ id: practices.id })
  return deleted.at(0) ?? null
}

export async function saveCustomPractice(
  userId: string,
  workspaceId: string,
  input: CustomPracticeInput,
  status: 'draft' | 'published',
  draftId?: string,
) {
  return db.transaction(async (tx) => {
    // Lock the draft so parallel saves cannot publish or replace it twice.
    const existing = (
      draftId
        ? await tx
            .select()
            .from(practices)
            .where(
              and(
                eq(practices.id, draftId),
                eq(practices.createdByUserId, userId),
                eq(practices.workspaceId, workspaceId),
                eq(practices.isGlobal, false),
                eq(practices.status, 'draft'),
              ),
            )
            .for('update')
        : []
    ).at(0)
    if (draftId && !existing)
      throw new Error(
        'Bản nháp không tồn tại hoặc đã được tạo thành bài luyện.',
      )
    const skills = await tx
      .select({ id: competencies.id, code: competencies.code })
      .from(competencies)
      .where(
        inArray(
          competencies.code,
          input.scorecard.map((item) => item.competencyCode),
        ),
      )
    if (skills.length !== input.scorecard.length)
      throw new Error(
        'Bộ kỹ năng đánh giá chưa được thiết lập. Vui lòng liên hệ quản trị viên.',
      )
    const offerings = existing
      ? await tx
          .update(salesOfferings)
          .set({
            name: input.offering.projectName,
            offering: input.offering,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(salesOfferings.id, existing.salesOfferingId),
              eq(salesOfferings.workspaceId, workspaceId),
              eq(salesOfferings.isGlobal, false),
            ),
          )
          .returning({ id: salesOfferings.id })
      : await tx
          .insert(salesOfferings)
          .values({
            workspaceId,
            isGlobal: false,
            name: input.offering.projectName,
            offering: input.offering,
          })
          .returning({ id: salesOfferings.id })
    const offering = offerings.at(0)
    if (!offering)
      throw new Error(
        'Bản nháp có sản phẩm không thuộc không gian làm việc này.',
      )
    const values = {
      workspaceId,
      isGlobal: false,
      slug: `custom-${crypto.randomUUID()}`,
      title: input.title,
      description: input.description,
      type: input.type,
      difficulty: input.difficulty,
      estimatedMinutes: input.estimatedMinutes,
      learnerBrief: input.learnerBrief,
      learnerInstructions: input.learnerInstructions,
      tags: input.tags,
      salesOfferingId: offering.id,
      createdByUserId: userId,
      status,
      publishedAt: status === 'published' ? new Date() : null,
    }
    const [practice] = existing
      ? await tx
          .update(practices)
          .set({ ...values, slug: existing.slug, updatedAt: new Date() })
          .where(eq(practices.id, existing.id))
          .returning({ id: practices.id })
      : await tx
          .insert(practices)
          .values(values)
          .returning({ id: practices.id })
    await tx
      .insert(practiceAgentConfigs)
      .values({
        practiceId: practice.id,
        config: input.config,
      })
      .onConflictDoUpdate({
        target: practiceAgentConfigs.practiceId,
        set: { config: input.config, updatedAt: new Date() },
      })
    if (existing)
      await tx
        .delete(practiceCompetencies)
        .where(eq(practiceCompetencies.practiceId, practice.id))
    await tx.insert(practiceCompetencies).values(
      input.scorecard.map((item) => ({
        practiceId: practice.id,
        competencyId: skills.find(
          (skill) => skill.code === item.competencyCode,
        )!.id,
        weight: item.weight,
        rubric: item.rubric,
      })),
    )
    return practice
  })
}
