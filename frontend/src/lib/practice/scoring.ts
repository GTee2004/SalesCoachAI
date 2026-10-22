import type {
  BehavioralFinding,
  CompetencyRubric,
  EvaluationEvidence,
  FeedbackStatement,
  ScoreExplanation,
} from '#/db/schema'
import { evaluationSchema, rubricSchema } from './validation'
import type { Evaluation } from './validation'
import type { AssessmentStatus } from './assessment'
import { findingStatement, pickKeyCoachingPoint } from './coaching'

type Criterion = {
  code: string
  name: string
  weight?: number
  rubric: CompetencyRubric
}
type Turn = { sequence: number; speaker: 'user' | 'assistant'; text: string }

export interface CalculatedEvaluation {
  summary: string
  summaryFindings: FeedbackStatement[]
  strengths: FeedbackStatement[]
  improvements: FeedbackStatement[]
  keyCoachingPoint: FeedbackStatement | null
  discoveredInsightKeys: string[]
  missedInsightKeys: string[]
  objectiveOutcome: 'achieved' | 'partially_achieved' | 'not_achieved' | null
  objectiveFeedback: string | null
  objectiveEvidence: EvaluationEvidence[]
  objectionOutcomes: Evaluation['objectionOutcomes']
  competencyScores: {
    competencyCode: string
    score: number | null
    assessmentStatus: AssessmentStatus
    feedback: string | null
    evidence: EvaluationEvidence[]
    findings: BehavioralFinding[]
    scoringRubric: CompetencyRubric
    scoreExplanation: ScoreExplanation | null
  }[]
  recommendation: null
}

function requireExactKeys(actual: string[], expected: string[], label: string) {
  const keys = new Set(expected)
  if (
    actual.length !== keys.size ||
    new Set(actual).size !== actual.length ||
    actual.some((key) => !keys.has(key))
  )
    throw new Error(`Evaluator returned invalid ${label}`)
}

export function calculateEvaluation(
  raw: unknown,
  criteria: Criterion[],
  turns: Turn[],
  insightKeys: string[],
  objectionKeys: string[],
): CalculatedEvaluation {
  const result = evaluationSchema.parse(raw)
  requireExactKeys(
    result.competencyAssessments.map((item) => item.competencyCode),
    criteria.map((item) => item.code),
    'competency codes',
  )
  requireExactKeys(
    [...result.discoveredInsightKeys, ...result.missedInsightKeys],
    insightKeys,
    'insight keys',
  )
  requireExactKeys(
    result.objectionOutcomes.map((item) => item.key),
    objectionKeys,
    'objection keys',
  )
  const transcript = new Map(turns.map((turn) => [turn.sequence, turn]))
  function validateEvidence(evidence: EvaluationEvidence[]) {
    for (const item of evidence) {
      const turn = transcript.get(item.turnNumber)
      if (!turn) throw new Error('Evaluator referenced unknown transcript turn')
      if (item.quote && !turn.text.includes(item.quote))
        throw new Error('Evaluator quote does not match transcript')
    }
  }
  function hasLearnerEvidence(evidence: EvaluationEvidence[]) {
    return evidence.some(
      (item) => transcript.get(item.turnNumber)?.speaker === 'user',
    )
  }
  function validateOpportunity(finding: BehavioralFinding) {
    const {
      opportunityTurnNumbers: opportunities,
      responseTurnNumbers: responses,
    } = finding
    if (!opportunities.length && !responses.length) return
    const evidenceTurns = new Set(
      finding.evidence.map((item) => item.turnNumber),
    )
    if (
      [...opportunities, ...responses].some(
        (sequence) => !evidenceTurns.has(sequence),
      ) ||
      new Set(opportunities).size !== opportunities.length ||
      new Set(responses).size !== responses.length ||
      responses.some(
        (sequence) =>
          transcript.get(sequence)?.speaker !== 'user' ||
          !opportunities.some((opportunity) => sequence > opportunity),
      )
    )
      throw new Error(
        'Missed behavior requires evidenced opportunity and subsequent learner response turns',
      )
  }
  validateEvidence(result.objectiveEvidence)
  if (result.objectiveOutcome) {
    if (
      !result.objectiveEvidence.length ||
      (result.objectiveOutcome !== 'not_achieved' &&
        !hasLearnerEvidence(result.objectiveEvidence))
    )
      throw new Error(
        'Objective judgment requires relevant transcript evidence',
      )
  } else if (result.objectiveEvidence.length)
    throw new Error('Unassessed objective cannot contain evidence')
  for (const outcome of result.objectionOutcomes) {
    validateEvidence(outcome.evidence)
    if (!outcome.raised) {
      if (outcome.handling || outcome.evidence.length)
        throw new Error(
          'Unraised objection cannot contain handling or evidence',
        )
      continue
    }
    const buyerTurns = outcome.evidence.filter(
      (item) => transcript.get(item.turnNumber)?.speaker === 'assistant',
    )
    if (!outcome.handling || !buyerTurns.length)
      throw new Error(
        'Raised objections require buyer evidence and handling outcome',
      )
    if (
      outcome.handling !== 'not_handled' &&
      !outcome.evidence.some(
        (item) =>
          transcript.get(item.turnNumber)?.speaker === 'user' &&
          buyerTurns.some((buyer) => item.turnNumber > buyer.turnNumber),
      )
    )
      throw new Error('Handled objections require subsequent learner evidence')
  }

  const summaryFindings: FeedbackStatement[] = []
  const strengths: FeedbackStatement[] = []
  const improvements: FeedbackStatement[] = []
  const competencyScores = criteria.map((criterion) => {
    const assessment = result.competencyAssessments.find(
      (item) => item.competencyCode === criterion.code,
    )!
    const rubric = rubricSchema.parse(criterion.rubric)
    const behaviors = new Set(rubric.behaviors.map((item) => item.id))
    const criticalErrors = new Set(rubric.criticalErrors.map((item) => item.id))
    for (const finding of assessment.findings) {
      validateEvidence(finding.evidence)
      if (
        finding.kind === 'critical_error'
          ? !criticalErrors.has(finding.criticalErrorId!)
          : !behaviors.has(finding.behaviorId!)
      )
        throw new Error('Evaluator referenced unknown rubric rule')
      if (
        finding.kind !== 'opportunity_missed' &&
        !hasLearnerEvidence(finding.evidence)
      )
        throw new Error('Behavioral finding requires learner evidence')
      validateOpportunity(finding)
      const statement = findingStatement(criterion, finding)
      summaryFindings.push(statement)
      if (finding.kind === 'demonstrated') strengths.push(statement)
      else improvements.push(statement)
    }
    const { score, scoreExplanation } = scoreCompetency(
      criterion.code,
      rubric,
      assessment.findings,
      assessment.assessmentStatus,
    )
    return {
      competencyCode: criterion.code,
      score,
      assessmentStatus: assessment.assessmentStatus,
      feedback: assessment.findings.length
        ? assessment.findings.map((finding) => finding.rationale).join('\n')
        : null,
      evidence: assessment.findings.flatMap((finding) => finding.evidence),
      findings: assessment.findings,
      scoringRubric: rubric,
      scoreExplanation,
    }
  })
  const assessedCount = competencyScores.filter(
    (item) => item.score !== null,
  ).length
  return {
    summary: `Đã đánh giá ${assessedCount}/${criteria.length} kỹ năng từ bằng chứng hội thoại; các kỹ năng chưa đủ bằng chứng không được chấm điểm.`,
    summaryFindings,
    strengths,
    improvements,
    keyCoachingPoint: pickKeyCoachingPoint({
      competencies: criteria.map((criterion) => ({
        ...criterion,
        findings: result.competencyAssessments.find(
          (item) => item.competencyCode === criterion.code,
        )!.findings,
      })),
      objectiveOutcome: result.objectiveOutcome ?? null,
      objectiveEvidence: result.objectiveEvidence,
      objectionOutcomes: result.objectionOutcomes,
    }),
    discoveredInsightKeys: result.discoveredInsightKeys,
    missedInsightKeys: result.missedInsightKeys,
    objectiveOutcome: result.objectiveOutcome ?? null,
    objectiveFeedback: result.objectiveOutcome
      ? `Kết quả mục tiêu: ${result.objectiveOutcome}.`
      : null,
    objectiveEvidence: result.objectiveEvidence,
    objectionOutcomes: result.objectionOutcomes,
    competencyScores,
    recommendation: null,
  }
}

/**
 * Deterministic score for one skill from its findings and rubric snapshot,
 * so stored evaluations can be re-scored without calling the evaluator.
 */
export function scoreCompetency(
  code: string,
  rubric: CompetencyRubric,
  findings: BehavioralFinding[],
  assessmentStatus: AssessmentStatus,
): { score: number | null; scoreExplanation: ScoreExplanation | null } {
  if (assessmentStatus === 'not_assessed')
    return { score: null, scoreExplanation: null }
  const qualifiedId = (finding: BehavioralFinding) => `${code}:${finding.id}`
  const behaviorIds = new Set(rubric.behaviors.map((item) => item.id))
  const demonstrated = new Set(
    findings
      .filter(
        (finding) =>
          finding.kind === 'demonstrated' &&
          behaviorIds.has(finding.behaviorId!),
      )
      .map((finding) => finding.behaviorId!),
  )
  // Behaviors count in any order: a level is reached by how many distinct
  // behaviors were demonstrated; its listed IDs only set that count.
  const level = rubric.levels
    .filter((item) => item.requiredBehaviorIds.length <= demonstrated.size)
    .at(-1)!
  const appliedCaps = rubric.criticalErrors.flatMap((rule) => {
    const matches = findings.filter(
      (finding) =>
        finding.kind === 'critical_error' &&
        finding.criticalErrorId === rule.id,
    )
    return matches.length
      ? [
          {
            criticalErrorId: rule.id,
            scoreCap: rule.scoreCap,
            findingIds: matches.map(qualifiedId),
          },
        ]
      : []
  })
  return {
    score: Math.min(level.score, ...appliedCaps.map((rule) => rule.scoreCap)),
    scoreExplanation: {
      levelId: level.id,
      levelLabel: level.label,
      baseScore: level.score,
      requiredBehaviorIds: rubric.behaviors
        .map((behavior) => behavior.id)
        .filter((id) => demonstrated.has(id)),
      findingIds: findings
        .filter((finding) => finding.kind === 'demonstrated')
        .map(qualifiedId),
      appliedCaps,
    },
  }
}
