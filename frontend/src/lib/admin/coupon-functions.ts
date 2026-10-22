import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { PERMISSIONS } from '#/lib/auth/permissions'
import { requirePermission } from '#/lib/auth/require-permission'
import {
  createCouponSchema,
  updateCouponSchema,
} from '#/lib/billing/coupon-schemas'

export const getAdminCoupons = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requirePermission(PERMISSIONS.couponsView)
    const { listCoupons } = await import('#/lib/server/billing/coupons')
    return { items: await listCoupons() }
  },
)

export const getAdminCouponRedemptions = createServerFn({ method: 'GET' })
  .validator(z.object({ couponId: z.string().uuid() }))
  .handler(async ({ data }) => {
    // Lists customers' names and emails, so it needs the view permission too.
    await requirePermission(PERMISSIONS.couponsView)
    const { listCouponRedemptions } =
      await import('#/lib/server/billing/coupons')
    return { items: await listCouponRedemptions(data.couponId) }
  })

export const createAdminCoupon = createServerFn({ method: 'POST' })
  .validator(createCouponSchema)
  .handler(async ({ data }) => {
    const admin = await requirePermission(PERMISSIONS.couponsManage)
    const { createCoupon } = await import('#/lib/server/billing/coupons')
    return createCoupon(data, admin.id)
  })

export const updateAdminCoupon = createServerFn({ method: 'POST' })
  .validator(updateCouponSchema)
  .handler(async ({ data }) => {
    const admin = await requirePermission(PERMISSIONS.couponsManage)
    const { updateCoupon } = await import('#/lib/server/billing/coupons')
    return updateCoupon(data, admin.id)
  })
