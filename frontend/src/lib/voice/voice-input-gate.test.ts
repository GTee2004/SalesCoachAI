import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createVoiceInputGate } from './voice-input-gate'

function setup() {
  let micEnabled = false
  const micChanges: boolean[] = []
  const states: string[] = []
  const acknowledgments: string[] = []
  const gate = createVoiceInputGate({
    enableMic: (enabled) => {
      micEnabled = enabled
      micChanges.push(enabled)
    },
    isMicEnabled: () => micEnabled,
    sendPracticeReady: () => acknowledgments.push('practice-ready'),
    onStateChange: (state) => states.push(state),
  })
  return {
    gate,
    micChanges,
    states,
    acknowledgments,
    isMicEnabled: () => micEnabled,
  }
}

const opening = { about: { voiceInputState: 'opening' } }
const listening = { type: 'voice-input-state', state: 'listening' }
const failed = { type: 'voice-input-state', state: 'failed' }

test('server listening before bot ready opens mic only after bot ready', () => {
  const { gate, micChanges, isMicEnabled } = setup()
  gate.onServerMessage(listening)
  assert.equal(gate.isReady, false)
  assert.equal(isMicEnabled(), false)
  gate.onBotReady(opening)
  assert.equal(gate.isReady, true)
  assert.deepEqual(micChanges, [true])
})

test('bot ready before server listening keeps mic off while customer opens', () => {
  const { gate, micChanges } = setup()
  gate.onBotReady(opening)
  assert.equal(gate.state, 'opening')
  assert.deepEqual(micChanges, [])
  gate.onServerMessage(listening)
  assert.equal(gate.state, 'listening')
  assert.deepEqual(micChanges, [true])
})

test('resumed bot ready snapshot already listening opens mic', () => {
  const { gate, micChanges } = setup()
  gate.onBotReady({ about: { voiceInputState: 'listening' } })
  assert.equal(gate.isReady, true)
  assert.deepEqual(micChanges, [true])
})

test('malformed and unrelated messages do not grant microphone access', () => {
  const { gate, micChanges } = setup()
  gate.onBotReady({ about: { voiceInputState: 'unknown' } })
  gate.onServerMessage({ data: listening })
  gate.onServerMessage({ type: 'voice-input-state', state: 'opening' })
  gate.onServerMessage({ type: 'other', state: 'listening' })
  assert.equal(gate.isReady, false)
  assert.deepEqual(micChanges, [])
  gate.onServerMessage(listening)
  assert.equal(gate.isReady, true)
})

test('duplicate readiness does not override manual mute', () => {
  const { gate, micChanges, isMicEnabled } = setup()
  gate.onBotReady(opening)
  gate.onServerMessage(listening)
  gate.toggleMic()
  assert.equal(isMicEnabled(), false)
  gate.onServerMessage(listening)
  gate.onBotReady(opening)
  gate.onBotReady({ about: { voiceInputState: 'listening' } })
  assert.equal(isMicEnabled(), false)
  assert.deepEqual(micChanges, [true, false])
})

test('failure is terminal, closes mic, and ignores delayed listening', () => {
  const { gate, micChanges } = setup()
  gate.onBotReady(opening)
  gate.onServerMessage(listening)
  gate.onServerMessage(failed)
  gate.onServerMessage(listening)
  gate.onBotReady({ about: { voiceInputState: 'listening' } })
  gate.toggleMic()
  assert.equal(gate.state, 'failed')
  assert.deepEqual(micChanges, [true, false])
})

test('failed bot-ready snapshot denies mic even after prior listening event', () => {
  const { gate, micChanges } = setup()
  gate.onServerMessage(listening)
  gate.onBotReady({ about: { voiceInputState: 'failed' } })
  assert.equal(gate.state, 'failed')
  assert.deepEqual(micChanges, [false])
})

test('closed gate ignores late callbacks; a retry has independent readiness', () => {
  const old = setup()
  old.gate.onBotReady(opening)
  old.gate.close()
  old.gate.onServerMessage(listening)
  old.gate.onBotReady({ about: { voiceInputState: 'listening' } })
  old.gate.toggleMic()
  assert.equal(old.gate.state, 'closed')
  assert.deepEqual(old.micChanges, [false])

  const retry = setup()
  retry.gate.onBotReady(opening)
  assert.equal(retry.gate.isReady, false)
  retry.gate.onServerMessage(listening)
  assert.equal(retry.gate.isReady, true)
  assert.deepEqual(retry.micChanges, [true])
})

test('practice-ready is acknowledged once after bot ready for the current gate', () => {
  const first = setup()
  first.gate.acknowledgeReady()
  assert.deepEqual(first.acknowledgments, [])
  first.gate.onBotReady(opening)
  first.gate.acknowledgeReady()
  first.gate.acknowledgeReady()
  first.gate.onBotReady(opening)
  first.gate.acknowledgeReady()
  assert.deepEqual(first.acknowledgments, ['practice-ready'])
  first.gate.close()
  first.gate.acknowledgeReady()
  assert.deepEqual(first.acknowledgments, ['practice-ready'])

  const retry = setup()
  retry.gate.onBotReady(opening)
  retry.gate.acknowledgeReady()
  assert.deepEqual(retry.acknowledgments, ['practice-ready'])
})

test('resumed listening and stale closed gates do not acknowledge an opener', () => {
  const resumed = setup()
  resumed.gate.onBotReady({ about: { voiceInputState: 'listening' } })
  resumed.gate.acknowledgeReady()
  assert.deepEqual(resumed.acknowledgments, [])

  const stale = setup()
  stale.gate.onBotReady(opening)
  stale.gate.close()
  stale.gate.acknowledgeReady()
  assert.deepEqual(stale.acknowledgments, [])
})

test('acknowledgment claims once before invoking an external sender', () => {
  let sent = 0
  const gate = createVoiceInputGate({
    enableMic: () => undefined,
    isMicEnabled: () => false,
    onStateChange: () => undefined,
    sendPracticeReady: () => {
      sent += 1
      gate.acknowledgeReady()
    },
  })
  gate.onBotReady(opening)
  gate.acknowledgeReady()
  assert.equal(sent, 1)
})

test('AI speech pauses microphone after listening and resumes on stop', () => {
  const { gate, micChanges } = setup()
  gate.onBotReady(opening)
  gate.onServerMessage(listening)
  gate.onBotStartedSpeaking()
  assert.equal(gate.isReady, false)
  gate.onBotStartedSpeaking()
  gate.onBotStoppedSpeaking()
  assert.equal(gate.isReady, true)
  gate.onBotStoppedSpeaking()
  assert.deepEqual(micChanges, [true, false, true])
})

test('queued listening during AI speech waits until speech stops', () => {
  const { gate, micChanges } = setup()
  gate.onBotReady(opening)
  gate.onBotStartedSpeaking()
  gate.onServerMessage(listening)
  assert.equal(gate.state, 'listening')
  assert.equal(gate.isReady, false)
  assert.deepEqual(micChanges, [])
  gate.onBotStoppedSpeaking()
  assert.equal(gate.isReady, true)
  assert.deepEqual(micChanges, [true])
})

test('manual mute survives AI playback and duplicate readiness events', () => {
  const { gate, micChanges } = setup()
  gate.onBotReady(opening)
  gate.onServerMessage(listening)
  gate.toggleMic()
  gate.onBotStartedSpeaking()
  gate.onServerMessage(listening)
  gate.onBotReady({ about: { voiceInputState: 'listening' } })
  gate.onBotStoppedSpeaking()
  assert.equal(gate.isReady, true)
  assert.deepEqual(micChanges, [true, false])
  gate.toggleMic()
  assert.deepEqual(micChanges, [true, false, true])
})

test('failure and close during playback ignore delayed speech and readiness', () => {
  const failedGate = setup()
  failedGate.gate.onBotReady(opening)
  failedGate.gate.onServerMessage(listening)
  failedGate.gate.onBotStartedSpeaking()
  failedGate.gate.onServerMessage(failed)
  failedGate.gate.onBotStoppedSpeaking()
  failedGate.gate.onServerMessage(listening)
  assert.equal(failedGate.gate.isReady, false)
  assert.deepEqual(failedGate.micChanges, [true, false, false])

  const closedGate = setup()
  closedGate.gate.onBotReady(opening)
  closedGate.gate.onServerMessage(listening)
  closedGate.gate.onBotStartedSpeaking()
  closedGate.gate.close()
  closedGate.gate.onBotStoppedSpeaking()
  closedGate.gate.onServerMessage(listening)
  assert.equal(closedGate.gate.isReady, false)
  assert.deepEqual(closedGate.micChanges, [true, false, false])
})
