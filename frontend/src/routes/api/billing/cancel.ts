import { and, eq, gt, isNull } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { db } from '#/db'
import { workspaceSubscriptions } from '#/db/schema'
import { getWorkspaceForUser } from '#/lib/server/workspaces'
import {
  getVerifiedSession,
  json,
  readJson,
  requireSameOrigin,
} from '#/lib/server/http'
import { z } from 'zod'

const cancelSchema = z.object({ workspaceId: z.string().min(1) })

export const Route = createFileRoute('/api/billing/cancel')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        requireSameOrigin(request)
        const current = await getVerifiedSession(request.headers)
        const parsed = cancelSchema.safeParse(await readJson(request))
        if (!parsed.success)
          return json(
            { error: 'Không gian làm việc chưa hợp lệ.' },
            { status: 400 },
          )
        const workspace = await getWorkspaceForUser(
          current.user.id,
          parsed.data.workspaceId,
        )
        if (!workspace)
          return json(
            { error: 'Không gian làm việc không tồn tại.' },
            { status: 404 },
          )
        if (workspace.role !== 'owner')
          return json(
            { error: 'Chỉ chủ sở hữu mới có thể quản lý gói.' },
            { status: 403 },
          )
        const updated = await db
          .update(workspaceSubscriptions)
          .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
          .where(
            and(
              eq(workspaceSubscriptions.workspaceId, workspace.id),
              eq(workspaceSubscriptions.status, 'active'),
              gt(workspaceSubscriptions.currentPeriodEnd, new Date()),
              isNull(workspaceSubscriptions.pendingPlan),
            ),
          )
          .returning({ workspaceId: workspaceSubscriptions.workspaceId })
        if (!updated.length)
          return json(
            { error: 'Không có gói đang hoạt động.' },
            { status: 404 },
          )
        return json({ cancelAtPeriodEnd: true })
      },
    },
  },
})
