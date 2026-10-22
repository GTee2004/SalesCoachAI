import type { MicType } from '#/lib/voice/contracts'

/** Empty device id: let the browser use the operating system default. */
export const SYSTEM_DEFAULT_DEVICE = ''

export type AudioDeviceKind = 'audioinput' | 'audiooutput'

export type AudioDevicePreferences = {
  micId: string
  speakerId: string
}

const PREFERENCES_KEY = 'salescoach.voice.audio-devices'

// Chrome lists the default and communications devices again under these
// pseudo ids. The system default option already covers them.
const ALIAS_DEVICE_IDS = new Set(['default', 'communications'])

/** Real devices of one kind, without browser alias entries or duplicates. */
export function listAudioDevices(
  devices: ReadonlyArray<MediaDeviceInfo>,
  kind: AudioDeviceKind,
): MediaDeviceInfo[] {
  const seen = new Set<string>()
  return devices.filter((device) => {
    if (
      device.kind !== kind ||
      !device.deviceId ||
      ALIAS_DEVICE_IDS.has(device.deviceId) ||
      seen.has(device.deviceId)
    )
      return false
    seen.add(device.deviceId)
    return true
  })
}

/** Browsers hide device labels until the page has microphone access. */
export function hasDeviceLabels(devices: ReadonlyArray<MediaDeviceInfo>) {
  return devices.some(
    (device) => device.kind === 'audioinput' && device.label !== '',
  )
}

/** A saved device id that is still connected, or the system default. */
export function availableDeviceId(
  deviceId: string,
  devices: ReadonlyArray<MediaDeviceInfo>,
) {
  return devices.some((device) => device.deviceId === deviceId)
    ? deviceId
    : SYSTEM_DEFAULT_DEVICE
}

const WORN_MIC_LABEL =
  /headset|headphone|earphone|earbud|airpods|buds|lapel|lavalier|jabra|plantronics|poly |tai nghe/i
const BUILT_IN_MIC_LABEL = /built-in|internal|macbook|tích hợp|webcam|camera/i

/** Best guess of the mic type from a device label, or null when unsure. */
export function suggestMicType(label: string): MicType | null {
  if (WORN_MIC_LABEL.test(label)) return 'worn'
  if (BUILT_IN_MIC_LABEL.test(label)) return 'built_in'
  return null
}

export function speakerSelectionSupported() {
  return (
    typeof HTMLMediaElement !== 'undefined' &&
    'setSinkId' in HTMLMediaElement.prototype
  )
}

export function readAudioDevicePreferences(
  storage: Pick<Storage, 'getItem'> | undefined,
): AudioDevicePreferences {
  const fallback = {
    micId: SYSTEM_DEFAULT_DEVICE,
    speakerId: SYSTEM_DEFAULT_DEVICE,
  }
  try {
    const raw = storage?.getItem(PREFERENCES_KEY)
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return fallback
    const { micId, speakerId } = parsed as Record<string, unknown>
    return {
      micId: typeof micId === 'string' ? micId : fallback.micId,
      speakerId: typeof speakerId === 'string' ? speakerId : fallback.speakerId,
    }
  } catch {
    return fallback
  }
}

export function writeAudioDevicePreferences(
  storage: Pick<Storage, 'setItem'> | undefined,
  preferences: AudioDevicePreferences,
) {
  try {
    storage?.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    // Storage can be unavailable in private windows; the choice still applies.
  }
}
