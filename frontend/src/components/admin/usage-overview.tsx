import type { AdminUsage, SessionOutcomeKey } from '#/lib/admin/contracts'
import { describeChange, formatCount, formatDecimal } from '#/lib/admin/format'
import type { Change } from '#/lib/admin/format'
import { OUTCOME_LABELS } from '#/lib/admin/labels'
import { countDays } from '#/lib/admin/usage'
import { CALL_SERIES, OUTCOME_SERIES } from './call-series'
import { Panel, PanelMessage } from './panel'

const completionRate = (totals: AdminUsage['current']) =>
  totals.calls ? (totals.completed / totals.calls) * 100 : null

export interface StatTile {
  label: string
  value: string
  unit?: string
  change: Change | null
  /** Which way is an improvement; null when neither is. Defaults to up. */
  better?: 'up' | 'down' | null
  note: string
}

const changeTone = (change: Change, better: StatTile['better']) => {
  if (change.direction === 'flat' || better === null)
    return 'text-muted-foreground'
  return change.direction === (better ?? 'up')
    ? 'text-[#276349] dark:text-emerald-300'
    : 'text-destructive'
}

export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-7 py-2 sm:gap-x-6 lg:grid-cols-4">
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
                  className={`font-medium ${changeTone(tile.change, tile.better)}`}
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

export function UsageTiles({ usage }: { usage: AdminUsage }) {
  const { current, previous } = usage
  const days = countDays(usage.period.from, usage.period.to)
  const rate = completionRate(current)
  const tiles: StatTile[] = [
    {
      label: 'Người dùng hoạt động',
      value: formatCount(current.activeUsers),
      change: describeChange(
        current.activeUsers,
        previous.activeUsers,
        'percent',
        '%',
      ),
      note: 'Có đăng nhập trong kỳ',
    },
    {
      label: 'Cuộc gọi',
      value: formatCount(current.calls),
      change: describeChange(current.calls, previous.calls, 'percent', '%'),
      note: `Trung bình ${formatDecimal(current.calls / days)} mỗi ngày`,
    },
    {
      label: 'Tỷ lệ hoàn thành',
      value: rate == null ? '–' : formatDecimal(rate),
      unit: rate == null ? undefined : '%',
      change: describeChange(
        rate,
        completionRate(previous),
        'points',
        ' điểm %',
      ),
      note: `${formatCount(current.technicalErrors)} phiên lỗi kỹ thuật`,
    },
    {
      label: 'Điểm trung bình',
      value:
        current.averageScore == null
          ? '–'
          : formatDecimal(current.averageScore),
      unit: current.averageScore == null ? undefined : '/100',
      change: describeChange(
        current.averageScore,
        previous.averageScore,
        'points',
        ' điểm',
      ),
      note: `${formatCount(current.evaluated)} phiên đã chấm`,
    },
  ]
  return <StatTiles tiles={tiles} />
}

const OUTCOME_ORDER: SessionOutcomeKey[] = [
  'learner_ended',
  'buyer_hung_up',
  'time_limit',
  'learner_idle',
  'completed',
  'abandoned',
  'in_progress',
  'connection_lost',
  'technical_error',
]

export function SessionOutcomes({ usage }: { usage: AdminUsage }) {
  const counts = new Map(usage.outcomes.map((item) => [item.key, item.count]))
  const rows = OUTCOME_ORDER.flatMap((key) => {
    const count = counts.get(key) ?? 0
    return count ? [{ key, count }] : []
  })
  const longest = Math.max(0, ...rows.map((row) => row.count))
  return (
    <Panel
      titleId="session-outcomes-title"
      title="Kết quả phiên"
      description="Các cuộc gọi đã bắt đầu trong kỳ kết thúc như thế nào."
    >
      {rows.length === 0 ? (
        <PanelMessage>Chưa có cuộc gọi nào trong kỳ này.</PanelMessage>
      ) : (
        <>
          <dl className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-4 text-xs sm:gap-x-3">
            {rows.map((row) => {
              const series = CALL_SERIES.find(
                (item) => item.key === OUTCOME_SERIES[row.key],
              )!
              return (
                <div key={row.key} className="contents">
                  <dt className="min-w-0 text-muted-foreground">
                    {OUTCOME_LABELS[row.key]}
                  </dt>
                  <dd aria-hidden="true" className="h-2 min-w-0">
                    <div
                      className="h-full min-w-0.5 rounded-[2px]"
                      style={{
                        width: `${(row.count / longest) * 100}%`,
                        background:
                          row.key === 'in_progress'
                            ? 'var(--warning)'
                            : series.color,
                      }}
                    />
                  </dd>
                  <dd className="text-right font-medium tabular-nums">
                    {formatCount(row.count)}
                  </dd>
                  <dd className="text-right tabular-nums text-muted-foreground">
                    {formatDecimal((row.count / usage.current.calls) * 100)}%
                  </dd>
                </div>
              )
            })}
          </dl>
        </>
      )}
    </Panel>
  )
}

const PRACTICE_TYPE_LABELS = {
  cold_call: 'Gọi lần đầu',
  warm_call: 'Gọi lại',
}

export function TopPractices({ usage }: { usage: AdminUsage }) {
  return (
    <Panel
      titleId="top-practices-title"
      title="Bài luyện được dùng nhiều nhất"
      description="Xếp theo số cuộc gọi trong kỳ."
    >
      {usage.topPractices.length === 0 ? (
        <PanelMessage>Chưa có cuộc gọi nào trong kỳ này.</PanelMessage>
      ) : (
        <>
          <ul className="divide-y divide-border sm:hidden">
            {usage.topPractices.map((practice) => (
              <li
                key={practice.id}
                className="flex min-w-0 flex-col gap-1.5 py-4 first:pt-0 last:pb-0"
              >
                <p className="text-[13px] font-medium">{practice.title}</p>
                <p className="text-xs text-muted-foreground">
                  {PRACTICE_TYPE_LABELS[practice.type]}
                </p>
                <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs leading-[1.6] text-muted-foreground">
                  <div className="flex gap-1">
                    <dt className="order-2">cuộc gọi</dt>
                    <dd className="order-1 tabular-nums">
                      {formatCount(practice.calls)}
                    </dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="order-2">hoàn thành</dt>
                    <dd className="order-1 tabular-nums">
                      {formatDecimal(
                        (practice.completed / practice.calls) * 100,
                      )}
                      %
                    </dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="order-2">điểm TB</dt>
                    <dd className="order-1 tabular-nums">
                      {practice.averageScore == null
                        ? '–'
                        : formatDecimal(practice.averageScore)}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <thead>
                <tr className="bg-muted text-left text-xs text-muted-foreground">
                  <th className="rounded-l-md px-2.5 py-3 font-medium">
                    Bài luyện
                  </th>
                  <th className="px-2.5 py-3 font-medium">Loại</th>
                  <th className="px-2.5 py-3 text-right font-medium">
                    Cuộc gọi
                  </th>
                  <th className="px-2.5 py-3 text-right font-medium">
                    Hoàn thành
                  </th>
                  <th className="rounded-r-md px-2.5 py-3 text-right font-medium">
                    Điểm TB
                  </th>
                </tr>
              </thead>
              <tbody>
                {usage.topPractices.map((practice) => (
                  <tr
                    key={practice.id}
                    className="[&>td]:border-b [&>td]:border-border [&>td]:px-2.5 [&>td]:py-3.5"
                  >
                    <td className="min-w-[180px] font-medium">
                      {practice.title}
                    </td>
                    <td className="whitespace-nowrap text-muted-foreground">
                      {PRACTICE_TYPE_LABELS[practice.type]}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatCount(practice.calls)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatDecimal(
                        (practice.completed / practice.calls) * 100,
                      )}
                      %
                    </td>
                    <td className="text-right tabular-nums">
                      {practice.averageScore == null
                        ? '–'
                        : formatDecimal(practice.averageScore)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  )
}
