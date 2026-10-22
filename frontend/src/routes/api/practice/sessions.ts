import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  createPracticeSession,
  listOwnedPracticeSessions,
} from '#/lib/server/practice-sessions'
import { practiceHistoryInputSchema } from '#/lib/practice/history'
import {
  json,
  readJson,
  requireSameOrigin,
  requirePracticeUser,
} from '#/lib/server/http'

const createSchema = z.object({ practiceId: z.string().uuid() })

export const Route = createFileRoute('/api/practice/sessions')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requirePracticeUser(request)
        const url = new URL(request.url)
        const raw = Object.fromEntries(url.searchParams)
        const parsed = practiceHistoryInputSchema.safeParse({
          page: raw.page ? Number(raw.page) : undefined,
          pageSize: raw.pageSize ? Number(raw.pageSize) : undefined,
          type: raw.type,
          evaluation: raw.evaluation,
          from: raw.from || undefined,
          to: raw.to || undefined,
        })
        if (!parsed.success)
          return json({ error: 'Invalid history filters' }, { status: 400 })
        return json(
          await listOwnedPracticeSessions(
            user.id,
            parsed.data,
            user.workspaceId,
          ),
        )
      },
      POST: async ({ request }) => {
        requireSameOrigin(request)
        const user = await requirePracticeUser(request)
        const parsed = createSchema.safeParse(await readJson(request))
        if (!parsed.success)
          return json({ error: 'Invalid practice ID' }, { status: 400 })
        const created = await createPracticeSession(
          user.id,
          parsed.data.practiceId,
          user.workspaceId,
        )
        if (!created)
          return json({ error: 'Practice not found' }, { status: 404 })
        return json(
          { sessionId: created.id, status: created.status },
          { status: 201 },
        )
      },
    },
  },
})
