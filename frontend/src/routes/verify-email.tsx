import { useEffect, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { Mail, ShieldCheck } from 'lucide-react'
import { z } from 'zod'
import {
  AuthField,
  AuthHeading,
  AuthLayout,
  AuthNotice,
  AuthSubmit,
} from '@/components/auth/auth-layout'
import { authClient } from '@/lib/auth/client'
import { safeAuthReturnTo } from '@/lib/auth/redirect'
import { getCurrentUser } from '@/lib/auth/current-user'
import { VERIFICATION_EMAIL_FAILED } from '@/lib/auth/verification-email'

const verifySearchSchema = z.object({
  email: z.string().email().optional(),
  callbackUrl: z.string().optional(),
  sendFailed: z.boolean().optional(),
})

const SEND_FAILED_MESSAGE =
  'Chưa gửi được mã xác minh đến email của bạn. Hãy bấm “Gửi lại mã xác minh” để thử lại.'
const RESEND_RATE_LIMITED_MESSAGE =
  'Bạn đã yêu cầu gửi mã quá nhiều lần. Hãy đợi hết thời gian chờ rồi thử lại.'
// Matches the email OTP rate-limit window in the auth server config.
const DEFAULT_RETRY_AFTER_SECONDS = 60

function retryAfterSeconds(response: Response) {
  const seconds = Number(response.headers.get('X-Retry-After'))
  return Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : DEFAULT_RETRY_AFTER_SECONDS
}

export const Route = createFileRoute('/verify-email')({
  validateSearch: verifySearchSchema,
  beforeLoad: async ({ search }) => {
    const user = await getCurrentUser()
    if (user?.emailVerified) {
      throw redirect({ href: safeAuthReturnTo(search.callbackUrl) })
    }
    return {
      initialEmail: search.email ?? user?.email ?? '',
      hasSession: Boolean(user),
    }
  },
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { initialEmail, hasSession } = Route.useRouteContext()
  const { callbackUrl, sendFailed } = Route.useSearch()
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [error, setError] = useState(sendFailed ? SEND_FAILED_MESSAGE : '')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(
    null,
  )
  const [now, setNow] = useState(() => Date.now())
  const resendWaitSeconds =
    resendAvailableAt === null
      ? 0
      : Math.max(0, Math.ceil((resendAvailableAt - now) / 1000))

  useEffect(() => {
    if (resendAvailableAt === null) return
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current < resendAvailableAt) return
      setResendAvailableAt(null)
      setError((shown) => (shown === RESEND_RATE_LIMITED_MESSAGE ? '' : shown))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [resendAvailableAt])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setIsSubmitting(true)
    const normalizedEmail = email.trim().toLowerCase()

    try {
      let waitSeconds = DEFAULT_RETRY_AFTER_SECONDS
      const result = await authClient.emailOtp.verifyEmail(
        { email: normalizedEmail, otp: code.trim() },
        {
          onError: ({ response }) => {
            if (response.status === 429)
              waitSeconds = retryAfterSeconds(response)
          },
        },
      )
      if (result.error) {
        setError(
          result.error.status === 429
            ? `Bạn đã thử xác minh quá nhiều lần. Vui lòng đợi ${waitSeconds} giây rồi thử lại.`
            : result.error.code === 'TOO_MANY_ATTEMPTS'
              ? 'Bạn đã nhập sai quá nhiều lần. Hãy yêu cầu mã mới.'
              : 'Mã không hợp lệ hoặc đã hết hạn. Hãy kiểm tra email hoặc yêu cầu mã mới.',
        )
        return
      }
      window.location.assign(safeAuthReturnTo(callbackUrl))
    } catch {
      setError('Đã xảy ra lỗi khi xác minh. Vui lòng thử lại.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleResend() {
    setError('')
    setMessage('')
    setIsResending(true)
    try {
      let waitSeconds = DEFAULT_RETRY_AFTER_SECONDS
      const result = await authClient.emailOtp.sendVerificationOtp(
        { email: email.trim().toLowerCase(), type: 'email-verification' },
        {
          onError: ({ response }) => {
            if (response.status === 429)
              waitSeconds = retryAfterSeconds(response)
          },
        },
      )
      if (result.error) {
        if (result.error.status === 429) {
          const current = Date.now()
          setNow(current)
          setResendAvailableAt(current + waitSeconds * 1000)
          setError(RESEND_RATE_LIMITED_MESSAGE)
        } else if (result.error.code === VERIFICATION_EMAIL_FAILED) {
          setError(
            'Không gửi được email xác minh. Vui lòng thử lại sau ít phút hoặc liên hệ hỗ trợ.',
          )
        } else if (result.error.status === 400) {
          setError('Địa chỉ email không hợp lệ. Hãy kiểm tra lại.')
        } else {
          setError('Chưa thể gửi mã mới. Vui lòng thử lại sau.')
        }
      } else {
        setMessage(
          'Nếu email này đã đăng ký, mã xác minh mới sẽ được gửi đến hộp thư.',
        )
      }
    } catch {
      setError('Chưa thể gửi mã mới. Vui lòng thử lại sau.')
    } finally {
      setIsResending(false)
    }
  }

  async function handleSignOut() {
    setError('')
    setIsSigningOut(true)
    try {
      const result = await authClient.signOut()
      if (result.error) {
        setError('Chưa thể đăng xuất. Vui lòng thử lại.')
        return
      }
      window.location.assign('/login')
    } catch {
      setError('Chưa thể đăng xuất. Vui lòng thử lại.')
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <AuthLayout>
      <AuthHeading
        eyebrow="XÁC MINH TÀI KHOẢN"
        title="Kiểm tra email của bạn"
        description="Nhập mã 6 chữ số chúng tôi đã gửi để xác minh địa chỉ email."
        compactTitle
      />
      <form onSubmit={handleSubmit} className="grid gap-7">
        {error ? <AuthNotice>{error}</AuthNotice> : null}
        {message ? <AuthNotice kind="success">{message}</AuthNotice> : null}
        <div className="grid gap-5">
          <AuthField
            id="email"
            label="Email nhận mã"
            type="email"
            placeholder="tenban@email.com"
            icon={<Mail size={17} />}
            autoComplete="email"
            value={email}
            onChange={setEmail}
          />
          <AuthField
            id="code"
            label="Mã xác minh"
            placeholder="123456"
            icon={<ShieldCheck size={17} />}
            autoComplete="one-time-code"
            value={code}
            onChange={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
            maxLength={6}
            inputMode="numeric"
          />
          <p className="text-[13px] leading-[1.6] text-muted-foreground">
            Mã có hiệu lực trong 10 phút. Kiểm tra cả thư mục spam nếu bạn chưa
            thấy email.
          </p>
        </div>
        <AuthSubmit
          disabled={isSubmitting || code.length !== 6 || !email.trim()}
        >
          {isSubmitting ? 'Đang xác minh…' : 'Xác minh email'}
        </AuthSubmit>
        <button
          type="button"
          disabled={isResending || resendWaitSeconds > 0 || !email.trim()}
          onClick={() => void handleResend()}
          className="h-12 w-full rounded-lg border border-border bg-background text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isResending
            ? 'Đang gửi mã…'
            : resendWaitSeconds > 0
              ? `Gửi lại mã sau ${resendWaitSeconds} giây`
              : 'Gửi lại mã xác minh'}
        </button>
        <p className="text-center text-sm leading-[1.55] text-muted-foreground">
          Dùng email khác?{' '}
          {hasSession ? (
            <button
              type="button"
              disabled={isSigningOut}
              onClick={() => void handleSignOut()}
              className="font-semibold text-brand underline-offset-2 hover:underline disabled:opacity-50"
            >
              {isSigningOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
            </button>
          ) : (
            <Link
              to="/signup"
              className="font-semibold text-brand underline-offset-2 hover:underline"
            >
              Tạo tài khoản mới
            </Link>
          )}
        </p>
      </form>
    </AuthLayout>
  )
}
