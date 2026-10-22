import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { getWorkspaceForUser } from '#/lib/server/workspaces'
import {
  getVerifiedSession,
  json,
  readJson,
  requireSameOrigin,
  requireWorkspaceContext,
} from '#/lib/server/http'
import { billingErrorResponse } from '#/lib/server/billing/http'
import { cancelBillingOrder } from '#/lib/server/billing/maintenance'

const schema = z.object({
  workspaceId: z.string().min(1),
  invoice: z.string().min(1).max(64),
})

export const Route = createFileRoute('/api/billing/orders/cancel')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          requireSameOrigin(request)
          const current = await getVerifiedSession(request.headers)
          const body = schema.safeParse(await readJson(request))
          if (!body.success)
            return json({ error: 'Đơn hàng chưa hợp lệ.' }, { status: 400 })
          requireWorkspaceContext(
            current.session.activeOrganizationId,
            body.data.workspaceId,
          )
          const workspace = await getWorkspaceForUser(
            current.user.id,
            body.data.workspaceId,
          )
          if (!workspace || workspace.role !== 'owner')
            return json(
              { error: 'Chỉ chủ sở hữu mới có thể hủy đơn.' },
              { status: 403 },
            )
          return json(await cancelBillingOrder(workspace.id, body.data.invoice))
        } catch (error) {
          return billingErrorResponse(
            error,
            'Chưa thể hủy đơn hàng. Vui lòng thử lại sau.',
          )
        }
      },
    },
  },
})
