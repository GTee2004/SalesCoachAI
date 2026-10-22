import { useState } from 'react'
import { LoaderCircle, Tag, X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { applyDiscount, describeCouponValue } from '#/lib/billing/coupons'
import { readBillingResponse } from '#/lib/billing/http'
import type { CouponOrderType, PublicCoupon } from '#/lib/billing/coupons'

const money = new Intl.NumberFormat('vi-VN')
const appliesLabels: Record<CouponOrderType, string> = {
  subscription: 'gói đăng ký',
  topup: 'phút mua thêm',
}

// A price with the coupon's effect shown, for the products it applies to. The
// server recomputes the amount at checkout; this is display only.
export function Price({
  priceVnd,
  coupon,
  orderType,
}: {
  priceVnd: number
  coupon: PublicCoupon | null
  orderType: CouponOrderType
}) {
  if (!coupon?.appliesTo.includes(orderType))
    return <>{money.format(priceVnd)} ₫</>
  const { totalVnd } = applyDiscount(coupon, priceVnd)
  return (
    <>
      <s className="mr-1 opacity-60">{money.format(priceVnd)} ₫</s>
      {totalVnd === 0 ? 'Miễn phí' : `${money.format(totalVnd)} ₫`}
    </>
  )
}

export function CouponField({
  workspaceId,
  coupon,
  onChange,
  disabled,
}: {
  workspaceId: string
  coupon: PublicCoupon | null
  onChange: (coupon: PublicCoupon | null) => void
  disabled: boolean
}) {
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  async function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (checking || !code.trim()) return
    setChecking(true)
    setError('')
    try {
      onChange(
        await readBillingResponse<PublicCoupon>(
          await fetch('/api/billing/coupon', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId, code }),
          }),
          'Chưa thể kiểm tra mã giảm giá. Vui lòng thử lại sau.',
        ),
      )
      setCode('')
    } catch (reason) {
      onChange(null)
      setError(
        reason instanceof Error
          ? reason.message
          : 'Chưa thể kiểm tra mã giảm giá.',
      )
    } finally {
      setChecking(false)
    }
  }

  return (
    <section
      aria-label="Mã giảm giá"
      className="mt-6 rounded-lg border border-border bg-background p-6"
    >
      <h2 className="text-[23px] font-normal">Mã giảm giá</h2>
      {coupon ? (
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-lg bg-brand-gradient p-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Tag className="size-4" aria-hidden="true" />
              <span className="font-mono">{coupon.code}</span>
              {' · '}
              {describeCouponValue(coupon)}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Áp dụng cho{' '}
              {coupon.appliesTo.map((type) => appliesLabels[type]).join(' và ')}
              , cho một lần thanh toán.
              {coupon.discountType === 'fixed'
                ? ' Nếu mức giảm lớn hơn giá trị đơn, phần dư không được hoàn lại.'
                : ''}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="h-9 gap-2 px-3 text-[13px] font-normal"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            <X className="size-4" aria-hidden="true" />
            Gỡ mã
          </Button>
        </div>
      ) : (
        <form onSubmit={apply} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Input
            className="h-12 font-mono text-sm font-normal uppercase"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Nhập mã giảm giá"
            aria-label="Mã giảm giá"
            maxLength={40}
            disabled={disabled || checking}
          />
          <Button
            type="submit"
            className="h-12 px-5 text-sm font-normal"
            variant="outline"
            disabled={disabled || checking || !code.trim()}
          >
            {checking && <LoaderCircle className="mr-2 size-4 animate-spin" />}
            Áp dụng
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
