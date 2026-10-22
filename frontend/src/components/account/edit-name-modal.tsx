import { useState } from 'react'
import { useRefreshCurrentUser } from '#/components/account/use-refresh-current-user'
import { Button } from '#/components/ui/button'
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
import { NAME_MAX_LENGTH, nameSchema } from '#/lib/auth/profile-rules'

export function EditNameModal({
  name,
  onClose,
}: {
  name: string
  onClose: () => void
}) {
  const refreshUser = useRefreshCurrentUser()
  const [value, setValue] = useState(name)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const parsed = nameSchema.safeParse(value)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Tên không hợp lệ.')
      return
    }
    if (parsed.data === name) {
      onClose()
      return
    }
    setSaving(true)
    setError('')
    try {
      const result = await authClient.updateUser({ name: parsed.data })
      if (result.error) {
        setError(result.error.message || 'Chưa thể lưu tên. Vui lòng thử lại.')
        return
      }
      await refreshUser()
      onClose()
    } catch {
      setError('Chưa thể lưu tên. Vui lòng thử lại.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <ResponsiveModalContent className="border-border bg-background p-6 font-sans text-foreground shadow-[0_6px_24px_var(--shadow-ink)] sm:p-7 lg:w-full lg:max-w-md">
        <ResponsiveModalHeader className="space-y-3 text-left">
          <ResponsiveModalTitle className="pr-6 text-[23px] font-normal leading-[1.4]">
            Sửa tên
          </ResponsiveModalTitle>
          <ResponsiveModalDescription className="text-[13px] leading-[1.6]">
            Tên hiển thị trên tài khoản của bạn.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <form onSubmit={submit} className="mt-5 grid gap-4">
          <label className="block text-[13px] text-brand">
            Tên
            <Input
              className="mt-2 block h-11 w-full text-sm font-normal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={NAME_MAX_LENGTH}
              autoComplete="name"
              autoFocus
              required
              disabled={saving}
            />
          </label>
          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-destructive-subtle p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          <ResponsiveModalFooter className="mt-2 gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-11 px-5 text-sm font-normal shadow-none"
              disabled={saving}
              onClick={onClose}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              className="h-11 px-5 text-sm font-normal"
              disabled={saving}
            >
              {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
            </Button>
          </ResponsiveModalFooter>
        </form>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
