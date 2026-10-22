import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ConfirmModal } from '#/components/confirm-modal'
import { Button } from '#/components/ui/button'
import { ButtonLink } from '#/components/ui/button-link'
import { Input } from '#/components/ui/input'
import { currentUserQueryKey } from '#/lib/auth/authQueries'
import { authClient } from '#/lib/auth/client'
import {
  canManageWorkspaceBilling,
  canRenameWorkspace,
  getWorkspaceRole,
  workspaceRoleLabels,
} from '#/lib/auth/workspace-roles'
import {
  announceWorkspaceChange,
  hasActiveVoiceCall,
} from '#/lib/auth/workspace-sync'

export const Route = createFileRoute('/workspace/')({
  component: WorkspaceGeneralPage,
})

function WorkspaceGeneralPage() {
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const queryClient = useQueryClient()
  const workspace = user?.workspace
  const [name, setName] = useState(workspace?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [leaveError, setLeaveError] = useState('')
  if (!user || !workspace) return null

  const role = getWorkspaceRole(workspace.role)
  const canRename = canRenameWorkspace(workspace.role)
  const trimmed = name.trim()

  const saveName = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    setNotice('')
    const result = await authClient.organization.update({
      data: { name: trimmed },
      organizationId: workspace.id,
    })
    if (result.error) {
      setError(result.error.message || 'Chưa thể đổi tên không gian làm việc.')
    } else {
      // The workspace name comes from the cached identity, so refresh it.
      await queryClient.invalidateQueries({ queryKey: currentUserQueryKey })
      await router.invalidate()
      setNotice('Đã lưu tên không gian làm việc.')
    }
    setSaving(false)
  }

  const leaveWorkspace = async () => {
    if (leaving) return
    if (hasActiveVoiceCall(user.id)) {
      setLeaveError(
        'Hãy kết thúc cuộc gọi đang mở trước khi rời không gian làm việc.',
      )
      return
    }
    setLeaving(true)
    setLeaveError('')
    const result = await authClient.organization.leave({
      organizationId: workspace.id,
    })
    if (result.error) {
      setLeaveError(result.error.message || 'Chưa thể rời không gian làm việc.')
      setLeaving(false)
      return
    }
    await queryClient.cancelQueries()
    queryClient.clear()
    announceWorkspaceChange()
    // The session falls back to the personal workspace on the next load.
    window.location.assign('/practice')
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-background p-6 sm:p-8">
        <h2 className="text-[23px] font-normal">
          Thông tin không gian làm việc
        </h2>
        <form onSubmit={saveName} className="mt-8 max-w-xl">
          <label
            htmlFor="workspace-name"
            className="block text-[13px] text-muted-foreground"
          >
            Tên không gian làm việc
          </label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <Input
              id="workspace-name"
              className="h-12 rounded-lg px-3 text-base shadow-none md:text-sm"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setNotice('')
              }}
              minLength={2}
              maxLength={100}
              required
              readOnly={!canRename}
              disabled={saving}
            />
            {canRename && (
              <Button
                type="submit"
                className="h-12 rounded-lg px-5 text-sm font-normal"
                disabled={
                  saving || trimmed.length < 2 || trimmed === workspace.name
                }
              >
                {saving ? 'Đang lưu…' : 'Lưu tên'}
              </Button>
            )}
          </div>
          {!canRename && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Chỉ chủ sở hữu có thể đổi tên không gian làm việc.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-[13px] text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="mt-3 text-[13px] text-brand">
              {notice}
            </p>
          )}
        </form>

        <dl className="mt-8 divide-y divide-border">
          <div className="grid items-start gap-2 pb-5 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-9">
            <dt className="text-sm text-muted-foreground">
              Loại không gian làm việc
            </dt>
            <dd className="text-base">Không gian làm việc công ty</dd>
          </div>
          <div className="grid items-start gap-2 pt-5 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-9">
            <dt className="text-sm text-muted-foreground">Vai trò của bạn</dt>
            <dd className="text-base">{workspaceRoleLabels[role]}</dd>
          </div>
        </dl>

        {canManageWorkspaceBilling(workspace.role) && (
          <ButtonLink
            to="/billing"
            variant="outline"
            className="mt-8 h-12 rounded-lg border-border px-5 text-sm font-normal shadow-none"
          >
            Quản lý gói và suất
          </ButtonLink>
        )}
      </section>

      {role !== 'owner' && (
        <section className="rounded-xl border border-border bg-background p-6 sm:p-8">
          <h2 className="text-[23px] font-normal">Rời không gian làm việc</h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Bạn sẽ mất quyền truy cập không gian làm việc này và suất luyện tập
            của mình sẽ được trả lại cho không gian làm việc.
          </p>
          <Button
            variant="outline"
            className="mt-5 h-12 rounded-lg px-5 text-sm font-normal text-destructive shadow-none"
            onClick={() => setLeaveOpen(true)}
          >
            Rời không gian làm việc
          </Button>
        </section>
      )}

      <ConfirmModal
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Rời không gian làm việc?"
        description={`Bạn sẽ không còn truy cập được "${workspace.name}". Chủ sở hữu cần mời lại nếu bạn muốn quay lại.`}
        confirmLabel="Rời không gian làm việc"
        destructive
        busy={leaving}
        error={leaveError}
        onConfirm={() => void leaveWorkspace()}
      />
    </div>
  )
}
