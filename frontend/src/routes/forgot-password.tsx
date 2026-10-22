import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Mail } from 'lucide-react'
import {
  AuthField,
  AuthHeading,
  AuthLayout,
  AuthNotice,
  AuthSubmit,
} from '@/components/auth/auth-layout'
import { authClient } from '@/lib/auth/client'

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const result = await authClient.requestPasswordReset({
        email: email.trim().toLowerCase(),
        redirectTo: window.location.origin + '/reset-password',
      })
      if (result.error) {
        setError('Chưa thể gửi email đặt lại mật khẩu. Vui lòng thử lại sau.')
      } else {
        setSent(true)
      }
    } catch {
      setError('Chưa thể gửi email đặt lại mật khẩu. Vui lòng thử lại sau.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <AuthHeading
        eyebrow="KHÔI PHỤC TÀI KHOẢN"
        title="Đặt lại mật khẩu"
        description="Nhập email đã đăng ký. Nếu tài khoản tồn tại, chúng tôi sẽ gửi liên kết đặt lại mật khẩu."
      />
      <form onSubmit={handleSubmit} className="grid gap-7">
        {error ? <AuthNotice>{error}</AuthNotice> : null}
        {sent ? (
          <AuthNotice kind="success">
            Nếu email này đã đăng ký, liên kết đặt lại mật khẩu sẽ được gửi đến
            hộp thư của bạn.
          </AuthNotice>
        ) : null}
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
        {!sent ? (
          <AuthSubmit disabled={isSubmitting}>
            {isSubmitting ? 'Đang gửi…' : 'Gửi liên kết đặt lại'}
          </AuthSubmit>
        ) : null}
        <p className="text-center text-sm leading-[1.55] text-muted-foreground">
          Nhớ lại mật khẩu?{' '}
          <Link
            to="/login"
            className="font-semibold text-brand hover:underline"
          >
            Đăng nhập
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
