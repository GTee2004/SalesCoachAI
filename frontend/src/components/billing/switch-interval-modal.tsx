import { Button } from '#/components/ui/button'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '#/components/ui/responsive-modal'
import { subscriptions } from '#/lib/billing/catalog'
import type { BillingSummary } from '#/lib/billing/types'

const money = new Intl.NumberFormat('vi-VN')
const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'long',
  timeZone: 'Asia/Ho_Chi_Minh',
})
const intervalLabel = { monthly: 'hàng tháng', yearly: 'hàng năm' } as const

type SwitchIntervalModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  summary: BillingSummary
  busy: boolean
  error: string
  onPay: (productCode: string, seats: number) => void
}

export function SwitchIntervalModal({
  open,
  onOpenChange,
  summary,
  busy,
  error,
  onPay,
}: SwitchIntervalModalProps) {
  const current = summary.interval ?? 'monthly'
  const target = current === 'monthly' ? 'yearly' : 'monthly'
  const seats = summary.seatQuantity
  const price = subscriptions.business[target].priceVnd * seats
  // A year costs 10 months, which is the whole point of switching to it.
  const monthlyEquivalent = subscriptions.business.monthly.priceVnd * seats * 12
  const saving =
    monthlyEquivalent - subscriptions.business.yearly.priceVnd * seats
  const startsAt = summary.currentPeriodEnd
    ? dateFormat.format(new Date(summary.currentPeriodEnd))
    : 'khi kỳ hiện tại kết thúc'

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen)
      }}
    >
      <ResponsiveModalContent className="border-border bg-background p-6 font-sans text-foreground shadow-[0_6px_24px_var(--shadow-ink)] sm:p-7 lg:w-full lg:max-w-lg">
        <ResponsiveModalHeader className="space-y-3 text-left">
          <ResponsiveModalTitle className="pr-6 text-[23px] font-normal leading-[1.4]">
            Đổi sang thanh toán {intervalLabel[target]}
          </ResponsiveModalTitle>
          <ResponsiveModalDescription className="text-[13px] leading-[1.6]">
            Hiện tại không gian làm việc thanh toán {intervalLabel[current]} cho{' '}
            {seats} suất.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="mt-5 rounded-lg bg-brand-gradient p-4 text-[13px] leading-[1.6]">
          <p className="font-medium">
            Gói {intervalLabel[target]} · {seats} suất · {money.format(price)} ₫
          </p>
          <p className="mt-1 text-muted-foreground">
            Gói mới bắt đầu từ {startsAt}, sau khi kỳ hiện tại kết thúc. Bạn giữ
            nguyên hạn mức và số suất đang dùng, và không được hoàn tiền kỳ hiện
            tại. Khoản thanh toán này là kỳ đầu tiên của chu kỳ mới.
          </p>
          {target === 'yearly' && saving > 0 && (
            <p className="mt-1 text-muted-foreground">
              Thanh toán hàng năm tiết kiệm {money.format(saving)} ₫ so với 12
              tháng thanh toán lẻ.
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-[13px] text-destructive">
            {error}
          </p>
        )}

        <ResponsiveModalFooter className="mt-6 gap-3 sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            className="h-12 rounded-lg px-5 text-sm font-normal"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Hủy
          </Button>
          <Button
            type="button"
            className="h-12 rounded-lg px-5 text-sm font-normal"
            disabled={busy}
            onClick={() => onPay(`business_${target}`, seats)}
          >
            {busy ? 'Đang chuyển đến thanh toán…' : 'Tiếp tục thanh toán'}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
