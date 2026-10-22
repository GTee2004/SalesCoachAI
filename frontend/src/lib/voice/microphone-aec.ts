import { logger } from '@pipecat-ai/client-js'

type ConstrainableAudioTrack = Pick<
  MediaStreamTrack,
  'id' | 'getConstraints' | 'applyConstraints' | 'getSettings'
>

export function createMicEchoCancellation(
  sessionId: string,
): (track: ConstrainableAudioTrack) => Promise<void> {
  const attempts = new WeakMap<ConstrainableAudioTrack, Promise<void>>()

  return (track) => {
    const existing = attempts.get(track)
    if (existing) return existing

    const attempt = (async () => {
      try {
        await track.applyConstraints({
          ...track.getConstraints(),
          echoCancellation: true,
          noiseSuppression: true,
        })
        const settings = track.getSettings()
        const reported = settings.echoCancellation
        const actual =
          reported === true || reported === false ? reported : 'unreported'
        const noiseSuppressionReported = settings.noiseSuppression
        const noiseSuppressionActual =
          noiseSuppressionReported === true ||
          noiseSuppressionReported === false
            ? noiseSuppressionReported
            : 'unreported'
        const context = {
          sessionId,
          trackId: track.id,
          requested: true,
          actual,
          noiseSuppressionRequested: true,
          noiseSuppressionActual,
        }
        if (actual === true && noiseSuppressionActual === true) {
          logger.info('Microphone audio processing', context)
        } else {
          logger.warn('Microphone audio processing', context)
        }
      } catch (error) {
        logger.warn('Microphone audio processing request failed', {
          sessionId,
          trackId: track.id,
          error,
        })
      }
    })()

    attempts.set(track, attempt)
    return attempt
  }
}
