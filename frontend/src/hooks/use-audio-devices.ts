import { useCallback, useEffect, useState } from 'react'
import {
  SYSTEM_DEFAULT_DEVICE,
  availableDeviceId,
  hasDeviceLabels,
  listAudioDevices,
  readAudioDevicePreferences,
  speakerSelectionSupported,
  writeAudioDevicePreferences,
} from '#/lib/voice/audio-devices'

export type MicAccess = 'unknown' | 'requesting' | 'granted' | 'denied'

// Absent outside secure contexts (plain http on a LAN address) and in old browsers.
function mediaDevices(): MediaDevices | undefined {
  return (navigator as Partial<Navigator>).mediaDevices
}

function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/**
 * Audio input and output devices, usable before a voice session exists.
 *
 * Device names stay hidden until the learner allows microphone access, so the
 * permission prompt only appears when they ask to choose a device.
 */
export function useAudioDevices() {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([])
  const [access, setAccess] = useState<MicAccess>('unknown')
  const [preferences, setPreferences] = useState(() =>
    readAudioDevicePreferences(
      typeof window === 'undefined' ? undefined : browserStorage(),
    ),
  )
  const [canSelectSpeaker, setCanSelectSpeaker] = useState(false)

  const refresh = useCallback(async () => {
    const media = mediaDevices()
    if (!media) return
    const devices = await media.enumerateDevices()
    setMics(listAudioDevices(devices, 'audioinput'))
    setSpeakers(listAudioDevices(devices, 'audiooutput'))
    if (hasDeviceLabels(devices)) setAccess('granted')
  }, [])

  useEffect(() => {
    setCanSelectSpeaker(speakerSelectionSupported())
    const media = mediaDevices()
    if (!media) return
    const onChange = () => void refresh().catch(() => undefined)
    onChange()
    media.addEventListener('devicechange', onChange)
    return () => media.removeEventListener('devicechange', onChange)
  }, [refresh])

  const requestAccess = useCallback(async () => {
    const media = mediaDevices()
    if (!media) {
      setAccess('denied')
      return
    }
    setAccess('requesting')
    try {
      const stream = await media.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      setAccess('granted')
      await refresh()
    } catch {
      setAccess('denied')
    }
  }, [refresh])

  const update = useCallback((change: Partial<typeof preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...change }
      writeAudioDevicePreferences(browserStorage(), next)
      return next
    })
  }, [])

  // Without labels the saved ids cannot be matched yet; keep them until then.
  const listed = access === 'granted'
  return {
    mics,
    speakers,
    access,
    canSelectSpeaker,
    micId: listed
      ? availableDeviceId(preferences.micId, mics)
      : SYSTEM_DEFAULT_DEVICE,
    speakerId: listed
      ? availableDeviceId(preferences.speakerId, speakers)
      : SYSTEM_DEFAULT_DEVICE,
    /** The saved mic, for a session to apply once it has microphone access. */
    preferredMicId: preferences.micId,
    requestAccess,
    refresh,
    selectMic: (micId: string) => update({ micId }),
    selectSpeaker: (speakerId: string) => update({ speakerId }),
  }
}
