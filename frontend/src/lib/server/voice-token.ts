import { createHmac, timingSafeEqual } from 'node:crypto'

type TokenPayload = {
  sub: string
  sid: string
  aud: 'salescoach-voice'
  aid?: string
  nonce: string
  iat: number
  exp: number
}

function encode(value: string | Buffer) {
  return Buffer.from(value).toString('base64url')
}

export function signVoiceToken(
  payload: Omit<TokenPayload, 'aud' | 'iat' | 'exp'>,
  secret: string,
  ttlSeconds = 120,
) {
  const now = Math.floor(Date.now() / 1000)
  const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = encode(
    JSON.stringify({
      ...payload,
      aud: 'salescoach-voice',
      iat: now,
      exp: now + ttlSeconds,
    }),
  )
  const signature = encode(
    createHmac('sha256', secret).update(`${header}.${body}`).digest(),
  )
  return {
    token: `${header}.${body}.${signature}`,
    expiresAt: now + ttlSeconds,
  }
}

export function safeSecretEqual(
  actual: string | null,
  expected: string | undefined,
) {
  if (!actual || !expected) return false
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
