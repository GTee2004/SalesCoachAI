import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '#/components/ui/responsive-modal'
import {
  BUSINESS_MAX_SEATS,
  BUSINESS_MIN_SEATS,
  subscriptions,
} from '#/lib/billing/catalog'
import {
  quoteSeatAddition,
  seatAdditionProductCode,
} from '#/lib/billing/proration'
import type { BillingSummary } from '#/lib/billing/types'

const money = new Intl.NumberFormat('vi-VN')
const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'long',
  timeZone: 'Asia/Ho_Chi_Minh',
})

type ManageSeatsModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  summary: BillingSummary
  busy: boolean
  error: string
  onPay: (productCode: string, seats: number) => void
}

export function ManageSeatsModal({
  open,
  onOpenChange,
  summary,
  busy,
  error,
  onPay,
}: ManageSeatsModalProps) {
  const interval = summary.interval ?? 'monthly'
  const current = summary.seatQuantity
  const reserved =
    (summary.seatUsage?.used ?? 0) +
    (summary.seatUsage?.pendingInvitations ?? 0)
  const minSeats = Math.max(BUSINESS_MIN_SEATS, reserved)
  const [target, setTarget] = useState(current)
  const delta = target - current
  const periodEnd = summary.currentPeriodEnd
    ? new Date(summary.currentPeriodEnd)
    : null

  const increase = useMemo(() => {
    if (delta < 1 || !periodEnd) return null
    try {
      return quoteSeatAddition({
        interval,
        currentPeriodEnd: periodEnd,
        seatsToAdd: delta,
        now: new Date(),
      })
    } catch {
      return null
    }
    // periodEnd is derived from the summary string, so key on that.
  }, [delta, interval, summary.currentPeriodEnd])

  const nextPeriodPrice = subscriptions.business[interval].priceVnd * target
  const tooFew = target < minSeats
  const outOfRange = target > BUSINESS_MAX_SEATS
  const canPay =
    !busy &&
    !tooFew &&
    !outOfRange &&
    (delta < 0 || (delta > 0 && increase !== null))

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
            Quản lý suất
          </ResponsiveModalTitle>
          <ResponsiveModalDescription className="text-[13px] leading-[1.6]">
            Hiện có {current} suất, đang dùng {summary.seatUsage?.used ?? 0}
            {summary.seatUsage?.pendingInvitations
              ? ` và giữ ${summary.seatUsage.pendingInvitations} suất cho lời mời đang chờ`
              : ''}
            .
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="mt-6">
          <label className="block text-[13px] text-brand">
            Số suất mong muốn
            <input
              className="mt-2 block h-11 w-[140px] rounded-lg border border-border bg-background px-3 text-sm font-normal text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              type="number"
              min={minSeats}
              max={BUSINESS_MAX_SEATS}
              value={target}
              onChange={(event) =>
                setTarget(Math.floor(Number(event.target.value)) || current)
              }
              disabled={busy}
            />
          </label>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Từ {minSeats} đến {BUSINESS_MAX_SEATS} suất.
          </p>
        </div>

        <div
          className="mt-5 rounded-lg bg-brand-gradient p-4 text-[13px] leading-[1.6]"
          aria-live="polite"
        >
          {tooFew ? (
            <p>
              Cần giữ ít nhất {minSeats} suất cho thành viên và lời mời hiện có.
              Hãy xóa thành viên hoặc hủy lời mời tại{' '}
              <Link to="/workspace/members" className="text-brand underline">
                trang Thành viên
              </Link>{' '}
              trước.
            </p>
          ) : delta === 0 ? (
            <p>Chọn số suất khác với hiện tại để xem chi phí.</p>
          ) : delta > 0 ? (
            increase ? (
              <>
                <p className="font-medium">
                  Thêm {delta} suất · {money.format(increase.amountVnd)} ₫
                </p>
                <p className="mt-1 text-muted-foreground">
                  Có hiệu lực ngay và dùng đến hết kỳ hiện tại
                  {periodEnd ? ` (${dateFormat.format(periodEnd)})` : ''}. Phí
                  tính theo thời gian còn lại của kỳ (
                  {Math.round(increase.remainingRatio * 100)}% của một{' '}
                  {interval === 'monthly' ? 'tháng' : 'năm'}), mỗi suất{' '}
                  {money.format(increase.unitPriceVnd)} ₫ một kỳ. Mỗi suất mới
                  có đủ {subscriptions.business[interval].minutes} phút luyện
                  tập của tháng này. Kỳ gia hạn sau tính theo {target} suất.
                </p>
              </>
            ) : (
              <p>Kỳ hiện tại đã kết thúc. Hãy tải lại trang.</p>
            )
          ) : (
            <>
              <p className="font-medium">
                Giảm còn {target} suất từ kỳ tiếp theo ·{' '}
                {money.format(nextPeriodPrice)} ₫
              </p>
              <p className="mt-1 text-muted-foreground">
                Bạn vẫn dùng đủ {current} suất
                {periodEnd ? ` đến ${dateFormat.format(periodEnd)}` : ''}; kỳ
                hiện tại không được hoàn tiền. Khoản thanh toán là kỳ{' '}
                {interval === 'monthly' ? 'tháng' : 'năm'} kế tiếp với {target}{' '}
                suất, bắt đầu khi kỳ hiện tại kết thúc.
              </p>
            </>
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
            disabled={!canPay}
            onClick={() =>
              delta > 0
                ? onPay(seatAdditionProductCode(interval), delta)
                : onPay(`business_${interval}`, target)
            }
          >
            {busy ? 'Đang chuyển đến thanh toán…' : 'Tiếp tục thanh toán'}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
