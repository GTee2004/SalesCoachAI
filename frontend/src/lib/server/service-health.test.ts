import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import type { AddressInfo, Socket } from 'node:net'
import { test } from 'node:test'

type Mode = 'silent' | 'handshake' | 'healthy'

function message(type: string, body: Buffer) {
  const header = Buffer.alloc(5)
  header.write(type)
  header.writeInt32BE(body.length + 4, 1)
  return Buffer.concat([header, body])
}
const AUTHENTICATION_OK = message('R', Buffer.alloc(4))
const READY_FOR_QUERY = message('Z', Buffer.from('I'))
const COMMAND_COMPLETE = message('C', Buffer.from('SELECT 1\0'))

// A database that stops answering must cost a probe its own time only. The
// stand-in server speaks just enough of the PostgreSQL protocol to hang at a
// chosen point; no application database or .env credentials are accessed.
test(
  'a database probe that times out gives its connection back',
  { timeout: 40_000 },
  async (t) => {
    const modes: Mode[] = []
    const open = new Set<Socket>()
    const server = createServer((socket) => {
      const mode = modes.shift() ?? 'healthy'
      let started = false
      open.add(socket)
      socket.on('close', () => open.delete(socket))
      socket.on('error', () => {})
      socket.on('data', (chunk) => {
        if (mode === 'silent') return
        if (!started) {
          started = true
          socket.write(Buffer.concat([AUTHENTICATION_OK, READY_FOR_QUERY]))
        } else if (mode === 'healthy' && chunk[0] === 0x51) {
          socket.write(Buffer.concat([COMMAND_COMPLETE, READY_FOR_QUERY]))
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const previous = { ...process.env }
    Object.assign(process.env, {
      DATABASE_URL: `postgresql://probe@127.0.0.1:${port}/probe`,
      BETTER_AUTH_URL: 'http://localhost:4500',
      BETTER_AUTH_SECRET: 'test',
      SMTP_USER: 'test@example.com',
      SMTP_PASSWORD: 'test',
      // Nothing listens there: the voice probes fail at once.
      VOICE_BACKEND_INTERNAL_URL: 'http://127.0.0.1:1',
      VOICE_BACKEND_PUBLIC_URL: 'http://127.0.0.1:1',
      VOICE_CONTROL_API_KEY: 'k'.repeat(32),
      VOICE_TOKEN_SECRET: 'k'.repeat(32),
      VOICE_EVENT_INGEST_KEY: 'k'.repeat(32),
    })
    const { db } = await import('#/db')
    const { checkServices } = await import('./service-health')
    const pool = db.$client
    pool.on('error', () => {})
    t.after(async () => {
      // Sockets first: a connection that still hangs would keep the pool from
      // ending, and the failure would show up as a stuck test run.
      for (const socket of open) socket.destroy()
      server.close()
      await pool.end()
      for (const key of Object.keys(process.env))
        if (!(key in previous)) delete process.env[key]
      Object.assign(process.env, previous)
    })
    const database = async () =>
      (await checkServices()).services.find(
        (service) => service.key === 'database',
      )
    const counts = () => ({
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      open: open.size,
    })

    // Two connections never finish the handshake, two accept the query and
    // never answer it.
    modes.push('silent', 'handshake', 'silent', 'handshake')
    const hung = await Promise.all([
      database(),
      database(),
      database(),
      database(),
    ])
    assert.deepEqual(
      hung.map((check) => check?.state),
      ['down', 'down', 'down', 'down'],
    )
    // The server sees the sockets close a moment after the client drops them.
    for (let attempt = 0; open.size > 0 && attempt < 50; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(counts(), { total: 0, idle: 0, waiting: 0, open: 0 })

    // The pool is usable again as soon as the database answers.
    const healthy = await database()
    assert.equal(healthy?.state, 'up')
    assert.equal(typeof healthy.latencyMs, 'number')
    assert.deepEqual(counts(), { total: 1, idle: 1, waiting: 0, open: 1 })
  },
)
