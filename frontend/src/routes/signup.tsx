import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowRight, LockKeyhole, Mail, UserRound } from 'lucide-react'
import {
  AuthField,
  AuthFooter,
  AuthHeading,
  AuthLayout,
  AuthNotice,
  AuthSubmit,
} from '@/components/auth/auth-layout'
import { z } from 'zod'
import { authClient } from '@/lib/auth/client'
import { safeAuthReturnTo } from '@/lib/auth/redirect'
import { getCurrentUser } from '@/lib/auth/current-user'

const signupSearchSchema = z.object({
  callbackUrl: z.string().optional(),
})

export const Route = createFileRoute('/signup')({
  validateSearch: signupSearchSchema,
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
  component: SignupPage,
})

function SignupPage() {
  const { callbackUrl } = Route.useSearch()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!acceptedTerms) {
      setError('Vui lòng đồng ý với điều khoản sử dụng và chính sách bảo mật.')
      return
    }
    const trimmedUsername = username.trim()
    if (trimmedUsername.length < 3 || trimmedUsername.length > 30) {
      setError('Tên người dùng cần có từ 3 đến 30 ký tự.')
      return
    }
    if (!/^[a-zA-Z0-9_.]+$/.test(trimmedUsername)) {
      setError(
        'Tên người dùng chỉ được chứa chữ cái, số, dấu gạch dưới và dấu chấm.',
      )
      return
    }
    if (password.length < 8) {
      setError('Mật khẩu cần có ít nhất 8 ký tự.')
      return
    }

    setIsSubmitting(true)
    try {
      const normalizedEmail = email.trim().toLowerCase()
      const result = await authClient.signUp.email({
        name: trimmedUsername,
        username: trimmedUsername,
        email: normalizedEmail,
        password,
        callbackURL: safeAuthReturnTo(callbackUrl),
      })
      if (result.error) {
        setError(
          result.error.code === 'USERNAME_IS_ALREADY_TAKEN'
            ? 'Tên người dùng này đã được sử dụng. Vui lòng chọn tên khác.'
            : result.error.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'
              ? 'Email này đã được đăng ký. Hãy đăng nhập hoặc dùng email khác.'
              : 'Không thể tạo tài khoản. Vui lòng kiểm tra thông tin và thử lại.',
        )
        return
      }
      // The account exists either way; the verify page explains a failed send.
      const sendFailed =
        (result.data as { verificationEmailSent?: boolean } | null)
          ?.verificationEmailSent === false
      window.location.assign(
        '/verify-email?email=' +
          encodeURIComponent(normalizedEmail) +
          (sendFailed ? '&sendFailed=true' : '') +
          (callbackUrl
            ? '&callbackUrl=' + encodeURIComponent(callbackUrl)
            : ''),
      )
    } catch {
      setError('Đã xảy ra lỗi. Vui lòng thử lại sau.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout variant="signup">
      <AuthHeading
        eyebrow="BẮT ĐẦU MIỄN PHÍ"
        title="Tạo tài khoản"
        description="Tạo tài khoản để bắt đầu luyện tập cùng SalesCoach AI."
      />
      <form onSubmit={handleSubmit} className="grid gap-7">
        {error ? <AuthNotice>{error}</AuthNotice> : null}
        <div className="grid gap-5">
          <AuthField
            id="username"
            label="Tên người dùng"
            placeholder="Nhập tên người dùng của bạn"
            icon={<UserRound size={17} />}
            autoComplete="username"
            value={username}
            onChange={setUsername}
            maxLength={30}
            hint="3–30 ký tự: chữ cái, số, dấu gạch dưới và dấu chấm."
          />
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
            placeholder="Tạo mật khẩu (ít nhất 8 ký tự)"
            icon={<LockKeyhole size={17} />}
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
          />
        </div>

        <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-[1.55] text-muted-foreground">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
            className="mt-0.5 size-[18px] shrink-0 accent-primary"
          />
          <span>Tôi đồng ý với Điều khoản sử dụng và Chính sách bảo mật.</span>
        </label>

        <AuthSubmit disabled={isSubmitting || !acceptedTerms}>
          {isSubmitting ? 'Đang tạo tài khoản…' : 'Tạo tài khoản'}
          {!isSubmitting ? <ArrowRight size={18} /> : null}
        </AuthSubmit>

        <AuthFooter
          prompt="Đã có tài khoản?"
          linkText="Đăng nhập"
          to="/login"
          callbackUrl={callbackUrl}
        />
      </form>
    </AuthLayout>
  )
}
