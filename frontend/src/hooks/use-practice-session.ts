import {
  LogLevel,
  PipecatClient,
  RTVIEvent,
  logger,
} from '@pipecat-ai/client-js'
import type {
  BotOutputData,
  TranscriptData,
  TransportState,
} from '@pipecat-ai/client-js'
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  MicType,
  PracticeActivity,
  PracticeFeedbackResult,
  PracticeLifecycle,
  TranscriptMessage,
  TtsProvider,
} from '#/lib/voice/contracts'
import {
  practiceFeedbackResultSchema,
  ttsProviderSchema,
} from '#/lib/voice/contracts'
import {
  MICROPHONE_FAILED_MESSAGE,
  VOICE_CONNECT_FAILED_MESSAGE,
  VOICE_SERVICE_FAILED_MESSAGE,
  isSilenceHangUp,
  isVoiceServiceFailure,
  startFailureMessage,
  voiceErrorMessage,
} from '#/lib/voice/errors'
import { trackVoiceActivity } from '#/lib/auth/workspace-sync'
import { createMicEchoCancellation } from '#/lib/voice/microphone-aec'
import { createVoiceInputGate } from '#/lib/voice/voice-input-gate'
import {
  practiceFeedbackQueryOptions,
  practiceSessionQueryOptions,
} from '#/lib/practice/queries'

export type StartOptions = {
  /** Omitted when the voice backend ignores the mic type. */
  micType?: MicType
  /** Empty for the system default microphone. */
  micDeviceId: string
}

/** Switch to the learner's chosen mic before the session goes live. */
async function switchToPreferredMic(voiceClient: PipecatClient, micId: string) {
  if (!micId || voiceClient.selectedMic.deviceId === micId) return
  const mics = await voiceClient.getAllMics()
  if (!mics.some((mic) => mic.deviceId === micId)) return
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timeout)
      voiceClient.off(RTVIEvent.MicUpdated, done)
      resolve()
    }
    // The transport does not report a failed switch; keep the current mic.
    const timeout = setTimeout(done, 3_000)
    voiceClient.on(RTVIEvent.MicUpdated, done)
    voiceClient.updateMic(micId)
  })
}

export function usePracticeSession(
  sessionId: string,
  userId: string,
  workspaceId: string,
) {
  const clientRef = useRef<PipecatClient | null>(null)
  const startAttemptRef = useRef<AbortController | null>(null)
  const inputGateRef = useRef<ReturnType<typeof createVoiceInputGate> | null>(
    null,
  )
  const lifecycleRef = useRef<PracticeLifecycle | 'idle'>('idle')
  const queryClient = useQueryClient()
  const sessionQuery = useQuery(
    practiceSessionQueryOptions(userId, workspaceId, sessionId),
  )
  const feedbackQuery = useQuery(
    practiceFeedbackQueryOptions(userId, workspaceId, sessionId),
  )
  const session = sessionQuery.data ?? null
  const [client, setClient] = useState<PipecatClient | null>(null)
  const [lifecycle, setLifecycleState] = useState<PracticeLifecycle | 'idle'>(
    'idle',
  )
  const [activity, setActivity] = useState<PracticeActivity>('idle')
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [endError, setEndError] = useState(false)
  const [micEnabled, setMicEnabled] = useState(false)
  const [inputReady, setInputReady] = useState(false)
  // The buyer hung up because the learner stayed silent.
  const [buyerHungUp, setBuyerHungUp] = useState(false)

  useEffect(
    () =>
      trackVoiceActivity(
        userId,
        ['provisioning', 'awaiting_connection', 'active', 'ending'].includes(
          lifecycle,
        ),
      ),
    [lifecycle, userId],
  )

  const setLifecycle = useCallback((value: PracticeLifecycle | 'idle') => {
    lifecycleRef.current = value
    setLifecycleState(value)
  }, [])

  const upsertMessage = useCallback((message: TranscriptMessage) => {
    setMessages((current) => {
      const index = current.findIndex((item) => item.id === message.id)
      if (index < 0) return [...current, message]
      const next = [...current]
      next[index] = { ...next[index], ...message }
      return next
    })
  }, [])

  const refreshSnapshot = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: ['practice', userId, workspaceId, 'session', sessionId],
    })
    return queryClient.query(
      practiceSessionQueryOptions(userId, workspaceId, sessionId),
    )
  }, [queryClient, sessionId, userId, workspaceId])

  /** Wait for a call the voice backend ended to be saved, then show its results. */
  const awaitServerEnd = useCallback(async () => {
    // The backend reports the end just after it disconnects the call.
    for (let attempt = 0; attempt < 20; attempt++) {
      const snapshot = await refreshSnapshot().catch(() => null)
      if (snapshot && snapshot.status !== 'in_progress') {
        setMessages(snapshot.transcript)
        await Promise.all(
          ['history', 'performance', 'recommendations'].map((key) =>
            queryClient.invalidateQueries({
              queryKey: ['practice', userId, workspaceId, key],
            }),
          ),
        ).catch(() => undefined)
        await queryClient
          .invalidateQueries({
            queryKey: ['practice', userId, workspaceId, 'feedback', sessionId],
          })
          .catch(() => undefined)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    setError(
      'Phiên đã kết thúc nhưng chưa tải được kết quả. Vui lòng tải lại trang.',
    )
    setLifecycle('failed')
  }, [
    queryClient,
    refreshSnapshot,
    sessionId,
    setLifecycle,
    userId,
    workspaceId,
  ])

  const retryMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/practice/sessions/${encodeURIComponent(sessionId)}/feedback`,
        { method: 'POST', headers: { 'x-workspace-id': workspaceId } },
      )
      const result: unknown = await response.json()
      if (!response.ok) throw new Error('Evaluation failed')
      return practiceFeedbackResultSchema.parse(result)
    },
    retry: false,
    onSuccess: async (result) => {
      queryClient.setQueryData(
        practiceFeedbackQueryOptions(userId, workspaceId, sessionId).queryKey,
        result,
      )
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['practice', userId, workspaceId, 'recommendations'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['practice', userId, workspaceId, 'history'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['practice', userId, workspaceId, 'performance'],
        }),
      ])
    },
    onError: () => setError('Không thể tạo đánh giá. Vui lòng thử lại.'),
  })

  const retryFeedback = useCallback(() => {
    if (retryMutation.isPending) return
    setError(null)
    retryMutation.mutate()
  }, [retryMutation])

  useEffect(() => {
    if (feedbackQuery.data?.state === 'ready') {
      void queryClient.invalidateQueries({
        queryKey: ['practice', userId, workspaceId, 'performance'],
      })
    }
  }, [feedbackQuery.data?.state, queryClient, userId, workspaceId])

  useEffect(() => {
    if (session) {
      if (!clientRef.current) setMessages(session.transcript)
      if (session.status === 'completed' || session.status === 'abandoned') {
        inputGateRef.current?.close()
        const endedClient = clientRef.current
        clientRef.current = null
        setClient(null)
        void endedClient?.disconnect().catch(() => undefined)
        setLifecycle('ended')
      }
    }
  }, [session, setLifecycle])

  useEffect(() => {
    if (sessionQuery.isError)
      setError('Không thể tải phiên luyện tập. Vui lòng tải lại trang.')
  }, [sessionQuery.isError])

  const createClient = useCallback(
    (createdSessionId: string, attemptId: string) => {
      let userInterimId = crypto.randomUUID()
      let heartbeat: ReturnType<typeof setInterval> | undefined
      // Whether the buyer's current reply produced any text. A reply that
      // ends without it failed, and nothing will be spoken for it.
      let replyHasText = false
      // Set when the backend stops the call because an AI service keeps failing.
      let serviceFailed = false
      // Set when the buyer hangs up because the learner stayed silent.
      let hungUp = false
      const stopHeartbeat = () => {
        if (heartbeat !== undefined) clearInterval(heartbeat)
        heartbeat = undefined
      }
      const sendHeartbeat = () => {
        if (clientRef.current !== voiceClient || inputGate.state === 'closed') {
          stopHeartbeat()
          return
        }
        try {
          voiceClient.sendClientMessage('practice-heartbeat', {
            sessionId: createdSessionId,
            attemptId,
          })
        } catch {
          stopHeartbeat()
        }
      }
      logger.setLevel(LogLevel.DEBUG)
      const ensureMicAec = createMicEchoCancellation(createdSessionId)
      const inputGate = createVoiceInputGate({
        enableMic: (enabled) => voiceClient.enableMic(enabled),
        isMicEnabled: () => voiceClient.isMicEnabled,
        sendPracticeReady: () =>
          voiceClient.sendClientMessage('practice-ready', {
            sessionId: createdSessionId,
            attemptId,
          }),
        onStateChange: (state) => {
          if (inputGateRef.current !== inputGate) return
          setInputReady(inputGate.isReady)
          setMicEnabled(inputGate.isReady && voiceClient.isMicEnabled)
          if (inputGate.isReady) setActivity('listening')
          if (state === 'failed') {
            setActivity('idle')
            setLifecycle('failed')
            setError(
              'Không thể phát lời chào của khách hàng. Vui lòng thử lại.',
            )
          }
          if (state === 'closed') {
            stopHeartbeat()
            setActivity('idle')
          }
        },
      })
      const voiceClient = new PipecatClient({
        transport: new SmallWebRTCTransport(),
        enableMic: true,
        enableCam: false,
        callbacks: {
          onTrackStarted: (track, participant) => {
            if (
              clientRef.current !== voiceClient ||
              inputGate.state === 'closed' ||
              !participant?.local ||
              track.kind !== 'audio'
            )
              return
            void ensureMicAec(track)
          },
          onTransportStateChanged: (state: TransportState) => {
            if (
              clientRef.current !== voiceClient ||
              inputGate.state === 'closed'
            )
              return
            if (state === 'connecting') setLifecycle('awaiting_connection')
          },
          onBotReady: (data) => {
            if (
              clientRef.current !== voiceClient ||
              inputGate.state === 'closed'
            )
              return
            stopHeartbeat()
            sendHeartbeat()
            heartbeat = setInterval(sendHeartbeat, 5000)
            inputGate.onBotReady(data)
            if (inputGate.state !== 'failed') setLifecycle('active')
            if (inputGate.state === 'opening') setActivity('opening')
            void refreshSnapshot().catch(() => undefined)
          },
          onServerMessage: (data: unknown) => {
            if (
              clientRef.current !== voiceClient ||
              inputGate.state === 'closed'
            )
              return
            if (isVoiceServiceFailure(data)) {
              serviceFailed = true
              return
            }
            if (isSilenceHangUp(data)) {
              hungUp = true
              setBuyerHungUp(true)
              return
            }
            inputGate.onServerMessage(data)
          },
          onUserStartedSpeaking: () => {
            if (inputGate.isReady) setActivity('user-speaking')
          },
          onUserStoppedSpeaking: () => {
            if (inputGate.isReady) setActivity('thinking')
          },
          onBotLlmStarted: () => {
            replyHasText = false
            if (inputGate.state !== 'closed') setActivity('thinking')
          },
          onBotLlmText: () => {
            replyHasText = true
          },
          onBotLlmStopped: () => {
            // A failed reply leaves nothing to wait for; stop showing "thinking".
            if (!replyHasText && inputGate.isReady)
              setActivity((current) =>
                current === 'thinking' ? 'listening' : current,
              )
          },
          onBotStartedSpeaking: () => {
            if (inputGate.state === 'closed' || inputGate.state === 'failed')
              return
            inputGate.onBotStartedSpeaking()
            setActivity('bot-speaking')
            // The buyer is talking again, so an earlier turn's failure is over.
            setError(null)
          },
          onBotStoppedSpeaking: () => {
            if (inputGate.state === 'closed') return
            inputGate.onBotStoppedSpeaking()
            setActivity(
              inputGate.isReady
                ? 'listening'
                : inputGate.state === 'opening'
                  ? 'opening'
                  : 'idle',
            )
          },
          onUserTranscript: (data: TranscriptData) => {
            if (!inputGate.isReady) return
            upsertMessage({
              id: userInterimId,
              role: 'user',
              text: data.text,
              final: data.final,
              timestamp: data.timestamp || new Date().toISOString(),
            })
            if (data.final) userInterimId = crypto.randomUUID()
          },
          onBotOutput: (data: BotOutputData) => {
            if (inputGate.state === 'closed') return
            const spoken =
              data.spoken_status === 'completed' ||
              (data.spoken_status == null && data.spoken === true)
            if (!data.text.trim() || !spoken) return
            upsertMessage({
              id: `assistant-${data.segment_id ?? crypto.randomUUID()}`,
              role: 'assistant',
              text: data.text,
              final: true,
              timestamp: new Date().toISOString(),
            })
          },
          onMicUpdated: () => {
            if (inputGate.state !== 'closed')
              setMicEnabled(inputGate.isReady && voiceClient.isMicEnabled)
          },
          onError: (message) => {
            if (inputGate.state !== 'closed')
              setError(voiceErrorMessage(message.data))
          },
          onDisconnected: () => {
            stopHeartbeat()
            if (
              clientRef.current !== voiceClient ||
              inputGate.state === 'closed'
            )
              return
            inputGate.close()
            if (hungUp && !['ending', 'ended'].includes(lifecycleRef.current)) {
              clientRef.current = null
              setClient(null)
              setLifecycle('ending')
              void awaitServerEnd()
              return
            }
            if (!['ending', 'ended'].includes(lifecycleRef.current)) {
              setError(
                serviceFailed
                  ? VOICE_SERVICE_FAILED_MESSAGE
                  : 'Kết nối đã bị gián đoạn. Vui lòng thử lại để tiếp tục phiên luyện tập.',
              )
              setLifecycle('failed')
              void refreshSnapshot().catch(() => undefined)
            }
          },
        },
      })
      clientRef.current = voiceClient
      inputGateRef.current = inputGate
      setClient(voiceClient)
      return {
        client: voiceClient,
        inputGate,
        sessionId: createdSessionId,
        ensureMicAec,
      }
    },
    [awaitServerEnd, refreshSnapshot, setLifecycle, upsertMessage],
  )

  useEffect(() => {
    if (lifecycle !== 'active' || !client || clientRef.current !== client)
      return
    try {
      inputGateRef.current?.acknowledgeReady()
    } catch {
      inputGateRef.current?.close()
      setError('Không thể bắt đầu lời chào của khách hàng. Vui lòng thử lại.')
      setLifecycle('failed')
      void client.disconnect().catch(() => undefined)
    }
  }, [client, lifecycle, setLifecycle])

  const start = useCallback(
    async (
      ttsProvider: TtsProvider,
      { micType, micDeviceId }: StartOptions,
    ) => {
      if (!['idle', 'failed'].includes(lifecycleRef.current)) return
      startAttemptRef.current?.abort()
      const attempt = new AbortController()
      startAttemptRef.current = attempt
      const isCurrent = () =>
        startAttemptRef.current === attempt && !attempt.signal.aborted
      let attemptClient: PipecatClient | null = null
      let attemptGate: ReturnType<typeof createVoiceInputGate> | null = null
      const previousClient = clientRef.current
      inputGateRef.current?.close()
      inputGateRef.current = null
      clientRef.current = null
      setClient(null)
      setError(null)
      setEndError(false)
      setBuyerHungUp(false)
      setLifecycle('provisioning')
      // What a failure below is reported as, by the step that was running.
      let failureMessage = startFailureMessage(0, null)
      try {
        await previousClient?.disconnect().catch(() => undefined)
        if (!isCurrent()) return
        const response = await fetch(
          `/api/practice/sessions/${encodeURIComponent(sessionId)}/start`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-workspace-id': workspaceId,
            },
            body: JSON.stringify({ ttsProvider, micType }),
            signal: attempt.signal,
          },
        )
        const result: unknown = await response.json().catch(() => null)
        if (!isCurrent()) return
        if (!response.ok || typeof result !== 'object' || result === null) {
          failureMessage = startFailureMessage(response.status, result)
          throw new Error(`Không thể bắt đầu phiên (${response.status}).`)
        }
        const connection = result as {
          attemptId?: string
          ttsProvider?: string
          signalingUrl?: string
          connectionToken?: string
          startedAt?: string | null
          error?: string
        }
        if (
          !connection.signalingUrl ||
          !connection.connectionToken ||
          !connection.attemptId
        )
          throw new Error(
            connection.error ?? 'Phản hồi khởi chạy không hợp lệ.',
          )
        queryClient.setQueryData(
          practiceSessionQueryOptions(userId, workspaceId, sessionId).queryKey,
          (current) =>
            current
              ? {
                  ...current,
                  status: 'in_progress' as const,
                  startedAt: connection.startedAt ?? current.startedAt,
                  // The server may have fallen back to another provider.
                  ttsProvider:
                    ttsProviderSchema.safeParse(connection.ttsProvider).data ??
                    ttsProvider,
                  micType: micType ?? current.micType,
                }
              : current,
        )
        const {
          client: voiceClient,
          inputGate,
          ensureMicAec,
        } = createClient(sessionId, connection.attemptId)
        attemptClient = voiceClient
        attemptGate = inputGate
        failureMessage = MICROPHONE_FAILED_MESSAGE
        await voiceClient.initDevices()
        if (!isCurrent()) return
        await switchToPreferredMic(voiceClient, micDeviceId)
        if (!isCurrent()) return
        const localMic = voiceClient.tracks().local.audio
        const initialAec = localMic ? ensureMicAec(localMic) : Promise.resolve()
        if (!localMic)
          logger.warn(
            'Microphone echo cancellation: local audio track unavailable',
            {
              sessionId,
            },
          )
        voiceClient.enableMic(false)
        await initialAec
        if (!isCurrent()) return
        setLifecycle('awaiting_connection')
        failureMessage = VOICE_CONNECT_FAILED_MESSAGE
        await voiceClient.connect({
          webrtcRequestParams: {
            endpoint: connection.signalingUrl,
            headers: new Headers({
              authorization: `Bearer ${connection.connectionToken}`,
            }),
            requestData: { sessionId },
          },
        })
      } catch {
        if (!isCurrent()) return
        attemptGate?.close()
        setError((current) => current ?? failureMessage)
        setLifecycle('failed')
        await attemptClient?.disconnect().catch(() => undefined)
      } finally {
        // Device initialization can finish after End or navigation. Release the
        // client owned by this attempt without touching a newer client's state.
        if (!isCurrent())
          await attemptClient?.disconnect().catch(() => undefined)
      }
    },
    [createClient, queryClient, sessionId, setLifecycle, userId, workspaceId],
  )

  const end = useCallback(async () => {
    if (!session || ['ending', 'ended'].includes(lifecycleRef.current)) return
    startAttemptRef.current?.abort()
    startAttemptRef.current = null
    setError(null)
    setEndError(false)
    inputGateRef.current?.close()
    inputGateRef.current = null
    const voiceClient = clientRef.current
    clientRef.current = null
    setClient(null)
    setLifecycle('ending')
    const disconnect = voiceClient?.disconnect().catch(() => undefined)
    try {
      const response = await fetch(
        `/api/practice/sessions/${encodeURIComponent(sessionId)}/end`,
        { method: 'POST', headers: { 'x-workspace-id': workspaceId } },
      )
      if (!response.ok)
        throw new Error(`Không thể kết thúc phiên (${response.status}).`)
      // A failed read after End (e.g. a different active workspace) must not
      // turn a successfully stopped call into an End failure.
      setLifecycle('ended')
      try {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ['practice', userId, workspaceId, 'history'],
          }),
          queryClient.invalidateQueries({
            queryKey: ['practice', userId, workspaceId, 'performance'],
          }),
        ])
        const snapshot = await refreshSnapshot()
        setMessages(snapshot?.transcript ?? [])
        await queryClient.invalidateQueries({
          queryKey: ['practice', userId, workspaceId, 'feedback', sessionId],
        })
        await queryClient.query(
          practiceFeedbackQueryOptions(userId, workspaceId, sessionId),
        )
        await queryClient.invalidateQueries({
          queryKey: ['practice', userId, workspaceId, 'recommendations'],
        })
      } catch {
        setError(
          'Phiên đã kết thúc. Tải lại trang để xem kết quả trong không gian làm việc của phiên.',
        )
      }
    } catch {
      setError('Không thể kết thúc phiên luyện tập. Vui lòng thử lại.')
      setEndError(true)
      setLifecycle('failed')
    } finally {
      await disconnect
    }
  }, [
    queryClient,
    refreshSnapshot,
    session,
    sessionId,
    setLifecycle,
    userId,
    workspaceId,
  ])

  const toggleMic = useCallback(() => {
    const current = clientRef.current
    if (!current || lifecycleRef.current !== 'active') return
    inputGateRef.current?.toggleMic()
    setMicEnabled(
      (inputGateRef.current?.isReady ?? false) && current.isMicEnabled,
    )
  }, [])
  const selectMic = useCallback(async (deviceId: string) => {
    const voiceClient = clientRef.current
    if (!voiceClient) return
    if (deviceId) {
      voiceClient.updateMic(deviceId)
      return
    }
    // Only Chromium exposes a "default" input to switch back to mid-session;
    // elsewhere the system default applies from the next session.
    const mics = await voiceClient.getAllMics()
    if (mics.some((mic) => mic.deviceId === 'default'))
      voiceClient.updateMic('default')
  }, [])

  useEffect(() => {
    return () => {
      startAttemptRef.current?.abort()
      startAttemptRef.current = null
      const voiceClient = clientRef.current
      clientRef.current = null
      const inputGate = inputGateRef.current
      inputGateRef.current = null
      inputGate?.close()
      void voiceClient?.disconnect().catch(() => undefined)
    }
  }, [])

  const feedback: PracticeFeedbackResult = retryMutation.isPending
    ? { state: 'pending' }
    : retryMutation.isError && feedbackQuery.data?.state !== 'ready'
      ? { state: 'failed', errorCode: 'evaluation_failed' }
      : (feedbackQuery.data ?? { state: 'not-requested' })

  return {
    client,
    session,
    lifecycle,
    activity,
    messages,
    feedback,
    error,
    endError,
    notFound: !sessionQuery.isLoading && sessionQuery.data === null,
    micEnabled,
    inputReady,
    buyerHungUp,
    start,
    end,
    toggleMic,
    selectMic,
    retryFeedback,
  }
}
