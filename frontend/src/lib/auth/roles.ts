// Platform roles live on `user.roles`. Workspace roles are a separate concept
// stored on the organization `member` row; see workspace-roles.ts.
export const ADMIN_ROLE = 'admin'
export const MODERATOR_ROLE = 'moderator'
export const USER_ROLE = 'user'

export function isAdmin(
  user: { roles?: readonly string[] | null } | null | undefined,
) {
  return user?.roles?.includes(ADMIN_ROLE) ?? false
}
