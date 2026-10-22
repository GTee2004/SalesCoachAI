import { useEffect, useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { getCurrentUser } from '#/lib/auth/current-user'
import {
  isVoiceBusyInThisTab,
  workspaceChangedEvent,
} from '#/lib/auth/workspace-sync'

export function WorkspaceContextSync() {
  const { user } = useRouteContext({ from: '__root__' })
  const queryClient = useQueryClient()
  const [changedDuringCall, setChangedDuringCall] = useState(false)

  useEffect(() => {
    if (!user) return
    const lifetime = new AbortController()
    const isDisposed = () => lifetime.signal.aborted
    let checking = false
    let recheck = false
    // Polling skips hidden tabs; an explicit change signal does not, so a
    // background tab reloads before its own refetches can hit a 409.
    const check = async (force = false) => {
      if (lifetime.signal.aborted) return
      if (!force && document.visibilityState === 'hidden') return
      if (checking) {
        // A check already in flight may have read the session before the
        // switch landed; run once more when it settles.
        if (force) recheck = true
        return
      }
      checking = true
      try {
        const fresh = await getCurrentUser()
        if (isDisposed()) return
        const changed =
          fresh?.id !== user.id ||
          fresh.workspace?.id !== user.workspace?.id ||
          fresh.workspace?.status !== user.workspace?.status ||
          fresh.workspace?.role !== user.workspace?.role
        if (!changed) {
          setChangedDuringCall(false)
          return
        }
        if (fresh?.id === user.id && isVoiceBusyInThisTab()) {
          setChangedDuringCall(true)
          return
        }
        await queryClient.cancelQueries()
        queryClient.clear()
        window.location.reload()
      } catch {
        /* Keep the current screen offline; APIs still enforce scope. */
      } finally {
        checking = false
        if (recheck) {
          recheck = false
          void check(true)
        }
      }
    }
    const onChange = () => {
      void check()
    }
    const onSignal = () => {
      void check(true)
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === workspaceChangedEvent) onSignal()
    }
    window.addEventListener('focus', onChange)
    window.addEventListener('storage', onStorage)
    window.addEventListener(workspaceChangedEvent, onSignal)
    document.addEventListener('visibilitychange', onChange)
    const interval = setInterval(onChange, 15_000)
    onChange()
    return () => {
      lifetime.abort()
      clearInterval(interval)
      window.removeEventListener('focus', onChange)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(workspaceChangedEvent, onSignal)
      document.removeEventListener('visibilitychange', onChange)
    }
  }, [user, queryClient])

  return changedDuringCall ? (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 bg-amber-100 px-4 py-3 text-center text-sm text-amber-950"
    >
      Không gian làm việc đã thay đổi ở nơi khác. Hãy kết thúc cuộc gọi này;
      trang sẽ tải lại sau đó.
    </div>
  ) : null
}
