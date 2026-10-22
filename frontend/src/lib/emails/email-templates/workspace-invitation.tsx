import { renderToStaticMarkup } from 'react-dom/server'

export function createWorkspaceInvitationEmail({
  url,
  workspaceName,
  inviterName,
}: {
  url: string
  workspaceName: string
  inviterName: string
}) {
  const subject = `${inviterName} mời bạn tham gia ${workspaceName} trên SalesCoach AI`
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
      <h1 style={{ fontSize: 24 }}>Lời mời tham gia không gian làm việc</h1>
      <p>
        {inviterName} đã mời bạn tham gia không gian làm việc{' '}
        <b>{workspaceName}</b> trên SalesCoach AI. Hãy đăng nhập bằng đúng địa
        chỉ email nhận thư này để chấp nhận lời mời.
      </p>
      <p style={{ margin: '28px 0' }}>
        <a
          href={url}
          style={{
            background: '#008c87',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 8,
            textDecoration: 'none',
          }}
        >
          Xem lời mời
        </a>
      </p>
      <p style={{ color: '#718185', fontSize: 13 }}>
        Lời mời có hiệu lực trong 7 ngày. Nếu bạn không mong đợi email này, hãy
        bỏ qua.
      </p>
    </div>,
  )

  return { subject, body }
}
