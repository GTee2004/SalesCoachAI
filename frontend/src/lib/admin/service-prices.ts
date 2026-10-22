import type { CostLine, CostService } from './contracts'

/**
 * List prices in USD, keyed by the provider and model the voice backend
 * reports. Update `PRICES_CHECKED_ON` with any change: costs are computed from
 * this table when the dashboard reads them, so a change reprices past usage.
 */
export const PRICES_CHECKED_ON = '2026-10-15'

export type ServicePrice =
  | { service: 'stt'; perHour: number }
  | { service: 'tts'; perMillionCharacters: number }
  | {
      service: 'llm'
      perMillionInput: number
      perMillionCachedInput: number
      perMillionOutput: number
    }

const PRICES: Record<string, ServicePrice> = {
  // https://soniox.com/pricing: audio and text tokens, about $0.12 per
  // streamed hour. Soniox bills the open stream, silence included.
  'stt/soniox/stt-rt-v5': { service: 'stt', perHour: 0.12 },
  // https://www.assemblyai.com/pricing: billed while the socket is open.
  // Voice Focus adds $0.10/h when it is on, which this base rate leaves out.
  'stt/assemblyai/universal-3-6-pro': { service: 'stt', perHour: 0.45 },

  // Soniox's own conversion of its token prices, about $0.70 per hour of speech.
  'tts/soniox/tts-rt-v2': { service: 'tts', perMillionCharacters: 14.1 },
  // https://elevenlabs.io/pricing/api: $0.04 per 1,000 characters on every plan.
  'tts/elevenlabs/eleven_v4_turbo': {
    service: 'tts',
    perMillionCharacters: 40,
  },
  'tts/elevenlabs/eleven_flash_v2_5': {
    service: 'tts',
    perMillionCharacters: 40,
  },
  // ElevenLabs through OpenRouter, the fallback when ElevenLabs fails
  // mid-call. https://openrouter.ai/api/v1/models?output_modalities=speech
  'tts/openrouter/elevenlabs/eleven-v4-turbo': {
    service: 'tts',
    perMillionCharacters: 20,
  },
  'tts/openrouter/elevenlabs/eleven-v4': {
    service: 'tts',
    perMillionCharacters: 40,
  },
  'tts/openrouter/elevenlabs/eleven-flash-v2.5': {
    service: 'tts',
    perMillionCharacters: 20,
  },
  // OpenRouter bills $0.50/M text and $6/M audio tokens (25 per second).
  // Estimated at 15 characters of Vietnamese per second of speech. Google
  // doubles this price on 2027-01-01.
  'tts/gemini/google/gemini-3.8-flash-lite-tts': {
    service: 'tts',
    perMillionCharacters: 10.2,
  },

  // https://openrouter.ai/api/v1/models
  'llm/openrouter/openai/gpt-6-luna': {
    service: 'llm',
    perMillionInput: 0.1,
    perMillionCachedInput: 0.01,
    perMillionOutput: 0.5,
  },
  'llm/openrouter/openai/gpt-4.1-mini': {
    service: 'llm',
    perMillionInput: 0.4,
    perMillionCachedInput: 0.1,
    perMillionOutput: 1.6,
  },
}

export function findPrice(
  service: CostService,
  provider: string,
  model: string,
): ServicePrice | null {
  return PRICES[`${service}/${provider}/${model}`] ?? null
}

type Usage = Pick<
  CostLine,
  | 'service'
  | 'provider'
  | 'model'
  | 'audioSeconds'
  | 'characters'
  | 'inputTokens'
  | 'cachedInputTokens'
  | 'outputTokens'
>

/** What `usage` cost in USD; null without a price for its model. */
export function usageCost(usage: Usage): number | null {
  const price = findPrice(usage.service, usage.provider, usage.model)
  if (!price) return null
  if (price.service === 'stt')
    return (usage.audioSeconds / 3600) * price.perHour
  if (price.service === 'tts')
    return (usage.characters / 1e6) * price.perMillionCharacters
  // Input tokens include the cached ones, which are billed at their own rate.
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens)
  return (
    (uncached * price.perMillionInput +
      usage.cachedInputTokens * price.perMillionCachedInput +
      usage.outputTokens * price.perMillionOutput) /
    1e6
  )
}
