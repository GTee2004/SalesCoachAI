import {
  formatCount,
  formatDecimal,
  formatDuration,
  formatUptime,
} from '#/lib/admin/format'
import { discoveryRate } from '#/lib/workspace/performance'
import type { TeamAdvanced } from '#/lib/workspace/performance'

export function AdvancedStrip({ advanced }: { advanced: TeamAdvanced }) {
  const { discovery, health } = advanced
  const found = discoveryRate(discovery)
  const began = health.completed + health.abandoned
  const tiles = [
    {
      label: 'Khám phá nhu cầu ẩn',
      value: found === null ? '–' : formatDecimal(found),
      unit: found === null ? undefined : '%',
      note:
        discovery.discovered + discovery.missed
          ? `Tìm ra ${formatCount(discovery.discovered)} trên ${formatCount(discovery.discovered + discovery.missed)} điều khách giấu`
          : 'Chưa có phiên nào được chấm trong kỳ',
    },
    {
      label: 'Phiên hoàn thành',
      value: began ? formatDecimal((health.completed / began) * 100) : '–',
      unit: began ? '%' : undefined,
      note: began
        ? `${formatCount(health.abandoned)} phiên bỏ dở trên ${formatCount(began)} phiên bắt đầu`
        : 'Chưa có phiên nào bắt đầu',
    },
    {
      label: 'Thời gian luyện tập',
      value: health.timedSessions ? formatUptime(health.practiceSeconds) : '–',
      note: 'Tổng thời lượng các cuộc gọi đã hoàn thành',
    },
    {
      label: 'Thời lượng mỗi phiên',
      value: health.timedSessions
        ? formatDuration(
            Math.round(health.practiceSeconds / health.timedSessions),
          )
        : '–',
      note: 'Trung bình, tính theo phút:giây',
    },
  ]
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-7 lg:grid-cols-4 lg:gap-x-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="flex min-w-0 flex-col gap-2">
          <p className="text-xs text-muted-foreground sm:text-[13px]">
            {tile.label}
          </p>
          <p className="text-[26px] font-medium leading-[1.4] tracking-[-0.03em] sm:text-[28px]">
            {tile.value}
            {tile.unit ? (
              <span className="ml-1 text-sm font-normal tracking-normal text-muted-foreground">
                {tile.unit}
              </span>
            ) : null}
          </p>
          <p className="text-xs leading-[1.6] text-muted-foreground">
            {tile.note}
          </p>
        </div>
      ))}
    </div>
  )
}
