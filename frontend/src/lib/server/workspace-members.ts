import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm'
import { APIError } from 'better-auth/api'
import { z } from 'zod'
import { db } from '#/db'
import {
  invitation,
  member,
  organization,
  user,
  workspaceSeatAssignments,
} from '#/db/schema'
import {
  WORKSPACE_MANAGER_ROLE,
  WORKSPACE_MEMBER_ROLE,
  WORKSPACE_OWNER_ROLE,
  canInviteWorkspaceRole,
  canManageWorkspaceMember,
  canManageWorkspaceMembers,
  canRenameWorkspace,
  getWorkspaceRole,
} from '#/lib/auth/workspace-roles'
import { getSeatAvailability } from './billing/seats'
import { revokeWorkspaceSeat } from './billing/credits'

const assignableRoles: readonly string[] = [
  WORKSPACE_MANAGER_ROLE,
  WORKSPACE_MEMBER_ROLE,
]

const workspaceNameSchema = z.string().trim().min(2).max(100)

async function getMemberRole(userId: string, workspaceId: string) {
  const row = await db.query.member.findFirst({
    columns: { role: true },
    where: and(
      eq(member.organizationId, workspaceId),
      eq(member.userId, userId),
    ),
  })
  return row?.role ?? null
}

async function requireMemberRole(userId: string, workspaceId: string) {
  const role = await getMemberRole(userId, workspaceId)
  if (role === null)
    throw new APIError('FORBIDDEN', {
      message: 'Bạn không thuộc không gian làm việc này.',
    })
  return role
}

function requireMemberManager(role: string) {
  if (!canManageWorkspaceMembers(role))
    throw new APIError('FORBIDDEN', {
      message: 'Chỉ chủ sở hữu hoặc quản lý mới có thể quản lý thành viên.',
    })
}

// Every invited person, manager or member, takes a paid seat when accepting,
// so an invitation is only allowed while a seat is free to hold for them.
export async function assertCanInvite(input: {
  actorId: string
  workspaceId: string
  role: string
}) {
  const actorRole = await requireMemberRole(input.actorId, input.workspaceId)
  requireMemberManager(actorRole)
  if (!assignableRoles.includes(input.role))
    throw new APIError('BAD_REQUEST', { message: 'Vai trò không hợp lệ.' })
  if (!canInviteWorkspaceRole(actorRole, input.role))
    throw new APIError('FORBIDDEN', {
      message: 'Bạn không có quyền mời vai trò này.',
    })

  const seats = await getSeatAvailability(input.workspaceId)
  if (!seats.active)
    throw new APIError('CONFLICT', {
      message: 'Không gian làm việc chưa có gói Business đang hoạt động.',
    })
  if (seats.free < 1)
    throw new APIError('CONFLICT', {
      message:
        getWorkspaceRole(actorRole) === WORKSPACE_OWNER_ROLE
          ? 'Đã dùng hết số suất. Hãy mua thêm suất trước khi mời thành viên mới.'
          : 'Đã dùng hết số suất. Hãy nhờ chủ sở hữu mua thêm suất.',
    })
}

export async function assertCanCancelInvitation(input: {
  actorId: string
  workspaceId: string
  invitationRole: string | null | undefined
}) {
  const actorRole = await requireMemberRole(input.actorId, input.workspaceId)
  requireMemberManager(actorRole)
  // Managers can only withdraw invitations they could have sent.
  if (!canInviteWorkspaceRole(actorRole, input.invitationRole))
    throw new APIError('FORBIDDEN', {
      message: 'Bạn không có quyền hủy lời mời này.',
    })
}

async function findTargetMember(workspaceId: string, memberIdOrEmail: string) {
  const target = (
    await db
      .select({
        id: member.id,
        userId: member.userId,
        role: member.role,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(
        and(
          eq(member.organizationId, workspaceId),
          memberIdOrEmail.includes('@')
            ? sql`lower(${user.email}) = ${memberIdOrEmail.toLowerCase()}`
            : eq(member.id, memberIdOrEmail),
        ),
      )
  ).at(0)
  if (!target)
    throw new APIError('BAD_REQUEST', {
      message: 'Không tìm thấy thành viên.',
    })
  return target
}

// Better Auth's member hooks do not say who is removing, so the seat is
// released here, where the remover is known.
export async function prepareToRemove(input: {
  actorId: string
  workspaceId: string
  memberIdOrEmail: string
}) {
  const actorRole = await requireMemberRole(input.actorId, input.workspaceId)
  requireMemberManager(actorRole)
  const target = await findTargetMember(
    input.workspaceId,
    input.memberIdOrEmail,
  )
  if (
    target.userId === input.actorId ||
    !canManageWorkspaceMember(actorRole, target.role)
  )
    throw new APIError('FORBIDDEN', {
      message: 'Bạn không có quyền xóa thành viên này.',
    })
  await revokeWorkspaceSeat({
    workspaceId: input.workspaceId,
    userId: target.userId,
    revokedBy: input.actorId,
    reason: 'member_removed',
  })
}

export async function assertCanChangeMemberRole(input: {
  actorId: string
  workspaceId: string
  memberId: string
  newRole: string
}) {
  const actorRole = await requireMemberRole(input.actorId, input.workspaceId)
  if (getWorkspaceRole(actorRole) !== WORKSPACE_OWNER_ROLE)
    throw new APIError('FORBIDDEN', {
      message: 'Chỉ chủ sở hữu có thể đổi vai trò.',
    })
  if (!assignableRoles.includes(input.newRole))
    throw new APIError('BAD_REQUEST', { message: 'Vai trò không hợp lệ.' })
  const target = await findTargetMember(input.workspaceId, input.memberId)
  if (
    target.userId === input.actorId ||
    !canManageWorkspaceMember(actorRole, target.role)
  )
    throw new APIError('FORBIDDEN', {
      message: 'Không thể đổi vai trò của thành viên này.',
    })
}

// Leaving skips Better Auth's member hooks, so the seat is released here.
export async function prepareToLeave(input: {
  userId: string
  workspaceId: string
}) {
  const role = await requireMemberRole(input.userId, input.workspaceId)
  if (getWorkspaceRole(role) === WORKSPACE_OWNER_ROLE)
    throw new APIError('FORBIDDEN', {
      message: 'Chủ sở hữu không thể rời không gian làm việc.',
    })
  await revokeWorkspaceSeat({
    workspaceId: input.workspaceId,
    userId: input.userId,
    revokedBy: input.userId,
    reason: 'member_left',
  })
}

// Only the name is editable; slug, logo and metadata stay under our control.
export async function sanitizeWorkspaceUpdate(input: {
  actorId: string
  actorRole: string
  workspaceId: string
  data: Record<string, unknown>
}) {
  if (!canRenameWorkspace(input.actorRole))
    throw new APIError('FORBIDDEN', {
      message: 'Chỉ chủ sở hữu có thể đổi tên không gian làm việc.',
    })
  if (Object.keys(input.data).some((key) => key !== 'name'))
    throw new APIError('BAD_REQUEST', {
      message: 'Chỉ có thể thay đổi tên không gian làm việc.',
    })
  const parsed = workspaceNameSchema.safeParse(input.data.name)
  if (!parsed.success)
    throw new APIError('BAD_REQUEST', {
      message: 'Tên không gian làm việc phải có từ 2 đến 100 ký tự.',
    })
  const name = parsed.data

  // Names are labels, not identities, so they are not globally unique. They
  // only have to be distinguishable in this person's workspace switcher.
  const clash = (
    await db
      .select({ id: organization.id })
      .from(organization)
      .innerJoin(member, eq(member.organizationId, organization.id))
      .where(
        and(
          eq(member.userId, input.actorId),
          ne(organization.id, input.workspaceId),
          sql`lower(${organization.name}) = ${name.toLowerCase()}`,
        ),
      )
  ).at(0)
  if (clash)
    throw new APIError('CONFLICT', {
      message: 'Bạn đã có một không gian làm việc khác trùng tên này.',
    })
  return { name }
}

export async function listWorkspaceMembers(
  workspaceId: string,
  viewerRole: string,
) {
  const members = await db
    .select({
      memberId: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.createdAt,
      seatId: workspaceSeatAssignments.id,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      workspaceSeatAssignments,
      and(
        eq(workspaceSeatAssignments.workspaceId, member.organizationId),
        eq(workspaceSeatAssignments.userId, member.userId),
        isNull(workspaceSeatAssignments.revokedAt),
      ),
    )
    .where(eq(member.organizationId, workspaceId))
    .orderBy(asc(member.createdAt))

  const invitations = canManageWorkspaceMembers(viewerRole)
    ? await db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          createdAt: invitation.createdAt,
          expiresAt: invitation.expiresAt,
          inviterName: user.name,
        })
        .from(invitation)
        .innerJoin(user, eq(user.id, invitation.inviterId))
        .where(
          and(
            eq(invitation.organizationId, workspaceId),
            eq(invitation.status, 'pending'),
            gt(invitation.expiresAt, new Date()),
          ),
        )
        .orderBy(asc(invitation.createdAt))
    : []

  return {
    members: members.map(({ seatId, joinedAt, role, ...rest }) => ({
      ...rest,
      role: getWorkspaceRole(role),
      joinedAt: joinedAt.toISOString(),
      hasSeat: Boolean(seatId),
    })),
    invitations: invitations.map(({ createdAt, expiresAt, role, ...rest }) => ({
      ...rest,
      role: getWorkspaceRole(role),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })),
  }
}
