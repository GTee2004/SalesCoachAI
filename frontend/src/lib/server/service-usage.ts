import { z } from 'zod'
import { db } from '#/db'
import { serviceUsage } from '#/db/schema'

const name = z.string().trim().min(1).max(128)
const amount = z.number().finite().min(0).max(1e12)

/** One service's usage as the voice backend reports it. */
export const serviceUsageItemSchema = z.discriminatedUnion('service', [
  z.object({
    service: z.literal('stt'),
    provider: name,
    model: name,
    audioSeconds: amount,
  }),
  z.object({
    service: z.literal('tts'),
    provider: name,
    model: name,
    characters: amount,
  }),
  z.object({
    service: z.literal('llm'),
    provider: name,
    model: name,
    inputTokens: amount,
    cachedInputTokens: amount,
    outputTokens: amount,
  }),
])

export type ServiceUsageItem = z.infer<typeof serviceUsageItemSchema>

export const serviceUsageListSchema = z.array(serviceUsageItemSchema).max(16)

/** Usage from a header or event; anything malformed reports nothing. */
export function parseServiceUsage(raw: unknown): ServiceUsageItem[] {
  const parsed = serviceUsageListSchema.safeParse(raw)
  return parsed.success ? parsed.data : []
}

/**
 * Saves what a call attempt or an evaluation consumed. Redelivering the same
 * `usageKey` changes nothing. Never throws: a lost cost record must not fail
 * the voice event or the evaluation that carried it.
 */
export async function recordServiceUsage(input: {
  sessionId: string
  usageKey: string
  source: 'conversation' | 'evaluation'
  items: ServiceUsageItem[]
}) {
  if (!input.items.length) return
  try {
    await db
      .insert(serviceUsage)
      .values(
        input.items.map((item) => ({
          sessionId: input.sessionId,
          usageKey: input.usageKey,
          source: input.source,
          service: item.service,
          provider: item.provider,
          model: item.model,
          audioMs:
            item.service === 'stt' ? Math.round(item.audioSeconds * 1000) : 0,
          characters: item.service === 'tts' ? Math.round(item.characters) : 0,
          inputTokens:
            item.service === 'llm' ? Math.round(item.inputTokens) : 0,
          cachedInputTokens:
            item.service === 'llm'
              ? Math.round(Math.min(item.cachedInputTokens, item.inputTokens))
              : 0,
          outputTokens:
            item.service === 'llm' ? Math.round(item.outputTokens) : 0,
        })),
      )
      .onConflictDoNothing()
  } catch (error) {
    console.error('Service usage was not recorded', {
      sessionId: input.sessionId,
      usageKey: input.usageKey,
      source: input.source,
      error,
    })
  }
}
