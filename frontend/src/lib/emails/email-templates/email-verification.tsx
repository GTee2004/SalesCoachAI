import type { EmailOTPOptions } from 'better-auth/plugins'
import { renderToStaticMarkup } from 'react-dom/server'

type VerificationOTP = Pick<
  Parameters<EmailOTPOptions['sendVerificationOTP']>[0],
  'otp' | 'type'
>

const copy = {
  'email-verification': {
    subject: 'Xác minh email SalesCoach AI',
    heading: 'Xác minh địa chỉ email',
  },
  'forget-password': {
    subject: 'Mã đặt lại mật khẩu SalesCoach AI',
    heading: 'Mã xác minh của bạn',
  },
  'sign-in': {
    subject: 'Mã xác minh SalesCoach AI',
    heading: 'Mã xác minh của bạn',
  },
  'change-email': {
    subject: 'Mã xác minh SalesCoach AI',
    heading: 'Mã xác minh của bạn',
  },
} satisfies Record<
  VerificationOTP['type'],
  { subject: string; heading: string }
>

export function createEmailVerificationEmail({ otp, type }: VerificationOTP) {
  const { subject, heading } = copy[type]
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
      <h1 style={{ fontSize: 24 }}>{heading}</h1>
      <p>Nhập mã sau trong SalesCoach AI để tiếp tục.</p>
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
        Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email.
      </p>
    </div>,
  )

  return { subject, body }
}
