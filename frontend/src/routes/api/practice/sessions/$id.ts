import { reconcileVoiceSessions } from '#/lib/server/voice-session-lifecycle'
import { getVoiceSession } from '#/lib/server/voice-backend'
import { createFileRoute } from '@tanstack/react-router'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '#/db'
import { practiceSessions } from '#/db/schema'
import {
  isUuid,
  json,
  requireSameOrigin,
  requirePracticeUser,
} from '#/lib/server/http'
import {
  deleteOwnedPracticeSession,
  getOwnedSessionSnapshot,
  SessionOperationBusyError,
} from '#/lib/server/practice-sessions'

export const Route = createFileRoute('/api/practice/sessions/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isUuid(params.id))
          return json({ error: 'Session not found' }, { status: 404 })
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
        await reconcileVoiceSessions(params.id, getVoiceSession)
        const session = await getOwnedSessionSnapshot({
          userId: user.id,
          sessionId: params.id,
          workspaceId: user.workspaceId,
        })
        if (!session)
          return json({ error: 'Session not found' }, { status: 404 })
        return json(session)
      },
      DELETE: async ({ request, params }) => {
        requireSameOrigin(request)
        if (!isUuid(params.id))
          return json({ error: 'Session not found' }, { status: 404 })
        const user = await requirePracticeUser(request)
        try {
          const result = await deleteOwnedPracticeSession(
            user.id,
            params.id,
            user.workspaceId,
          )
          if (result === 'missing')
            return json({ error: 'Session not found' }, { status: 404 })
          if (result === 'unfinished')
            return json(
              { error: 'Phiên luyện tập chưa kết thúc nên không thể xóa.' },
              { status: 409 },
            )
          return new Response(null, {
            status: 204,
            headers: { 'cache-control': 'private, no-store' },
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
