import type { CostSeriesKey } from '#/lib/admin/contracts'
import { COST_SERIES_KEYS } from '#/lib/admin/contracts'
import { COST_SERIES_LABELS } from '#/lib/admin/labels'

/**
 * What the spend pays for, in stacking order. STT, LLM and TTS share their
 * colors with the latency stages.
 */
const COST_COLORS: Record<CostSeriesKey, string> = {
  stt: '#5b9aa8',
  llm: 'var(--brand)',
  tts: '#c08a3e',
  evaluation: '#9bafac',
}

export const COST_SERIES = COST_SERIES_KEYS.map((key) => ({
  key,
  label: COST_SERIES_LABELS[key].name,
  color: COST_COLORS[key],
}))

export function CostLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {COST_SERIES.map((series) => (
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
