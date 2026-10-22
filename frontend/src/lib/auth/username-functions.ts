import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { usernameCodeSchema, usernameSchema } from '#/lib/auth/profile-rules'

async function verifiedUser() {
  const [{ getRequestHeaders }, { getVerifiedSession }] = await Promise.all([
    import('@tanstack/react-start/server'),
    import('#/lib/server/http'),
  ])
  return (await getVerifiedSession(getRequestHeaders())).user
}

// Better Auth's own /update-user would change a username without any proof of
// email ownership, so it is blocked for usernames; these two functions are the
// only way to change one.
export const requestUsernameChange = createServerFn({ method: 'POST' })
  .validator(z.object({ username: usernameSchema }))
  .handler(async ({ data }) => {
    const current = await verifiedUser()
    const { sendUsernameChangeCode } =
      await import('#/lib/server/username-change')
    await sendUsernameChangeCode({
      userId: current.id,
      email: current.email,
      currentUsername: current.username ?? null,
      username: data.username,
    })
    return { email: current.email }
  })

export const confirmUsernameChange = createServerFn({ method: 'POST' })
  .validator(z.object({ username: usernameSchema, code: usernameCodeSchema }))
  .handler(async ({ data }) => {
    const current = await verifiedUser()
    const { confirmUsernameChange: confirm } =
      await import('#/lib/server/username-change')
    return confirm({ userId: current.id, ...data })
  })
