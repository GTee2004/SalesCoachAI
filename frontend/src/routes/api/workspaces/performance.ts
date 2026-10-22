import { createFileRoute } from '@tanstack/react-router'
import { canViewWorkspacePerformance } from '#/lib/auth/workspace-roles'
import {
  getVerifiedSession,
  json,
  requireWorkspaceContext,
} from '#/lib/server/http'
import { getTeamPerformance } from '#/lib/server/workspace-performance'
import { getWorkspaceForUser } from '#/lib/server/workspaces'
import { toDateKey } from '#/lib/admin/usage'
import {
  DEFAULT_TEAM_PERIOD,
  DEFAULT_TEAM_VIEW,
  TEAM_PERIODS,
  TEAM_VIEWS,
  teamRangeProblem,
  teamRangeProblems,
} from '#/lib/workspace/performance'
import type { TeamRangeSelection } from '#/lib/workspace/performance'

export const Route = createFileRoute('/api/workspaces/performance')({
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
          if (!canViewWorkspacePerformance(workspace.role))
            return json(
              { error: 'Bạn không có quyền xem hiệu suất của nhóm.' },
              { status: 403 },
            )
          const params = new URL(request.url).searchParams
          const from = params.get('from')
          const to = params.get('to')
          let selection: TeamRangeSelection
          if (from !== null || to !== null) {
            const problem = teamRangeProblem(
              from ?? '',
              to ?? '',
              toDateKey(new Date()),
            )
            if (problem)
              return json(
                { error: teamRangeProblems[problem] },
                { status: 400 },
              )
            selection = { from: from ?? '', to: to ?? '' }
          } else {
            const requested = params.get('period') ?? DEFAULT_TEAM_PERIOD
            const period = TEAM_PERIODS.find((item) => item === requested)
            if (!period)
              return json(
                { error: 'Khoảng thời gian không hợp lệ.' },
                { status: 400 },
              )
            selection = { period }
          }
          const requestedView = params.get('view') ?? DEFAULT_TEAM_VIEW
          const view = TEAM_VIEWS.find((item) => item === requestedView)
          if (!view)
            return json({ error: 'Chế độ xem không hợp lệ.' }, { status: 400 })
          return json(
            await getTeamPerformance(workspace.id, selection, new Date(), view),
          )
        } catch (error) {
          if (error instanceof Response)
            return json({ error: await error.text() }, { status: error.status })
          console.error('[Workspace] performance request failed', error)
          return json(
            { error: 'Chưa thể tải hiệu suất của nhóm.' },
            { status: 500 },
          )
        }
      },
    },
  },
})
