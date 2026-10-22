import { CircleCheck, CircleMinus, CircleX, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  ServiceCheck,
  ServiceHealth,
  ServiceState,
} from '#/lib/admin/contracts'
import { formatCount, formatUptime } from '#/lib/admin/format'
import { SERVICE_IMPACT, SERVICE_LABELS } from '#/lib/admin/labels'
import { Panel, PanelMessage, StatusPill } from './panel'
import type { Tone } from './panel'

const STATE_VIEW: Record<
  ServiceState,
  { tone: Tone; icon: LucideIcon; label: string }
> = {
  up: { tone: 'good', icon: CircleCheck, label: 'Hoạt động' },
  down: { tone: 'critical', icon: CircleX, label: 'Không phản hồi' },
  unknown: { tone: 'neutral', icon: CircleMinus, label: 'Không rõ' },
}

function serviceDetail(check: ServiceCheck, health: ServiceHealth) {
  if (check.key === 'web')
    return `Chạy liên tục ${formatUptime(health.webUptimeSeconds)}`
  if (check.state !== 'up') return 'Không trả lời yêu cầu kiểm tra'
  return check.key === 'database'
    ? `Truy vấn kiểm tra mất ${check.latencyMs} ms`
    : `Phản hồi sau ${check.latencyMs} ms`
}

function overallStatus(services: ServiceCheck[]) {
  const down = services.filter((service) => service.state === 'down').length
  if (down)
    return { ...STATE_VIEW.down, label: `${down} dịch vụ ngừng hoạt động` }
  if (services.some((service) => service.state === 'unknown'))
    return { ...STATE_VIEW.unknown, label: 'Chưa xác định được mọi dịch vụ' }
  return { ...STATE_VIEW.up, label: 'Tất cả dịch vụ hoạt động' }
}

export function ServiceHealthPanel({
  health,
  failed,
}: {
  health: ServiceHealth | undefined
  failed: boolean
}) {
  const overall = health ? overallStatus(health.services) : null
  const incidents =
    health?.services.filter((service) => service.state === 'down') ?? []
  return (
    <Panel
      titleId="service-health-title"
      level={2}
      title="Tình trạng dịch vụ"
      description="Trạng thái hiện tại, không phụ thuộc bộ lọc thời gian bên dưới."
      action={
        overall ? (
          failed ? (
            <StatusPill tone="warning" icon={TriangleAlert}>
              Dữ liệu cũ, chưa xác nhận
            </StatusPill>
          ) : (
            <StatusPill tone={overall.tone} icon={overall.icon}>
              {overall.label}
            </StatusPill>
          )
        ) : null
      }
    >
      {!health ? (
        failed ? (
          <PanelMessage kind="alert">
            Không kiểm tra được tình trạng dịch vụ. Vui lòng thử làm mới.
          </PanelMessage>
        ) : (
          <PanelMessage>Đang kiểm tra dịch vụ…</PanelMessage>
        )
      ) : (
        <>
          {failed ? (
            <PanelMessage kind="alert" tone="warning">
              Không làm mới được tình trạng dịch vụ. Trạng thái từng dịch vụ và
              số phiên gọi bên dưới là dữ liệu cũ, chưa xác nhận tình trạng hiện
              tại. Vui lòng thử làm mới.
            </PanelMessage>
          ) : null}
          {incidents.map((service) =>
            service.key === 'web' ? null : (
              <p
                key={service.key}
                role="alert"
                className="flex items-start gap-2.5 rounded-[10px] bg-destructive-subtle p-4 text-[13px] leading-[1.6] text-destructive"
              >
                <TriangleAlert
                  size={15}
                  className="mt-0.5 shrink-0"
                  aria-hidden="true"
                />
                <span>
                  {SERVICE_LABELS[service.key].name} không phản hồi.{' '}
                  {SERVICE_IMPACT[service.key]}
                </span>
              </p>
            ),
          )}
          <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:gap-x-6 xl:grid-cols-3">
            {health.services.map((service) => {
              const view = STATE_VIEW[service.state]
              return (
                <li key={service.key} className="flex min-w-0 flex-col gap-2">
                  <span className="text-[13px] font-semibold sm:text-sm">
                    {SERVICE_LABELS[service.key].name}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {SERVICE_LABELS[service.key].technology}
                  </p>
                  <div className="w-fit">
                    <StatusPill tone={view.tone} icon={view.icon}>
                      {view.label}
                    </StatusPill>
                  </div>
                  <p className="text-xs leading-[1.6] text-muted-foreground">
                    {serviceDetail(service, health)}
                  </p>
                </li>
              )
            })}
          </ul>
          <VoiceCapacity sessions={health.voiceSessions} />
        </>
      )}
    </Panel>
  )
}

function VoiceCapacity({
  sessions,
}: {
  sessions: ServiceHealth['voiceSessions']
}) {
  const ratio = sessions ? sessions.active / sessions.capacity : 0
  const level = !sessions
    ? 'off'
    : ratio >= 1
      ? 'full'
      : ratio >= 0.67
        ? 'busy'
        : 'free'
  const colors = {
    off: { track: 'bg-border', fill: 'bg-transparent' },
    free: { track: 'bg-border', fill: 'bg-brand' },
    busy: { track: 'bg-border', fill: 'bg-[#795a1c] dark:bg-warning' },
    full: { track: 'bg-border', fill: 'bg-destructive' },
  }[level]
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-muted px-4 py-4 sm:flex-row sm:items-center sm:gap-8 sm:px-5">
      <div className="flex items-center justify-between gap-4 sm:min-w-[248px] sm:flex-col sm:items-start sm:gap-1">
        <p className="text-xs text-muted-foreground">Phiên gọi đang chạy</p>
        <p className="text-sm text-foreground">
          <b className="text-xl font-medium tracking-[-0.02em] sm:text-base">
            {sessions ? formatCount(sessions.active) : '–'}
          </b>
          {sessions ? ` / ${formatCount(sessions.capacity)}` : null}
          {sessions ? (
            <span className="hidden sm:inline"> phiên cùng lúc</span>
          ) : null}
        </p>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div
          role="meter"
          aria-label="Phiên gọi đang chạy"
          aria-valuemin={0}
          aria-valuemax={sessions?.capacity ?? 0}
          aria-valuenow={sessions?.active ?? 0}
          className={`h-1.5 w-full overflow-hidden rounded-full ${colors.track}`}
        >
          <div
            className={`h-full rounded-full ${colors.fill}`}
            style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
          />
        </div>
        <p
          className={`text-xs leading-[1.6] ${level === 'full' ? 'text-destructive' : level === 'busy' ? 'text-[#795a1c] dark:text-warning' : 'text-brand'}`}
        >
          {!sessions
            ? 'Không lấy được số liệu từ dịch vụ giọng nói'
            : level === 'full'
              ? 'Đã đầy, người học mới sẽ được báo hết chỗ'
              : `Còn ${formatCount(sessions.capacity - sessions.active)} chỗ trống`}
        </p>
      </div>
    </div>
  )
}
