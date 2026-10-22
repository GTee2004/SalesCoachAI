export function safeAuthReturnTo(value: string | undefined) {
  if (!value || !value.startsWith('/')) return '/'

  try {
    const target = new URL(value, 'https://salescoach.invalid')
    if (target.origin !== 'https://salescoach.invalid') return '/'
    return target.pathname + target.search + target.hash
  } catch {
    return '/'
  }
}
