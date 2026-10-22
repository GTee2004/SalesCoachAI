import { useEffect, useRef } from 'react'
import {
  PipecatClientProvider,
  usePipecatClientMediaTrack,
} from '@pipecat-ai/client-react'
import { logger } from '@pipecat-ai/client-js'
import type { PipecatClient } from '@pipecat-ai/client-js'

type SinkableAudio = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>
}

export function VoiceSessionAudio({
  client,
  speakerId,
}: {
  client: PipecatClient | null
  /** Empty for the system default output. */
  speakerId: string
}) {
  if (!client) return null
  return (
    <PipecatClientProvider client={client} autoInitDevices={false}>
      <BotAudio speakerId={speakerId} />
    </PipecatClientProvider>
  )
}

// PipecatClientAudio only switches outputs on a SpeakerUpdated event, so a
// speaker chosen before the session would never reach its audio element.
function BotAudio({ speakerId }: { speakerId: string }) {
  const audioRef = useRef<SinkableAudio>(null)
  const track = usePipecatClientMediaTrack('audio', 'bot')

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !track) return
    const current = (audio.srcObject as MediaStream | null)?.getAudioTracks()[0]
    if (current?.id !== track.id) audio.srcObject = new MediaStream([track])
  }, [track])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio?.setSinkId) return
    audio.setSinkId(speakerId).catch((error: unknown) => {
      logger.warn('Could not switch speaker', { speakerId, error })
    })
  }, [speakerId])

  return <audio ref={audioRef} autoPlay />
}
