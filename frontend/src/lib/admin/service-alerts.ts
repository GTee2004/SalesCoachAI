import type { ServiceCheck, ServiceKey } from './contracts'

/** The web app cannot report its own outage, so it is not in this list. */
export type AlertedService = Exclude<ServiceKey, 'web'>

export interface AlertNotice {
  service: AlertedService
  kind: 'down' | 'recovered'
  /** ISO time of the check that first raised it; later retries keep it. */
  since: string
}

export interface AlertState {
  failures: Record<AlertedService, number>
  /** Outages the admins were told about; each is owed a recovery email. */
  notified: Record<AlertedService, boolean>
  /** Notices raised but not yet delivered. */
  pending: Record<AlertedService, AlertNotice | null>
}

// Consecutive failed checks before an email goes out.
export const FAILURE_THRESHOLD: Record<AlertedService, number> = {
  database: 3,
  voice: 3,
}

export function initialAlertState(): AlertState {
  return {
    failures: { database: 0, voice: 0 },
    notified: { database: false, voice: false },
    pending: { database: null, voice: null },
  }
}

/**
 * One email when a service goes down and one when it is back, never per check.
 * A notice is raised again on every check until `acknowledgeNotice` confirms
 * its delivery, so an email that could not be sent is not lost. An outage that
 * ends before its email was delivered is dropped along with its recovery.
 */
export function evaluateAlerts(
  state: AlertState,
  services: ServiceCheck[],
  checkedAt: string,
): { state: AlertState; notices: AlertNotice[] } {
  const next: AlertState = {
    failures: { ...state.failures },
    notified: { ...state.notified },
    pending: { ...state.pending },
  }
  const notices: AlertNotice[] = []
  for (const check of services) {
    if (check.key === 'web' || check.state === 'unknown') continue
    const service = check.key
    let owed: AlertNotice['kind'] | null
    if (check.state === 'up') {
      next.failures[service] = 0
      owed = next.notified[service] ? 'recovered' : null
    } else {
      next.failures[service] += 1
      owed =
        !next.notified[service] &&
        next.failures[service] >= FAILURE_THRESHOLD[service]
          ? 'down'
          : null
    }
    const raised = state.pending[service]
    const notice = !owed
      ? null
      : raised?.kind === owed
        ? raised
        : { service, kind: owed, since: checkedAt }
    next.pending[service] = notice
    if (notice) notices.push(notice)
  }
  return { state: next, notices }
}

/** Records that `notice` reached the admins. */
export function acknowledgeNotice(
  state: AlertState,
  notice: AlertNotice,
): AlertState {
  return {
    failures: state.failures,
    notified: { ...state.notified, [notice.service]: notice.kind === 'down' },
    pending: { ...state.pending, [notice.service]: null },
  }
}

/**
 * Evaluates one round of checks and hands every owed notice to `deliver`,
 * which resolves to whether the notice reached anyone.
 */
export async function processAlerts(
  state: AlertState,
  services: ServiceCheck[],
  checkedAt: string,
  deliver: (notice: AlertNotice) => Promise<boolean>,
): Promise<AlertState> {
  const result = evaluateAlerts(state, services, checkedAt)
  let next = result.state
  for (const notice of result.notices) {
    if (await deliver(notice)) next = acknowledgeNotice(next, notice)
  }
  return next
}
