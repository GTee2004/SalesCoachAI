import { z } from 'zod'
import type {
  LearnerBriefView,
  PracticeType,
  SalesOfferingConfig,
  SessionEndReason,
} from '#/db/schema'
import { assessmentStatusSchema } from '#/lib/practice/assessment'
import {
  behavioralFindingSchema,
  evidenceSchema,
  rubricSchema,
} from '#/lib/practice/validation'

export const practiceLifecycleSchema = z.enum([
  'provisioning',
  'awaiting_connection',
  'active',
  'ending',
  'ended',
  'failed',
])

export type PracticeLifecycle = z.infer<typeof practiceLifecycleSchema>
export type PracticeActivity =
  | 'idle'
  | 'opening'
  | 'listening'
  | 'user-speaking'
  | 'thinking'
  | 'bot-speaking'
export const ttsProviderSchema = z.enum(['soniox', 'gemini', 'elevenlabs'])
export type TtsProvider = z.infer<typeof ttsProviderSchema>
/** The only provider for non-admins, and the admins' initial choice. */
export const DEFAULT_TTS_PROVIDER: TtsProvider = 'elevenlabs'
/** Tried in order when the default provider is not configured. */
export const DEFAULT_TTS_FALLBACKS: readonly TtsProvider[] = [
  'soniox',
  'gemini',
]

// Where the learner's mic sits: a worn mic (headset, lapel) is close to the
// mouth; a computer's built-in mic hears the speaker from further away.
export const micTypeSchema = z.enum(['worn', 'built_in'])
export type MicType = z.infer<typeof micTypeSchema>

export const voiceEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  sessionId: z.string().uuid(),
  attemptId: z.string().uuid().nullable().optional(),
  sequence: z.number().int().positive(),
  type: z.enum([
    'session.state',
    'session.lease',
    'session.reconcile',
    'transcript.final',
    'assistant.interrupted',
    'session.error',
    'usage.recorded',
  ]),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
})

export type VoiceEvent = z.infer<typeof voiceEventSchema>

export interface LearnerPracticeView {
  id: string
  type: PracticeType
  title: string
  description: string | null
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  learnerBrief: LearnerBriefView
  offering: SalesOfferingConfig | null
  estimatedMinutes: number | null
  competencies: Array<{
    id: string
    code: string
    name: string
    description?: string | null
    weight?: number
  }>
}

export interface TranscriptMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  final: boolean
  timestamp: string
  sequence?: number
  interrupted?: boolean
}

export interface PracticeSessionResponse {
  sessionId: string
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  status: 'created' | 'in_progress' | 'completed' | 'abandoned'
  endReason?: SessionEndReason | null
  ttsProvider?: TtsProvider
  micType?: MicType
  signalingUrl?: string
  connectionToken?: string
  connectionExpiresAt?: string
  practice: LearnerPracticeView | null
  transcript: TranscriptMessage[]
}

export const feedbackStatementSchema = z.object({
  text: z.string().trim().min(1),
  turnNumbers: z.array(z.number().int().positive()),
  findingIds: z.array(z.string().min(1)),
})

const scoreExplanationSchema = z.object({
  levelId: z.string().min(1),
  levelLabel: z.string().min(1),
  baseScore: z.number().int().min(0).max(100),
  requiredBehaviorIds: z.array(z.string().min(1)),
  findingIds: z.array(z.string().min(1)),
  appliedCaps: z.array(
    z.object({
      criticalErrorId: z.string().min(1),
      scoreCap: z.number().int().min(0).max(100),
      findingIds: z.array(z.string().min(1)).min(1),
    }),
  ),
})

const competencyFeedbackBaseSchema = z.object({
  code: z.string(),
  name: z.string(),
  feedback: z.string().nullable(),
  evidence: z.array(evidenceSchema),
  findings: z.array(behavioralFindingSchema),
  scoringRubric: rubricSchema,
})

const competencyFeedbackSchema = z.discriminatedUnion('assessmentStatus', [
  competencyFeedbackBaseSchema.extend({
    assessmentStatus: assessmentStatusSchema.extract([
      'observed',
      'opportunity_missed',
    ]),
    score: z.number().int().min(0).max(100),
    evidence: z.array(evidenceSchema).min(1),
    findings: z.array(behavioralFindingSchema).min(1),
    scoreExplanation: scoreExplanationSchema,
  }),
  competencyFeedbackBaseSchema.extend({
    assessmentStatus: assessmentStatusSchema.extract(['not_assessed']),
    score: z.null(),
    findings: z.array(behavioralFindingSchema).length(0),
    evidence: z.array(evidenceSchema).length(0),
    scoreExplanation: z.null(),
  }),
])

const objectionOutcomeSchema = z.object({
  key: z.string(),
  raised: z.boolean(),
  handling: z.enum(['handled', 'partially_handled', 'not_handled']).optional(),
  evidence: z.array(evidenceSchema),
})

export const practiceFeedbackResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not-requested') }),
  z.object({ state: z.literal('pending') }),
  z.object({
    state: z.literal('failed'),
    errorCode: z.string().optional(),
  }),
  z.object({
    state: z.literal('ready'),
    overallScore: z.number().int().min(0).max(100).nullable(),
    assessmentCoverage: z.object({
      assessedCount: z.number().int().nonnegative(),
      totalCount: z.number().int().nonnegative(),
      weightedPercent: z.number().min(0).max(100),
    }),
    summary: z.string(),
    summaryFindings: z.array(feedbackStatementSchema),
    strengths: z.array(feedbackStatementSchema),
    improvements: z.array(feedbackStatementSchema),
    keyCoachingPoint: feedbackStatementSchema.nullable(),
    discoveredInsightKeys: z.array(z.string()),
    missedInsightKeys: z.array(z.string()),
    objectiveOutcome: z
      .enum(['achieved', 'partially_achieved', 'not_achieved'])
      .nullable(),
    objectiveFeedback: z.string().nullable(),
    objectiveEvidence: z.array(evidenceSchema),
    objectionOutcomes: z.array(objectionOutcomeSchema),
    competencyScores: z.array(competencyFeedbackSchema),
    recommendation: z.null(),
  }),
])

export type PracticeFeedbackResult = z.infer<
  typeof practiceFeedbackResultSchema
>

export type FeedbackStatement = z.infer<typeof feedbackStatementSchema>
export type CompetencyFeedback = Extract<
  PracticeFeedbackResult,
  { state: 'ready' }
>['competencyScores'][number]
