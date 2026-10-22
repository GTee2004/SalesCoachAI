import type { getCurrentUser } from './current-user'

type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>
type UserDisplay = { initials: string; name: string; detail: string }

export function getUserDisplay(user: CurrentUser): UserDisplay {
  if (!user) {
    return { initials: '?', name: 'Tài khoản', detail: 'Chưa đăng nhập' }
  }

  const name = user.name.trim()
  const email = user.email.trim()
  const words = name ? name.split(/\s+/) : []
  const initials = words.length
    ? `${words[0]?.[0] ?? ''}${words.length > 1 ? (words.at(-1)?.[0] ?? '') : ''}`
    : email.charAt(0) || '?'

  return {
    initials: initials.toLocaleUpperCase('vi'),
    name: name || email || 'Tài khoản',
    detail: email,
  }
}
