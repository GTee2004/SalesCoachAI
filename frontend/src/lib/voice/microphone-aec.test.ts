import assert from 'node:assert/strict'
import { test } from 'node:test'

import { logger } from '@pipecat-ai/client-js'

import { createMicEchoCancellation } from './microphone-aec'

function makeTrack(options: {
  id: string
  constraints?: MediaTrackConstraints
  settings?: MediaTrackSettings
  apply?: (constraints?: MediaTrackConstraints) => Promise<void>
}) {
  const requests: Array<MediaTrackConstraints | undefined> = []
  return {
    track: {
      id: options.id,
      getConstraints: () => options.constraints ?? {},
      applyConstraints: (constraints?: MediaTrackConstraints) => {
        requests.push(constraints)
        return options.apply?.(constraints) ?? Promise.resolve()
      },
      getSettings: () => options.settings ?? {},
    },
    requests,
  }
}

test('preserves existing constraints and awaits one pending request per track', async () => {
  let finishRequest: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    finishRequest = resolve
  })
  const { track, requests } = makeTrack({
    id: 'first',
    constraints: {
      deviceId: { exact: 'chosen-mic' },
      noiseSuppression: false,
      autoGainControl: false,
      advanced: [{ sampleRate: 48_000 }],
    },
    settings: { echoCancellation: true, noiseSuppression: true },
    apply: () => pending,
  })
  const ensureAec = createMicEchoCancellation('session-1')

  const fromTrackEvent = ensureAec(track)
  const afterInitDevices = ensureAec(track)
  assert.strictEqual(afterInitDevices, fromTrackEvent)
  assert.deepEqual(requests, [
    {
      deviceId: { exact: 'chosen-mic' },
      noiseSuppression: true,
      autoGainControl: false,
      advanced: [{ sampleRate: 48_000 }],
      echoCancellation: true,
    },
  ])
  let settled = false
  void afterInitDevices.then(() => {
    settled = true
  })
  await Promise.resolve()
  assert.equal(settled, false)
  finishRequest?.()
  await afterInitDevices
  assert.equal(settled, true)
})

test('attempts a distinct replacement track even while the first request is pending', async () => {
  let finishFirst: (() => void) | undefined
  const firstPending = new Promise<void>((resolve) => {
    finishFirst = resolve
  })
  const first = makeTrack({ id: 'first', apply: () => firstPending })
  const replacement = makeTrack({ id: 'replacement' })
  const ensureAec = createMicEchoCancellation('session-2')

  const firstAttempt = ensureAec(first.track)
  await ensureAec(replacement.track)
  assert.equal(first.requests.length, 1)
  assert.deepEqual(replacement.requests, [
    { echoCancellation: true, noiseSuppression: true },
  ])
  finishFirst?.()
  await firstAttempt
})

test('failed request resolves and does not prevent a later track attempt', async () => {
  const failure = new Error('unsupported constraint')
  const first = makeTrack({
    id: 'first',
    apply: () => Promise.reject(failure),
  })
  const replacement = makeTrack({ id: 'replacement' })
  const warnings: Array<unknown[]> = []
  const originalWarn = logger.warn
  logger.warn = (...args) => warnings.push(args)
  try {
    const ensureAec = createMicEchoCancellation('session-3')
    await assert.doesNotReject(ensureAec(first.track))
    await ensureAec(replacement.track)
    assert.equal(first.requests.length, 1)
    assert.equal(replacement.requests.length, 1)
    assert.deepEqual(warnings[0], [
      'Microphone audio processing request failed',
      { sessionId: 'session-3', trackId: 'first', error: failure },
    ])
  } finally {
    logger.warn = originalWarn
  }
})

test('reports AEC and noise suppression settings distinctly', async () => {
  const info: Array<unknown[]> = []
  const warnings: Array<unknown[]> = []
  const originalInfo = logger.info
  const originalWarn = logger.warn
  logger.info = (...args) => info.push(args)
  logger.warn = (...args) => warnings.push(args)
  try {
    const ensureAec = createMicEchoCancellation('session-4')
    await ensureAec(
      makeTrack({
        id: 'enabled',
        settings: { echoCancellation: true, noiseSuppression: true },
      }).track,
    )
    await ensureAec(
      makeTrack({
        id: 'aec-disabled',
        settings: { echoCancellation: false, noiseSuppression: true },
      }).track,
    )
    await ensureAec(
      makeTrack({
        id: 'noise-suppression-disabled',
        settings: { echoCancellation: true, noiseSuppression: false },
      }).track,
    )
    await ensureAec(
      makeTrack({
        id: 'noise-suppression-unreported',
        settings: { echoCancellation: true },
      }).track,
    )
    await ensureAec(makeTrack({ id: 'both-unreported' }).track)
    assert.deepEqual(info, [
      [
        'Microphone audio processing',
        {
          sessionId: 'session-4',
          trackId: 'enabled',
          requested: true,
          actual: true,
          noiseSuppressionRequested: true,
          noiseSuppressionActual: true,
        },
      ],
    ])
    assert.deepEqual(warnings, [
      [
        'Microphone audio processing',
        {
          sessionId: 'session-4',
          trackId: 'aec-disabled',
          requested: true,
          actual: false,
          noiseSuppressionRequested: true,
          noiseSuppressionActual: true,
        },
      ],
      [
        'Microphone audio processing',
        {
          sessionId: 'session-4',
          trackId: 'noise-suppression-disabled',
          requested: true,
          actual: true,
          noiseSuppressionRequested: true,
          noiseSuppressionActual: false,
        },
      ],
      [
        'Microphone audio processing',
        {
          sessionId: 'session-4',
          trackId: 'noise-suppression-unreported',
          requested: true,
          actual: true,
          noiseSuppressionRequested: true,
          noiseSuppressionActual: 'unreported',
        },
      ],
      [
        'Microphone audio processing',
        {
          sessionId: 'session-4',
          trackId: 'both-unreported',
          requested: true,
          actual: 'unreported',
          noiseSuppressionRequested: true,
          noiseSuppressionActual: 'unreported',
        },
      ],
    ])
  } finally {
    logger.info = originalInfo
    logger.warn = originalWarn
  }
})
