import type {
  AdminServiceCosts,
  CostBucket,
  CostLine,
  CostSeriesKey,
  CostService,
  CostSource,
  CostTotals,
  UsageGranularity,
} from './contracts'
import { PRICES_CHECKED_ON, usageCost } from './service-prices'
import { bucketStart, periodBuckets, shiftDateKey } from './usage'

/** Usage of one service, provider and model on the day its call started. */
export interface CostUsageRow {
  day: string
  source: CostSource
  service: CostService
  provider: string
  model: string
  audioMs: number
  characters: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
}

const seriesKey = (row: CostUsageRow): CostSeriesKey =>
  row.source === 'evaluation' ? 'evaluation' : row.service

function totals(
  rows: Array<{ row: CostUsageRow; cost: number | null }>,
  calls: number,
): CostTotals {
  let totalUsd = 0
  let evaluationUsd = 0
  let audioSeconds = 0
  for (const { row, cost } of rows) {
    totalUsd += cost ?? 0
    if (row.source === 'evaluation') evaluationUsd += cost ?? 0
    else if (row.service === 'stt') audioSeconds += row.audioMs / 1000
  }
  const callMinutes = audioSeconds / 60
  return {
    totalUsd,
    evaluationUsd,
    calls,
    callMinutes,
    perCallUsd: calls ? totalUsd / calls : null,
    perMinuteUsd: callMinutes ? totalUsd / callMinutes : null,
  }
}

/**
 * Prices the usage rows, fills empty buckets and splits the totals into the
 * two periods. Spend counts on the day its call started, like the calls it is
 * divided by.
 */
export function buildServiceCosts(input: {
  today: string
  from: string
  to: string
  previousFrom: string
  granularity: UsageGranularity
  /** Across both periods. */
  usageRows: CostUsageRow[]
  calls: { current: number; previous: number }
}): AdminServiceCosts {
  const { from, to, granularity } = input
  const priced = input.usageRows.map((row) => ({
    row,
    cost: usageCost({ ...row, audioSeconds: row.audioMs / 1000 }),
  }))
  const current = priced.filter(({ row }) => row.day >= from)

  const buckets = new Map<string, CostBucket>()
  for (const { start, date, endDate } of periodBuckets(from, to, granularity)) {
    buckets.set(start, {
      date,
      endDate,
      stt: 0,
      llm: 0,
      tts: 0,
      evaluation: 0,
      total: 0,
    })
  }
  for (const { row, cost } of current) {
    if (!cost) continue
    const bucket = buckets.get(bucketStart(row.day, granularity))
    if (!bucket) continue
    bucket[seriesKey(row)] += cost
    bucket.total += cost
  }

  const lines = new Map<string, CostLine>()
  for (const { row, cost } of current) {
    const key = [row.source, row.service, row.provider, row.model].join('\n')
    const line = lines.get(key) ?? {
      source: row.source,
      service: row.service,
      provider: row.provider,
      model: row.model,
      audioSeconds: 0,
      characters: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costUsd: cost == null ? null : 0,
    }
    line.audioSeconds += row.audioMs / 1000
    line.characters += row.characters
    line.inputTokens += row.inputTokens
    line.cachedInputTokens += row.cachedInputTokens
    line.outputTokens += row.outputTokens
    if (line.costUsd != null && cost != null) line.costUsd += cost
    lines.set(key, line)
  }

  return {
    today: input.today,
    period: { from, to },
    previousPeriod: { from: input.previousFrom, to: shiftDateKey(from, -1) },
    granularity,
    series: [...buckets.values()],
    current: totals(current, input.calls.current),
    previous: totals(
      priced.filter(({ row }) => row.day < from),
      input.calls.previous,
    ),
    lines: [...lines.values()].sort(
      (a, b) =>
        (b.costUsd ?? -1) - (a.costUsd ?? -1) ||
        `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`),
    ),
    pricesCheckedOn: PRICES_CHECKED_ON,
  }
}
