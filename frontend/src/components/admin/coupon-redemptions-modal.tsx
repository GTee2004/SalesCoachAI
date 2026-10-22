import { useQuery } from '@tanstack/react-query'
import { PanelMessage, StatusPill } from '#/components/admin/panel'
import type { Tone } from '#/components/admin/panel'
import { Button } from '#/components/ui/button'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '#/components/ui/responsive-modal'
import { adminCouponRedemptionsQueryOptions } from '#/lib/admin/coupon-queries'
import type { AdminCoupon } from '#/lib/billing/coupons'

const money = new Intl.NumberFormat('vi-VN')
const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
})

const orderStatus: Record<string, { label: string; tone: Tone }> = {
  paid: { label: 'Đã thanh toán', tone: 'good' },
  pending: { label: 'Chờ thanh toán', tone: 'live' },
  review: { label: 'Cần đối soát', tone: 'warning' },
  cancelled: { label: 'Đã hủy', tone: 'neutral' },
  void: { label: 'Đã hủy giao dịch', tone: 'neutral' },
  failed: { label: 'Thất bại', tone: 'neutral' },
}

export function CouponRedemptionsModal({
  userId,
  coupon,
  onClose,
}: {
  userId: string
  coupon: AdminCoupon
  onClose: () => void
}) {
  const redemptions = useQuery(
    adminCouponRedemptionsQueryOptions(userId, coupon.id),
  )
  const items = redemptions.data?.items

  return (
    <ResponsiveModal open onOpenChange={(open) => !open && onClose()}>
      <ResponsiveModalContent className="border-border bg-background p-6 font-sans text-foreground shadow-[0_6px_24px_var(--shadow-ink)] sm:p-7 lg:w-full lg:max-w-3xl">
        <ResponsiveModalHeader className="space-y-3 text-left">
          <ResponsiveModalTitle className="pr-6 text-[23px] font-normal leading-[1.4]">
            Lượt dùng mã {coupon.code}
          </ResponsiveModalTitle>
          <ResponsiveModalDescription className="text-[13px] leading-[1.6]">
            Mỗi dòng là một đơn hàng dùng mã. Đơn đã hủy được liệt kê nhưng
            không tính vào giới hạn lượt dùng.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="mt-5">
          {items ? (
            items.length ? (
              <>
                <div className="max-h-[55dvh] overflow-auto">
                  <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="py-3 pr-4 font-normal">Thời gian</th>
                        <th className="py-3 pr-4 font-normal">Người dùng</th>
                        <th className="py-3 pr-4 font-normal">
                          Không gian làm việc
                        </th>
                        <th className="py-3 pr-4 font-normal">Đơn hàng</th>
                        <th className="py-3 font-normal">Đã giảm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const status = orderStatus[item.orderStatus] ?? {
                          label: item.orderStatus,
                          tone: 'neutral' as const,
                        }
                        return (
                          <tr
                            key={item.id}
                            className={`border-b border-border align-top ${item.counted ? '' : 'text-muted-foreground'}`}
                          >
                            <td className="py-3 pr-4 tabular-nums">
                              {dateFormat.format(new Date(item.createdAt))}
                            </td>
                            <td className="py-3 pr-4">
                              <p>{item.userName}</p>
                              <p className="break-all text-xs text-muted-foreground">
                                {item.userEmail}
                              </p>
                            </td>
                            <td className="py-3 pr-4">{item.workspaceName}</td>
                            <td className="py-3 pr-4">
                              <p className="break-all font-mono text-xs">
                                {item.invoice}
                              </p>
                              <div className="mt-1">
                                <StatusPill tone={status.tone}>
                                  {status.label}
                                </StatusPill>
                              </div>
                            </td>
                            <td className="py-3 tabular-nums">
                              {money.format(item.discountVnd)} ₫
                              <p className="text-xs text-muted-foreground">
                                {item.amountVnd === 0
                                  ? 'Đơn miễn phí'
                                  : `Thanh toán ${money.format(item.amountVnd)} ₫`}
                              </p>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {items.length === 200 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Hiển thị 200 lượt dùng gần nhất.
                  </p>
                ) : null}
              </>
            ) : (
              <PanelMessage>Chưa có ai dùng mã này.</PanelMessage>
            )
          ) : redemptions.isError ? (
            <PanelMessage kind="alert">
              Không tải được danh sách lượt dùng. Vui lòng thử lại.
            </PanelMessage>
          ) : (
            <PanelMessage>Đang tải…</PanelMessage>
          )}
        </div>

        <ResponsiveModalFooter className="mt-5">
          <Button
            type="button"
            variant="outline"
            className="h-11 px-5 text-sm font-normal shadow-none"
            onClick={onClose}
          >
            Đóng
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
