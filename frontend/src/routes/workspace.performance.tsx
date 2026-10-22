import { useState } from 'react'
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { AdvancedStrip } from '#/components/workspace/performance/advanced-strip'
import { CompetencyHeatmap } from '#/components/workspace/performance/competency-heatmap'
import { CriticalErrors } from '#/components/workspace/performance/critical-errors'
import { KpiStrip } from '#/components/workspace/performance/kpi-strip'
import { MemberDetailModal } from '#/components/workspace/performance/member-detail-modal'
import { MemberTable } from '#/components/workspace/performance/member-table'
import { ObjectionBreakdown } from '#/components/workspace/performance/objection-breakdown'
import { ScenarioResults } from '#/components/workspace/performance/scenario-results'
import { TeamRangePicker } from '#/components/workspace/performance/range-picker'
import { TrendChart } from '#/components/workspace/performance/trend-chart'
import { Button } from '#/components/ui/button'
import { toDateKey } from '#/lib/admin/usage'
import { canViewWorkspacePerformance } from '#/lib/auth/workspace-roles'
import { workspacePerformanceQueryOptions } from '#/lib/workspace/queries'
import {
  DEFAULT_TEAM_PERIOD,
  DEFAULT_TEAM_VIEW,
  TEAM_PERIODS,
  TEAM_VIEWS,
  teamPeriodLabels,
  teamRangeProblem,
  teamViewLabels,
} from '#/lib/workspace/performance'
import type {
  TeamPeriodRange,
  TeamRangeSelection,
  TeamView,
} from '#/lib/workspace/performance'

type PerformanceSearch = { view: TeamView } & (
  | { period: (typeof TEAM_PERIODS)[number] }
  | { period: 'custom'; from: string; to: string }
)

const selectionOf = (search: PerformanceSearch): TeamRangeSelection =>
  search.period === 'custom'
    ? { from: search.from, to: search.to }
    : { period: search.period }

const searchOf = (
  selection: TeamRangeSelection,
  view: TeamView,
): PerformanceSearch =>
  'period' in selection
    ? { period: selection.period, view }
    : { period: 'custom', from: selection.from, to: selection.to, view }

export const Route = createFileRoute('/workspace/performance')({
  validateSearch: (search: Record<string, unknown>): PerformanceSearch => {
    const view =
      TEAM_VIEWS.find((item) => item === search.view) ?? DEFAULT_TEAM_VIEW
    const { from, to } = search
    // A range that is too short, too long or in the future falls back to the
    // default, so a hand-edited link cannot get around the limits.
    if (
      search.period === 'custom' &&
      typeof from === 'string' &&
      typeof to === 'string' &&
      !teamRangeProblem(from, to, toDateKey(new Date()))
    )
      return { period: 'custom', from, to, view }
    return {
      period:
        TEAM_PERIODS.find((period) => period === search.period) ??
        DEFAULT_TEAM_PERIOD,
      view,
    }
  },
  beforeLoad: ({ context }) => {
    // Plain members only see the General tab; the API enforces this too.
    if (!canViewWorkspacePerformance(context.user?.workspace?.role))
      throw redirect({ to: '/workspace' })
  },
  head: () => ({
    meta: [{ title: 'Hiệu suất nhóm | SalesCoach AI' }],
  }),
  component: WorkspacePerformancePage,
})

function WorkspacePerformancePage() {
  const { user } = Route.useRouteContext()
  const search = Route.useSearch()
  if (!user?.workspace) return null
  return (
    <PerformancePanel
      key={user.workspace.id}
      userId={user.id}
      workspaceId={user.workspace.id}
      selection={selectionOf(search)}
      view={search.view}
    />
  )
}

const tabsClass = 'inline-flex rounded-md bg-border p-1'
const tabClass = (active: boolean) =>
  `inline-flex h-9 items-center rounded-[7px] px-4 text-sm font-normal ${active ? 'bg-background text-brand' : 'text-muted-foreground'}`

function PeriodTabs({
  selection,
  view,
  range,
}: {
  selection: TeamRangeSelection
  view: TeamView
  range: TeamPeriodRange
}) {
  const navigate = useNavigate()
  const custom = !('period' in selection)
  return (
    <nav aria-label="Khoảng thời gian" className={tabsClass}>
      {TEAM_PERIODS.map((item) => {
        const active = 'period' in selection && selection.period === item
        return (
          <Link
            key={item}
            to="/workspace/performance"
            search={searchOf({ period: item }, view)}
            replace
            aria-current={active ? 'page' : undefined}
            className={tabClass(active)}
          >
            {teamPeriodLabels[item]}
          </Link>
        )
      })}
      <TeamRangePicker
        applied={custom ? selection : range}
        active={custom}
        today={toDateKey(new Date())}
        onChange={(picked) =>
          void navigate({
            to: '/workspace/performance',
            search: searchOf(picked, view),
            replace: true,
          })
        }
        className={`${tabClass(custom)} gap-2 hover:bg-background hover:text-brand`}
      />
    </nav>
  )
}

function ViewTabs({
  selection,
  view,
}: {
  selection: TeamRangeSelection
  view: TeamView
}) {
  return (
    <nav aria-label="Chế độ xem" className={tabsClass}>
      {TEAM_VIEWS.map((item) => (
        <Link
          key={item}
          to="/workspace/performance"
          search={searchOf(selection, item)}
          replace
          aria-current={item === view ? 'page' : undefined}
          className={tabClass(item === view)}
        >
          {teamViewLabels[item]}
        </Link>
      ))}
    </nav>
  )
}

function Card({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-background p-6 sm:p-8">
      <h2 className="text-[23px] font-normal">{title}</h2>
      {description && (
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="mt-6">{children}</div>
    </section>
  )
}

function AdvancedLoading() {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Đang tải dữ liệu nâng cao…
    </p>
  )
}

function PerformancePanel({
  userId,
  workspaceId,
  selection,
  view,
}: {
  userId: string
  workspaceId: string
  selection: TeamRangeSelection
  view: TeamView
}) {
  const query = useQuery({
    ...workspacePerformanceQueryOptions(userId, workspaceId, selection, view),
    // Switching the period, range or view keeps the previous numbers on screen until
    // the new ones arrive, so the page never jumps.
    placeholderData: keepPreviousData,
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const data = query.data

  if (query.isPending)
    return (
      <div
        role="status"
        className="flex min-h-64 items-center justify-center gap-3 rounded-xl border border-border bg-background p-6 text-muted-foreground"
      >
        <LoaderCircle
          aria-hidden="true"
          className="size-5 animate-spin text-brand"
        />
        Đang tải hiệu suất của nhóm…
      </div>
    )
  if (!data)
    return (
      <div
        role="alert"
        className="rounded-xl border border-border bg-background p-6"
      >
        <p className="text-error">{query.error.message}</p>
        <Button
          variant="outline"
          className="mt-4"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Thử lại
        </Button>
      </div>
    )

  // The previous numbers stay up while the other view loads, so what is on
  // screen can briefly lag behind the tab that was clicked.
  const advanced = view === 'advanced' ? data.advanced : null
  const selected =
    data.members.find((member) => member.userId === selectedId) ?? null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <PeriodTabs selection={selection} view={view} range={data.range} />
          <ViewTabs selection={selection} view={view} />
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {query.isFetching
            ? 'Đang cập nhật…'
            : `${data.range.from.split('-').reverse().join('/')} – ${data.range.to.split('-').reverse().join('/')}`}
        </p>
      </div>

      <section
        aria-label="Tổng quan"
        className="rounded-xl border border-border bg-background p-6 sm:p-8"
      >
        <KpiStrip data={data} />
      </section>

      {view === 'advanced' && (
        <Card
          title="Chất lượng luyện tập"
          description="Nhóm có tìm ra điều khách giấu không, có bỏ dở giữa chừng không, và đã dành bao nhiêu thời gian."
        >
          {advanced ? (
            <AdvancedStrip advanced={advanced} />
          ) : (
            <AdvancedLoading />
          )}
        </Card>
      )}

      <Card
        title="Xu hướng luyện tập"
        description="Số phiên hoàn thành và điểm trung bình theo từng quãng thời gian trong kỳ, để thấy nhóm đang đi lên, đi ngang hay chững lại."
      >
        <TrendChart trend={data.trend} />
      </Card>

      <Card
        title="Ai cần được quan tâm"
        description="Những người ngừng luyện tập hoặc có điểm giảm được xếp lên đầu. Chọn một người để xem chi tiết."
      >
        <MemberTable
          members={data.members}
          viewerUserId={userId}
          onSelect={(member) => setSelectedId(member.userId)}
        />
      </Card>

      <Card
        title="Năng lực của nhóm"
        description="Điểm gần nhất của từng người theo từng kỹ năng trong kỳ đang chọn, tách riêng gọi lần đầu và gọi lại. Một cột yếu cho thấy nhóm cần đào tạo chung, một hàng yếu cho thấy cần kèm cặp riêng."
      >
        <CompetencyHeatmap data={data} onSelectMember={setSelectedId} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Cách nhóm xử lý phản đối"
          description="Các phản đối khách nêu ra trong kỳ và mức độ nhóm xử lý được. Loại nào thấp là chủ đề nên đào tạo chung."
        >
          <ObjectionBreakdown objections={data.objections} />
        </Card>
        <Card
          title="Lỗi nghiêm trọng lặp lại"
          description="Những lỗi bị giới hạn điểm xuất hiện nhiều nhất, kèm người mắc nhiều nhất, để nhắc nhở và kèm cặp."
        >
          <CriticalErrors errors={data.criticalErrors} />
        </Card>
      </div>

      {view === 'advanced' && (
        <Card
          title="Kết quả theo tình huống"
          description="Tình huống nào được luyện nhiều, điểm ra sao và có đạt mục tiêu không. Tình huống điểm thấp mà nhiều người luyện thường là quá khó hoặc đề bài chưa rõ."
        >
          {advanced ? (
            <ScenarioResults scenarios={advanced.scenarios} />
          ) : (
            <AdvancedLoading />
          )}
        </Card>
      )}

      <MemberDetailModal
        member={selected}
        competencies={data.competencies}
        view={view}
        advanced={advanced}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}
