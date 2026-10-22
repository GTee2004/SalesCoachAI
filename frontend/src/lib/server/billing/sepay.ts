import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '#/env'
import { checkoutReturnUrl } from '#/lib/billing/checkout-return'

const signedFieldOrder = [
  'order_amount',
  'merchant',
  'currency',
  'operation',
  'order_description',
  'order_invoice_number',
  'customer_id',
  'payment_method',
  'success_url',
  'error_url',
  'cancel_url',
] as const

export function makeSepayCheckoutFields(input: {
  amountVnd: number
  invoiceNumber: string
  description: string
  customerId: string
  returnUrl: string
}) {
  if (!env.SEPAY_MERCHANT_ID || !env.SEPAY_SECRET_KEY)
    throw new Error('SePay checkout is not configured')

  const fields: Record<string, string> = {
    order_amount: String(input.amountVnd),
    merchant: env.SEPAY_MERCHANT_ID,
    currency: 'VND',
    operation: 'PURCHASE',
    order_description: input.description,
    order_invoice_number: input.invoiceNumber,
    customer_id: input.customerId,
    success_url: checkoutReturnUrl(input.returnUrl, 'success'),
    error_url: checkoutReturnUrl(input.returnUrl, 'error'),
    cancel_url: checkoutReturnUrl(input.returnUrl, 'cancel'),
  }
  const signed = signedFieldOrder
    .filter((key) => Object.hasOwn(fields, key))
    .map((key) => `${key}=${fields[key]}`)
    .join(',')
  fields.signature = createHmac('sha256', env.SEPAY_SECRET_KEY)
    .update(signed)
    .digest('base64')
  return fields
}

export function verifySepayIpnSecret(value: string | null) {
  if (!value || !env.SEPAY_IPN_SECRET) return false
  const expected = Buffer.from(env.SEPAY_IPN_SECRET)
  const actual = Buffer.from(value)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function normalizeSepayNotificationType(value: unknown) {
  // PAYMENT_SUCCESS was observed in the Sandbox callback; documentation uses
  // ORDER_PAID. Both share a canonical event key so replaying either is safe.
  if (value === 'ORDER_PAID' || value === 'PAYMENT_SUCCESS')
    return 'ORDER_PAID' as const
  if (value === 'TRANSACTION_VOID') return 'TRANSACTION_VOID' as const
  return null
}

export const sepayCheckoutUrl =
  env.SEPAY_ENV === 'production'
    ? 'https://pay.sepay.vn/v1/checkout/init'
    : 'https://pay-sandbox.sepay.vn/v1/checkout/init'
