import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { assignWorkspaceSeat } from '#/lib/server/billing/credits'
import {
  json,
  readJson,
  requireSameOrigin,
  requireUser,
} from '#/lib/server/http'
import { getWorkspaceForUser } from '#/lib/server/workspaces'

const seatSchema = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
})

export const Route = createFileRoute('/api/billing/seats')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        requireSameOrigin(request)
        const currentUser = await requireUser(request)
        const body = seatSchema.safeParse(await readJson(request))
        if (!body.success)
          return json({ error: 'Thông tin suất chưa hợp lệ.' }, { status: 400 })
        const workspace = await getWorkspaceForUser(
          currentUser.id,
          body.data.workspaceId,
        )
        if (!workspace)
          return json(
            { error: 'Không gian làm việc không tồn tại.' },
            { status: 404 },
          )
        await assignWorkspaceSeat({
          workspaceId: workspace.id,
          userId: body.data.userId,
          assignedBy: currentUser.id,
          reason: 'owner_assigned',
        })
        return json({ assigned: true })
      },
    },
  },
})
