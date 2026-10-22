import { useEffect, useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  AuthHeading,
  AuthLayout,
  AuthNotice,
} from '@/components/auth/auth-layout'
import { Button } from '#/components/ui/button'
import { authClient } from '#/lib/auth/client'
import {
  getWorkspaceRole,
  workspaceRoleLabels,
} from '#/lib/auth/workspace-roles'

export const Route = createFileRoute('/accept-invitation/$id')({
  beforeLoad: ({ context, params }) => {
    const callbackUrl = `/accept-invitation/${params.id}`
    if (!context.user) throw redirect({ to: '/login', search: { callbackUrl } })
    if (!context.user.emailVerified)
      throw redirect({
        to: '/verify-email',
        search: { email: context.user.email, callbackUrl },
      })
  },
  head: () => ({
    meta: [{ title: 'Lời mời không gian làm việc | SalesCoach AI' }],
  }),
  component: AcceptInvitationPage,
})

type InvitationDetails = {
  organizationId: string
  organizationName: string
  inviterEmail: string
  role: string
  status: string
}

function AcceptInvitationPage() {
  const { id } = Route.useParams()
  const { user } = Route.useRouteContext()
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let stopped = false
    authClient.organization
      .getInvitation({ query: { id } })
      .then((result) => {
        if (stopped) return
        if (result.error) {
          setError(
            'Không tìm thấy lời mời này, hoặc lời mời không dành cho tài khoản đang đăng nhập.',
          )
        } else {
          setInvitation(result.data)
        }
      })
      .catch(() => {
        if (!stopped) setError('Chưa thể tải lời mời. Vui lòng thử lại sau.')
      })
      .finally(() => {
        if (!stopped) setLoading(false)
      })
    return () => {
      stopped = true
    }
  }, [id])

  async function accept() {
    if (!invitation || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await authClient.organization.acceptInvitation({
        invitationId: id,
      })
      if (result.error) {
        setError(result.error.message || 'Chưa thể chấp nhận lời mời.')
        setBusy(false)
        return
      }
      await authClient.organization.setActive({
        organizationId: invitation.organizationId,
      })
      window.location.assign('/practice')
    } catch {
      setError('Chưa thể chấp nhận lời mời. Vui lòng thử lại.')
      setBusy(false)
    }
  }

  async function decline() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await authClient.organization.rejectInvitation({
        invitationId: id,
      })
      if (result.error) {
        setError(result.error.message || 'Chưa thể từ chối lời mời.')
        setBusy(false)
        return
      }
      window.location.assign('/practice')
    } catch {
      setError('Chưa thể từ chối lời mời. Vui lòng thử lại.')
      setBusy(false)
    }
  }

  const pending = invitation?.status === 'pending'

  return (
    <AuthLayout>
      <AuthHeading
        eyebrow="LỜI MỜI KHÔNG GIAN LÀM VIỆC"
        title={
          invitation
            ? `Tham gia ${invitation.organizationName}`
            : 'Lời mời tham gia không gian làm việc'
        }
        description={
          invitation
            ? `${invitation.inviterEmail} mời bạn tham gia với vai trò ${workspaceRoleLabels[getWorkspaceRole(invitation.role)]}.`
            : 'Đang kiểm tra lời mời của bạn.'
        }
      />
      <div className="grid gap-5">
        {error ? <AuthNotice>{error}</AuthNotice> : null}
        {invitation && !pending ? (
          <AuthNotice kind="info">
            Lời mời này không còn hiệu lực. Hãy nhờ chủ sở hữu gửi lại.
          </AuthNotice>
        ) : null}
        {invitation && pending ? (
          <>
            <p className="text-sm leading-[1.55] text-muted-foreground">
              Bạn đang đăng nhập bằng {user?.email}. Khi chấp nhận, bạn sẽ dùng
              một suất luyện tập của không gian làm việc.
            </p>
            <Button
              className="h-[52px] w-full rounded-[10px] text-sm font-medium"
              disabled={busy}
              onClick={() => void accept()}
            >
              {busy ? 'Đang xử lý…' : 'Chấp nhận lời mời'}
            </Button>
            <Button
              variant="outline"
              className="h-[52px] w-full rounded-[10px] text-sm font-normal shadow-none"
              disabled={busy}
              onClick={() => void decline()}
            >
              Từ chối
            </Button>
          </>
        ) : null}
        {!loading && !invitation ? (
          <a
            href="/practice"
            className="text-center text-sm text-brand hover:underline"
          >
            Về trang luyện tập
          </a>
        ) : null}
      </div>
    </AuthLayout>
  )
}
