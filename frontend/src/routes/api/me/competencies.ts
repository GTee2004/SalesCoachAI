import { createFileRoute } from '@tanstack/react-router'
import { requirePracticeUser } from '#/lib/server/http'
import { getCompetencyProfiles } from '#/lib/server/practice-recommendations'

const privateHeaders = { 'Cache-Control': 'private, no-store' }

export const Route = createFileRoute('/api/me/competencies')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requirePracticeUser(request)
        return Response.json(
          { items: await getCompetencyProfiles(user.id, user.workspaceId) },
          { headers: privateHeaders },
        )
      },
    },
  },
})
