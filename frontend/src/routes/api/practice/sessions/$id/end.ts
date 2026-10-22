import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { db } from '#/db'
import { practiceSessions } from '#/db/schema'
import { evaluatePracticeSessionUnlocked } from '#/lib/server/practice-evaluation'
import { isUuid, json, requireSameOrigin, requireUser } from '#/lib/server/http'
import {
  getOwnedSessionForCleanup,
  SessionOperationBusyError,
  withSessionOperation,
} from '#/lib/server/practice-sessions'
import { endVoiceSession } from '#/lib/server/voice-backend'

export const Route = createFileRoute('/api/practice/sessions/$id/end')({
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
            if (current.status === 'abandoned')
              return json({ status: current.status, endedAt: null })
            if (current.status === 'created') {
              await db
                .update(practiceSessions)
                .set({ status: 'abandoned' })
                .where(
                  and(
                    eq(practiceSessions.id, current.id),
                    eq(practiceSessions.status, 'created'),
                  ),
                )
              return json({ status: 'abandoned', endedAt: null })
            }
            if (current.status === 'in_progress') {
              try {
                await endVoiceSession(current.id, 'user_ended')
              } catch (error) {
                console.error('Voice end failed', {
                  sessionId: current.id,
                  error,
                })
                return json(
                  { error: 'Voice session could not be finalized' },
                  { status: 502 },
                )
              }
              const now = new Date()
              const endedRows = await db
                .update(practiceSessions)
                .set({
                  status: 'completed',
                  completedAt: now,
                  endReason: 'learner_ended',
                })
                .where(
                  and(
                    eq(practiceSessions.id, current.id),
                    eq(practiceSessions.status, 'in_progress'),
                  ),
                )
                .returning()
              if (endedRows.length === 0)
                return json({ error: 'Session state changed' }, { status: 409 })
              const ended = endedRows[0]
              try {
                await evaluatePracticeSessionUnlocked(current.id)
              } catch (error) {
                console.error('Practice evaluation failed', {
                  sessionId: current.id,
                  error,
                })
                await db
                  .update(practiceSessions)
                  .set({
                    runtimeMetadata: {
                      ...(ended.runtimeMetadata ?? {}),
                      evaluationError: 'evaluation_failed',
                    },
                  })
                  .where(eq(practiceSessions.id, current.id))
              }
              return json({ status: 'completed', endedAt: now.toISOString() })
            }
            try {
              await evaluatePracticeSessionUnlocked(current.id)
            } catch (error) {
              console.error('Practice evaluation retry failed', {
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
            }
            return json({
              status: 'completed',
              endedAt: current.completedAt?.toISOString() ?? null,
            })
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
