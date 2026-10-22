import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { PERMISSIONS } from '#/lib/auth/permissions'
import { requirePermission } from '#/lib/auth/require-permission'
import { ADMIN_RANGE_MAX_DAYS } from './contracts'
import { customRangeProblem, toDateKey } from './usage'

const requireAdmin = () => requirePermission(PERMISSIONS.adminDashboardView)

export const getAdminServiceHealth = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    const { checkServices } = await import('#/lib/server/service-health')
    return checkServices()
  },
)

const usageInput = z.union([
  z.object({ days: z.number().int().min(1).max(ADMIN_RANGE_MAX_DAYS) }),
  z
    .object({ from: z.string(), to: z.string() })
    .refine(
      ({ from, to }) =>
        customRangeProblem(from, to, toDateKey(new Date())) === null,
    ),
])

export const getAdminUsage = createServerFn({ method: 'GET' })
  .validator(usageInput)
  .handler(async ({ data }) => {
    await requireAdmin()
    const { getAdminUsage: read } = await import('#/lib/server/admin-metrics')
    return read(data)
  })

export const getAdminVoiceLatency = createServerFn({ method: 'GET' })
  .validator(usageInput)
  .handler(async ({ data }) => {
    await requireAdmin()
    const { getAdminVoiceLatency: read } =
      await import('#/lib/server/admin-metrics')
    return read(data)
  })

export const getAdminServiceCosts = createServerFn({ method: 'GET' })
  .validator(usageInput)
  .handler(async ({ data }) => {
    await requireAdmin()
    const { getAdminServiceCosts: read } =
      await import('#/lib/server/admin-metrics')
    return read(data)
  })

export const getAdminRecentSessions = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    const { listRecentSessions } = await import('#/lib/server/admin-metrics')
    return { items: await listRecentSessions() }
  },
)

const sessionInput = z.object({ sessionId: z.string().uuid() })

export const getAdminSessionTranscript = createServerFn({ method: 'GET' })
  .validator(sessionInput)
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    const { getSessionTranscript } = await import('#/lib/server/admin-metrics')
    const transcript = await getSessionTranscript(data.sessionId)
    // Transcripts are personal data; keep a trace of who opened which one.
    if (transcript)
      console.info('Admin opened a session transcript', {
        adminId: admin.id,
        sessionId: data.sessionId,
      })
    return transcript
  })
