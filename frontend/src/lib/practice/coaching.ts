import type {
  BehavioralFinding,
  EvaluationEvidence,
  FeedbackStatement,
} from '#/db/schema'

type ObjectiveOutcome = 'achieved' | 'partially_achieved' | 'not_achieved'
type ObjectionHandling = 'handled' | 'partially_handled' | 'not_handled'

export type CoachingInput = {
  competencies: {
    code: string
    name: string
    weight?: number
    findings: BehavioralFinding[]
  }[]
  objectiveOutcome: ObjectiveOutcome | null
  objectiveEvidence: EvaluationEvidence[]
  objectionOutcomes: {
    raised: boolean
    handling?: ObjectionHandling
    evidence?: EvaluationEvidence[]
  }[]
}

export function findingStatement(
  competency: { code: string; name: string },
  finding: BehavioralFinding,
): FeedbackStatement {
  return {
    text: `${competency.name}: ${finding.rationale}`,
    turnNumbers: [
      ...new Set(finding.evidence.map((item) => item.turnNumber)),
    ].sort((a, b) => a - b),
    findingIds: [`${competency.code}:${finding.id}`],
  }
}

/**
 * The one improvement worth remembering: critical errors first, then the
 * finding most tied to what went wrong in the call (an unmet objective or a
 * poorly handled objection, sharing evidence turns), then the heavier skill.
 */
export function pickKeyCoachingPoint(
  input: CoachingInput,
): FeedbackStatement | null {
  const failures = [
    ...(input.objectiveOutcome && input.objectiveOutcome !== 'achieved'
      ? [
          {
            severity: input.objectiveOutcome === 'not_achieved' ? 2 : 1,
            evidence: input.objectiveEvidence,
          },
        ]
      : []),
    ...input.objectionOutcomes
      .filter((outcome) => outcome.raised && outcome.handling !== 'handled')
      .map((outcome) => ({
        severity: outcome.handling === 'not_handled' ? 2 : 1,
        evidence: outcome.evidence ?? [],
      })),
  ].map((failure) => ({
    severity: failure.severity,
    turns: new Set(failure.evidence.map((item) => item.turnNumber)),
  }))
  const candidates = input.competencies.flatMap((competency) =>
    competency.findings
      .filter((finding) => finding.kind !== 'demonstrated')
      .map((finding) => ({
        competency,
        finding,
        critical: finding.kind === 'critical_error' ? 1 : 0,
        relevance: failures
          .filter((failure) =>
            finding.evidence.some((item) => failure.turns.has(item.turnNumber)),
          )
          .reduce((total, failure) => total + failure.severity, 0),
        weight: competency.weight ?? 0,
      })),
  )
  // Stable sort keeps evaluator order as the final tie-break.
  const best = candidates
    .sort(
      (a, b) =>
        b.critical - a.critical ||
        b.relevance - a.relevance ||
        b.weight - a.weight,
    )
    .at(0)
  return best ? findingStatement(best.competency, best.finding) : null
}
