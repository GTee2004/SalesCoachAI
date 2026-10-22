import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  SYSTEM_DEFAULT_DEVICE,
  availableDeviceId,
  hasDeviceLabels,
  listAudioDevices,
  readAudioDevicePreferences,
  suggestMicType,
  writeAudioDevicePreferences,
} from './audio-devices'

function device(
  kind: MediaDeviceKind,
  deviceId: string,
  label = '',
): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: 'g', toJSON: () => ({}) }
}

test('lists real devices of one kind without browser aliases', () => {
  const devices = [
    device('audioinput', 'default', 'Default - MacBook Pro Microphone'),
    device('audioinput', 'communications', 'Communications - Headset'),
    device('audioinput', 'mac', 'MacBook Pro Microphone'),
    device('audioinput', 'mac', 'MacBook Pro Microphone'),
    device('audioinput', 'headset', 'Jabra Evolve2'),
    device('audiooutput', 'speakers', 'MacBook Pro Speakers'),
    device('audioinput', '', ''),
  ]

  assert.deepEqual(
    listAudioDevices(devices, 'audioinput').map((d) => d.deviceId),
    ['mac', 'headset'],
  )
  assert.deepEqual(
    listAudioDevices(devices, 'audiooutput').map((d) => d.deviceId),
    ['speakers'],
  )
})

test('detects whether the page can read device labels', () => {
  assert.equal(hasDeviceLabels([device('audioinput', 'a')]), false)
  assert.equal(hasDeviceLabels([device('audioinput', 'a', 'Mic')]), true)
  assert.equal(hasDeviceLabels([device('audiooutput', 'a', 'Speaker')]), false)
})

test('falls back to the system default when a saved device is gone', () => {
  const devices = [device('audioinput', 'mac', 'MacBook Pro Microphone')]
  assert.equal(availableDeviceId('mac', devices), 'mac')
  assert.equal(availableDeviceId('unplugged', devices), SYSTEM_DEFAULT_DEVICE)
})

test('suggests a mic type from common device labels', () => {
  assert.equal(suggestMicType('AirPods Pro'), 'worn')
  assert.equal(suggestMicType('Jabra Evolve2 65'), 'worn')
  assert.equal(suggestMicType('Headset Microphone (Realtek)'), 'worn')
  assert.equal(suggestMicType('MacBook Pro Microphone'), 'built_in')
  assert.equal(suggestMicType('Internal Microphone'), 'built_in')
  assert.equal(suggestMicType('USB Audio Device'), null)
})

test('reads and writes device preferences defensively', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }

  assert.deepEqual(readAudioDevicePreferences(storage), {
    micId: SYSTEM_DEFAULT_DEVICE,
    speakerId: SYSTEM_DEFAULT_DEVICE,
  })
  writeAudioDevicePreferences(storage, { micId: 'mac', speakerId: 'out' })
  assert.deepEqual(readAudioDevicePreferences(storage), {
    micId: 'mac',
    speakerId: 'out',
  })

  values.set('salescoach.voice.audio-devices', '{not json')
  assert.equal(readAudioDevicePreferences(storage).micId, SYSTEM_DEFAULT_DEVICE)
  assert.doesNotThrow(() =>
    writeAudioDevicePreferences(
      {
        setItem: () => {
          throw new Error('blocked')
        },
      },
      { micId: 'mac', speakerId: '' },
    ),
  )
  assert.equal(readAudioDevicePreferences(undefined).micId, '')
})
