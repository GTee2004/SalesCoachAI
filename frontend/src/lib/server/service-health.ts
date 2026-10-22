import type { QueryConfig } from 'pg'
import { db } from '#/db'
import { env } from '#/env'
import type { ServiceCheck, ServiceHealth } from '#/lib/admin/contracts'
import { getVoiceBackendStatus } from './voice-backend'

const PROBE_TIMEOUT_MS = 3_000
// The pool drops idle connections after 10 s, so most probes pay for a new
// TLS connection; against a managed database in another region that alone
// takes 3-4 s.
const DATABASE_PROBE_TIMEOUT_MS = 10_000

async function timed<T>(probe: () => Promise<T>) {
  const started = performance.now()
  const value = await probe()
  return { value, latencyMs: Math.round(performance.now() - started) }
}

async function probeDatabase(): Promise<ServiceCheck> {
  const deadline = performance.now() + DATABASE_PROBE_TIMEOUT_MS
  try {
    const { latencyMs } = await timed(async () => {
      // Both waits end by themselves: the pool gives up on a connection after
      // its connect timeout, and a query that outlives `query_timeout` has its
      // connection destroyed. Racing a timer against them would answer in time
      // but leave the operation holding a slot of the shared pool.
      const client = await db.$client.connect()
      // pg honours a per-query `query_timeout`; its types only declare the
      // client-wide option.
      const query: QueryConfig & { query_timeout: number } = {
        text: 'select 1',
        query_timeout: Math.max(1, Math.round(deadline - performance.now())),
      }
      try {
        await client.query(query)
      } catch (error) {
        // Never hand a connection with an unfinished query back to the pool.
        client.release(true)
        throw error
      }
      client.release()
    })
    return { key: 'database', state: 'up', latencyMs }
  } catch {
    return { key: 'database', state: 'down', latencyMs: null }
  }
}

async function probeVoice(): Promise<ServiceCheck> {
  const base = env.VOICE_BACKEND_INTERNAL_URL.replace(/\/$/, '')
  try {
    const { value, latencyMs } = await timed(() =>
      fetch(`${base}/health/live`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }),
    )
    if (value.ok) return { key: 'voice', state: 'up', latencyMs }
  } catch {
    // Unreachable or timed out: reported as down below.
  }
  return { key: 'voice', state: 'down', latencyMs: null }
}

export async function checkServices(): Promise<ServiceHealth> {
  const [database, voice, status] = await Promise.all([
    probeDatabase(),
    probeVoice(),
    getVoiceBackendStatus(PROBE_TIMEOUT_MS).catch(() => null),
  ])
  return {
    checkedAt: new Date().toISOString(),
    webUptimeSeconds: Math.round(process.uptime()),
    services: [{ key: 'web', state: 'up', latencyMs: null }, database, voice],
    voiceSessions: status
      ? {
          active: status.activeSessions,
          capacity: status.maxConcurrentSessions,
        }
      : null,
  }
}
