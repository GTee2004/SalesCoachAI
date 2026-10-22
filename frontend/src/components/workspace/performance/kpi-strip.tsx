import { describeChange, formatCount, formatDecimal } from '#/lib/admin/format'
import type { Change } from '#/lib/admin/format'
import { INACTIVE_DAYS } from '#/lib/workspace/performance'
import type { TeamPerformance } from '#/lib/workspace/performance'
import { changeClass } from './shared'

export function KpiStrip({ data }: { data: TeamPerformance }) {
  const { kpis } = data
  const tiles: Array<{
    label: string
    value: string
    unit?: string
    change: Change | null
    note: string
  }> = [
    {
      label: 'Thành viên luyện tập',
      value: `${formatCount(kpis.activeMembers)}/${formatCount(kpis.totalMembers)}`,
      change: describeChange(
        kpis.activeMembers,
        kpis.previousActiveMembers,
        'points',
        ' người',
      ),
      note: kpis.inactiveMembers
        ? `${formatCount(kpis.inactiveMembers)} người chưa luyện tập quá ${INACTIVE_DAYS} ngày`
        : 'Không ai bị bỏ lỡ',
    },
    {
      label: 'Phiên luyện tập',
      value: formatCount(kpis.sessions),
      change: describeChange(
        kpis.sessions,
        kpis.previousSessions,
        'percent',
        '%',
      ),
      note: kpis.activeMembers
        ? `Trung bình ${formatDecimal(kpis.sessions / kpis.activeMembers)} phiên mỗi người`
        : 'Chưa có phiên hoàn thành',
    },
    {
      label: 'Điểm trung bình',
      value:
        kpis.averageScore === null ? '–' : formatDecimal(kpis.averageScore),
      unit: kpis.averageScore === null ? undefined : '/100',
      change: describeChange(
        kpis.averageScore,
        kpis.previousAverageScore,
        'points',
        ' điểm',
      ),
      note: 'Trên các phiên đã được chấm',
    },
    {
      label: 'Đạt mục tiêu buổi gọi',
      value:
        kpis.objectiveAchievedRate === null
          ? '–'
          : formatDecimal(kpis.objectiveAchievedRate),
      unit: kpis.objectiveAchievedRate === null ? undefined : '%',
      change: describeChange(
        kpis.objectiveAchievedRate,
        kpis.previousObjectiveAchievedRate,
        'points',
        ' điểm %',
      ),
      note: 'Tỷ lệ phiên đạt trọn mục tiêu',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-7 lg:grid-cols-4 lg:gap-x-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="flex min-w-0 flex-col gap-2">
          <p className="text-xs text-muted-foreground sm:text-[13px]">
            {tile.label}
          </p>
          <p className="text-[30px] font-medium leading-[1.4] tracking-[-0.03em] sm:text-[32px]">
            {tile.value}
            {tile.unit ? (
              <span className="ml-1 text-sm font-normal tracking-normal text-muted-foreground">
                {tile.unit}
              </span>
            ) : null}
          </p>
          <p className="text-xs leading-[1.6] text-muted-foreground">
            {tile.change ? (
              <>
                <b
                  className={`font-medium ${changeClass(tile.change.direction)}`}
                >
                  {tile.change.text}
                </b>{' '}
                so với kỳ trước
              </>
            ) : (
              'Chưa có kỳ trước để so sánh'
            )}
          </p>
          <p className="text-xs leading-[1.6] text-muted-foreground">
            {tile.note}
          </p>
        </div>
      ))}
    </div>
  )
}
