import { CallTypeBadge, callTypes } from '#/components/practice/call-type-badge'
import { Badge } from '#/components/ui/badge'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '#/components/ui/responsive-modal'
import { StatusPill } from '#/components/admin/panel'
import {
  describeChange,
  formatCount,
  formatDayAndClock,
  formatDecimal,
} from '#/lib/admin/format'
import { workspaceRoleLabels } from '#/lib/auth/workspace-roles'
import { discoveryRate } from '#/lib/workspace/performance'
import type {
  TeamAdvanced,
  TeamCompetencyColumn,
  TeamMember,
  TeamMemberAdvanced,
  TeamRecentSession,
  TeamView,
} from '#/lib/workspace/performance'
import { ObjectionBreakdown } from './objection-breakdown'
import {
  callTypeLabels,
  difficultyLabels,
  MemberStatusPill,
  outcomeLabels,
  relativeDay,
  scoreBand,
  scoreFill,
  statusDetail,
} from './shared'

/** Oldest to newest, so the line reads left to right as time passes. */
function ScoreTrend({ sessions }: { sessions: TeamRecentSession[] }) {
  const scores = sessions
    .flatMap((session) => (session.score === null ? [] : [session.score]))
    .reverse()
  if (scores.length < 2) return null
  const points = scores
    .map(
      (score, index) =>
        `${(index / (scores.length - 1)) * 100},${40 - (score / 100) * 40}`,
    )
    .join(' ')
  return (
    <div className="mt-3">
      <svg
        role="img"
        aria-label={`Điểm ${scores.length} phiên gần nhất, từ cũ đến mới: ${scores.join(', ')}`}
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-10 w-full overflow-visible"
      >
        <polyline
          points={points}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>Cũ hơn</span>
        <span>Mới nhất</span>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: string | null
}) {
  return (
    <div className="min-w-0 rounded-[10px] bg-muted p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-medium tabular-nums">{value}</p>
      {note ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
      ) : null}
    </div>
  )
}

function AdvancedSections({
  deep,
  advanced,
  competencies,
}: {
  deep: TeamMemberAdvanced | null
  advanced: TeamAdvanced | null
  competencies: TeamCompetencyColumn[]
}) {
  if (!deep || !advanced)
    return (
      <p role="status" className="mt-6 text-[13px] text-muted-foreground">
        Đang tải dữ liệu nâng cao…
      </p>
    )
  const own = discoveryRate(deep.discovery)
  const team = discoveryRate(advanced.discovery)
  const next = deep.nextPractice
  const nextCompetency = next?.competencyCode
    ? (competencies.find((column) => column.code === next.competencyCode)
        ?.name ?? next.competencyCode)
    : null
  return (
    <>
      <section aria-labelledby="member-discovery" className="mt-6">
        <h3 id="member-discovery" className="text-sm font-medium">
          Khám phá nhu cầu ẩn
        </h3>
        {own === null ? (
          <p className="mt-3 text-[13px] text-muted-foreground">
            Chưa có phiên nào được chấm trong kỳ này.
          </p>
        ) : (
          <p className="mt-3 text-[13px] leading-[1.6]">
            <b className="text-lg font-medium tabular-nums">
              {formatDecimal(own)}%
            </b>{' '}
            <span className="text-muted-foreground">
              ({formatCount(deep.discovery.discovered)}/
              {formatCount(deep.discovery.discovered + deep.discovery.missed)}{' '}
              điều khách giấu
              {team === null ? '' : `, trung bình nhóm ${formatDecimal(team)}%`}
              )
            </span>
          </p>
        )}
      </section>

      <section aria-labelledby="member-objections" className="mt-6">
        <h3 id="member-objections" className="text-sm font-medium">
          Xử lý phản đối
        </h3>
        <div className="mt-3">
          <ObjectionBreakdown objections={deep.objections} subject="member" />
        </div>
      </section>

      <section aria-labelledby="member-mix" className="mt-6">
        <h3 id="member-mix" className="text-sm font-medium">
          Cơ cấu luyện tập trong kỳ
        </h3>
        {deep.mix.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted-foreground">
            Chưa luyện tập trong kỳ này.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {deep.mix.map((item) => (
              <li
                key={`${item.callType}:${item.difficulty}`}
                className="rounded-[7px] bg-muted px-2.5 py-1 text-xs"
              >
                {callTypeLabels[item.callType]} ·{' '}
                {difficultyLabels[item.difficulty]}
                <b className="ml-1.5 font-medium tabular-nums">
                  {formatCount(item.sessions)}
                </b>
              </li>
            ))}
          </ul>
        )}
      </section>

      {next && (
        <section aria-labelledby="member-next" className="mt-6">
          <h3 id="member-next" className="text-sm font-medium">
            AI gợi ý luyện tiếp
          </h3>
          <div className="mt-3 rounded-[10px] bg-muted p-3 text-[13px] leading-[1.6]">
            <p>{next.reason}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {[
                nextCompetency,
                next.practiceType ? callTypeLabels[next.practiceType] : null,
                next.suggestedPracticeTitle,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </section>
      )}
    </>
  )
}

export function MemberDetailModal({
  member,
  competencies,
  view,
  advanced,
  onClose,
}: {
  member: TeamMember | null
  competencies: TeamCompetencyColumn[]
  view: TeamView
  /** Null while the advanced numbers are still loading. */
  advanced: TeamAdvanced | null
  onClose: () => void
}) {
  // Weakest first: that is what a manager coaches on.
  const assessed = member
    ? competencies
        .flatMap((column) => {
          const score = member.mastery[column.id]
          return score === null ? [] : [{ ...column, score }]
        })
        .sort((a, b) => a.score - b.score)
    : []
  const scoreChange = member
    ? describeChange(
        member.averageScore,
        member.previousAverageScore,
        'points',
        ' điểm',
      )
    : null
  const detail = member ? statusDetail(member) : null
  const deep = member ? (advanced?.members[member.userId] ?? null) : null
  const coaching = member
    ? member.recentSessions
        .filter((session) => session.coachingPoint)
        .slice(0, 3)
    : []

  return (
    <ResponsiveModal
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ResponsiveModalContent className="border-border bg-background p-6 font-sans text-foreground shadow-[0_6px_24px_var(--shadow-ink)] sm:p-7 lg:w-full lg:max-w-xl">
        {member && (
          <>
            <ResponsiveModalHeader className="space-y-2 text-left">
              <ResponsiveModalTitle className="flex flex-wrap items-center gap-3 pr-6 text-[23px] font-normal leading-[1.4]">
                {member.name}
                <Badge variant="secondary">
                  {workspaceRoleLabels[member.role]}
                </Badge>
              </ResponsiveModalTitle>
              <ResponsiveModalDescription className="text-[13px] leading-[1.6]">
                {member.email}
              </ResponsiveModalDescription>
            </ResponsiveModalHeader>

            <div className="mt-5 flex flex-col gap-2">
              <div>
                <MemberStatusPill status={member.status} />
              </div>
              {detail && (
                <p className="text-[13px] leading-[1.6] text-muted-foreground">
                  {detail}
                </p>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Stat
                label="Phiên luyện tập"
                value={formatCount(member.sessions)}
                note={`${formatCount(member.previousSessions)} ở kỳ trước`}
              />
              <Stat
                label="Điểm trung bình"
                value={
                  member.averageScore === null
                    ? '–'
                    : formatDecimal(member.averageScore)
                }
                note={scoreChange ? scoreChange.text : null}
              />
              <Stat
                label="Đạt mục tiêu buổi gọi"
                value={
                  member.objectiveAchievedRate === null
                    ? '–'
                    : `${formatDecimal(member.objectiveAchievedRate)}%`
                }
              />
              <Stat
                label="Luyện tập gần nhất"
                value={relativeDay(member.lastPracticedAt)}
                note={`Truy cập gần nhất: ${relativeDay(member.lastActiveDate).toLowerCase()}`}
              />
            </div>

            <section aria-labelledby="member-mastery" className="mt-6">
              <h3 id="member-mastery" className="text-sm font-medium">
                Kỹ năng (yếu nhất trước)
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Điểm gần nhất trong kỳ đang chọn, tách riêng gọi lần đầu và gọi
                lại.
              </p>
              {assessed.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted-foreground">
                  Chưa có kỹ năng nào được chấm trong kỳ này.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {assessed.map((item) => {
                    const band = scoreBand(item.score)
                    const sessions = member.masteryEvidence[item.id]
                    const team =
                      item.teamAverage === null
                        ? null
                        : Math.round(item.teamAverage)
                    return (
                      <li key={item.id}>
                        <div className="flex items-baseline justify-between gap-3 text-[13px]">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate">{item.name}</span>
                            <CallTypeBadge type={item.callType} />
                          </span>
                          <span className="shrink-0 tabular-nums">
                            <b className="font-medium">{item.score}</b>
                            <span className="text-muted-foreground">/100</span>
                          </span>
                        </div>
                        <div className="relative mt-1.5">
                          <div
                            role="img"
                            aria-label={`${item.name} (${callTypes[item.callType].vietnamese}): ${item.score}/100, ${band.label}${team === null ? '' : `, trung bình nhóm ${team}`}`}
                            className="h-2 overflow-hidden rounded-full bg-muted"
                          >
                            <div
                              className={`h-full rounded-full ${scoreFill(item.score)}`}
                              style={{ width: `${item.score}%` }}
                            />
                          </div>
                          {team !== null && (
                            <span
                              aria-hidden="true"
                              className="absolute -top-0.5 h-3 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
                              style={{ left: `${team}%` }}
                            />
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {team === null
                            ? null
                            : `Trung bình nhóm ${team}${item.score >= team ? '' : ` · thấp hơn ${team - item.score}`} · `}
                          {sessions
                            ? `chấm trong ${formatCount(sessions)} phiên của kỳ`
                            : 'chưa có phiên nào được ghi nhận'}
                          {sessions === 1
                            ? ', nên chỉ mang tính tham khảo'
                            : ''}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {view === 'advanced' && (
              <AdvancedSections
                deep={deep}
                advanced={advanced}
                competencies={competencies}
              />
            )}

            {coaching.length > 0 && (
              <section aria-labelledby="member-coaching" className="mt-6">
                <h3 id="member-coaching" className="text-sm font-medium">
                  Điểm cần kèm cặp gần đây
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Lời khuyên chính mà AI để lại sau mỗi phiên.
                </p>
                <ul className="mt-3 space-y-3">
                  {coaching.map((session) => (
                    <li
                      key={session.sessionId}
                      className="rounded-[10px] bg-muted p-3 text-[13px] leading-[1.6]"
                    >
                      <p>{session.coachingPoint}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {session.practiceTitle} ·{' '}
                        {relativeDay(session.completedAt).toLowerCase()}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="member-sessions" className="mt-6">
              <h3 id="member-sessions" className="text-sm font-medium">
                Các phiên gần đây
              </h3>
              {member.recentSessions.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted-foreground">
                  Chưa hoàn thành phiên luyện tập nào.
                </p>
              ) : (
                <>
                  <ScoreTrend sessions={member.recentSessions} />
                  <ul className="mt-3 divide-y divide-border">
                    {member.recentSessions.map((session) => {
                      const outcome = session.objectiveOutcome
                        ? outcomeLabels[session.objectiveOutcome]
                        : null
                      return (
                        <li
                          key={session.sessionId}
                          className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[13px]">
                              {session.practiceTitle}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {formatDayAndClock(session.completedAt)} ·{' '}
                              {difficultyLabels[session.difficulty]}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="text-[13px] tabular-nums">
                              {session.score === null ? (
                                <span className="text-muted-foreground">
                                  Chưa chấm
                                </span>
                              ) : (
                                <>
                                  <b className="font-medium">{session.score}</b>
                                  <span className="text-muted-foreground">
                                    /100
                                  </span>
                                </>
                              )}
                            </span>
                            {outcome && (
                              <StatusPill tone={outcome.tone}>
                                {outcome.label}
                              </StatusPill>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </section>
          </>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
