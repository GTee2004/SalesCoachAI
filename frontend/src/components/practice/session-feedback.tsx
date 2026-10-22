import { createContext, useContext } from 'react'
import { transcriptDisplayNumbers } from '#/lib/voice/transcript-numbering'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '#/components/ui/accordion'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import type { BehavioralFinding, EvaluationEvidence } from '#/db/schema'
import type {
  CompetencyFeedback,
  FeedbackStatement,
  PracticeFeedbackResult,
} from '#/lib/voice/contracts'

type ReadyFeedback = Extract<PracticeFeedbackResult, { state: 'ready' }>
type TranscriptTurn = { sequence?: number; role?: 'user' | 'assistant' }

const TranscriptDisplayNumbers = createContext(new Map<number, number>())
export function SessionFeedback({
  feedback,
  onRetry,
  reference,
  objective,
  transcript,
}: {
  feedback: PracticeFeedbackResult
  onRetry: () => void
  reference?: ReactNode
  objective?: string
  transcript: readonly TranscriptTurn[]
}) {
  const ready = feedback.state === 'ready' ? feedback : null
  const keyFindingIds = new Set(ready?.keyCoachingPoint?.findingIds ?? [])
  return (
    <TranscriptDisplayNumbers.Provider
      value={transcriptDisplayNumbers(transcript)}
    >
      <section
        aria-label="Phản hồi sau phiên"
        className="grid min-w-0 items-start gap-6 font-sans font-normal lg:grid-cols-[minmax(0,1fr)_344px]"
      >
        <Card className="min-w-0 gap-0 rounded-2xl border-0 bg-secondary py-0 shadow-none ring-0">
          <CardContent className="block space-y-5 p-6 text-[15px] leading-6 text-foreground">
            {ready ? (
              <>
                <ScoreSummary feedback={ready} />
                <CallOutcome
                  feedback={ready}
                  objective={objective}
                  transcript={transcript}
                />
              </>
            ) : feedback.state === 'failed' ? (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-3 text-destructive"
              >
                <AlertTriangle size={18} className="shrink-0" />
                <p className="min-w-0 flex-1">
                  Chưa thể tạo phản hồi. Bản ghi vẫn được lưu và có thể đánh giá
                  lại.
                </p>
                <Button type="button" variant="outline" onClick={onRetry}>
                  Thử đánh giá lại
                </Button>
              </div>
            ) : feedback.state === 'pending' ? (
              <div role="status" className="flex items-center gap-3">
                <LoaderCircle className="shrink-0 animate-spin" size={18} />
                Đang tổng hợp phản hồi dựa trên hội thoại…
              </div>
            ) : (
              <div className="space-y-3">
                <p>
                  Chưa có phản hồi cho phiên này. Bản ghi hội thoại vẫn có thể
                  xem và tải xuống.
                </p>
                <Button type="button" variant="outline" onClick={onRetry}>
                  Thử đánh giá lại
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        {reference && (
          <aside
            aria-label="Hội thoại và thông tin tình huống"
            className="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-start-1 lg:row-span-2"
          >
            {reference}
          </aside>
        )}
        {ready && (
          <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-2">
            {ready.keyCoachingPoint && (
              <Card className="gap-0 rounded-lg border-0 bg-warm py-0 shadow-none ring-0">
                <CardContent className="block p-6">
                  <h2 className="text-xl font-normal text-foreground">
                    Điểm cần nhớ
                  </h2>
                  <div className="mt-3 text-sm leading-6 text-foreground">
                    <LinkedStatement statement={ready.keyCoachingPoint} />
                  </div>
                </CardContent>
              </Card>
            )}
            <FeedbackLists
              strengths={ready.strengths}
              improvements={ready.improvements.filter(
                (item) => !item.findingIds.some((id) => keyFindingIds.has(id)),
              )}
            />
            {ready.competencyScores.length > 0 && (
              <CompetencyDetails competencies={ready.competencyScores} />
            )}
          </div>
        )}
      </section>
    </TranscriptDisplayNumbers.Provider>
  )
}

function ScoreSummary({ feedback }: { feedback: ReadyFeedback }) {
  const scored = feedback.competencyScores.filter(
    (item) => item.assessmentStatus !== 'not_assessed',
  )
  const unscored = feedback.competencyScores.filter(
    (item) => item.assessmentStatus === 'not_assessed',
  )
  const { assessedCount, totalCount } = feedback.assessmentCoverage
  return (
    <div className="space-y-4">
      {feedback.overallScore !== null ? (
        <div className="space-y-1">
          <div className="text-[40px] font-normal leading-tight tracking-tight">
            {feedback.overallScore} / 100
          </div>
          <p className="text-sm">
            {assessedCount < totalCount
              ? `Trung bình theo trọng số của ${assessedCount}/${totalCount} kỹ năng đã chấm`
              : `Điểm tổng của cả ${totalCount} kỹ năng`}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <h2 className="text-xl font-normal">
            Chưa đủ bằng chứng để chấm điểm
          </h2>
          <p className="text-sm">
            Cuộc gọi chưa tạo cơ hội để thể hiện kỹ năng nào trong bảng điểm.
          </p>
        </div>
      )}
      {scored.length > 0 && (
        <ul className="divide-y divide-border border-y border-border text-sm">
          {scored.map((item) => (
            <li
              key={item.code}
              className="flex items-baseline justify-between gap-3 py-2"
            >
              <span>
                {item.name}
                {item.assessmentStatus === 'opportunity_missed' && (
                  <span className="text-muted-foreground"> · bỏ lỡ cơ hội</span>
                )}
              </span>
              <span className="font-numeric tabular-nums">{item.score}</span>
            </li>
          ))}
        </ul>
      )}
      {unscored.length > 0 && (
        <p className="text-[13px] leading-5 text-muted-foreground">
          Chưa tính: {unscored.map((item) => item.name).join(', ')} — chưa có cơ
          hội thể hiện trong cuộc gọi này.
        </p>
      )}
    </div>
  )
}

const objectiveLabels = {
  achieved: 'ĐÃ ĐẠT',
  partially_achieved: 'ĐẠT MỘT PHẦN',
  not_achieved: 'CHƯA ĐẠT',
}

const handlingLabels = {
  handled: { label: 'Đã xử lý', className: 'text-brand' },
  partially_handled: { label: 'Xử lý một phần', className: 'text-warning' },
  not_handled: { label: 'Chưa xử lý', className: 'text-destructive' },
}

function CallOutcome({
  feedback,
  objective,
  transcript,
}: {
  feedback: ReadyFeedback
  objective?: string
  transcript: readonly TranscriptTurn[]
}) {
  const roles = new Map(
    transcript.flatMap((turn): [number, string][] =>
      turn.sequence != null && turn.role ? [[turn.sequence, turn.role]] : [],
    ),
  )
  const raised = feedback.objectionOutcomes.filter((item) => item.raised)
  const discovered = feedback.discoveredInsightKeys.length
  const missed = feedback.missedInsightKeys.length
  const showObjective = Boolean(objective || feedback.objectiveOutcome)
  if (!showObjective && !raised.length && !discovered && !missed) return null
  return (
    <div className="space-y-5 border-t border-border pt-5 text-sm">
      {showObjective && (
        <div>
          <h2 className="text-xs font-normal text-brand">
            MỤC TIÊU CUỘC GỌI
            {feedback.objectiveOutcome
              ? ` · ${objectiveLabels[feedback.objectiveOutcome]}`
              : ''}
          </h2>
          {objective && <p className="mt-1">{objective}</p>}
          <EvidenceList evidence={feedback.objectiveEvidence} />
        </div>
      )}
      {raised.length > 0 && (
        <div>
          <h2 className="text-xs font-normal text-brand">PHẢN ĐỐI CỦA KHÁCH</h2>
          <ul className="mt-2 space-y-3">
            {raised.map((outcome) => {
              const handling = handlingLabels[outcome.handling ?? 'not_handled']
              const buyerTurn =
                outcome.evidence.find(
                  (item) => roles.get(item.turnNumber) === 'assistant',
                ) ?? outcome.evidence.at(0)
              return (
                <li key={outcome.key}>
                  <p className={handling.className}>{handling.label}</p>
                  {buyerTurn && <EvidenceList evidence={[buyerTurn]} />}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {discovered + missed > 0 && (
        <div>
          <h2 className="text-xs font-normal text-brand">
            THÔNG TIN KHÁCH CHƯA NÓI RA · ĐÃ KHAI THÁC {discovered}/
            {discovered + missed}
          </h2>
          {missed > 0 && (
            <p className="mt-1">
              Khách còn {missed} điều chưa chia sẻ. Đặt câu hỏi mở và hỏi tiếp
              theo câu trả lời để khách nói ra.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function FeedbackLists({
  strengths,
  improvements,
}: {
  strengths: FeedbackStatement[]
  improvements: FeedbackStatement[]
}) {
  if (!strengths.length && !improvements.length) return null
  return (
    <Card className="gap-0 rounded-lg border border-border bg-background py-0 shadow-none ring-0">
      <CardContent className="block space-y-6 p-6">
        {strengths.length > 0 && (
          <StatementList title="Điểm làm tốt" items={strengths} />
        )}
        {improvements.length > 0 && (
          <StatementList title="Có thể cải thiện thêm" items={improvements} />
        )}
      </CardContent>
    </Card>
  )
}

function StatementList({
  title,
  items,
}: {
  title: string
  items: FeedbackStatement[]
}) {
  return (
    <div>
      <h2 className="text-xl font-normal text-foreground">{title}</h2>
      <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-6 text-foreground">
        {items.map((item, i) => (
          <li key={i}>
            <LinkedStatement statement={item} />
          </li>
        ))}
      </ol>
    </div>
  )
}

function CompetencyDetails({
  competencies,
}: {
  competencies: CompetencyFeedback[]
}) {
  return (
    <Card className="min-w-0 gap-0 rounded-lg border border-border bg-background py-0 shadow-none ring-0">
      <CardContent className="block p-6">
        <h2 className="text-[23px] font-normal leading-8 text-foreground">
          Chi tiết theo kỹ năng
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
          Điểm mỗi kỹ năng tính theo số hành vi bạn thể hiện đạt yêu cầu, không
          phân biệt thứ tự. Lỗi nghiêm trọng giới hạn điểm tối đa.
        </p>
        <Accordion multiple className="mt-4">
          {competencies.map((item) => (
            <AccordionItem
              key={item.code}
              value={item.code}
              className="border-t border-border"
            >
              <AccordionTrigger className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-4 font-normal hover:no-underline sm:flex">
                <span className="min-w-0 flex-1 text-[15px] font-normal leading-6 text-foreground">
                  {item.name}
                </span>
                <span className="col-start-1 row-start-2 w-fit shrink-0 text-sm font-normal text-brand sm:row-auto">
                  {item.assessmentStatus === 'not_assessed'
                    ? 'Chưa chấm'
                    : `${item.score}/100`}
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-4 text-sm leading-6 text-foreground [&_a]:hover:text-brand-hover">
                {item.assessmentStatus === 'not_assessed' ? (
                  <p className="text-muted-foreground">
                    Chưa có cơ hội thể hiện kỹ năng này trong cuộc gọi nên không
                    tính vào điểm.
                  </p>
                ) : (
                  <CompetencyBreakdown competency={item} />
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  )
}

const behaviorStatus = {
  demonstrated: { label: 'Đạt', className: 'bg-secondary text-brand' },
  attempted: { label: 'Chưa đạt', className: 'bg-warning-bg text-warning' },
  opportunity_missed: {
    label: 'Bỏ lỡ',
    className: 'bg-destructive-subtle text-destructive',
  },
  none: {
    label: 'Chưa thấy',
    className: 'bg-muted text-muted-foreground',
  },
}

function CompetencyBreakdown({
  competency,
}: {
  competency: CompetencyFeedback
}) {
  const explanation = competency.scoreExplanation
  const rubric = competency.scoringRubric
  const criticalFindings = competency.findings.filter(
    (finding) => finding.kind === 'critical_error',
  )
  return (
    <>
      {explanation && (
        <p>
          Đạt{' '}
          <span className="text-brand">
            {
              new Set(
                competency.findings
                  .filter((finding) => finding.kind === 'demonstrated')
                  .map((finding) => finding.behaviorId),
              ).size
            }
            /{rubric.behaviors.length} hành vi
          </span>
          {competency.score !== explanation.baseScore &&
            ` · giảm từ ${explanation.baseScore} do lỗi nghiêm trọng`}
        </p>
      )}
      <ul className="space-y-4">
        {rubric.behaviors.map((behavior) => {
          const findings = competency.findings.filter(
            (finding) => finding.behaviorId === behavior.id,
          )
          const kinds = new Set(findings.map((finding) => finding.kind))
          const status = kinds.has('demonstrated')
            ? behaviorStatus.demonstrated
            : kinds.has('attempted')
              ? behaviorStatus.attempted
              : kinds.has('opportunity_missed')
                ? behaviorStatus.opportunity_missed
                : behaviorStatus.none
          return (
            <li key={behavior.id} className="space-y-2">
              <p>
                <span
                  className={`mr-2 inline-block rounded px-1.5 text-xs leading-5 ${status.className}`}
                >
                  {status.label}
                </span>
                {behavior.description}
              </p>
              {findings.map((finding) => (
                <FindingDetail key={finding.id} finding={finding} />
              ))}
            </li>
          )
        })}
      </ul>
      {criticalFindings.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-normal text-destructive">
            LỖI NGHIÊM TRỌNG
          </h3>
          {criticalFindings.map((finding) => {
            const rule = rubric.criticalErrors.find(
              (item) => item.id === finding.criticalErrorId,
            )
            return (
              <div key={finding.id} className="space-y-2">
                {rule && (
                  <p>
                    {rule.description}{' '}
                    <span className="text-destructive">
                      (tối đa {rule.scoreCap}/100)
                    </span>
                  </p>
                )}
                <FindingDetail finding={finding} />
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function FindingDetail({ finding }: { finding: BehavioralFinding }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <p>{finding.rationale}</p>
      <EvidenceList
        evidence={finding.evidence}
        labelFor={(turnNumber) =>
          finding.opportunityTurnNumbers.includes(turnNumber)
            ? 'Cơ hội'
            : finding.responseTurnNumbers.includes(turnNumber)
              ? 'Phản hồi của bạn'
              : null
        }
      />
    </div>
  )
}

function LinkedStatement({ statement }: { statement: FeedbackStatement }) {
  return (
    <div className="space-y-1">
      <p>{statement.text}</p>
      <TurnLinks turnNumbers={statement.turnNumbers} />
    </div>
  )
}

function TurnLinks({ turnNumbers }: { turnNumbers: number[] }) {
  const displayNumbers = useContext(TranscriptDisplayNumbers)
  if (!turnNumbers.length) return null
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
      {turnNumbers.map((turnNumber) => (
        <a
          key={turnNumber}
          href={`#transcript-turn-${turnNumber}`}
          className="font-normal text-brand underline underline-offset-2 hover:text-brand-hover"
          aria-label={
            displayNumbers.has(turnNumber)
              ? `Xem lượt ${displayNumbers.get(turnNumber)} trong hội thoại`
              : 'Xem đoạn hội thoại được trích dẫn'
          }
        >
          {displayNumbers.has(turnNumber)
            ? `Lượt ${displayNumbers.get(turnNumber)}`
            : 'Đoạn hội thoại'}
        </a>
      ))}
    </span>
  )
}

function EvidenceList({
  evidence,
  labelFor,
}: {
  evidence: EvaluationEvidence[]
  labelFor?: (turnNumber: number) => string | null
}) {
  if (!evidence.length) return null
  return (
    <ul className="mt-2 space-y-2 text-[13px] leading-6">
      {evidence.map((item, index) => {
        const label = labelFor?.(item.turnNumber)
        return (
          <li key={index}>
            <TurnLinks turnNumbers={[item.turnNumber]} />
            {label && <span className="text-muted-foreground"> · {label}</span>}
            <span>: {item.observation}</span>
            {item.quote && (
              <blockquote className="mt-1 border-l-2 border-border pl-3">
                “{item.quote}”
              </blockquote>
            )}
          </li>
        )
      })}
    </ul>
  )
}
