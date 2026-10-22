import { renderToStaticMarkup } from 'react-dom/server'
import { SERVICE_IMPACT, SERVICE_LABELS } from '#/lib/admin/labels'
import type { AlertNotice } from '#/lib/admin/service-alerts'
import { APP_TIME_ZONE } from '#/lib/admin/usage'

export function createServiceAlertEmail({
  notice,
  checkedAt,
  dashboardUrl,
}: {
  notice: AlertNotice
  checkedAt: Date
  dashboardUrl: string
}) {
  const { name } = SERVICE_LABELS[notice.service]
  const down = notice.kind === 'down'
  const subject = down
    ? `[SalesCoach AI] ${name} ngừng hoạt động`
    : `[SalesCoach AI] ${name} đã hoạt động trở lại`
  // A recovery email may go out several checks after the service came back.
  const time = new Intl.DateTimeFormat('vi-VN', {
    timeZone: APP_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(down ? checkedAt : new Date(notice.since))
  const body = renderToStaticMarkup(
    <div
      style={{
        fontFamily: 'Arial,sans-serif',
        color: '#12383c',
        lineHeight: 1.6,
        maxWidth: 560,
        margin: 'auto',
      }}
    >
      <h1 style={{ fontSize: 24 }}>
        {down ? `${name} ngừng hoạt động` : `${name} đã hoạt động trở lại`}
      </h1>
      <p>
        {down
          ? `Hệ thống không kết nối được tới ${name} trong nhiều lần kiểm tra liên tiếp. Lần kiểm tra gần nhất: ${time}.`
          : `${name} đã phản hồi bình thường từ ${time}.`}
      </p>
      {down ? <p>{SERVICE_IMPACT[notice.service]}</p> : null}
      <p style={{ margin: '28px 0' }}>
        <a
          href={dashboardUrl}
          style={{
            background: '#008c87',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 8,
            textDecoration: 'none',
          }}
        >
          Mở trang quản trị
        </a>
      </p>
      <p style={{ color: '#718185', fontSize: 13 }}>
        Bạn nhận email này vì tài khoản của bạn có quyền quản trị SalesCoach AI.
      </p>
    </div>,
  )

  return { subject, body }
}
