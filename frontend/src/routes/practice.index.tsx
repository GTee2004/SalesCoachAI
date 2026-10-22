import { SidebarContent, MobileHeader } from '#/components/practice-navigation'
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Info,
  Plus,
  Search,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '#/components/ui/badge'
import { CallTypeBadge, callTypes } from '#/components/practice/call-type-badge'
import type { PracticeCallType } from '#/components/practice/call-type-badge'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
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
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  practiceCatalogQueryOptions,
  practiceRecommendationsQueryOptions,
} from '#/lib/practice/queries'
import { WorkspaceUnavailable } from '#/components/workspace-unavailable'
import { canManageWorkspacePractices } from '#/lib/auth/workspace-roles'

export const Route = createFileRoute('/practice/')({
  loader: async ({ context, location }) => {
    if (!context.user?.emailVerified)
      throw redirect({ to: '/login', search: { callbackUrl: location.href } })

    if (context.user.workspace?.status !== 'ready') return

    const catalog = practiceCatalogQueryOptions(
      context.user.id,
      context.user.workspace.id,
    )
    const recommendations = practiceRecommendationsQueryOptions(
      context.user.id,
      context.user.workspace.id,
    )
    await Promise.all([
      context.queryClient.query(catalog).catch(() => undefined),
      context.queryClient.query(recommendations).catch(() => undefined),
    ])
  },
  component: PracticeIndexPage,
})

type PracticeType = PracticeCallType
type Difficulty = 'beginner' | 'intermediate' | 'advanced'
type Practice = {
  id: string
  isCustom: boolean
  canDelete: boolean
  type: PracticeType
  title: string
  description: string
  product: string
  skills: string[]
  scorecard: string[]
  objective: string
  difficulty: Difficulty
  minutes: number
  searchText: string
}
const difficultyLabels: Record<Difficulty, string> = {
  beginner: 'Cơ bản',
  intermediate: 'Trung bình',
  advanced: 'Nâng cao',
}

const scorecardLabels: Record<string, string> = {
  opening_hook: 'Mở đầu',
  reconnect_agenda: 'Kết nối lại',
  needs_discovery: 'Khám phá',
  value_articulation: 'Giá trị',
  objection_handling: 'Xử lý phản đối',
  next_step_closing: 'Bước tiếp theo',
}

function PracticeIndexPage() {
  const { user } = Route.useRouteContext()

  if (user?.workspace?.status !== 'ready') {
    return (
      <WorkspaceUnavailable
        workspaceName={user?.workspace?.name}
        section="practice"
      />
    )
  }

  return <ReadyPracticeIndexPage />
}

function ReadyPracticeIndexPage() {
  const [query, setQuery] = useState('')
  const [guideOpen, setGuideOpen] = useState(false)
  const [practiceToDelete, setPracticeToDelete] = useState<Practice | null>(
    null,
  )
  const [deleteNotice, setDeleteNotice] = useState('')
  const queryClient = useQueryClient()
  const user = Route.useRouteContext().user
  const catalog = useQuery(
    practiceCatalogQueryOptions(user!.id, user!.workspace!.id),
  )
  const recommendations = useQuery(
    practiceRecommendationsQueryOptions(user!.id, user!.workspace!.id),
  )
  const deletePractice = useMutation({
    mutationFn: async (practiceId: string) => {
      const response = await fetch(`/api/practices/${practiceId}`, {
        method: 'DELETE',
        headers: { 'x-workspace-id': user!.workspace!.id },
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(
          data?.error ?? 'Không thể xóa bài luyện. Vui lòng thử lại.',
        )
      }
    },
    onSuccess: async (_, practiceId) => {
      const catalogKey = practiceCatalogQueryOptions(
        user!.id,
        user!.workspace!.id,
      ).queryKey
      const recommendationsKey = practiceRecommendationsQueryOptions(
        user!.id,
        user!.workspace!.id,
      ).queryKey
      await Promise.all([
        queryClient.cancelQueries({ queryKey: catalogKey }),
        queryClient.cancelQueries({ queryKey: recommendationsKey }),
      ])
      queryClient.setQueryData(catalogKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.filter((item) => item.id !== practiceId),
            }
          : current,
      )
      queryClient.setQueryData(recommendationsKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.filter(
                (item) => item.practice.id !== practiceId,
              ),
            }
          : current,
      )
      setPracticeToDelete(null)
      setDeleteNotice('Đã xóa bài luyện.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: catalogKey }),
        queryClient.invalidateQueries({ queryKey: recommendationsKey }),
      ])
    },
  })
  function confirmDelete(practice: Practice) {
    deletePractice.reset()
    setDeleteNotice('')
    setPracticeToDelete(practice)
  }
  const practices = useMemo<Practice[]>(
    () =>
      (catalog.data?.items ?? []).map((item) => ({
        id: item.id,
        isCustom: item.isCustom,
        canDelete: item.canDelete,
        type: item.type,
        title: item.title.replace(' - ', ' · '),
        description: item.learnerBrief.background,
        product: item.catalog.productLabel,
        skills: item.competencies.map((competency) => competency.name),
        scorecard: item.catalog.scorecard.map(
          (criterion) => scorecardLabels[criterion.code] ?? criterion.name,
        ),
        objective: item.learnerBrief.objective,
        difficulty: item.difficulty,
        minutes: item.estimatedMinutes ?? 5,
        searchText: [
          item.title,
          item.description ?? '',
          item.learnerBrief.buyer.name,
          item.learnerBrief.background,
          item.learnerBrief.objective,
          item.offering.projectName,
          item.catalog.productLabel,
          ...item.competencies.map((c) => c.name),
        ].join(' '),
      })),
    [catalog.data],
  )
  const recommendedId = recommendations.data?.items[0]?.practice.id ?? null
  const featured =
    practices.find((practice) => practice.id === recommendedId) ??
    practices.at(0)
  const [type, setType] = useState<'all' | PracticeType>('all')
  const [skill, setSkill] = useState('all')
  const [difficulty, setDifficulty] = useState('all')
  const [product, setProduct] = useState('all')

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi')
    return practices.filter((practice) => {
      const matchesQuery =
        !normalizedQuery ||
        [practice.searchText].some((value) =>
          value.toLocaleLowerCase('vi').includes(normalizedQuery),
        )
      return (
        matchesQuery &&
        (type === 'all' || practice.type === type) &&
        (skill === 'all' || practice.skills.includes(skill)) &&
        (difficulty === 'all' || practice.difficulty === difficulty) &&
        (product === 'all' || practice.product === product)
      )
    })
  }, [practices, query, type, skill, difficulty, product])

  const coldCount = practices.filter(
    (practice) => practice.type === 'cold_call',
  ).length
  const warmCount = practices.length - coldCount

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <aside className="fixed inset-y-6 left-6 z-30 hidden w-56 flex-col border-r border-border bg-background pr-3 lg:flex">
        <SidebarContent />
      </aside>
      <div className="lg:ml-[280px]">
        <MobileHeader />
        <main className="mx-auto flex max-w-[1168px] flex-col gap-8 px-5 pb-11 pt-6 sm:px-6 lg:px-4 lg:pt-12">
          <header className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-[30px] font-normal leading-[1.55] tracking-[-1px] lg:text-[38px]">
                Luyện tập
              </h1>
              <p className="mt-3 text-sm leading-[1.55] text-muted-foreground">
                Thực hành cuộc gọi bán hàng với khách hàng AI. Chọn bối cảnh và
                bắt đầu khi bạn sẵn sàng.
              </p>
            </div>
            <div className="flex w-full items-center gap-3 lg:w-auto lg:shrink-0">
              {/* Personal users see the page as a Business upsell; company
                  members cannot author practices, so the entry is hidden. */}
              {(user!.workspace!.kind === 'personal' ||
                canManageWorkspacePractices(
                  user!.workspace!.kind,
                  user!.workspace!.role,
                )) && (
                <Link
                  to="/practice/create"
                  className="inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-normal text-primary-foreground hover:bg-primary-hover-strong lg:h-11 lg:w-40 lg:flex-none lg:text-[13px]"
                >
                  <Plus size={16} aria-hidden="true" /> Tạo bài luyện
                </Link>
              )}
              <Button
                variant="ghost"
                onClick={() => setGuideOpen(true)}
                aria-label="Hướng dẫn luyện tập"
                className="h-12 w-11 shrink-0 gap-2 rounded-lg border border-border text-[13px] font-normal text-brand hover:bg-muted-hover lg:h-11 lg:w-auto lg:border-transparent lg:px-3 lg:text-foreground"
              >
                <Info size={20} aria-hidden="true" />
                <span className="hidden lg:inline">Hướng dẫn</span>
              </Button>
            </div>
          </header>

          {deleteNotice && (
            <p role="status" className="text-sm text-brand">
              {deleteNotice}
            </p>
          )}

          {featured && (
            <section aria-labelledby="featured-title" className="space-y-4">
              <h2
                id="featured-title"
                className="text-[23px] font-normal leading-[1.55]"
              >
                Bắt đầu với cuộc gọi này
              </h2>
              <Card className="gap-6 rounded-[20px] border-0 bg-practice-gradient p-5 text-foreground shadow-none ring-0 lg:min-h-[230px] lg:flex-row lg:items-start lg:gap-8 lg:p-7">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CallTypeBadge type={featured.type} />
                      <span className="text-xs font-semibold uppercase leading-[1.55] tracking-[0.6px] text-brand">
                        {callTypes[featured.type].vietnamese}
                      </span>
                      {featured.isCustom && <CustomPracticeBadge />}
                    </div>
                    {featured.canDelete && (
                      <PracticeActionsMenu
                        practice={featured}
                        disabled={deletePractice.isPending}
                        onDelete={confirmDelete}
                      />
                    )}
                  </div>
                  <h3 className="mt-2 text-[23px] font-normal leading-[1.55] tracking-[-0.6px] lg:text-[27px]">
                    {featured.title}
                  </h3>
                  <p className="mt-4 text-sm leading-[1.55]">
                    {featured.description}
                  </p>
                  <p className="mt-2 text-[13px] font-medium leading-[1.55]">
                    {featured.product}
                  </p>
                  <p className="mt-3 text-[13px] leading-[1.55]">
                    Mục tiêu: {featured.objective}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-4 lg:w-[220px] lg:pt-4">
                  <p className="hidden text-[13px] leading-[1.55] lg:block">
                    Cuộc gọi phù hợp để luyện hôm nay
                  </p>
                  <p className="text-sm font-semibold leading-[1.55] lg:mt-2">
                    {difficultyLabels[featured.difficulty]} · Khoảng{' '}
                    {featured.minutes} phút
                  </p>
                  <StartPracticeButton practiceId={featured.id} featured />
                </div>
              </Card>
            </section>
          )}

          <section aria-labelledby="all-practices-title" className="space-y-5">
            <div>
              <h2
                id="all-practices-title"
                className="text-[23px] font-normal leading-[1.55]"
              >
                Chọn cuộc gọi để luyện
              </h2>
              <p
                aria-live="polite"
                className="mt-4 text-[13px] leading-[1.55] text-muted-foreground"
              >
                {filtered.length} bài luyện · {coldCount} cuộc gọi lần đầu ·{' '}
                {warmCount} cuộc gọi lại
              </p>
            </div>

            <div>
              <div className="flex flex-col gap-5">
                <div className="relative min-w-0 flex-1">
                  <Search
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Tìm theo khách hàng hoặc dự án..."
                    aria-label="Tìm theo khách hàng hoặc dự án"
                    className="h-12 rounded-lg border-border bg-background pl-[46px] text-sm shadow-none placeholder:text-muted-foreground"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
                  <div
                    role="group"
                    aria-label="Loại bài luyện"
                    className="grid grid-cols-3 gap-3 sm:col-span-2 xl:col-span-3"
                  >
                    {(
                      [
                        ['all', 'Tất cả'],
                        ['cold_call', 'Gọi lần đầu'],
                        ['warm_call', 'Gọi lại'],
                      ] as const
                    ).map(([value, label]) => {
                      const Icon =
                        value === 'all' ? null : callTypes[value].icon
                      return (
                        <Button
                          key={value}
                          type="button"
                          variant="ghost"
                          onClick={() => setType(value)}
                          aria-pressed={type === value}
                          className={`h-11 min-w-0 rounded-[7px] border border-border px-1 text-xs font-normal shadow-none sm:text-[13px] lg:h-[42px] ${type === value ? 'bg-primary text-primary-foreground hover:bg-primary-hover-strong hover:text-primary-foreground' : 'bg-background text-foreground hover:bg-muted-hover'}`}
                        >
                          {Icon && (
                            <Icon
                              aria-hidden="true"
                              className={`size-3.5 ${type === value ? '' : value === 'cold_call' ? 'text-cold-foreground' : 'text-warm-foreground'}`}
                            />
                          )}
                          {label}
                        </Button>
                      )
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-3 xl:col-span-3">
                    <FilterSelect
                      label="Kỹ năng"
                      value={skill}
                      onValueChange={setSkill}
                      options={[
                        ['all', 'Kỹ năng'],
                        ...Array.from(
                          new Set(practices.flatMap((p) => p.skills)),
                        ).map((name) => [name, name] as const),
                      ]}
                      className="w-full"
                    />
                    <FilterSelect
                      label="Độ khó"
                      value={difficulty}
                      onValueChange={setDifficulty}
                      options={[
                        ['all', 'Độ khó'],
                        ['beginner', 'Cơ bản'],
                        ['intermediate', 'Trung bình'],
                        ['advanced', 'Nâng cao'],
                      ]}
                      className="w-full"
                    />
                    <FilterSelect
                      label="Sản phẩm"
                      value={product}
                      onValueChange={setProduct}
                      options={[
                        ['all', 'Sản phẩm'],
                        ...Array.from(
                          new Set(practices.map((p) => p.product)),
                        ).map(
                          (name) =>
                            [
                              name,
                              name.split(' · ').slice(0, 3).join(' · '),
                            ] as const,
                        ),
                      ]}
                      className="col-span-2 w-full sm:col-span-1"
                    />
                  </div>
                </div>
              </div>
            </div>

            {catalog.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Đang tải bài luyện tập…
              </p>
            ) : catalog.isError ? (
              <p role="alert" className="text-sm text-error">
                Không thể tải bài luyện tập. Vui lòng thử tải lại trang.
              </p>
            ) : filtered.length ? (
              <div className="grid gap-4 md:grid-cols-2 md:gap-x-[18px]">
                {filtered.map((practice) => (
                  <PracticeCard
                    key={practice.id}
                    practice={practice}
                    deleting={deletePractice.isPending}
                    onDelete={confirmDelete}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-background px-6 py-12 text-center">
                <p className="font-semibold">
                  Không tìm thấy bài luyện phù hợp
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Hãy thử từ khóa hoặc bộ lọc khác.
                </p>
              </div>
            )}
          </section>
        </main>
      </div>
      <ResponsiveModal open={guideOpen} onOpenChange={setGuideOpen}>
        <ResponsiveModalContent className="bg-background font-sans text-foreground lg:w-full lg:max-w-md">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Hướng dẫn luyện tập</ResponsiveModalTitle>
            <ResponsiveModalDescription className="leading-6">
              Chọn cuộc gọi, xem bối cảnh, sản phẩm, mục tiêu và tiêu chí đánh
              giá. Sau đó xem bài luyện để chuẩn bị trước khi gọi.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
        </ResponsiveModalContent>
      </ResponsiveModal>
      <ResponsiveModal
        open={practiceToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletePractice.isPending) setPracticeToDelete(null)
        }}
      >
        <ResponsiveModalContent
          className="space-y-5 bg-background font-sans text-foreground lg:w-[440px]"
          showCloseButton={!deletePractice.isPending}
        >
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Xóa bài luyện?</ResponsiveModalTitle>
            <ResponsiveModalDescription className="leading-6">
              Bạn có chắc muốn xóa “{practiceToDelete?.title}”? Bài luyện sẽ bị
              xóa khỏi danh sách và không thể khôi phục. Lịch sử các cuộc gọi đã
              luyện vẫn được giữ lại.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          {deletePractice.isError && (
            <p role="alert" className="text-sm text-error">
              {deletePractice.error.message}
            </p>
          )}
          <ResponsiveModalFooter className="gap-2">
            <Button
              variant="outline"
              autoFocus
              disabled={deletePractice.isPending}
              onClick={() => setPracticeToDelete(null)}
            >
              Hủy
            </Button>
            <Button
              variant="destructive"
              disabled={deletePractice.isPending || !practiceToDelete}
              onClick={() => {
                if (practiceToDelete && !deletePractice.isPending)
                  deletePractice.mutate(practiceToDelete.id)
              }}
            >
              {deletePractice.isPending ? 'Đang xóa…' : 'Xóa bài luyện'}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </div>
  )
}

function CustomPracticeBadge() {
  return (
    <Badge className="w-fit rounded-[5px] border-0 bg-secondary px-2 py-1 text-xs font-medium text-brand">
      Bài luyện tự tạo
    </Badge>
  )
}

function PracticeActionsMenu({
  practice,
  disabled,
  onDelete,
}: {
  practice: Practice
  disabled: boolean
  onDelete: (practice: Practice) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={`Tùy chọn bài luyện ${practice.title}`}
            className="size-8 shrink-0 text-muted-foreground"
          />
        }
      >
        <MoreHorizontal size={18} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onDelete(practice)}
        >
          <Trash2 /> Xóa bài luyện
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PracticeCard({
  practice,
  deleting,
  onDelete,
}: {
  practice: Practice
  deleting: boolean
  onDelete: (practice: Practice) => void
}) {
  return (
    <Card className="gap-0 rounded-xl border border-border bg-background p-5 text-foreground shadow-none ring-0 md:min-h-[340px] md:p-6">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CallTypeBadge type={practice.type} />
          <p className="text-xs font-normal leading-[1.55] text-brand">
            <span className="uppercase">
              {callTypes[practice.type].vietnamese}
            </span>{' '}
            · {difficultyLabels[practice.difficulty]} · {practice.minutes} phút
          </p>
          {practice.isCustom && <CustomPracticeBadge />}
        </div>
        {practice.canDelete && (
          <PracticeActionsMenu
            practice={practice}
            disabled={deleting}
            onDelete={onDelete}
          />
        )}
      </div>
      <h3 className="mt-3 text-[21px] font-normal leading-[1.4]">
        {practice.title}
      </h3>
      <p className="mt-3 text-[13px] leading-[1.55] text-muted-foreground">
        {practice.description}
      </p>
      <p className="mt-3 text-xs leading-[1.55]">
        <span className="mr-2 uppercase">Sản phẩm</span>
        {practice.product}
      </p>
      <p className="mt-3 text-xs leading-[1.55]">
        <span className="mr-2 uppercase">Mục tiêu</span>
        {practice.objective}
      </p>
      <p className="mb-4 mt-3 text-xs leading-[1.55] text-muted-foreground">
        <span className="mr-2 uppercase">Đánh giá</span>
        {practice.scorecard.join(' · ')}
      </p>
      <div className="flex-1" />
      <StartPracticeButton practiceId={practice.id} />
    </Card>
  )
}

function FilterSelect({
  label,
  value,
  onValueChange,
  options,
  className,
}: {
  label: string
  value: string
  onValueChange: (value: string) => void
  options: readonly (readonly [string, string])[]
  className: string
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next ?? 'all')}
    >
      <SelectTrigger
        aria-label={label}
        className={`data-[size=default]:h-11 min-w-0 justify-start gap-2 rounded-[7px] border-border bg-background px-3 text-[13px] font-normal text-foreground shadow-none lg:data-[size=default]:h-[42px] lg:justify-center ${className}`}
      >
        <SelectValue className="min-w-0 flex-1 truncate text-left lg:flex-none lg:text-center">
          {options.find(([optionValue]) => optionValue === value)?.[1] ?? label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="font-sans">
        {options.map(([optionValue, optionLabel]) => (
          <SelectItem key={optionValue} value={optionValue}>
            {optionLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function StartPracticeButton({
  practiceId,
  featured = false,
}: {
  practiceId: string
  featured?: boolean
}) {
  const navigate = useNavigate()
  const { user } = Route.useRouteContext()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  async function start() {
    if (starting) return
    setStarting(true)
    setError('')
    try {
      const response = await fetch('/api/practice/sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-workspace-id': user!.workspace!.id,
        },
        body: JSON.stringify({ practiceId }),
      })
      if (!response.ok) throw new Error('Không thể tạo phiên luyện tập.')
      const data = (await response.json()) as { sessionId: string }
      await navigate({
        to: '/practice/session/$sessionId',
        params: { sessionId: data.sessionId },
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Không thể tạo phiên luyện tập.',
      )
      setStarting(false)
    }
  }
  return (
    <div className="w-full">
      <Button
        type="button"
        disabled={starting}
        onClick={() => void start()}
        className={
          featured
            ? 'h-12 w-full rounded-lg bg-primary text-sm font-normal text-primary-foreground hover:bg-primary-hover-strong'
            : 'h-11 w-full rounded-lg bg-secondary text-[13px] font-medium text-brand hover:bg-secondary-hover'
        }
      >
        {starting ? 'Đang mở bài luyện…' : 'Xem bài luyện'}{' '}
        <ArrowRight size={14} />
      </Button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  )
}
