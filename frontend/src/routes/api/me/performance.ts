import { createFileRoute } from '@tanstack/react-router'
import { requirePracticeUser } from '#/lib/server/http'
import { getPerformanceSummary } from '#/lib/server/performance'

const privateHeaders = { 'Cache-Control': 'private, no-store' }
export const Route = createFileRoute('/api/me/performance')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requirePracticeUser(request)
        const params = new URL(request.url).searchParams
        const period = params.get('period') ?? 'recent'
        const difficulty = params.get('difficulty')
        if (period !== 'recent' && period !== 'all')
          return Response.json(
            { error: 'Invalid performance period' },
            { status: 400, headers: privateHeaders },
          )
        if (
          difficulty !== null &&
          difficulty !== 'beginner' &&
          difficulty !== 'intermediate' &&
          difficulty !== 'advanced'
        )
          return Response.json(
            { error: 'Invalid performance difficulty' },
            { status: 400, headers: privateHeaders },
          )
        return Response.json(
          await getPerformanceSummary(
            user.id,
            user.workspaceId,
            period,
            difficulty,
          ),
          { headers: privateHeaders },
        )
      },
    },
  },
})
