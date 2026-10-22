import { formatCount } from '#/lib/admin/format'
import type { TeamCriticalError } from '#/lib/workspace/performance'

export function CriticalErrors({ errors }: { errors: TeamCriticalError[] }) {
  if (!errors.length)
    return (
      <p className="text-sm text-muted-foreground">
        Không có lỗi nghiêm trọng nào trong kỳ này.
      </p>
    )
  return (
    <ol className="divide-y divide-border">
      {errors.map((error) => (
        <li
          key={`${error.competencyId}:${error.errorId}`}
          className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-sm">{error.description}</p>
            <span className="shrink-0 whitespace-nowrap text-sm tabular-nums">
              <b className="font-medium">{formatCount(error.sessions)}</b>{' '}
              <span className="text-muted-foreground">phiên</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {error.competencyName} ·{' '}
            {error.members
              .map((member) => `${member.name} (${member.sessions})`)
              .join(', ')}
          </p>
        </li>
      ))}
    </ol>
  )
}
