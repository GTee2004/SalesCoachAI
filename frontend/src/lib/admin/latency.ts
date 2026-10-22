import type {
  AdminVoiceLatency,
  LatencyStage,
  LatencyStageKey,
  LatencyTotals,
  UsageGranularity,
} from './contracts'
import { LATENCY_STAGES } from './contracts'
import { periodBuckets, shiftDateKey } from './usage'

export type LatencyTotalsRow = {
  current: boolean
  replies: number
  p50: number | null
  p95: number | null
  slow: number
  buyerReplies: number
  interrupted: number
}

export type LatencyBucketRow = {
  /** Start of the bucket, keyed like `bucketStart`. */
  bucket: string
  replies: number
  p50: number | null
  p95: number | null
}

const ms = (value: number | null) => (value == null ? null : Math.round(value))

const percent = (part: number, whole: number) =>
  whole ? (part / whole) * 100 : null

function totals(row: LatencyTotalsRow | undefined): LatencyTotals {
  return {
    replies: row?.replies ?? 0,
    p50Ms: ms(row?.p50 ?? null),
    p95Ms: ms(row?.p95 ?? null),
    slowPercent: percent(row?.slow ?? 0, row?.replies ?? 0),
    interruptedPercent: percent(row?.interrupted ?? 0, row?.buyerReplies ?? 0),
  }
}

export const LATENCY_STAGE_KEYS: LatencyStageKey[] = [
  ...LATENCY_STAGES.map((stage) => stage.key),
  'other',
]

/** Each stage's mean and p95 in ms; null without measured replies. */
export type StageColumns = {
  [column: `${string}_avg` | `${string}_p95`]: number | null
}

export type LatencyProviderRow = StageColumns & {
  provider: string
  replies: number
  p50: number | null
  p95: number | null
}

function stages(row: StageColumns): LatencyStage[] {
  return LATENCY_STAGE_KEYS.map((key) => ({
    key,
    averageMs: ms(row[`${key}_avg`] ?? 0)!,
    p95Ms: ms(row[`${key}_p95`] ?? 0)!,
  }))
}

/**
 * Fills buckets without replies. Percentiles do not add up, so every bucket
 * and both totals arrive already aggregated.
 */
export function buildVoiceLatency(input: {
  today: string
  from: string
  to: string
  previousFrom: string
  granularity: UsageGranularity
  totalsRows: LatencyTotalsRow[]
  bucketRows: LatencyBucketRow[]
  stageRow: StageColumns | null
  providerRows: LatencyProviderRow[]
}): AdminVoiceLatency {
  const { from, to, granularity } = input
  const buckets = new Map(input.bucketRows.map((row) => [row.bucket, row]))
  const current = totals(input.totalsRows.find((row) => row.current))
  const stageRow = input.stageRow
  return {
    today: input.today,
    period: { from, to },
    previousPeriod: { from: input.previousFrom, to: shiftDateKey(from, -1) },
    granularity,
    series: periodBuckets(from, to, granularity).map(
      ({ start, date, endDate }) => {
        const row = buckets.get(start)
        return {
          date,
          endDate,
          replies: row?.replies ?? 0,
          p50Ms: ms(row?.p50 ?? null),
          p95Ms: ms(row?.p95 ?? null),
        }
      },
    ),
    current,
    previous: totals(input.totalsRows.find((row) => !row.current)),
    stages: current.replies && stageRow ? stages(stageRow) : [],
    providers: input.providerRows.map((row) => ({
      provider: row.provider,
      replies: row.replies,
      p50Ms: ms(row.p50),
      p95Ms: ms(row.p95),
      stages: stages(row),
    })),
  }
}
