import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import {
  getVerifiedSession,
  json,
  readJson,
  requireSameOrigin,
  requireWorkspaceContext,
} from '#/lib/server/http'
import { getWorkspaceForUser } from '#/lib/server/workspaces'
import { previewCoupon } from '#/lib/server/billing/coupons'
import { billingErrorResponse } from '#/lib/server/billing/http'

const couponSchema = z.object({
  workspaceId: z.string().min(1),
  code: z.string().trim().min(1).max(40),
})

// Lets the billing page show what a code is worth before checkout. Checkout
// validates the code again, so this endpoint only ever informs.
export const Route = createFileRoute('/api/billing/coupon')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          requireSameOrigin(request)
          const current = await getVerifiedSession(request.headers)
          const body = couponSchema.safeParse(await readJson(request))
          if (!body.success)
            return json(
              { error: 'Mã giảm giá không hợp lệ hoặc đã hết hạn.' },
              { status: 400 },
            )
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
              { error: 'Chỉ chủ sở hữu mới có thể dùng mã giảm giá.' },
              { status: 403 },
            )
          return json(
            await previewCoupon({
              code: body.data.code,
              workspaceId: workspace.id,
            }),
          )
        } catch (error) {
          return billingErrorResponse(
            error,
            'Chưa thể kiểm tra mã giảm giá. Vui lòng thử lại sau.',
          )
        }
      },
    },
  },
})
