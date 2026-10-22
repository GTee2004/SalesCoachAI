import { z } from 'zod'

const providerReference = z.union([
  z.string().min(1),
  z.number().int().nonnegative(),
])
const amount = z.union([z.string(), z.number()])
const transactionSchema = z
  .object({
    id: providerReference,
    transaction_id: providerReference.nullish(),
    transaction_type: z.string(),
    transaction_status: z.string(),
    transaction_amount: amount,
    transaction_currency: z.string(),
  })
  .passthrough()
const orderSchema = z
  .object({
    id: providerReference,
    order_id: z.string().min(1),
    order_invoice_number: z.string().min(1),
    order_status: z.string(),
    order_amount: amount,
    order_currency: z.string(),
  })
  .passthrough()
const detailSchema = orderSchema.extend({
  // An unpaid/cancelled order may have no transaction history yet. A captured
  // order still needs exactly one matching approved payment before fulfillment.
  transactions: z
    .array(transactionSchema)
    .nullish()
    .transform((value) => value ?? []),
})

export type SepayOrder = z.infer<typeof detailSchema>

export function createSepayApi(config: {
  merchantId?: string
  secretKey?: string
  environment: 'sandbox' | 'production'
  fetch?: typeof fetch
}) {
  async function requestSepay(
    path: string,
    invoice?: string,
  ): Promise<unknown> {
    if (!config.merchantId || !config.secretKey)
      throw new Response('Chưa cấu hình thông tin xác thực SePay.', {
        status: 503,
      })
    const origin =
      config.environment === 'production'
        ? 'https://pgapi.sepay.vn'
        : 'https://pgapi-sandbox.sepay.vn'
    let response: Response
    try {
      response = await (config.fetch ?? fetch)(`${origin}${path}`, {
        method: invoice ? 'POST' : 'GET',
        body: invoice
          ? JSON.stringify({ order_invoice_number: invoice })
          : undefined,
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.merchantId}:${config.secretKey}`).toString('base64')}`,
          Accept: 'application/json',
          ...(invoice ? { 'Content-Type': 'application/json' } : {}),
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      })
    } catch {
      throw new Response(
        'Chưa thể kiểm tra thanh toán với SePay. Vui lòng thử lại sau.',
        { status: 503 },
      )
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Response(
        'Chưa thể kiểm tra thanh toán với SePay. Vui lòng thử lại sau.',
        { status: 503 },
      )
    }
    try {
      return await response.json()
    } catch {
      throw new Response(
        'SePay chưa trả về kết quả kiểm tra hợp lệ. Vui lòng thử lại sau.',
        { status: 503 },
      )
    }
  }

  async function getSepayOrderDetail(
    reference: string,
    invoice: string,
    orderId?: string,
  ) {
    const body = await requestSepay(
      `/v1/order/detail/${encodeURIComponent(reference)}`,
    )
    if (body === null) return null
    const parsed = z.object({ data: detailSchema }).safeParse(body)
    if (
      !parsed.success ||
      parsed.data.data.order_invoice_number !== invoice ||
      (orderId !== undefined && parsed.data.data.order_id !== orderId)
    )
      throw new Response(
        'Thông tin đối soát SePay chưa hợp lệ. Vui lòng thử lại sau.',
        { status: 503 },
      )
    return parsed.data.data
  }

  async function findSepayOrderByInvoice(invoice: string) {
    // Official Node SDK retrieves by invoice. Some gateway versions/documentation
    // use the provider order_id instead; only fall back on a genuine 404.
    const direct = await getSepayOrderDetail(invoice, invoice)
    if (direct) return direct
    // The gateway's q parameter is a keyword search: require an exact invoice
    // match rather than fulfilling whichever result comes first.
    const query = new URLSearchParams({
      q: invoice,
      per_page: '100',
      page: '1',
    })
    const body = await requestSepay(`/v1/order?${query}`)
    if (body === null) return null
    const parsed = z
      .object({
        data: z.array(orderSchema),
        meta: z.object({ has_more: z.boolean() }).optional(),
      })
      .safeParse(body)
    if (!parsed.success)
      throw new Response(
        'Thông tin đối soát SePay chưa hợp lệ. Vui lòng thử lại sau.',
        { status: 503 },
      )
    const matches = parsed.data.data.filter(
      (order) => order.order_invoice_number === invoice,
    )
    if (
      matches.length > 1 ||
      parsed.data.meta?.has_more ||
      (!parsed.data.meta && parsed.data.data.length === 100)
    )
      throw new Response(
        'Đơn hàng có kết quả đối soát chưa rõ ràng. Vui lòng liên hệ hỗ trợ trước khi thanh toán lại.',
        { status: 503 },
      )
    if (!matches.length) return null
    const detail = await getSepayOrderDetail(
      matches[0].order_id,
      invoice,
      matches[0].order_id,
    )
    if (!detail || detail.order_invoice_number !== invoice)
      throw new Response(
        'Chưa thể xác minh đầy đủ đơn hàng SePay. Vui lòng thử lại sau.',
        { status: 503 },
      )
    return detail
  }

  async function cancelSepayOrder(invoice: string) {
    const body = await requestSepay('/v1/order/cancel', invoice)
    if (!z.object({ message: z.string().min(1) }).safeParse(body).success)
      throw new Response(
        'SePay chưa xác nhận hủy đơn hàng. Vui lòng kiểm tra lại.',
        { status: 503 },
      )
  }

  return { findSepayOrderByInvoice, cancelSepayOrder }
}
