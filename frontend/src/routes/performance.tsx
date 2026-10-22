import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ArrowUpRight,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { MobileHeader, SidebarContent } from '#/components/practice-navigation'
import {
  difficultyLabels,
  PerformanceSummaryView,
} from '#/components/performance/performance-summary'
import { WorkspaceUnavailable } from '#/components/workspace-unavailable'
import { Button } from '#/components/ui/button'
import { performanceQueryOptions } from '#/lib/practice/queries'
import type {
  PerformanceDifficulty,
  PerformancePeriod,
  PerformanceSummary,
} from '#/lib/practice/performance'

const difficultyValues = ['beginner', 'intermediate', 'advanced'] as const

export const Route = createFileRoute('/performance')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { period: PerformancePeriod; difficulty?: PerformanceDifficulty } => ({
    period: search.period === 'all' ? 'all' : 'recent',
    difficulty: difficultyValues.find((value) => value === search.difficulty),
  }),
  loaderDeps: ({ search }) => ({
    period: search.period,
    difficulty: search.difficulty,
  }),
  loader: async ({ context, deps, location }) => {
    if (!context.user?.emailVerified)
      throw redirect({ to: '/login', search: { callbackUrl: location.href } })
    if (context.user.workspace?.status !== 'ready') return
    await context.queryClient
      .query(
        performanceQueryOptions(
          context.user.id,
          context.user.workspace.id,
          deps.period,
          deps.difficulty,
        ),
      )
      .catch(() => undefined)
  },
  head: () => ({ meta: [{ title: 'Năng lực của tôi | SalesCoach AI' }] }),
  pendingComponent: PerformancePending,
  component: PerformancePage,
})

function PerformancePage() {
  const { user } = Route.useRouteContext()
  if (user?.workspace?.status !== 'ready') {
    return (
      <WorkspaceUnavailable
        workspaceName={user?.workspace?.name}
        section="performance"
      />
    )
  }
  return <ReadyPerformancePage key={user.workspace.id} />
}

function ReadyPerformancePage() {
  const user = Route.useRouteContext().user!
  const { period, difficulty } = Route.useSearch()
  const performance = useQuery(
    performanceQueryOptions(user.id, user.workspace!.id, period, difficulty),
  )

  return (
    <PerformanceLayout>
      <PerformanceHeader
        period={period}
        difficulty={difficulty}
        summary={performance.data}
      />
      <div className="mt-8 space-y-10 sm:mt-10">
        {performance.isPending ? (
          <PerformanceLoading />
        ) : performance.isError && !performance.data ? (
          <PerformanceError
            onRetry={() => void performance.refetch()}
            retrying={performance.isFetching}
          />
        ) : (
          <>
            {performance.isError ? (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-warm p-5 text-sm leading-6"
              >
                <p>
                  Chưa thể cập nhật dữ liệu. Bạn đang xem kết quả tải thành công
                  gần nhất.
                </p>
                <Button
                  variant="outline"
                  disabled={performance.isFetching}
                  onClick={() => void performance.refetch()}
                >
                  <RotateCcw aria-hidden="true" /> Thử lại
                </Button>
              </div>
            ) : null}
            {performance.data.activity.completedSessions === 0 ? (
              <section className="rounded-2xl bg-brand-gradient p-6 sm:p-8">
                <Activity
                  aria-hidden="true"
                  className="mb-5 size-6 text-brand"
                />
                <h2 className="text-xl font-normal leading-relaxed sm:text-2xl">
                  Chưa có phiên hoàn thành trong khoảng thời gian này
                </h2>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Hoàn thành một bài luyện và nhận đánh giá để bắt đầu xem bằng
                  chứng.
                  {period === 'recent'
                    ? ' Bạn cũng có thể chọn “Tất cả thời gian” để xem các phiên cũ hơn.'
                    : ''}
                </p>
                <Button
                  nativeButton={false}
                  render={<Link to="/practice" />}
                  className="mt-6 h-11 rounded-lg px-5"
                >
                  Chọn bài luyện <ArrowUpRight aria-hidden="true" />
                </Button>
              </section>
            ) : null}
            <PerformanceSummaryView
              summary={performance.data}
              workspaceId={user.workspace!.id}
            />
          </>
        )}
      </div>
    </PerformanceLayout>
  )
}

function PerformanceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <a
        href="#performance-content"
        className="sr-only z-50 rounded bg-background p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Đến nội dung năng lực
      </a>
      <aside className="fixed bottom-6 left-6 top-6 z-30 hidden w-56 flex-col border-r border-border bg-background pr-3 lg:flex">
        <SidebarContent activeSection="performance" />
      </aside>
      <div className="lg:ml-[272px]">
        <MobileHeader activeSection="performance" />
        <main
          id="performance-content"
          className="mx-auto max-w-[1440px] px-5 pb-10 pt-7 sm:px-6 lg:pt-6"
        >
          {children}
        </main>
      </div>
    </div>
  )
}

const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
})

const filterClass = (active: boolean) =>
  `flex min-h-11 items-center justify-center rounded-lg px-3 py-3 text-center text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-[13px] ${active ? 'bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground'}`

function PerformanceHeader({
  period,
  difficulty,
  summary,
}: {
  period?: PerformancePeriod
  difficulty?: PerformanceDifficulty
  summary?: PerformanceSummary
}) {
  const difficulties = summary?.difficulties.map((item) => item.value) ?? []
  if (difficulty && !difficulties.includes(difficulty))
    difficulties.push(difficulty)
  return (
    <header className="rounded-[18px] bg-brand-gradient p-5 sm:rounded-3xl sm:p-8">
      <p className="text-xs font-medium uppercase tracking-wide text-brand">
        Bằng chứng từ luyện tập
      </p>
      <h1 className="mt-6 text-[29px] font-normal leading-tight tracking-tight sm:mt-5 sm:text-[38px]">
        Năng lực của tôi
      </h1>
      <p className="mt-5 max-w-3xl text-sm leading-6 sm:mt-4 sm:text-[15px]">
        Hiểu những gì bạn đã thể hiện và biết điều cần luyện tiếp.
      </p>
      <div className="mt-8 flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
          <nav
            aria-label="Khoảng thời gian"
            className="grid w-full max-w-[324px] grid-cols-2 gap-2"
          >
            {(['recent', 'all'] as const).map((value) => (
              <Link
                key={value}
                to="/performance"
                search={{ period: value, difficulty }}
                aria-current={period === value ? 'page' : undefined}
                className={filterClass(period === value)}
              >
                {value === 'recent' ? '60 ngày gần đây' : 'Tất cả thời gian'}
              </Link>
            ))}
          </nav>
          {difficulties.length > 1 || difficulty ? (
            <nav aria-label="Độ khó" className="flex flex-wrap gap-2">
              {[undefined, ...difficulties].map((value) => (
                <Link
                  key={value ?? 'all'}
                  to="/performance"
                  search={{ period: period ?? 'recent', difficulty: value }}
                  aria-current={difficulty === value ? 'page' : undefined}
                  className={filterClass(difficulty === value)}
                >
                  {value ? difficultyLabels[value] : 'Mọi độ khó'}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
        {summary ? (
          <p
            className="text-xs leading-5 text-muted-foreground"
            aria-live="polite"
          >
            {summary.from
              ? `${dateFormatter.format(new Date(summary.from))}–${dateFormatter.format(new Date(summary.generatedAt))}`
              : 'Toàn bộ các phiên đã hoàn thành'}
            {' · '}Cập nhật{' '}
            {dateFormatter.format(new Date(summary.generatedAt))}
          </p>
        ) : null}
      </div>
    </header>
  )
}

function PerformanceLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-64 rounded-2xl border border-border bg-card p-6 sm:p-8"
    >
      <LoaderCircle
        aria-hidden="true"
        className="mb-6 size-6 animate-spin text-brand"
      />
      <p className="text-lg font-normal">Đang tải bằng chứng luyện tập…</p>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Đang tổng hợp các phiên trong khoảng thời gian đã chọn.
      </p>
    </div>
  )
}

function PerformancePending() {
  return (
    <PerformanceLayout>
      <PerformanceHeader />
      <div className="mt-8 sm:mt-10">
        <PerformanceLoading />
      </div>
    </PerformanceLayout>
  )
}

function PerformanceError({
  onRetry,
  retrying,
}: {
  onRetry: () => void
  retrying: boolean
}) {
  return (
    <section
      role="alert"
      className="rounded-2xl border border-border bg-card p-6 sm:p-8"
    >
      <CircleAlert
        aria-hidden="true"
        className="mb-6 size-6 text-destructive"
      />
      <h2 className="text-lg font-normal">Chưa thể tải bằng chứng luyện tập</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Vui lòng thử lại. Các phiên luyện tập của bạn không bị thay đổi.
      </p>
      <Button
        variant="outline"
        className="mt-5"
        disabled={retrying}
        onClick={onRetry}
      >
        <RotateCcw aria-hidden="true" />{' '}
        {retrying ? 'Đang tải lại…' : 'Thử lại'}
      </Button>
    </section>
  )
}
