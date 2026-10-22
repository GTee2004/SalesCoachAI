import { Pencil } from 'lucide-react'
import { StatusPill } from '#/components/admin/panel'
import type { Tone } from '#/components/admin/panel'
import { Button } from '#/components/ui/button'
import { describeCouponValue, getCouponStatus } from '#/lib/billing/coupons'
import type { AdminCoupon, CouponStatus } from '#/lib/billing/coupons'

const statusPill: Record<CouponStatus, { label: string; tone: Tone }> = {
  active: { label: 'Đang hoạt động', tone: 'good' },
  disabled: { label: 'Đã tắt', tone: 'neutral' },
  scheduled: { label: 'Chưa bắt đầu', tone: 'live' },
  expired: { label: 'Đã hết hạn', tone: 'warning' },
  exhausted: { label: 'Hết lượt dùng', tone: 'warning' },
}

export const appliesToLabels = {
  subscription: 'Gói đăng ký',
  topup: 'Phút mua thêm',
} as const

const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
})

function formatWindow(coupon: AdminCoupon) {
  if (!coupon.startsAt && !coupon.expiresAt) return 'Không giới hạn'
  const from = coupon.startsAt
    ? dateFormat.format(new Date(coupon.startsAt))
    : '…'
  const to = coupon.expiresAt
    ? dateFormat.format(new Date(coupon.expiresAt))
    : '…'
  return `${from} → ${to}`
}

export function CouponTable({
  coupons,
  canManage,
  onEdit,
  onShowRedemptions,
}: {
  coupons: Array<AdminCoupon>
  canManage: boolean
  onEdit: (coupon: AdminCoupon) => void
  onShowRedemptions: (coupon: AdminCoupon) => void
}) {
  const now = new Date()
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="py-3 pr-4 font-normal">Mã</th>
            <th className="py-3 pr-4 font-normal">Ưu đãi</th>
            <th className="py-3 pr-4 font-normal">Áp dụng cho</th>
            <th className="py-3 pr-4 font-normal">Lượt dùng</th>
            <th className="py-3 pr-4 font-normal">Hiệu lực</th>
            <th className="py-3 pr-4 font-normal">Trạng thái</th>
            {canManage ? <th className="py-3 font-normal" /> : null}
          </tr>
        </thead>
        <tbody>
          {coupons.map((coupon) => {
            const pill = statusPill[getCouponStatus(coupon, now)]
            return (
              <tr key={coupon.id} className="border-b border-border align-top">
                <td className="py-4 pr-4">
                  <p className="font-mono text-sm font-medium">{coupon.code}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {coupon.name}
                  </p>
                </td>
                <td className="py-4 pr-4">{describeCouponValue(coupon)}</td>
                <td className="py-4 pr-4">
                  {coupon.appliesTo
                    .map((type) => appliesToLabels[type])
                    .join(', ')}
                </td>
                <td className="py-4 pr-4 tabular-nums">
                  <button
                    type="button"
                    className="rounded-sm underline underline-offset-2 outline-none hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/50"
                    aria-label={`Xem lượt dùng của mã ${coupon.code}`}
                    onClick={() => onShowRedemptions(coupon)}
                  >
                    {coupon.redeemed} / {coupon.maxRedemptions ?? '∞'}
                  </button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Tối đa {coupon.maxRedemptionsPerWorkspace} lượt mỗi không
                    gian làm việc
                  </p>
                </td>
                <td className="py-4 pr-4 tabular-nums">
                  {formatWindow(coupon)}
                </td>
                <td className="py-4 pr-4">
                  <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                </td>
                {canManage ? (
                  <td className="py-3 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 gap-2 px-3 text-[13px] font-normal"
                      onClick={() => onEdit(coupon)}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                      Sửa
                    </Button>
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
