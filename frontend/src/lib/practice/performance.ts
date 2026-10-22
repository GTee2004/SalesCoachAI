import type {
  BehavioralFinding,
  CompetencyRubric,
  EvaluationEvidence,
  PracticeType,
} from '#/db/schema'
import type { AssessmentStatus } from './assessment'
import { pickKeyCoachingPoint } from './coaching'
import { COMPETENCY_CATALOGUE } from './scorecards'
import { scoreCompetency } from './scoring'
import { transcriptDisplayNumbers } from '#/lib/voice/transcript-numbering'

export type PerformancePeriod = 'recent' | 'all'
export type PerformanceDifficulty = 'beginner' | 'intermediate' | 'advanced'
type ObjectionHandling = 'handled' | 'partially_handled' | 'not_handled'

export interface PerformanceExample {
  sessionId: string
  practiceTitle: string
  completedAt: string
  difficulty: PerformanceDifficulty | null
  rationale: string
  turn: { sequence: number; displayNumber: number; quote: string } | null
}
export interface PerformanceFocus {
  id: string
  competencyCode: string
  competencyName: string
  callType: PracticeType
  ruleDescription: string
  critical: boolean
  sessions: number
  keyPointSessions: number
  example: PerformanceExample
  practice: {
    id: string
    title: string
    difficulty: PerformanceDifficulty
  } | null
}
export interface PerformanceStrength {
  id: string
  competencyName: string
  callType: PracticeType
  ruleDescription: string
  sessions: number
}
export interface PerformanceSkill {
  id: string
  code: string
  name: string
  callType: PracticeType | null
  totalSessions: number
  assessedSessions: number
  points: {
    sessionId: string
    practiceTitle: string
    completedAt: string
    difficulty: PerformanceDifficulty | null
    score: number
    missed: boolean
  }[]
  behaviors: {
    id: string
    description: string
    demonstrated: number
    sessions: number
  }[]
}
export interface ObjectionRate {
  category: string | null
  raised: number
  handled: number
  partiallyHandled: number
  notHandled: number
}
export interface PerformanceSummary {
  period: PerformancePeriod
  generatedAt: string
  from: string | null
  difficulty: PerformanceDifficulty | null
  difficulties: { value: PerformanceDifficulty; sessions: number }[]
  activity: {
    completedSessions: number
    evaluatedSessions: number
    awaitingEvaluation: number
    practiceMinutes: number
    objective: {
      assessed: number
      achieved: number
      partiallyAchieved: number
    }
  }
  focus: PerformanceFocus[]
  strengths: PerformanceStrength[]
  skills: PerformanceSkill[]
  outcomes: {
    objections: ObjectionRate[]
    insights: { discovered: number; total: number }
  }
  historicalContextCount: number
}
export interface PerformancePracticeContext {
  practice: {
    id: string
    type: PracticeType
    title: string
    difficulty: PerformanceDifficulty
  }
  objections: { key: string; category: string }[]
}
export interface PerformanceSessionRecord {
  id: string
  userId: string
  practiceId: string
  status: string
  deletedAt: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  context: PerformancePracticeContext | null
  transcript: {
    sequence: number
    speaker: 'user' | 'assistant'
    text: string
  }[]
  evaluation: {
    discoveredInsightKeys: string[]
    missedInsightKeys: string[]
    objectiveOutcome: 'achieved' | 'partially_achieved' | 'not_achieved' | null
    objectiveEvidence: EvaluationEvidence[]
    objectionOutcomes: {
      key: string
      raised: boolean
      handling?: ObjectionHandling
      evidence?: EvaluationEvidence[]
    }[]
    scores: {
      code: string
      name: string
      weight: number | null
      assessmentStatus: AssessmentStatus
      findings: BehavioralFinding[]
      rubric: CompetencyRubric
    }[]
  } | null
}
export interface PerformanceCatalogPractice {
  id: string
  title: string
  type: PracticeType
  difficulty: PerformanceDifficulty
  competencyCodes: string[]
}

type Transcript = Map<number, PerformanceSessionRecord['transcript'][number]>

/** A finding is only shown as an example when its transcript evidence holds up. */
function isGrounded(finding: BehavioralFinding, transcript: Transcript) {
  if (
    !finding.evidence.length ||
    finding.evidence.some(
      (item) =>
        !transcript.has(item.turnNumber) ||
        (item.quote &&
          !transcript.get(item.turnNumber)!.text.includes(item.quote)),
    )
  )
    return false
  if (
    finding.kind !== 'opportunity_missed' &&
    !finding.evidence.some(
      (item) => transcript.get(item.turnNumber)!.speaker === 'user',
    )
  )
    return false
  if (finding.kind !== 'opportunity_missed') return true
  const turns = new Set(finding.evidence.map((item) => item.turnNumber))
  return (
    finding.opportunityTurnNumbers.length > 0 &&
    finding.responseTurnNumbers.length > 0 &&
    [...finding.opportunityTurnNumbers, ...finding.responseTurnNumbers].every(
      (sequence) => turns.has(sequence),
    ) &&
    finding.responseTurnNumbers.every(
      (sequence) =>
        transcript.get(sequence)?.speaker === 'user' &&
        finding.opportunityTurnNumbers.some((turn) => sequence > turn),
    )
  )
}

const callOrder = (code: string) => {
  const index = COMPETENCY_CATALOGUE.findIndex((item) => item.code === code)
  return index < 0 ? COMPETENCY_CATALOGUE.length : index
}

export function buildPerformanceSummary(
  userId: string,
  records: PerformanceSessionRecord[],
  catalog: PerformanceCatalogPractice[],
  period: PerformancePeriod,
  difficulty: PerformanceDifficulty | null = null,
  now = new Date(),
): PerformanceSummary {
  const from =
    period === 'recent'
      ? new Date(now.getTime() - 60 * 86_400_000).toISOString()
      : null
  const seen = new Set<string>()
  const inPeriod = records
    .filter((record) => {
      const completed = record.completedAt
        ? Date.parse(record.completedAt)
        : NaN
      if (
        seen.has(record.id) ||
        record.userId !== userId ||
        record.status !== 'completed' ||
        record.deletedAt ||
        !Number.isFinite(completed) ||
        completed > now.getTime() ||
        (from && completed < Date.parse(from))
      )
        return false
      seen.add(record.id)
      return true
    })
    .sort(
      (a, b) =>
        Date.parse(a.completedAt!) - Date.parse(b.completedAt!) ||
        a.id.localeCompare(b.id),
    )
  const difficultyCounts = new Map<PerformanceDifficulty, number>()
  for (const session of inPeriod) {
    const value = session.context?.practice.difficulty
    if (value)
      difficultyCounts.set(value, (difficultyCounts.get(value) ?? 0) + 1)
  }
  const sessions = difficulty
    ? inPeriod.filter(
        (session) => session.context?.practice.difficulty === difficulty,
      )
    : inPeriod

  const skills = new Map<
    string,
    PerformanceSkill & { behaviorIndex: Map<string, number> }
  >()
  const recurring = new Map<
    string,
    {
      competencyCode: string
      competencyName: string
      callType: PracticeType
      ruleDescription: string
      critical: boolean
      demonstrated: boolean
      sessions: Set<string>
      keyPointSessions: Set<string>
      example: PerformanceExample
      practiceId: string
    }
  >()
  const objections = new Map<string | null, ObjectionRate>()
  const objective = { assessed: 0, achieved: 0, partiallyAchieved: 0 }
  let evaluated = 0,
    seconds = 0,
    unknown = 0,
    discovered = 0,
    insightTotal = 0

  for (const session of sessions) {
    const context = session.context
    const callType = context?.practice.type ?? null
    if (!context) unknown++
    if (session.startedAt)
      seconds += Math.max(
        0,
        (Date.parse(session.completedAt!) - Date.parse(session.startedAt)) /
          1000,
      )
    const evaluation = session.evaluation
    if (!evaluation) continue
    evaluated++
    if (evaluation.objectiveOutcome) {
      objective.assessed++
      if (evaluation.objectiveOutcome === 'achieved') objective.achieved++
      else if (evaluation.objectiveOutcome === 'partially_achieved')
        objective.partiallyAchieved++
    }
    discovered += evaluation.discoveredInsightKeys.length
    insightTotal +=
      evaluation.discoveredInsightKeys.length +
      evaluation.missedInsightKeys.length
    for (const outcome of evaluation.objectionOutcomes) {
      if (!outcome.raised) continue
      const category =
        context?.objections.find((item) => item.key === outcome.key)
          ?.category ?? null
      const rate = objections.get(category) ?? {
        category,
        raised: 0,
        handled: 0,
        partiallyHandled: 0,
        notHandled: 0,
      }
      rate.raised++
      if (outcome.handling === 'handled') rate.handled++
      else if (outcome.handling === 'partially_handled') rate.partiallyHandled++
      else rate.notHandled++
      objections.set(category, rate)
    }

    const ordered = [...session.transcript].sort(
      (a, b) => a.sequence - b.sequence,
    )
    const transcript: Transcript = new Map(
      ordered.map((turn) => [turn.sequence, turn]),
    )
    const displayNumbers = transcriptDisplayNumbers(ordered)
    const keyPoint = new Set(
      pickKeyCoachingPoint({
        competencies: evaluation.scores.map((score) => ({
          ...score,
          weight: score.weight ?? undefined,
        })),
        objectiveOutcome: evaluation.objectiveOutcome,
        objectiveEvidence: evaluation.objectiveEvidence,
        objectionOutcomes: evaluation.objectionOutcomes,
      })?.findingIds,
    )
    const title =
      context?.practice.title ?? 'Bài luyện (thiếu ngữ cảnh lịch sử)'
    const sessionDifficulty = context?.practice.difficulty ?? null

    for (const score of evaluation.scores) {
      // Unknown contexts stay per session so they never pool with real ones.
      const skillKey = JSON.stringify([
        score.code,
        callType,
        context ? null : session.id,
      ])
      const skill = skills.get(skillKey) ?? {
        id: `skill_${skills.size + 1}`,
        code: score.code,
        name: score.name,
        callType,
        totalSessions: 0,
        assessedSessions: 0,
        points: [],
        behaviors: [],
        behaviorIndex: new Map<string, number>(),
      }
      skills.set(skillKey, skill)
      skill.totalSessions++
      const { score: value } = scoreCompetency(
        score.code,
        score.rubric,
        score.findings,
        score.assessmentStatus,
      )
      if (value === null) continue
      skill.assessedSessions++
      skill.points.push({
        sessionId: session.id,
        practiceTitle: title,
        completedAt: session.completedAt!,
        difficulty: sessionDifficulty,
        score: value,
        missed: score.assessmentStatus === 'opportunity_missed',
      })
      const demonstrated = new Set(
        score.findings
          .filter((finding) => finding.kind === 'demonstrated')
          .map((finding) => finding.behaviorId),
      )
      for (const behavior of score.rubric.behaviors) {
        // Same id with different wording is a different trainer rule.
        const behaviorKey = JSON.stringify([behavior.id, behavior.description])
        let index = skill.behaviorIndex.get(behaviorKey)
        if (index === undefined) {
          index = skill.behaviors.length
          skill.behaviorIndex.set(behaviorKey, index)
          skill.behaviors.push({
            id: behavior.id,
            description: behavior.description,
            demonstrated: 0,
            sessions: 0,
          })
        }
        skill.behaviors[index].sessions++
        if (demonstrated.has(behavior.id)) skill.behaviors[index].demonstrated++
      }

      if (!context) continue
      for (const finding of score.findings) {
        if (!isGrounded(finding, transcript)) continue
        const critical = finding.kind === 'critical_error'
        const rule = critical
          ? score.rubric.criticalErrors.find(
              (item) => item.id === finding.criticalErrorId,
            )
          : score.rubric.behaviors.find(
              (item) => item.id === finding.behaviorId,
            )
        if (!rule) continue
        const demonstratedFinding = finding.kind === 'demonstrated'
        const key = JSON.stringify([
          score.code,
          callType,
          critical ? 'critical' : 'behavior',
          rule.id,
          rule.description,
          demonstratedFinding,
        ])
        const evidence =
          finding.evidence.find(
            (item) => transcript.get(item.turnNumber)?.speaker === 'user',
          ) ?? finding.evidence[0]
        const example: PerformanceExample = {
          sessionId: session.id,
          practiceTitle: title,
          completedAt: session.completedAt!,
          difficulty: sessionDifficulty,
          rationale: finding.rationale,
          turn: {
            sequence: evidence.turnNumber,
            displayNumber: displayNumbers.get(evidence.turnNumber)!,
            quote: evidence.quote ?? transcript.get(evidence.turnNumber)!.text,
          },
        }
        const entry = recurring.get(key) ?? {
          competencyCode: score.code,
          competencyName: score.name,
          callType: context.practice.type,
          ruleDescription: rule.description,
          critical,
          demonstrated: demonstratedFinding,
          sessions: new Set<string>(),
          keyPointSessions: new Set<string>(),
          example,
          practiceId: session.practiceId,
        }
        entry.sessions.add(session.id)
        if (keyPoint.has(`${score.code}:${finding.id}`))
          entry.keyPointSessions.add(session.id)
        // Sessions run oldest first, so the latest example wins.
        entry.example = example
        entry.practiceId = session.practiceId
        recurring.set(key, entry)
      }
    }
  }

  const entries = [...recurring.values()]
  const ruleKey = (entry: (typeof entries)[number]) =>
    JSON.stringify([
      entry.competencyCode,
      entry.callType,
      entry.ruleDescription,
    ])
  const focusEntries = entries
    .filter(
      (entry) =>
        !entry.demonstrated &&
        (entry.sessions.size >= 2 || entry.keyPointSessions.size > 0),
    )
    .sort(
      (a, b) =>
        b.keyPointSessions.size - a.keyPointSessions.size ||
        b.sessions.size - a.sessions.size ||
        b.example.completedAt.localeCompare(a.example.completedAt),
    )
    .slice(0, 3)
  const focusRules = new Set(focusEntries.map(ruleKey))
  const focus = focusEntries.map((entry, index): PerformanceFocus => {
    const offered = (practice: PerformanceCatalogPractice) =>
      practice.type === entry.callType &&
      practice.competencyCodes.includes(entry.competencyCode) &&
      (!difficulty || practice.difficulty === difficulty)
    const practice =
      catalog.find((item) => item.id === entry.practiceId && offered(item)) ??
      catalog.find(offered)
    return {
      id: `focus_${index + 1}`,
      competencyCode: entry.competencyCode,
      competencyName: entry.competencyName,
      callType: entry.callType,
      ruleDescription: entry.ruleDescription,
      critical: entry.critical,
      sessions: entry.sessions.size,
      keyPointSessions: entry.keyPointSessions.size,
      example: entry.example,
      practice: practice
        ? {
            id: practice.id,
            title: practice.title,
            difficulty: practice.difficulty,
          }
        : null,
    }
  })
  const strengths = entries
    // A behavior still listed as a focus is not yet a strength.
    .filter(
      (entry) =>
        entry.demonstrated &&
        entry.sessions.size >= 2 &&
        !focusRules.has(ruleKey(entry)),
    )
    .sort((a, b) => b.sessions.size - a.sessions.size)
    .slice(0, 3)
    .map((entry, index): PerformanceStrength => ({
      id: `strength_${index + 1}`,
      competencyName: entry.competencyName,
      callType: entry.callType,
      ruleDescription: entry.ruleDescription,
      sessions: entry.sessions.size,
    }))

  return {
    period,
    generatedAt: now.toISOString(),
    from,
    difficulty,
    difficulties: (['beginner', 'intermediate', 'advanced'] as const)
      .filter((value) => difficultyCounts.has(value))
      .map((value) => ({ value, sessions: difficultyCounts.get(value)! })),
    activity: {
      completedSessions: sessions.length,
      evaluatedSessions: evaluated,
      awaitingEvaluation: sessions.length - evaluated,
      practiceMinutes: Math.round(seconds / 60),
      objective,
    },
    focus,
    strengths,
    skills: [...skills.values()]
      .sort(
        (a, b) =>
          callOrder(a.code) - callOrder(b.code) ||
          (a.callType ?? '~').localeCompare(b.callType ?? '~'),
      )
      .map(({ behaviorIndex: _index, ...skill }) => skill),
    outcomes: {
      objections: [...objections.values()],
      insights: { discovered, total: insightTotal },
    },
    historicalContextCount: unknown,
  }
}
