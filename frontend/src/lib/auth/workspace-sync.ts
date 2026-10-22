export const workspaceChangedEvent = 'salescoach:workspace-changed'
const callPrefix = 'salescoach:active-call:'
let voiceBusy = false

export function isVoiceBusyInThisTab() {
  return voiceBusy
}

// Best-effort UX lock across tabs. Server authorization never depends on storage.
export function trackVoiceActivity(userId: string, busy: boolean) {
  voiceBusy = busy
  const key = `${callPrefix}${crypto.randomUUID()}`
  const write = () => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ userId, until: Date.now() + 15_000 }),
      )
    } catch {
      /* Storage may be disabled. */
    }
  }
  if (busy) write()
  const interval = busy ? setInterval(write, 5_000) : undefined
  window.dispatchEvent(new Event(workspaceChangedEvent))
  return () => {
    voiceBusy = false
    clearInterval(interval)
    try {
      localStorage.removeItem(key)
    } catch {
      /* Storage is optional. */
    }
  }
}

export function hasActiveVoiceCall(userId: string) {
  if (voiceBusy) return true
  try {
    return Object.keys(localStorage).some((key) => {
      if (!key.startsWith(callPrefix)) return false
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? 'null')
        return value?.userId === userId && value.until > Date.now()
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

export function announceWorkspaceChange() {
  try {
    localStorage.setItem(workspaceChangedEvent, crypto.randomUUID())
  } catch {
    /* Focus rechecks still work. */
  }
}
