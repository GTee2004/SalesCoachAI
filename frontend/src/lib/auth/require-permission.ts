import { can } from './permissions'
import type { Permission } from './permissions'

// Server-side gate for server functions. Call it first, before any read or
// write; it is the check that actually protects data.
export async function requirePermission(permission: Permission) {
  const [{ getRequestHeaders }, { auth }] = await Promise.all([
    import('@tanstack/react-start/server'),
    import('#/lib/auth/server'),
  ])
  const current = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!current?.user) throw new Response('Unauthorized', { status: 401 })
  if (!current.user.emailVerified)
    throw new Response('Email verification required', { status: 403 })
  if (!can(current.user, permission))
    throw new Response('Forbidden', { status: 403 })
  return current.user
}
