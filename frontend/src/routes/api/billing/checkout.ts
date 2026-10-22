import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { env } from '#/env'
import { getWorkspaceForUser } from '#/lib/server/workspaces'
import {
  json,
  readJson,
  requireSameOrigin,
  getVerifiedSession,
  requireWorkspaceContext,
} from '#/lib/server/http'
import { createCheckout } from '#/lib/server/billing/checkout'
import { billingErrorResponse } from '#/lib/server/billing/http'

const checkoutSchema = z.object({
  workspaceId: z.string().min(1),
  productCode: z.string().min(1).max(64),
  seatQuantity: z.number().int().min(1).max(500).default(1),
  creditRecipientUserId: z.string().min(1).optional(),
  expectedSubscriptionPeriodEnd: z.string().datetime().nullable().optional(),
  couponCode: z.string().trim().min(1).max(40).optional(),
  idempotencyKey: z.string().uuid(),
})

export const Route = createFileRoute('/api/billing/checkout')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          requireSameOrigin(request)
          const current = await getVerifiedSession(request.headers)
          const body = checkoutSchema.safeParse(await readJson(request))
          if (!body.success)
            return json(
              { error: 'Thông tin thanh toán chưa hợp lệ.' },
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
          if (!workspace)
            return json(
              { error: 'Bạn không có quyền với không gian làm việc này.' },
              { status: 403 },
            )
          const checkout = await createCheckout({
            userId: current.user.id,
            workspaceId: workspace.id,
            productCode: body.data.productCode,
            seatQuantity: body.data.seatQuantity,
            creditRecipientUserId: body.data.creditRecipientUserId,
            expectedSubscriptionPeriodEnd:
              body.data.expectedSubscriptionPeriodEnd,
            couponCode: body.data.couponCode,
            idempotencyKey: body.data.idempotencyKey,
            publicBaseUrl: new URL(
              env.BILLING_PUBLIC_BASE_URL ?? env.BETTER_AUTH_URL,
            ).origin,
          })
          return json(checkout)
        } catch (error) {
          return billingErrorResponse(
            error,
            'Chưa thể tạo thanh toán. Vui lòng thử lại sau.',
          )
        }
      },
    },
  },
})
