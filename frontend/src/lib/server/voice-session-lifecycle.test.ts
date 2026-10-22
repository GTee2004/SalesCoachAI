import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { VoiceEvent } from '#/lib/voice/contracts'

// An isolated PostgreSQL cluster exercises the real row/advisory locks and
// JSONB writes. No application database or .env credentials are accessed.
test(
  'persisted voice leases and End/reconnect races in PostgreSQL',
  { timeout: 30_000 },
  async (t) => {
    let postgresBin: string
    try {
      postgresBin = execFileSync('pg_config', ['--bindir'], {
        encoding: 'utf8',
      }).trim()
      // Client-only packages ship pg_config without the server binaries.
      accessSync(join(postgresBin, 'initdb'), constants.X_OK)
    } catch {
      t.skip('PostgreSQL binaries are required for this integration test')
      return
    }
    const root = mkdtempSync(join(tmpdir(), 'voice-lease-'))
    const data = join(root, 'data')
    let started = false
    const previousUrl = process.env.DATABASE_URL
    const resources: { pool?: { end: () => Promise<void> } } = {}
    t.after(async () => {
      await resources.pool?.end()
      if (previousUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousUrl
      if (started)
        execFileSync(
          join(postgresBin, 'pg_ctl'),
          ['-D', data, '-m', 'immediate', '-w', 'stop'],
          { stdio: 'pipe' },
        )
      rmSync(root, { recursive: true, force: true })
    })
    execFileSync(
      join(postgresBin, 'initdb'),
      ['-D', data, '-A', 'trust', '-U', 'voice_test', '--no-locale'],
      { stdio: 'pipe' },
    )
    execFileSync(
      join(postgresBin, 'pg_ctl'),
      [
        '-D',
        data,
        '-l',
        join(root, 'postgres.log'),
        '-o',
        `-F -k ${root} -h ''`,
        '-w',
        'start',
      ],
      { stdio: 'pipe' },
    )
    started = true
    process.env.DATABASE_URL = `postgresql://voice_test@localhost/postgres?host=${encodeURIComponent(root)}`
    const { db } = await import('#/db')
    resources.pool = db.$client
    const { persistConnectionEvent, reconcileVoiceSessions } =
      await import('./voice-session-lifecycle')
    await db.$client.query(`create table practice_sessions (
    id uuid primary key, user_id text, workspace_id text, practice_id uuid,
    status text not null, end_reason text, runtime_metadata jsonb,
    started_at timestamptz, completed_at timestamptz, deleted_at timestamptz,
    created_at timestamptz default now()
  )`)
    const id = crypto.randomUUID()
    const attemptId = crypto.randomUUID()
    const lease = {
      attemptId,
      status: 'connecting',
      sequence: 0,
      reconnectSeconds: 60,
      leaseUntil: new Date(Date.now() + 120_000).toISOString(),
    }
    await db.$client.query(
      'insert into practice_sessions (id, status, runtime_metadata) values ($1, $2, $3)',
      [
        id,
        'in_progress',
        JSON.stringify({ ttsProvider: 'gemini', voiceConnection: lease }),
      ],
    )
    const event = (
      payload: VoiceEvent['payload'],
      override: Partial<VoiceEvent> = {},
    ): VoiceEvent => ({
      schemaVersion: 1,
      eventId: crypto.randomUUID(),
      sessionId: id,
      attemptId,
      sequence: 1,
      type: 'session.state',
      occurredAt: new Date().toISOString(),
      payload,
      ...override,
    })
    const read = async () =>
      (
        await db.$client.query('select * from practice_sessions where id=$1', [
          id,
        ])
      ).rows[0]

    await t.test(
      'End holds its advisory lock while event ingestion completes without waiting for it',
      async () => {
        const client = await db.$client.connect()
        try {
          await client.query(
            'select pg_advisory_lock(hashtextextended($1, 0))',
            [id],
          )
          await persistConnectionEvent(
            event({ status: 'ended', reason: 'user_ended' }),
          )
          await db.$client.query(
            `update practice_sessions set runtime_metadata = jsonb_set(runtime_metadata, '{voiceConnection,leaseUntil}', to_jsonb($2::text)) where id=$1`,
            [id, new Date(Date.now() - 180_000).toISOString()],
          )
          await reconcileVoiceSessions(id)
          assert.equal((await read()).status, 'in_progress')
        } finally {
          await client.query(
            'select pg_advisory_unlock(hashtextextended($1, 0))',
            [id],
          )
          client.release()
        }
      },
    )
    await t.test(
      'restart or lost terminal event reconciles an expired persisted lease without feedback',
      async () => {
        await reconcileVoiceSessions(id)
        const current = await read()
        assert.equal(current.status, 'abandoned')
        assert.equal(current.end_reason, 'technical_error')
        assert.equal(current.runtime_metadata.ttsProvider, 'gemini')
        assert.ok(current.completed_at)
      },
    )
    await t.test(
      'a new attempt survives old terminal events and renewals',
      async () => {
        const newAttemptId = crypto.randomUUID()
        await db.$client.query(
          'update practice_sessions set status=$2, runtime_metadata=$3 where id=$1',
          [
            id,
            'in_progress',
            JSON.stringify({
              voiceConnection: { ...lease, attemptId: newAttemptId },
            }),
          ],
        )
        await persistConnectionEvent(
          event({ status: 'failed', reason: 'client_disconnected' }),
        )
        await persistConnectionEvent(
          event(
            { leaseUntil: new Date(Date.now() - 100_000).toISOString() },
            { type: 'session.lease', sequence: 20 },
          ),
        )
        await reconcileVoiceSessions(id)
        assert.equal(
          (await read()).runtime_metadata.voiceConnection.status,
          'connecting',
        )
        await persistConnectionEvent(
          event(
            { status: 'ended', reason: 'client_disconnected' },
            { attemptId: newAttemptId },
          ),
        )
        await reconcileVoiceSessions(id)
        assert.equal((await read()).status, 'in_progress')
        assert.equal(
          (await read()).runtime_metadata.voiceConnection.status,
          'interrupted',
        )
      },
    )
    await t.test(
      'a healthy backend peer survives stale persistence after ingestion failure',
      async () => {
        await db.$client.query(
          'update practice_sessions set status=$2, runtime_metadata=$3 where id=$1',
          [
            id,
            'in_progress',
            JSON.stringify({
              voiceConnection: {
                ...lease,
                leaseUntil: new Date(Date.now() - 180_000).toISOString(),
              },
            }),
          ],
        )
        await reconcileVoiceSessions(id, async () => ({
          status: 'active',
          attemptId,
          activityLeaseUntil: new Date(Date.now() + 40_000).toISOString(),
        }))
        const current = await read()
        assert.equal(current.status, 'in_progress')
        assert.equal(
          current.runtime_metadata.voiceConnection.status,
          'connected',
        )
      },
    )
    await t.test(
      'completed practice sessions cannot be changed by delayed worker events',
      async () => {
        await db.$client.query(
          'update practice_sessions set status=$2 where id=$1',
          [id, 'completed'],
        )
        await persistConnectionEvent(
          event(
            { status: 'failed', reason: 'heartbeat_timeout' },
            {
              attemptId: (await read()).runtime_metadata.voiceConnection
                .attemptId,
              sequence: 99,
            },
          ),
        )
        await reconcileVoiceSessions(id)
        assert.equal((await read()).status, 'completed')
      },
    )
    await t.test(
      'deleted sessions discard events and are excluded from reconciliation',
      async () => {
        await db.$client.query(
          'update practice_sessions set status=$2, deleted_at=now(), runtime_metadata=$3 where id=$1',
          [
            id,
            'in_progress',
            JSON.stringify({
              voiceConnection: {
                ...lease,
                leaseUntil: new Date(Date.now() - 180_000).toISOString(),
              },
            }),
          ],
        )
        const before = await read()
        assert.equal(
          await persistConnectionEvent(
            event({ status: 'failed', reason: 'heartbeat_timeout' }),
          ),
          'deleted',
        )
        let lookups = 0
        await reconcileVoiceSessions(id, async () => {
          lookups += 1
          return null
        })
        assert.equal(lookups, 0)
        assert.deepEqual(await read(), before)
      },
    )
    await t.test(
      'events recheck deletion after waiting for the session row lock',
      async () => {
        await db.$client.query(
          'update practice_sessions set deleted_at=null where id=$1',
          [id],
        )
        const client = await db.$client.connect()
        try {
          await client.query('begin')
          await client.query(
            'update practice_sessions set deleted_at=now() where id=$1',
            [id],
          )
          const ingestion = persistConnectionEvent(
            event({ status: 'failed', reason: 'heartbeat_timeout' }),
          )
          await client.query('commit')
          const before = await read()
          assert.equal(await ingestion, 'deleted')
          assert.deepEqual(await read(), before)
        } finally {
          await client.query('rollback')
          client.release()
        }
      },
    )
    await t.test(
      'reconciliation rechecks deletion after the backend lookup',
      async () => {
        await db.$client.query(
          'update practice_sessions set deleted_at=null where id=$1',
          [id],
        )
        const before = await read()
        let lookups = 0
        await reconcileVoiceSessions(id, async () => {
          lookups += 1
          await db.$client.query(
            'update practice_sessions set deleted_at=now() where id=$1',
            [id],
          )
          return null
        })
        const current = await read()
        assert.equal(lookups, 1)
        assert.ok(current.deleted_at)
        assert.equal(current.status, before.status)
        assert.deepEqual(current.runtime_metadata, before.runtime_metadata)
        assert.equal(current.end_reason, before.end_reason)
        assert.deepEqual(current.completed_at, before.completed_at)
      },
    )
    await t.test(
      'unknown sessions do not persist connection events',
      async () => {
        assert.equal(
          await persistConnectionEvent(
            event(
              { status: 'failed', reason: 'heartbeat_timeout' },
              { sessionId: crypto.randomUUID() },
            ),
          ),
          'missing',
        )
      },
    )
  },
)
