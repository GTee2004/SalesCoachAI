// Error code the auth API returns when a verification email could not be sent.
export const VERIFICATION_EMAIL_FAILED = 'VERIFICATION_EMAIL_FAILED'

// Better Auth logs and drops any error thrown while it sends a verification
// email, so the endpoint still reports success. Failed sends are noted here
// and the auth `after` hook of the same request turns them into an error.
const FAILURE_TTL_MS = 60_000
const failedSends = new Map<string, number>()

function toKey(email: unknown) {
  return typeof email === 'string' ? email.trim().toLowerCase() : null
}

export function markVerificationEmailFailed(email: string, now = Date.now()) {
  for (const [key, failedAt] of failedSends)
    if (now - failedAt > FAILURE_TTL_MS) failedSends.delete(key)
  const key = toKey(email)
  if (key) failedSends.set(key, now)
}

export function clearVerificationEmailFailure(email: unknown) {
  const key = toKey(email)
  if (key) failedSends.delete(key)
}

export function takeVerificationEmailFailure(email: unknown, now = Date.now()) {
  const key = toKey(email)
  if (!key) return false
  const failedAt = failedSends.get(key)
  failedSends.delete(key)
  return failedAt !== undefined && now - failedAt <= FAILURE_TTL_MS
}
