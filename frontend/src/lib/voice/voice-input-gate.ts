import { z } from 'zod'

const botReadySchema = z.object({
  about: z.object({
    voiceInputState: z.enum(['opening', 'listening', 'failed']),
  }),
})

const voiceInputMessageSchema = z.object({
  type: z.literal('voice-input-state'),
  state: z.enum(['listening', 'failed']),
})

export type VoiceInputGateState = 'opening' | 'listening' | 'failed' | 'closed'

export function createVoiceInputGate(options: {
  enableMic: (enabled: boolean) => void
  isMicEnabled: () => boolean
  sendPracticeReady: () => void
  onStateChange: (state: VoiceInputGateState) => void
}) {
  let state: VoiceInputGateState = 'opening'
  let botReady = false
  let serverListening = false
  let botSpeaking = false
  let manuallyMuted = false
  let acknowledged = false

  const syncMic = () => {
    const enabled = state === 'listening' && !botSpeaking && !manuallyMuted
    if (options.isMicEnabled() !== enabled) options.enableMic(enabled)
  }

  const fail = () => {
    if (state === 'failed' || state === 'closed') return
    state = 'failed'
    options.enableMic(false)
    options.onStateChange(state)
  }

  const allowInput = () => {
    if (state !== 'opening' || !botReady || !serverListening) return
    state = 'listening'
    syncMic()
    options.onStateChange(state)
  }

  return {
    get state() {
      return state
    },
    get isReady() {
      return state === 'listening' && !botSpeaking
    },
    acknowledgeReady() {
      if (!botReady || state !== 'opening' || acknowledged) return
      acknowledged = true
      options.sendPracticeReady()
    },
    onBotReady(data: unknown) {
      if (state === 'failed' || state === 'closed') return
      botReady = true
      const parsed = botReadySchema.safeParse(data)
      if (parsed.success) {
        if (parsed.data.about.voiceInputState === 'failed') {
          fail()
          return
        }
        if (parsed.data.about.voiceInputState === 'listening')
          serverListening = true
      }
      allowInput()
    },
    onServerMessage(data: unknown) {
      if (state === 'failed' || state === 'closed') return
      const parsed = voiceInputMessageSchema.safeParse(data)
      if (!parsed.success) return
      if (parsed.data.state === 'failed') {
        fail()
        return
      }
      serverListening = true
      allowInput()
    },
    onBotStartedSpeaking() {
      if (state === 'failed' || state === 'closed' || botSpeaking) return
      botSpeaking = true
      syncMic()
      options.onStateChange(state)
    },
    onBotStoppedSpeaking() {
      if (state === 'failed' || state === 'closed' || !botSpeaking) return
      botSpeaking = false
      syncMic()
      options.onStateChange(state)
    },
    toggleMic() {
      if (state !== 'listening' || botSpeaking) return
      manuallyMuted = !manuallyMuted
      syncMic()
    },
    close() {
      if (state === 'closed') return
      state = 'closed'
      options.enableMic(false)
      options.onStateChange(state)
    },
  }
}
