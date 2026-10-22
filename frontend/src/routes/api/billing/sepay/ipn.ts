import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { env } from '#/env'
import { processSepayIpn } from '#/lib/server/billing/checkout'
import { verifySepayIpnSecret } from '#/lib/server/billing/sepay'

const ipnSchema = z
  .object({
    notification_type: z.enum([
      'ORDER_PAID',
      'PAYMENT_SUCCESS',
      'TRANSACTION_VOID',
    ]),
    order: z
      .object({
        id: z.string().min(1),
        order_id: z.string().min(1),
        order_invoice_number: z.string().min(1).max(64),
        order_currency: z.string().length(3),
        order_amount: z.union([z.string(), z.number()]),
        order_status: z.string(),
      })
      .passthrough(),
    transaction: z
      .object({
        transaction_id: z.union([z.string(), z.number()]),
        transaction_status: z.string(),
        transaction_amount: z.union([z.string(), z.number()]),
        transaction_currency: z.string().length(3),
      })
      .passthrough(),
    timestamp: z.number().optional(),
    customer: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough()

export const Route = createFileRoute('/api/billing/sepay/ipn')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const development = env.NODE_ENV !== 'production'
        if (development) console.info('[SePay IPN] POST received')
        // Require the configured secret in every environment, before parsing or
        // processing a callback. Provider lookups are recovery, not IPN auth.
        if (!verifySepayIpnSecret(request.headers.get('x-secret-key'))) {
          if (development)
            console.warn('[SePay IPN] rejected: missing or invalid IPN secret')
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const contentLength = Number(request.headers.get('content-length') ?? 0)
        if (contentLength > 128_000)
          return Response.json({ error: 'Payload too large' }, { status: 413 })
        const body = await request.text()
        if (new TextEncoder().encode(body).byteLength > 128_000)
          return Response.json({ error: 'Payload too large' }, { status: 413 })
        let raw: unknown
        try {
          raw = JSON.parse(body)
        } catch {
          if (development)
            console.warn('[SePay IPN] rejected: body is not valid JSON')
          return Response.json({ error: 'Invalid JSON' }, { status: 400 })
        }
        const parsed = ipnSchema.safeParse(raw)
        if (!parsed.success) {
          const receivedType =
            typeof raw === 'object' && raw !== null
              ? (raw as Record<string, unknown>).notification_type
              : undefined
          const receivedNotificationType =
            typeof receivedType === 'string'
              ? receivedType.slice(0, 128)
              : receivedType === undefined
                ? '[missing]'
                : `[${typeof receivedType}]`
          const issues = parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          }))
          if (development)
            console.warn('[SePay IPN] invalid notification', {
              receivedNotificationType,
              issues,
            })
          return Response.json(
            {
              error: 'Invalid notification',
              ...(development ? { receivedNotificationType, issues } : {}),
            },
            { status: 400 },
          )
        }
        try {
          const payload = parsed.data as Record<string, unknown>
          const order = payload.order as Record<string, unknown>
          if (development)
            console.info('[SePay IPN] parsed notification', {
              type: payload.notification_type,
              invoice: order.order_invoice_number,
            })
          await processSepayIpn(payload, env.SEPAY_ENV)
          if (development)
            console.info('[SePay IPN] notification processed', {
              type: payload.notification_type,
              invoice: order.order_invoice_number,
            })
          return Response.json({ success: true }, { status: 200 })
        } catch (error) {
          if (error instanceof Response) {
            if (development)
              console.warn('[SePay IPN] request failed', {
                status: error.status,
              })
            return error
          }
          console.error('SePay IPN processing failed', error)
          return Response.json(
            { error: 'Unable to process notification' },
            { status: 500 },
          )
        }
      },
    },
  },
})
