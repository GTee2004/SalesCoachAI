import { queryOptions } from '@tanstack/react-query'
import { adminQueryKey } from './queries'
import { getAdminCouponRedemptions, getAdminCoupons } from './coupon-functions'

export const adminCouponsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: [...adminQueryKey(userId), 'coupons'] as const,
    queryFn: () => getAdminCoupons(),
    staleTime: 10_000,
    retry: false,
  })

export const adminCouponRedemptionsQueryOptions = (
  userId: string,
  couponId: string,
) =>
  queryOptions({
    queryKey: [
      ...adminQueryKey(userId),
      'coupons',
      couponId,
      'redemptions',
    ] as const,
    queryFn: () => getAdminCouponRedemptions({ data: { couponId } }),
    staleTime: 10_000,
    retry: false,
  })
