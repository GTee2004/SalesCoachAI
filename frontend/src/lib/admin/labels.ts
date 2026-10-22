import type {
  CostSeriesKey,
  LatencyStageKey,
  ServiceKey,
  SessionOutcomeKey,
  UsageGranularity,
} from './contracts'

export const SERVICE_LABELS: Record<
  ServiceKey,
  { name: string; technology: string }
> = {
  web: { name: 'Ứng dụng web', technology: 'TanStack Start · Nitro' },
  database: { name: 'PostgreSQL', technology: 'Cơ sở dữ liệu' },
  voice: { name: 'Dịch vụ giọng nói', technology: 'FastAPI · Pipecat' },
}

/** What learners notice while the service is unavailable. */
export const SERVICE_IMPACT: Record<Exclude<ServiceKey, 'web'>, string> = {
  database:
    'Người học không đăng nhập được và dữ liệu phiên luyện không được lưu.',
  voice: 'Người học chưa thể bắt đầu hoặc tiếp tục cuộc gọi.',
}

/** The unit one chart bucket covers, as in "theo tuần" and "mỗi tuần". */
export const GRANULARITY_LABELS: Record<UsageGranularity, string> = {
  day: 'ngày',
  week: 'tuần',
  month: 'tháng',
}

export const OUTCOME_LABELS: Record<SessionOutcomeKey, string> = {
  learner_ended: 'Người học kết thúc',
  buyer_hung_up: 'Khách hàng AI cúp máy',
  time_limit: 'Hết thời gian',
  learner_idle: 'Người học không phản hồi',
  completed: 'Hoàn thành',
  abandoned: 'Bỏ dở giữa chừng',
  connection_lost: 'Mất kết nối',
  technical_error: 'Lỗi kỹ thuật',
  in_progress: 'Đang diễn ra',
}

export const LATENCY_STAGE_LABELS: Record<
  LatencyStageKey,
  { name: string; detail: string }
> = {
  turn_taking: {
    name: 'Chờ hết lượt nói',
    detail: 'Chờ dịch vụ STT xác định người học đã kết thúc lượt nói',
  },
  stt: { name: 'Nhận dạng giọng nói', detail: 'Chốt bản ghi lời người học' },
  llm: { name: 'Mô hình ngôn ngữ', detail: 'Đến khi có token đầu tiên' },
  tts: { name: 'Tổng hợp giọng nói', detail: 'Đến đoạn âm thanh đầu tiên' },
  other: {
    name: 'Truyền tải và khác',
    detail: 'Phát âm thanh và nội bộ pipeline',
  },
}

/**
 * TTS providers by the id the voice backend records on a session. ZeroTTS and
 * VieNeu are no longer offered but still label past sessions.
 */
export const TTS_PROVIDER_LABELS: Record<string, string> = {
  zerotts: 'ZeroTTS',
  vieneu: 'VieNeu',
  gemini: 'Gemini',
  soniox: 'Soniox',
  elevenlabs: 'ElevenLabs',
  unknown: 'Không rõ',
}

/** What each part of the spend pays for. */
export const COST_SERIES_LABELS: Record<
  CostSeriesKey,
  { name: string; detail: string }
> = {
  stt: { name: 'Nhận dạng giọng nói', detail: 'STT trong cuộc gọi' },
  llm: { name: 'Khách hàng AI', detail: 'LLM trả lời trong cuộc gọi' },
  tts: { name: 'Giọng đọc', detail: 'TTS trong cuộc gọi' },
  evaluation: { name: 'Chấm điểm', detail: 'LLM đánh giá sau cuộc gọi' },
}

/** Providers by the id the voice backend reports usage under. */
export const COST_PROVIDER_LABELS: Record<string, string> = {
  ...TTS_PROVIDER_LABELS,
  assemblyai: 'AssemblyAI',
  openrouter: 'OpenRouter',
}
