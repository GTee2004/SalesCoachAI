import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  History,
  MoreVertical,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { MobileHeader, SidebarContent } from '#/components/practice-navigation'
import { WorkspaceUnavailable } from '#/components/workspace-unavailable'
import { CallTypeBadge, callTypes } from '#/components/practice/call-type-badge'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '#/components/ui/responsive-modal'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  practiceFeedbackQueryOptions,
  practiceHistoryQueryOptions,
  practiceSessionQueryOptions,
} from '#/lib/practice/queries'
import type {
  PracticeHistoryInput,
  PracticeHistoryItem,
} from '#/lib/practice/history'

export const Route = createFileRoute('/practice/history')({
  loader: async ({ context, location }) => {
    if (!context.user?.emailVerified)
      throw redirect({ to: '/login', search: { callbackUrl: location.href } })
    if (context.user.workspace?.status !== 'ready') return
    await context.queryClient
      .query(
        practiceHistoryQueryOptions(
          context.user.id,
          context.user.workspace.id,
          defaultHistoryInput,
        ),
      )
      .catch(() => undefined)
  },
  head: () => ({ meta: [{ title: 'Lịch sử luyện tập | SalesCoach AI' }] }),
  component: PracticeHistoryPage,
})

type Period = 'all' | '7d' | '30d' | '90d'
type Filters = {
  period: Period
  type: PracticeHistoryInput['type']
  evaluation: PracticeHistoryInput['evaluation']
}

const defaultFilters: Filters = {
  period: 'all',
  type: 'all',
  evaluation: 'all',
}

const defaultHistoryInput: PracticeHistoryInput = {
  page: 1,
  pageSize: 20,
  type: 'all',
  evaluation: 'all',
}

const difficultyLabels = {
  beginner: 'Cơ bản',
  intermediate: 'Trung bình',
  advanced: 'Nâng cao',
} as const

function PracticeHistoryPage() {
  const { user } = Route.useRouteContext()
  if (user?.workspace?.status !== 'ready') {
    return (
      <WorkspaceUnavailable
        workspaceName={user?.workspace?.name}
        section="history"
      />
    )
  }
  return <ReadyPracticeHistoryPage key={user.workspace.id} />
}

function ReadyPracticeHistoryPage() {
  const user = Route.useRouteContext().user!
  const workspaceId = user.workspace!.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [deleteNotice, setDeleteNotice] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [filters, setFilters] = useState<Filters>(defaultFilters)
  const [sessionToDelete, setSessionToDelete] =
    useState<PracticeHistoryItem | null>(null)

  const input = useMemo<PracticeHistoryInput>(() => {
    const days =
      filters.period === '7d'
        ? 7
        : filters.period === '30d'
          ? 30
          : filters.period === '90d'
            ? 90
            : null
    return {
      page,
      pageSize,
      type: filters.type,
      evaluation: filters.evaluation,
      ...(days
        ? { from: new Date(Date.now() - days * 86_400_000).toISOString() }
        : {}),
    }
  }, [filters, page, pageSize])

  const history = useQuery(
    practiceHistoryQueryOptions(user.id, workspaceId, input),
  )
  useEffect(() => {
    if (history.data && page > history.data.totalPages) {
      setPage(history.data.totalPages)
    }
  }, [history.data, page])

  const deleteSession = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch(`/api/practice/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { 'x-workspace-id': workspaceId },
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error ?? 'Không thể xóa phiên luyện tập.')
      }
    },
    onSuccess: async (_, sessionId) => {
      setSessionToDelete(null)
      setDeleteNotice('Đã xóa phiên luyện tập.')
      const sessionKey = practiceSessionQueryOptions(
        user.id,
        workspaceId,
        sessionId,
      ).queryKey
      const feedbackKey = practiceFeedbackQueryOptions(
        user.id,
        workspaceId,
        sessionId,
      ).queryKey
      await Promise.all([
        queryClient.cancelQueries({ queryKey: sessionKey, exact: true }),
        queryClient.cancelQueries({ queryKey: feedbackKey, exact: true }),
      ])
      queryClient.removeQueries({ queryKey: sessionKey, exact: true })
      queryClient.removeQueries({ queryKey: feedbackKey, exact: true })
      await queryClient.invalidateQueries({
        queryKey: ['practice', user.id, workspaceId],
      })
    },
  })

  const activeFilterCount = Object.entries(filters).filter(
    ([, value]) => value !== 'all',
  ).length
  const result = history.data
  const totalPages = result?.totalPages ?? 1
  const goToSession = (sessionId: string) =>
    void navigate({
      to: '/practice/session/$sessionId',
      params: { sessionId },
      search: { from: 'history' },
    })

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <aside className="fixed inset-y-6 left-6 z-30 hidden w-56 flex-col border-r border-border bg-background pr-3 lg:flex">
        <SidebarContent activeSection="history" />
      </aside>
      <div className="lg:ml-[280px]">
        <MobileHeader activeSection="history" />
        <main className="mx-auto flex max-w-[1168px] flex-col gap-7 px-5 pb-11 pt-6 sm:px-6 lg:px-4 lg:pt-12">
          <header className="flex flex-col gap-6 rounded-[20px] bg-brand-gradient p-5 sm:p-7 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-[30px] font-normal leading-[1.4] tracking-[-1px] lg:text-[36px]">
                Lịch sử luyện tập
              </h1>
              <p className="mt-3 text-sm leading-[1.6] text-muted-foreground">
                Xem lại từng cuộc gọi. Biết rõ điều cần cải thiện.
              </p>
            </div>
            <Link
              to="/practice"
              className="inline-flex h-11 w-fit shrink-0 items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Luyện tập tiếp <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
          </header>

          <section aria-label="Bộ lọc và kết quả lịch sử" className="space-y-5">
            <section
              aria-label="Bộ lọc lịch sử"
              className="grid w-full gap-4 sm:grid-cols-3"
            >
              <FilterField
                label="Thời gian"
                value={filters.period}
                onChange={(period) => {
                  setFilters((current) => ({
                    ...current,
                    period: period as Period,
                  }))
                  setPage(1)
                }}
                options={[
                  ['all', 'Tất cả thời gian'],
                  ['7d', '7 ngày gần đây'],
                  ['30d', '30 ngày gần đây'],
                  ['90d', '90 ngày gần đây'],
                ]}
              />
              <FilterField
                label="Loại bài luyện"
                value={filters.type}
                onChange={(type) => {
                  setFilters((current) => ({
                    ...current,
                    type: type as Filters['type'],
                  }))
                  setPage(1)
                }}
                options={[
                  ['all', 'Tất cả loại'],
                  ['cold_call', 'Gọi lần đầu'],
                  ['warm_call', 'Gọi lại'],
                ]}
              />
              <FilterField
                label="Kết quả chấm"
                value={filters.evaluation}
                onChange={(evaluation) => {
                  setFilters((current) => ({
                    ...current,
                    evaluation: evaluation as Filters['evaluation'],
                  }))
                  setPage(1)
                }}
                options={[
                  ['all', 'Tất cả kết quả'],
                  ['graded', 'Đã chấm'],
                  ['ungraded', 'Chưa chấm'],
                  ['under_50', 'Dưới 50'],
                  ['50_79', 'Từ 50 đến 79'],
                  ['80_100', 'Từ 80 đến 100'],
                ]}
              />
            </section>
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <p
                role="status"
                aria-live="polite"
                className="flex items-center gap-2"
              >
                <History size={16} aria-hidden="true" />
                {history.isPending
                  ? 'Đang tải lịch sử…'
                  : result
                    ? `${result.total} phiên luyện tập${activeFilterCount ? ' phù hợp' : ''}`
                    : 'Lịch sử cuộc gọi'}
                {history.isFetching && !history.isPending && (
                  <span>· Đang cập nhật…</span>
                )}
              </p>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  className="h-8 gap-2 px-2 text-xs font-normal text-brand hover:bg-muted"
                  onClick={() => {
                    setFilters(defaultFilters)
                    setPage(1)
                  }}
                >
                  <RotateCcw size={14} aria-hidden="true" /> Đặt lại bộ lọc (
                  {activeFilterCount})
                </Button>
              )}
            </div>
          </section>

          {deleteNotice && (
            <p role="status" className="text-sm text-brand">
              {deleteNotice}
            </p>
          )}

          <section
            aria-label="Danh sách phiên luyện tập"
            aria-busy={history.isFetching}
            className="overflow-hidden rounded-[14px] border border-border bg-background"
          >
            {history.isPending || (result && page > result.totalPages) ? (
              <HistorySkeleton />
            ) : history.isError ? (
              <ErrorState onRetry={() => void history.refetch()} />
            ) : !result?.items.length ? (
              <EmptyState
                filtered={activeFilterCount > 0}
                onReset={() => {
                  setFilters(defaultFilters)
                  setPage(1)
                }}
              />
            ) : (
              <>
                <div className="hidden overflow-x-auto xl:block">
                  <table className="w-full min-w-[1000px] table-fixed border-collapse text-left">
                    <caption className="sr-only">
                      Các phiên luyện tập, khách hàng AI và kết quả chấm điểm
                    </caption>
                    <thead>
                      <tr className="h-14 border-b border-border bg-muted text-xs font-medium text-muted-foreground [&_th]:font-medium">
                        <th scope="col" className="w-[17%] px-5">
                          Bắt đầu lúc
                        </th>
                        <th scope="col" className="w-[10%] px-3">
                          Thời lượng
                        </th>
                        <th scope="col" className="w-[24%] px-3">
                          Bài luyện
                        </th>
                        <th scope="col" className="w-[16%] px-3">
                          Khách hàng AI
                        </th>
                        <th scope="col" className="w-[15%] px-3">
                          Loại
                        </th>
                        <th scope="col" className="w-[13%] px-3">
                          Điểm / 100
                        </th>
                        <th scope="col" className="w-[5%] px-2">
                          <span className="sr-only">Thao tác</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((item) => (
                        <HistoryRow
                          key={item.id}
                          item={item}
                          onOpen={() => goToSession(item.id)}
                          onDelete={() => {
                            deleteSession.reset()
                            setDeleteNotice('')
                            setSessionToDelete(item)
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid divide-y divide-border xl:hidden">
                  {result.items.map((item) => (
                    <HistoryCard
                      key={item.id}
                      item={item}
                      onOpen={() => goToSession(item.id)}
                      onDelete={() => {
                        deleteSession.reset()
                        setDeleteNotice('')
                        setSessionToDelete(item)
                      }}
                    />
                  ))}
                </div>
                <Pagination
                  page={result.page}
                  pageSize={result.pageSize}
                  total={result.total}
                  totalPages={totalPages}
                  busy={history.isFetching}
                  onPageChange={setPage}
                  onPageSizeChange={(value) => {
                    setPageSize(value)
                    setPage(1)
                  }}
                />
              </>
            )}
          </section>
        </main>
      </div>

      <ResponsiveModal
        open={Boolean(sessionToDelete)}
        onOpenChange={(open) => {
          if (!open && !deleteSession.isPending) setSessionToDelete(null)
        }}
      >
        <ResponsiveModalContent className="border-border bg-background font-sans text-foreground lg:w-full lg:max-w-md">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Xóa phiên luyện tập?</ResponsiveModalTitle>
            <ResponsiveModalDescription className="leading-6">
              Phiên “{sessionToDelete?.practice.title}” sẽ được gỡ khỏi lịch sử.
              Điểm năng lực và gợi ý luyện tập sẽ được tính lại mà không sử dụng
              kết quả này. Điểm năng lực có thể tăng hoặc giảm.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          {deleteSession.isError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteSession.error.message}
            </p>
          )}
          <ResponsiveModalFooter className="gap-2">
            <Button
              variant="outline"
              disabled={deleteSession.isPending}
              onClick={() => setSessionToDelete(null)}
            >
              Không, giữ lại
            </Button>
            <Button
              variant="destructive"
              disabled={deleteSession.isPending || !sessionToDelete}
              onClick={() => {
                if (sessionToDelete) deleteSession.mutate(sessionToDelete.id)
              }}
            >
              {deleteSession.isPending ? 'Đang xóa…' : 'Xóa phiên'}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </div>
  )
}

function HistoryRow({
  item,
  onOpen,
  onDelete,
}: {
  item: PracticeHistoryItem
  onOpen: () => void
  onDelete: () => void
}) {
  const start = formatStart(item.startedAt)
  return (
    <tr
      tabIndex={0}
      className="h-[88px] cursor-pointer border-b border-border text-[13px] outline-none transition-colors last:border-b-0 hover:bg-muted/60 focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === 'Enter' || event.key === ' ')
        ) {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <td className="px-5">
        <p className="font-medium text-foreground">{start.label}</p>
        <p className="mt-1 text-muted-foreground">{start.detail}</p>
      </td>
      <td className="px-3 font-medium text-foreground">
        {formatDuration(item.durationSeconds)}
      </td>
      <td className="px-3">
        <p className="truncate font-normal text-foreground">
          {item.practice.title}
        </p>
        <p className="mt-1 truncate text-muted-foreground">
          {[
            item.practice.projectName,
            difficultyLabels[item.practice.difficulty],
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </td>
      <td className="px-3">
        <Customer customer={item.customer} />
      </td>
      <td className="px-3">
        <div className="inline-flex max-w-full flex-col items-center gap-1">
          <CallTypeBadge type={item.practice.type} className={badgeSize} />
          <p className="max-w-full truncate text-xs text-muted-foreground">
            {callTypes[item.practice.type].vietnamese}
          </p>
        </div>
      </td>
      <td className="px-3">
        <ScoreBadge score={item.score} />
      </td>
      <td className="px-3">
        <SessionMenu
          onOpen={onOpen}
          onDelete={onDelete}
          title={item.practice.title}
        />
      </td>
    </tr>
  )
}

function HistoryCard({
  item,
  onOpen,
  onDelete,
}: {
  item: PracticeHistoryItem
  onOpen: () => void
  onDelete: () => void
}) {
  const start = formatStart(item.startedAt)
  return (
    <article className="p-5">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex flex-wrap items-center gap-2">
            <CallTypeBadge type={item.practice.type} className={badgeSize} />
            <ScoreBadge score={item.score} />
          </div>
          <h2 className="mt-3 text-[15px] font-medium leading-6 text-foreground">
            {item.practice.title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {[
              callTypes[item.practice.type].vietnamese,
              item.practice.projectName,
              difficultyLabels[item.practice.difficulty],
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </button>
        <SessionMenu
          onOpen={onOpen}
          onDelete={onDelete}
          title={item.practice.title}
        />
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-4 grid w-full grid-cols-2 gap-3 rounded-lg bg-muted p-3 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>
          <span className="block text-muted-foreground">Bắt đầu</span>
          <span className="mt-1 block font-medium text-foreground">
            {start.label} · {start.time}
          </span>
        </span>
        <span>
          <span className="block text-muted-foreground">Thời lượng</span>
          <span className="mt-1 block font-medium text-foreground">
            {formatDuration(item.durationSeconds)}
          </span>
        </span>
        <span className="col-span-2">
          <span className="block text-muted-foreground">Khách hàng AI</span>
          <span className="mt-1 block font-medium text-foreground">
            {customerDisplayName(item.customer)}
          </span>
        </span>
      </button>
    </article>
  )
}

function Customer({ customer }: { customer: PracticeHistoryItem['customer'] }) {
  const displayName = customerDisplayName(customer)
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .slice(-2)
    .join('')
    .toLocaleUpperCase('vi')
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium text-brand">
        {initials}
      </span>
      <span className="truncate font-normal text-foreground">
        {displayName}
      </span>
    </div>
  )
}

// Matches ScoreBadge so the two sit flush side by side.
const badgeSize =
  'h-7 gap-1.5 rounded-md px-2.5 py-0 font-normal [&>svg]:size-3.5!'

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null)
    return (
      <span className="inline-flex h-7 items-center whitespace-nowrap rounded-md bg-muted px-2.5 text-xs text-muted-foreground">
        Chưa chấm
      </span>
    )
  const style =
    score >= 80
      ? 'bg-secondary text-brand'
      : score >= 50
        ? 'bg-warm text-foreground'
        : 'bg-destructive-subtle text-destructive'
  return (
    <span
      className={`inline-flex h-7 items-center whitespace-nowrap rounded-md px-2.5 font-numeric text-[13px] font-semibold ${style}`}
    >
      {score}/100
    </span>
  )
}

function SessionMenu({
  onOpen,
  onDelete,
  title,
}: {
  onOpen: () => void
  onDelete: () => void
  title: string
}) {
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Thao tác cho ${title}`}
              className="text-muted-foreground hover:bg-muted"
            />
          }
        >
          <MoreVertical size={18} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-44 border-border bg-background font-sans text-foreground"
        >
          <DropdownMenuItem onClick={onOpen}>
            <Eye /> Xem chi tiết
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 /> Xóa phiên
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  busy,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  pageSize: number
  total: number
  totalPages: number
  busy: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const pageButton =
    'size-10 rounded-lg border border-border bg-background p-0 text-muted-foreground hover:bg-muted'
  return (
    <footer className="flex flex-col gap-4 border-t border-border px-5 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p>
        {from}–{to} trong {total} phiên
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            aria-label="Trang đầu"
            className={pageButton}
            disabled={page <= 1 || busy}
            onClick={() => onPageChange(1)}
          >
            <ChevronsLeft />
          </Button>
          <Button
            variant="ghost"
            aria-label="Trang trước"
            className={pageButton}
            disabled={page <= 1 || busy}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="px-2 font-semibold text-foreground">
            Trang {page} / {totalPages}
          </span>
          <Button
            variant="ghost"
            aria-label="Trang sau"
            className={pageButton}
            disabled={page >= totalPages || busy}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            aria-label="Trang cuối"
            className={pageButton}
            disabled={page >= totalPages || busy}
            onClick={() => onPageChange(totalPages)}
          >
            <ChevronsRight />
          </Button>
        </div>
        <label className="ml-auto flex items-center gap-2 sm:ml-4">
          <span>Số dòng mỗi trang</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger
              aria-label="Số dòng mỗi trang"
              className="h-10 w-[76px] rounded-lg border-border bg-background text-foreground shadow-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" className="font-sans">
              {[10, 20, 50].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
    </footer>
  )
}

function FilterField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<[string, string]>
}) {
  const selectedLabel =
    options.find(([optionValue]) => optionValue === value)?.[1] ?? value

  return (
    <label className="grid gap-2 text-xs font-medium text-muted-foreground">
      {label}
      <Select value={value} onValueChange={(next) => onChange(next ?? 'all')}>
        <SelectTrigger
          aria-label={label}
          className="h-11 w-full rounded-lg border-border bg-background text-[13px] font-normal text-foreground shadow-none"
        >
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent className="font-sans">
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

function HistorySkeleton() {
  return (
    <div
      role="status"
      aria-label="Đang tải lịch sử"
      className="animate-pulse motion-reduce:animate-none"
    >
      <span className="sr-only">Đang tải lịch sử luyện tập…</span>
      <div aria-hidden="true" className="hidden xl:block">
        <div className="h-14 border-b border-border bg-muted" />
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className="grid h-[88px] grid-cols-6 items-center gap-5 border-b border-border px-5 last:border-0"
          >
            {[48, 34, 72, 56, 44, 38].map((width, index) => (
              <span
                key={index}
                className="h-4 rounded bg-border"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="divide-y divide-border xl:hidden">
        {[0, 1].map((row) => (
          <div key={row} className="space-y-4 p-5">
            <div className="flex gap-2">
              <span className="h-7 w-28 rounded-md bg-border" />
              <span className="h-7 w-16 rounded-md bg-border" />
            </div>
            <span className="block h-5 w-3/4 rounded bg-border" />
            <span className="block h-3 w-1/2 rounded bg-border" />
            <div className="h-[118px] rounded-lg bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyState({
  filtered,
  onReset,
}: {
  filtered: boolean
  onReset: () => void
}) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
      <span className="text-brand">
        <History size={32} aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-medium">
        {filtered ? 'Không tìm thấy phiên phù hợp' : 'Chưa có phiên luyện tập'}
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
        {filtered
          ? 'Hãy thay đổi hoặc đặt lại bộ lọc để xem thêm kết quả.'
          : 'Các phiên bạn thực hiện sẽ xuất hiện tại đây cùng kết quả từ AI Coach.'}
      </p>
      {filtered ? (
        <Button
          variant="outline"
          onClick={onReset}
          className="mt-5 font-normal"
        >
          <RotateCcw aria-hidden="true" /> Đặt lại bộ lọc
        </Button>
      ) : (
        <Button
          nativeButton={false}
          render={<Link to="/practice" />}
          className="mt-5 font-normal"
        >
          Bắt đầu luyện tập <ArrowUpRight aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center"
    >
      <RotateCcw size={28} aria-hidden="true" className="mb-4 text-brand" />
      <h2 className="text-lg font-medium">Không thể tải lịch sử</h2>
      <p className="mt-3 text-sm leading-[1.6] text-muted-foreground">
        Đã có lỗi khi truy vấn dữ liệu. Vui lòng thử lại.
      </p>
      <Button variant="outline" onClick={onRetry} className="mt-5">
        <RotateCcw /> Thử lại
      </Button>
    </div>
  )
}

function customerDisplayName(customer: PracticeHistoryItem['customer']) {
  const term = customer.addressTerm
  return `${term.charAt(0).toLocaleUpperCase('vi')}${term.slice(1)} ${customer.name}`
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return '—'
  if (seconds < 60) return '< 1 phút'
  const minutes = Math.round(seconds / 60)
  return `${minutes} phút`
}

function formatStart(value: string) {
  const date = new Date(value)
  const dayKey = (input: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(input)
  const today = dayKey(new Date())
  const yesterday = dayKey(new Date(Date.now() - 86_400_000))
  const current = dayKey(date)
  const dateText = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
  const time = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  return {
    label:
      current === today
        ? 'Hôm nay'
        : current === yesterday
          ? 'Hôm qua'
          : dateText,
    detail:
      current === today || current === yesterday
        ? `${dateText} · ${time}`
        : time,
    time,
  }
}
