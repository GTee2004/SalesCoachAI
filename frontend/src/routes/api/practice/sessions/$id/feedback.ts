import { and, eq, isNull } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { db } from '#/db'
import { practiceSessions } from '#/db/schema'
import { evaluatePracticeSessionUnlocked } from '#/lib/server/practice-evaluation'
import {
  isUuid,
  json,
  requireSameOrigin,
  requirePracticeUser,
} from '#/lib/server/http'
import {
  getOwnedSessionFeedback,
  SessionOperationBusyError,
  withSessionOperation,
} from '#/lib/server/practice-sessions'

export const Route = createFileRoute('/api/practice/sessions/$id/feedback')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isUuid(params.id))
          return json({ error: 'Session not found' }, { status: 404 })
        const user = await requirePracticeUser(request)
        const result = await getOwnedSessionFeedback({
          userId: user.id,
          sessionId: params.id,
          workspaceId: user.workspaceId,
        })
        if (!result)
          return json({ error: 'Session not found' }, { status: 404 })
        return json(result)
      },
      POST: async ({ request, params }) => {
        if (!isUuid(params.id))
          return json({ error: 'Session not found' }, { status: 404 })
        requireSameOrigin(request)
        const user = await requirePracticeUser(request)
        const ownedSession = await db.query.practiceSessions.findFirst({
          columns: { id: true },
          where: and(
            eq(practiceSessions.id, params.id),
            eq(practiceSessions.userId, user.id),
            eq(practiceSessions.workspaceId, user.workspaceId),
            isNull(practiceSessions.deletedAt),
          ),
        })
        if (!ownedSession)
          return json({ error: 'Session not found' }, { status: 404 })
        try {
          return await withSessionOperation(params.id, async () => {
            const current = await db.query.practiceSessions.findFirst({
              where: and(
                eq(practiceSessions.id, params.id),
                eq(practiceSessions.userId, user.id),
                eq(practiceSessions.workspaceId, user.workspaceId),
                isNull(practiceSessions.deletedAt),
              ),
            })
            if (!current)
              return json({ error: 'Session not found' }, { status: 404 })
            if (current.status !== 'completed')
              return json(
                { error: 'Session is not completed' },
                { status: 409 },
              )
            try {
              await evaluatePracticeSessionUnlocked(current.id)
              const result = await getOwnedSessionFeedback({
                userId: user.id,
                sessionId: current.id,
                workspaceId: user.workspaceId,
              })
              await db
                .update(practiceSessions)
                .set({
                  runtimeMetadata: {
                    ...(current.runtimeMetadata ?? {}),
                    evaluationError: undefined,
                  },
                })
                .where(eq(practiceSessions.id, current.id))
              return json(result)
            } catch (error) {
              console.error('Practice evaluation failed', {
                sessionId: current.id,
                error,
              })
              await db
                .update(practiceSessions)
                .set({
                  runtimeMetadata: {
                    ...(current.runtimeMetadata ?? {}),
                    evaluationError: 'evaluation_failed',
                  },
                })
                .where(eq(practiceSessions.id, current.id))
              return json(
                { state: 'failed', errorCode: 'evaluation_failed' },
                { status: 502 },
              )
            }
          })
        } catch (error) {
          if (error instanceof SessionOperationBusyError)
            return json(
              { error: 'Session operation already in progress' },
              { status: 409 },
            )
          throw error
        }
      },
    },
  },
})
