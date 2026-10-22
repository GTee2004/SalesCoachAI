import { createFileRoute } from '@tanstack/react-router'
import { env } from '#/env'
import { safeSecretEqual } from '#/lib/server/voice-token'
import { sweepExpiredBillingOrders } from '#/lib/server/billing/maintenance'

export const Route = createFileRoute('/api/internal/billing/expire-orders')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get('authorization')
        const bearer = authorization?.startsWith('Bearer ')
          ? authorization.slice(7)
          : null
        if (!safeSecretEqual(bearer, env.BILLING_SWEEP_SECRET))
          return Response.json(
            { error: 'Unauthorized' },
            { status: 401, headers: { 'Cache-Control': 'no-store' } },
          )
        try {
          const result = await sweepExpiredBillingOrders()
          console.info('[Billing sweep] complete', result)
          return Response.json(result, {
            headers: { 'Cache-Control': 'no-store' },
          })
        } catch (error) {
          console.error('[Billing sweep] failed', error)
          return Response.json(
            { error: 'Billing sweep failed' },
            { status: 500 },
          )
        }
      },
    },
  },
})
