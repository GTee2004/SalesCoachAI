import type { SalesOfferingConfig } from '#/db/schema'

/** Month an offering's facts describe, as YYYY-MM; the call is set in it. */
export const OFFERING_AS_OF_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/** "2026-10" -> "10/2026" */
export function formatOfferingAsOf(asOf: string) {
  const [year, month] = asOf.split('-')
  return `${month}/${year}`
}

/**
 * Names a learner is likely to say about the offering, for biasing speech
 * recognition: "Vinhomes Ocean Park 1 - The Paris" also yields each part, so
 * the recognizer keeps a name intact when the learner says only part of it.
 */
export function transcriptionTerms(offering: SalesOfferingConfig) {
  const project = offering.projectName.trim()
  const terms = [
    project,
    ...project.split(/\s+[-–|/]\s+/),
    // "Vinhomes (liên doanh với Mitsubishi Corporation)" -> "Vinhomes"
    offering.developer?.replace(/\([^)]*\)/g, ''),
    offering.location.district,
  ]
  return [
    ...new Set(
      terms
        .map((term) => term?.trim())
        .filter((term): term is string => !!term),
    ),
  ]
}
