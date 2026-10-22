import type { SessionOutcomeKey, UsageBucket } from '#/lib/admin/contracts'

/**
 * How a call ended, in stacking order. One color per outcome on every chart of
 * the dashboard. Daily buckets combine abandoned and ongoing sessions.
 */
export const CALL_SERIES = [
  { key: 'completed', label: 'Hoàn thành', color: 'var(--brand)' },
  { key: 'incomplete', label: 'Chưa hoàn thành', color: '#9bafac' },
  {
    key: 'technicalErrors',
    label: 'Lỗi kỹ thuật',
    color: 'var(--destructive)',
  },
] as const satisfies ReadonlyArray<{
  key: keyof UsageBucket
  label: string
  color: string
}>

export type CallSeriesKey = (typeof CALL_SERIES)[number]['key']

export const OUTCOME_SERIES: Record<SessionOutcomeKey, CallSeriesKey> = {
  learner_ended: 'completed',
  buyer_hung_up: 'completed',
  time_limit: 'completed',
  learner_idle: 'completed',
  completed: 'completed',
  abandoned: 'incomplete',
  in_progress: 'incomplete',
  connection_lost: 'incomplete',
  technical_error: 'technicalErrors',
}

export function CallLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {CALL_SERIES.map((series) => (
        <li key={series.key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-[2px]"
            style={{ background: series.color }}
          />
          {series.label}
        </li>
      ))}
    </ul>
  )
}
