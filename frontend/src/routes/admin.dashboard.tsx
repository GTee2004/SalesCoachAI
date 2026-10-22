import { createFileRoute } from '@tanstack/react-router'
import {
  keepPreviousData,
  useIsFetching,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { PanelMessage } from '#/components/admin/panel'
import { RecentSessions } from '#/components/admin/recent-sessions'
import { CostBreakdown, CostTiles } from '#/components/admin/service-costs'
import { ServiceHealthPanel } from '#/components/admin/service-health'
import {
  ActiveUsersChart,
  CallsChart,
  CostChart,
  LatencyChart,
} from '#/components/admin/usage-charts'
import {
  SessionOutcomes,
  TopPractices,
  UsageTiles,
} from '#/components/admin/usage-overview'
import { UsageRangePicker } from '#/components/admin/usage-range'
import {
  LatencyByProvider,
  LatencyStages,
  LatencyTiles,
} from '#/components/admin/voice-latency'
import { MobileHeader, SidebarContent } from '#/components/practice-navigation'
import { Button } from '#/components/ui/button'
import { DEFAULT_ADMIN_RANGE } from '#/lib/admin/contracts'
import type { AdminUsageRange } from '#/lib/admin/contracts'
import { formatClockWithSeconds, formatPeriod } from '#/lib/admin/format'
import {
  adminQueryKey,
  adminRecentSessionsQueryOptions,
  adminServiceCostsQueryOptions,
  adminServiceHealthQueryOptions,
  adminUsageQueryOptions,
  adminVoiceLatencyQueryOptions,
} from '#/lib/admin/queries'
import { toDateKey } from '#/lib/admin/usage'
import { PERMISSIONS } from '#/lib/auth/permissions'
import { requireRoutePermission } from '#/lib/auth/route-guard'

export const Route = createFileRoute('/admin/dashboard')({
  loader: async ({ context, location }) => {
    // Hides the page; the server functions enforce the permission on every read.
    requireRoutePermission(
      context.user,
      location,
      PERMISSIONS.adminDashboardView,
    )
    const userId = context.user.id
    await Promise.all([
      context.queryClient
        .query(adminServiceHealthQueryOptions(userId))
        .catch(() => undefined),
      context.queryClient
        .query(adminUsageQueryOptions(userId, DEFAULT_ADMIN_RANGE))
        .catch(() => undefined),
      context.queryClient
        .query(adminVoiceLatencyQueryOptions(userId, DEFAULT_ADMIN_RANGE))
        .catch(() => undefined),
      context.queryClient
        .query(adminServiceCostsQueryOptions(userId, DEFAULT_ADMIN_RANGE))
        .catch(() => undefined),
      context.queryClient
        .query(adminRecentSessionsQueryOptions(userId))
        .catch(() => undefined),
    ])
    // The date fields need today before the first usage answer arrives.
    return { today: toDateKey(new Date()) }
  },
  component: AdminDashboardPage,
})

function AdminDashboardPage() {
  const user = Route.useRouteContext().user!
  const loaded = Route.useLoaderData()
  const [range, setRange] = useState<AdminUsageRange>(DEFAULT_ADMIN_RANGE)
  const queryClient = useQueryClient()
  const refreshing = useIsFetching({ queryKey: adminQueryKey(user.id) }) > 0
  const health = useQuery(adminServiceHealthQueryOptions(user.id))
  const usage = useQuery({
    ...adminUsageQueryOptions(user.id, range),
    // Switching the range keeps the previous numbers on screen until the new
    // ones arrive, so the page never jumps.
    placeholderData: keepPreviousData,
  })
  const latency = useQuery({
    ...adminVoiceLatencyQueryOptions(user.id, range),
    placeholderData: keepPreviousData,
  })
  const costs = useQuery({
    ...adminServiceCostsQueryOptions(user.id, range),
    placeholderData: keepPreviousData,
  })
  const recent = useQuery(adminRecentSessionsQueryOptions(user.id))
  const today = usage.data?.today ?? loaded.today

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <aside className="fixed inset-y-6 left-6 z-30 hidden w-56 flex-col border-r border-border bg-background pr-3 lg:flex">
        <SidebarContent activeSection="admin" />
      </aside>
      <div className="lg:ml-[280px]">
        <MobileHeader activeSection="admin" />
        <main className="mx-auto flex max-w-[1168px] flex-col gap-8 px-5 pb-11 pt-6 sm:px-6 lg:px-4 lg:pb-12">
          <header className="flex flex-col gap-5 rounded-[20px] bg-brand-gradient p-5 sm:p-7 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <h1 className="text-[30px] font-normal leading-[1.4] tracking-[-1px] lg:text-[36px]">
                Quản trị
              </h1>
              <p className="mt-2 text-sm leading-[1.6] text-muted-foreground">
                Tình trạng dịch vụ và mức độ sử dụng của nền tảng.
              </p>
              {health.data ? (
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  Cập nhật lúc{' '}
                  <time
                    dateTime={health.data.checkedAt}
                    className="tabular-nums"
                  >
                    {formatClockWithSeconds(health.data.checkedAt)}
                  </time>
                  {' · '}Tự làm mới mỗi 30 giây
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              disabled={refreshing}
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: adminQueryKey(user.id),
                })
              }
              className="h-11 w-fit shrink-0 gap-3 rounded-[10px] bg-primary px-5 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover"
            >
              {refreshing ? 'Đang làm mới…' : 'Làm mới'}
              <RefreshCw
                size={17}
                className={refreshing ? 'motion-safe:animate-spin' : undefined}
                aria-hidden="true"
              />
            </Button>
          </header>

          <ServiceHealthPanel health={health.data} failed={health.isError} />

          <section
            aria-labelledby="usage-title"
            className="flex flex-col gap-5"
          >
            <h2 id="usage-title" className="text-xl font-medium">
              Mức độ sử dụng
            </h2>
            <UsageRangePicker range={range} today={today} onChange={setRange} />
            {usage.data ? (
              <p className="text-xs leading-[1.6] tabular-nums text-muted-foreground">
                {formatPeriod(usage.data.period, usage.data.today)}
                {usage.data.period.to === usage.data.today
                  ? ', hôm nay tính đến hiện tại'
                  : ''}
                {' · '}so sánh với{' '}
                {formatPeriod(usage.data.previousPeriod, usage.data.today)}
              </p>
            ) : null}

            {usage.data && usage.isError ? (
              <PanelMessage kind="alert" tone="warning">
                Không làm mới được số liệu sử dụng. Các số liệu và biểu đồ bên
                dưới là dữ liệu cũ, chưa phản ánh thay đổi mới nhất. Vui lòng
                thử làm mới.
              </PanelMessage>
            ) : null}

            {!usage.data ? (
              usage.isError ? (
                <PanelMessage kind="alert">
                  Không tải được số liệu sử dụng. Vui lòng thử làm mới.
                </PanelMessage>
              ) : (
                <PanelMessage>Đang tải số liệu…</PanelMessage>
              )
            ) : (
              <div
                aria-busy={usage.isPlaceholderData}
                className={`flex flex-col gap-8 transition-opacity ${usage.isPlaceholderData ? 'opacity-55' : ''}`}
              >
                <UsageTiles usage={usage.data} />
                <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <CallsChart usage={usage.data} />
                  <ActiveUsersChart usage={usage.data} />
                </div>
                <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                  <SessionOutcomes usage={usage.data} />
                  <TopPractices usage={usage.data} />
                </div>
              </div>
            )}
          </section>

          <section
            aria-labelledby="latency-title"
            className="flex flex-col gap-5"
          >
            <div>
              <h2 id="latency-title" className="text-xl font-medium">
                Độ trễ hội thoại
              </h2>
              <p className="mt-2 text-xs leading-[1.6] text-muted-foreground">
                Khách hàng AI cần bao lâu để trả lời người học, trong cùng kỳ
                với mức độ sử dụng ở trên.
              </p>
            </div>

            {latency.data && latency.isError ? (
              <PanelMessage kind="alert" tone="warning">
                Không làm mới được số liệu độ trễ. Các số liệu bên dưới là dữ
                liệu cũ. Vui lòng thử làm mới.
              </PanelMessage>
            ) : null}

            {!latency.data ? (
              latency.isError ? (
                <PanelMessage kind="alert">
                  Không tải được số liệu độ trễ. Vui lòng thử làm mới.
                </PanelMessage>
              ) : (
                <PanelMessage>Đang tải số liệu…</PanelMessage>
              )
            ) : (
              <div
                aria-busy={latency.isPlaceholderData}
                className={`flex flex-col gap-8 transition-opacity ${latency.isPlaceholderData ? 'opacity-55' : ''}`}
              >
                <LatencyTiles latency={latency.data} />
                <LatencyChart latency={latency.data} />
                <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <LatencyStages latency={latency.data} />
                  <LatencyByProvider latency={latency.data} />
                </div>
              </div>
            )}
          </section>

          <section
            aria-labelledby="costs-title"
            className="flex flex-col gap-5"
          >
            <div>
              <h2 id="costs-title" className="text-xl font-medium">
                Chi phí dịch vụ AI
              </h2>
              <p className="mt-2 text-xs leading-[1.6] text-muted-foreground">
                Ước tính từ lượng dùng STT, LLM và TTS theo giá niêm yết, cùng
                kỳ với mức độ sử dụng ở trên. Chỉ có từ khi bắt đầu ghi nhận
                lượng dùng.
              </p>
            </div>

            {costs.data && costs.isError ? (
              <PanelMessage kind="alert" tone="warning">
                Không làm mới được số liệu chi phí. Các số liệu bên dưới là dữ
                liệu cũ. Vui lòng thử làm mới.
              </PanelMessage>
            ) : null}

            {!costs.data ? (
              costs.isError ? (
                <PanelMessage kind="alert">
                  Không tải được số liệu chi phí. Vui lòng thử làm mới.
                </PanelMessage>
              ) : (
                <PanelMessage>Đang tải số liệu…</PanelMessage>
              )
            ) : (
              <div
                aria-busy={costs.isPlaceholderData}
                className={`flex flex-col gap-8 transition-opacity ${costs.isPlaceholderData ? 'opacity-55' : ''}`}
              >
                <CostTiles costs={costs.data} />
                <CostChart costs={costs.data} />
                <CostBreakdown costs={costs.data} />
              </div>
            )}
          </section>

          <RecentSessions
            userId={user.id}
            sessions={recent.data?.items}
            failed={recent.isError}
          />
          <p className="text-xs text-muted-foreground">
            Múi giờ Việt Nam (UTC+7)
          </p>
        </main>
      </div>
    </div>
  )
}
