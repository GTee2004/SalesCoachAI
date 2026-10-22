import { env } from '#/env'
import { initialAlertState, processAlerts } from '#/lib/admin/service-alerts'
import type { AlertNotice } from '#/lib/admin/service-alerts'
import { createServiceAlertEmail } from '#/lib/emails/email-templates/service-alert'
import { sendMail } from '#/lib/emails/send-mail'
import { listAdminEmails } from './admin-metrics'
import { checkServices } from './service-health'

const CHECK_INTERVAL_MS = 30_000
const MONITOR = Symbol.for('salescoach.service-monitor')

/**
 * Checks every service on a timer and emails the admins when one goes down or
 * comes back. State lives in this process, which fits the single web instance
 * the app is deployed as; an outage of the web app itself cannot be reported
 * from here.
 */
export function startServiceMonitor() {
  // Off in development by default: a stopped local voice backend is not an
  // incident, and the SMTP account is the real one.
  const enabled = env.SERVICE_ALERT_EMAILS
    ? env.SERVICE_ALERT_EMAILS === 'on'
    : env.NODE_ENV === 'production'
  const globals = globalThis as { [MONITOR]?: ReturnType<typeof setInterval> }
  // Dev reloads re-evaluate this module; keep a single timer per process.
  if (!enabled || globals[MONITOR]) return

  let state = initialAlertState()
  // Kept from the last successful read so a database outage can still be sent.
  let recipients: string[] = []
  let checking = false

  /** Whether the notice reached anyone; one that did not is raised again. */
  async function deliver(notice: AlertNotice, checkedAt: Date) {
    if (recipients.length === 0) {
      console.error('Service alert has no admin recipient', notice)
      return false
    }
    try {
      const email = createServiceAlertEmail({
        notice,
        checkedAt,
        dashboardUrl: `${env.BETTER_AUTH_URL.replace(/\/$/, '')}/admin/dashboard`,
      })
      const sent = await Promise.allSettled(
        recipients.map((to) => sendMail({ to, ...email })),
      )
      for (const outcome of sent) {
        if (outcome.status === 'rejected')
          console.error('Service alert email failed', {
            ...notice,
            error: outcome.reason,
          })
      }
      // One accepted copy settles the notice: sending it again for the admins
      // it failed for would repeat it for those who already have it.
      return sent.some((outcome) => outcome.status === 'fulfilled')
    } catch (error) {
      console.error('Service alert email failed', { ...notice, error })
      return false
    }
  }

  async function check() {
    if (checking) return
    checking = true
    try {
      const health = await checkServices()
      const databaseUp = health.services.some(
        (service) => service.key === 'database' && service.state === 'up',
      )
      if (databaseUp)
        recipients = await listAdminEmails().catch(() => recipients)
      const checkedAt = new Date(health.checkedAt)
      state = await processAlerts(
        state,
        health.services,
        health.checkedAt,
        (notice) => deliver(notice, checkedAt),
      )
    } catch (error) {
      console.error('Service monitor check failed', error)
    } finally {
      checking = false
    }
  }

  const timer = setInterval(() => void check(), CHECK_INTERVAL_MS)
  // Never hold the process open during shutdown.
  timer.unref()
  globals[MONITOR] = timer
}
