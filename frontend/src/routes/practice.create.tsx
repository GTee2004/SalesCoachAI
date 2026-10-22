import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Download,
  Info,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  // Send, // used by the hidden AssistantPanel
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { SidebarContent, MobileHeader } from '#/components/practice-navigation'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { VndInput } from '#/components/vnd-input'
import { Textarea } from '#/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalClose,
} from '#/components/ui/responsive-modal'
import {
  buyerFields,
  callOptions,
  defaultScorecard,
  difficultyOptions,
  disclosureOptions,
  emptyDraft,
  fieldsForDraft,
  flattenValues,
  informationFields,
  motivationOptions,
  offeringFields,
  repeatFields,
  repeatIndexes,
  rubricRepeatFields,
  scenarioFields,
  scorecardFields,
  validateDraft,
  voiceFields,
} from '#/lib/practice/authoring'
import type {
  AuthoringField,
  PracticeDraft,
  RepeatKey,
} from '#/lib/practice/authoring'
import {
  downloadPracticeTemplate,
  MAX_WORKBOOK_BYTES,
  readPracticeWorkbook,
} from '#/lib/practice/workbook'
import { COMPETENCY_CATALOGUE } from '#/lib/practice/scorecards'
import { practiceCatalogQueryOptions } from '#/lib/practice/queries'
import { WorkspaceUnavailable } from '#/components/workspace-unavailable'
import { canManageWorkspacePractices } from '#/lib/auth/workspace-roles'

export const Route = createFileRoute('/practice/create')({
  loader: ({ context, location }) => {
    if (!context.user?.emailVerified)
      throw redirect({ to: '/login', search: { callbackUrl: location.href } })
    // Personal workspaces see the form as a Business preview; company members
    // cannot author practices at all.
    const workspace = context.user.workspace
    if (
      workspace?.kind === 'company' &&
      !canManageWorkspacePractices(workspace.kind, workspace.role)
    )
      throw redirect({ to: '/practice' })
  },
  component: PracticeCreatePage,
})
const primary =
  'bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-border disabled:text-muted-foreground disabled:opacity-100'
const panel = 'rounded-xl border border-border bg-background'
const inputStyle =
  'h-12 rounded-lg border-input bg-background px-3 text-base text-foreground shadow-none focus-visible:border-brand focus-visible:ring-ring/20 sm:text-[13px] xl:h-11'
const sectionTitles = [
  'Thông tin bài luyện',
  'Sản phẩm tư vấn',
  'Khách hàng AI đóng vai',
  'Kịch bản AI',
  'Tiêu chí đánh giá',
]

function PracticeCreatePage() {
  const { user } = Route.useRouteContext()

  if (user?.workspace?.status !== 'ready') {
    return (
      <WorkspaceUnavailable
        workspaceName={user?.workspace?.name}
        section="practice"
      />
    )
  }

  return (
    <TooltipProvider delay={250}>
      <PracticeCreateForm key={`${user.id}:${user.workspace.id}`} />
    </TooltipProvider>
  )
}

function PracticeCreateForm() {
  const navigate = useNavigate()
  const { user, queryClient } = Route.useRouteContext()
  const catalog = useQuery(
    practiceCatalogQueryOptions(user!.id, user!.workspace!.id),
  )
  const availableOfferings = [
    ...new Map(
      (catalog.data?.items ?? []).map((item) => [
        JSON.stringify(item.offering),
        item,
      ]),
    ).values(),
  ]
  const [draft, setDraft] = useState<PracticeDraft>(emptyDraft)
  const [open, setOpen] = useState([0])
  const [showErrors, setShowErrors] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [saving, setSaving] = useState<'draft' | 'published' | null>(null)
  const [message, setMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)
  const [restoredFromDevice, setRestoredFromDevice] = useState(false)
  const storageKey = `practice-authoring:${user!.workspace!.id}:${user!.id}`
  const canSave = canManageWorkspacePractices(
    user!.workspace!.kind,
    user!.workspace!.role,
  )
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const value = JSON.parse(saved) as {
          draft?: PracticeDraft
          id?: string
        }
        if (
          value.draft &&
          Object.values(value.draft).every((v) => typeof v === 'string')
        ) {
          setDraft(value.draft)
          setSavedDraftId(value.id ?? null)
          const defaults = emptyDraft()
          setRestoredFromDevice(
            !!value.id ||
              Object.entries(value.draft).some(
                ([key, fieldValue]) =>
                  fieldValue.trim() && fieldValue !== defaults[key],
              ),
          )
          setMessage('Đã khôi phục nội dung đang soạn trên thiết bị này.')
        }
      }
    } catch {
      /* Storage is optional. */
    }
    setRestored(true)
  }, [storageKey])
  useEffect(() => {
    if (!restored) return
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ draft, id: savedDraftId }),
      )
    } catch {
      /* Storage is optional. */
    }
  }, [draft, savedDraftId, restored, storageKey])
  const validation = validateDraft(draft)
  const errors = showErrors ? validation.errors : {}
  const errorLabel = (key: string) =>
    fieldsForDraft(draft).find((field) => field.key === key)?.label ??
    (key.startsWith('scorecard')
      ? 'Tiêu chí đánh giá'
      : key.startsWith('offering')
        ? 'Sản phẩm tư vấn'
        : key.startsWith('config.buyer')
          ? 'Khách hàng AI'
          : key.startsWith('config')
            ? 'Kịch bản AI'
            : 'Thông tin bài luyện')
  const type = draft.type === 'warm_call' ? 'warm_call' : 'cold_call'
  const scoreFields = scorecardFields(type, draft)
  const scoreTotal = [0, 1, 2, 3, 4].reduce(
    (sum, i) => sum + Number(draft[`scorecard.${i}.weight`] || 0),
    0,
  )
  function update(key: string, value: string) {
    setSaveError('')
    setMessage('')
    setDraft((current) => {
      if (key !== 'type' || value === current.type)
        return { ...current, [key]: value }
      const next = Object.fromEntries(
        Object.entries(current).filter(
          ([name]) => !name.startsWith('scorecard.'),
        ),
      )
      return {
        ...next,
        type: value,
        ...defaultScorecard(value === 'warm_call' ? 'warm_call' : 'cold_call'),
      }
    })
  }
  function fields(items: AuthoringField[]) {
    return (
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        {items.map((field) => (
          <FormField
            key={field.key}
            field={field}
            value={draft[field.key] ?? ''}
            error={errors[field.key]}
            onChange={(value) => update(field.key, value)}
          />
        ))}
      </div>
    )
  }
  function addRepeat(prefix: RepeatKey) {
    const index = repeatIndexes(draft, prefix).length
    const keyPrefix =
      prefix === 'config.hiddenInsights' ? 'insight' : 'objection'
    let suffix = index + 1
    while (
      repeatIndexes(draft, prefix).some(
        (i) => draft[`${prefix}.${i}.key`] === `${keyPrefix}_${suffix}`,
      )
    )
      suffix++
    setDraft((current) => ({
      ...current,
      ...Object.fromEntries(
        repeatFields[prefix].map((field) => [
          `${prefix}.${index}.${field.key}`,
          field.key === 'key'
            ? `${keyPrefix}_${suffix}`
            : field.required
              ? (field.options?.[0]?.[0] ?? '')
              : '',
        ]),
      ),
    }))
  }
  function removeRepeat(prefix: RepeatKey, index: number) {
    setDraft((current) => {
      const next = { ...current }
      Object.keys(next)
        .filter((key) => key.startsWith(`${prefix}.`))
        .forEach((key) => delete next[key])
      repeatIndexes(current, prefix)
        .filter((i) => i !== index)
        .forEach((oldIndex, newIndex) =>
          repeatFields[prefix].forEach((field) => {
            next[`${prefix}.${newIndex}.${field.key}`] =
              current[`${prefix}.${oldIndex}.${field.key}`] ?? ''
          }),
        )
      return next
    })
  }
  function rubricRows(
    criterion: number,
    collection: keyof typeof rubricRepeatFields,
    label: string,
  ) {
    const prefix = `scorecard.${criterion}.rubric.${collection}`
    const rows = repeatIndexes(draft, prefix)
    return (
      <div className="mt-4 space-y-3">
        <h4 className="text-sm font-semibold">{label}</h4>
        {rows.map((row) => (
          <div key={row} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs">
                {label} {row + 1}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Xóa ${label} ${row + 1}`}
                onClick={() =>
                  setDraft((current) => {
                    const next = Object.fromEntries(
                      Object.entries(current).filter(
                        ([key]) => !key.startsWith(`${prefix}.`),
                      ),
                    )
                    repeatIndexes(current, prefix)
                      .filter((index) => index !== row)
                      .forEach((oldIndex, newIndex) => {
                        for (const field of rubricRepeatFields[collection])
                          next[`${prefix}.${newIndex}.${field.key}`] =
                            current[`${prefix}.${oldIndex}.${field.key}`] ?? ''
                      })
                    return next
                  })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            {fields(
              scoreFields.filter((field) =>
                field.key.startsWith(`${prefix}.${row}.`),
              ),
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="text-xs"
          onClick={() =>
            setDraft((current) => {
              const index = Math.max(-1, ...repeatIndexes(current, prefix)) + 1
              const next = { ...current }
              for (const field of rubricRepeatFields[collection])
                next[`${prefix}.${index}.${field.key}`] =
                  field.key === 'id'
                    ? `${collection === 'behaviors' ? 'behavior' : collection === 'levels' ? 'level' : 'error'}_${index + 1}`
                    : ''
              return next
            })
          }
        >
          <Plus className="mr-1 size-3.5" />
          Thêm {label.toLowerCase()}
        </Button>
      </div>
    )
  }
  function repeats(prefix: RepeatKey, label: string) {
    return (
      <div className="space-y-3">
        {repeatIndexes(draft, prefix).map((index) => (
          <div
            key={index}
            className="space-y-3 rounded-lg border border-border bg-muted p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">
                {label} {index + 1}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Xóa ${label.toLowerCase()} ${index + 1}`}
                onClick={() => removeRepeat(prefix, index)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            {fields(
              repeatFields[prefix].map((field) => ({
                ...field,
                key: `${prefix}.${index}.${field.key}`,
              })),
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="text-xs"
          onClick={() => addRepeat(prefix)}
        >
          <Plus className="size-4" />
          Thêm {label.toLowerCase()}
        </Button>
      </div>
    )
  }
  function revealErrors() {
    setShowErrors(true)
    setOpen([0, 1, 2, 3, 4])
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      ),
    )
  }
  async function save(status: 'draft' | 'published') {
    if (saving || !canSave) return
    if (!validation.result.success) {
      revealErrors()
      setSaveError('Vui lòng bổ sung các mục được đánh dấu trước khi lưu.')
      return
    }
    setSaving(status)
    setSaveError('')
    setMessage('')
    try {
      const response = await fetch('/api/practices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-id': user!.workspace!.id,
        },
        body: JSON.stringify({
          practice: validation.result.data,
          status,
          draftId: savedDraftId,
        }),
      })
      const data = (await response.json()) as { id?: string; error?: string }
      if (!response.ok || !data.id)
        throw new Error(
          data.error ?? 'Chưa thể lưu bài luyện. Vui lòng thử lại.',
        )
      if (status === 'draft') {
        setSavedDraftId(data.id)
        setMessage(
          'Đã lưu bản nháp vào tài khoản của bạn. Bạn có thể tiếp tục chỉnh sửa trên trang này.',
        )
      } else {
        await queryClient.invalidateQueries({
          queryKey: ['practice', user!.id, user!.workspace!.id],
        })
        try {
          localStorage.removeItem(storageKey)
        } catch {
          /* Storage is optional. */
        }
        await navigate({ to: '/practice' })
      }
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Chưa thể lưu bài luyện. Vui lòng thử lại.',
      )
    } finally {
      setSaving(null)
    }
  }
  const summaries = [
    'Các thông tin này sẽ xuất hiện trên thẻ bài luyện. Dấu * là bắt buộc.',
    draft['offering.projectName']
      ? `${draft['offering.projectName']} · ${draft['offering.unit.areaM2'] || '—'} m² · ${money(draft['offering.price.amount'])}`
      : 'Thông tin giá, pháp lý và thanh toán chính xác cho cuộc gọi.',
    draft['config.buyer.name']
      ? `${draft['config.buyer.addressTerm']} ${draft['config.buyer.name']} · ${draft['config.buyer.age'] || '—'} tuổi · ${draft['config.buyer.occupation'] || 'Chưa có nghề nghiệp'}`
      : 'Mô tả một khách hàng cụ thể để cuộc gọi sát với thực tế.',
    `${repeatIndexes(draft, 'config.hiddenInsights').length} thông tin ẩn · ${repeatIndexes(draft, 'config.objections').length} phản đối · Hướng dẫn phản ứng riêng cho AI`,
    `5 kỹ năng · Bộ tiêu chí ${type === 'warm_call' ? 'gọi lại' : 'gọi lần đầu'} · Tổng trọng số ${scoreTotal}%`,
  ]
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <aside className="fixed inset-y-6 left-6 z-30 hidden w-56 flex-col border-r border-border bg-background pr-3 lg:flex">
        <SidebarContent />
      </aside>
      <div className="lg:ml-[280px]">
        <MobileHeader />
        <main className="mx-auto max-w-[1208px] space-y-6 px-5 pt-6 pb-8 lg:px-8 lg:pt-9 lg:pb-16">
          <Link
            to="/practice"
            className="inline-flex min-h-6 items-center gap-2 text-[13px] text-muted-foreground"
          >
            <ArrowLeft className="size-4" />
            Luyện tập <span className="hidden lg:inline">/ Tạo bài luyện</span>
          </Link>
          <header className="flex flex-col items-start justify-between gap-3 lg:flex-row">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="text-[30px] leading-[1.55] font-normal tracking-[-1px] lg:text-[36px]">
                  Tạo bài luyện
                </h1>
                {(restoredFromDevice || savedDraftId) && (
                  <span
                    role="status"
                    className="inline-flex items-center gap-1"
                  >
                    <Badge
                      variant="outline"
                      className="h-6 border-amber-200 bg-amber-50 px-2.5 text-amber-800"
                    >
                      <Pencil aria-hidden="true" />
                      {savedDraftId
                        ? 'Bản nháp trong tài khoản'
                        : 'Bản nháp trên thiết bị'}
                    </Badge>
                    <FieldHelp
                      label="Trạng thái bản nháp"
                      help={
                        savedDraftId
                          ? `${restoredFromDevice ? 'Nội dung được khôi phục từ trình duyệt trên thiết bị này. ' : ''}Đã có bản nháp trong tài khoản. Nhấn “Lưu bản nháp” để cập nhật các chỉnh sửa vào tài khoản; nhấn “Tạo bài luyện” để xuất bản.`
                          : 'Nội dung được khôi phục từ bản nháp tự động lưu trong trình duyệt trên thiết bị này. Nhấn “Lưu bản nháp” để lưu vào tài khoản; nhấn “Tạo bài luyện” để xuất bản.'
                      }
                    />
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Biến tình huống bán hàng của bạn thành một cuộc gọi luyện tập
                với AI.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-0 text-[13px] font-normal text-brand lg:px-3 lg:text-muted-foreground"
              aria-label="Hướng dẫn"
              onClick={() => setGuideOpen(true)}
            >
              <Info className="size-4" />
              <span>Hướng dẫn</span>
            </Button>
          </header>
          {!canSave && (
            <section
              role="note"
              className="flex flex-col gap-4 rounded-[14px] border border-amber-200 bg-amber-50 p-5 text-amber-950 lg:flex-row lg:items-center lg:gap-6 lg:p-6"
            >
              <LockKeyhole
                aria-hidden="true"
                className="hidden size-5 shrink-0 text-amber-700 lg:block"
              />
              <div className="min-w-0 flex-1">
                <h2 className="text-[17px] leading-[1.55] font-normal">
                  Tạo bài luyện riêng là tính năng của gói Business
                </h2>
                <p className="mt-1 text-[13px] leading-[1.55] text-amber-900">
                  Bạn có thể xem trước và thử điền biểu mẫu. Với gói Business,
                  chủ sở hữu và quản lý có thể lưu bài luyện theo đúng sản phẩm,
                  khách hàng của công ty và chia sẻ cho cả đội.
                </p>
              </div>
              <Link
                to="/billing"
                search={{ plan: 'business' }}
                className={`${primary} inline-flex h-12 shrink-0 items-center justify-center rounded-lg px-5 text-[13px] font-normal lg:h-11`}
              >
                Tìm hiểu gói Business
              </Link>
            </section>
          )}
          <section className="flex flex-col gap-4 rounded-[14px] bg-secondary p-5 lg:flex-row lg:items-center lg:gap-6 lg:p-6">
            <div className="min-w-0 flex-1">
              <h2 className="text-[19px] leading-[1.55] font-normal">
                Có sẵn nội dung? Nhập từ file mẫu
              </h2>
              <p className="mt-2 text-[13px] leading-[1.55] text-muted-foreground">
                Tải mẫu Excel, điền thông tin rồi tải lên để tự động điền biểu
                mẫu.
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row">
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-lg bg-background px-5 text-[13px] font-normal lg:min-w-[160px]"
                onClick={() => {
                  setSaveError('')
                  void downloadPracticeTemplate().catch(() =>
                    setSaveError('Chưa tải được file mẫu. Vui lòng thử lại.'),
                  )
                }}
              >
                <Download className="size-4" />
                Tải file mẫu
              </Button>
              <Button
                type="button"
                className={`${primary} h-12 rounded-lg px-5 text-[13px] font-normal lg:min-w-[160px]`}
                onClick={() => setImportOpen(true)}
              >
                <Upload className="size-4" />
                Tải file lên
              </Button>
            </div>
          </section>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_344px]">
            <form
              id="practice-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                void save('published')
              }}
              className="min-w-0 space-y-5"
            >
              {sectionTitles.map((title, index) => (
                <section
                  key={title}
                  className={`${panel} scroll-mt-6`}
                  id={`section-${index}`}
                >
                  <button
                    type="button"
                    aria-expanded={open.includes(index)}
                    aria-controls={`section-body-${index}`}
                    className="flex w-full items-start gap-3 p-4 text-left xl:p-6"
                    onClick={() =>
                      setOpen((current) =>
                        current.includes(index)
                          ? current.filter((i) => i !== index)
                          : [...current, index],
                      )
                    }
                  >
                    <span className="pt-0.5 text-[13px] font-normal text-foreground">
                      0{index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[17px] leading-[1.55] font-normal xl:text-lg">
                        {title}
                      </span>
                      <span className="mt-2 block text-[13px] leading-[1.55] text-muted-foreground">
                        {summaries[index]}
                      </span>
                    </span>
                    <ChevronDown
                      className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${open.includes(index) ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {open.includes(index) && (
                    <div
                      id={`section-body-${index}`}
                      className="space-y-5 px-4 pb-5 xl:px-6 xl:pb-6"
                    >
                      {index === 0 && (
                        <>
                          {fields(
                            [
                              'title',
                              'type',
                              'difficulty',
                              'estimatedMinutes',
                              'learnerBrief.leadSource',
                              'learnerBrief.background',
                              'learnerBrief.objective',
                            ]
                              .flatMap((key) =>
                                informationFields.filter(
                                  (field) =>
                                    field.key === key &&
                                    (key !== 'learnerBrief.leadSource' ||
                                      type === 'cold_call'),
                                ),
                              )
                              .map((field) => ({
                                ...field,
                                wide: field.key === 'title',
                              })),
                          )}
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-brand">
                              Mô tả, hướng dẫn & nhãn phân loại
                            </summary>
                            <div className="mt-4">
                              {fields(
                                informationFields.filter((field) =>
                                  [
                                    'description',
                                    'learnerInstructions',
                                    'tags',
                                  ].includes(field.key),
                                ),
                              )}
                            </div>
                          </details>
                          {type === 'warm_call' && (
                            <div className="space-y-3 border-t border-border pt-4">
                              <h3 className="text-sm font-semibold">
                                Lần trao đổi trước
                              </h3>
                              {repeats(
                                'learnerBrief.previousInteractions',
                                'Lần trao đổi',
                              )}
                              <p className="text-xs text-muted-foreground">
                                Chỉ cần cho cuộc gọi lại. Gọi lần đầu sẽ dùng
                                nguồn khách hàng.
                              </p>
                            </div>
                          )}
                        </>
                      )}
                      {index === 1 && (
                        <>
                          <label className="block space-y-2 text-xs font-medium text-foreground">
                            Dùng thông tin sản phẩm có sẵn
                            <NativeSelect
                              aria-label="Dùng thông tin sản phẩm có sẵn"
                              value=""
                              wrapperClassName="w-full"
                              className={inputStyle}
                              onChange={(event) => {
                                const selected = availableOfferings.find(
                                  (item) => item.id === event.target.value,
                                )
                                if (selected)
                                  setDraft((current) => ({
                                    ...Object.fromEntries(
                                      Object.entries(current).filter(
                                        ([key]) => !key.startsWith('offering.'),
                                      ),
                                    ),
                                    ...flattenValues(
                                      selected.offering,
                                      'offering',
                                    ),
                                  }))
                              }}
                            >
                              <option value="">
                                Chọn sản phẩm hoặc nhập thông tin bên dưới…
                              </option>
                              {availableOfferings.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.catalog.productLabel}
                                </option>
                              ))}
                            </NativeSelect>
                          </label>
                          {fields(offeringFields)}
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-brand">
                              Các đợt thanh toán & sản phẩm cạnh tranh
                            </summary>
                            <div className="mt-4 space-y-5">
                              {repeats(
                                'offering.paymentPlan.milestones',
                                'Đợt thanh toán',
                              )}
                              {repeats(
                                'offering.competitors',
                                'Sản phẩm cạnh tranh',
                              )}
                            </div>
                          </details>
                        </>
                      )}
                      {index === 2 && (
                        <>
                          {fields(buyerFields)}
                          <fieldset className="rounded-lg bg-muted p-4">
                            <legend className="px-1 text-sm font-semibold">
                              <span className="inline-flex items-center gap-1">
                                Người luyện được biết trước
                                <FieldHelp
                                  label="Người luyện được biết trước"
                                  help="Chỉ chọn thông tin người luyện đã có trước khi gọi. Ví dụ: chọn ngân sách nếu khách đã chia sẻ từ lần trước; bỏ chọn nếu người luyện cần hỏi để khám phá."
                                />
                              </span>
                            </legend>
                            <p className="mb-3 text-xs leading-5 text-muted-foreground">
                              Tên và xưng hô luôn hiển thị. Các mục còn lại phải
                              khai thác trong cuộc gọi.
                            </p>
                            <div className="flex flex-wrap gap-x-5 gap-y-3">
                              {disclosureOptions.map(([key, label]) => (
                                <label
                                  key={key}
                                  className="flex items-center gap-2 text-xs"
                                >
                                  <input
                                    type="checkbox"
                                    className="size-4 accent-primary"
                                    checked={(
                                      draft['config.learnerKnows'] ?? ''
                                    )
                                      .split('\n')
                                      .includes(key)}
                                    onChange={(event) => {
                                      const keys = (
                                        draft['config.learnerKnows'] ?? ''
                                      )
                                        .split('\n')
                                        .filter(Boolean)
                                      update(
                                        'config.learnerKnows',
                                        (event.target.checked
                                          ? [...keys, key]
                                          : keys.filter((k) => k !== key)
                                        ).join('\n'),
                                      )
                                    }}
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                            {errors['config.learnerKnows'] && (
                              <p
                                role="alert"
                                className="mt-2 text-xs text-red-700"
                              >
                                {errors['config.learnerKnows']}
                              </p>
                            )}
                          </fieldset>
                        </>
                      )}
                      {index === 3 && (
                        <>
                          <p className="flex items-center gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                            <LockKeyhole className="size-4" />
                            Không hiển thị cho người luyện trước cuộc gọi.
                          </p>
                          {fields(
                            scenarioFields
                              .slice(0, 3)
                              .filter(
                                (field) =>
                                  field.key !== 'config.sinceLastContact' ||
                                  type === 'warm_call',
                              ),
                          )}
                          <h3 className="text-sm font-semibold">
                            Điều người luyện cần khám phá
                          </h3>
                          {repeats('config.hiddenInsights', 'Thông tin ẩn')}
                          {repeats('config.objections', 'Phản đối')}
                          {fields(scenarioFields.slice(3))}
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-brand">
                              Tùy chỉnh giọng nói, câu mở đầu & điều kiện kết
                              thúc
                            </summary>
                            <div className="mt-4">{fields(voiceFields)}</div>
                          </details>
                        </>
                      )}
                      {index === 4 && (
                        <>
                          <p className="text-xs leading-5 text-muted-foreground">
                            Bộ tiêu chí mặc định cho{' '}
                            {type === 'warm_call'
                              ? 'cuộc gọi lại'
                              : 'cuộc gọi lần đầu'}
                            . Bạn có thể chỉnh trọng số và hướng dẫn chấm.
                          </p>
                          <div className="space-y-3">
                            {[0, 1, 2, 3, 4].map((i) => (
                              <div
                                key={i}
                                className="border-b border-border pb-3"
                              >
                                <div className="flex items-center gap-3">
                                  <span className="flex-1 text-[13px]">
                                    {COMPETENCY_CATALOGUE.find(
                                      (c) =>
                                        c.code ===
                                        draft[`scorecard.${i}.competencyCode`],
                                    )?.name ?? 'Kỹ năng'}
                                  </span>
                                  <FieldHelp
                                    label={`Trọng số kỹ năng ${i + 1}`}
                                    help="Trọng số là mức đóng góp của kỹ năng vào điểm tổng. Tăng tỷ lệ cho kỹ năng quan trọng với mục tiêu bài luyện; tổng 5 kỹ năng phải bằng 100%."
                                  />
                                  <label className="flex items-center gap-1">
                                    <span className="sr-only">
                                      Trọng số kỹ năng {i + 1}
                                    </span>
                                    <Input
                                      type="number"
                                      min={1}
                                      max={100}
                                      className={`${inputStyle} w-16`}
                                      value={
                                        draft[`scorecard.${i}.weight`] ?? ''
                                      }
                                      aria-invalid={
                                        !!errors[`scorecard.${i}.weight`]
                                      }
                                      onChange={(event) =>
                                        update(
                                          `scorecard.${i}.weight`,
                                          event.target.value,
                                        )
                                      }
                                    />
                                    %
                                  </label>
                                </div>
                                <details className="mt-2">
                                  <summary className="flex cursor-pointer items-center gap-1 text-xs text-brand">
                                    <Pencil className="size-3" />
                                    Chỉnh hướng dẫn chấm
                                  </summary>
                                  <div className="mt-3">
                                    {fields(
                                      scoreFields.filter(
                                        (field) =>
                                          field.key.startsWith(
                                            `scorecard.${i}.`,
                                          ) &&
                                          (field.key.endsWith(
                                            '.competencyCode',
                                          ) ||
                                            field.key.endsWith(
                                              '.rubric.description',
                                            )),
                                      ),
                                    )}
                                    {rubricRows(i, 'behaviors', 'Hành vi')}
                                    {rubricRows(i, 'levels', 'Mức điểm')}
                                    {rubricRows(
                                      i,
                                      'criticalErrors',
                                      'Lỗi nghiêm trọng',
                                    )}
                                  </div>
                                </details>
                              </div>
                            ))}
                          </div>
                          <p
                            className={`flex items-center gap-2 text-xs font-semibold ${scoreTotal === 100 ? 'text-brand' : 'text-red-700'}`}
                          >
                            <CheckCircle2 className="size-4" />
                            Tổng trọng số {scoreTotal}%
                          </p>
                          {errors.scorecard && (
                            <p role="alert" className="text-xs text-red-700">
                              {errors.scorecard}
                            </p>
                          )}
                          <p className="text-xs leading-5 text-muted-foreground">
                            Mỗi kỹ năng dùng hướng dẫn chấm có sẵn, gồm hành vi
                            đạt, hành vi chưa đạt và lỗi nghiêm trọng.
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </section>
              ))}
              {showErrors && Object.keys(errors).length > 0 && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs leading-6 text-red-700"
                >
                  <p className="font-semibold">
                    Cần bổ sung {Object.keys(errors).length} mục:
                  </p>
                  <ul className="list-inside list-disc">
                    {Object.entries(errors).map(([key, error]) => (
                      <li key={key}>
                        {errorLabel(key)}: {error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </form>
            <aside className="flex min-w-0 flex-col gap-6">
              {/* Temporarily hidden: "Trợ lý tạo bài luyện" is not ready yet.
              <div className="order-2 xl:order-1">
                <AssistantPanel />
              </div>
              */}
              <div className="order-1 xl:order-2">
                <PracticePreview draft={draft} />
              </div>
              <div className="order-3 text-[13px] leading-[1.6] text-muted-foreground">
                <h3 className="mb-2 text-sm font-normal text-foreground">
                  Một bài luyện, một cuộc gọi
                </h3>
                Chọn một kết quả có thể quan sát được. Ví dụ, hẹn xem nhà vào
                một thời điểm cụ thể.
              </div>
            </aside>
          </div>
          <footer className="space-y-4 border-t border-border pt-5 xl:flex xl:items-center xl:justify-between xl:gap-6 xl:space-y-0">
            <div className="min-w-0 text-sm leading-[1.6]">
              <p>
                {validation.result.success
                  ? 'Thông tin đã đủ để tạo bài luyện'
                  : 'Hoàn thiện thông tin để tạo bài luyện'}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {canSave
                  ? 'Bài luyện mới sẽ có trong thư viện của mọi thành viên trong không gian làm việc.'
                  : 'Cần gói Business để lưu và tạo bài luyện.'}
              </p>
              {message && (
                <p role="status" className="mt-2 leading-5 text-brand">
                  {message}
                </p>
              )}
              {saveError && (
                <p role="alert" className="mt-2 leading-5 text-red-700">
                  {saveError}
                </p>
              )}
            </div>
            <div className="flex w-full flex-col gap-3 xl:w-auto xl:flex-row">
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full rounded-lg text-[13px] font-normal xl:w-44"
                disabled={!!saving || !canSave}
                onClick={() => void save('draft')}
              >
                {saving === 'draft' && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Lưu bản nháp
              </Button>
              <Button
                type="submit"
                form="practice-form"
                className={`${primary} h-[52px] w-full rounded-lg text-[13px] font-normal xl:h-12 xl:w-44`}
                disabled={!!saving || !canSave}
              >
                {saving === 'published' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Tạo bài luyện
              </Button>
            </div>
          </footer>
        </main>
      </div>
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(imported) => {
          setDraft(imported)
          setSavedDraftId(null)
          setRestoredFromDevice(false)
          setShowErrors(true)
          setMessage(
            'Đã nhập nội dung từ Excel. Kiểm tra biểu mẫu trước khi lưu.',
          )
          setOpen(
            validateDraft(imported).result.success ? [0] : [0, 1, 2, 3, 4],
          )
        }}
        hasContent={Object.entries(draft).some(
          ([key, value]) => value.trim() && value !== emptyDraft()[key],
        )}
      />
      <ResponsiveModal open={guideOpen} onOpenChange={setGuideOpen}>
        <ResponsiveModalContent className="bg-background font-sans text-foreground lg:w-[500px]">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Hướng dẫn tạo bài luyện</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Chuẩn bị một tình huống cụ thể cho một cuộc gọi.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <ol className="mt-5 list-inside list-decimal space-y-3 text-sm leading-6 text-muted-foreground">
            <li>
              Tải file mẫu Excel và sửa cột Giá trị trên sheet duy nhất, hoặc
              điền trực tiếp biểu mẫu.
            </li>
            <li>
              Tải lên file .xlsx tối đa 5 MB. File được đọc trên thiết bị để
              điền biểu mẫu.
            </li>
            <li>
              Kiểm tra sản phẩm, khách hàng, thông tin ẩn và tiêu chí đánh giá.
              Tổng trọng số cần bằng 100%.
            </li>
            <li>
              Lưu bản nháp hoặc tạo bài luyện để chia sẻ cho mọi thành viên
              trong không gian làm việc. Trợ lý AI sẽ được bổ sung trong giai
              đoạn tiếp theo.
            </li>
          </ol>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </div>
  )
}

function FieldHelp({
  label,
  help,
  className = '',
}: {
  label: string
  help: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const triggerId = useId()
  return (
    <Tooltip open={open} onOpenChange={setOpen} triggerId={triggerId}>
      <TooltipTrigger
        id={triggerId}
        type="button"
        closeOnClick={false}
        onClick={() => setOpen((current) => !current)}
        aria-label={`Gợi ý: ${label}`}
        className={`${className} inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
      >
        <Info aria-hidden="true" className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-[min(20rem,calc(100vw-2rem))] px-3 py-2.5 text-xs leading-5"
      >
        <p>{help}</p>
      </TooltipContent>
    </Tooltip>
  )
}

function FormField({
  field,
  value,
  error,
  onChange,
}: {
  field: AuthoringField
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  const id = `field-${field.key}`
  const props = {
    id,
    value,
    'aria-invalid': !!error,
    'aria-required': field.required,
    'aria-describedby':
      [
        field.help && `${id}-help`,
        field.hint && `${id}-hint`,
        error && `${id}-error`,
      ]
        .filter(Boolean)
        .join(' ') || undefined,
    onChange: (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => onChange(event.target.value),
  }
  return (
    <div className={`min-w-0 space-y-2 ${field.wide ? 'sm:col-span-2' : ''}`}>
      <div className="flex min-h-5 items-center gap-1">
        <label
          htmlFor={id}
          className="text-[13px] leading-[1.55] font-normal text-foreground"
        >
          {field.label}
          {field.required && <span className="ml-1 text-brand">*</span>}
        </label>
        {field.help && (
          // Negative margin keeps the 28px tap target from making this label
          // row taller than rows without help, so sibling inputs line up.
          <FieldHelp label={field.label} help={field.help} className="-my-1" />
        )}
      </div>
      {field.options ? (
        <NativeSelect
          {...props}
          wrapperClassName="w-full"
          className={inputStyle}
        >
          <option value="">Chọn…</option>
          {field.options.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </NativeSelect>
      ) : field.kind === 'text' || field.kind === 'lines' ? (
        <Textarea
          {...props}
          className={`${inputStyle} h-auto min-h-[112px] resize-y xl:min-h-[120px]`}
        />
      ) : field.format === 'vnd' ? (
        <VndInput
          {...props}
          onValueChange={onChange}
          className={`${inputStyle} tabular-nums`}
        />
      ) : (
        <Input
          {...props}
          type={field.kind === 'number' ? 'number' : 'text'}
          className={inputStyle}
        />
      )}
      {field.help && (
        <p id={`${id}-help`} className="sr-only">
          {field.help}
        </p>
      )}
      {field.hint && (
        <p
          id={`${id}-hint`}
          className="text-xs leading-[1.55] text-muted-foreground"
        >
          {field.hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
function money(value?: string) {
  return value && Number.isFinite(Number(value))
    ? `${new Intl.NumberFormat('vi-VN').format(Number(value))} VND`
    : 'Chưa có giá'
}
function optionLabel(
  options: readonly (readonly [string, string])[],
  value?: string,
) {
  return options.find(([key]) => key === value)?.[1] ?? ''
}
function PracticePreview({ draft }: { draft: PracticeDraft }) {
  const known = (draft['config.learnerKnows'] ?? '').split('\n')
  return (
    <section className={`${panel} space-y-4 p-5`}>
      <h2 className="text-[19px] leading-[1.6] font-normal">
        Người luyện sẽ thấy
      </h2>
      <p className="text-xs leading-[1.6] uppercase tracking-wide text-brand">
        {optionLabel(callOptions, draft.type)} ·{' '}
        {optionLabel(difficultyOptions, draft.difficulty)} ·{' '}
        {draft.estimatedMinutes || '—'} phút
      </p>
      <h3 className="text-[21px] leading-[1.6] font-normal">
        {draft.title || 'Tên bài luyện của bạn'}
      </h3>
      <p className="text-[13px] leading-[1.6]">
        {draft['config.buyer.addressTerm']}{' '}
        {draft['config.buyer.name'] || 'Tên khách hàng'}
        {known.includes('age') &&
          draft['config.buyer.age'] &&
          `, ${draft['config.buyer.age']} tuổi`}
        {known.includes('occupation') &&
          draft['config.buyer.occupation'] &&
          ` · ${draft['config.buyer.occupation']}`}
        <br />
        {known.some((k) => k === 'motivation' || k === 'motivation.type') &&
          optionLabel(motivationOptions, draft['config.buyer.motivation.type'])}
        {known.some((k) => k === 'budget' || k === 'budget.max') &&
          ` · Ngân sách ${money(draft['config.buyer.budget.max'])}`}
      </p>
      <p className="text-[13px] leading-[1.6]">
        {draft['offering.projectName'] || 'Sản phẩm tư vấn'}
        {draft['offering.unit.bedrooms'] &&
          ` · Căn ${draft['offering.unit.bedrooms']}PN`}
      </p>
      <div className="space-y-1 text-[13px] leading-[1.6]">
        <h4>Mục tiêu</h4>
        <p>
          {draft['learnerBrief.objective'] || 'Mục tiêu cụ thể của cuộc gọi'}
        </p>
      </div>
      <p className="text-xs leading-[1.6] text-muted-foreground">
        Kịch bản riêng của AI không hiển thị trên thẻ bài luyện.
      </p>
    </section>
  )
}
// Temporarily hidden from the UI; restore the render in PracticeCreateForm
// (and the `Send` import) to bring it back.
/*
function AssistantPanel() {
  const [prompt, setPrompt] = useState('')
  return (
    <section className="space-y-5 rounded-[14px] bg-warm p-5 text-[13px] leading-[1.6]">
      <header className="space-y-2">
        <h2 className="text-[19px] font-normal">Trợ lý tạo bài luyện</h2>
        <p className="text-xs text-brand">
          AI hỗ trợ điền biểu mẫu · Sắp ra mắt
        </p>
      </header>
      <p>
        Kể cho tôi tình huống bạn muốn luyện. Tôi sẽ gợi ý nội dung để bạn kiểm
        tra và áp dụng.
      </p>
      <div className="space-y-4">
        <h3 className="text-sm font-normal">Gợi ý cho kịch bản AI</h3>
        <p>
          Khách vẫn thích căn hộ nhưng lo lãi suất sau thời gian ưu đãi và chưa
          chắc nguồn vốn.
        </p>
        <p>Phản đối: “Anh nhà chị chưa đồng ý lắm.”</p>
        <p className="text-xs text-muted-foreground">
          Ví dụ minh họa · Sẽ điền 2 mục trong Kịch bản AI.
        </p>
        <Button
          type="button"
          variant="ghost"
          disabled
          className="h-11 justify-start px-0 text-[13px] font-normal text-muted-foreground disabled:opacity-100"
        >
          Áp dụng gợi ý · Sắp ra mắt
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Trợ lý đang được phát triển. Bạn có thể nhập Excel hoặc tự điền biểu
        mẫu.
      </p>
      <div className="rounded-lg border border-input bg-background p-3">
        <Textarea
          aria-label="Mô tả tình huống cho trợ lý AI"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Mô tả thêm tình huống của bạn…"
          className="min-h-20 border-0 p-0 text-base shadow-none focus-visible:ring-0 sm:text-xs"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Sắp ra mắt</span>
          <Button
            type="button"
            variant="ghost"
            disabled
            className="h-11 text-xs text-muted-foreground disabled:opacity-100"
          >
            <Send className="size-3" /> Gửi
          </Button>
        </div>
      </div>
    </section>
  )
}
*/
function ImportModal({
  open,
  onOpenChange,
  onImport,
  hasContent,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  onImport: (draft: PracticeDraft) => void
  hasContent: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const readId = useRef(0)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [fileInfo, setFileInfo] = useState<{
    name: string
    size: number
  } | null>(null)
  const [imported, setImported] = useState<PracticeDraft | null>(null)
  const [replace, setReplace] = useState(false)
  useEffect(() => {
    if (!open) {
      readId.current++
      setImported(null)
      setFileInfo(null)
      setError('')
      setReading(false)
      setReplace(false)
    }
  }, [open])
  async function readFile(file?: File) {
    if (!file) return
    const id = ++readId.current
    setError('')
    setImported(null)
    setReplace(false)
    setFileInfo({ name: file.name, size: file.size })
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError('Vui lòng chọn file Excel .xlsx.')
      return
    }
    if (file.size > MAX_WORKBOOK_BYTES) {
      setError('File vượt quá giới hạn 5 MB.')
      return
    }
    setReading(true)
    try {
      const data = await readPracticeWorkbook(await file.arrayBuffer())
      if (id === readId.current) setImported(data)
    } catch (cause) {
      if (id === readId.current)
        setError(
          cause instanceof Error ? cause.message : 'Không thể đọc file Excel.',
        )
    } finally {
      if (id === readId.current) setReading(false)
    }
  }
  const issues = imported
    ? Object.keys(validateDraft(imported).errors).length
    : 0
  const report = imported
    ? [
        ['Thông tin bài luyện', imported.title || 'Cần bổ sung tên bài luyện'],
        [
          'Sản phẩm tư vấn',
          imported['offering.projectName'] || 'Cần bổ sung sản phẩm',
        ],
        [
          'Khách hàng AI',
          `${imported['config.buyer.addressTerm'] ?? ''} ${imported['config.buyer.name'] ?? 'Cần bổ sung'} · ${imported['config.buyer.age'] ?? '—'} tuổi`,
        ],
        [
          'Kịch bản AI',
          `${repeatIndexes(imported, 'config.hiddenInsights').length} thông tin ẩn · ${repeatIndexes(imported, 'config.objections').length} phản đối`,
        ],
        ['Tiêu chí đánh giá', 'Đã đọc tiêu chí và trọng số từ file'],
      ]
    : []
  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent
        showCloseButton={false}
        className="max-h-[90dvh] rounded-t-[20px] border-border bg-background px-5 pt-3 pb-[max(24px,env(safe-area-inset-bottom))] font-sans text-foreground lg:w-[624px] lg:max-w-[calc(100vw-64px)] lg:rounded-[18px] lg:p-7"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-5 h-1 w-10 rounded-full bg-border lg:hidden"
        />
        <ResponsiveModalHeader className="space-y-4 text-left">
          <div className="flex items-start justify-between gap-3">
            <ResponsiveModalTitle className="text-[23px] leading-[1.35] font-normal lg:text-[25px]">
              Nhập bài luyện từ file mẫu
            </ResponsiveModalTitle>
            <ResponsiveModalClose
              aria-label="Đóng nhập file"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-5" />
            </ResponsiveModalClose>
          </div>
          <ResponsiveModalDescription className="text-sm leading-[1.6]">
            Một file cho một bài luyện. Nội dung sẽ điền vào biểu mẫu.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <div className="mt-5 space-y-5 lg:mt-7 lg:space-y-[22px]">
          <div className="space-y-3 rounded-[10px] bg-secondary p-4 lg:p-5">
            <h3 className="text-base leading-[1.6] font-normal">
              Chưa có file? Bắt đầu từ mẫu Excel
            </h3>
            <p className="text-[13px] leading-[1.6] text-muted-foreground">
              Có hướng dẫn và ví dụ cho từng phần, trong một sheet.
            </p>
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full rounded-lg bg-background text-sm font-normal"
              onClick={() =>
                void downloadPracticeTemplate().catch(() =>
                  setError('Chưa tải được mẫu Excel. Vui lòng thử lại.'),
                )
              }
            >
              <Download className="size-4" />
              Tải file mẫu
            </Button>
          </div>
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              void readFile(event.dataTransfer.files[0])
            }}
            className={`space-y-3 rounded-[10px] border border-border p-5 text-center ${imported ? 'hidden lg:block' : ''}`}
          >
            <Upload className="mx-auto size-7 text-brand" />
            <h3 className="text-[17px] leading-[1.6] font-normal">
              Chọn file Excel đã điền
            </h3>
            <p className="text-[13px] leading-[1.6] text-muted-foreground">
              Excel .xlsx · Tối đa 5 MB
              <span className="hidden lg:inline">
                {' '}
                · Kéo thả hoặc chọn file
              </span>
            </p>
            <input
              ref={input}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              aria-label="Chọn file Excel"
              onChange={(event) => {
                void readFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={reading}
              className="h-12 w-full rounded-lg text-sm font-normal"
              onClick={() => input.current?.click()}
            >
              {reading && <Loader2 className="size-4 animate-spin" />}
              {fileInfo ? 'Chọn file khác' : 'Chọn file'}
            </Button>
          </div>
          {fileInfo && (
            <div className="space-y-2 rounded-lg border border-border p-4 lg:p-5">
              <p className="text-[13px] leading-[1.6] break-all lg:text-sm">
                {fileInfo.name}
              </p>
              <p className="text-xs leading-[1.6] text-brand">
                {Math.ceil(fileInfo.size / 1024)} KB ·{' '}
                {reading
                  ? 'Đang đọc…'
                  : imported
                    ? 'Đã đọc xong trên thiết bị'
                    : 'Chưa nhập'}
              </p>
              {imported && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full rounded-lg text-sm font-normal lg:hidden"
                  onClick={() => input.current?.click()}
                >
                  Chọn file khác
                </Button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-[13px] leading-[1.6] text-error">
              {error}
            </p>
          )}
          {imported && (
            <div className="space-y-4 rounded-[10px] bg-secondary p-4 lg:p-5">
              <h3 className="flex items-start gap-2 text-[17px] leading-[1.6] font-normal">
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-brand" />
                Đã đọc nội dung bài luyện
              </h3>
              {report.map(([title, value]) => (
                <p key={title} className="text-[13px] leading-[1.6]">
                  {title}
                  <span className="hidden lg:inline"> — </span>
                  <br className="lg:hidden" />
                  {value}
                </p>
              ))}
              <p className="text-[13px] leading-[1.6] text-brand">
                {issues
                  ? `Có ${issues} mục cần kiểm tra / bổ sung trong biểu mẫu.`
                  : 'Thông tin đã đủ. Bạn vẫn có thể sửa trước khi lưu.'}
              </p>
            </div>
          )}
          {imported && hasContent && (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[13px] leading-[1.6]">
              <input
                type="checkbox"
                className="mt-1 size-[18px] shrink-0 accent-primary"
                checked={replace}
                onChange={(event) => setReplace(event.target.checked)}
              />
              Thay thế nội dung đang soạn bằng nội dung từ file này.
            </label>
          )}
          <p className="text-xs leading-[1.6] text-muted-foreground lg:text-[13px]">
            File được đọc cục bộ. Chỉ khi lưu bản nháp hoặc tạo bài luyện, nội
            dung biểu mẫu mới được gửi để lưu vào tài khoản.
          </p>
          <Button
            type="button"
            disabled={!imported || reading || (hasContent && !replace)}
            className={`${primary} h-[52px] w-full rounded-lg text-sm font-normal`}
            onClick={() => {
              if (imported) {
                onImport(imported)
                onOpenChange(false)
              }
            }}
          >
            Điền vào biểu mẫu
          </Button>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
