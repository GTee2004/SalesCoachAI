import { createFileRoute } from '@tanstack/react-router'
import {
  getBillingSummary,
  reconcilePendingBillingOrders,
} from '#/lib/server/billing/checkout'
import { billingErrorResponse } from '#/lib/server/billing/http'
import {
  getWorkspaceForUser,
  listOwnedCompanyWorkspaces,
} from '#/lib/server/workspaces'
import { getVerifiedSession, requireWorkspaceContext } from '#/lib/server/http'
import { and, eq } from 'drizzle-orm'
import { billingOrders, workspaceProfiles } from '#/db/schema'
import { db } from '#/db'
import { ensureIncludedAllowance } from '#/lib/server/billing/credits'
import { getSeatAvailability } from '#/lib/server/billing/seats'

export const Route = createFileRoute('/api/billing/summary')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const current = await getVerifiedSession(request.headers)
          const workspaceId = current.session.activeOrganizationId
          const expectedWorkspaceId = request.headers.get('x-workspace-id')
          if (expectedWorkspaceId)
            requireWorkspaceContext(workspaceId, expectedWorkspaceId)
          const workspace = await getWorkspaceForUser(
            current.user.id,
            workspaceId,
          )
          if (!workspace)
            return Response.json(
              { error: 'Không gian làm việc không tồn tại.' },
              { status: 404 },
            )
          const invoice =
            new URL(request.url).searchParams.get('order') ?? undefined
          const verification =
            workspace.role === 'owner'
              ? await reconcilePendingBillingOrders(workspace.id, { invoice })
              : { warning: null, warnings: [] }
          try {
            await ensureIncludedAllowance(workspace.id, current.user.id)
          } catch (error) {
            // Billing remains readable for unpaid Business workspaces and managers
            // without a practice seat. Practice still enforces these restrictions.
            if (
              workspace.kind !== 'company' ||
              !(error instanceof Response) ||
              ![402, 403].includes(error.status)
            )
              throw error
          }
          const summary = await getBillingSummary(workspace.id, current.user.id)
          const personalWorkspace = await db.query.workspaceProfiles.findFirst({
            columns: { workspaceId: true },
            where: eq(workspaceProfiles.personalOwnerUserId, current.user.id),
          })
          // Lets the personal billing page offer an existing company workspace
          // before creating another one for Business.
          const ownedCompanyWorkspaces =
            workspace.kind === 'personal'
              ? await listOwnedCompanyWorkspaces(current.user.id)
              : []
          const recentOrders =
            workspace.role === 'owner'
              ? await db.query.billingOrders.findMany({
                  where: eq(billingOrders.workspaceId, workspace.id),
                  orderBy: (orders, { desc }) => [desc(orders.createdAt)],
                  limit: 10,
                })
              : await db.query.billingOrders.findMany({
                  where: and(
                    eq(billingOrders.workspaceId, workspace.id),
                    eq(billingOrders.purchasedByUserId, current.user.id),
                  ),
                  orderBy: (orders, { desc }) => [desc(orders.createdAt)],
                  limit: 10,
                })
          if (
            invoice &&
            !recentOrders.some((order) => order.orderInvoiceNumber === invoice)
          ) {
            const selected = await db.query.billingOrders.findFirst({
              where: and(
                eq(billingOrders.workspaceId, workspace.id),
                eq(billingOrders.orderInvoiceNumber, invoice),
                workspace.role === 'owner'
                  ? undefined
                  : eq(billingOrders.purchasedByUserId, current.user.id),
              ),
            })
            if (selected) recentOrders.push(selected)
          }
          // Recovery can activate a Business workspace during this request.
          const profile = await db.query.workspaceProfiles.findFirst({
            where: eq(workspaceProfiles.workspaceId, workspace.id),
          })
          const seatUsage =
            workspace.kind === 'company' && workspace.role === 'owner'
              ? await getSeatAvailability(workspace.id)
              : null
          return Response.json(
            {
              ...summary,
              seatUsage: seatUsage && {
                used: seatUsage.used,
                pendingInvitations: seatUsage.pendingInvitations,
              },
              paymentVerificationWarning: verification.warning,
              personalWorkspaceId: personalWorkspace?.workspaceId ?? null,
              ownedCompanyWorkspaces,
              members: workspace.role === 'owner' ? summary.members : [],
              workspace: {
                id: workspace.id,
                name: workspace.name,
                kind: workspace.kind,
                status: profile?.status ?? workspace.status,
                role: workspace.role,
              },
              recentOrders: recentOrders.map((order) => ({
                id: order.id,
                invoice: order.orderInvoiceNumber,
                productCode: order.productCode,
                amountVnd: order.amountVnd,
                discountVnd: order.discountVnd,
                couponCode: order.couponCode,
                status:
                  order.status === 'pending' && order.expiresAt <= new Date()
                    ? 'expired'
                    : order.status,
                createdAt: order.createdAt.toISOString(),
                verificationWarning:
                  verification.warnings.find(
                    (warning) => warning.invoice === order.orderInvoiceNumber,
                  )?.message ?? null,
              })),
            },
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch (error) {
          return billingErrorResponse(
            error,
            'Chưa thể tải thông tin thanh toán. Vui lòng thử lại sau.',
          )
        }
      },
    },
  },
})
