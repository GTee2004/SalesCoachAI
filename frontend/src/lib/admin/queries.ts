import { queryOptions } from '@tanstack/react-query'
import type { AdminUsageRange } from './contracts'
import {
  getAdminRecentSessions,
  getAdminServiceCosts,
  getAdminServiceHealth,
  getAdminSessionTranscript,
  getAdminUsage,
  getAdminVoiceLatency,
} from './server-functions'

export const adminQueryKey = (userId: string) => ['admin', userId] as const

export const adminServiceHealthQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: [...adminQueryKey(userId), 'service-health'] as const,
    queryFn: () => getAdminServiceHealth(),
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: false,
  })

export const adminUsageQueryOptions = (
  userId: string,
  range: AdminUsageRange,
) =>
  queryOptions({
    queryKey: [...adminQueryKey(userId), 'usage', range] as const,
    queryFn: () => getAdminUsage({ data: range }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  })

export const adminVoiceLatencyQueryOptions = (
  userId: string,
  range: AdminUsageRange,
) =>
  queryOptions({
    queryKey: [...adminQueryKey(userId), 'voice-latency', range] as const,
    queryFn: () => getAdminVoiceLatency({ data: range }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  })

export const adminServiceCostsQueryOptions = (
  userId: string,
  range: AdminUsageRange,
) =>
  queryOptions({
    queryKey: [...adminQueryKey(userId), 'service-costs', range] as const,
    queryFn: () => getAdminServiceCosts({ data: range }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  })

export const adminRecentSessionsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: [...adminQueryKey(userId), 'recent-sessions'] as const,
    queryFn: () => getAdminRecentSessions(),
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: false,
  })

export const adminSessionTranscriptQueryOptions = (
  userId: string,
  sessionId: string,
) =>
  queryOptions({
    queryKey: [...adminQueryKey(userId), 'transcript', sessionId] as const,
    queryFn: () => getAdminSessionTranscript({ data: { sessionId } }),
    staleTime: 10_000,
    retry: false,
  })
