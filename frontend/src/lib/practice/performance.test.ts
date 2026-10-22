import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BehavioralFinding, CompetencyRubric } from '#/db/schema'
import { buildPerformanceSummary } from './performance'
import type {
  PerformanceCatalogPractice,
  PerformanceDifficulty,
  PerformanceSessionRecord,
} from './performance'

const now = new Date('2026-10-06T12:00:00Z')
const rubric: CompetencyRubric = {
  description: 'Explore needs',
  behaviors: [
    { id: 'budget', description: 'Ask and confirm budget' },
    { id: 'purpose', description: 'Ask the purchase purpose' },
  ],
  levels: [
    { id: 'none', label: 'None', score: 0, requiredBehaviorIds: [] },
    { id: 'one', label: 'One', score: 40, requiredBehaviorIds: ['budget'] },
    {
      id: 'two',
      label: 'Two',
      score: 90,
      requiredBehaviorIds: ['budget', 'purpose'],
    },
  ],
  criticalErrors: [],
}
const catalog: PerformanceCatalogPractice[] = [
  {
    id: 'practice-a',
    title: 'Budget practice',
    type: 'cold_call',
    difficulty: 'beginner',
    competencyCodes: ['discovery'],
  },
  {
    id: 'practice-b',
    title: 'Advanced budget practice',
    type: 'cold_call',
    difficulty: 'advanced',
    competencyCodes: ['discovery'],
  },
]
function finding(
  id: string,
  kind: BehavioralFinding['kind'],
  behaviorId: string,
): BehavioralFinding {
  return {
    id,
    kind,
    behaviorId,
    rationale: `Rationale ${id}`,
    evidence:
      kind === 'opportunity_missed'
        ? [
            { turnNumber: 3, observation: 'Buyer mentioned budget' },
            { turnNumber: 7, observation: 'Learner moved on' },
          ]
        : [
            {
              turnNumber: 7,
              quote: 'What is your budget?',
              observation: 'Budget question',
            },
          ],
    opportunityTurnNumbers: kind === 'opportunity_missed' ? [3] : [],
    responseTurnNumbers: kind === 'opportunity_missed' ? [7] : [],
  }
}
function record(
  id: string,
  completedAt: string,
  findings: BehavioralFinding[] = [finding('f', 'demonstrated', 'budget')],
  difficulty: PerformanceDifficulty = 'beginner',
): PerformanceSessionRecord {
  return {
    id,
    userId: 'learner',
    practiceId: difficulty === 'beginner' ? 'practice-a' : 'practice-b',
    status: 'completed',
    deletedAt: null,
    createdAt: completedAt,
    startedAt: new Date(Date.parse(completedAt) - 300_000).toISOString(),
    completedAt,
    context: {
      practice: {
        id: difficulty === 'beginner' ? 'practice-a' : 'practice-b',
        title: 'Budget practice',
        type: 'cold_call',
        difficulty,
      },
      objections: [{ key: 'price', category: 'price' }],
    },
    transcript: [
      { sequence: 3, speaker: 'assistant', text: 'My budget is limited.' },
      { sequence: 7, speaker: 'user', text: 'What is your budget?' },
    ],
    evaluation: {
      discoveredInsightKeys: ['budget'],
      missedInsightKeys: ['timing'],
      objectiveOutcome: 'achieved',
      objectiveEvidence: [],
      objectionOutcomes: [{ key: 'price', raised: true, handling: 'handled' }],
      scores: [
        {
          code: 'discovery',
          name: 'Discovery',
          weight: 100,
          assessmentStatus: findings.some(
            (item) => item.kind !== 'opportunity_missed',
          )
            ? 'observed'
            : 'opportunity_missed',
          rubric,
          findings,
        },
      ],
    },
  }
}

test('recent boundary, ownership, deletion and chronological event order', () => {
  const first = record('early', '2026-08-07T12:00:00.000Z')
  const latest = record('late', '2026-10-05T12:00:00.000Z')
  const old = record('old', '2026-08-07T11:59:59.999Z')
  const other = { ...record('other', latest.completedAt!), userId: 'other' }
  const removed = {
    ...record('deleted', latest.completedAt!),
    deletedAt: latest.completedAt,
  }
  const unfinished = {
    ...record('unfinished', latest.completedAt!),
    status: 'in_progress',
  }
  const summary = buildPerformanceSummary(
    'learner',
    [latest, old, other, removed, unfinished, first],
    [],
    'recent',
    null,
    now,
  )
  assert.equal(summary.activity.completedSessions, 2)
  assert.equal(summary.activity.practiceMinutes, 10)
  assert.deepEqual(
    summary.skills[0].points.map((point) => point.sessionId),
    ['early', 'late'],
  )
  assert.equal(
    buildPerformanceSummary(
      'learner',
      [latest, old, first],
      [],
      'all',
      null,
      now,
    ).activity.completedSessions,
    3,
  )
})

test('stored findings are re-scored by behavior count, in any order', () => {
  const later = record('later', '2026-10-01T12:00:00.000Z', [
    finding('f', 'demonstrated', 'purpose'),
  ])
  const both = record('both', '2026-10-02T12:00:00.000Z', [
    finding('a', 'demonstrated', 'purpose'),
    finding('b', 'demonstrated', 'budget'),
  ])
  const summary = buildPerformanceSummary(
    'learner',
    [later, both],
    [],
    'all',
    null,
    now,
  )
  assert.deepEqual(
    summary.skills[0].points.map((point) => point.score),
    [40, 90],
  )
  assert.deepEqual(summary.skills[0].behaviors, [
    {
      id: 'budget',
      description: 'Ask and confirm budget',
      demonstrated: 1,
      sessions: 2,
    },
    {
      id: 'purpose',
      description: 'Ask the purchase purpose',
      demonstrated: 2,
      sessions: 2,
    },
  ])
})

test('unassessed skills and unevaluated sessions never produce zero points', () => {
  const assessed = record('assessed', '2026-10-01T12:00:00.000Z')
  const unassessed = record('unassessed', assessed.completedAt!, [])
  unassessed.evaluation!.scores[0].assessmentStatus = 'not_assessed'
  unassessed.evaluation!.objectiveOutcome = null
  const awaiting = {
    ...record('awaiting', assessed.completedAt!),
    evaluation: null,
  }
  const summary = buildPerformanceSummary(
    'learner',
    [assessed, unassessed, awaiting],
    [],
    'recent',
    null,
    now,
  )
  assert.equal(summary.activity.awaitingEvaluation, 1)
  assert.equal(summary.skills[0].assessedSessions, 1)
  assert.equal(summary.skills[0].totalSessions, 2)
  assert.deepEqual(
    summary.skills[0].points.map((point) => point.score),
    [40],
  )
  assert.deepEqual(summary.activity.objective, {
    assessed: 1,
    achieved: 1,
    partiallyAchieved: 0,
  })
})

test('missing practice references stay separate and never become focus', () => {
  const missed = [finding('m', 'opportunity_missed', 'purpose')]
  const a = record('a', '2026-10-01T12:00:00.000Z', missed),
    b = record('b', '2026-10-02T12:00:00.000Z', missed)
  a.context = null
  b.context = null
  const summary = buildPerformanceSummary(
    'learner',
    [a, b],
    catalog,
    'all',
    null,
    now,
  )
  assert.equal(summary.historicalContextCount, 2)
  assert.equal(summary.skills.length, 2)
  assert.equal(summary.skills[0].callType, null)
  assert.deepEqual(summary.focus, [])
})

test('focus counts distinct sessions, prefers key points and cites the latest example', () => {
  const missed = finding('m', 'opportunity_missed', 'purpose')
  const a = record('a', '2026-10-01T12:00:00.000Z', [
    missed,
    { ...missed, id: 'repeat' },
  ])
  const b = record('b', '2026-10-02T12:00:00.000Z', [
    { ...missed, rationale: 'Latest rationale' },
  ])
  const summary = buildPerformanceSummary(
    'learner',
    [b, a],
    catalog,
    'recent',
    null,
    now,
  )
  assert.equal(summary.focus.length, 1)
  assert.equal(summary.focus[0].ruleDescription, 'Ask the purchase purpose')
  assert.equal(summary.focus[0].sessions, 2)
  assert.equal(summary.focus[0].keyPointSessions, 2)
  assert.equal(summary.focus[0].example.sessionId, 'b')
  assert.equal(summary.focus[0].example.rationale, 'Latest rationale')
  assert.deepEqual(summary.focus[0].example.turn, {
    sequence: 7,
    displayNumber: 2,
    quote: 'What is your budget?',
  })
  assert.equal(summary.focus[0].practice?.id, 'practice-a')
  assert.deepEqual(summary.strengths, [])
})

test('recurring demonstrated behaviors become strengths', () => {
  const a = record('a', '2026-10-01T12:00:00.000Z'),
    b = record('b', '2026-10-02T12:00:00.000Z')
  const summary = buildPerformanceSummary(
    'learner',
    [a, b],
    catalog,
    'all',
    null,
    now,
  )
  assert.deepEqual(summary.strengths, [
    {
      id: 'strength_1',
      competencyName: 'Discovery',
      callType: 'cold_call',
      ruleDescription: 'Ask and confirm budget',
      sessions: 2,
    },
  ])
})

test('difficulty filter narrows sessions and suggested practices', () => {
  const missed = [finding('m', 'opportunity_missed', 'purpose')]
  const sessions = [
    record('a', '2026-10-01T12:00:00.000Z', missed),
    record('b', '2026-10-02T12:00:00.000Z', missed, 'advanced'),
    record('c', '2026-10-03T12:00:00.000Z', missed, 'advanced'),
  ]
  const summary = buildPerformanceSummary(
    'learner',
    sessions,
    catalog,
    'all',
    'advanced',
    now,
  )
  assert.deepEqual(summary.difficulties, [
    { value: 'beginner', sessions: 1 },
    { value: 'advanced', sessions: 2 },
  ])
  assert.equal(summary.activity.completedSessions, 2)
  assert.ok(
    summary.skills[0].points.every((point) => point.difficulty === 'advanced'),
  )
  assert.equal(summary.focus[0].practice?.id, 'practice-b')
})

test('outcome rates use raised objections and evaluated insights', () => {
  const a = record('a', '2026-10-01T12:00:00.000Z'),
    b = record('b', '2026-10-02T12:00:00.000Z'),
    c = record('c', '2026-10-03T12:00:00.000Z')
  b.evaluation!.objectionOutcomes[0].handling = 'partially_handled'
  b.evaluation!.objectiveOutcome = 'partially_achieved'
  c.evaluation!.objectionOutcomes[0] = { key: 'price', raised: false }
  c.evaluation!.objectiveOutcome = null
  const summary = buildPerformanceSummary(
    'learner',
    [a, b, c],
    [],
    'all',
    null,
    now,
  )
  assert.deepEqual(summary.outcomes.objections, [
    {
      category: 'price',
      raised: 2,
      handled: 1,
      partiallyHandled: 1,
      notHandled: 0,
    },
  ])
  assert.deepEqual(summary.outcomes.insights, { discovered: 3, total: 6 })
  assert.deepEqual(summary.activity.objective, {
    assessed: 2,
    achieved: 1,
    partiallyAchieved: 1,
  })
})

test('unsupported quotes never become focus or strengths', () => {
  const invented = finding('f', 'demonstrated', 'budget')
  invented.evidence[0].quote = 'Invented quote'
  const a = record('a', '2026-10-01T12:00:00.000Z', [invented]),
    b = record('b', '2026-10-02T12:00:00.000Z', [invented])
  const summary = buildPerformanceSummary(
    'learner',
    [a, b],
    catalog,
    'all',
    null,
    now,
  )
  assert.deepEqual(summary.strengths, [])
  assert.deepEqual(summary.focus, [])
})

test('a behavior still in focus is not listed as a strength', () => {
  const missed = [finding('m', 'opportunity_missed', 'budget')]
  const sessions = [
    record('a', '2026-10-01T12:00:00.000Z'),
    record('b', '2026-10-02T12:00:00.000Z'),
    record('c', '2026-10-03T12:00:00.000Z', missed),
    record('d', '2026-10-04T12:00:00.000Z', missed),
  ]
  const summary = buildPerformanceSummary(
    'learner',
    sessions,
    catalog,
    'all',
    null,
    now,
  )
  assert.equal(summary.focus[0].ruleDescription, 'Ask and confirm budget')
  assert.deepEqual(summary.strengths, [])
})
