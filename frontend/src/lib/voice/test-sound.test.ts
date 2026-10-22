import assert from 'node:assert/strict'
import { test } from 'node:test'

import { testSoundWav } from './test-sound'

test('builds a valid mono 16-bit WAV chime', () => {
  const wav = testSoundWav()
  const view = new DataView(wav.buffer)
  const ascii = (offset: number) =>
    String.fromCharCode(...wav.subarray(offset, offset + 4))

  assert.equal(ascii(0), 'RIFF')
  assert.equal(ascii(8), 'WAVE')
  assert.equal(ascii(36), 'data')
  assert.equal(view.getUint32(4, true), wav.length - 8)
  assert.equal(view.getUint16(22, true), 1)
  assert.equal(view.getUint16(34, true), 16)

  const sampleRate = view.getUint32(24, true)
  const seconds = view.getUint32(40, true) / 2 / sampleRate
  assert.ok(seconds > 0.4 && seconds < 1, `chime lasts ${seconds}s`)

  // Faded edges: no click at the start or end.
  assert.equal(view.getInt16(44, true), 0)
  assert.ok(Math.abs(view.getInt16(wav.length - 2, true)) < 50)
})
