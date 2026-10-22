import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { practiceHistoryInputSchema } from './history'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getVerifiedSession, requireWorkspaceContext } from '#/lib/server/http'
import { requireReadyWorkspace } from '#/lib/server/workspaces'
import { getPerformanceSummary } from '#/lib/server/performance'
import { listLearnerPractices } from '#/lib/server/practice-domain'
import { getPracticeRecommendations as readRecommendations } from '#/lib/server/practice-recommendations'
import { getVoiceBackendStatus } from '#/lib/server/voice-backend'
import {
  getOwnedSessionFeedback,
  getOwnedSessionSnapshot,
  listOwnedPracticeSessions,
} from '#/lib/server/practice-sessions'

async function requireVerifiedUser(expectedWorkspaceId: string) {
  const current = await getVerifiedSession(getRequestHeaders())
  requireWorkspaceContext(
    current.session.activeOrganizationId,
    expectedWorkspaceId,
  )
  const workspace = await requireReadyWorkspace(
    current.user.id,
    current.session.activeOrganizationId,
  )
  return {
    ...current.user,
    workspaceId: workspace.id,
  }
}

const workspaceInput = z.object({ workspaceId: z.string().min(1) })

export const getPracticeCatalog = createServerFn({ method: 'GET' })
  .validator(workspaceInput)
  .handler(async ({ data }) => {
    const user = await requireVerifiedUser(data.workspaceId)
    return { items: await listLearnerPractices(user.id, user.workspaceId) }
  })

export const getPracticeRecommendations = createServerFn({
  method: 'GET',
})
  .validator(workspaceInput)
  .handler(async ({ data }) => {
    const user = await requireVerifiedUser(data.workspaceId)
    return { items: await readRecommendations(user.id, user.workspaceId) }
  })

export const getPracticeHistory = createServerFn({ method: 'GET' })
  .validator(practiceHistoryInputSchema.extend(workspaceInput.shape))
  .handler(async ({ data }) => {
    const user = await requireVerifiedUser(data.workspaceId)
    return listOwnedPracticeSessions(user.id, data, user.workspaceId)
  })

export const readPerformance = createServerFn({ method: 'GET' })
  .validator(
    workspaceInput.extend({
      period: z.enum(['recent', 'all']),
      difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireVerifiedUser(data.workspaceId)
    return getPerformanceSummary(
      user.id,
      user.workspaceId,
      data.period,
      data.difficulty ?? null,
    )
  })

export const getVoiceInputOptions = createServerFn({ method: 'GET' })
  .validator(workspaceInput)
  .handler(async ({ data }) => {
    await requireVerifiedUser(data.workspaceId)
    // Hide the mic choice whenever we cannot confirm it takes effect.
    const status = await getVoiceBackendStatus().catch(() => null)
    return { micTypeSelectable: status?.micTypeSelectable ?? false }
  })

const sessionInput = workspaceInput.extend({ sessionId: z.string().uuid() })

export const getPracticeSession = createServerFn({ method: 'GET' })
  .validator(sessionInput)
  .handler(async ({ data }) => {
    const user = await requireVerifiedUser(data.workspaceId)
    return getOwnedSessionSnapshot({
      userId: user.id,
      sessionId: data.sessionId,
      workspaceId: user.workspaceId,
    })
  })

export const getPracticeFeedback = createServerFn({ method: 'GET' })
  .validator(sessionInput)
  .handler(async ({ data }) => {
    const user = await requireVerifiedUser(data.workspaceId)
    return getOwnedSessionFeedback({
      userId: user.id,
      sessionId: data.sessionId,
      workspaceId: user.workspaceId,
    })
  })
