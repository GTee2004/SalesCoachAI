import { queryOptions } from '@tanstack/react-query'
import { getCurrentUser } from '@/lib/auth/current-user'
import { toDateKey } from '@/lib/admin/usage'

export const currentUserQueryKey = ['auth', 'currentUser'] as const

export const currentUserQueryOptions = queryOptions({
  queryKey: currentUserQueryKey,
  queryFn: () => getCurrentUser(),
  // getCurrentUser is also what records the visit of the day. An identity
  // fetched before midnight is therefore stale on the next day, however
  // recent it is; otherwise that day's visit would never reach the server.
  staleTime: (query) =>
    toDateKey(new Date(query.state.dataUpdatedAt)) === toDateKey(new Date())
      ? 5 * 60 * 1000
      : 0,
})
