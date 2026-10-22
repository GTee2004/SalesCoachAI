import { renderToStaticMarkup } from 'react-dom/server'

export function createUsernameChangeEmail({
  otp,
  username,
}: {
  otp: string
  username: string
}) {
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
      <h1 style={{ fontSize: 24 }}>Xác nhận đổi bí danh</h1>
      <p>
        Bạn vừa yêu cầu đổi bí danh thành <strong>{username}</strong>. Nhập mã
        sau trong SalesCoach AI để xác nhận.
      </p>
      <p
        style={{
          fontSize: 32,
          letterSpacing: 10,
          fontWeight: 700,
          color: '#12383c',
        }}
      >
        {otp}
      </p>
      <p>Mã có hiệu lực trong 10 phút.</p>
      <p style={{ color: '#718185', fontSize: 13 }}>
        Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email; bí danh của bạn sẽ
        không thay đổi.
      </p>
    </div>,
  )

  return { subject: 'Mã xác nhận đổi bí danh SalesCoach AI', body }
}
