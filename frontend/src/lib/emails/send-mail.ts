import { createTransport } from 'nodemailer'
import { env } from '@/env'

const DEFAULT_SMTP_HOST = 'eagle.mxlogin.com'
const DEFAULT_SMTP_PORT = 465
const smtpPort = env.SMTP_PORT ?? DEFAULT_SMTP_PORT
const secure = smtpPort === 465
const transporter = createTransport({
  host: env.SMTP_HOST ?? DEFAULT_SMTP_HOST,
  port: smtpPort,
  secure,
  requireTLS: !secure,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASSWORD,
  },
})

export type MessageInfo = {
  to: string
  subject: string
  body: string
}

export const sendMail = async (message: MessageInfo) => {
  const { to, subject, body } = message
  const mailOptions = {
    from: { name: 'SalesCoach AI', address: env.SMTP_USER },
    to,
    subject,
    html: body,
  }
  return transporter.sendMail(mailOptions)
}
