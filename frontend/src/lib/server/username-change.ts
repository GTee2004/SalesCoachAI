import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, ne } from 'drizzle-orm'
import { db } from '#/db'
import { user, verification } from '#/db/schema'
import { createUsernameChangeEmail } from '#/lib/emails/email-templates/username-change'
import { sendMail } from '#/lib/emails/send-mail'
import { normalizeUsername } from '#/lib/auth/profile-rules'
import { env } from '#/env'

// The code lives in Better Auth's own `verification` table, next to its email
// OTPs, under an identifier no Better Auth flow uses. The value also carries
// the requested username so a code can never confirm a different one.
const CODE_TTL_MS = 10 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000
const MAX_ATTEMPTS = 5

type PendingChange = { username: string; hash: string; attempts: number }

const identifierFor = (userId: string) => `username-change-otp-${userId}`

const hashCode = (userId: string, username: string, code: string) =>
  createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(`${userId}\n${username}\n${code}`)
    .digest('hex')

function parsePending(value: string): PendingChange | null {
  try {
    const parsed = JSON.parse(value) as Partial<PendingChange>
    if (
      typeof parsed.username === 'string' &&
      typeof parsed.hash === 'string' &&
      typeof parsed.attempts === 'number'
    )
      return parsed as PendingChange
  } catch {
    // Treated as no pending change.
  }
  return null
}

const fail = (message: string, status: number): never => {
  throw new Response(message, { status })
}

async function isTakenByAnotherUser(userId: string, username: string) {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.username, username), ne(user.id, userId)))
    .limit(1)
  return Boolean(row)
}

export async function sendUsernameChangeCode(input: {
  userId: string
  email: string
  currentUsername: string | null
  username: string
}) {
  const username = normalizeUsername(input.username)
  if (username === input.currentUsername)
    fail('Bí danh mới trùng với bí danh hiện tại.', 400)
  if (await isTakenByAnotherUser(input.userId, username))
    fail('Bí danh này đã có người sử dụng.', 409)

  const identifier = identifierFor(input.userId)
  const existing = (
    await db
      .select({ createdAt: verification.createdAt })
      .from(verification)
      .where(eq(verification.identifier, identifier))
      .orderBy(desc(verification.createdAt))
      .limit(1)
  ).at(0)
  if (existing) {
    const wait =
      RESEND_COOLDOWN_MS - (Date.now() - existing.createdAt.getTime())
    if (wait > 0)
      fail(
        `Vui lòng đợi ${Math.ceil(wait / 1000)} giây trước khi yêu cầu mã mới.`,
        429,
      )
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const pending: PendingChange = {
    username,
    hash: hashCode(input.userId, username, code),
    attempts: 0,
  }
  const id = crypto.randomUUID()
  // A new request replaces any earlier code, so only the latest one is valid.
  await db.delete(verification).where(eq(verification.identifier, identifier))
  await db.insert(verification).values({
    id,
    identifier,
    value: JSON.stringify(pending),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  })

  try {
    await sendMail({
      to: input.email,
      ...createUsernameChangeEmail({ otp: code, username }),
    })
  } catch (error) {
    console.error('[Account] username change email failed', {
      userId: input.userId,
      error,
    })
    await db.delete(verification).where(eq(verification.id, id))
    fail('Chưa thể gửi email xác minh. Vui lòng thử lại sau.', 502)
  }
}

export async function confirmUsernameChange(input: {
  userId: string
  username: string
  code: string
}) {
  const username = normalizeUsername(input.username)
  const invalid = () => fail('Mã không đúng hoặc đã hết hạn.', 400)
  const identifier = identifierFor(input.userId)

  const row = (
    await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, identifier))
      .orderBy(desc(verification.createdAt))
      .limit(1)
  ).at(0)
  if (!row) return invalid()

  const pending = parsePending(row.value)
  if (!pending || row.expiresAt.getTime() <= Date.now()) {
    await db.delete(verification).where(eq(verification.id, row.id))
    return invalid()
  }
  if (pending.attempts >= MAX_ATTEMPTS) {
    await db.delete(verification).where(eq(verification.id, row.id))
    return fail('Bạn đã nhập sai quá nhiều lần. Hãy yêu cầu mã mới.', 429)
  }
  if (pending.username !== username)
    return fail('Mã này được gửi cho bí danh khác. Hãy yêu cầu mã mới.', 400)

  // Count the attempt before comparing, and only if nobody else changed the
  // row meanwhile, so parallel guesses cannot exceed the attempt limit.
  const counted = await db
    .update(verification)
    .set({
      value: JSON.stringify({ ...pending, attempts: pending.attempts + 1 }),
    })
    .where(and(eq(verification.id, row.id), eq(verification.value, row.value)))
    .returning({ id: verification.id })
  if (!counted.length) return fail('Vui lòng thử lại.', 409)

  const expected = Buffer.from(pending.hash)
  const actual = Buffer.from(hashCode(input.userId, username, input.code))
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return invalid()

  // A code works once.
  await db.delete(verification).where(eq(verification.id, row.id))

  if (await isTakenByAnotherUser(input.userId, username))
    return fail('Bí danh này đã có người sử dụng.', 409)
  try {
    await db.update(user).set({ username }).where(eq(user.id, input.userId))
  } catch (error) {
    // Someone took it between the check and the write; the column is unique.
    if ((error as { code?: string }).code === '23505')
      return fail('Bí danh này đã có người sử dụng.', 409)
    throw error
  }
  return { username }
}
