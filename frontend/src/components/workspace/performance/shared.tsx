import { StatusPill, TONES } from '#/components/admin/panel'
import type { Tone } from '#/components/admin/panel'
import { toDateKey } from '#/lib/admin/usage'
import { INACTIVE_DAYS } from '#/lib/workspace/performance'
import type {
  ObjectiveOutcome,
  PracticeCallType,
  TeamMember,
  TeamMemberStatus,
  TeamRecentSession,
} from '#/lib/workspace/performance'

const statusTone: Record<TeamMemberStatus, Tone> = {
  inactive: 'critical',
  declining: 'warning',
  new: 'live',
  steady: 'neutral',
  improving: 'good',
}

const statusLabel: Record<TeamMemberStatus, string> = {
  inactive: 'Ngừng luyện tập',
  declining: 'Đang giảm',
  new: 'Mới tham gia',
  steady: 'Ổn định',
  improving: 'Đang tiến bộ',
}

export function MemberStatusPill({ status }: { status: TeamMemberStatus }) {
  return (
    <StatusPill tone={statusTone[status]}>{statusLabel[status]}</StatusPill>
  )
}

/** Why the member is flagged, in a sentence a manager can act on. */
export function statusDetail(member: TeamMember) {
  if (member.status === 'inactive')
    return member.lastPracticedAt
      ? `Chưa luyện tập từ ${relativeDay(member.lastPracticedAt)}, quá ${INACTIVE_DAYS} ngày.`
      : `Chưa hoàn thành phiên luyện tập nào, quá ${INACTIVE_DAYS} ngày kể từ khi tham gia.`
  if (member.status === 'declining')
    return 'Điểm trung bình giảm rõ rệt so với kỳ trước.'
  if (member.status === 'improving')
    return 'Điểm trung bình tăng rõ rệt so với kỳ trước.'
  if (member.status === 'new')
    return 'Vừa tham gia, chưa có phiên luyện tập nào.'
  return null
}

const dayMs = 86_400_000

/** "Hôm nay", "Hôm qua" or "N ngày trước" for an ISO instant or YYYY-MM-DD. */
export function relativeDay(value: string | null, now = new Date()) {
  if (!value) return 'Chưa có'
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : toDateKey(new Date(value))
  const days = Math.round(
    (Date.parse(`${toDateKey(now)}T00:00:00Z`) -
      Date.parse(`${day}T00:00:00Z`)) /
      dayMs,
  )
  if (days <= 0) return 'Hôm nay'
  if (days === 1) return 'Hôm qua'
  return `${days} ngày trước`
}

/** Band for a 0-100 mastery or score, so the heatmap reads at a glance. */
export function scoreBand(score: number | null): {
  className: string
  label: string
} {
  if (score === null) return { className: 'text-muted-foreground', label: '–' }
  if (score >= 70) return { className: TONES.good, label: 'Tốt' }
  if (score >= 50) return { className: TONES.warning, label: 'Trung bình' }
  return { className: TONES.critical, label: 'Cần cải thiện' }
}

export function changeClass(direction: 'up' | 'down' | 'flat') {
  if (direction === 'up') return 'text-[#276349] dark:text-emerald-300'
  if (direction === 'down') return 'text-destructive'
  return 'text-muted-foreground'
}

export const objectionLabels: Record<string, string> = {
  brush_off: 'Đang bận',
  not_interested: 'Không quan tâm',
  timing: 'Thời điểm',
  price: 'Giá',
  trust: 'Niềm tin',
  product: 'Sản phẩm',
  decision_authority: 'Người quyết định',
  competitor: 'Đối thủ',
  other: 'Khác',
}

export const callTypeLabels: Record<PracticeCallType, string> = {
  cold_call: 'Gọi lần đầu',
  warm_call: 'Gọi lại',
}

export const difficultyLabels: Record<TeamRecentSession['difficulty'], string> =
  { beginner: 'Cơ bản', intermediate: 'Trung bình', advanced: 'Nâng cao' }

export const outcomeLabels: Record<
  ObjectiveOutcome,
  { label: string; tone: Tone }
> = {
  achieved: { label: 'Đạt mục tiêu', tone: 'good' },
  partially_achieved: { label: 'Đạt một phần', tone: 'warning' },
  not_achieved: { label: 'Chưa đạt', tone: 'critical' },
}

/** One fill per band, shared by every score bar so a color always means a band. */
export const scoreFill = (score: number) =>
  score >= 70
    ? 'bg-[#276349] dark:bg-emerald-400'
    : score >= 50
      ? 'bg-[#795a1c] dark:bg-warning'
      : 'bg-destructive'
