import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// The dashboard numbers depend on PostgreSQL time zone and aggregate
// semantics, so they run against an isolated cluster. No application database
// or .env credentials are accessed.
test('admin dashboard reads in PostgreSQL', { timeout: 30_000 }, async (t) => {
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
  const root = mkdtempSync(join(tmpdir(), 'admin-metrics-'))
  const data = join(root, 'data')
  let started = false
  const overrides = {
    DATABASE_URL: `postgresql://admin_test@localhost/postgres?host=${encodeURIComponent(root)}`,
    NODE_ENV: 'development',
    BETTER_AUTH_URL: 'http://localhost:4500',
    BETTER_AUTH_SECRET: 'isolated-test',
    SMTP_USER: 'isolated-test',
    SMTP_PASSWORD: 'isolated-test',
    VOICE_BACKEND_INTERNAL_URL: 'http://127.0.0.1:1',
    VOICE_BACKEND_PUBLIC_URL: 'http://127.0.0.1:1',
    VOICE_CONTROL_API_KEY: 'isolated-test-key'.repeat(3),
    VOICE_TOKEN_SECRET: 'isolated-test-key'.repeat(3),
    VOICE_EVENT_INGEST_KEY: 'isolated-test-key'.repeat(3),
    SERVICE_ALERT_EMAILS: 'off',
  }
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  )
  const resources: { pool?: { end: () => Promise<void> } } = {}
  t.after(async () => {
    await resources.pool?.end()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
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
    ['-D', data, '-A', 'trust', '-U', 'admin_test', '--no-locale'],
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
  Object.assign(process.env, overrides)
  const { db } = await import('#/db')
  resources.pool = db.$client
  const {
    getAdminServiceCosts,
    getAdminUsage,
    getAdminVoiceLatency,
    getSessionTranscript,
    listAdminEmails,
    listRecentSessions,
  } = await import('./admin-metrics')
  const { withSessionOperation } = await import('./practice-sessions')
  const { recordUserActivity } = await import('./user-activity')
  const { recordServiceUsage } = await import('./service-usage')

  await db.$client.query(`
      create table "user" (
        id text primary key, name text not null, email text not null,
        email_verified boolean not null, roles varchar(255)[] not null
      );
      create table practices (id uuid primary key, title text not null, type text not null);
      create table practice_sessions (
        id uuid primary key, user_id text not null, workspace_id text, practice_id uuid not null,
        status text not null, end_reason text, runtime_metadata jsonb,
        started_at timestamptz, completed_at timestamptz, deleted_at timestamptz,
        created_at timestamptz not null
      );
      create table practice_session_evaluations (
        session_id uuid primary key, overall_score integer,
        created_at timestamptz not null default now()
      );
      create table practice_session_turns (
        id uuid primary key default gen_random_uuid(), session_id uuid not null,
        sequence integer not null, speaker text not null, text text not null,
        metadata jsonb, created_at timestamptz not null default now()
      );
      create table user_activity_days (
        user_id text not null, activity_date date not null,
        primary key (user_id, activity_date)
      );
      create table service_usage (
        id uuid primary key default gen_random_uuid(), session_id uuid not null,
        usage_key uuid not null, source varchar(16) not null, service varchar(8) not null,
        provider varchar(64) not null, model varchar(128) not null,
        audio_ms bigint not null default 0, characters bigint not null default 0,
        input_tokens bigint not null default 0, cached_input_tokens bigint not null default 0,
        output_tokens bigint not null default 0, recorded_at timestamptz not null default now(),
        unique (usage_key, service, provider, model)
      );
    `)

  const hung = '00000000-0000-4000-8000-0000000000b1'
  const lan = '00000000-0000-4000-8000-0000000000b2'
  const session = (index: number) =>
    `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
  // "Now" is noon on 6 October in Vietnam. Sessions 1 and 2 sit on either
  // side of the Vietnamese midnight, 10 and 11 on either side of the period.
  await db.$client.query(`
      insert into "user" (id, name, email, email_verified, roles) values
        ('u1', 'minhanh.sale', 'u1@example.com', true, '{member}'),
        ('u2', 'quocbao92', 'u2@example.com', true, '{member}'),
        ('u3', 'nam.admin', 'admin@example.com', true, '{member,admin}'),
        ('u4', 'pending.admin', 'pending@example.com', false, '{admin}');
      insert into practices (id, title, type) values
        ('${hung}', 'Gọi lần đầu · Anh Hùng', 'cold_call'),
        ('${lan}', 'Gọi lại lần 2 · Chị Lan', 'warm_call');
      insert into practice_sessions
        (id, user_id, practice_id, status, end_reason, runtime_metadata, started_at, completed_at, created_at) values
        ('${session(1)}', 'u1', '${hung}', 'completed', 'learner_ended', null, '2026-10-05T17:30:00Z', '2026-10-05T17:38:31Z', '2026-10-05T17:29:00Z'),
        ('${session(2)}', 'u1', '${hung}', 'completed', 'learner_ended', '{"ttsProvider":"zerotts"}', '2026-10-05T16:30:00Z', '2026-10-05T16:40:00Z', '2026-10-05T16:29:00Z'),
        ('${session(3)}', 'u2', '${lan}', 'abandoned', 'technical_error', null, '2026-10-05T03:00:00Z', '2026-10-05T03:02:00Z', '2026-10-05T02:59:00Z'),
        ('${session(4)}', 'u2', '${lan}', 'abandoned', null, null, '2026-10-04T03:00:00Z', null, '2026-10-04T02:59:00Z'),
        ('${session(5)}', 'u2', '${hung}', 'in_progress', null, null, '2026-10-06T04:55:00Z', null, '2026-10-06T04:54:00Z'),
        ('${session(6)}', 'u1', '${lan}', 'completed', 'learner_ended', '{"evaluationError":"evaluation_failed"}', '2026-10-06T02:00:00Z', '2026-10-06T02:10:00Z', '2026-10-06T01:59:00Z'),
        ('${session(7)}', 'u2', '${hung}', 'created', null, null, null, null, '2026-10-06T01:00:00Z'),
        ('${session(8)}', 'u1', '${hung}', 'completed', 'learner_ended', null, '2026-09-25T03:00:00Z', '2026-09-25T03:09:00Z', '2026-09-25T02:59:00Z'),
        ('${session(9)}', 'u1', '${hung}', 'completed', 'learner_ended', null, '2026-09-20T03:00:00Z', '2026-09-20T03:09:00Z', '2026-09-20T02:59:00Z'),
        ('${session(10)}', 'u2', '${hung}', 'completed', null, null, '2026-09-29T17:00:00Z', '2026-09-29T17:05:00Z', '2026-09-29T17:00:00Z'),
        ('${session(11)}', 'u2', '${hung}', 'abandoned', null, null, '2026-09-29T16:59:59Z', null, '2026-09-29T16:59:00Z');
      insert into practice_session_evaluations (session_id, overall_score) values
        ('${session(1)}', 74), ('${session(2)}', 60), ('${session(8)}', 50);
      insert into practice_session_turns (session_id, sequence, speaker, text, metadata) values
        ('${session(1)}', 2, 'salesperson', 'Dạ em chào anh Hùng', '{"interrupted":true}'),
        ('${session(1)}', 1, 'buyer', 'Alo, ai đấy ạ?', '{"interrupted":false}'),
        ('${session(2)}', 2, 'buyer', 'Em cứ nói', '{"interrupted":false,"latency":{"totalMs":900,"stages":{"endpointing_wait":200,"transcription":100,"llm_inference":400,"speech_synthesis":150}}}'),
        ('${session(2)}', 4, 'buyer', 'Thế giá bao nhiêu', '{"interrupted":true,"latency":{"totalMs":2500,"stages":{"transcription":200,"llm_inference":2000,"speech_synthesis":300}}}'),
        ('${session(2)}', 6, 'buyer', 'Chào em', '{"interrupted":false}'),
        ('${session(6)}', 2, 'buyer', 'Ừ', '{"latency":{"totalMs":1100,"stages":{"llm_inference":800,"speech_synthesis":300}}}'),
        ('${session(8)}', 2, 'buyer', 'Không cần đâu', '{"latency":{"totalMs":3000,"stages":{"llm_inference":3000}}}');
      insert into user_activity_days (user_id, activity_date) values
        ('u3', '2026-10-06'), ('u3', '2026-10-05'), ('u1', '2026-10-06'), ('u3', '2026-09-24');
    `)

  await t.test(
    'usage buckets days in Vietnam time and counts every started call',
    async () => {
      const usage = await getAdminUsage(
        { days: 7 },
        new Date('2026-10-06T05:00:00Z'),
      )
      assert.deepEqual(
        usage.series.map((day) => [
          day.date,
          day.activeUsers,
          day.calls,
          day.completed,
          day.incomplete,
          day.technicalErrors,
        ]),
        [
          ['2026-09-30', 1, 1, 1, 0, 0],
          ['2026-10-01', 0, 0, 0, 0, 0],
          ['2026-10-02', 0, 0, 0, 0, 0],
          ['2026-10-03', 0, 0, 0, 0, 0],
          ['2026-10-04', 1, 1, 0, 1, 0],
          ['2026-10-05', 3, 2, 1, 0, 1],
          ['2026-10-06', 3, 3, 2, 1, 0],
        ],
      )
      assert.deepEqual(usage.current, {
        activeUsers: 3,
        calls: 7,
        completed: 4,
        technicalErrors: 1,
        evaluated: 2,
        averageScore: 67,
      })
      assert.deepEqual(usage.previous, {
        activeUsers: 3,
        calls: 2,
        completed: 1,
        technicalErrors: 0,
        evaluated: 1,
        averageScore: 50,
      })
      assert.deepEqual(
        Object.fromEntries(
          usage.outcomes.map((item) => [item.key, item.count]),
        ),
        {
          learner_ended: 3,
          completed: 1,
          technical_error: 1,
          abandoned: 1,
          in_progress: 1,
        },
      )
      assert.deepEqual(
        usage.topPractices.map((practice) => [
          practice.title,
          practice.calls,
          practice.completed,
          practice.averageScore,
        ]),
        [
          ['Gọi lần đầu · Anh Hùng', 4, 3, 67],
          ['Gọi lại lần 2 · Chị Lan', 3, 1, null],
        ],
      )
    },
  )

  await t.test(
    'costs count on the day their call started and record once',
    async () => {
      const attempt = '00000000-0000-4000-8000-0000000000c1'
      const call = {
        sessionId: session(2),
        usageKey: attempt,
        source: 'conversation' as const,
        items: [
          {
            service: 'stt' as const,
            provider: 'soniox',
            model: 'stt-rt-v5',
            audioSeconds: 1800,
          },
          {
            service: 'tts' as const,
            provider: 'elevenlabs',
            model: 'eleven_v4_turbo',
            characters: 50_000,
          },
        ],
      }
      // A redelivered usage event changes nothing.
      await recordServiceUsage(call)
      await recordServiceUsage(call)
      await recordServiceUsage({
        sessionId: session(2),
        usageKey: '00000000-0000-4000-8000-0000000000c2',
        source: 'evaluation',
        items: [
          {
            service: 'llm',
            provider: 'openrouter',
            model: 'openai/gpt-6-luna',
            inputTokens: 1_000_000,
            cachedInputTokens: 0,
            outputTokens: 1_000_000,
          },
        ],
      })
      await recordServiceUsage({
        sessionId: session(8),
        usageKey: '00000000-0000-4000-8000-0000000000c3',
        source: 'conversation',
        items: [
          {
            service: 'tts',
            provider: 'elevenlabs',
            model: 'eleven_v4_turbo',
            characters: 25_000,
          },
        ],
      })
      // A purged session keeps the day its usage was recorded.
      await db.$client.query(`
        insert into service_usage
          (session_id, usage_key, source, service, provider, model, characters, recorded_at) values
          ('${session(99)}', '00000000-0000-4000-8000-0000000000c4', 'conversation', 'tts',
           'elevenlabs', 'eleven_v4_turbo', 10000, '2026-10-06T03:00:00Z')
      `)

      const costs = await getAdminServiceCosts(
        { days: 7 },
        new Date('2026-10-06T05:00:00Z'),
      )
      const round = (value: number | null) =>
        value == null ? null : Math.round(value * 1e6) / 1e6
      assert.deepEqual(
        costs.series
          .filter((day) => day.total)
          .map((day) => [day.date, round(day.total), round(day.evaluation)]),
        [
          // Session 2 started at 23:30 on 5 October in Vietnam.
          ['2026-10-05', 2.66, 0.6],
          ['2026-10-06', 0.4, 0],
        ],
      )
      assert.equal(round(costs.current.totalUsd), 3.06)
      assert.equal(costs.current.calls, 7)
      assert.equal(costs.current.callMinutes, 30)
      assert.equal(round(costs.current.perMinuteUsd), 0.102)
      assert.equal(round(costs.previous.totalUsd), 1)
      assert.equal(costs.previous.calls, 2)
      assert.deepEqual(
        costs.lines.map((line) => [
          line.source,
          line.service,
          round(line.costUsd),
        ]),
        [
          ['conversation', 'tts', 2.4],
          ['evaluation', 'llm', 0.6],
          ['conversation', 'stt', 0.06],
        ],
      )
    },
  )

  await t.test(
    'a picked period in the past is compared with the one before it',
    async () => {
      // The week the test above uses as its comparison.
      const usage = await getAdminUsage(
        { from: '2026-09-23', to: '2026-09-29' },
        new Date('2026-10-06T05:00:00Z'),
      )
      assert.equal(usage.today, '2026-10-06')
      assert.deepEqual(usage.period, { from: '2026-09-23', to: '2026-09-29' })
      assert.deepEqual(usage.previousPeriod, {
        from: '2026-09-16',
        to: '2026-09-22',
      })
      assert.equal(usage.granularity, 'day')
      assert.deepEqual(
        usage.series.map((day) => [day.date, day.activeUsers, day.calls]),
        [
          ['2026-09-23', 0, 0],
          ['2026-09-24', 1, 0],
          ['2026-09-25', 1, 1],
          ['2026-09-26', 0, 0],
          ['2026-09-27', 0, 0],
          ['2026-09-28', 0, 0],
          ['2026-09-29', 1, 1],
        ],
      )
      assert.deepEqual(usage.current, {
        activeUsers: 3,
        calls: 2,
        completed: 1,
        technicalErrors: 0,
        evaluated: 1,
        averageScore: 50,
      })
      assert.deepEqual(usage.previous, {
        activeUsers: 1,
        calls: 1,
        completed: 1,
        technicalErrors: 0,
        evaluated: 0,
        averageScore: null,
      })
      assert.deepEqual(
        Object.fromEntries(
          usage.outcomes.map((item) => [item.key, item.count]),
        ),
        { learner_ended: 1, abandoned: 1 },
      )
    },
  )

  await t.test(
    'a long period counts each user once per week or month',
    async () => {
      const now = new Date('2026-10-06T05:00:00Z')
      // 1 July to 6 October: 98 days, charted by week from Monday.
      const weekly = await getAdminUsage(
        { from: '2026-07-01', to: '2026-10-06' },
        now,
      )
      assert.equal(weekly.granularity, 'week')
      assert.deepEqual(
        weekly.series
          .filter((week) => week.calls || week.activeUsers)
          .map((week) => [
            week.date,
            week.endDate,
            week.activeUsers,
            week.calls,
          ]),
        [
          ['2026-09-14', '2026-09-20', 1, 1],
          ['2026-09-21', '2026-09-27', 2, 1],
          // One learner made all three calls of this week.
          ['2026-09-28', '2026-10-04', 1, 3],
          ['2026-10-05', '2026-10-06', 3, 5],
        ],
      )

      // Two years, charted by month. u1 visits on many days of each month
      // and still counts once.
      const monthly = await getAdminUsage(
        { from: '2024-10-07', to: '2026-10-06' },
        now,
      )
      assert.equal(monthly.granularity, 'month')
      assert.equal(monthly.series.length, 25)
      assert.deepEqual(
        monthly.series
          .filter((month) => month.calls || month.activeUsers)
          .map((month) => [
            month.date,
            month.endDate,
            month.activeUsers,
            month.calls,
          ]),
        [
          ['2026-09-01', '2026-09-30', 3, 4],
          ['2026-10-01', '2026-10-06', 3, 6],
        ],
      )
      assert.equal(monthly.current.calls, 10)
      assert.equal(monthly.current.activeUsers, 3)
      assert.equal(monthly.previous.calls, 0)
    },
  )

  await t.test(
    'recent sessions skip calls that never started and report scoring state',
    async () => {
      const recent = await listRecentSessions()
      assert.equal(recent.length, 10)
      assert.deepEqual(
        recent
          .slice(0, 5)
          .map((item) => [
            item.id,
            item.learnerName,
            item.outcome,
            item.evaluation,
            item.overallScore,
          ]),
        [
          [session(5), 'quocbao92', 'in_progress', 'none', null],
          [session(6), 'minhanh.sale', 'learner_ended', 'failed', null],
          [session(1), 'minhanh.sale', 'learner_ended', 'scored', 74],
          [session(2), 'minhanh.sale', 'learner_ended', 'scored', 60],
          [session(3), 'quocbao92', 'technical_error', 'none', null],
        ],
      )
      assert.equal(recent[2].durationSeconds, 511)
    },
  )

  await t.test('only a running call lasts until now', async (clock) => {
    clock.mock.timers.enable({
      apis: ['Date'],
      now: new Date('2026-10-06T05:00:00Z'),
    })
    const durations = async () => {
      const recent = await listRecentSessions()
      return [session(5), session(3), session(4)].map(
        (id) => recent.find((item) => item.id === id)?.durationSeconds,
      )
    }
    // In progress, ended by the lease reconciler, abandoned before the end
    // time was stored.
    assert.deepEqual(await durations(), [300, 120, null])
    clock.mock.timers.tick(60_000)
    assert.deepEqual(await durations(), [360, 120, null])
  })

  await t.test(
    'an evaluation is pending only while End is working on the session',
    async () => {
      const evaluations = async () => {
        const recent = await listRecentSessions()
        return [session(10), session(9)].map(
          (id) => recent.find((item) => item.id === id)?.evaluation,
        )
      }
      // Both completed without a result or a recorded error: the process
      // stopped before the evaluation finished.
      assert.deepEqual(await evaluations(), ['failed', 'failed'])
      await withSessionOperation(session(10), async () => {
        assert.deepEqual(await evaluations(), ['pending', 'failed'])
      })
      assert.deepEqual(await evaluations(), ['failed', 'failed'])
    },
  )

  await t.test(
    'reply latency percentiles come from the buyer turns of each period',
    async () => {
      const latency = await getAdminVoiceLatency(
        { days: 7 },
        new Date('2026-10-06T05:00:00Z'),
      )
      // Five buyer replies in the period, three of them measured: 900, 2500
      // and 1100 ms. The opener and an unmeasured reply count only toward
      // interruptions.
      assert.deepEqual(latency.current, {
        replies: 3,
        p50Ms: 1100,
        p95Ms: 2360,
        slowPercent: (1 / 3) * 100,
        interruptedPercent: 20,
      })
      assert.deepEqual(latency.previous, {
        replies: 1,
        p50Ms: 3000,
        p95Ms: 3000,
        slowPercent: 100,
        interruptedPercent: 0,
      })
      assert.deepEqual(
        latency.series
          .filter((bucket) => bucket.replies)
          .map((bucket) => [
            bucket.date,
            bucket.replies,
            bucket.p50Ms,
            bucket.p95Ms,
          ]),
        [
          ['2026-10-05', 2, 1700, 2420],
          ['2026-10-06', 1, 1100, 1100],
        ],
      )
      assert.equal(latency.series.length, 7)
      assert.deepEqual(latency.stages, [
        { key: 'turn_taking', averageMs: 67, p95Ms: 180 },
        { key: 'stt', averageMs: 100, p95Ms: 190 },
        { key: 'llm', averageMs: 1067, p95Ms: 1880 },
        { key: 'tts', averageMs: 250, p95Ms: 300 },
        { key: 'other', averageMs: 17, p95Ms: 45 },
      ])
      // Session 2's unmeasured reply stays out of zerotts' stage averages.
      assert.deepEqual(latency.providers, [
        {
          provider: 'zerotts',
          replies: 2,
          p50Ms: 1700,
          p95Ms: 2420,
          stages: [
            { key: 'turn_taking', averageMs: 100, p95Ms: 190 },
            { key: 'stt', averageMs: 150, p95Ms: 195 },
            { key: 'llm', averageMs: 1200, p95Ms: 1920 },
            { key: 'tts', averageMs: 225, p95Ms: 293 },
            { key: 'other', averageMs: 25, p95Ms: 48 },
          ],
        },
        {
          provider: 'unknown',
          replies: 1,
          p50Ms: 1100,
          p95Ms: 1100,
          stages: [
            { key: 'turn_taking', averageMs: 0, p95Ms: 0 },
            { key: 'stt', averageMs: 0, p95Ms: 0 },
            { key: 'llm', averageMs: 800, p95Ms: 800 },
            { key: 'tts', averageMs: 300, p95Ms: 300 },
            { key: 'other', averageMs: 0, p95Ms: 0 },
          ],
        },
      ])

      const empty = await getAdminVoiceLatency(
        { from: '2026-01-01', to: '2026-01-07' },
        new Date('2026-10-06T05:00:00Z'),
      )
      assert.deepEqual(empty.current, {
        replies: 0,
        p50Ms: null,
        p95Ms: null,
        slowPercent: null,
        interruptedPercent: null,
      })
      assert.deepEqual(empty.stages, [])
      assert.deepEqual(empty.providers, [])
    },
  )

  await t.test('a transcript comes back in speaking order', async () => {
    const transcript = await getSessionTranscript(session(1))
    assert.deepEqual(
      transcript?.turns.map((turn) => [
        turn.sequence,
        turn.speaker,
        turn.text,
        turn.interrupted,
      ]),
      [
        [1, 'buyer', 'Alo, ai đấy ạ?', false],
        [2, 'salesperson', 'Dạ em chào anh Hùng', true],
      ],
    )
    assert.equal(transcript.traceUrl, null)
    assert.deepEqual(
      (await getSessionTranscript(session(2)))?.turns.map(
        (turn) => turn.latencyMs,
      ),
      [900, 2500, null],
    )
    assert.equal(await getSessionTranscript(session(7)), null)
    assert.equal(await getSessionTranscript(session(99)), null)
  })

  await t.test('only verified admins receive outage emails', async () => {
    assert.deepEqual(await listAdminEmails(), ['admin@example.com'])
  })

  await t.test(
    'a locked recipient table times out without retaining a pool connection',
    { timeout: 10_000 },
    async () => {
      const locker = await db.$client.connect()
      try {
        await locker.query('begin')
        await locker.query('lock table "user" in access exclusive mode')
        const startedAt = performance.now()
        await assert.rejects(listAdminEmails(), /query read timeout/i)
        const elapsed = performance.now() - startedAt
        assert.ok(
          elapsed >= 2_500 && elapsed < 5_000,
          `timeout took ${elapsed} ms`,
        )
        // The table lock is the only checked-out connection. A Promise.race
        // would leave the recipient query using a second slot indefinitely.
        assert.equal(db.$client.totalCount - db.$client.idleCount, 1)
        assert.equal(db.$client.waitingCount, 0)
        assert.equal(
          (await db.$client.query('select 1 as recovered')).rows[0].recovered,
          1,
        )
      } finally {
        await locker.query('rollback')
        locker.release()
      }
      assert.deepEqual(await listAdminEmails(), ['admin@example.com'])
      assert.equal(db.$client.totalCount, db.$client.idleCount)
      assert.equal(db.$client.waitingCount, 0)
    },
  )

  await t.test('admin reads reconcile voice leases', async (clock) => {
    const now = new Date('2026-10-06T05:00:00Z')
    clock.mock.timers.enable({ apis: ['Date'], now })
    const attemptId = '00000000-0000-4000-8000-0000000000c1'
    const liveUntil = new Date(now.getTime() + 120_000).toISOString()
    const backendSessions = new Map<string, object>()
    const lookups: string[] = []
    // Exercise the real backend request/parser without contacting a provider.
    clock.mock.method(
      globalThis,
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        )
        assert.equal(url.origin, overrides.VOICE_BACKEND_INTERNAL_URL)
        assert.equal(init?.method, 'GET')
        assert.equal(
          new Headers(init.headers).get('authorization'),
          `Bearer ${overrides.VOICE_CONTROL_API_KEY}`,
        )
        assert.ok(init.signal instanceof AbortSignal)
        const id = url.pathname.replace('/internal/sessions/', '')
        lookups.push(id)
        const backend = backendSessions.get(id)
        return backend
          ? Response.json(backend)
          : new Response(null, { status: 404 })
      },
    )
    const seed = async (id: string, leaseUntil = '2026-10-06T04:00:00Z') => {
      await db.$client.query(
        `insert into practice_sessions
          (id, user_id, workspace_id, practice_id, status, runtime_metadata, started_at, created_at)
         values ($1, 'u1', 'test-workspace', $2, 'in_progress', $3, $4, $4)`,
        [
          id,
          hung,
          JSON.stringify({
            ttsProvider: 'gemini',
            voiceConnection: {
              attemptId,
              status: 'connected',
              sequence: 1,
              reconnectSeconds: 60,
              leaseUntil,
            },
          }),
          '2026-10-06T03:00:00Z',
        ],
      )
      clock.after(() =>
        db.$client.query('delete from practice_sessions where id=$1', [id]),
      )
    }
    const read = async (id: string) =>
      (
        await db.$client.query('select * from practice_sessions where id=$1', [
          id,
        ])
      ).rows[0]

    // Each admin entry point must independently repair the stale session;
    // no learner request, ingestion event, or maintenance call runs first.
    for (const [index, entry] of ['usage', 'recent', 'transcript'].entries()) {
      const id = session(12 + index)
      await seed(id)
      if (entry === 'usage') {
        const [usage, recent] = await Promise.all([
          getAdminUsage({ days: 7 }, now),
          listRecentSessions(20),
        ])
        assert.equal(
          recent.find((item) => item.id === id)?.outcome,
          'technical_error',
        )
        assert.equal(usage.current.technicalErrors, 2)
        assert.equal(
          usage.outcomes.find((item) => item.key === 'technical_error')?.count,
          2,
        )
      } else if (entry === 'recent') {
        const recent = (await listRecentSessions(20)).find(
          (item) => item.id === id,
        )
        assert.equal(recent?.outcome, 'technical_error')
        assert.equal(recent.durationSeconds, 3_600)
      } else {
        const transcript = await getSessionTranscript(id)
        assert.equal(transcript?.session.outcome, 'technical_error')
        assert.equal(transcript.session.durationSeconds, 3_600)
      }
      assert.ok(lookups.includes(id))
      const current = await read(id)
      assert.equal(current.status, 'abandoned')
      assert.equal(current.end_reason, 'technical_error')
      // The call ended when its lease lapsed, not when the admin read noticed.
      assert.equal(
        current.completed_at.toISOString(),
        '2026-10-06T04:00:00.000Z',
      )
      assert.equal(current.runtime_metadata.ttsProvider, 'gemini')
      const usage = await getAdminUsage({ days: 7 }, now)
      assert.equal(usage.current.technicalErrors, 2)
      clock.mock.timers.tick(60_000)
      const transcript = await getSessionTranscript(id)
      assert.equal(transcript?.session.durationSeconds, 3_600)
      assert.equal(transcript.session.evaluation, 'none')
      await db.$client.query('delete from practice_sessions where id=$1', [id])
      clock.mock.timers.setTime(now.getTime())
    }

    const liveId = session(15)
    await seed(liveId)
    backendSessions.set(liveId, {
      sessionId: liveId,
      attemptId,
      status: 'active',
      activityLeaseUntil: liveUntil,
    })
    // Dashboard requests fetch usage and recent sessions concurrently. Both
    // must preserve a live attempt despite its old persisted lease.
    const [usage, recent] = await Promise.all([
      getAdminUsage({ days: 7 }, now),
      listRecentSessions(20),
    ])
    assert.equal(usage.current.technicalErrors, 1)
    assert.equal(
      recent.find((item) => item.id === liveId)?.outcome,
      'in_progress',
    )
    const live = await read(liveId)
    assert.equal(live.status, 'in_progress')
    assert.equal(live.completed_at, null)
    assert.equal(live.runtime_metadata.voiceConnection.status, 'connected')
    assert.equal(live.runtime_metadata.voiceConnection.leaseUntil, liveUntil)
    assert.equal(
      (await getSessionTranscript(liveId))?.session.outcome,
      'in_progress',
    )

    const graceId = session(16)
    await seed(graceId, '2026-10-06T04:59:30Z')
    assert.equal(
      (await getSessionTranscript(graceId))?.session.outcome,
      'in_progress',
    )
    const grace = await read(graceId)
    assert.equal(grace.runtime_metadata.voiceConnection.status, 'interrupted')
    assert.equal(
      grace.runtime_metadata.voiceConnection.resumeUntil,
      '2026-10-06T05:00:30.000Z',
    )
    assert.equal(grace.completed_at, null)

    const lockedId = session(17)
    await seed(lockedId)
    await withSessionOperation(lockedId, async () => {
      assert.equal(
        (await getSessionTranscript(lockedId))?.session.outcome,
        'in_progress',
      )
      assert.equal((await read(lockedId)).status, 'in_progress')
    })
    assert.equal(
      (await getSessionTranscript(lockedId))?.session.outcome,
      'technical_error',
    )
  })

  await t.test('a user is recorded once per Vietnamese day', async () => {
    await recordUserActivity('u2', new Date('2026-10-05T17:00:00Z'))
    await recordUserActivity('u2', new Date('2026-10-05T18:00:00Z'))
    await recordUserActivity('u1', new Date('2026-10-06T05:00:00Z'))
    const days = await db.$client.query(
      `select user_id, activity_date::text as day from user_activity_days
         where activity_date = '2026-10-06' order by user_id`,
    )
    assert.deepEqual(days.rows, [
      { user_id: 'u1', day: '2026-10-06' },
      { user_id: 'u2', day: '2026-10-06' },
      { user_id: 'u3', day: '2026-10-06' },
    ])
  })
})
