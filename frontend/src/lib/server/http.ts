import { auth } from '#/lib/auth/server'
import { requireReadyWorkspace } from '#/lib/server/workspaces'

export async function getVerifiedSession(headers: Headers) {
  const current = await auth.api.getSession({ headers })

  if (!current?.user) {
    throw new Response('Unauthorized', { status: 401 })
  }

  if (!current.user.emailVerified) {
    throw new Response('Email verification required', {
      status: 403,
    })
  }

  return current
}

export async function requireUser(request: Request) {
  const current = await getVerifiedSession(request.headers)
  return current.user
}

export async function requirePracticeUser(request: Request) {
  const current = await getVerifiedSession(request.headers)
  requireWorkspaceContext(
    current.session.activeOrganizationId,
    request.headers.get('x-workspace-id'),
  )

  const workspace = await requireReadyWorkspace(
    current.user.id,
    current.session.activeOrganizationId,
  )

  return {
    ...current.user,
    workspaceId: workspace.id,
    workspaceKind: workspace.kind,
    workspaceRole: workspace.role,
  }
}

// The caller must name the workspace it rendered, rather than silently using
// a cookie that another tab may have changed since then.
export function requireWorkspaceContext(
  activeId: string | null | undefined,
  expectedId: string | null,
) {
  if (!expectedId)
    throw new Response('Thiếu thông tin không gian làm việc.', { status: 400 })
  if (activeId !== expectedId)
    throw new Response('Không gian làm việc đã thay đổi; hãy tải lại trang.', {
      status: 409,
    })
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (!host || new URL(origin).host !== host) {
    throw new Response('Invalid origin', { status: 403 })
  }
}

export function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('cache-control', 'private, no-store')
  return Response.json(data, { ...init, headers })
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  )
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new Response('Invalid JSON', { status: 400 })
  }
}
