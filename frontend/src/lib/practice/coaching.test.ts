import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BehavioralFinding } from '#/db/schema'
import { pickKeyCoachingPoint } from './coaching'

function finding(
  id: string,
  kind: BehavioralFinding['kind'],
  turns: number[],
): BehavioralFinding {
  return {
    id,
    kind,
    ...(kind === 'critical_error'
      ? { criticalErrorId: id }
      : { behaviorId: id }),
    rationale: `Rationale ${id}`,
    evidence: turns.map((turnNumber) => ({
      turnNumber,
      observation: `Turn ${turnNumber}`,
    })),
    opportunityTurnNumbers: [],
    responseTurnNumbers: [],
  }
}

const evidence = (turns: number[]) =>
  turns.map((turnNumber) => ({ turnNumber, observation: 'Seen' }))

// Mirrors a cold call where the buyer refused a pitch, the learner kept
// asking discovery questions and the buyer hung up.
const competencies = [
  {
    code: 'needs_discovery',
    name: 'Discovery',
    weight: 25,
    findings: [finding('purchase_purpose', 'attempted', [14, 19])],
  },
  {
    code: 'objection_handling',
    name: 'Objections',
    weight: 20,
    findings: [
      finding('acknowledge', 'opportunity_missed', [6, 9]),
      finding('specific_response', 'opportunity_missed', [14, 16, 19, 21]),
    ],
  },
  {
    code: 'opening_hook',
    name: 'Opening',
    weight: 20,
    findings: [finding('identify_self', 'demonstrated', [5])],
  },
]

test('prefers the finding tied to the failed objective and unhandled objection', () => {
  const point = pickKeyCoachingPoint({
    competencies,
    objectiveOutcome: 'not_achieved',
    objectiveEvidence: evidence([21]),
    objectionOutcomes: [
      {
        raised: true,
        handling: 'partially_handled',
        evidence: evidence([6, 9]),
      },
      { raised: true, handling: 'not_handled', evidence: evidence([14, 21]) },
    ],
  })
  assert.deepEqual(point?.findingIds, ['objection_handling:specific_response'])
  assert.equal(point.text, 'Objections: Rationale specific_response')
  assert.deepEqual(point.turnNumbers, [14, 16, 19, 21])
})

test('critical errors outrank everything; weight breaks remaining ties', () => {
  const withCritical = [
    ...competencies,
    {
      code: 'value_articulation',
      name: 'Value',
      weight: 15,
      findings: [finding('fabricated_promise', 'critical_error', [30])],
    },
  ]
  const outcomes = {
    objectiveOutcome: null,
    objectiveEvidence: [],
    objectionOutcomes: [],
  }
  assert.deepEqual(
    pickKeyCoachingPoint({ competencies: withCritical, ...outcomes })
      ?.findingIds,
    ['value_articulation:fabricated_promise'],
  )
  assert.deepEqual(
    pickKeyCoachingPoint({ competencies, ...outcomes })?.findingIds,
    ['needs_discovery:purchase_purpose'],
  )
  assert.equal(
    pickKeyCoachingPoint({ competencies: [competencies[2]], ...outcomes }),
    null,
  )
})
