import { useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { LockKeyhole, Mail } from 'lucide-react'
import { z } from 'zod'
import {
  AuthField,
  AuthFooter,
  AuthHeading,
  AuthLayout,
  AuthNotice,
  AuthSubmit,
} from '@/components/auth/auth-layout'
import { authClient } from '@/lib/auth/client'
import { safeAuthReturnTo } from '@/lib/auth/redirect'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getDemoLogin } from '@/lib/auth/demo-login'
import { VERIFICATION_EMAIL_FAILED } from '@/lib/auth/verification-email'

const loginSearchSchema = z.object({
  callbackUrl: z.string().optional(),
  passwordReset: z.string().optional(),
})

export const Route = createFileRoute('/login')({
  validateSearch: loginSearchSchema,
  beforeLoad: async ({ search }) => {
    const user = await getCurrentUser()
    if (!user) return
    if (!user.emailVerified) {
      throw redirect({
        to: '/verify-email',
        search: { email: user.email, callbackUrl: search.callbackUrl },
      })
    }
    throw redirect({ href: safeAuthReturnTo(search.callbackUrl) })
  },
  loader: () => getDemoLogin(),
  component: LoginPage,
})

function LoginPage() {
  const { callbackUrl, passwordReset } = Route.useSearch()
  const demoLogin = Route.useLoaderData()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState('')
  const [needsVerification, setNeedsVerification] = useState(false)
  const [verificationSendFailed, setVerificationSendFailed] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNeedsVerification(false)
    setVerificationSendFailed(false)
    setIsSubmitting(true)
    const normalizedEmail = email.trim().toLowerCase()

    try {
      const result = await authClient.signIn.email({
        email: normalizedEmail,
        password,
        rememberMe,
      })
      if (result.error) {
        if (result.error.code === 'EMAIL_NOT_VERIFIED') {
          setNeedsVerification(true)
          setError(
            'Email của bạn chưa được xác minh. Chúng tôi đã gửi mã xác minh mới.',
          )
        } else if (result.error.code === VERIFICATION_EMAIL_FAILED) {
          setNeedsVerification(true)
          setVerificationSendFailed(true)
          setError(
            'Email của bạn chưa được xác minh và chúng tôi chưa gửi được mã xác minh mới.',
          )
        } else {
          setError('Email hoặc mật khẩu không chính xác. Vui lòng thử lại.')
        }
        return
      }
      window.location.assign(safeAuthReturnTo(callbackUrl))
    } catch {
      setError('Đã xảy ra lỗi. Vui lòng thử lại sau.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout variant="login">
      <AuthHeading
        eyebrow="RẤT VUI KHI GẶP LẠI BẠN"
        title="Đăng nhập"
        description="Chào mừng trở lại! Đăng nhập để tiếp tục luyện tập."
      />
      <form onSubmit={handleSubmit} className="grid gap-7">
        {passwordReset === 'success' ? (
          <AuthNotice kind="success">
            Mật khẩu đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới.
          </AuthNotice>
        ) : null}
        {demoLogin ? (
          <AuthNotice kind="info">
            Tài khoản demo: <strong>{demoLogin.email}</strong> / mật khẩu{' '}
            <strong>{demoLogin.password}</strong>{' '}
            <button
              type="button"
              onClick={() => {
                setEmail(demoLogin.email)
                setPassword(demoLogin.password)
              }}
              className="font-semibold underline underline-offset-2"
            >
              Điền sẵn
            </button>
          </AuthNotice>
        ) : null}
        {error ? (
          <AuthNotice>
            {error}{' '}
            {needsVerification ? (
              <button
                type="button"
                onClick={() =>
                  window.location.assign(
                    '/verify-email?email=' +
                      encodeURIComponent(email.trim().toLowerCase()) +
                      (verificationSendFailed ? '&sendFailed=true' : '') +
                      (callbackUrl
                        ? '&callbackUrl=' + encodeURIComponent(callbackUrl)
                        : ''),
                  )
                }
                className="font-semibold underline underline-offset-2"
              >
                Nhập mã xác minh
              </button>
            ) : null}
          </AuthNotice>
        ) : null}
        <div className="grid gap-5">
          <AuthField
            id="email"
            label="Email"
            type="email"
            placeholder="tenban@email.com"
            icon={<Mail size={17} />}
            autoComplete="email"
            value={email}
            onChange={setEmail}
          />
          <AuthField
            id="password"
            label="Mật khẩu"
            type="password"
            placeholder="Nhập mật khẩu của bạn"
            icon={<LockKeyhole size={17} />}
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
          />
        </div>

        <div className="flex min-h-7 flex-wrap items-center justify-between gap-3 text-[13px]">
          <label className="flex cursor-pointer items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
              className="size-[18px] accent-primary"
            />
            Ghi nhớ đăng nhập
          </label>
          <Link
            to="/forgot-password"
            className="font-semibold text-brand underline-offset-2 hover:underline"
          >
            Quên mật khẩu?
          </Link>
        </div>

        <AuthSubmit disabled={isSubmitting}>
          {isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </AuthSubmit>

        <AuthFooter
          prompt="Chưa có tài khoản?"
          linkText="Tạo tài khoản"
          to="/signup"
          callbackUrl={callbackUrl}
        />
      </form>
    </AuthLayout>
  )
}
