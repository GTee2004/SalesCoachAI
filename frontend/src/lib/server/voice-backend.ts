import { z } from 'zod'
import { env } from '#/env'
import { ttsProviderSchema } from '#/lib/voice/contracts'
import type { MicType, TtsProvider } from '#/lib/voice/contracts'
import { evaluationSchema } from '#/lib/practice/validation'
import type {
  CompetencyRubric,
  LearnerBriefView,
  PracticeAgentConfig,
  PracticeType,
  SalesOfferingConfig,
} from '#/db/schema'
import type { Evaluation } from '#/lib/practice/validation'
import { parseServiceUsage } from './service-usage'
import type { ServiceUsageItem } from './service-usage'

export type VoiceEvaluationInput = {
  practice: {
    id: string
    type: PracticeType
    learnerBrief: LearnerBriefView
    offering: SalesOfferingConfig
  }
  agentConfig: PracticeAgentConfig
  competencies: Array<{
    code: string
    name: string
    weight: number
    rubric: CompetencyRubric
  }>
  turns: Array<{
    sequence: number
    speaker: 'user' | 'assistant'
    text: string
  }>
}

const voiceSessionSchema = z.object({
  sessionId: z.string().uuid(),
  attemptId: z.string().uuid().optional(),
  activityLeaseUntil: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional(),
  startupExpiresAt: z.string().datetime({ offset: true }).optional(),
  reconnectSeconds: z.number().positive().max(300).optional(),
  /** Registration only: the provider chosen after any fallback. */
  ttsProvider: ttsProviderSchema.optional(),
  status: z.enum([
    'awaiting_connection',
    'active',
    'ending',
    'ended',
    'failed',
  ]),
})

type VoiceScenario = {
  systemPrompt: string
  firstUtterance: string
  /** Asks the learner to repeat after the buyer's reply failed. */
  repairUtterance: string
  /** Checks in when the learner stays silent after the buyer spoke. */
  checkInUtterance: string
  /** Says goodbye before the call ends for the learner's silence. */
  hangUpUtterance: string
  /** Names to bias speech recognition toward, e.g. the project name. */
  sttTerms: string[]
}

async function controlRequest(
  path: string,
  init: RequestInit,
  timeoutMs = 10_000,
) {
  const base = env.VOICE_BACKEND_INTERNAL_URL.replace(/\/$/, '')
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.VOICE_CONTROL_API_KEY}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  return response
}

export async function provisionVoiceSession(input: {
  sessionId: string
  userId: string
  attemptId: string
  ttsProvider: TtsProvider
  /** Tried in order by the voice backend when `ttsProvider` is not configured. */
  ttsFallbacks?: readonly TtsProvider[]
  buyerGender: 'male' | 'female'
  micType?: MicType
  expiresAt: string
  scenario: VoiceScenario
  nextSequence: number
  maxDurationSeconds: number
}) {
  const response = await controlRequest(
    '/internal/sessions',
    { method: 'POST', body: JSON.stringify(input) },
    180_000,
  )
  if (!response.ok)
    throw new Error(`Voice session registration returned ${response.status}`)
  const result = voiceSessionSchema.parse(await response.json())
  if (result.sessionId !== input.sessionId)
    throw new Error('Voice backend returned a different session ID')
  return result
}

export async function getVoiceSession(sessionId: string) {
  const response = await controlRequest(
    `/internal/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'GET' },
  )
  if (response.status === 404) return null
  if (!response.ok)
    throw new Error(`Voice session lookup returned ${response.status}`)
  const result = voiceSessionSchema.parse(await response.json())
  if (result.sessionId !== sessionId)
    throw new Error('Voice backend returned a different session ID')
  return result
}

const voiceStatusSchema = z.object({
  ready: z.boolean(),
  activeSessions: z.number().int().nonnegative(),
  maxConcurrentSessions: z.number().int().positive(),
  /** Absent on voice backends that predate the mic type choice. */
  micTypeSelectable: z.boolean().optional(),
})

/** Null when the running voice backend predates `/internal/status`. */
export async function getVoiceBackendStatus(timeoutMs = 3_000) {
  const response = await controlRequest(
    '/internal/status',
    { method: 'GET' },
    timeoutMs,
  )
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Voice status returned ${response.status}`)
  return voiceStatusSchema.parse(await response.json())
}

export async function endVoiceSession(sessionId: string, reason: string) {
  const response = await controlRequest(
    `/internal/sessions/${encodeURIComponent(sessionId)}/end`,
    { method: 'POST', body: JSON.stringify({ reason }) },
    // Pipeline setup has a 20s timeout; ending waits for processor cleanup.
    30_000,
  )
  if (response.status === 404) return
  if (!response.ok)
    throw new Error(`Voice session end returned ${response.status}`)
}

/** What an evaluation's LLM calls consumed, failed attempts included. */
function evaluationUsage(response: Response) {
  const header = response.headers.get('x-service-usage')
  if (!header) return []
  try {
    return parseServiceUsage(JSON.parse(header))
  } catch {
    return []
  }
}

export async function evaluateVoiceTranscript(
  input: VoiceEvaluationInput,
  /** Called before the result or the failure is returned. */
  onUsage?: (items: ServiceUsageItem[]) => Promise<void>,
): Promise<Evaluation> {
  const response = await controlRequest(
    '/internal/evaluations',
    { method: 'POST', body: JSON.stringify(input) },
    60_000,
  )
  await onUsage?.(evaluationUsage(response))
  if (!response.ok) {
    const failure = z
      .object({
        detail: z.union([
          z.string(),
          z.object({ code: z.string(), reason: z.string() }),
        ]),
      })
      .safeParse(await response.json().catch(() => null))
    const detail = failure.success
      ? typeof failure.data.detail === 'string'
        ? failure.data.detail
        : `${failure.data.detail.code}: ${failure.data.detail.reason}`
      : null
    throw new Error(
      `Voice evaluation returned ${response.status}${detail ? `: ${detail}` : ''}`,
    )
  }
  const raw: unknown = await response.json()
  return evaluationSchema.parse(raw)
}
