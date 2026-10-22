import { renderToStaticMarkup } from 'react-dom/server'

export function createResetPasswordEmail({ url }: { url: string }) {
  const subject = 'Đặt lại mật khẩu SalesCoach AI'
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
      <h1 style={{ fontSize: 24 }}>Đặt lại mật khẩu</h1>
      <p>
        Sử dụng liên kết bên dưới để đặt mật khẩu mới cho tài khoản của bạn.
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
          Đặt lại mật khẩu
        </a>
      </p>
      <p style={{ color: '#718185', fontSize: 13 }}>
        Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email.
      </p>
    </div>,
  )

  return { subject, body }
}
