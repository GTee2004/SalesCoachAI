import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { LockKeyhole } from 'lucide-react'
import { z } from 'zod'
import {
  AuthField,
  AuthHeading,
  AuthLayout,
  AuthNotice,
  AuthSubmit,
} from '@/components/auth/auth-layout'
import { authClient } from '@/lib/auth/client'

const resetSearchSchema = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
})

export const Route = createFileRoute('/reset-password')({
  validateSearch: resetSearchSchema,
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token, error: resetError } = Route.useSearch()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!token) {
      setError('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.')
      return
    }
    if (password.length < 8) {
      setError('Mật khẩu cần có ít nhất 8 ký tự.')
      return
    }
    if (password !== confirmPassword) {
      setError('Hai mật khẩu chưa khớp.')
      return
    }

    setIsSubmitting(true)
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      })
      if (result.error) {
        setError('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.')
        return
      }
      window.location.assign('/login?passwordReset=success')
    } catch {
      setError('Chưa thể đặt lại mật khẩu. Vui lòng yêu cầu liên kết mới.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <AuthHeading
        eyebrow="KHÔI PHỤC TÀI KHOẢN"
        title="Tạo mật khẩu mới"
        description="Chọn mật khẩu mới có ít nhất 8 ký tự."
      />
      <form onSubmit={handleSubmit} className="grid gap-7">
        {resetError || error ? (
          <AuthNotice>
            {error || 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.'}
          </AuthNotice>
        ) : null}
        <div className="grid gap-5">
          <AuthField
            id="password"
            label="Mật khẩu mới"
            type="password"
            placeholder="Ít nhất 8 ký tự"
            icon={<LockKeyhole size={17} />}
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
          />
          <AuthField
            id="confirm-password"
            label="Xác nhận mật khẩu"
            type="password"
            placeholder="Nhập lại mật khẩu mới"
            icon={<LockKeyhole size={17} />}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
          />
        </div>
        {token ? (
          <AuthSubmit disabled={isSubmitting}>
            {isSubmitting ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}
          </AuthSubmit>
        ) : null}
        <p className="text-center text-sm leading-[1.55] text-muted-foreground">
          <Link
            to="/forgot-password"
            className="font-semibold text-brand hover:underline"
          >
            Yêu cầu liên kết mới
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
