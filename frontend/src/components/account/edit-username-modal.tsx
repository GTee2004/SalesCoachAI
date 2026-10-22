import { useEffect, useState } from 'react'
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
import {
  USERNAME_CODE_LENGTH,
  USERNAME_MAX_LENGTH,
  normalizeUsername,
  usernameSchema,
} from '#/lib/auth/profile-rules'
import {
  confirmUsernameChange,
  requestUsernameChange,
} from '#/lib/auth/username-functions'

const RESEND_SECONDS = 60
const labelClass = 'block text-[13px] text-brand'
const fieldClass = 'mt-2 block h-11 w-full text-sm font-normal'

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'error'

async function readError(error: unknown, fallback: string) {
  if (error instanceof Response) {
    const text = await error.text().catch(() => '')
    if (text) return text
  }
  return fallback
}

export function EditUsernameModal({
  username,
  email,
  onClose,
}: {
  username: string | null
  email: string
  onClose: () => void
}) {
  const refreshUser = useRefreshCurrentUser()
  const [value, setValue] = useState(username ?? '')
  const [code, setCode] = useState('')
  // The username the emailed code was issued for; null while still choosing.
  const [sentFor, setSentFor] = useState<string | null>(null)
  const [availability, setAvailability] = useState<Availability>('idle')
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const parsed = usernameSchema.safeParse(value)
  const candidate = parsed.success ? normalizeUsername(parsed.data) : null
  const unchanged = candidate !== null && candidate === username
  const validationMessage =
    value.trim() && !parsed.success ? parsed.error.issues[0]?.message : ''

  // Checks the system for the username while the person types.
  useEffect(() => {
    if (sentFor !== null || !candidate || unchanged) {
      setAvailability('idle')
      return
    }
    setAvailability('checking')
    let stale = false
    const timer = setTimeout(async () => {
      try {
        const result = await authClient.isUsernameAvailable({
          username: candidate,
        })
        if (stale) return
        setAvailability(
          result.error
            ? 'error'
            : result.data.available
              ? 'available'
              : 'taken',
        )
      } catch {
        if (!stale) setAvailability('error')
      }
    }, 500)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [candidate, unchanged, sentFor])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function sendCode() {
    if (!parsed.success || busy) return
    setBusy(true)
    setError('')
    try {
      await requestUsernameChange({ data: { username: parsed.data } })
      setSentFor(parsed.data)
      setCode('')
      setCooldown(RESEND_SECONDS)
    } catch (reason) {
      setError(await readError(reason, 'Chưa thể gửi mã. Vui lòng thử lại.'))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sentFor === null || busy) return
    setBusy(true)
    setError('')
    try {
      await confirmUsernameChange({ data: { username: sentFor, code } })
      await refreshUser()
      onClose()
    } catch (reason) {
      setError(
        await readError(reason, 'Chưa thể đổi bí danh. Vui lòng thử lại.'),
      )
    } finally {
      setBusy(false)
    }
  }

  const choosing = sentFor === null
  const hint =
    validationMessage ||
    (unchanged
      ? 'Đây là bí danh hiện tại của bạn.'
      : availability === 'checking'
        ? 'Đang kiểm tra…'
        : availability === 'available'
          ? 'Bí danh này còn trống.'
          : availability === 'taken'
            ? 'Bí danh này đã có người sử dụng.'
            : availability === 'error'
              ? 'Chưa kiểm tra được bí danh; hệ thống sẽ kiểm tra lại khi gửi mã.'
              : '')

  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <ResponsiveModalContent className="border-border bg-background p-6 font-sans text-foreground shadow-[0_6px_24px_var(--shadow-ink)] sm:p-7 lg:w-full lg:max-w-md">
        <ResponsiveModalHeader className="space-y-3 text-left">
          <ResponsiveModalTitle className="pr-6 text-[23px] font-normal leading-[1.4]">
            Sửa bí danh (username)
          </ResponsiveModalTitle>
          <ResponsiveModalDescription className="text-[13px] leading-[1.6]">
            {choosing
              ? 'Chúng tôi sẽ gửi mã xác minh đến email của bạn trước khi đổi.'
              : `Nhập mã ${USERNAME_CODE_LENGTH} chữ số đã gửi đến ${email}. Mã có hiệu lực trong 10 phút.`}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        {choosing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void sendCode()
            }}
            className="mt-5 grid gap-4"
          >
            <label className={labelClass}>
              Bí danh (username)
              <Input
                className={fieldClass}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                maxLength={USERNAME_MAX_LENGTH}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                required
                disabled={busy}
              />
            </label>
            <p
              role="status"
              className={`min-h-5 text-[13px] ${
                validationMessage || availability === 'taken'
                  ? 'text-destructive'
                  : availability === 'available'
                    ? 'text-brand'
                    : 'text-muted-foreground'
              }`}
            >
              {hint ||
                'Chữ cái, số, dấu gạch dưới và dấu chấm; từ 3 đến 30 ký tự.'}
            </p>
            {error ? <ErrorNotice>{error}</ErrorNotice> : null}
            <ResponsiveModalFooter className="mt-2 gap-3">
              <Button
                type="button"
                variant="outline"
                className="h-11 px-5 text-sm font-normal shadow-none"
                disabled={busy}
                onClick={onClose}
              >
                Hủy
              </Button>
              <Button
                type="submit"
                className="h-11 px-5 text-sm font-normal"
                disabled={
                  busy ||
                  !candidate ||
                  unchanged ||
                  availability === 'taken' ||
                  availability === 'checking'
                }
              >
                {busy ? 'Đang gửi…' : 'Gửi mã xác minh'}
              </Button>
            </ResponsiveModalFooter>
          </form>
        ) : (
          <form onSubmit={confirm} className="mt-5 grid gap-4">
            <p className="text-sm">
              Bí danh mới: <strong className="font-medium">{sentFor}</strong>
            </p>
            <label className={labelClass}>
              Mã xác minh
              <Input
                className={`${fieldClass} font-mono tracking-[0.4em]`}
                value={code}
                onChange={(event) =>
                  setCode(
                    event.target.value
                      .replace(/\D/g, '')
                      .slice(0, USERNAME_CODE_LENGTH),
                  )
                }
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={USERNAME_CODE_LENGTH}
                autoFocus
                required
                disabled={busy}
              />
            </label>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              <button
                type="button"
                className="text-brand underline-offset-2 hover:underline disabled:text-muted-foreground disabled:no-underline"
                disabled={busy || cooldown > 0}
                onClick={() => void sendCode()}
              >
                {cooldown > 0 ? `Gửi lại mã sau ${cooldown}s` : 'Gửi lại mã'}
              </button>
              <button
                type="button"
                className="text-brand underline-offset-2 hover:underline disabled:text-muted-foreground"
                disabled={busy}
                onClick={() => {
                  setSentFor(null)
                  setError('')
                }}
              >
                Đổi bí danh khác
              </button>
            </div>
            {error ? <ErrorNotice>{error}</ErrorNotice> : null}
            <ResponsiveModalFooter className="mt-2 gap-3">
              <Button
                type="button"
                variant="outline"
                className="h-11 px-5 text-sm font-normal shadow-none"
                disabled={busy}
                onClick={onClose}
              >
                Hủy
              </Button>
              <Button
                type="submit"
                className="h-11 px-5 text-sm font-normal"
                disabled={busy || code.length !== USERNAME_CODE_LENGTH}
              >
                {busy ? 'Đang xác nhận…' : 'Xác nhận đổi bí danh'}
              </Button>
            </ResponsiveModalFooter>
          </form>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}

function ErrorNotice({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg bg-destructive-subtle p-3 text-sm text-destructive"
    >
      {children}
    </p>
  )
}
