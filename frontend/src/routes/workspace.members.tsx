import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, Plus } from 'lucide-react'
import { ConfirmModal } from '#/components/confirm-modal'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { NativeSelect } from '#/components/ui/native-select'
import { ButtonLink } from '#/components/ui/button-link'
import { Input } from '#/components/ui/input'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '#/components/ui/responsive-modal'
import { authClient } from '#/lib/auth/client'
import {
  canInviteWorkspaceRole,
  canManageWorkspaceMember,
  canManageWorkspaceMembers,
  getWorkspaceRole,
  workspaceRoleLabels,
} from '#/lib/auth/workspace-roles'
import { readBillingResponse } from '#/lib/billing/http'
import { workspaceMembersQueryOptions } from '#/lib/workspace/queries'
import type { WorkspaceMembers } from '#/lib/workspace/queries'

export const Route = createFileRoute('/workspace/members')({
  beforeLoad: ({ context }) => {
    // Plain members only see the General tab.
    if (!canManageWorkspaceMembers(context.user?.workspace?.role))
      throw redirect({ to: '/workspace' })
  },
  component: WorkspaceMembersPage,
})

const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'medium',
  timeZone: 'Asia/Ho_Chi_Minh',
})

type MutationResult = { error?: { message?: string } | null }
type Member = WorkspaceMembers['members'][number]
type Invitation = WorkspaceMembers['invitations'][number]

function WorkspaceMembersPage() {
  const { user } = Route.useRouteContext()
  if (!user?.workspace) return null
  return (
    <MembersPanel
      key={user.workspace.id}
      userId={user.id}
      workspaceId={user.workspace.id}
      viewerRole={user.workspace.role}
    />
  )
}

function MembersPanel({
  userId,
  workspaceId,
  viewerRole,
}: {
  userId: string
  workspaceId: string
  viewerRole: string
}) {
  const query = useQuery(workspaceMembersQueryOptions(userId, workspaceId))
  const [busyKey, setBusyKey] = useState('')
  const [error, setError] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [removeError, setRemoveError] = useState('')
  const isOwner = getWorkspaceRole(viewerRole) === 'owner'
  const data = query.data

  async function run(
    key: string,
    action: () => Promise<MutationResult>,
    fallback: string,
  ) {
    if (busyKey) return false
    setBusyKey(key)
    setError('')
    try {
      const result = await action()
      if (result.error) {
        setError(result.error.message || fallback)
        return false
      }
      await query.refetch()
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : fallback)
      return false
    } finally {
      setBusyKey('')
    }
  }

  if (query.isPending)
    return (
      <div
        role="status"
        className="flex min-h-64 items-center justify-center gap-3 rounded-xl border border-border bg-background p-6 text-muted-foreground"
      >
        <LoaderCircle
          aria-hidden="true"
          className="size-5 animate-spin text-brand"
        />
        Đang tải danh sách thành viên…
      </div>
    )
  if (!data)
    return (
      <div
        role="alert"
        className="rounded-xl border border-border bg-background p-6"
      >
        <p className="text-error">{query.error.message}</p>
        <Button
          variant="outline"
          className="mt-4"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Thử lại
        </Button>
      </div>
    )

  const { seats } = data
  const noFreeSeat = !seats.active || seats.free < 1

  async function confirmRemove() {
    if (!removing) return
    setRemoveError('')
    if (busyKey) return
    setBusyKey(`remove:${removing.memberId}`)
    try {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail: removing.memberId,
        organizationId: workspaceId,
      })
      if (result.error) {
        setRemoveError(result.error.message || 'Chưa thể xóa thành viên.')
        return
      }
      setRemoving(null)
      await query.refetch()
    } catch {
      setRemoveError('Chưa thể xóa thành viên.')
    } finally {
      setBusyKey('')
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-background p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[23px] font-normal">Suất và lời mời</h2>
            {seats.active ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Đang dùng {seats.used}/{seats.limit} suất
                {seats.pendingInvitations > 0
                  ? `, ${seats.pendingInvitations} suất đang giữ cho lời mời`
                  : ''}
                . Còn {seats.free} suất trống.
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Không gian làm việc chưa có gói Business đang hoạt động nên chưa
                thể mời thành viên.
              </p>
            )}
            {noFreeSeat && seats.active && !isOwner && (
              <p className="mt-1 text-[13px] text-muted-foreground">
                Hãy nhờ chủ sở hữu mua thêm suất để mời thêm người.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {isOwner && noFreeSeat && (
              <ButtonLink
                to="/billing"
                variant="outline"
                className="h-12 rounded-lg border-border px-5 text-sm font-normal shadow-none"
              >
                {seats.active ? 'Mua thêm suất' : 'Kích hoạt gói Business'}
              </ButtonLink>
            )}
            <Button
              className="h-12 rounded-lg px-5 text-sm font-normal"
              disabled={noFreeSeat}
              onClick={() => setInviteOpen(true)}
            >
              <Plus className="mr-2 size-4" /> Mời thành viên
            </Button>
          </div>
        </div>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-destructive-subtle p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-background p-6 sm:p-8">
        <h2 className="text-[23px] font-normal">
          Thành viên ({data.members.length})
        </h2>
        <ul className="mt-6 divide-y divide-border">
          {data.members.map((item) => {
            const manageable =
              item.userId !== userId &&
              canManageWorkspaceMember(viewerRole, item.role)
            return (
              <li
                key={item.memberId}
                className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {item.name}
                    {item.userId === userId ? ' (bạn)' : ''}
                  </p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {item.email}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Tham gia {dateFormat.format(new Date(item.joinedAt))}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                  {isOwner && manageable ? (
                    <NativeSelect
                      aria-label={`Vai trò của ${item.name}`}
                      className="h-10 rounded-lg border-border bg-background px-3 text-sm shadow-none"
                      value={item.role}
                      disabled={Boolean(busyKey)}
                      onChange={(event) =>
                        void run(
                          `role:${item.memberId}`,
                          () =>
                            authClient.organization.updateMemberRole({
                              memberId: item.memberId,
                              role: event.target.value,
                              organizationId: workspaceId,
                            }),
                          'Chưa thể đổi vai trò.',
                        )
                      }
                    >
                      <option value="member">
                        {workspaceRoleLabels.member}
                      </option>
                      <option value="admin">{workspaceRoleLabels.admin}</option>
                    </NativeSelect>
                  ) : (
                    <Badge variant="secondary">
                      {workspaceRoleLabels[item.role]}
                    </Badge>
                  )}
                  {item.hasSeat ? (
                    <Badge variant="outline">Có suất</Badge>
                  ) : isOwner ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shadow-none"
                      disabled={Boolean(busyKey) || seats.free < 1}
                      onClick={() =>
                        void run(
                          `seat:${item.userId}`,
                          async () => {
                            await readBillingResponse(
                              await fetch('/api/billing/seats', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  workspaceId,
                                  userId: item.userId,
                                }),
                              }),
                              'Chưa thể cấp suất. Vui lòng thử lại sau.',
                            )
                            return {}
                          },
                          'Chưa thể cấp suất.',
                        )
                      }
                    >
                      Cấp suất
                    </Button>
                  ) : (
                    <Badge variant="destructive">Chưa có suất</Badge>
                  )}
                  {manageable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={Boolean(busyKey)}
                      onClick={() => {
                        setRemoveError('')
                        setRemoving(item)
                      }}
                    >
                      Xóa
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-background p-6 sm:p-8">
        <h2 className="text-[23px] font-normal">
          Lời mời đang chờ ({data.invitations.length})
        </h2>
        {data.invitations.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Không có lời mời nào đang chờ.
          </p>
        ) : (
          <ul className="mt-6 divide-y divide-border">
            {data.invitations.map((item: Invitation) => (
              <li
                key={item.id}
                className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Mời bởi {item.inviterName} · hết hạn{' '}
                    {dateFormat.format(new Date(item.expiresAt))}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">
                    {workspaceRoleLabels[item.role]}
                  </Badge>
                  {canInviteWorkspaceRole(viewerRole, item.role) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={Boolean(busyKey)}
                      onClick={() =>
                        void run(
                          `cancel:${item.id}`,
                          () =>
                            authClient.organization.cancelInvitation({
                              invitationId: item.id,
                            }),
                          'Chưa thể hủy lời mời.',
                        )
                      }
                    >
                      Hủy lời mời
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {inviteOpen && (
        <InviteModal
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          workspaceId={workspaceId}
          canInviteManagers={isOwner}
          onInvited={() => void query.refetch()}
        />
      )}

      <ConfirmModal
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title="Xóa thành viên?"
        description={`${removing?.name ?? ''} sẽ mất quyền truy cập không gian làm việc và suất của họ được giải phóng để mời người khác.`}
        confirmLabel="Xóa thành viên"
        destructive
        busy={busyKey.startsWith('remove:')}
        error={removeError}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  )
}

function InviteModal({
  open,
  onOpenChange,
  workspaceId,
  canInviteManagers,
  onInvited,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  canInviteManagers: boolean
  onInvited: () => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result = await authClient.organization.inviteMember({
        email: email.trim().toLowerCase(),
        role,
        organizationId: workspaceId,
      })
      if (result.error) {
        setError(result.error.message || 'Chưa thể gửi lời mời.')
        return
      }
      onInvited()
      onOpenChange(false)
    } catch {
      setError('Chưa thể gửi lời mời.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!submitting) onOpenChange(nextOpen)
      }}
    >
      <ResponsiveModalContent className="border-border bg-background p-6 font-sans text-foreground shadow-[0_6px_24px_var(--shadow-ink)] sm:p-7 lg:w-full lg:max-w-md">
        <ResponsiveModalHeader className="space-y-3 text-left">
          <ResponsiveModalTitle className="pr-6 text-[23px] font-normal leading-[1.4]">
            Mời thành viên
          </ResponsiveModalTitle>
          <ResponsiveModalDescription className="text-[13px] leading-[1.6]">
            Chúng tôi sẽ gửi email mời. Người được mời dùng một suất khi chấp
            nhận lời mời, và lời mời có hiệu lực trong 7 ngày.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <label
              htmlFor="invite-email"
              className="block text-[13px] font-medium leading-[1.5]"
            >
              Email
            </label>
            <Input
              id="invite-email"
              type="email"
              className="h-12 rounded-lg px-3 text-base shadow-none md:text-sm"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="tennguoi@congty.com"
              required
              disabled={submitting}
            />
          </div>
          {canInviteManagers && (
            <div className="flex flex-col gap-3">
              <label
                htmlFor="invite-role"
                className="block text-[13px] font-medium leading-[1.5]"
              >
                Vai trò
              </label>
              <NativeSelect
                id="invite-role"
                wrapperClassName="w-full"
                className="h-12 rounded-lg border-border bg-background px-3 text-sm shadow-none"
                value={role}
                onChange={(event) =>
                  setRole(event.target.value === 'admin' ? 'admin' : 'member')
                }
                disabled={submitting}
              >
                <option value="member">{workspaceRoleLabels.member}</option>
                <option value="admin">{workspaceRoleLabels.admin}</option>
              </NativeSelect>
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="text-[13px] leading-[1.5] text-destructive"
            >
              {error}
            </p>
          )}
          <ResponsiveModalFooter className="gap-3 sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              className="h-12 rounded-lg px-5 text-sm font-normal"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              className="h-12 rounded-lg px-5 text-sm font-normal"
              disabled={submitting || !email.trim()}
            >
              {submitting ? 'Đang gửi…' : 'Gửi lời mời'}
            </Button>
          </ResponsiveModalFooter>
        </form>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
