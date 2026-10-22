import type { PracticeType } from '#/db/schema'

/** Shortcuts for the last N days, today included. */
export const ADMIN_RANGE_DAYS = [7, 14, 30] as const
/** Longest period one request may cover: ten years, leap days included. */
export const ADMIN_RANGE_MAX_DAYS = 3653
/** Earliest day a period may start on. */
export const ADMIN_RANGE_MIN_DATE = '2000-01-01'

/** Inclusive calendar days in the app time zone, YYYY-MM-DD. */
export interface UsagePeriod {
  from: string
  to: string
}

/** The last `days` days up to today, or a period picked by the admin. */
export type AdminUsageRange = { days: number } | UsagePeriod
export const DEFAULT_ADMIN_RANGE: AdminUsageRange = { days: 14 }

/** Long periods are charted by week or month so the bars stay readable. */
export type UsageGranularity = 'day' | 'week' | 'month'

export interface UsageBucket {
  /** First day of the bucket inside the period, YYYY-MM-DD. */
  date: string
  /** Last day of the bucket inside the period; equals `date` for a day. */
  endDate: string
  /** Different users with an authenticated visit in the bucket. */
  activeUsers: number
  /** Every session that started in the bucket; the three fields below add up to it. */
  calls: number
  completed: number
  /** Abandoned by the learner or still running. */
  incomplete: number
  technicalErrors: number
}

export interface UsageTotals {
  activeUsers: number
  calls: number
  completed: number
  technicalErrors: number
  /** Mean overall score of scored sessions; null when none were scored. */
  averageScore: number | null
  evaluated: number
}

export type SessionOutcomeKey =
  | 'learner_ended'
  | 'buyer_hung_up'
  | 'time_limit'
  | 'learner_idle'
  | 'completed'
  | 'abandoned'
  | 'connection_lost'
  | 'technical_error'
  | 'in_progress'

export interface PracticeUsage {
  id: string
  title: string
  type: PracticeType
  calls: number
  completed: number
  averageScore: number | null
}

export interface AdminUsage {
  /** Today in the app time zone; a period that ends here is still running. */
  today: string
  period: UsagePeriod
  /** The equally long period right before `period`. */
  previousPeriod: UsagePeriod
  granularity: UsageGranularity
  /** One entry per day, week or month of `period`, oldest first. */
  series: UsageBucket[]
  current: UsageTotals
  /** Totals of `previousPeriod`. */
  previous: UsageTotals
  outcomes: Array<{ key: SessionOutcomeKey; count: number }>
  topPractices: PracticeUsage[]
}

/**
 * A reply slower than this feels like a stall on a phone call. The voice
 * backend logs the same threshold as `slow=true`.
 */
export const SLOW_REPLY_MS = 2000

/**
 * Where a reply's wait went, grouped from pipecat's stable stage keys. Time in
 * any other stage (output transport, pipeline hops) counts as `other`.
 */
export const LATENCY_STAGES = [
  {
    key: 'turn_taking',
    stages: [
      'endpointing_wait',
      'turn_detection',
      'turn_completion',
      'waiting_for_user',
    ],
  },
  { key: 'stt', stages: ['transcription'] },
  {
    key: 'llm',
    stages: [
      'llm_inference',
      'llm_tool_call',
      'function_handler',
      'awaiting_speakable_text',
    ],
  },
  { key: 'tts', stages: ['sentence_aggregation', 'speech_synthesis'] },
] as const

export type LatencyStageKey = (typeof LATENCY_STAGES)[number]['key'] | 'other'

/** From the learner falling silent to the AI buyer starting to speak. */
export interface LatencyTotals {
  /** Buyer replies with a measured latency. */
  replies: number
  p50Ms: number | null
  p95Ms: number | null
  /** Share of measured replies slower than `SLOW_REPLY_MS`, 0–100. */
  slowPercent: number | null
  /** Share of all buyer replies the learner talked over, 0–100. */
  interruptedPercent: number | null
}

export interface LatencyBucket {
  date: string
  endDate: string
  replies: number
  p50Ms: number | null
  p95Ms: number | null
}

export interface LatencyStage {
  key: LatencyStageKey
  averageMs: number
  p95Ms: number
}

export interface AdminVoiceLatency {
  today: string
  period: UsagePeriod
  previousPeriod: UsagePeriod
  granularity: UsageGranularity
  series: LatencyBucket[]
  current: LatencyTotals
  previous: LatencyTotals
  /** Mean and p95 of each stage over the current period's measured replies. */
  stages: LatencyStage[]
  /** Current period by TTS provider, most replies first. */
  providers: Array<{
    provider: string
    replies: number
    p50Ms: number | null
    p95Ms: number | null
    /** The same breakdown as `stages`, over this provider's replies only. */
    stages: LatencyStage[]
  }>
}

/** The AI services a call and its evaluation pay for. */
export type CostService = 'stt' | 'llm' | 'tts'

/** A call's own spend, or the scoring that follows it. */
export type CostSource = 'conversation' | 'evaluation'

/** How one bucket's spend splits; evaluation covers every service it used. */
export const COST_SERIES_KEYS = ['stt', 'llm', 'tts', 'evaluation'] as const
export type CostSeriesKey = (typeof COST_SERIES_KEYS)[number]

/** Spend of the calls that started in a bucket, in USD. */
export interface CostBucket extends Record<CostSeriesKey, number> {
  date: string
  endDate: string
  total: number
}

export interface CostTotals {
  /** Priced spend in USD; usage without a price adds nothing. */
  totalUsd: number
  evaluationUsd: number
  /** Calls started in the period, as counted under usage. */
  calls: number
  /** Minutes of call audio sent to speech recognition. */
  callMinutes: number
  perCallUsd: number | null
  perMinuteUsd: number | null
}

/** One service, provider and model, summed over the current period. */
export interface CostLine {
  source: CostSource
  service: CostService
  provider: string
  model: string
  audioSeconds: number
  characters: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  /** Null when the price table has no entry for this model. */
  costUsd: number | null
}

export interface AdminServiceCosts {
  today: string
  period: UsagePeriod
  previousPeriod: UsagePeriod
  granularity: UsageGranularity
  series: CostBucket[]
  current: CostTotals
  previous: CostTotals
  /** Most expensive first; unpriced lines last. */
  lines: CostLine[]
  /** When the price table was last checked against the providers, YYYY-MM-DD. */
  pricesCheckedOn: string
}

export type ServiceKey = 'web' | 'database' | 'voice'
export type ServiceState = 'up' | 'down' | 'unknown'

export interface ServiceCheck {
  key: ServiceKey
  state: ServiceState
  latencyMs: number | null
}

export interface ServiceHealth {
  checkedAt: string
  webUptimeSeconds: number
  services: ServiceCheck[]
  /** Null when the voice service did not report its session registry. */
  voiceSessions: { active: number; capacity: number } | null
}

export interface AdminSession {
  id: string
  learnerName: string
  practiceTitle: string
  outcome: SessionOutcomeKey
  startedAt: string
  /**
   * Up to the end of the call, or to the time of the query while it runs.
   * Null when the call ended without its end time being stored.
   */
  durationSeconds: number | null
  overallScore: number | null
  /** `failed` also covers an evaluation that was interrupted and never ran. */
  evaluation: 'scored' | 'failed' | 'pending' | 'none'
}

export interface AdminSessionTranscript {
  session: AdminSession
  turns: Array<{
    sequence: number
    speaker: 'salesperson' | 'buyer'
    text: string
    createdAt: string
    interrupted: boolean
    /** How long the buyer took to start this reply; null when not measured. */
    latencyMs: number | null
  }>
  /** The session in Langfuse; null when tracing is not configured here. */
  traceUrl: string | null
}
