import { redirect } from '@tanstack/react-router'
import { can } from './permissions'
import type { Permission } from './permissions'

type Guarded = {
  emailVerified: boolean
  roles?: ReadonlyArray<string> | null
}

// For a route `loader`/`beforeLoad`. Hiding a page is only a convenience: every
// server function behind it must still call `requirePermission`.
export function requireRoutePermission<T extends Guarded>(
  user: T | null | undefined,
  location: { href: string },
  permission: Permission,
): asserts user is T {
  if (!user?.emailVerified)
    throw redirect({ to: '/login', search: { callbackUrl: location.href } })
  if (!can(user, permission)) throw redirect({ to: '/' })
}
