import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import {
  company,
  member,
  organization,
  user,
  workspaceProfiles,
} from '#/db/schema'

export async function ensurePersonalWorkspace(userId: string) {
  return db.transaction(async (tx) => {
    // Các lần gọi cho cùng user phải chờ nhau.
    const owner = (
      await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .for('update')
    ).at(0)

    if (!owner) {
      throw new Error('User not found')
    }

    const existing = (
      await tx
        .select({ workspaceId: workspaceProfiles.workspaceId })
        .from(workspaceProfiles)
        .where(eq(workspaceProfiles.personalOwnerUserId, userId))
    ).at(0)

    if (existing) {
      return existing.workspaceId
    }

    const workspaceId = randomUUID()
    const companyId = randomUUID()

    await tx.insert(company).values({
      id: companyId,
      name: 'Tài khoản cá nhân',
    })

    await tx.insert(organization).values({
      id: workspaceId,
      companyId,
      name: 'Tài khoản cá nhân',
      slug: `personal-${workspaceId}`,
    })

    await tx.insert(member).values({
      id: randomUUID(),
      organizationId: workspaceId,
      userId,
      role: 'owner',
    })

    await tx.insert(workspaceProfiles).values({
      workspaceId,
      kind: 'personal',
      personalOwnerUserId: userId,
      status: 'ready',
    })

    return workspaceId
  })
}
export const companyWorkspaceInput = z.object({
  name: z.string().trim().min(2).max(100),
  requestId: z.string().uuid(),
})

export async function createCompanyWorkspace(
  userId: string,
  input: z.infer<typeof companyWorkspaceInput>,
) {
  const data = companyWorkspaceInput.parse(input)

  return db.transaction(async (tx) => {
    const owner = (
      await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .for('update')
    ).at(0)

    if (!owner) {
      throw new Error('User not found')
    }

    const existing = (
      await tx
        .select({ workspaceId: workspaceProfiles.workspaceId })
        .from(workspaceProfiles)
        .innerJoin(
          member,
          eq(member.organizationId, workspaceProfiles.workspaceId),
        )
        .where(
          and(
            eq(workspaceProfiles.workspaceId, data.requestId),
            eq(workspaceProfiles.kind, 'company'),
            eq(member.userId, userId),
            eq(member.role, 'owner'),
          ),
        )
    ).at(0)

    if (existing) {
      return existing.workspaceId
    }

    const workspaceId = data.requestId
    const companyId = randomUUID()

    await tx.insert(company).values({ id: companyId, name: data.name })

    await tx.insert(organization).values({
      id: workspaceId,
      companyId,
      name: data.name,
      slug: `company-${workspaceId}`,
    })

    await tx.insert(member).values({
      id: randomUUID(),
      organizationId: workspaceId,
      userId,
      role: 'owner',
    })

    await tx.insert(workspaceProfiles).values({
      workspaceId,
      kind: 'company',
      status: 'pending_subscription',
    })

    return workspaceId
  })
}
export async function listOwnedCompanyWorkspaces(userId: string) {
  return db
    .select({
      id: organization.id,
      name: organization.name,
      status: workspaceProfiles.status,
    })
    .from(workspaceProfiles)
    .innerJoin(organization, eq(organization.id, workspaceProfiles.workspaceId))
    .innerJoin(member, eq(member.organizationId, workspaceProfiles.workspaceId))
    .where(
      and(
        eq(workspaceProfiles.kind, 'company'),
        eq(member.userId, userId),
        eq(member.role, 'owner'),
      ),
    )
    .orderBy(workspaceProfiles.createdAt)
}

export async function isCompanyWorkspace(workspaceId: string) {
  const profile = (
    await db
      .select({ kind: workspaceProfiles.kind })
      .from(workspaceProfiles)
      .where(eq(workspaceProfiles.workspaceId, workspaceId))
  ).at(0)

  return profile?.kind === 'company'
}
export async function getWorkspaceForUser(
  userId: string,
  workspaceId: string | null | undefined,
) {
  if (!workspaceId) return null

  const workspace = (
    await db
      .select({
        id: organization.id,
        name: organization.name,
        kind: workspaceProfiles.kind,
        status: workspaceProfiles.status,
        personalOwnerUserId: workspaceProfiles.personalOwnerUserId,
        role: member.role,
      })
      .from(organization)
      .innerJoin(
        workspaceProfiles,
        eq(workspaceProfiles.workspaceId, organization.id),
      )
      .innerJoin(member, eq(member.organizationId, organization.id))
      .where(and(eq(organization.id, workspaceId), eq(member.userId, userId)))
  ).at(0)

  if (!workspace) return null

  if (
    workspace.kind === 'personal' &&
    workspace.personalOwnerUserId !== userId
  ) {
    return null
  }

  return workspace
}

export async function requireReadyWorkspace(
  userId: string,
  workspaceId: string | null | undefined,
) {
  const workspace = await getWorkspaceForUser(userId, workspaceId)

  if (!workspace) {
    throw new Response('Bạn không có quyền truy cập không gian làm việc này.', {
      status: 403,
    })
  }

  if (workspace.status !== 'ready') {
    throw new Response('Không gian làm việc chưa được kích hoạt.', {
      status: 403,
    })
  }

  return workspace
}
