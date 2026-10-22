import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowUpRight, Check, ChevronDown } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type {
  PerformanceDifficulty,
  PerformanceExample,
  PerformanceFocus,
  PerformanceSkill,
  PerformanceSummary,
} from '#/lib/practice/performance'

const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
})
const numberFormatter = new Intl.NumberFormat('vi-VN', {
  maximumFractionDigits: 1,
})
const callTypes = { cold_call: 'Gọi lần đầu', warm_call: 'Gọi lại' } as const
export const difficultyLabels = {
  beginner: 'Cơ bản',
  intermediate: 'Trung bình',
  advanced: 'Nâng cao',
} as const
const objectionLabels: Record<string, string> = {
  brush_off: 'Từ chối nhanh',
  not_interested: 'Không quan tâm',
  timing: 'Thời điểm',
  price: 'Giá cả',
  trust: 'Niềm tin',
  product: 'Sản phẩm',
  decision_authority: 'Quyền quyết định',
  competitor: 'Đối thủ cạnh tranh',
}
const linkClass =
  'rounded text-brand outline-none hover:text-brand-hover hover:underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring'

function formatDate(value: string) {
  return dateFormatter.format(new Date(value))
}

function DifficultyTag({
  difficulty,
}: {
  difficulty: PerformanceDifficulty | null
}) {
  if (!difficulty) return null
  return (
    <span className="inline-block rounded bg-muted px-1.5 text-xs leading-5 text-muted-foreground">
      {difficultyLabels[difficulty]}
    </span>
  )
}

export function PerformanceSummaryView({
  summary,
  workspaceId,
}: {
  summary: PerformanceSummary
  workspaceId: string
}) {
  const showCallType =
    new Set(summary.skills.map((skill) => skill.callType)).size > 1
  return (
    <div className="space-y-10 sm:space-y-12">
      <Overview summary={summary} />
      <FocusSection focus={summary.focus} workspaceId={workspaceId} />
      {summary.strengths.length ? (
        <Section id="strengths-heading" title="Điểm mạnh">
          <ul className="space-y-3">
            {summary.strengths.map((item) => (
              <li key={item.id} className="flex gap-3 text-sm leading-6">
                <Check
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0 text-brand"
                />
                <span>
                  {item.ruleDescription}{' '}
                  <span className="text-muted-foreground">
                    · {item.competencyName}
                    {showCallType
                      ? ` · ${callTypes[item.callType]}`
                      : ''} · {item.sessions} phiên
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <SkillsSection skills={summary.skills} showCallType={showCallType} />
      <OutcomesSection outcomes={summary.outcomes} />
      <footer className="border-t border-border pt-5 text-xs leading-6 text-muted-foreground">
        <p>
          Chỉ gồm các phiên đã hoàn thành của bạn trong không gian làm việc này.
          Đây là kết quả luyện tập mô phỏng, không phải kết luận về năng lực
          trong mọi tình huống.
        </p>
        <Link
          to="/practice/history"
          className={`${linkClass} mt-3 inline-flex min-h-11 items-center gap-2 text-[13px]`}
        >
          Xem toàn bộ lịch sử phiên luyện{' '}
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      </footer>
    </div>
  )
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id}>
      <div className="mb-5">
        <h2
          id={id}
          className="text-[24px] font-normal leading-relaxed tracking-tight sm:text-[26px]"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-3xl text-[13px] leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function Overview({ summary }: { summary: PerformanceSummary }) {
  const { activity } = summary
  const { objective } = activity
  return (
    <section aria-label="Tổng quan">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-3">
        <Stat
          label="Phiên hoàn thành"
          value={activity.completedSessions}
          note={
            activity.awaitingEvaluation
              ? `${activity.awaitingEvaluation} phiên chưa có đánh giá`
              : undefined
          }
        />
        <Stat
          label="Phút luyện tập"
          value={numberFormatter.format(activity.practiceMinutes)}
        />
        <Stat
          label="Đạt mục tiêu cuộc gọi"
          value={
            objective.assessed
              ? `${objective.achieved}/${objective.assessed}`
              : '–'
          }
          note={
            objective.partiallyAchieved
              ? `${objective.partiallyAchieved} phiên đạt một phần`
              : objective.assessed
                ? undefined
                : 'Chưa có phiên được đánh giá mục tiêu'
          }
        />
      </dl>
      {activity.awaitingEvaluation > 0 ? (
        <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
          <Link to="/practice/history" className={linkClass}>
            Mở lịch sử để thử đánh giá lại các phiên chưa có kết quả
          </Link>
          .
        </p>
      ) : null}
      {summary.historicalContextCount > 0 ? (
        <p className="mt-2 text-[13px] leading-6 text-warning">
          {summary.historicalContextCount} phiên không còn bài luyện gốc nên chỉ
          được tính trong điểm từng kỹ năng.
        </p>
      ) : null}
    </section>
  )
}

function Stat({
  label,
  value,
  note,
}: {
  label: string
  value: string | number
  note?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium leading-5 text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-2 text-[34px] font-normal tabular-nums">{value}</dd>
      {note ? (
        <dd className="mt-1 text-xs leading-5 text-muted-foreground">{note}</dd>
      ) : null}
    </div>
  )
}

function FocusSection({
  focus,
  workspaceId,
}: {
  focus: PerformanceFocus[]
  workspaceId: string
}) {
  return (
    <Section
      id="focus-heading"
      title="Điều cần tập trung"
      description="Điểm cần cải thiện lặp lại qua các phiên, ưu tiên những điểm thường là “Điểm cần nhớ” sau mỗi phiên."
    >
      {focus.length ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {focus.map((item, index) => (
            <article
              key={item.id}
              className={
                index === 0
                  ? 'min-w-0 rounded-[18px] bg-brand-gradient p-5 sm:p-7 lg:col-span-2'
                  : 'min-w-0 border-t border-border pt-5'
              }
            >
              <p className="text-xs font-medium uppercase leading-5 tracking-wide text-brand">
                {item.competencyName} · {callTypes[item.callType]}
              </p>
              <h3
                className={`mt-3 font-normal leading-relaxed ${index === 0 ? 'text-2xl' : 'text-lg'}`}
              >
                {item.ruleDescription}
              </h3>
              <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
                {item.critical ? (
                  <span className="text-destructive">Lỗi nghiêm trọng · </span>
                ) : null}
                Gặp trong {item.sessions} phiên
                {item.keyPointSessions
                  ? ` · là điểm cần nhớ của ${item.keyPointSessions} phiên`
                  : ''}
              </p>
              <Example example={item.example} />
              {item.practice ? (
                <StartPracticeButton
                  practiceId={item.practice.id}
                  label={`Luyện lại: ${item.practice.title} · ${difficultyLabels[item.practice.difficulty]}`}
                  workspaceId={workspaceId}
                  primary={index === 0}
                />
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          Chưa có điểm cần cải thiện lặp lại. Hoàn thành thêm phiên luyện để
          thấy xu hướng.
        </p>
      )}
    </Section>
  )
}

function Example({ example }: { example: PerformanceExample }) {
  return (
    <div className="mt-4 text-sm leading-6">
      <p>{example.rationale}</p>
      {example.turn ? (
        <blockquote className="mt-2 line-clamp-3 border-l-2 border-border pl-3 text-[13px] text-muted-foreground">
          “{example.turn.quote}”
        </blockquote>
      ) : null}
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Link
          to="/practice/session/$sessionId"
          params={{ sessionId: example.sessionId }}
          hash={
            example.turn
              ? `transcript-turn-${example.turn.sequence}`
              : undefined
          }
          className={linkClass}
        >
          {example.turn ? `Lượt ${example.turn.displayNumber} · ` : ''}
          {example.practiceTitle}
        </Link>
        <DifficultyTag difficulty={example.difficulty} />
        <span>{formatDate(example.completedAt)}</span>
      </p>
    </div>
  )
}

function SkillsSection({
  skills,
  showCallType,
}: {
  skills: PerformanceSkill[]
  showCallType: boolean
}) {
  return (
    <Section
      id="skills-heading"
      title="Theo từng kỹ năng"
      description="Điểm mỗi phiên tính theo số hành vi bạn thể hiện đạt yêu cầu, không phân biệt thứ tự."
    >
      {skills.length ? (
        <div className="border-t border-border">
          {skills.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              showCallType={showCallType}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          Chưa có phiên được đánh giá trong khoảng thời gian này.
        </p>
      )}
    </Section>
  )
}

function SkillRow({
  skill,
  showCallType,
}: {
  skill: PerformanceSkill
  showCallType: boolean
}) {
  const latest = skill.points.at(-1)
  const recent = skill.points.slice(-12)
  return (
    <details className="group/skill border-b border-border">
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-base font-normal">
            {skill.name}
            {showCallType || !skill.callType ? (
              <span className="text-muted-foreground">
                {' '}
                ·{' '}
                {skill.callType
                  ? callTypes[skill.callType]
                  : 'Chưa xác định bối cảnh'}
              </span>
            ) : null}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Được chấm trong {skill.assessedSessions}/{skill.totalSessions} phiên
          </span>
        </span>
        <Sparkline points={recent} />
        <span className="text-right text-xl font-normal tabular-nums text-brand">
          {latest ? `${numberFormatter.format(latest.score)}` : '–'}
          <span className="block text-xs text-muted-foreground">
            {latest ? 'gần nhất' : 'chưa chấm'}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="hidden size-5 shrink-0 text-muted-foreground group-open/skill:rotate-180 sm:block"
        />
      </summary>
      <div className="grid gap-8 pb-6 lg:grid-cols-2">
        {skill.assessedSessions ? (
          <>
            <div>
              <h3 className="text-[13px] font-medium text-brand">
                Hành vi đạt yêu cầu
              </h3>
              <ul className="mt-3 space-y-3">
                {skill.behaviors.map((behavior) => (
                  <li key={`${behavior.id}-${behavior.description}`}>
                    <div className="flex items-baseline justify-between gap-3 text-sm leading-6">
                      <span>{behavior.description}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {behavior.demonstrated}/{behavior.sessions} phiên
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted">
                      <div
                        className="h-1.5 rounded-full bg-brand"
                        style={{
                          width: `${(behavior.demonstrated / behavior.sessions) * 100}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-[13px] font-medium text-brand">
                Điểm từng phiên
              </h3>
              <ol className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-2">
                {[...skill.points].reverse().map((point) => (
                  <li
                    key={point.sessionId}
                    className="flex items-baseline justify-between gap-3 border-t border-border pt-2 text-sm"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        to="/practice/session/$sessionId"
                        params={{ sessionId: point.sessionId }}
                        className={linkClass}
                      >
                        {point.practiceTitle}
                      </Link>
                      <DifficultyTag difficulty={point.difficulty} />
                      <span className="text-xs text-muted-foreground">
                        {formatDate(point.completedAt)}
                        {point.missed ? ' · bỏ lỡ cơ hội' : ''}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {numberFormatter.format(point.score)}/100
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            Kỹ năng này chưa có cơ hội thể hiện trong {skill.totalSessions}{' '}
            phiên. Đây không phải điểm thấp.
          </p>
        )}
      </div>
    </details>
  )
}

function Sparkline({ points }: { points: PerformanceSkill['points'] }) {
  if (points.length < 2) return <span className="hidden sm:block" />
  return (
    <span
      role="img"
      aria-label={`Điểm ${points.length} phiên gần nhất: ${points.map((point) => point.score).join(', ')}`}
      className="col-span-2 row-start-2 flex h-8 items-end gap-0.5 sm:col-span-1 sm:row-auto"
    >
      {points.map((point) => (
        <span
          key={point.sessionId}
          className={`w-1.5 rounded-t ${point.missed ? 'bg-warning-border' : 'bg-brand'}`}
          style={{ height: Math.max(2, point.score * 0.32) }}
        />
      ))}
    </span>
  )
}

function OutcomesSection({
  outcomes,
}: {
  outcomes: PerformanceSummary['outcomes']
}) {
  if (!outcomes.objections.length && !outcomes.insights.total) return null
  return (
    <Section
      id="outcomes-heading"
      title="Phản đối và thông tin khách"
      description="Tính trên phản đối khách thực sự nêu và thông tin khách chưa nói ra trong các phiên."
    >
      <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 xl:grid-cols-3">
        {outcomes.objections.map((rate) => (
          <div key={rate.category ?? 'unknown'}>
            <dt className="text-muted-foreground">
              {rate.category
                ? (objectionLabels[rate.category] ?? rate.category)
                : 'Phản đối khác'}
            </dt>
            <dd className="mt-1">
              <span className="text-xl tabular-nums">
                {rate.handled}/{rate.raised}
              </span>{' '}
              đã xử lý
              {rate.partiallyHandled
                ? ` · ${rate.partiallyHandled} xử lý một phần`
                : ''}
            </dd>
          </div>
        ))}
        {outcomes.insights.total ? (
          <div>
            <dt className="text-muted-foreground">
              Thông tin khách chưa nói ra
            </dt>
            <dd className="mt-1">
              <span className="text-xl tabular-nums">
                {outcomes.insights.discovered}/{outcomes.insights.total}
              </span>{' '}
              đã khai thác
            </dd>
          </div>
        ) : null}
      </dl>
    </Section>
  )
}

function StartPracticeButton({
  practiceId,
  label,
  workspaceId,
  primary,
}: {
  practiceId: string
  label: string
  workspaceId: string
  primary: boolean
}) {
  const navigate = useNavigate()
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
          'x-workspace-id': workspaceId,
        },
        body: JSON.stringify({ practiceId }),
      })
      if (!response.ok)
        throw new Error('Không thể mở bài luyện. Vui lòng thử lại.')
      const data = (await response.json()) as { sessionId: string }
      await navigate({
        to: '/practice/session/$sessionId',
        params: { sessionId: data.sessionId },
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Không thể mở bài luyện. Vui lòng thử lại.',
      )
      setStarting(false)
    }
  }
  return (
    <div className="mt-5">
      <Button
        type="button"
        disabled={starting}
        onClick={() => void start()}
        variant={primary ? 'default' : 'ghost'}
        className={`min-h-11 rounded-lg text-[13px] ${primary ? 'w-full px-5 sm:w-auto' : 'h-auto whitespace-normal px-0 text-left text-brand hover:bg-transparent hover:text-brand-hover'}`}
      >
        {starting ? 'Đang mở bài luyện…' : label}{' '}
        <ArrowUpRight aria-hidden="true" />
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-xs leading-5 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
