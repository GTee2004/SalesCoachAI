import { queryOptions } from '@tanstack/react-query'
import {
  getPracticeCatalog,
  getPracticeFeedback,
  getPracticeHistory,
  getPracticeRecommendations,
  getPracticeSession,
  getVoiceInputOptions,
  readPerformance,
} from './server-functions'
import type { PracticeHistoryInput } from './history'
import type { PerformanceDifficulty, PerformancePeriod } from './performance'

export const practiceCatalogQueryOptions = (
  userId: string,
  workspaceId: string,
) =>
  queryOptions({
    queryKey: ['practice', userId, workspaceId, 'catalog'] as const,
    queryFn: () => getPracticeCatalog({ data: { workspaceId } }),
    staleTime: 5 * 60_000,
    retry: false,
  })

export const practiceRecommendationsQueryOptions = (
  userId: string,
  workspaceId: string,
) =>
  queryOptions({
    queryKey: ['practice', userId, workspaceId, 'recommendations'] as const,
    queryFn: () => getPracticeRecommendations({ data: { workspaceId } }),
    staleTime: 60_000,
    retry: false,
  })

export const practiceHistoryQueryOptions = (
  userId: string,
  workspaceId: string,
  input: PracticeHistoryInput,
) =>
  queryOptions({
    queryKey: ['practice', userId, workspaceId, 'history', input] as const,
    queryFn: () => getPracticeHistory({ data: { ...input, workspaceId } }),
    staleTime: 15_000,
    retry: false,
  })

export const practiceSessionQueryOptions = (
  userId: string,
  workspaceId: string,
  sessionId: string,
) =>
  queryOptions({
    queryKey: ['practice', userId, workspaceId, 'session', sessionId] as const,
    queryFn: () => getPracticeSession({ data: { sessionId, workspaceId } }),
    staleTime: 5_000,
    retry: false,
  })

export const voiceInputOptionsQueryOptions = (
  userId: string,
  workspaceId: string,
) =>
  queryOptions({
    queryKey: ['practice', userId, workspaceId, 'voice-input-options'] as const,
    queryFn: () => getVoiceInputOptions({ data: { workspaceId } }),
    staleTime: 5 * 60_000,
    retry: false,
  })

export const practiceFeedbackQueryOptions = (
  userId: string,
  workspaceId: string,
  sessionId: string,
) =>
  queryOptions({
    queryKey: ['practice', userId, workspaceId, 'feedback', sessionId] as const,
    queryFn: () => getPracticeFeedback({ data: { sessionId, workspaceId } }),
    staleTime: 5_000,
    retry: false,
    // Evaluation can run on the server after a call it ended by itself.
    refetchInterval: (query) =>
      query.state.data?.state === 'pending' ? 3_000 : false,
  })

export const performanceQueryOptions = (
  userId: string,
  workspaceId: string,
  period: PerformancePeriod,
  difficulty?: PerformanceDifficulty,
) =>
  queryOptions({
    queryKey: [
      'practice',
      userId,
      workspaceId,
      'performance',
      period,
      difficulty ?? 'all',
    ] as const,
    queryFn: () =>
      readPerformance({ data: { period, difficulty, workspaceId } }),
    staleTime: 15_000,
    retry: false,
  })
