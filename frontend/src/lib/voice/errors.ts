import { z } from 'zod'

const voiceErrorCodeSchema = z.enum([
  'voice_service_unavailable',
  'voice_session_failed',
])
const voiceErrorSchema = z.object({ error: voiceErrorCodeSchema })
const voiceErrorMessages = {
  // A failed turn is lost, so the learner's way forward is to say it again.
  voice_service_unavailable:
    'Cuộc gọi vừa bị gián đoạn. Hãy nói lại câu vừa rồi.',
  voice_session_failed: 'Phiên luyện tập bị gián đoạn. Vui lòng kết nối lại.',
} satisfies Record<z.infer<typeof voiceErrorCodeSchema>, string>

export function voiceErrorMessage(data: unknown): string {
  const parsed = voiceErrorSchema.safeParse(data)
  return parsed.success
    ? voiceErrorMessages[parsed.data.error]
    : 'Kết nối giọng nói gặp sự cố. Vui lòng thử lại.'
}

/** Sent by the voice backend just before it stops a call an AI service keeps failing. */
const voiceServiceFailedSchema = z.object({
  type: z.literal('voice-service-failed'),
})

export const VOICE_SERVICE_FAILED_MESSAGE =
  'Dịch vụ AI đang gặp sự cố nên cuộc gọi đã dừng. Vui lòng thử lại sau ít phút.'

export function isVoiceServiceFailure(data: unknown): boolean {
  return voiceServiceFailedSchema.safeParse(data).success
}

/** Sent by the voice backend when the buyer hangs up on a learner who stayed silent. */
const callEndingSchema = z.object({
  type: z.literal('call-ending'),
  reason: z.literal('learner_idle'),
})

export function isSilenceHangUp(data: unknown): boolean {
  return callEndingSchema.safeParse(data).success
}

// Only `learnerMessage` is ever shown from a start response, and only on a 4xx.
// The server sets it for refusals written for learners; any other body, such
// as an unexpected error page or a library's `message`, maps to fixed text.
const startRefusalSchema = z.object({
  learnerMessage: z.string().trim().min(1).max(300),
})

const startFailureMessages: Partial<Record<number, string>> = {
  401: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  402: 'Hạn mức luyện tập đã hết. Vui lòng kiểm tra trang thanh toán.',
  404: 'Không tìm thấy bài luyện tập này.',
  409: 'Phiên luyện tập đang được xử lý. Vui lòng tải lại trang và thử lại.',
  502: 'Dịch vụ giọng nói chưa sẵn sàng. Vui lòng thử lại sau ít phút.',
  503: 'Dịch vụ giọng nói chưa sẵn sàng. Vui lòng thử lại sau ít phút.',
}

export function startFailureMessage(status: number, body: unknown): string {
  const refusal = startRefusalSchema.safeParse(body)
  if (refusal.success && status >= 400 && status < 500)
    return refusal.data.learnerMessage
  return (
    startFailureMessages[status] ??
    'Không thể bắt đầu phiên luyện tập. Vui lòng thử lại.'
  )
}

/** Shown when the microphone could not be opened, e.g. permission denied. */
export const MICROPHONE_FAILED_MESSAGE =
  'Không thể mở micro. Vui lòng kiểm tra quyền truy cập micro và thử lại.'

/** Shown when the voice connection itself could not be established. */
export const VOICE_CONNECT_FAILED_MESSAGE =
  'Không thể kết nối tới dịch vụ giọng nói. Vui lòng thử lại.'
