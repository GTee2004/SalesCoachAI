import { z } from 'zod'
import { COUPON_CODE_PATTERN, normalizeCouponCode } from './coupons'

// No server imports here: server functions validate with these on the client
// bundle too.
const datetime = z.string().datetime().nullable()

const editableFields = {
  name: z.string().trim().min(1).max(120),
  appliesTo: z.array(z.enum(['subscription', 'topup'])).min(1),
  startsAt: datetime,
  expiresAt: datetime,
  maxRedemptions: z.number().int().positive().max(1_000_000).nullable(),
  maxRedemptionsPerWorkspace: z.number().int().positive().max(1000),
}

function validWindow(value: {
  startsAt: string | null
  expiresAt: string | null
}) {
  return (
    !value.startsAt ||
    !value.expiresAt ||
    new Date(value.expiresAt) > new Date(value.startsAt)
  )
}

export const createCouponSchema = z
  .object({
    code: z
      .string()
      .transform(normalizeCouponCode)
      .pipe(z.string().regex(COUPON_CODE_PATTERN)),
    discountType: z.enum(['percent', 'fixed']),
    value: z.number().int().positive().max(100_000_000),
    maxDiscountVnd: z.number().int().positive().max(100_000_000).nullable(),
    ...editableFields,
  })
  .refine(
    (value) =>
      value.discountType === 'percent' || value.maxDiscountVnd === null,
    {
      path: ['maxDiscountVnd'],
      message: 'Mức giảm tối đa chỉ dùng cho mã giảm theo phần trăm.',
    },
  )
  .refine((value) => value.discountType !== 'percent' || value.value <= 100, {
    path: ['value'],
    message: 'Phần trăm giảm tối đa là 100.',
  })
  .refine(validWindow, {
    path: ['expiresAt'],
    message: 'Ngày hết hạn phải sau ngày bắt đầu.',
  })

export const updateCouponSchema = z
  .object({
    id: z.string().uuid(),
    active: z.boolean(),
    ...editableFields,
  })
  .refine(validWindow, {
    path: ['expiresAt'],
    message: 'Ngày hết hạn phải sau ngày bắt đầu.',
  })
