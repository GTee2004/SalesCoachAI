import { formatCount } from '#/lib/admin/format'
import type { TeamObjectionStat } from '#/lib/workspace/performance'
import { objectionLabels } from './shared'

const SEGMENTS = [
  {
    key: 'handled',
    label: 'Xử lý tốt',
    fill: 'bg-[#276349] dark:bg-emerald-400',
  },
  {
    key: 'partiallyHandled',
    label: 'Xử lý một phần',
    fill: 'bg-[#795a1c] dark:bg-warning',
  },
  { key: 'notHandled', label: 'Chưa xử lý được', fill: 'bg-destructive' },
] as const

/** Share of raised objections that were fully handled, as a whole percent. */
const handledPercent = (stat: TeamObjectionStat) =>
  Math.round((stat.handled / stat.raised) * 100)

export function ObjectionBreakdown({
  objections,
  subject = 'team',
}: {
  objections: TeamObjectionStat[]
  /** Whose handling this is, which only changes the wording. */
  subject?: 'team' | 'member'
}) {
  if (!objections.length)
    return (
      <p className="text-sm text-muted-foreground">
        Chưa có phản đối nào được khách nêu ra trong kỳ này.
      </p>
    )

  // Worst handled first among those raised often enough to mean something.
  const hardest = objections
    .filter((stat) => stat.raised >= 3)
    .reduce<TeamObjectionStat | null>(
      (worst, stat) =>
        !worst || handledPercent(stat) < handledPercent(worst) ? stat : worst,
      null,
    )

  return (
    <div className="space-y-4">
      {hardest && (
        <p className="text-sm">
          {subject === 'team' ? 'Nhóm xử lý' : 'Xử lý'} kém nhất phản đối về{' '}
          <b className="font-medium">
            {(
              objectionLabels[hardest.category] ?? hardest.category
            ).toLowerCase()}
          </b>
          <span className="text-muted-foreground">
            {' '}
            (xử lý tốt {handledPercent(hardest)}% trong{' '}
            {formatCount(hardest.raised)} lần khách nêu)
          </span>
          .
        </p>
      )}
      <ul className="space-y-4">
        {objections.map((stat) => {
          const label = objectionLabels[stat.category] ?? stat.category
          return (
            <li key={stat.category}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">{label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  <b className="font-medium text-foreground">
                    {handledPercent(stat)}%
                  </b>{' '}
                  xử lý tốt · {formatCount(stat.raised)} lần
                </span>
              </div>
              <div
                role="img"
                aria-label={`${label}: ${SEGMENTS.map((segment) => `${segment.label} ${stat[segment.key]}`).join(', ')}`}
                className="mt-1.5 flex h-2 gap-px overflow-hidden rounded-full bg-muted"
              >
                {SEGMENTS.map((segment) =>
                  stat[segment.key] ? (
                    <div
                      key={segment.key}
                      className={segment.fill}
                      style={{
                        width: `${(stat[segment.key] / stat.raised) * 100}%`,
                      }}
                    />
                  ) : null,
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {SEGMENTS.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${segment.fill}`}
            />
            {segment.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
