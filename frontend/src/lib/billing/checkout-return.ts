export const checkoutReturnMessages = {
  success: 'Đã quay về sau thanh toán; đang kiểm tra xác nhận từ SePay.',
  error: 'Trang thanh toán báo lỗi; đang kiểm tra trạng thái đơn tại SePay.',
  cancel:
    'Bạn đã dừng thanh toán. Nếu chưa trả tiền, bạn có thể hủy đơn bên dưới.',
  free: 'Mã giảm giá đã được áp dụng; đơn hàng miễn phí và đã được kích hoạt.',
} as const

export type CheckoutOutcome = keyof typeof checkoutReturnMessages

export function readCheckoutOutcome(
  value: string | null,
): CheckoutOutcome | null {
  return value === 'success' ||
    value === 'error' ||
    value === 'cancel' ||
    value === 'free'
    ? value
    : null
}

export function checkoutReturnUrl(base: string, outcome: CheckoutOutcome) {
  const url = new URL(base)
  url.searchParams.set('payment', outcome)
  return url.toString()
}
