import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { SidebarContent, MobileHeader } from '#/components/practice-navigation'
import { SessionFeedback } from '#/components/practice/session-feedback'
import { LiveTranscript } from '#/components/practice/transcript'
import { VoiceSessionAudio } from '#/components/practice/voice-session'
import {
  MicDeviceField,
  SpeakerDeviceField,
} from '#/components/practice/audio-device-fields'
import { CallTypeBadge, callTypes } from '#/components/practice/call-type-badge'
import { Button } from '#/components/ui/button'
import { NativeSelect } from '#/components/ui/native-select'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import { ButtonLink } from '#/components/ui/button-link'
import { Card, CardContent, CardFooter } from '#/components/ui/card'
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
import { usePracticeSession } from '#/hooks/use-practice-session'
import { useAudioDevices } from '#/hooks/use-audio-devices'
import { suggestMicType } from '#/lib/voice/audio-devices'
import {
  practiceFeedbackQueryOptions,
  practiceSessionQueryOptions,
  voiceInputOptionsQueryOptions,
} from '#/lib/practice/queries'
import type { EmotionalState, SalesOfferingConfig } from '#/db/schema'
import { formatCurrency } from '#/lib/practice/currency'
import { formatOfferingAsOf } from '#/lib/practice/offering'
import type {
  MicType,
  LearnerPracticeView,
  TtsProvider,
} from '#/lib/voice/contracts'
import {
  DEFAULT_TTS_PROVIDER,
  micTypeSchema,
  ttsProviderSchema,
} from '#/lib/voice/contracts'
import { isAdmin } from '#/lib/auth/roles'
import {
  ArrowLeft,
  ArrowUpRight,
  Captions,
  Ellipsis,
  Info,
  LoaderCircle,
  Mic,
  MicOff,
  Minus,
  PhoneOff,
  Plus,
  Volume2,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { WorkspaceUnavailable } from '#/components/workspace-unavailable'

export const Route = createFileRoute('/practice/session/$sessionId')({
  validateSearch: (search: Record<string, unknown>): { from?: 'history' } => ({
    from: search.from === 'history' ? 'history' : undefined,
  }),
  loader: async ({ context, params, location }) => {
    if (!context.user?.emailVerified)
      throw redirect({ to: '/login', search: { callbackUrl: location.href } })
    if (context.user.workspace?.status !== 'ready') return
    const session = practiceSessionQueryOptions(
      context.user.id,
      context.user.workspace.id,
      params.sessionId,
    )
    const feedback = practiceFeedbackQueryOptions(
      context.user.id,
      context.user.workspace.id,
      params.sessionId,
    )
    await Promise.all([
      context.queryClient.query(session).catch(() => undefined),
      context.queryClient.query(feedback).catch(() => undefined),
    ])
  },
  component: RolePlayPage,
})

function RolePlayPage() {
  const { sessionId } = Route.useParams()
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
    <LiveRolePlayPage
      key={`${user.workspace.id}:${sessionId}`}
      sessionId={sessionId}
      workspaceId={user.workspace.id}
    />
  )
}

function LiveRolePlayPage({
  sessionId,
  workspaceId,
}: {
  sessionId: string
  workspaceId: string
}) {
  const user = Route.useRouteContext().user
  const { from } = Route.useSearch()
  const userId = user?.id ?? ''
  // Only admins compare TTS providers; learners always hear the default voice.
  const ttsSelectable = isAdmin(user)
  const [guideOpen, setGuideOpen] = useState(false)
  const [briefCollapsed, setBriefCollapsed] = useState(false)
  const [captionsVisible, setCaptionsVisible] = useState(true)
  const [ttsProvider, setTtsProvider] =
    useState<TtsProvider>(DEFAULT_TTS_PROVIDER)
  const [micType, setMicType] = useState<MicType>('built_in')
  const voice = usePracticeSession(sessionId, userId, workspaceId)
  const voiceInputOptions = useQuery(
    voiceInputOptionsQueryOptions(userId, workspaceId),
  )
  const micTypeSelectable = voiceInputOptions.data?.micTypeSelectable ?? false
  const devices = useAudioDevices()
  const { refresh: refreshDevices } = devices
  const selectMicDevice = (deviceId: string, label: string) => {
    devices.selectMic(deviceId)
    void voice.selectMic(deviceId)
    const suggested = suggestMicType(label)
    if (suggested) setMicType(suggested)
  }
  const practice = voice.session?.practice
  const buyer = practice?.learnerBrief.buyer
  const buyerName = buyer ? buyerDisplayName(buyer) : undefined
  useEffect(() => {
    // Starting a session grants mic access, which reveals device names.
    if (voice.lifecycle === 'active')
      void refreshDevices().catch(() => undefined)
  }, [voice.lifecycle, refreshDevices])
  useEffect(() => {
    if (voice.session?.ttsProvider) setTtsProvider(voice.session.ttsProvider)
  }, [voice.session?.ttsProvider])
  useEffect(() => {
    if (voice.session?.micType) setMicType(voice.session.micType)
  }, [voice.session?.micType])
  useEffect(() => {
    if (
      voice.lifecycle === 'active' &&
      window.matchMedia('(max-width: 1279px)').matches
    )
      setBriefCollapsed(true)
  }, [voice.lifecycle])
  const connected = voice.lifecycle === 'active'
  const ended =
    voice.lifecycle === 'ended' ||
    voice.session?.status === 'completed' ||
    voice.session?.status === 'abandoned'
  const canStart =
    Boolean(voice.session) &&
    !voice.notFound &&
    voice.session?.status !== 'completed' &&
    voice.session?.status !== 'abandoned' &&
    (voice.lifecycle === 'idle' || voice.lifecycle === 'failed')

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <aside className="fixed bottom-6 left-6 top-6 z-30 hidden w-56 flex-col border-r border-border pr-3 lg:flex">
        <SidebarContent />
      </aside>
      <main className="min-h-screen lg:ml-[248px]">
        <div className="lg:hidden [&>div]:h-[84px] [&_img]:w-[148px] [&_[data-slot=avatar]]:size-11">
          <MobileHeader />
        </div>
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-5 pb-12 pt-2 lg:gap-6 lg:pl-10 lg:pr-12 lg:pt-8">
          <Link
            to={from === 'history' ? '/practice/history' : '/practice'}
            className="inline-flex min-h-5 w-fit items-center gap-2 text-[13px] text-brand hover:text-brand-hover hover:underline"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            {from === 'history' ? 'Lịch sử luyện tập' : 'Thư viện bài luyện'}
          </Link>
          <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2">
            {ended && (
              <p className="col-span-2 text-xs text-brand">PHIÊN ĐÃ KẾT THÚC</p>
            )}
            <h1 className="text-[29px] font-normal leading-[1.55] lg:text-4xl">
              {ended ? 'Kết quả luyện tập' : 'Luyện tập'}
            </h1>
            <Button
              variant="ghost"
              aria-label="Hướng dẫn luyện tập"
              onClick={() => setGuideOpen(true)}
              className="mt-1 size-11 shrink-0 gap-2 p-0 text-[13px] font-normal text-muted-foreground sm:w-auto sm:px-3"
            >
              <Info size={20} />
              <span className="hidden sm:inline">Hướng dẫn</span>
            </Button>
            <div className="col-span-2 flex flex-wrap items-center gap-2 text-sm leading-[1.55] text-muted-foreground">
              {ended && practice && <CallTypeBadge type={practice.type} />}
              <p>
                {ended
                  ? `${practice ? `${callTypes[practice.type].vietnamese} · ` : ''}${buyerName ?? 'Khách hàng'} · Phản hồi sau phiên`
                  : 'Thực hành với AI để nâng cao kỹ năng bán hàng bất động sản.'}
              </p>
            </div>
            {ended && voice.session?.endReason === 'learner_idle' && (
              <p className="col-span-2 text-sm leading-[1.55] text-muted-foreground">
                Khách hàng đã cúp máy vì không nghe bạn phản hồi.
              </p>
            )}
            {ended && (
              <ButtonLink
                to="/performance"
                search={{ period: 'recent' }}
                variant="link"
                className="col-span-2 mt-1 h-auto w-fit justify-start gap-2 p-0 text-sm font-normal text-brand hover:text-brand-hover"
              >
                Xem Năng lực của tôi{' '}
                <ArrowUpRight size={16} aria-hidden="true" />
              </ButtonLink>
            )}
          </header>
          <ResponsiveModal open={guideOpen} onOpenChange={setGuideOpen}>
            <ResponsiveModalContent className="grid gap-4 lg:w-full lg:max-w-md">
              <ResponsiveModalHeader>
                <ResponsiveModalTitle>Hướng dẫn luyện tập</ResponsiveModalTitle>
                <ResponsiveModalDescription className="leading-6">
                  Hãy trò chuyện tự nhiên, lắng nghe nhu cầu và đặt câu hỏi mở.
                  Mic tạm tắt khi khách hàng đang nói. Khi đến lượt mình, bạn có
                  thể bật hoặc tắt mic.
                </ResponsiveModalDescription>
              </ResponsiveModalHeader>
            </ResponsiveModalContent>
          </ResponsiveModal>
          {ended ? (
            <SessionFeedback
              feedback={voice.feedback}
              onRetry={() => void voice.retryFeedback()}
              objective={practice?.learnerBrief.objective}
              transcript={voice.messages}
              reference={
                <>
                  <LiveTranscript
                    messages={voice.messages}
                    visible
                    live={false}
                    ended
                    buyerName={buyerName}
                    startedAt={voice.session?.startedAt}
                  />
                  <LearnerBriefPanel
                    practice={practice}
                    collapsed={briefCollapsed}
                    onToggle={() => setBriefCollapsed((value) => !value)}
                    reference
                  />
                </>
              }
            />
          ) : (
            <>
              <PracticeObjective practice={practice} />
              <section
                className={`grid min-w-0 items-stretch gap-5 xl:min-h-[710px] xl:gap-[18px] ${briefCollapsed ? 'xl:grid-cols-[64px_minmax(0,1fr)_316px]' : 'xl:grid-cols-[minmax(220px,308px)_minmax(0,1fr)_minmax(240px,316px)]'}`}
              >
                <div className="min-h-0 min-w-0 xl:relative">
                  <div className="xl:absolute xl:inset-0">
                    <LearnerBriefPanel
                      practice={practice}
                      collapsed={briefCollapsed}
                      onToggle={() => setBriefCollapsed((value) => !value)}
                    />
                  </div>
                </div>
                <Card className="min-w-0 gap-0 overflow-hidden rounded-2xl border-0 bg-background py-0 ring-0 xl:rounded-[20px]">
                  <CardContent
                    className={`flex shrink-0 flex-col items-center gap-0 bg-brand-gradient px-5 pb-6 pt-5 lg:min-h-[568px] lg:px-6 lg:pt-6 ${canStart ? 'min-h-[488px]' : 'min-h-[402px]'}`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <div
                        role="status"
                        className="flex items-center gap-1.5 text-xs text-brand"
                      >
                        <span
                          className={`size-1.5 shrink-0 rounded-full ${voice.lifecycle === 'failed' ? 'bg-destructive' : 'bg-brand'}`}
                        />
                        {statusLabel(voice.lifecycle, voice.activity)}
                      </div>
                      <div className="font-numeric text-[13px] tabular-nums">
                        <SessionTimer
                          startedAt={voice.session?.startedAt ?? null}
                          endedAt={voice.session?.endedAt ?? null}
                        />
                      </div>
                    </div>
                    <Avatar className="mt-10 size-[168px] shrink-0 after:border-0 lg:mt-16 lg:size-[200px]">
                      <AvatarFallback className="bg-secondary text-[40px] font-normal text-brand lg:text-5xl">
                        {buyerName
                          ? buyerName
                              .trim()
                              .split(/\s+/)
                              .slice(-2)
                              .map((part) => part[0])
                              .join('')
                              .toUpperCase()
                          : 'KH'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="mt-6 text-center lg:mt-7">
                      <h2 className="text-2xl font-normal leading-9">
                        {buyerName ?? 'Khách hàng'}
                      </h2>
                      <p className="mt-1.5 text-[13px] text-muted-foreground">
                        Khách hàng
                      </p>
                    </div>
                    {canStart ? (
                      <div className="mt-7 flex w-full max-w-[344px] flex-col gap-5 lg:mt-8 lg:max-w-[300px]">
                        {ttsSelectable ? (
                          <label className="flex w-full items-center justify-between gap-3 text-[13px]">
                            <span className="shrink-0">Giọng nói AI</span>
                            <NativeSelect
                              aria-label="Chọn dịch vụ giọng nói AI"
                              wrapperClassName="flex-1"
                              value={ttsProvider}
                              onChange={(event) =>
                                setTtsProvider(
                                  ttsProviderSchema.parse(event.target.value),
                                )
                              }
                              className="h-11 min-w-0 rounded-lg border-input bg-background px-3 text-[13px] shadow-none focus-visible:ring-2 focus-visible:ring-ring lg:h-10"
                            >
                              <option value="soniox">Model S</option>
                              <option value="gemini">Gemini TTS</option>
                              <option value="elevenlabs">ElevenLabs</option>
                            </NativeSelect>
                          </label>
                        ) : null}
                        <MicDeviceField
                          id="practice-mic-device"
                          devices={devices}
                          layout="inline"
                          onSelect={selectMicDevice}
                        />
                        <SpeakerDeviceField
                          id="practice-speaker-device"
                          devices={devices}
                          layout="inline"
                        />
                        {micTypeSelectable ? (
                          <div className="flex w-full items-center justify-between gap-3 text-[13px]">
                            <span className="flex shrink-0 items-center gap-0.5">
                              <label htmlFor="practice-mic-type">
                                Loại mic
                              </label>
                              <Popover>
                                <PopoverTrigger
                                  render={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label="Vì sao cần chọn loại mic?"
                                      className="text-muted-foreground"
                                    />
                                  }
                                >
                                  <Info size={16} />
                                </PopoverTrigger>
                                <PopoverContent
                                  align="start"
                                  className="max-w-[calc(100vw-2rem)] gap-2 text-[13px] leading-5"
                                >
                                  <PopoverHeader>
                                    <PopoverTitle>
                                      Vì sao cần chọn loại mic?
                                    </PopoverTitle>
                                    <PopoverDescription>
                                      Hệ thống lọc tiếng ồn và giọng người xung
                                      quanh để AI chỉ nghe giọng của bạn. Cách
                                      lọc phụ thuộc vào khoảng cách từ mic đến
                                      miệng bạn.
                                    </PopoverDescription>
                                  </PopoverHeader>
                                  <ul className="list-disc space-y-1 pl-4">
                                    <li>
                                      <span className="font-medium">
                                        Mic ở gần:
                                      </span>{' '}
                                      tai nghe có mic hoặc mic cài áo, ở sát
                                      miệng.
                                    </li>
                                    <li>
                                      <span className="font-medium">
                                        Mic ở xa:
                                      </span>{' '}
                                      mic gắn sẵn trên laptop hoặc webcam, cách
                                      miệng bạn một khoảng.
                                    </li>
                                  </ul>
                                  <p className="text-muted-foreground">
                                    Chọn đúng loại mic giúp AI nghe bạn rõ và
                                    chính xác hơn.
                                  </p>
                                </PopoverContent>
                              </Popover>
                            </span>
                            <NativeSelect
                              id="practice-mic-type"
                              wrapperClassName="flex-1"
                              value={micType}
                              onChange={(event) =>
                                setMicType(
                                  micTypeSchema.parse(event.target.value),
                                )
                              }
                              className="h-11 min-w-0 rounded-lg border-input bg-background px-3 text-[13px] shadow-none focus-visible:ring-2 focus-visible:ring-ring lg:h-10"
                            >
                              <option value="built_in">Mic ở xa</option>
                              <option value="worn">Mic ở gần</option>
                            </NativeSelect>
                          </div>
                        ) : null}
                        <Button
                          onClick={() =>
                            void voice.start(
                              ttsSelectable
                                ? ttsProvider
                                : DEFAULT_TTS_PROVIDER,
                              {
                                micType: micTypeSelectable
                                  ? micType
                                  : undefined,
                                micDeviceId: devices.preferredMicId,
                              },
                            )
                          }
                          className="h-[50px] w-full gap-3 rounded-[9px] bg-primary text-sm font-normal text-primary-foreground hover:bg-primary-hover"
                        >
                          <Mic size={18} /> Bắt đầu luyện tập
                        </Button>
                      </div>
                    ) : connected ? (
                      <p
                        aria-live="polite"
                        className="mt-8 flex items-center justify-center gap-2 text-center text-[13px] leading-5 text-brand lg:mt-12 lg:text-sm"
                      >
                        {voice.activity === 'bot-speaking' ? (
                          <>
                            <Waveform />
                            {buyerName ?? 'Khách hàng'} đang nói...
                          </>
                        ) : voice.inputReady ? (
                          'Khách hàng đã nói xong. Đến lượt bạn.'
                        ) : (
                          'Hãy đợi khách hàng nói xong trước khi đáp lời.'
                        )}
                      </p>
                    ) : null}
                    {voice.error && (
                      <p
                        role="alert"
                        className="mt-3 max-w-md text-center text-xs text-error"
                      >
                        {voice.error}
                      </p>
                    )}
                  </CardContent>
                  <CardFooter className="flex min-h-[170px] shrink-0 flex-col items-center justify-between gap-5 border-0 bg-background px-5 pb-6 pt-6 lg:min-h-[142px] lg:px-6 lg:pb-3 lg:pt-5">
                    <div className="flex w-full max-w-[320px] items-start justify-between">
                      <CallAction
                        label={voice.micEnabled ? 'Mic bật' : 'Mic tắt'}
                        onClick={voice.toggleMic}
                        disabled={!connected || !voice.inputReady}
                      >
                        {voice.micEnabled ? (
                          <Mic
                            size={32}
                            className="size-8 xl:size-9"
                            strokeWidth={1.5}
                          />
                        ) : (
                          <MicOff
                            size={32}
                            className="size-8 xl:size-9"
                            strokeWidth={1.5}
                          />
                        )}
                      </CallAction>
                      <EndSessionDialog
                        ended={voice.lifecycle === 'idle'}
                        ending={voice.lifecycle === 'ending'}
                        onConfirm={() => void voice.end()}
                      />
                      <MoreMenu
                        captionsVisible={captionsVisible}
                        onToggleCaptions={() =>
                          setCaptionsVisible((value) => !value)
                        }
                        devices={devices}
                        onSelectMic={selectMicDevice}
                      />
                    </div>
                    <p
                      aria-live="polite"
                      className="flex items-center justify-center gap-1.5 text-center text-xs leading-[1.55] text-muted-foreground"
                    >
                      {voice.lifecycle === 'ending' && (
                        <LoaderCircle
                          size={12}
                          className="shrink-0 animate-spin"
                        />
                      )}
                      {voice.lifecycle === 'ending'
                        ? voice.buyerHungUp
                          ? 'Khách hàng đã cúp máy vì bạn không phản hồi. Đang lưu hội thoại…'
                          : 'Đang lưu hội thoại và tổng hợp kết quả…'
                        : voice.endError
                          ? 'Chưa thể kết thúc phiên. Nhấn Kết thúc để thử lại.'
                          : connected
                            ? voice.inputReady
                              ? `${voice.micEnabled ? 'Mic đang bật' : 'Mic đang tắt'} · Khách hàng đã nói xong, đến lượt bạn`
                              : 'Hãy đợi khách hàng nói xong trước khi đáp lời.'
                            : 'Nhấn Bắt đầu để cấp quyền mic và kết nối'}
                    </p>
                  </CardFooter>
                </Card>
                <div className="min-h-0 min-w-0 xl:relative">
                  <div className="xl:absolute xl:inset-0">
                    <LiveTranscript
                      messages={voice.messages}
                      visible={captionsVisible}
                      live={connected}
                      buyerName={buyerName}
                      startedAt={voice.session?.startedAt}
                    />
                  </div>
                </div>
              </section>
            </>
          )}
          <VoiceSessionAudio
            client={voice.client}
            speakerId={devices.speakerId}
          />
          {!ended && (
            <p className="text-xs leading-[1.55] text-muted-foreground">
              Tự nhiên như một cuộc tư vấn thật. SalesCoach sẽ giúp bạn tiến bộ
              sau mỗi lần luyện tập.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}

function CallAction({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      className="h-auto min-w-[68px] flex-col gap-2 p-0 text-brand hover:bg-transparent disabled:text-muted-foreground disabled:opacity-100"
    >
      <span className="grid size-11 place-items-center rounded-full transition hover:bg-muted active:scale-95">
        {children}
      </span>
      <span className="text-xs font-normal">{label}</span>
    </Button>
  )
}

function EndSessionDialog({
  ended,
  ending,
  onConfirm,
}: {
  ended: boolean
  ending: boolean
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        disabled={ended || ending}
        onClick={() => setOpen(true)}
        className="h-auto min-w-[68px] flex-col gap-2 p-0 text-destructive hover:bg-transparent disabled:text-muted-foreground disabled:opacity-100"
      >
        <span className="grid size-11 place-items-center rounded-full transition hover:bg-muted active:scale-95">
          <PhoneOff size={32} className="size-8 xl:size-9" strokeWidth={1.5} />
        </span>
        <span className="text-xs font-normal">
          {ending ? 'Đang kết thúc' : 'Kết thúc'}
        </span>
      </Button>
      <ResponsiveModal open={open} onOpenChange={setOpen}>
        <ResponsiveModalContent className="grid gap-6 lg:w-full lg:max-w-md">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>
              Kết thúc phiên luyện tập?
            </ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Cuộc hội thoại sẽ dừng và kết quả luyện tập hiện tại sẽ được tổng
              hợp.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <ResponsiveModalFooter className="gap-3 sm:space-x-0">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Tiếp tục luyện tập
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false)
                onConfirm()
              }}
            >
              Kết thúc
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </>
  )
}

function MoreMenu({
  captionsVisible,
  onToggleCaptions,
  devices,
  onSelectMic,
}: {
  captionsVisible: boolean
  onToggleCaptions: () => void
  devices: ReturnType<typeof useAudioDevices>
  onSelectMic: (deviceId: string, label: string) => void
}) {
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-w-[68px] flex-col gap-2 p-0 text-muted-foreground hover:bg-transparent"
            />
          }
        >
          <span className="grid size-11 place-items-center rounded-full transition hover:bg-muted active:scale-95">
            <Ellipsis
              size={32}
              className="size-8 xl:size-9"
              strokeWidth={1.5}
            />
          </span>
          <span className="text-xs font-normal">Thêm</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="center"
          className="w-48 text-foreground"
        >
          <DropdownMenuItem onClick={onToggleCaptions}>
            <Captions />
            {captionsVisible ? 'Ẩn phụ đề' : 'Hiện phụ đề'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setAudioSettingsOpen(true)}>
            <Volume2 /> Cài đặt âm thanh
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ResponsiveModal
        open={audioSettingsOpen}
        onOpenChange={setAudioSettingsOpen}
      >
        <ResponsiveModalContent className="grid gap-4 lg:w-full lg:max-w-md">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Cài đặt âm thanh</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Chọn thiết bị dùng trong phiên luyện tập.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <MicDeviceField
            id="audio-settings-mic"
            devices={devices}
            layout="stacked"
            onSelect={onSelectMic}
          />
          <SpeakerDeviceField
            id="audio-settings-speaker"
            devices={devices}
            layout="stacked"
          />
        </ResponsiveModalContent>
      </ResponsiveModal>
    </>
  )
}

function Waveform() {
  const heights = [6, 11, 19, 12, 24, 16, 9, 18, 12]
  return (
    <span className="flex h-6 items-center gap-[3px]" aria-hidden="true">
      {heights.map((height, index) => (
        <span
          key={`${height}-${index}`}
          className="w-[3px] rounded-full bg-brand"
          style={{ height }}
        />
      ))}
    </span>
  )
}

function PracticeObjective({
  practice,
}: {
  practice: LearnerPracticeView | null | undefined
}) {
  return (
    <Card className="min-h-[121px] shrink-0 gap-3 rounded-xl border-0 bg-warm p-5 ring-0 lg:min-h-[108px] lg:px-6 lg:py-[18px]">
      <h2 className="text-xs font-normal leading-[1.55] text-brand">
        MỤC TIÊU BUỔI LUYỆN TẬP
      </h2>
      <p className="text-base font-normal leading-[1.55]">
        {practice?.learnerBrief.objective ??
          'Đang tải mục tiêu buổi luyện tập…'}
      </p>
    </Card>
  )
}

function LearnerBriefPanel({
  practice,
  collapsed,
  onToggle,
  reference = false,
}: {
  practice: LearnerPracticeView | null | undefined
  collapsed: boolean
  onToggle: () => void
  reference?: boolean
}) {
  const brief = practice?.learnerBrief
  const offering = practice?.offering
  const buyerName = brief ? buyerDisplayName(brief.buyer) : 'Khách hàng'
  const subtitle = [
    practice ? callTypes[practice.type].vietnamese : null,
    brief?.buyer.age ? `${brief.buyer.age} tuổi` : null,
    brief?.buyer.occupation,
    brief?.buyer.emotionalState
      ? emotionalLabels[brief.buyer.emotionalState]
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card
      role="complementary"
      aria-label="Thông tin tình huống"
      className={`min-w-0 gap-0 rounded-[14px] border border-border bg-background p-0 ring-0 xl:min-h-0 ${reference ? 'xl:h-auto' : 'xl:h-full'} ${collapsed && !reference ? 'xl:items-center' : ''}`}
    >
      <div
        className={`flex w-full shrink-0 items-center justify-between gap-1 py-2.5 ${collapsed && !reference ? 'px-5 xl:px-2' : 'px-5'}`}
      >
        {collapsed && (
          <span
            className={`text-xs font-normal text-brand ${reference ? '' : 'xl:hidden'}`}
          >
            THÔNG TIN TÌNH HUỐNG
          </span>
        )}
        {!collapsed && (
          <div className="flex min-w-0 items-center text-brand">
            <h2 className="text-xs font-normal leading-[1.55]">
              THÔNG TIN TÌNH HUỐNG
            </h2>
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={
            collapsed
              ? 'Mở thông tin tình huống'
              : 'Thu gọn thông tin tình huống'
          }
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="size-11 shrink-0 rounded-lg text-foreground hover:bg-muted"
        >
          {collapsed ? <Plus size={15} /> : <Minus size={15} />}
        </Button>
      </div>

      {collapsed ? (
        !reference && (
          <div className="hidden flex-1 items-center justify-center xl:flex">
            <span className="[writing-mode:vertical-rl] text-xs font-normal text-brand">
              THÔNG TIN TÌNH HUỐNG
            </span>
          </div>
        )
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 xl:overflow-y-auto">
          <div>
            <h3 className="text-[23px] font-normal leading-[1.55]">
              {buyerName}
            </h3>
            {(practice || subtitle) && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {practice && <CallTypeBadge type={practice.type} />}
                {subtitle && (
                  <p className="text-xs leading-[1.55] text-muted-foreground">
                    {subtitle}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="mt-5 lg:mt-8">
            <h4 className="text-xs font-normal text-brand">BỐI CẢNH</h4>
            <p className="mt-3 text-[13px] leading-[1.55] text-muted-foreground">
              {brief?.background ?? 'Đang tải thông tin tình huống…'}
            </p>
            {brief?.leadSource && (
              <p className="mt-3 text-xs leading-[1.55] text-muted-foreground">
                Nguồn khách: {brief.leadSource}
              </p>
            )}
          </div>
          {brief?.previousInteractions?.length ? (
            <div className="mt-5 lg:mt-8">
              <h4 className="text-xs font-normal text-brand">
                LẦN TRAO ĐỔI TRƯỚC
              </h4>
              <ul className="mt-2 space-y-2.5 lg:mt-3">
                {brief.previousInteractions.map((item, index) => (
                  <li
                    key={`${index}-${item.when}`}
                    className="text-[13px] leading-[1.55] text-muted-foreground"
                  >
                    <span className="font-semibold">{item.when}:</span>{' '}
                    {item.summary}
                    {item.agreedNextStep && (
                      <span className="block text-xs text-muted-foreground">
                        Đã hẹn: {item.agreedNextStep}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {offering && (
            <div className="mt-5 lg:mt-8">
              <h4 className="text-xs font-normal text-brand">
                SẢN PHẨM BẠN ĐANG BÁN
              </h4>
              <p className="mt-3 text-[13px] leading-[1.55] text-foreground">
                {offeringSummary(offering)}
              </p>
              {(offering.asOf || offering.handover) && (
                <p className="mt-2 text-xs leading-[1.55] text-muted-foreground">
                  {[
                    offering.asOf &&
                      `Thông tin tại tháng ${formatOfferingAsOf(offering.asOf)}`,
                    offering.handover && `Bàn giao: ${offering.handover}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              <p className="mt-3 text-xs leading-[1.55] text-muted-foreground">
                {offering.paymentPlan.summary}
              </p>
              <ul className="mt-3 space-y-1 text-xs leading-[1.55] text-muted-foreground">
                {offering.keyStrengths.map((item) => (
                  <li key={`s-${item}`}>+ {item}</li>
                ))}
                {offering.keyWeaknesses.map((item) => (
                  <li key={`w-${item}`}>− {item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

const emotionalLabels: Record<EmotionalState, string> = {
  friendly: 'Thân thiện',
  neutral: 'Trung lập',
  guarded: 'Dè dặt',
  impatient: 'Thiếu kiên nhẫn',
  hostile: 'Gay gắt',
}

function buyerDisplayName(buyer: { name: string; addressTerm: string }) {
  const term = buyer.addressTerm
  return `${term.charAt(0).toUpperCase()}${term.slice(1)} ${buyer.name}`
}

function offeringSummary(offering: SalesOfferingConfig) {
  const price = formatCurrency(offering.price.amount, offering.price.currency)
  return [
    offering.projectName,
    offering.unit.bedrooms ? `${offering.unit.bedrooms}PN` : null,
    `${offering.unit.areaM2} m²`,
    price,
    `${offering.location.district}, ${offering.location.city}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

function statusLabel(lifecycle: string, activity: string) {
  if (lifecycle === 'idle') return 'SẴN SÀNG'
  if (lifecycle === 'provisioning') return 'ĐANG KHỞI TẠO'
  if (lifecycle === 'awaiting_connection') return 'ĐANG KẾT NỐI'
  if (lifecycle === 'ending') return 'ĐANG KẾT THÚC'
  if (lifecycle === 'ended') return 'ĐÃ KẾT THÚC'
  if (lifecycle === 'failed') return 'KẾT NỐI LỖI'
  if (activity === 'bot-speaking') return 'ĐANG NÓI'
  if (activity === 'opening') return 'ĐANG CHỜ KHÁCH HÀNG'
  if (activity === 'user-speaking') return 'BẠN ĐANG NÓI'
  if (activity === 'thinking') return 'ĐANG SUY NGHĨ'
  return 'ĐANG LẮNG NGHE'
}

function SessionTimer({
  startedAt,
  endedAt,
}: {
  startedAt: string | null
  endedAt: string | null
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!startedAt || endedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [endedAt, startedAt])
  const elapsed = startedAt
    ? Math.max(
        0,
        Math.floor(
          ((endedAt ? new Date(endedAt).getTime() : now) -
            new Date(startedAt).getTime()) /
            1_000,
        ),
      )
    : 0
  return `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
}
