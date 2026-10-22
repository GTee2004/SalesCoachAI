import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BehavioralFinding, CompetencyRubric } from '#/db/schema'
import { calculateEvaluation } from './scoring'
import { rubricSchema } from './validation'

const rubric: CompetencyRubric = {
  description: 'Explore needs before presenting an offering',
  behaviors: [
    { id: 'ask', description: 'Ask about needs' },
    { id: 'clarify', description: 'Clarify priorities' },
  ],
  levels: [
    {
      id: 'none',
      label: 'No supported behavior',
      score: 0,
      requiredBehaviorIds: [],
    },
    {
      id: 'basic',
      label: 'Asked about needs',
      score: 40,
      requiredBehaviorIds: ['ask'],
    },
    {
      id: 'complete',
      label: 'Asked and clarified',
      score: 90,
      requiredBehaviorIds: ['ask', 'clarify'],
    },
  ],
  criticalErrors: [
    { id: 'pressure', description: 'Pressure after refusal', scoreCap: 30 },
    { id: 'fabrication', description: 'Invent product promise', scoreCap: 0 },
  ],
}
const criteria = [{ code: 'discovery', name: 'Discovery', rubric }]
const turns = [
  {
    sequence: 3,
    speaker: 'assistant' as const,
    text: 'What can you offer for my budget?',
  },
  {
    sequence: 7,
    speaker: 'user' as const,
    text: 'What are your needs? What matters most?',
  },
  { sequence: 11, speaker: 'user' as const, text: 'I guarantee a return.' },
]
function demonstrated(id: string, behaviorId: string): BehavioralFinding {
  return {
    id,
    kind: 'demonstrated',
    behaviorId,
    rationale: `Supported ${behaviorId}`,
    evidence: [
      {
        turnNumber: 7,
        quote: 'What are your needs?',
        observation: 'Learner asked a question',
      },
    ],
    opportunityTurnNumbers: [],
    responseTurnNumbers: [],
  }
}
function evaluate(
  findings: BehavioralFinding[],
  assessmentStatus = 'observed',
) {
  return calculateEvaluation(
    {
      discoveredInsightKeys: [],
      missedInsightKeys: [],
      objectiveEvidence: [],
      objectionOutcomes: [],
      competencyAssessments: [
        { competencyCode: 'discovery', assessmentStatus, findings },
      ],
    },
    criteria,
    turns,
    [],
    [],
  )
}

test('demonstrated behaviors count in any order; duplicates cannot add points', () => {
  assert.equal(
    evaluate([demonstrated('a', 'ask')]).competencyScores[0].score,
    40,
  )
  const later = evaluate([demonstrated('a', 'clarify')]).competencyScores[0]
  assert.equal(later.score, 40)
  assert.deepEqual(later.scoreExplanation?.requiredBehaviorIds, ['clarify'])
  assert.equal(
    evaluate([demonstrated('a', 'ask'), demonstrated('b', 'ask')])
      .competencyScores[0].score,
    40,
  )
  const result = evaluate([
    demonstrated('a', 'ask'),
    demonstrated('b', 'clarify'),
  ])
  assert.equal(result.competencyScores[0].score, 90)
  assert.deepEqual(result.competencyScores[0].scoreExplanation?.findingIds, [
    'discovery:a',
    'discovery:b',
  ])
  assert.deepEqual(result.strengths[0], {
    text: 'Discovery: Supported ask',
    turnNumbers: [7],
    findingIds: ['discovery:a'],
  })
})

test('a weak attempted behavior is assessed but does not earn its anchor', () => {
  const finding = {
    ...demonstrated('weak', 'ask'),
    kind: 'attempted' as const,
    rationale: 'Question did not explore needs',
  }
  const result = evaluate([finding])
  assert.equal(result.competencyScores[0].score, 0)
  assert.equal(result.competencyScores[0].assessmentStatus, 'observed')
  assert.deepEqual(result.improvements[0].findingIds, ['discovery:weak'])
  assert.deepEqual(result.strengths, [])
})

test('strictest triggered cap wins and retains auditable rule and finding proof', () => {
  const findings = [demonstrated('a', 'ask'), demonstrated('b', 'clarify')]
  for (const criticalErrorId of ['pressure', 'fabrication'])
    findings.push({
      id: criticalErrorId,
      kind: 'critical_error',
      criticalErrorId,
      rationale: criticalErrorId,
      evidence: [
        { turnNumber: 11, observation: 'Unsupported promise or pressure' },
      ],
      opportunityTurnNumbers: [],
      responseTurnNumbers: [],
    })
  const result = evaluate(findings)
  assert.equal(result.competencyScores[0].scoreExplanation?.baseScore, 90)
  assert.equal(result.competencyScores[0].score, 0)
  assert.deepEqual(result.competencyScores[0].scoreExplanation.appliedCaps, [
    {
      criticalErrorId: 'pressure',
      scoreCap: 30,
      findingIds: ['discovery:pressure'],
    },
    {
      criticalErrorId: 'fabrication',
      scoreCap: 0,
      findingIds: ['discovery:fabrication'],
    },
  ])
  assert.deepEqual(result.keyCoachingPoint?.findingIds, ['discovery:pressure'])
})

test('omissions require opportunity and a later learner response; unassessed stays null', () => {
  const missed: BehavioralFinding = {
    id: 'missed',
    kind: 'opportunity_missed',
    behaviorId: 'ask',
    rationale: 'Ignored budget question',
    evidence: [
      { turnNumber: 3, observation: 'Buyer requested budget discussion' },
      { turnNumber: 7, observation: 'Learner did not address budget' },
    ],
    opportunityTurnNumbers: [3],
    responseTurnNumbers: [7],
  }
  const result = evaluate([missed], 'opportunity_missed')
  assert.equal(result.competencyScores[0].score, 0)
  assert.deepEqual(result.improvements[0].turnNumbers, [3, 7])
  assert.equal(evaluate([], 'not_assessed').competencyScores[0].score, null)
  assert.equal(
    evaluate([], 'not_assessed').competencyScores[0].scoreExplanation,
    null,
  )
  assert.throws(
    () =>
      evaluate([{ ...missed, responseTurnNumbers: [3] }], 'opportunity_missed'),
    /subsequent learner/,
  )
  assert.throws(() =>
    evaluate([{ ...missed, responseTurnNumbers: [] }], 'opportunity_missed'),
  )
})

test('unknown rules, invented or buyer-only evidence, free scores and narrative are rejected', () => {
  assert.throws(
    () => evaluate([demonstrated('a', 'unknown')]),
    /unknown rubric rule/,
  )
  const finding = demonstrated('a', 'ask')
  assert.throws(
    () =>
      evaluate([
        { ...finding, evidence: [{ turnNumber: 99, observation: 'Invented' }] },
      ]),
    /unknown transcript turn/,
  )
  assert.throws(
    () =>
      evaluate([
        {
          ...finding,
          evidence: [{ turnNumber: 3, observation: 'Buyer spoke' }],
        },
      ]),
    /learner evidence/,
  )
  assert.throws(
    () =>
      evaluate([
        {
          ...finding,
          evidence: [
            { turnNumber: 7, quote: 'Invented', observation: 'Mismatch' },
          ],
        },
      ]),
    /quote/,
  )
  assert.throws(() =>
    calculateEvaluation(
      { summary: 'Perfect', competencyScores: [{ score: 100 }] },
      criteria,
      [],
      [],
      [],
    ),
  )
})

test('rubric anchors and critical-error rules reject ambiguous numeric policy', () => {
  assert.equal(rubricSchema.safeParse(rubric).success, true)
  assert.equal(
    rubricSchema.safeParse({
      ...rubric,
      levels: [{ ...rubric.levels[0], score: 10 }, ...rubric.levels.slice(1)],
    }).success,
    false,
  )
  assert.equal(
    rubricSchema.safeParse({
      ...rubric,
      levels: [
        rubric.levels[0],
        { ...rubric.levels[1], requiredBehaviorIds: ['unknown'] },
      ],
    }).success,
    false,
  )
  assert.equal(
    rubricSchema.safeParse({
      ...rubric,
      criticalErrors: [{ id: 'mistake', description: 'No cap' }],
    }).success,
    false,
  )
})
