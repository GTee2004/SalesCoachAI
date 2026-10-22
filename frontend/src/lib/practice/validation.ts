import { z } from 'zod'
import { BUYER_FIELDS } from '#/db/schema'
import { assessmentStatusSchema } from './assessment'
import { OFFERING_AS_OF_PATTERN } from './offering'

const text = z.string().trim().min(1)
export const currencySchema = z.literal('VND')

export const addressTermSchema = z.enum([
  'anh',
  'chị',
  'cô',
  'chú',
  'bác',
  'em',
])
export const emotionalStateSchema = z.enum([
  'friendly',
  'neutral',
  'guarded',
  'impatient',
  'hostile',
])

const motivationSchema = z.object({
  type: z.enum(['own_use', 'investment', 'mixed']),
  detail: text,
})
const budgetSchema = z.object({
  min: z.number().nonnegative().optional(),
  max: z.number().positive(),
  currency: currencySchema,
  fundingSource: z.string().optional(),
  detail: z.string().optional(),
})
const decisionMakerSchema = z.object({
  role: z.enum([
    'sole_decision_maker',
    'joint_with_spouse',
    'family_decision',
    'influencer',
  ]),
  detail: z.string().optional(),
})
const urgencySchema = z.object({
  level: z.enum(['low', 'medium', 'high']),
  timeline: z.string().optional(),
  driver: z.string().optional(),
})

export const buyerProfileSchema = z.object({
  name: text,
  addressTerm: addressTermSchema,
  gender: z.enum(['male', 'female']),
  age: z.number().int().min(18).max(100),
  occupation: z.string().optional(),
  familySituation: z.string().optional(),
  motivation: motivationSchema,
  budget: budgetSchema,
  priorities: z.array(text).min(1),
  decisionMaker: decisionMakerSchema,
  urgency: urgencySchema,
  emotionalState: emotionalStateSchema,
  communicationStyle: z.array(text).optional(),
  voice: z
    .object({
      voiceId: z.string().optional(),
      speakingStyle: z.string().optional(),
      pace: z.enum(['slow', 'normal', 'fast']).optional(),
    })
    .optional(),
})

export const buyerFieldSchema = z.enum(BUYER_FIELDS)

export const previousInteractionSchema = z.object({
  when: text,
  channel: z.enum(['phone', 'zalo', 'showroom', 'site_visit', 'event']),
  summary: text,
  agreedNextStep: z.string().optional(),
})

export const learnerBriefSchema = z.object({
  background: text,
  leadSource: z.string().optional(),
  previousInteractions: z.array(previousInteractionSchema).optional(),
  objective: text,
})

export const salesOfferingSchema = z.object({
  productType: z.enum([
    'apartment',
    'townhouse',
    'villa',
    'shophouse',
    'land',
    'other',
  ]),
  projectName: text,
  developer: z.string().optional(),
  location: z.object({
    district: text,
    city: text,
    address: z.string().optional(),
    highlights: z.array(text).optional(),
  }),
  unit: z.object({
    bedrooms: z.number().int().nonnegative().optional(),
    bathrooms: z.number().int().nonnegative().optional(),
    areaM2: z.number().positive(),
    floor: z.string().optional(),
    view: z.string().optional(),
    furnishing: z.string().optional(),
  }),
  price: z.object({
    amount: z.number().positive(),
    currency: currencySchema,
    pricePerM2: z.number().positive().optional(),
    note: z.string().optional(),
  }),
  paymentPlan: z.object({
    summary: text,
    milestones: z
      .array(
        z.object({
          label: text,
          percent: z.number().min(0).max(100),
          timing: text,
        }),
      )
      .optional(),
    loanSupport: z.string().optional(),
    promotions: z.array(text).optional(),
  }),
  handover: z.string().optional(),
  legalStatus: z.string().optional(),
  asOf: z.string().regex(OFFERING_AS_OF_PATTERN).optional(),
  keyStrengths: z.array(text).min(1),
  keyWeaknesses: z.array(text).min(1),
  competitors: z.array(z.object({ name: text, comparison: text })).optional(),
})

export const hiddenInsightSchema = z.object({
  key: text,
  insight: text,
  revealGuidance: z.string().optional(),
  relatesTo: buyerFieldSchema.optional(),
})

export const objectionSpecSchema = z.object({
  key: text,
  category: z.enum([
    'brush_off',
    'not_interested',
    'timing',
    'price',
    'trust',
    'product',
    'decision_authority',
    'competitor',
  ]),
  sampleWording: text,
  underlyingReason: z.string().optional(),
  raiseGuidance: text,
  resolutionGuidance: text,
})

const base = {
  buyer: buyerProfileSchema,
  learnerKnows: z.array(buyerFieldSchema).default([]),
  privateBackground: text,
  hiddenInsights: z.array(hiddenInsightSchema).default([]),
  objections: z.array(objectionSpecSchema).default([]),
  openingLine: z.string().trim().min(1).optional(),
  hangUpGuidance: z.string().optional(),
  behaviorRules: z.array(text),
  successCriteria: z.array(text).min(1),
  recollection: text,
}
export const agentConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cold_call'),
    ...base,
  }),
  z.object({
    kind: z.literal('warm_call'),
    sinceLastContact: text,
    ...base,
  }),
])
export type ParsedLearnerBrief = z.infer<typeof learnerBriefSchema>
export type ParsedAgentConfig = z.infer<typeof agentConfigSchema>

const ruleId = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*$/)
export const rubricSchema = z
  .strictObject({
    description: text,
    behaviors: z
      .array(z.strictObject({ id: ruleId, description: text }))
      .min(1),
    levels: z
      .array(
        z.strictObject({
          id: ruleId,
          label: text,
          score: z.number().int().min(0).max(100),
          requiredBehaviorIds: z.array(ruleId),
        }),
      )
      .min(2),
    criticalErrors: z.array(
      z.strictObject({
        id: ruleId,
        description: text,
        scoreCap: z.number().int().min(0).max(100),
      }),
    ),
  })
  .superRefine((rubric, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message })
    for (const collection of [
      'behaviors',
      'levels',
      'criticalErrors',
    ] as const) {
      const ids = rubric[collection].map((item) => item.id)
      if (new Set(ids).size !== ids.length)
        issue([collection], 'Rule IDs must be unique')
    }
    const behaviors = new Set(rubric.behaviors.map((item) => item.id))
    rubric.levels.forEach((level, index) => {
      if (
        index === 0 &&
        (level.score !== 0 || level.requiredBehaviorIds.length)
      )
        issue(
          ['levels', index],
          'First level must score 0 and require no behaviors',
        )
      if (
        index > 0 &&
        (level.score <= rubric.levels[index - 1].score ||
          !level.requiredBehaviorIds.length)
      )
        issue(
          ['levels', index],
          'Levels must have increasing scores and explicit required behaviors',
        )
      if (
        new Set(level.requiredBehaviorIds).size !==
          level.requiredBehaviorIds.length ||
        level.requiredBehaviorIds.some((id) => !behaviors.has(id))
      )
        issue(
          ['levels', index, 'requiredBehaviorIds'],
          'Required behaviors must be unique known IDs',
        )
    })
  })

export const evidenceSchema = z.strictObject({
  turnNumber: z.number().int().positive(),
  quote: z.string().min(1).optional(),
  observation: text,
})
export const behavioralFindingSchema = z
  .strictObject({
    id: ruleId,
    kind: z.enum([
      'demonstrated',
      'attempted',
      'opportunity_missed',
      'critical_error',
    ]),
    behaviorId: ruleId.optional(),
    criticalErrorId: ruleId.optional(),
    rationale: text,
    evidence: z.array(evidenceSchema).min(1),
    opportunityTurnNumbers: z.array(z.number().int().positive()),
    responseTurnNumbers: z.array(z.number().int().positive()),
  })
  .superRefine((finding, ctx) => {
    const invalid = (message: string) =>
      ctx.addIssue({ code: 'custom', message })
    if (finding.kind === 'critical_error') {
      if (!finding.criticalErrorId || finding.behaviorId)
        invalid('Critical findings require only a critical-error rule ID')
    } else if (!finding.behaviorId || finding.criticalErrorId)
      invalid('Behavior findings require only a behavior rule ID')
    const opportunities = finding.opportunityTurnNumbers.length > 0
    const responses = finding.responseTurnNumbers.length > 0
    if (
      opportunities !== responses ||
      (finding.kind === 'opportunity_missed' && !opportunities) ||
      ((finding.kind === 'demonstrated' || finding.kind === 'attempted') &&
        (opportunities || responses))
    )
      invalid(
        'Missed behaviors require opportunity and response turns; demonstrated behaviors do not',
      )
  })

export const evaluationSchema = z.strictObject({
  discoveredInsightKeys: z.array(text),
  missedInsightKeys: z.array(text),
  objectiveOutcome: z
    .enum(['achieved', 'partially_achieved', 'not_achieved'])
    .optional(),
  objectiveEvidence: z.array(evidenceSchema),
  objectionOutcomes: z.array(
    z.strictObject({
      key: text,
      raised: z.boolean(),
      handling: z
        .enum(['handled', 'partially_handled', 'not_handled'])
        .optional(),
      evidence: z.array(evidenceSchema),
    }),
  ),
  competencyAssessments: z.array(
    z
      .strictObject({
        competencyCode: text,
        assessmentStatus: assessmentStatusSchema,
        findings: z.array(behavioralFindingSchema),
      })
      .superRefine((assessment, ctx) => {
        const issue = (message: string) =>
          ctx.addIssue({ code: 'custom', message })
        const { findings, assessmentStatus } = assessment
        if (
          new Set(findings.map((finding) => finding.id)).size !==
          findings.length
        )
          issue('Finding IDs must be unique within a competency')
        if (assessmentStatus === 'not_assessed' && findings.length)
          issue('Unassessed skills cannot contain findings')
        if (
          assessmentStatus === 'observed' &&
          !findings.some((finding) => finding.kind !== 'opportunity_missed')
        )
          issue(
            'Observed skills require a demonstrated or attempted behavior or critical error',
          )
        if (
          assessmentStatus === 'opportunity_missed' &&
          (!findings.some((finding) => finding.kind === 'opportunity_missed') ||
            findings.some(
              (finding) =>
                finding.kind === 'demonstrated' || finding.kind === 'attempted',
            ))
        )
          issue(
            'Missed-opportunity skills require omissions and cannot contain performed behaviors',
          )
      }),
  ),
})
export type Evaluation = z.infer<typeof evaluationSchema>
