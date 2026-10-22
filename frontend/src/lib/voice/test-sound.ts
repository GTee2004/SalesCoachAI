const SAMPLE_RATE = 24_000

// A short rising two-note chime, loud enough to hear without being harsh.
const NOTES = [
  { frequency: 660, seconds: 0.18 },
  { frequency: 880, seconds: 0.32 },
]

/** 16-bit mono PCM WAV bytes for the speaker test chime. */
export function testSoundWav(): Uint8Array<ArrayBuffer> {
  const samples: number[] = []
  for (const note of NOTES) {
    const length = Math.round(note.seconds * SAMPLE_RATE)
    for (let i = 0; i < length; i++) {
      // Fade in and out to avoid clicks at note boundaries.
      const envelope = Math.min(1, i / 240, (length - i) / 2_400)
      const value =
        Math.sin((2 * Math.PI * note.frequency * i) / SAMPLE_RATE) *
        envelope *
        0.35
      samples.push(Math.round(value * 0x7fff))
    }
  }

  const dataBytes = samples.length * 2
  const view = new DataView(new ArrayBuffer(44 + dataBytes))
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, dataBytes, true)
  samples.forEach((sample, index) =>
    view.setInt16(44 + index * 2, sample, true),
  )
  return new Uint8Array(view.buffer)
}

let testSoundUrl: string | undefined

/** Plays the chime on a speaker; an empty id means the system default. */
export async function playTestSound(speakerId: string) {
  testSoundUrl ??= URL.createObjectURL(
    new Blob([testSoundWav()], { type: 'audio/wav' }),
  )
  const audio = new Audio(testSoundUrl)
  // Safari and Firefox (by default) play through the system default instead.
  if ('setSinkId' in audio) await audio.setSinkId(speakerId)
  await audio.play()
  await new Promise<void>((resolve) => {
    audio.addEventListener('ended', () => resolve(), { once: true })
    audio.addEventListener('error', () => resolve(), { once: true })
  })
}
