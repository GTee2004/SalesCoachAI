import { z } from 'zod'

export const assessmentStatusSchema = z.enum([
  'observed',
  'opportunity_missed',
  'not_assessed',
])
export type AssessmentStatus = z.infer<typeof assessmentStatusSchema>
export type AssessmentCoverage = {
  assessedCount: number
  totalCount: number
  weightedPercent: number
}

/** Renormalize only assessed weights; an absent opportunity is not a zero. */
export function summarizeAssessment(
  scores: Array<{
    assessmentStatus: AssessmentStatus
    score: number | null
    weight: number
  }>,
): { overallScore: number | null; assessmentCoverage: AssessmentCoverage } {
  let assessedCount = 0
  let assessedWeight = 0
  let totalWeight = 0
  let weightedScore = 0
  for (const item of scores) {
    totalWeight += item.weight
    if (item.assessmentStatus === 'not_assessed') continue
    if (item.score === null)
      throw new Error('Assessed competency needs a score')
    assessedCount++
    assessedWeight += item.weight
    weightedScore += item.score * item.weight
  }
  return {
    overallScore:
      assessedWeight > 0 ? Math.round(weightedScore / assessedWeight) : null,
    assessmentCoverage: {
      assessedCount,
      totalCount: scores.length,
      weightedPercent:
        totalWeight > 0
          ? Math.round((assessedWeight / totalWeight) * 10000) / 100
          : 0,
    },
  }
}
