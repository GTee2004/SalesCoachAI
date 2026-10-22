import { queryOptions } from '@tanstack/react-query'
import { BillingRequestError, readBillingResponse } from './http'
import type { BillingSummary } from './types'

export const billingSummaryQueryOptions = (
  userId: string,
  workspaceId: string,
) =>
  queryOptions({
    queryKey: ['billing', userId, workspaceId, 'summary'] as const,
    queryFn: async ({ signal }) => {
      const summary = await readBillingResponse<BillingSummary>(
        await fetch('/api/billing/summary', {
          headers: { 'x-workspace-id': workspaceId },
          signal,
        }),
        'Chưa thể tải thông tin gói và hạn mức. Vui lòng thử lại.',
      )
      if (summary.workspaceId !== workspaceId)
        throw new BillingRequestError(
          'Không gian làm việc đã thay đổi. Vui lòng tải lại trang.',
          409,
        )
      return summary
    },
    staleTime: 10_000,
    retry: false,
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) =>
      query.state.data?.recentOrders.some((order) =>
        ['pending', 'expired'].includes(order.status),
      )
        ? 15_000
        : false,
  })
