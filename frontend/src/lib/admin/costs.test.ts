import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildServiceCosts } from './costs'
import type { CostUsageRow } from './costs'
import { usageCost } from './service-prices'

const none = {
  audioSeconds: 0,
  characters: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
}

test('streamed speech is priced by the hour', () => {
  const cost = usageCost({
    ...none,
    service: 'stt',
    provider: 'assemblyai',
    model: 'universal-3-6-pro',
    audioSeconds: 1800,
  })
  assert.equal(cost, 0.225)
})

test('cached input tokens are billed at their own rate, not twice', () => {
  const cost = usageCost({
    ...none,
    service: 'llm',
    provider: 'openrouter',
    model: 'openai/gpt-4.1-mini',
    inputTokens: 1_000_000,
    cachedInputTokens: 250_000,
    outputTokens: 100_000,
  })
  // 750k at $0.40, 250k at $0.10 and 100k at $1.60 per million.
  assert.ok(Math.abs(cost! - (0.3 + 0.025 + 0.16)) < 1e-9)
})

test('a model without a price costs nothing known', () => {
  assert.equal(
    usageCost({
      ...none,
      service: 'tts',
      provider: 'soniox',
      model: 'tts-rt-v9',
      characters: 1000,
    }),
    null,
  )
})

const row = (overrides: Partial<CostUsageRow>): CostUsageRow => ({
  day: '2026-10-06',
  source: 'conversation',
  service: 'tts',
  provider: 'elevenlabs',
  model: 'eleven_v4_turbo',
  audioMs: 0,
  characters: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  ...overrides,
})

test('spend is split by bucket, by period and into priced lines', () => {
  const costs = buildServiceCosts({
    today: '2026-10-06',
    from: '2026-10-05',
    to: '2026-10-06',
    previousFrom: '2026-10-03',
    granularity: 'day',
    calls: { current: 4, previous: 1 },
    usageRows: [
      row({ characters: 50_000 }),
      row({ day: '2026-10-05', characters: 25_000 }),
      row({
        service: 'stt',
        provider: 'soniox',
        model: 'stt-rt-v5',
        audioMs: 3_600_000,
      }),
      row({
        source: 'evaluation',
        service: 'llm',
        provider: 'openrouter',
        model: 'openai/gpt-6-luna',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
      row({ model: 'unpriced-voice', characters: 9_999 }),
      row({ day: '2026-10-04', characters: 25_000 }),
    ],
  })

  assert.deepEqual(
    costs.series.map((bucket) => [bucket.date, bucket.total]),
    [
      ['2026-10-05', 1],
      ['2026-10-06', 2 + 0.12 + 0.6],
    ],
  )
  assert.equal(costs.series[1].evaluation, 0.6)
  assert.ok(Math.abs(costs.current.totalUsd - 3.72) < 1e-9)
  assert.ok(Math.abs(costs.current.perCallUsd! - 0.93) < 1e-9)
  assert.equal(costs.current.callMinutes, 60)
  assert.equal(costs.current.evaluationUsd, 0.6)
  assert.equal(costs.previous.totalUsd, 1)
  assert.equal(costs.previous.perMinuteUsd, null)
  assert.deepEqual(
    costs.lines.map((line) => [line.model, line.costUsd]),
    [
      ['eleven_v4_turbo', 3],
      ['openai/gpt-6-luna', 0.6],
      ['stt-rt-v5', 0.12],
      ['unpriced-voice', null],
    ],
  )
})
