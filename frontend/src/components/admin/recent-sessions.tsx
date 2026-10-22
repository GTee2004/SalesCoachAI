import { useQuery } from '@tanstack/react-query'
import { ExternalLink, MessagesSquare } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '#/components/ui/responsive-modal'
import type {
  AdminSession,
  AdminSessionTranscript,
  SessionOutcomeKey,
} from '#/lib/admin/contracts'
import { SLOW_REPLY_MS } from '#/lib/admin/contracts'
import {
  formatClockWithSeconds,
  formatDayAndClock,
  formatDuration,
  formatLatency,
} from '#/lib/admin/format'
import { adminSessionTranscriptQueryOptions } from '#/lib/admin/queries'
import { Panel, PanelMessage, StatusPill } from './panel'
import type { Tone } from './panel'

const OUTCOME_PILL: Record<SessionOutcomeKey, { tone: Tone; label: string }> = {
  in_progress: { tone: 'live', label: 'Đang gọi' },
  learner_ended: { tone: 'good', label: 'Hoàn thành' },
  buyer_hung_up: { tone: 'good', label: 'Hoàn thành' },
  time_limit: { tone: 'good', label: 'Hoàn thành' },
  learner_idle: { tone: 'neutral', label: 'Không phản hồi' },
  completed: { tone: 'good', label: 'Hoàn thành' },
  abandoned: { tone: 'neutral', label: 'Bỏ dở' },
  connection_lost: { tone: 'warning', label: 'Mất kết nối' },
  technical_error: { tone: 'critical', label: 'Lỗi kỹ thuật' },
}

function Score({ session }: { session: AdminSession }) {
  if (session.evaluation === 'failed')
    return <StatusPill tone="warning">Chưa chấm được</StatusPill>
  if (session.evaluation === 'pending')
    return <span className="text-muted-foreground">Đang chấm</span>
  return <>{session.overallScore ?? '–'}</>
}

function TranscriptButton({
  session,
  onSelect,
}: {
  session: AdminSession
  onSelect: (session: AdminSession) => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Xem hội thoại của ${session.learnerName}, ${session.practiceTitle}`}
      title="Xem hội thoại"
      onClick={() => onSelect(session)}
      className="size-11 rounded-lg bg-muted text-brand hover:bg-secondary hover:text-brand md:size-9 md:bg-transparent"
    >
      <MessagesSquare size={17} aria-hidden="true" />
    </Button>
  )
}

export function RecentSessions({
  userId,
  sessions,
  failed,
}: {
  userId: string
  sessions: AdminSession[] | undefined
  failed: boolean
}) {
  const [selected, setSelected] = useState<AdminSession | null>(null)
  return (
    <Panel
      titleId="recent-sessions-title"
      level={2}
      title="Phiên gần đây"
      description="Các cuộc gọi mới nhất trên toàn hệ thống, không phụ thuộc bộ lọc thời gian."
    >
      {sessions && failed ? (
        <PanelMessage kind="alert" tone="warning">
          Không làm mới được danh sách phiên. Danh sách bên dưới là dữ liệu cũ,
          trạng thái phiên có thể đã thay đổi. Vui lòng thử làm mới.
        </PanelMessage>
      ) : null}
      {!sessions ? (
        failed ? (
          <PanelMessage kind="alert">
            Không tải được danh sách phiên. Vui lòng thử làm mới.
          </PanelMessage>
        ) : (
          <PanelMessage>Đang tải danh sách phiên…</PanelMessage>
        )
      ) : sessions.length === 0 ? (
        <PanelMessage>Chưa có cuộc gọi nào.</PanelMessage>
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border md:hidden">
            {sessions.map((session) => {
              const pill = OUTCOME_PILL[session.outcome]
              return (
                <li
                  key={session.id}
                  className="flex min-w-0 flex-col gap-3 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-[13px] font-medium">
                      {session.learnerName}
                    </p>
                    <time
                      dateTime={session.startedAt}
                      className="text-xs tabular-nums text-muted-foreground"
                    >
                      {formatDayAndClock(session.startedAt)}
                    </time>
                  </div>
                  <p className="text-sm font-medium">{session.practiceTitle}</p>
                  <div className="w-fit">
                    <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dl className="flex flex-wrap gap-x-3 gap-y-2 text-xs text-muted-foreground">
                      <div className="flex gap-1">
                        <dt>Thời lượng:</dt>
                        <dd className="tabular-nums">
                          {session.durationSeconds == null
                            ? '–'
                            : formatDuration(session.durationSeconds)}
                        </dd>
                      </div>
                      <div className="flex items-center gap-1">
                        <dt>Điểm:</dt>
                        <dd className="tabular-nums">
                          <Score session={session} />
                        </dd>
                      </div>
                    </dl>
                    <TranscriptButton
                      session={session}
                      onSelect={setSelected}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="bg-muted text-left text-xs text-muted-foreground">
                  {(
                    [
                      ['Bắt đầu', ''],
                      ['Người học', ''],
                      ['Bài luyện', ''],
                      ['Trạng thái', ''],
                      ['Thời lượng', 'text-right'],
                      ['Điểm', 'text-right'],
                      ['Hội thoại', 'text-right'],
                    ] as const
                  ).map(([label, align]) => (
                    <th
                      key={label}
                      className={`whitespace-nowrap px-4 py-3 font-medium ${align}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => {
                  const pill = OUTCOME_PILL[session.outcome]
                  return (
                    <tr
                      key={session.id}
                      className="[&:not(:last-child)>td]:border-b [&>td]:border-border [&>td]:px-4 [&>td]:py-2.5"
                    >
                      <td className="whitespace-nowrap tabular-nums">
                        {formatDayAndClock(session.startedAt)}
                      </td>
                      <td>{session.learnerName}</td>
                      <td className="min-w-[180px] font-medium">
                        {session.practiceTitle}
                      </td>
                      <td>
                        <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                      </td>
                      <td className="text-right tabular-nums">
                        {session.durationSeconds == null
                          ? '–'
                          : formatDuration(session.durationSeconds)}
                      </td>
                      <td className="whitespace-nowrap text-right tabular-nums">
                        <Score session={session} />
                      </td>
                      <td className="text-right">
                        <TranscriptButton
                          session={session}
                          onSelect={setSelected}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <ResponsiveModal
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <ResponsiveModalContent className="space-y-6 border-border bg-background font-sans text-foreground lg:max-h-[85dvh] lg:w-[640px]">
          <ResponsiveModalHeader className="border-b border-border pb-5 pr-6 text-left">
            <ResponsiveModalTitle className="text-xl font-medium">
              {selected?.practiceTitle}
            </ResponsiveModalTitle>
            <ResponsiveModalDescription className="leading-6">
              {selected
                ? [
                    selected.learnerName,
                    formatDayAndClock(selected.startedAt),
                    ...(selected.durationSeconds == null
                      ? []
                      : [formatDuration(selected.durationSeconds)]),
                  ].join(' · ')
                : null}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          {selected ? (
            <SessionTranscript userId={userId} sessionId={selected.id} />
          ) : null}
        </ResponsiveModalContent>
      </ResponsiveModal>
    </Panel>
  )
}

function SessionTranscript({
  userId,
  sessionId,
}: {
  userId: string
  sessionId: string
}) {
  const transcript = useQuery(
    adminSessionTranscriptQueryOptions(userId, sessionId),
  )
  if (transcript.isPending)
    return <PanelMessage>Đang tải hội thoại…</PanelMessage>
  if (transcript.isError || !transcript.data)
    return (
      <PanelMessage kind="alert">
        Không tải được hội thoại. Vui lòng đóng và mở lại.
      </PanelMessage>
    )
  const { traceUrl, turns } = transcript.data
  return (
    <>
      {traceUrl ? (
        <a
          href={traceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-brand hover:text-brand-hover"
        >
          Xem trace trong Langfuse
          <ExternalLink size={13} aria-hidden="true" />
        </a>
      ) : null}
      {turns.length === 0 ? (
        <PanelMessage>Phiên này chưa có nội dung hội thoại.</PanelMessage>
      ) : (
        <TranscriptTurns turns={turns} />
      )}
    </>
  )
}

function TranscriptTurns({
  turns,
}: {
  turns: AdminSessionTranscript['turns']
}) {
  return (
    <ol className="flex flex-col gap-4">
      {turns.map((turn) => {
        const fromBuyer = turn.speaker === 'buyer'
        return (
          <li key={turn.sequence} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">
                {fromBuyer ? 'Khách hàng AI' : 'Người học'}
              </span>
              <time
                dateTime={turn.createdAt}
                className="text-xs tabular-nums text-muted-foreground"
              >
                {formatClockWithSeconds(turn.createdAt)}
              </time>
            </div>
            <p
              className={`rounded-[10px] px-4 py-4 text-sm leading-[1.6] text-foreground ${fromBuyer ? 'bg-muted' : 'bg-secondary'}`}
            >
              {turn.text}
              {turn.interrupted ? (
                <span className="ml-1 text-xs text-warning">(bị ngắt)</span>
              ) : null}
            </p>
            {turn.latencyMs != null ? (
              <p
                className={`text-xs tabular-nums ${turn.latencyMs > SLOW_REPLY_MS ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                Trả lời sau {formatLatency(turn.latencyMs)}
              </p>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
