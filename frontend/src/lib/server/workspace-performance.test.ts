import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// The team numbers depend on PostgreSQL time zone and aggregate semantics, so
// they run against an isolated cluster. No application database or .env
// credentials are accessed.
test('team performance reads in PostgreSQL', { timeout: 30_000 }, async (t) => {
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
  const root = mkdtempSync(join(tmpdir(), 'team-performance-'))
  const data = join(root, 'data')
  let started = false
  const overrides = {
    DATABASE_URL: `postgresql://team_test@localhost/postgres?host=${encodeURIComponent(root)}`,
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
    ['-D', data, '-A', 'trust', '-U', 'team_test', '--no-locale'],
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
  const { getTeamPerformance } = await import('./workspace-performance')

  await db.$client.query(`
      create table "user" (id text primary key, name text not null, email text not null);
      create table member (
        id text primary key, organization_id text not null, user_id text not null,
        role text not null, created_at timestamp not null default now()
      );
      create table practice_sessions (
        id uuid primary key default gen_random_uuid(), user_id text not null,
        workspace_id text not null, status text not null,
        practice_id uuid not null default '00000000-0000-4000-8000-0000000000a1',
        started_at timestamptz, completed_at timestamptz, deleted_at timestamptz,
        created_at timestamptz not null
      );
      create table practice_session_evaluations (
        session_id uuid primary key, overall_score integer, objective_outcome text,
        objection_outcomes jsonb not null default '[]',
        key_coaching_point jsonb,
        discovered_insight_keys jsonb not null default '[]',
        missed_insight_keys jsonb not null default '[]',
        next_practice_recommendation jsonb
      );
      create table practices (
        id uuid primary key, title text not null, difficulty text not null,
        type text not null default 'cold_call', workspace_id text,
        is_global boolean not null default false, status text not null default 'published'
      );
      create table practice_agent_configs (practice_id uuid primary key, config jsonb not null);
      create table practice_session_competency_scores (
        session_id uuid not null, competency_id uuid not null,
        findings jsonb not null default '[]', scoring_rubric jsonb not null, score integer,
        primary key (session_id, competency_id)
      );
      create table user_activity_days (
        user_id text not null, activity_date date not null,
        primary key (user_id, activity_date)
      );
      create table competencies (id uuid primary key, code text not null, name text not null);

      insert into "user" values
        ('alice', 'Alice', 'alice@example.com'),
        ('bob', 'Bob', 'bob@example.com'),
        ('carol', 'Carol', 'carol@example.com'),
        ('dave', 'Dave', 'dave@example.com');
      insert into member (id, organization_id, user_id, role, created_at) values
        ('m1', 'w1', 'alice', 'owner', '2026-01-01'),
        ('m2', 'w1', 'bob', 'admin', '2026-01-02'),
        ('m3', 'w1', 'carol', 'member', '2026-01-03'),
        ('m4', 'w2', 'dave', 'owner', '2026-01-04'),
        ('m5', 'w2', 'bob', 'member', '2026-01-05');

      insert into competencies values
        ('00000000-0000-4000-8000-00000000c001', 'discovery', 'Khám phá nhu cầu'),
        ('00000000-0000-4000-8000-00000000c002', 'objection', 'Xử lý từ chối'),
        ('00000000-0000-4000-8000-00000000c003', 'closing', 'Chốt hẹn');
      insert into practices values
        ('00000000-0000-4000-8000-0000000000a1', 'Gọi lạnh - Anh Nam', 'beginner');
      insert into practices (id, title, difficulty, type, workspace_id) values
        ('00000000-0000-4000-8000-0000000000a2', 'Gọi lại - Chị Lan', 'advanced', 'warm_call', 'w1');
      insert into practice_agent_configs values
        ('00000000-0000-4000-8000-0000000000a1', '{"objections": [
          {"key": "price_1", "category": "price"},
          {"key": "busy_1", "category": "brush_off"}
        ]}');

      insert into user_activity_days values
        ('bob', '2026-10-08'), ('bob', '2026-10-09'), ('dave', '2026-10-10');
    `)

  // "Now" is noon on 10 October in Vietnam, so a 30 day window starts on 11
  // September. The Vietnamese midnight between 10 and 11 September is
  // 17:00 UTC.
  const now = new Date('2026-10-10T05:00:00Z')
  let sessionCount = 0
  const addSession = async (input: {
    user: string
    workspace?: string
    status?: string
    completedAt: string | null
    deleted?: boolean
    score?: number | null
    outcome?: string | null
    objections?: unknown[]
    coaching?: string
    criticalError?: { competency: string; id: string; score?: number }
    /** Other competency scores of the session, by competency id. */
    scores?: Record<string, number | null>
    practice?: string
    startedAt?: string
    discovered?: string[]
    missed?: string[]
    recommendation?: Record<string, string>
  }) => {
    sessionCount += 1
    const id = `00000000-0000-4000-8000-${String(sessionCount).padStart(12, '0')}`
    await db.$client.query(
      `insert into practice_sessions (id, user_id, workspace_id, status, completed_at, deleted_at, created_at, practice_id, started_at)
         values ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, coalesce($5::timestamptz, '2026-10-01'::timestamptz), $7, $8::timestamptz)`,
      [
        id,
        input.user,
        input.workspace ?? 'w1',
        input.status ?? 'completed',
        input.completedAt,
        input.deleted ? '2026-10-09' : null,
        input.practice ?? '00000000-0000-4000-8000-0000000000a1',
        input.startedAt ?? null,
      ],
    )
    if (input.score !== undefined)
      await db.$client.query(
        `insert into practice_session_evaluations
           (session_id, overall_score, objective_outcome, objection_outcomes, key_coaching_point,
            discovered_insight_keys, missed_insight_keys, next_practice_recommendation)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          input.score,
          input.outcome ?? null,
          JSON.stringify(input.objections ?? []),
          input.coaching ? JSON.stringify({ text: input.coaching }) : null,
          JSON.stringify(input.discovered ?? []),
          JSON.stringify(input.missed ?? []),
          input.recommendation ? JSON.stringify(input.recommendation) : null,
        ],
      )
    if (input.criticalError)
      await db.$client.query(
        `insert into practice_session_competency_scores (session_id, competency_id, findings, scoring_rubric, score) values ($1, $2, $3, $4, $5)`,
        [
          id,
          input.criticalError.competency,
          JSON.stringify([
            {
              id: 'f1',
              kind: 'critical_error',
              criticalErrorId: input.criticalError.id,
            },
          ]),
          JSON.stringify({
            criticalErrors: [
              {
                id: input.criticalError.id,
                description: 'Hứa giá chưa được duyệt',
              },
            ],
          }),
          input.criticalError.score ?? null,
        ],
      )
    for (const [competency, score] of Object.entries(input.scores ?? {}))
      await db.$client.query(
        `insert into practice_session_competency_scores (session_id, competency_id, scoring_rubric, score) values ($1, $2, '{}', $3)`,
        [id, competency, score],
      )
  }
  const discovery = '00000000-0000-4000-8000-00000000c001'
  const closing = '00000000-0000-4000-8000-00000000c003'
  // Alice: two scored sessions this period, one on the first Vietnamese
  // minute of the window, and one the minute before it, which belongs to
  // the previous period.
  await addSession({
    user: 'alice',
    completedAt: '2026-10-05T03:00:00Z',
    score: 80,
    outcome: 'achieved',
    coaching: 'Hỏi thêm về ngân sách trước khi báo giá.',
    startedAt: '2026-10-05T02:50:00Z',
    discovered: ['a', 'b'],
    missed: ['c'],
    recommendation: {
      reason: 'Luyện thêm cách xử lý phản đối về giá.',
      competencyCode: 'objection',
      practiceType: 'warm_call',
      suggestedPracticeId: '00000000-0000-4000-8000-0000000000a2',
    },
    objections: [
      { key: 'price_1', raised: true, handling: 'handled' },
      { key: 'busy_1', raised: true, handling: 'not_handled' },
      { key: 'price_1', raised: false },
    ],
    criticalError: {
      competency: '00000000-0000-4000-8000-00000000c002',
      id: 'promise_price',
      score: 40,
    },
    scores: { [discovery]: 80, [closing]: null },
  })
  await addSession({
    user: 'alice',
    completedAt: '2026-09-10T17:30:00Z',
    score: 60,
    outcome: 'partially_achieved',
    startedAt: '2026-09-10T17:20:00Z',
    discovered: ['a'],
    missed: ['c'],
    objections: [
      { key: 'price_1', raised: true, handling: 'partially_handled' },
    ],
    criticalError: {
      competency: '00000000-0000-4000-8000-00000000c002',
      id: 'promise_price',
      score: 60,
    },
    scores: { [discovery]: 70 },
  })
  await addSession({
    user: 'alice',
    completedAt: '2026-09-10T16:30:00Z',
    score: 50,
    outcome: 'not_achieved',
    discovered: ['a', 'b', 'c', 'd', 'e'],
    objections: [{ key: 'price_1', raised: true, handling: 'not_handled' }],
    criticalError: {
      competency: '00000000-0000-4000-8000-00000000c002',
      id: 'promise_price',
      score: 30,
    },
    scores: { [discovery]: 20 },
  })
  // A finished session whose evaluation has not arrived counts as practice
  // but not towards the average.
  await addSession({
    user: 'alice',
    completedAt: '2026-10-09T03:00:00Z',
    practice: '00000000-0000-4000-8000-0000000000a2',
  })
  // Bob practiced only in another workspace, plus a deleted one here.
  await addSession({
    user: 'bob',
    workspace: 'w2',
    completedAt: '2026-10-09T03:00:00Z',
    score: 90,
    outcome: 'achieved',
    scores: { [discovery]: 5 },
  })
  await addSession({
    user: 'bob',
    completedAt: '2026-10-08T03:00:00Z',
    score: 90,
    outcome: 'achieved',
    deleted: true,
    criticalError: {
      competency: '00000000-0000-4000-8000-00000000c002',
      id: 'promise_price',
    },
  })
  // Carol abandoned a session, which is not practice.
  await addSession({
    user: 'carol',
    status: 'abandoned',
    completedAt: '2026-10-08T03:00:00Z',
    score: 70,
  })
  // Dave belongs to another workspace entirely.
  await addSession({
    user: 'dave',
    workspace: 'w2',
    completedAt: '2026-10-09T03:00:00Z',
    score: 95,
    scores: { [closing]: 99 },
  })
  // Alice in June, read with its own range: two cold calls around a warm one.
  await addSession({
    user: 'alice',
    completedAt: '2026-06-10T03:00:00Z',
    score: 50,
    scores: { [discovery]: 30 },
  })
  await addSession({
    user: 'alice',
    completedAt: '2026-06-11T03:00:00Z',
    score: 70,
    practice: '00000000-0000-4000-8000-0000000000a2',
    scores: { [discovery]: 90 },
  })
  await addSession({
    user: 'alice',
    completedAt: '2026-06-12T03:00:00Z',
    score: 60,
    scores: { [discovery]: 65 },
  })

  const team = await getTeamPerformance('w1', { period: '30d' }, now)

  assert.equal(team.workspaceId, 'w1')
  assert.deepEqual(team.range, {
    from: '2026-09-11',
    to: '2026-10-10',
    previousFrom: '2026-08-12',
    previousTo: '2026-09-10',
  })
  // A custom range over the same days reads the same numbers as the preset.
  const custom = await getTeamPerformance(
    'w1',
    { from: '2026-09-11', to: '2026-10-10' },
    now,
  )
  assert.deepEqual(custom.range, team.range)
  assert.deepEqual(custom.kpis, team.kpis)
  assert.deepEqual(custom.trend, team.trend)
  assert.deepEqual(custom.members, team.members)
  assert.deepEqual(team.members.map((member) => member.userId).sort(), [
    'alice',
    'bob',
    'carol',
  ])
  const byId = Object.fromEntries(
    team.members.map((member) => [member.userId, member]),
  )

  // Alice: three sessions this period (80, 60, unscored) and one before it.
  assert.equal(byId.alice.sessions, 3)
  assert.equal(byId.alice.previousSessions, 1)
  assert.equal(byId.alice.averageScore, 70)
  assert.equal(byId.alice.previousAverageScore, 50)
  assert.equal(byId.alice.objectiveAchievedRate, 50)
  assert.equal(byId.alice.role, 'owner')
  assert.equal(byId.alice.status, 'improving')

  // Bob's other workspace, deleted sessions and Carol's abandoned one do not
  // count, and nothing from workspace w2 leaks in.
  for (const id of ['bob', 'carol']) {
    assert.equal(byId[id].sessions, 0)
    assert.equal(byId[id].averageScore, null)
    assert.equal(byId[id].lastPracticedAt, null)
  }
  assert.equal(byId.bob.role, 'admin')
  assert.equal(byId.bob.status, 'inactive')
  // Sign-ins are the only data not tied to a workspace.
  assert.equal(byId.bob.lastActiveDate, '2026-10-09')
  assert.equal(byId.dave, undefined)

  assert.deepEqual(
    {
      sessions: team.kpis.sessions,
      previousSessions: team.kpis.previousSessions,
      activeMembers: team.kpis.activeMembers,
      totalMembers: team.kpis.totalMembers,
      averageScore: team.kpis.averageScore,
    },
    {
      sessions: 3,
      previousSessions: 1,
      activeMembers: 1,
      totalMembers: 3,
      averageScore: 70,
    },
  )

  // A skill shows its latest score in the period, as on the learner's own
  // page: Alice's 5 Oct session (discovery 80, objection 40) beats her
  // 11 Sep one. A null score, the previous period and another workspace's
  // sessions add no column.
  assert.deepEqual(
    team.competencies.map((column) => [
      column.code,
      column.callType,
      column.teamAverage,
    ]),
    [
      ['discovery', 'cold_call', 80],
      ['objection', 'cold_call', 40],
    ],
  )
  assert.equal(byId.alice.mastery[`${discovery}:cold_call`], 80)
  const aliceWeakest = byId.alice.weakest
  assert.ok(aliceWeakest)
  assert.equal(aliceWeakest.code, 'objection')
  assert.equal(aliceWeakest.callType, 'cold_call')
  assert.equal(byId.carol.weakest, null)
  assert.equal(byId.bob.weakest, null)

  // A 30 day period is six buckets of five days. Alice's window-opening
  // session is in the first, her 5 Oct session in the fifth, and her unscored
  // 9 Oct session in the last, where it counts as practice without a score.
  assert.equal(team.trend.length, 6)
  assert.deepEqual(
    [team.trend[0].from, team.trend[0].to, team.trend[5].to],
    ['2026-09-11', '2026-09-15', '2026-10-10'],
  )
  assert.deepEqual(
    team.trend.map((point) => point.sessions),
    [1, 0, 0, 0, 1, 1],
  )
  assert.equal(team.trend[0].averageScore, 60)
  assert.equal(team.trend[1].averageScore, null)
  assert.equal(team.trend[4].averageScore, 80)
  assert.equal(team.trend[5].averageScore, null)

  // Objections raised this period only; the one that was not raised, the
  // previous period and other people's data are left out.
  assert.deepEqual(
    team.objections,
    [
      {
        category: 'brush_off',
        raised: 1,
        handled: 0,
        partiallyHandled: 0,
        notHandled: 1,
      },
      {
        category: 'price',
        raised: 2,
        handled: 1,
        partiallyHandled: 1,
        notHandled: 0,
      },
    ].sort((a, b) => b.raised - a.raised),
  )

  // The same error twice this period; the previous period and the deleted
  // session do not count.
  assert.equal(team.criticalErrors.length, 1)
  assert.deepEqual(team.criticalErrors[0], {
    competencyId: '00000000-0000-4000-8000-00000000c002',
    competencyName: 'Xử lý từ chối',
    errorId: 'promise_price',
    description: 'Hứa giá chưa được duyệt',
    sessions: 2,
    members: [{ userId: 'alice', name: 'Alice', sessions: 2 }],
  })

  // Recent sessions are newest first, whatever the period, and per member.
  assert.deepEqual(
    byId.alice.recentSessions.map((session) => session.completedAt),
    [
      '2026-10-09T03:00:00.000Z',
      '2026-10-05T03:00:00.000Z',
      '2026-09-10T17:30:00.000Z',
      '2026-09-10T16:30:00.000Z',
      '2026-06-12T03:00:00.000Z',
      '2026-06-11T03:00:00.000Z',
      '2026-06-10T03:00:00.000Z',
    ],
  )
  assert.equal(
    byId.alice.recentSessions[1].coachingPoint,
    'Hỏi thêm về ngân sách trước khi báo giá.',
  )
  assert.equal(byId.alice.recentSessions[0].score, null)
  assert.equal(byId.alice.recentSessions[1].practiceTitle, 'Gọi lạnh - Anh Nam')
  assert.deepEqual(byId.bob.recentSessions, [])
  // Scored sessions in the period behind each skill.
  assert.equal(byId.alice.masteryEvidence[`${discovery}:cold_call`], 2)
  assert.equal(byId.bob.masteryEvidence[`${discovery}:cold_call`], 0)

  // Cold and warm calls never pool, and the newest session wins even when an
  // earlier one scored higher.
  const june = await getTeamPerformance(
    'w1',
    { from: '2026-06-01', to: '2026-06-30' },
    now,
  )
  assert.deepEqual(
    june.competencies.map((column) => [column.id, column.teamAverage]),
    [
      [`${discovery}:cold_call`, 65],
      [`${discovery}:warm_call`, 90],
    ],
  )
  const juneAlice = june.members.find((member) => member.userId === 'alice')
  assert.ok(juneAlice)
  assert.deepEqual(juneAlice.masteryEvidence, {
    [`${discovery}:cold_call`]: 2,
    [`${discovery}:warm_call`]: 1,
  })
  assert.equal(juneAlice.weakest?.callType, 'cold_call')
  assert.equal(juneAlice.strongest?.callType, 'warm_call')

  // Nobody asked for the advanced view, so none of it was computed.
  assert.equal(team.view, 'basic')
  assert.equal(team.advanced, null)

  // A different workspace sees only its own people and team.
  const other = await getTeamPerformance('w2', { period: '30d' }, now)
  assert.deepEqual(other.members.map((member) => member.userId).sort(), [
    'bob',
    'dave',
  ])
  assert.equal(other.kpis.sessions, 2)

  const deep = await getTeamPerformance(
    'w1',
    { period: '30d' },
    now,
    'advanced',
  )
  const advanced = deep.advanced
  assert.ok(advanced)
  assert.equal(deep.view, 'advanced')
  // The basic numbers do not change with the view.
  assert.equal(deep.kpis.sessions, team.kpis.sessions)

  // Three sessions this period: two on the first scenario (80 and 60, half
  // reaching the objective) and the unscored one on the second.
  assert.deepEqual(advanced.scenarios, [
    {
      practiceId: '00000000-0000-4000-8000-0000000000a1',
      title: 'Gọi lạnh - Anh Nam',
      callType: 'cold_call',
      difficulty: 'beginner',
      sessions: 2,
      members: 1,
      averageScore: 70,
      objectiveAchievedRate: 50,
    },
    {
      practiceId: '00000000-0000-4000-8000-0000000000a2',
      title: 'Gọi lại - Chị Lan',
      callType: 'warm_call',
      difficulty: 'advanced',
      sessions: 1,
      members: 1,
      averageScore: null,
      objectiveAchievedRate: null,
    },
  ])

  // Insights found and missed in this period only: 3 of 5.
  assert.deepEqual(advanced.discovery, { discovered: 3, missed: 2 })

  // Three completed calls began this period, Carol's abandoned one is the only
  // abandonment, and only the two timed calls add up to 20 minutes.
  assert.deepEqual(advanced.health, {
    completed: 3,
    abandoned: 1,
    practiceSeconds: 1200,
    timedSessions: 2,
  })

  // Objection handling scores averaged 50 this period against 30 before,
  // discovery 75 against 20; a skill with only a null score has no entry.
  assert.deepEqual(
    advanced.competencyChange['00000000-0000-4000-8000-00000000c002:cold_call'],
    { current: 50, previous: 30 },
  )
  assert.deepEqual(advanced.competencyChange[`${discovery}:cold_call`], {
    current: 75,
    previous: 20,
  })
  assert.equal(advanced.competencyChange[`${closing}:cold_call`], undefined)

  assert.deepEqual(Object.keys(advanced.members).sort(), [
    'alice',
    'bob',
    'carol',
  ])
  const alice = advanced.members.alice
  assert.deepEqual(
    alice.objections.map((stat) => [stat.category, stat.raised]),
    [
      ['price', 2],
      ['brush_off', 1],
    ],
  )
  assert.deepEqual(alice.discovery, { discovered: 3, missed: 2 })
  assert.deepEqual(alice.mix, [
    { callType: 'cold_call', difficulty: 'beginner', sessions: 2 },
    { callType: 'warm_call', difficulty: 'advanced', sessions: 1 },
  ])
  // The newest evaluation that suggested something, with the suggestion's title.
  assert.deepEqual(alice.nextPractice, {
    reason: 'Luyện thêm cách xử lý phản đối về giá.',
    competencyCode: 'objection',
    practiceType: 'warm_call',
    suggestedPracticeTitle: 'Gọi lại - Chị Lan',
  })
  assert.deepEqual(advanced.members.bob, {
    objections: [],
    discovery: { discovered: 0, missed: 0 },
    mix: [],
    nextPractice: null,
  })
})
