import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { authClient } from '#/lib/auth/client'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '#/components/ui/responsive-modal'

type AddWorkspaceModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddWorkspaceModal({
  open,
  onOpenChange,
}: AddWorkspaceModalProps) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    setSubmitting(true)
    setError('')

    try {
      requestId.current ??= crypto.randomUUID()

      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          requestId: requestId.current,
        }),
      })

      if (!response.ok) {
        throw new Error('Chưa thể tạo không gian làm việc. Vui lòng thử lại.')
      }

      const resultData = (await response.json()) as { workspaceId: string }
      const active = await authClient.organization.setActive({
        organizationId: resultData.workspaceId,
      })
      if (active.error)
        throw new Error('Chưa thể mở không gian làm việc vừa tạo.')
      window.location.assign('/billing?plan=business&interval=monthly&seats=2')
    } catch {
      setError('Chưa thể tạo không gian làm việc. Vui lòng thử lại.')
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
          <ResponsiveModalTitle className="pr-6 text-[23px] font-normal leading-[1.4] text-foreground">
            Thêm không gian làm việc công ty
          </ResponsiveModalTitle>
          <ResponsiveModalDescription className="text-[13px] leading-[1.6] text-muted-foreground">
            Tạo không gian riêng cho đội ngũ. Không gian làm việc sẽ ở trạng
            thái chưa kích hoạt cho đến khi mua gói Business (tối thiểu 2 người
            dùng).
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <label
              htmlFor="company-workspace-name"
              className="block text-[13px] font-medium leading-[1.5]"
            >
              Tên không gian làm việc
            </label>
            <Input
              id="company-workspace-name"
              className="h-12 rounded-lg border-border bg-background px-3 text-base text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-brand focus-visible:ring-ring/20 md:text-sm"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                requestId.current = null
              }}
              placeholder="Ví dụ: Đội kinh doanh Teraland"
              minLength={2}
              maxLength={100}
              required
              disabled={submitting}
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="text-[13px] leading-[1.5] text-destructive"
            >
              {error}
            </p>
          ) : null}

          <ResponsiveModalFooter className="gap-3 sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-lg border-border bg-background px-5 text-[13px] font-normal text-foreground shadow-none hover:bg-muted-hover hover:text-foreground"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="h-11 rounded-lg bg-primary px-5 text-[13px] font-normal text-primary-foreground hover:bg-primary-hover-strong"
            >
              {submitting ? 'Đang tạo…' : 'Tạo không gian làm việc'}
            </Button>
          </ResponsiveModalFooter>
        </form>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
