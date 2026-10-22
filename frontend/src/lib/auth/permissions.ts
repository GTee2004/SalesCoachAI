import { ADMIN_ROLE, MODERATOR_ROLE, USER_ROLE } from './roles'

// Platform permissions are derived from platform roles (`user.roles`). Roles
// are enforced here rather than in the database, so adding a role or moving a
// permission between roles is a code change, not a migration. Workspace roles
// (owner / manager / member) are unrelated; see workspace-roles.ts.
//
// Gate pages and server functions on a permission, never on a role name, so a
// future "support" or "finance" role only needs a new entry in ROLE_PERMISSIONS.
export const PERMISSIONS = {
  adminDashboardView: 'adminDashboard.view',
  couponsView: 'coupons.view',
  couponsManage: 'coupons.manage',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

type RoleCarrier = { roles?: ReadonlyArray<string> | null } | null | undefined

const ROLE_PERMISSIONS: ReadonlyMap<string, ReadonlySet<Permission>> = new Map([
  [USER_ROLE, new Set<Permission>()],
  [ADMIN_ROLE, new Set<Permission>(Object.values(PERMISSIONS))],
  [MODERATOR_ROLE, new Set<Permission>([PERMISSIONS.adminDashboardView])],
])

// Unknown roles grant nothing, so a stale or misspelled value fails closed.
export function can(user: RoleCarrier, permission: Permission): boolean {
  return (
    user?.roles?.some((role) => ROLE_PERMISSIONS.get(role)?.has(permission)) ??
    false
  )
}

export function canAny(
  user: RoleCarrier,
  permissions: ReadonlyArray<Permission>,
): boolean {
  return permissions.some((permission) => can(user, permission))
}
