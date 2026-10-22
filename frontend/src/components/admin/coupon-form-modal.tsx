import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { appliesToLabels } from '#/components/admin/coupon-table'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '#/components/ui/responsive-modal'
import {
  createAdminCoupon,
  updateAdminCoupon,
} from '#/lib/admin/coupon-functions'
import { adminQueryKey } from '#/lib/admin/queries'
import { COUPON_ORDER_TYPES } from '#/lib/billing/coupons'
import type { AdminCoupon, CouponOrderType } from '#/lib/billing/coupons'

const fieldClass = 'mt-2 block h-11 w-full text-sm font-normal'
const labelClass = 'block text-[13px] text-brand'

// datetime-local works in the browser's local time; the API takes ISO strings.
function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}

const toIso = (local: string) => (local ? new Date(local).toISOString() : null)

async function readError(error: unknown) {
  if (error instanceof Response) {
    const text = await error.text().catch(() => '')
    if (text) return text
  }
  return 'Chưa thể lưu mã giảm giá. Hãy kiểm tra lại thông tin.'
}

export function CouponFormModal({
  userId,
  coupon,
  onClose,
}: {
  userId: string
  // null creates a new coupon; otherwise the coupon being edited.
  coupon: AdminCoupon | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const editing = coupon !== null
  const [code, setCode] = useState(coupon?.code ?? '')
  const [name, setName] = useState(coupon?.name ?? '')
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>(
    coupon?.discountType ?? 'percent',
  )
  const [value, setValue] = useState(String(coupon?.value ?? ''))
  const [maxDiscount, setMaxDiscount] = useState(
    String(coupon?.maxDiscountVnd ?? ''),
  )
  const [appliesTo, setAppliesTo] = useState<Array<CouponOrderType>>(
    coupon?.appliesTo ?? [...COUPON_ORDER_TYPES],
  )
  const [startsAt, setStartsAt] = useState(
    toLocalInput(coupon?.startsAt ?? null),
  )
  const [expiresAt, setExpiresAt] = useState(
    toLocalInput(coupon?.expiresAt ?? null),
  )
  const [maxRedemptions, setMaxRedemptions] = useState(
    String(coupon?.maxRedemptions ?? ''),
  )
  const [perWorkspace, setPerWorkspace] = useState(
    String(coupon?.maxRedemptionsPerWorkspace ?? 1),
  )
  const [active, setActive] = useState(coupon?.active ?? true)
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: () => {
      const shared = {
        name,
        appliesTo,
        startsAt: toIso(startsAt),
        expiresAt: toIso(expiresAt),
        maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
        maxRedemptionsPerWorkspace: Number(perWorkspace),
      }
      return coupon
        ? updateAdminCoupon({ data: { id: coupon.id, active, ...shared } })
        : createAdminCoupon({
            data: {
              code,
              discountType,
              value: Number(value),
              maxDiscountVnd:
                discountType === 'percent' && maxDiscount
                  ? Number(maxDiscount)
                  : null,
              ...shared,
            },
          })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKey(userId) })
      onClose()
    },
    onError: async (reason) => setError(await readError(reason)),
  })

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (save.isPending) return
    if (!appliesTo.length) {
      setError('Chọn ít nhất một loại sản phẩm áp dụng.')
      return
    }
    setError('')
    save.mutate()
  }

  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose()
      }}
    >
      <ResponsiveModalContent className="border-border bg-background p-6 font-sans text-foreground shadow-[0_6px_24px_var(--shadow-ink)] sm:p-7 lg:w-full lg:max-w-lg">
        <ResponsiveModalHeader className="space-y-3 text-left">
          <ResponsiveModalTitle className="pr-6 text-[23px] font-normal leading-[1.4]">
            {editing ? `Sửa mã ${coupon.code}` : 'Tạo mã giảm giá'}
          </ResponsiveModalTitle>
          <ResponsiveModalDescription className="text-[13px] leading-[1.6]">
            {editing
              ? 'Mã, loại và mức giảm không thể đổi để các đơn đã dùng mã vẫn khớp. Muốn đổi mức giảm, hãy tạo mã mới.'
              : 'Mã áp dụng cho một đơn hàng. Mức giảm không vượt quá giá trị đơn; phần dư không được hoàn lại. Đơn còn lại dưới 1.000 ₫ sẽ được tính 1.000 ₫ (mức tối thiểu của SePay); chỉ đơn về đúng 0 ₫ mới miễn phí.'}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <form onSubmit={submit} className="mt-5 grid gap-4">
          <label className={labelClass}>
            Mã giảm giá
            <Input
              className={`${fieldClass} font-mono uppercase`}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="WELCOME20"
              minLength={3}
              maxLength={32}
              required
              disabled={editing || save.isPending}
            />
          </label>
          <label className={labelClass}>
            Tên nội bộ
            <Input
              className={fieldClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Chiến dịch tháng 10"
              maxLength={120}
              required
              disabled={save.isPending}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Loại giảm giá
              <NativeSelect
                wrapperClassName="mt-2 w-full"
                className="h-11 rounded-lg border-border bg-background px-3 text-sm font-normal text-foreground shadow-none"
                value={discountType}
                onChange={(event) =>
                  setDiscountType(event.target.value as 'percent' | 'fixed')
                }
                disabled={editing || save.isPending}
              >
                <option value="percent">Theo phần trăm (%)</option>
                <option value="fixed">Số tiền cố định (₫)</option>
              </NativeSelect>
            </label>
            <label className={labelClass}>
              {discountType === 'percent'
                ? 'Phần trăm giảm'
                : 'Số tiền giảm (₫)'}
              <Input
                className={fieldClass}
                type="number"
                min={1}
                max={discountType === 'percent' ? 100 : 100_000_000}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                required
                disabled={editing || save.isPending}
              />
            </label>
          </div>
          {discountType === 'percent' ? (
            <label className={labelClass}>
              Giảm tối đa (₫, tùy chọn)
              <Input
                className={fieldClass}
                type="number"
                min={1}
                max={100_000_000}
                value={maxDiscount}
                onChange={(event) => setMaxDiscount(event.target.value)}
                placeholder="Không giới hạn"
                disabled={editing || save.isPending}
              />
            </label>
          ) : null}
          {discountType === 'percent' &&
          Number(value) === 100 &&
          !maxDiscount &&
          !editing ? (
            <p
              role="status"
              className="rounded-lg bg-warm p-3 text-[13px] leading-5 text-foreground"
            >
              Giảm 100% mà không đặt mức giảm tối đa khiến mọi đơn hàng miễn
              phí: hệ thống kích hoạt gói hoặc cộng phút ngay mà không qua thanh
              toán. Hãy đặt giới hạn lượt dùng.
            </p>
          ) : null}

          <fieldset className="grid gap-2">
            <legend className="text-[13px] text-brand">Áp dụng cho</legend>
            {COUPON_ORDER_TYPES.map((type) => (
              <label
                key={type}
                className="flex items-center gap-2 text-sm font-normal"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--brand)]"
                  checked={appliesTo.includes(type)}
                  disabled={save.isPending}
                  onChange={(event) =>
                    setAppliesTo((current) =>
                      event.target.checked
                        ? [...current, type]
                        : current.filter((item) => item !== type),
                    )
                  }
                />
                {appliesToLabels[type]}
              </label>
            ))}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={`${labelClass} flex flex-col justify-between`}>
              Bắt đầu (tùy chọn)
              <Input
                className={fieldClass}
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                disabled={save.isPending}
              />
            </label>
            <label className={`${labelClass} flex flex-col justify-between`}>
              Hết hạn (tùy chọn)
              <Input
                className={fieldClass}
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                disabled={save.isPending}
              />
            </label>
            <label className={`${labelClass} flex flex-col justify-between`}>
              Tổng số lượt dùng
              <Input
                className={fieldClass}
                type="number"
                min={1}
                value={maxRedemptions}
                onChange={(event) => setMaxRedemptions(event.target.value)}
                placeholder="Không giới hạn"
                disabled={save.isPending}
              />
            </label>
            <label className={`${labelClass} flex flex-col justify-between`}>
              Lượt dùng mỗi không gian làm việc
              <Input
                className={fieldClass}
                type="number"
                min={1}
                max={1000}
                value={perWorkspace}
                onChange={(event) => setPerWorkspace(event.target.value)}
                required
                disabled={save.isPending}
              />
            </label>
          </div>

          {editing ? (
            <label className="flex items-center gap-2 text-sm font-normal">
              <input
                type="checkbox"
                className="size-4 accent-[var(--brand)]"
                checked={active}
                disabled={save.isPending}
                onChange={(event) => setActive(event.target.checked)}
              />
              Đang bật (tắt để ngừng nhận mã này)
            </label>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-destructive-subtle p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <ResponsiveModalFooter className="mt-2 gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-11 px-5 text-sm font-normal shadow-none"
              disabled={save.isPending}
              onClick={onClose}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              className="h-11 px-5 text-sm font-normal"
              disabled={save.isPending}
            >
              {save.isPending
                ? 'Đang lưu…'
                : editing
                  ? 'Lưu thay đổi'
                  : 'Tạo mã'}
            </Button>
          </ResponsiveModalFooter>
        </form>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
