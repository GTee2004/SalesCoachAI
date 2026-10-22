import { and, eq, inArray } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { db } from '#/db'
import { practiceSessions } from '#/db/schema'
import { isUuid, json, requireSameOrigin, requireUser } from '#/lib/server/http'
import {
  getOwnedSessionForCleanup,
  SessionOperationBusyError,
  withSessionOperation,
} from '#/lib/server/practice-sessions'
import { endVoiceSession } from '#/lib/server/voice-backend'

export const Route = createFileRoute('/api/practice/sessions/$id/abandon')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isUuid(params.id))
          return json({ error: 'Session not found' }, { status: 404 })
        requireSameOrigin(request)
        const user = await requireUser(request)
        const ownedSession = await getOwnedSessionForCleanup({
          userId: user.id,
          sessionId: params.id,
        })
        if (!ownedSession)
          return json({ error: 'Session not found' }, { status: 404 })
        try {
          return await withSessionOperation(params.id, async () => {
            const current = await getOwnedSessionForCleanup({
              userId: user.id,
              sessionId: params.id,
            })
            if (!current)
              return json({ error: 'Session not found' }, { status: 404 })
            if (current.status === 'completed')
              return json(
                { error: 'Completed sessions cannot be abandoned' },
                { status: 409 },
              )
            if (current.status === 'abandoned')
              return json({ status: 'abandoned' })
            if (current.status === 'in_progress') {
              try {
                await endVoiceSession(current.id, 'abandoned')
              } catch (error) {
                console.error('Voice abandon failed', {
                  sessionId: current.id,
                  error,
                })
                return json(
                  { error: 'Voice session could not be finalized' },
                  { status: 502 },
                )
              }
            }
            await db
              .update(practiceSessions)
              .set({
                status: 'abandoned',
                // The call ends here; without this its duration is unknown.
                ...(current.status === 'in_progress'
                  ? { completedAt: new Date() }
                  : {}),
              })
              .where(
                and(
                  eq(practiceSessions.id, current.id),
                  inArray(practiceSessions.status, ['created', 'in_progress']),
                ),
              )
            return json({ status: 'abandoned' })
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
