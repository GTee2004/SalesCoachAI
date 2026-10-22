import { queryOptions } from '@tanstack/react-query'
import { BillingRequestError, readBillingResponse } from '#/lib/billing/http'
import type { WorkspaceRole } from '#/lib/auth/workspace-roles'
import type {
  TeamPerformance,
  TeamRangeSelection,
  TeamView,
} from './performance'

export type WorkspaceMembers = {
  workspaceId: string
  seats: {
    active: boolean
    limit: number
    used: number
    pendingInvitations: number
    free: number
  }
  members: Array<{
    memberId: string
    userId: string
    name: string
    email: string
    role: WorkspaceRole
    joinedAt: string
    hasSeat: boolean
  }>
  invitations: Array<{
    id: string
    email: string
    role: WorkspaceRole
    createdAt: string
    expiresAt: string
    inviterName: string
  }>
}

export const workspaceMembersQueryOptions = (
  userId: string,
  workspaceId: string,
) =>
  queryOptions({
    queryKey: ['workspace', userId, workspaceId, 'members'] as const,
    queryFn: async ({ signal }) => {
      const data = await readBillingResponse<WorkspaceMembers>(
        await fetch('/api/workspaces/members', {
          headers: { 'x-workspace-id': workspaceId },
          signal,
        }),
        'Chưa thể tải danh sách thành viên. Vui lòng thử lại.',
      )
      if (data.workspaceId !== workspaceId)
        throw new BillingRequestError(
          'Không gian làm việc đã thay đổi. Vui lòng tải lại trang.',
          409,
        )
      return data
    },
    staleTime: 10_000,
    retry: false,
    refetchOnWindowFocus: 'always',
  })

export const workspacePerformanceQueryOptions = (
  userId: string,
  workspaceId: string,
  selection: TeamRangeSelection,
  view: TeamView,
) =>
  queryOptions({
    queryKey: [
      'workspace',
      userId,
      workspaceId,
      'performance',
      selection,
      view,
    ] as const,
    queryFn: async ({ signal }) => {
      const data = await readBillingResponse<TeamPerformance>(
        await fetch(
          `/api/workspaces/performance?${new URLSearchParams({ ...selection, view })}`,
          { headers: { 'x-workspace-id': workspaceId }, signal },
        ),
        'Chưa thể tải hiệu suất của nhóm. Vui lòng thử lại.',
      )
      if (data.workspaceId !== workspaceId)
        throw new BillingRequestError(
          'Không gian làm việc đã thay đổi. Vui lòng tải lại trang.',
          409,
        )
      return data
    },
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: 'always',
  })
