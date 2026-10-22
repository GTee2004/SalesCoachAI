import assert from 'node:assert/strict'
import test from 'node:test'
import { RTVIMessage } from '@pipecat-ai/client-js'
import {
  isSilenceHangUp,
  isVoiceServiceFailure,
  startFailureMessage,
  voiceErrorMessage,
} from './errors'

test('Internal Pipecat diagnostics never become learner messages', () => {
  const diagnostic =
    'GeminiTTSService#1: TTS context private-context-id completed with no audio'
  const payloads: unknown[] = [
    RTVIMessage.error(diagnostic).data,
    { message: diagnostic, fatal: true },
    diagnostic,
    { error: 'Gemini TTS request failed (HTTP 429)' },
    { error: { code: 503 } },
    undefined,
    null,
    '',
    {},
  ]
  for (const payload of payloads) {
    assert.equal(
      voiceErrorMessage(payload),
      'Kết nối giọng nói gặp sự cố. Vui lòng thử lại.',
    )
  }
})

test('Safe service error codes display a retry message', () => {
  const message = RTVIMessage.error('voice_service_unavailable')
  assert.equal(
    voiceErrorMessage(message.data),
    'Cuộc gọi vừa bị gián đoạn. Hãy nói lại câu vừa rồi.',
  )
})

test('Safe fatal error codes display a reconnect message', () => {
  const message = RTVIMessage.error('voice_session_failed', true)
  assert.equal(
    voiceErrorMessage(message.data),
    'Phiên luyện tập bị gián đoạn. Vui lòng kết nối lại.',
  )
})

test('Extra diagnostic fields do not appear in a safe message', () => {
  assert.equal(
    voiceErrorMessage({
      error: 'voice_service_unavailable',
      message: 'Traceback: private backend details',
    }),
    'Cuộc gọi vừa bị gián đoạn. Hãy nói lại câu vừa rồi.',
  )
})

test('Only the backend service-failure message stops the call with its own explanation', () => {
  assert.equal(
    isVoiceServiceFailure({ type: 'voice-service-failed', service: 'llm' }),
    true,
  )
  for (const data of [
    { type: 'voice-input-state', state: 'failed' },
    { error: 'voice_service_unavailable' },
    'voice-service-failed',
    null,
  ])
    assert.equal(isVoiceServiceFailure(data), false)
})

test('Only the backend hang-up message marks a call ended for silence', () => {
  assert.equal(
    isSilenceHangUp({ type: 'call-ending', reason: 'learner_idle' }),
    true,
  )
  for (const data of [
    { type: 'call-ending', reason: 'credit_limit' },
    { type: 'call-ending' },
    { type: 'voice-service-failed', service: 'llm' },
    null,
  ])
    assert.equal(isSilenceHangUp(data), false)
})

test('A start refusal shows only the message the server wrote for learners', () => {
  assert.equal(
    startFailureMessage(402, {
      error: 'Practice credits unavailable',
      learnerMessage: 'Hạn mức luyện tập đã hết. Hãy mua thêm phút.',
    }),
    'Hạn mức luyện tập đã hết. Hãy mua thêm phút.',
  )
})

test('Unexpected start failures never show their body', () => {
  const bodies: unknown[] = [
    null,
    { error: 'Unable to start voice service' },
    { error: 'Session cannot start' },
    '<!DOCTYPE html><title>Internal Server Error</title>',
    { message: 'TypeError: private details' },
    { learnerMessage: '' },
    { learnerMessage: 'x'.repeat(301) },
    { learnerMessage: { stack: 'TypeError: private' } },
    // A server error never opts in, even with the key set.
    { learnerMessage: 'Lỗi nội bộ' },
  ]
  for (const body of bodies) {
    assert.equal(
      startFailureMessage(500, body),
      'Không thể bắt đầu phiên luyện tập. Vui lòng thử lại.',
    )
  }
  assert.equal(
    startFailureMessage(502, { error: 'Unable to start voice service' }),
    'Dịch vụ giọng nói chưa sẵn sàng. Vui lòng thử lại sau ít phút.',
  )
})
