import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { PanelMessage } from '#/components/admin/panel'
import { CouponFormModal } from '#/components/admin/coupon-form-modal'
import { CouponRedemptionsModal } from '#/components/admin/coupon-redemptions-modal'
import { CouponTable } from '#/components/admin/coupon-table'
import { MobileHeader, SidebarContent } from '#/components/practice-navigation'
import { Button } from '#/components/ui/button'
import { adminCouponsQueryOptions } from '#/lib/admin/coupon-queries'
import { can, PERMISSIONS } from '#/lib/auth/permissions'
import { requireRoutePermission } from '#/lib/auth/route-guard'
import type { AdminCoupon } from '#/lib/billing/coupons'

export const Route = createFileRoute('/admin/coupons')({
  loader: async ({ context, location }) => {
    // Hides the page; the server functions enforce the permission on every call.
    requireRoutePermission(context.user, location, PERMISSIONS.couponsView)
    await context.queryClient
      .query(adminCouponsQueryOptions(context.user.id))
      .catch(() => undefined)
  },
  component: AdminCouponsPage,
})

function AdminCouponsPage() {
  const user = Route.useRouteContext().user!
  const coupons = useQuery(adminCouponsQueryOptions(user.id))
  const canManage = can(user, PERMISSIONS.couponsManage)
  // undefined: closed, null: creating, otherwise editing that coupon.
  const [editing, setEditing] = useState<AdminCoupon | null | undefined>(
    undefined,
  )

  const [viewing, setViewing] = useState<AdminCoupon | null>(null)

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <aside className="fixed inset-y-6 left-6 z-30 hidden w-56 flex-col border-r border-border bg-background pr-3 lg:flex">
        <SidebarContent activeSection="coupons" />
      </aside>
      <div className="lg:ml-[280px]">
        <MobileHeader activeSection="coupons" />
        <main className="mx-auto flex max-w-[1168px] flex-col gap-8 px-5 pb-11 pt-6 sm:px-6 lg:px-4 lg:pb-12">
          <header className="flex flex-col gap-5 rounded-[20px] bg-brand-gradient p-5 sm:p-7 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <h1 className="text-[30px] font-normal leading-[1.4] tracking-[-1px] lg:text-[36px]">
                Mã giảm giá
              </h1>
              <p className="mt-2 text-sm leading-[1.6] text-muted-foreground">
                Tạo và theo dõi mã giảm giá cho gói đăng ký và phút mua thêm.
              </p>
            </div>
            {canManage ? (
              <Button
                type="button"
                onClick={() => setEditing(null)}
                className="h-11 w-fit shrink-0 gap-3 rounded-[10px] bg-primary px-5 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover"
              >
                Tạo mã
                <Plus size={17} aria-hidden="true" />
              </Button>
            ) : null}
          </header>

          {coupons.data ? (
            coupons.data.items.length ? (
              <CouponTable
                coupons={coupons.data.items}
                canManage={canManage}
                onEdit={setEditing}
                onShowRedemptions={setViewing}
              />
            ) : (
              <PanelMessage>Chưa có mã giảm giá nào.</PanelMessage>
            )
          ) : coupons.isError ? (
            <PanelMessage kind="alert">
              Không tải được danh sách mã giảm giá. Vui lòng thử lại.
            </PanelMessage>
          ) : (
            <PanelMessage>Đang tải…</PanelMessage>
          )}
        </main>
      </div>
      {viewing ? (
        <CouponRedemptionsModal
          userId={user.id}
          coupon={viewing}
          onClose={() => setViewing(null)}
        />
      ) : null}
      {editing !== undefined ? (
        <CouponFormModal
          key={editing?.id ?? 'new'}
          userId={user.id}
          coupon={editing}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </div>
  )
}
