import { createFileRoute } from '@tanstack/react-router'
import { canManageWorkspaceMembers } from '#/lib/auth/workspace-roles'
import { getSeatAvailability } from '#/lib/server/billing/seats'
import {
  getVerifiedSession,
  json,
  requireWorkspaceContext,
} from '#/lib/server/http'
import { listWorkspaceMembers } from '#/lib/server/workspace-members'
import { getWorkspaceForUser } from '#/lib/server/workspaces'

export const Route = createFileRoute('/api/workspaces/members')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const current = await getVerifiedSession(request.headers)
          const workspaceId = current.session.activeOrganizationId
          requireWorkspaceContext(
            workspaceId,
            request.headers.get('x-workspace-id'),
          )
          const workspace = await getWorkspaceForUser(
            current.user.id,
            workspaceId,
          )
          if (!workspace || workspace.kind !== 'company')
            return json(
              { error: 'Không gian làm việc không tồn tại.' },
              { status: 404 },
            )
          if (!canManageWorkspaceMembers(workspace.role))
            return json(
              { error: 'Bạn không có quyền xem danh sách thành viên.' },
              { status: 403 },
            )
          const [seats, list] = await Promise.all([
            getSeatAvailability(workspace.id),
            listWorkspaceMembers(workspace.id, workspace.role),
          ])
          return json({ workspaceId: workspace.id, seats, ...list })
        } catch (error) {
          if (error instanceof Response)
            return json({ error: await error.text() }, { status: error.status })
          console.error('[Workspace] members request failed', error)
          return json(
            { error: 'Chưa thể tải danh sách thành viên.' },
            { status: 500 },
          )
        }
      },
    },
  },
})
