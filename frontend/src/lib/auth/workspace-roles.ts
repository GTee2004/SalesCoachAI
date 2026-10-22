// Workspace roles are stored on the organization `member` row and are unrelated
// to platform roles on `user.roles`. The manager is Better Auth's built-in
// `admin`; it grants no platform access, so never compare it with ADMIN_ROLE.
export const WORKSPACE_OWNER_ROLE = 'owner'
export const WORKSPACE_MANAGER_ROLE = 'admin'
export const WORKSPACE_MEMBER_ROLE = 'member'

export type WorkspaceRole =
  | typeof WORKSPACE_OWNER_ROLE
  | typeof WORKSPACE_MANAGER_ROLE
  | typeof WORKSPACE_MEMBER_ROLE

export const workspaceRoleLabels: Record<WorkspaceRole, string> = {
  owner: 'Chủ sở hữu',
  admin: 'Quản lý',
  member: 'Thành viên',
}

// Better Auth joins several roles with commas; the highest one wins.
export function getWorkspaceRole(
  role: string | null | undefined,
): WorkspaceRole {
  const roles = (role ?? '').split(',').map((item) => item.trim())
  if (roles.includes(WORKSPACE_OWNER_ROLE)) return WORKSPACE_OWNER_ROLE
  if (roles.includes(WORKSPACE_MANAGER_ROLE)) return WORKSPACE_MANAGER_ROLE
  return WORKSPACE_MEMBER_ROLE
}

export function canRenameWorkspace(role: string | null | undefined) {
  return getWorkspaceRole(role) === WORKSPACE_OWNER_ROLE
}

export function canManageWorkspaceBilling(role: string | null | undefined) {
  return getWorkspaceRole(role) === WORKSPACE_OWNER_ROLE
}

// Owners and managers invite, revoke invitations and remove members.
export function canManageWorkspaceMembers(role: string | null | undefined) {
  return getWorkspaceRole(role) !== WORKSPACE_MEMBER_ROLE
}

// Owners and managers see how the whole team is performing.
export function canViewWorkspacePerformance(role: string | null | undefined) {
  return getWorkspaceRole(role) !== WORKSPACE_MEMBER_ROLE
}

// Owners can invite any role except another owner; managers only members.
export function canInviteWorkspaceRole(
  actorRole: string | null | undefined,
  invitedRole: string | null | undefined,
) {
  const actor = getWorkspaceRole(actorRole)
  const invited = getWorkspaceRole(invitedRole)
  if (actor === WORKSPACE_OWNER_ROLE) return invited !== WORKSPACE_OWNER_ROLE
  if (actor === WORKSPACE_MANAGER_ROLE) return invited === WORKSPACE_MEMBER_ROLE
  return false
}

// Nobody removes or changes themselves here, and the owner is never removable.
// Managers can only act on plain members.
export function canManageWorkspaceMember(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined,
) {
  const actor = getWorkspaceRole(actorRole)
  const target = getWorkspaceRole(targetRole)
  if (target === WORKSPACE_OWNER_ROLE) return false
  if (actor === WORKSPACE_OWNER_ROLE) return true
  if (actor === WORKSPACE_MANAGER_ROLE) return target === WORKSPACE_MEMBER_ROLE
  return false
}

// Custom practices are a Business feature: only owners and managers of a
// company workspace author them, and any of them may delete any of them.
export function canManageWorkspacePractices(
  kind: string | null | undefined,
  role: string | null | undefined,
) {
  return kind === 'company' && getWorkspaceRole(role) !== WORKSPACE_MEMBER_ROLE
}
