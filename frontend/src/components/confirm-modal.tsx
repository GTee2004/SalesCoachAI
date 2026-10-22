import { Button } from '#/components/ui/button'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '#/components/ui/responsive-modal'

type ConfirmModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  busy?: boolean
  error?: string
  onConfirm: () => void
}

export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  busy = false,
  error = '',
  onConfirm,
}: ConfirmModalProps) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen)
      }}
    >
      <ResponsiveModalContent className="border-border bg-background p-6 font-sans text-foreground shadow-[0_6px_24px_var(--shadow-ink)] sm:p-7 lg:w-full lg:max-w-md">
        <ResponsiveModalHeader className="space-y-3 text-left">
          <ResponsiveModalTitle className="pr-6 text-[23px] font-normal leading-[1.4]">
            {title}
          </ResponsiveModalTitle>
          <ResponsiveModalDescription className="text-[13px] leading-[1.6]">
            {description}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        {error ? (
          <p
            role="alert"
            className="mt-4 text-[13px] leading-[1.5] text-destructive"
          >
            {error}
          </p>
        ) : null}
        <ResponsiveModalFooter className="mt-6 gap-3 sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            className="h-12 rounded-lg px-5 text-sm font-normal"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Hủy
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            className="h-12 rounded-lg px-5 text-sm font-normal"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Đang xử lý…' : confirmLabel}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
