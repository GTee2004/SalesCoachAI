import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  CircleUserRound,
  Coins,
  LoaderCircle,
  Pencil,
  RefreshCw,
} from 'lucide-react'
import { EditNameModal } from '#/components/account/edit-name-modal'
import { EditUsernameModal } from '#/components/account/edit-username-modal'
import { MobileHeader, SidebarContent } from '#/components/practice-navigation'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { ButtonLink } from '#/components/ui/button-link'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { getUserDisplay } from '#/lib/auth/user-display'
import { billingSummaryQueryOptions } from '#/lib/billing/queries'

type AccountTab = 'profile' | 'plan'
const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'long',
  timeZone: 'Asia/Ho_Chi_Minh',
})
const minuteFormat = new Intl.NumberFormat('vi-VN')
const planLabels = { free: 'Free', pro: 'Pro', business: 'Business' }

export const Route = createFileRoute('/account')({
  validateSearch: (search: Record<string, unknown>): { tab?: AccountTab } => ({
    tab: search.tab === 'plan' ? 'plan' : 'profile',
  }),
  beforeLoad: ({ context, location }) => {
    if (!context.user)
      throw redirect({ to: '/login', search: { callbackUrl: location.href } })
    if (!context.user.emailVerified)
      throw redirect({
        to: '/verify-email',
        search: { email: context.user.email },
      })
  },
  head: () => ({ meta: [{ title: 'Tài khoản | SalesCoach AI' }] }),
  component: AccountPage,
})

function AccountPage() {
  const { user } = Route.useRouteContext()
  const { tab = 'profile' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [editing, setEditing] = useState<'name' | 'username' | null>(null)
  const { name, initials } = getUserDisplay(user)
  if (!user) return null

  return (
    <div className="min-h-screen bg-background font-sans font-normal text-foreground">
      <aside className="fixed inset-y-6 left-6 z-30 hidden w-56 flex-col border-r border-border bg-background pr-3 lg:flex">
        <SidebarContent activeSection="account" />
      </aside>
      <div className="lg:ml-[248px]">
        <MobileHeader activeSection="account" />
        <main className="mx-auto max-w-[1184px] px-5 py-8 sm:px-8 lg:mx-0 lg:px-20 lg:pb-12 lg:pt-[52px]">
          <header className="mb-8 flex items-center gap-4 lg:mb-12 lg:gap-6">
            <Avatar className="size-14 shrink-0 after:border-0 lg:size-16">
              <AvatarFallback className="bg-secondary text-lg font-normal text-brand">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 className="text-[29px] font-normal leading-[1.55] lg:text-4xl lg:leading-[1.55]">
                Tài khoản
              </h1>
              <p className="mt-2 truncate text-sm text-muted-foreground">
                {name}
              </p>
            </div>
          </header>

          <Tabs
            value={tab}
            onValueChange={(value) => {
              void navigate({
                search: (previous) => ({
                  ...previous,
                  tab: value === 'plan' ? 'plan' : 'profile',
                }),
                replace: true,
              })
            }}
            className="flex-col gap-[30px]"
          >
            <TabsList
              aria-label="Thông tin tài khoản"
              className="!h-[52px] w-full max-w-[390px] rounded-md bg-border p-1"
            >
              <TabsTrigger
                value="profile"
                className="h-full flex-[140] rounded-[7px] px-3 font-normal text-muted-foreground data-active:text-brand group-data-[variant=default]/tabs-list:data-active:shadow-none dark:data-active:bg-background dark:data-active:text-brand"
              >
                <CircleUserRound aria-hidden="true" className="size-5" /> Hồ sơ
              </TabsTrigger>
              <TabsTrigger
                value="plan"
                className="h-full flex-[238] rounded-[7px] px-3 font-normal text-muted-foreground data-active:text-brand group-data-[variant=default]/tabs-list:data-active:shadow-none dark:data-active:bg-background dark:data-active:text-brand"
              >
                <Coins aria-hidden="true" className="size-5" /> Gói &amp; hạn
                mức
              </TabsTrigger>
            </TabsList>
            <TabsContent value="profile">
              <section className="min-h-[324px] rounded-xl border border-border bg-background p-6 sm:p-8">
                <h2 className="text-[23px] font-normal">Hồ sơ cá nhân</h2>
                <dl className="mt-10 divide-y divide-border">
                  <div className="grid min-h-[88px] items-start gap-2 pb-6 sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:gap-9">
                    <dt className="text-sm text-muted-foreground">Tên</dt>
                    <dd className="min-w-0 break-words text-base font-normal">
                      {user.name}
                    </dd>
                    <EditButton
                      label="Sửa tên"
                      onClick={() => setEditing('name')}
                    />
                  </div>
                  <div className="grid min-h-[88px] items-start gap-2 py-6 sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:gap-9">
                    <dt className="text-sm text-muted-foreground">
                      Bí danh (username)
                    </dt>
                    <dd className="min-w-0 break-words text-base font-normal">
                      {user.username || 'Chưa đặt bí danh'}
                    </dd>
                    <EditButton
                      label="Sửa bí danh"
                      onClick={() => setEditing('username')}
                    />
                  </div>
                  <div className="grid min-h-[88px] items-start gap-2 pt-6 sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:gap-9">
                    <dt className="text-sm text-muted-foreground">Email</dt>
                    <dd className="min-w-0 break-all text-base font-normal">
                      {user.email}
                    </dd>
                  </div>
                </dl>
                {editing === 'name' && (
                  <EditNameModal
                    name={user.name}
                    onClose={() => setEditing(null)}
                  />
                )}
                {editing === 'username' && (
                  <EditUsernameModal
                    username={user.username}
                    email={user.email}
                    onClose={() => setEditing(null)}
                  />
                )}
              </section>
            </TabsContent>
            <TabsContent value="plan">
              {user.workspace ? (
                <PlanAndCredits
                  key={user.workspace.id}
                  userId={user.id}
                  workspaceId={user.workspace.id}
                />
              ) : (
                <p
                  role="status"
                  className="rounded-xl border border-border bg-background p-6 text-muted-foreground"
                >
                  Chọn không gian làm việc trong menu tài khoản để xem gói và
                  hạn mức.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  )
}

function EditButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      className="w-fit font-normal shadow-none"
      onClick={onClick}
    >
      <Pencil aria-hidden="true" /> Sửa
    </Button>
  )
}

function PlanAndCredits({
  userId,
  workspaceId,
}: {
  userId: string
  workspaceId: string
}) {
  const billing = useQuery(billingSummaryQueryOptions(userId, workspaceId))
  const summary = billing.data
  if (billing.isPending)
    return (
      <div
        role="status"
        className="flex min-h-64 items-center justify-center gap-3 rounded-xl border border-border bg-background p-6 text-muted-foreground"
      >
        <LoaderCircle
          aria-hidden="true"
          className="size-5 animate-spin text-brand"
        />
        Đang tải gói và hạn mức…
      </div>
    )
  if (!summary)
    return (
      <div
        role="alert"
        className="rounded-xl border border-border bg-background p-6"
      >
        <p className="text-error">{billing.error.message}</p>
        <Button
          variant="outline"
          className="mt-4"
          disabled={billing.isFetching}
          onClick={() => void billing.refetch()}
        >
          Thử lại
        </Button>
      </div>
    )

  const isCompany = summary.workspace.kind === 'company'
  const isOwner = summary.workspace.role === 'owner'
  const isActive = summary.subscriptionStatus === 'active'
  const isExpired = summary.subscriptionStatus === 'expired'
  const isPending =
    isCompany && summary.workspace.status === 'pending_subscription'
  const label =
    isCompany && !isActive && !isExpired
      ? 'Business chưa kích hoạt'
      : planLabels[summary.plan]

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-background p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-full">
            <p className="text-xs font-normal uppercase tracking-wider text-brand">
              Không gian làm việc hiện tại
            </p>
            <h2 className="mt-2 break-words text-2xl font-normal">
              {summary.workspace.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isCompany ? 'Không gian làm việc công ty' : 'Tài khoản cá nhân'}{' '}
              ·{' '}
              {isCompany
                ? 'Gói được quản lý bởi chủ sở hữu.'
                : 'Gói Pro áp dụng cho tài khoản cá nhân này.'}
            </p>
          </div>
          <Button
            variant="link"
            size="sm"
            className="px-0 text-[13px] font-normal text-brand"
            disabled={billing.isFetching}
            onClick={() => void billing.refetch()}
          >
            <RefreshCw
              aria-hidden="true"
              className={billing.isFetching ? 'animate-spin' : ''}
            />{' '}
            Cập nhật
          </Button>
        </div>

        <div className="mt-7 min-h-[204px] rounded-lg bg-brand-gradient p-6">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[30px] font-normal">{label}</p>
            <span
              className={`text-[13px] font-normal ${isExpired || isPending ? 'text-warning' : 'text-brand'}`}
            >
              {isPending
                ? 'Chờ kích hoạt'
                : isExpired
                  ? 'Gói trả phí đã hết hạn'
                  : isActive
                    ? 'Đang hoạt động'
                    : 'Miễn phí'}
            </span>
          </div>
          {summary.interval && (
            <p className="mt-2 text-sm text-muted-foreground">
              Gói {summary.interval === 'yearly' ? 'năm' : 'tháng'}
              {isCompany && summary.seatQuantity > 0
                ? ` · ${summary.seatQuantity} suất trả phí`
                : ''}
            </p>
          )}
          <p className="mt-6 text-sm text-foreground">
            {summary.currentPeriodEnd
              ? `${isExpired ? 'Đã hết hạn ngày' : 'Có hiệu lực đến'} ${dateFormat.format(new Date(summary.currentPeriodEnd))}.`
              : isCompany
                ? 'Gói sẽ bắt đầu sau khi thanh toán được xác nhận.'
                : 'Gói Free không có ngày hết hạn.'}
          </p>
          {isActive && (
            <p className="mt-5 text-[13px] text-muted-foreground">
              {summary.cancelAtPeriodEnd
                ? 'Gói sẽ kết thúc vào cuối kỳ đã thanh toán.'
                : 'Gia hạn qua trang thanh toán khi cần; không tự động trừ tiền.'}
            </p>
          )}
          {summary.pendingPlan && (
            <p className="mt-3 text-sm text-brand">
              Gói {planLabels[summary.pendingPlan]}{' '}
              {summary.pendingInterval === 'yearly' ? 'năm' : 'tháng'}
              {summary.pendingSeatQuantity
                ? ` · ${summary.pendingSeatQuantity} suất`
                : ''}{' '}
              sẽ bắt đầu sau chu kỳ hiện tại.
            </p>
          )}
        </div>

        {summary.paymentVerificationWarning && (
          <p
            role="status"
            className="mt-4 rounded-lg bg-warning-bg p-3 text-sm text-warning"
          >
            {summary.paymentVerificationWarning}
          </p>
        )}
        {billing.isError && (
          <p role="alert" className="mt-4 text-sm text-error">
            Chưa thể cập nhật. Bạn đang xem thông tin tải thành công gần nhất;
            hãy thử lại.
          </p>
        )}
        {isOwner ? (
          <ButtonLink
            to="/billing"
            className="mt-6 h-12 w-[300px] max-w-full rounded-lg bg-primary px-4 text-sm font-normal text-primary-foreground hover:bg-primary-hover"
          >
            Quản lý gói và thanh toán
          </ButtonLink>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">
            Liên hệ chủ sở hữu để gia hạn hoặc mua thêm phút.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-background p-6 sm:p-7">
        <h2 className="text-[23px] font-normal">Phút luyện tập còn lại</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          {isCompany
            ? 'Hạn mức dành cho bạn trong không gian làm việc này, không gộp với thành viên khác.'
            : 'Hạn mức trong tài khoản cá nhân này.'}
        </p>
        <dl className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="min-w-0 min-h-[192px] rounded-md bg-secondary p-6">
            <dt className="text-sm font-normal text-foreground">
              Phút trong gói
            </dt>
            <dd className="mt-2 flex flex-wrap items-baseline gap-x-2 break-words text-[34px] font-normal">
              {minuteFormat.format(summary.minutes.included)}
              <span>phút</span>
            </dd>
            <p className="mt-5 text-xs leading-[1.55] text-muted-foreground">
              {summary.minutes.refreshAt
                ? `Làm mới vào ${dateFormat.format(new Date(summary.minutes.refreshAt))}.`
                : 'Hạn mức được cấp khi gói và suất luyện tập đang hoạt động.'}{' '}
              Phút chưa dùng không cộng dồn.
            </p>
          </div>
          <div className="min-w-0 min-h-[192px] rounded-md bg-warm p-6">
            <dt className="text-sm font-normal text-foreground">
              Phút mua thêm
            </dt>
            <dd className="mt-2 flex flex-wrap items-baseline gap-x-2 break-words text-[34px] font-normal">
              {minuteFormat.format(summary.minutes.topup)}
              <span>phút</span>
            </dd>
            <p className="mt-5 text-xs leading-[1.55] text-muted-foreground">
              Không hết hạn. Được sử dụng sau phút trong gói.
            </p>
          </div>
        </dl>
        {isCompany && (!isActive || !summary.hasSeat) && (
          <p className="mt-4 rounded-lg bg-warning-bg p-3 text-sm text-warning">
            {!isActive
              ? 'Phút mua thêm được giữ lại; bạn có thể sử dụng khi gói Business được kích hoạt và có suất luyện tập.'
              : 'Bạn chưa được cấp suất luyện tập. Hãy liên hệ chủ sở hữu để sử dụng phút trong không gian làm việc này.'}
          </p>
        )}
        {isOwner && (!isCompany || isActive) && (
          <ButtonLink
            to="/billing"
            variant="outline"
            className="mt-6 h-12 w-[210px] max-w-full rounded-lg border-border px-4 text-sm font-normal shadow-none"
          >
            Mua thêm phút
          </ButtonLink>
        )}
      </section>
    </div>
  )
}
