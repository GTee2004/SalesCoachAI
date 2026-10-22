import type { SepayOrder } from './sepay-client'

export type CancellationOrder = {
  orderInvoiceNumber: string
  amountVnd: number
  currency: string
}

export type CancellationDependencies = {
  lookup: (invoice: string) => Promise<SepayOrder | null>
  cancel: (invoice: string) => Promise<void>
  reconcile: (remote: SepayOrder) => Promise<void>
  status: () => Promise<string>
}

// The redirect is only a UI hint. Cancellation always reads authoritative
// provider state and goes through the same reconciliation as successful IPNs.
export async function cancelUnpaidOrder(
  order: CancellationOrder,
  dependencies: CancellationDependencies,
) {
  async function reconcile() {
    const remote = await dependencies.lookup(order.orderInvoiceNumber)
    if (!remote)
      throw new Response(
        'Chưa tìm thấy đơn tại SePay. Vui lòng kiểm tra lại hoặc liên hệ hỗ trợ.',
        { status: 503 },
      )
    if (
      remote.order_invoice_number !== order.orderInvoiceNumber ||
      remote.order_currency !== order.currency ||
      Number(remote.order_amount) !== order.amountVnd
    )
      throw new Response(
        'Thông tin đơn SePay không khớp. Vui lòng liên hệ hỗ trợ.',
        { status: 503 },
      )
    await dependencies.reconcile(remote)
    return { remote, status: await dependencies.status() }
  }

  const before = await reconcile()
  if (before.status !== 'pending') return before.status
  if (
    before.remote.order_status !== 'AUTHENTICATION_NOT_NEEDED' ||
    before.remote.payment_method === 'CARD' ||
    before.remote.transactions.some(
      (transaction) =>
        transaction.payment_method === 'CARD' ||
        (transaction.transaction_type === 'PAYMENT' &&
          transaction.transaction_status === 'APPROVED'),
    )
  )
    throw new Response(
      'Đơn chưa thể hủy tự động. Vui lòng kiểm tra thanh toán hoặc liên hệ hỗ trợ.',
      { status: 409 },
    )

  let cancellationError: unknown
  try {
    await dependencies.cancel(order.orderInvoiceNumber)
  } catch (error) {
    // A timeout/rejection can race with payment or a successful cancellation.
    // Re-read before reporting failure; never equate a failed request with a
    // cancelled order or blindly retry a payment.
    cancellationError = error
  }
  const after = await reconcile()
  if (after.status !== 'pending') return after.status
  if (cancellationError) throw cancellationError
  throw new Response(
    'SePay chưa xác nhận trạng thái hủy. Hệ thống sẽ kiểm tra lại; vui lòng không thanh toán lại nếu đã trả tiền.',
    { status: 503 },
  )
}

export function maintenanceRetryDelay(attempt: number) {
  return Math.min(
    60 * 60_000,
    60_000 * 2 ** Math.min(Math.max(0, attempt - 1), 6),
  )
}
