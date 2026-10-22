import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mock, test } from 'node:test'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { templateDraft } from '#/lib/practice/workbook'
import { defaultScorecard, validateDraft } from '#/lib/practice/authoring'
import * as schema from '#/db/schema'

test('archived session snapshots retain the original public scorecard', async (t) => {
  const previousUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = 'postgresql://test:test@localhost/test'
  const { db } = await import('#/db')
  const {
    getOwnedSessionSnapshot,
    getOwnedSessionFeedback,
    getOwnedSessionForCleanup,
    listOwnedPracticeSessions,
    deleteOwnedPracticeSession,
  } = await import('./practice-sessions')
  if (previousUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = previousUrl

  // Run production queries locally; PostgreSQL-only locks are modeled below.
  const database = new DatabaseSync(':memory:')
  for (const table of [
    schema.organization,
    schema.workspaceProfiles,
    schema.member,
    schema.session,
    schema.practices,
    schema.practiceAgentConfigs,
    schema.salesOfferings,
    schema.competencies,
    schema.practiceCompetencies,
    schema.practiceSessions,
    schema.practiceSessionTurns,
    schema.practiceSessionEvaluations,
    schema.practiceSessionCompetencyScores,
  ]) {
    const { name, columns } = getTableConfig(table)
    database.exec(
      `CREATE TABLE "${name}" (${columns.map((column) => `"${column.name}" ${column.dataType === 'number' ? 'INTEGER' : 'TEXT'}`).join(', ')})`,
    )
  }
  function insert(table: string, row: Record<string, string | number | null>) {
    const keys = Object.keys(row)
    database
      .prepare(
        `INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      )
      .run(...Object.values(row))
  }
  const runQuery = async (
    query: string | { text: string; rowMode?: string },
    values: Array<string | number | boolean | null> = [],
  ) => {
    const text = typeof query === 'string' ? query : query.text
    if (text.includes('pg_try_advisory_lock')) {
      return { rows: [{ acquired: true }], rowCount: 1 }
    }
    if (
      text.includes('pg_advisory_unlock') ||
      text.includes('pg_advisory_xact_lock')
    ) {
      return { rows: [], rowCount: 0 }
    }
    const records = database
      .prepare(text.replace(/\$\d+/g, '?').replace(/ for update$/i, ''))
      .all(
        ...values.map((value) =>
          typeof value === 'boolean' ? Number(value) : value,
        ),
      )
    return {
      rows:
        typeof query !== 'string' && query.rowMode === 'array'
          ? records.map(Object.values)
          : records,
      rowCount: records.length,
    }
  }
  const queryMock = mock.method(db.$client, 'query', runQuery)
  const connectMock = mock.method(db.$client, 'connect', async () => ({
    query: runQuery,
    release() {},
  }))
  t.after(() => {
    queryMock.mock.restore()
    connectMock.mock.restore()
    database.close()
  })

  insert('organization', {
    id: 'alice-personal',
    company_id: 'alice-personal-company',
    name: 'Personal workspace',
    slug: 'alice-personal',
  })
  insert('workspace_profiles', {
    workspace_id: 'alice-personal',
    kind: 'personal',
    personal_owner_user_id: 'alice',
    status: 'ready',
  })
  insert('member', {
    id: 'alice-personal-member',
    organization_id: 'alice-personal',
    user_id: 'alice',
    role: 'owner',
  })

  for (const [typeIndex, type] of (
    ['cold_call', 'warm_call'] as const
  ).entries()) {
    await t.test(
      `${type}: preserve names, weights, order and private data boundaries`,
      async () => {
        const draft = {
          ...Object.fromEntries(
            Object.entries(templateDraft()).filter(
              ([key]) => !key.startsWith('scorecard.'),
            ),
          ),
          type,
          ...defaultScorecard(type),
          'config.sinceLastContact': 'Khách hàng đã trao đổi với gia đình.',
          'learnerBrief.previousInteractions.0.when': 'Tuần trước',
          'learnerBrief.previousInteractions.0.channel': 'phone',
          'learnerBrief.previousInteractions.0.summary': 'Đã trao đổi nhu cầu.',
          'config.learnerKnows': 'age\nbudget\nurgency',
          'config.buyer.budget.detail': 'PRIVATE FINANCIAL CONCERN',
          'config.buyer.urgency.driver': 'PRIVATE URGENCY DRIVER',
          'config.hiddenInsights.0.relatesTo': '',
        }
        const parsed = validateDraft(draft).result
        assert.ok(parsed.success)
        const input = parsed.data
        insert('sales_offerings', {
          id: type,
          workspace_id: 'alice-personal',
          is_global: 0,
          offering: JSON.stringify(input.offering),
        })
        insert('practices', {
          id: type,
          type,
          title: input.title,
          difficulty: input.difficulty,
          status: 'archived',
          created_by_user_id: 'alice',
          workspace_id: 'alice-personal',
          is_global: 0,
          sales_offering_id: type,
          learner_brief: JSON.stringify(input.learnerBrief),
          estimated_minutes: input.estimatedMinutes,
        })
        insert('practice_agent_configs', {
          practice_id: type,
          config: JSON.stringify(input.config),
        })
        // Insert in reverse order to catch accidental database-order dependence.
        for (const [index, criterion] of [...input.scorecard]
          .reverse()
          .entries()) {
          const id = `${type}-${criterion.competencyCode}`
          insert('competencies', {
            id,
            code: criterion.competencyCode,
            name: `Original ${criterion.competencyCode}`,
            description: 'Learner-visible skill description',
          })
          insert('practice_competencies', {
            practice_id: type,
            competency_id: id,
            weight: (index + 1) * 5,
            rubric: JSON.stringify({ private: 'DO NOT DISCLOSE' }),
          })
        }
        insert('practice_sessions', {
          id: type,
          practice_id: type,
          user_id: 'alice',
          workspace_id: 'alice-personal',
          status: 'completed',
          created_at: '2026-10-01T00:00:00Z',
          completed_at: '2026-10-01T00:05:00Z',
        })
        insert('practice_session_turns', {
          id: `${type}-turn`,
          session_id: type,
          sequence: 1,
          speaker: 'buyer',
          text: 'Alo?',
          created_at: '2026-10-01T00:00:00Z',
        })
        insert('practice_session_evaluations', {
          session_id: type,
          overall_score: null,
          assessment_coverage: JSON.stringify({
            assessedCount: 0,
            totalCount: 0,
            weightedPercent: 0,
          }),
          summary: `Feedback for ${type}`,
          summary_findings: '[]',
          objective_evidence: '[]',
          strengths: '[]',
          improvements: '[]',
          discovered_insight_keys: '[]',
          missed_insight_keys: '[]',
          objection_outcomes: '[]',
          created_at: '2026-10-01T00:05:00Z',
        })

        const snapshot = await getOwnedSessionSnapshot({
          userId: 'alice',
          sessionId: type,
          workspaceId: 'alice-personal',
        })
        assert.ok(snapshot?.practice)
        assert.deepEqual(
          snapshot.practice.competencies.map((item) => ({
            code: item.code,
            name: item.name,
            weight: item.weight,
          })),
          input.scorecard.map((criterion, index) => ({
            code: criterion.competencyCode,
            name: `Original ${criterion.competencyCode}`,
            weight: (input.scorecard.length - index) * 5,
          })),
        )
        assert.equal(snapshot.transcript[0].text, 'Alo?')
        assert.equal(
          snapshot.practice.offering?.projectName,
          input.offering.projectName,
        )
        const exposed = JSON.stringify(snapshot)
        assert.equal(exposed.includes('rubric'), false)
        assert.equal(exposed.includes('DO NOT DISCLOSE'), false)
        assert.equal(exposed.includes('hiddenInsights'), false)
        assert.equal(exposed.includes('agentConfig'), false)
        assert.equal(exposed.includes('PRIVATE FINANCIAL CONCERN'), false)
        assert.equal(exposed.includes('PRIVATE URGENCY DRIVER'), false)
        const knownBuyer = snapshot.practice.learnerBrief.buyer.known
        assert.ok(knownBuyer)
        assert.deepEqual(knownBuyer.budget, {
          min: input.config.buyer.budget.min,
          max: input.config.buyer.budget.max,
          currency: input.config.buyer.budget.currency,
          fundingSource: input.config.buyer.budget.fundingSource,
        })
        assert.deepEqual(knownBuyer.urgency, {
          level: input.config.buyer.urgency.level,
          timeline: input.config.buyer.urgency.timeline,
        })
        assert.equal(
          await getOwnedSessionSnapshot({
            userId: 'bob',
            sessionId: type,
            workspaceId: 'alice-personal',
          }),
          null,
        )
        assert.equal(
          await getOwnedSessionSnapshot({
            userId: 'alice',
            sessionId: type,
            workspaceId: 'another-workspace',
          }),
          null,
        )
        const feedback = await getOwnedSessionFeedback({
          userId: 'alice',
          sessionId: type,
          workspaceId: 'alice-personal',
        })
        assert.ok(feedback?.state === 'ready')
        assert.equal(feedback.summary, `Feedback for ${type}`)
        assert.equal(
          await getOwnedSessionFeedback({
            userId: 'bob',
            sessionId: type,
            workspaceId: 'alice-personal',
          }),
          null,
        )
        assert.equal(
          await getOwnedSessionFeedback({
            userId: 'alice',
            sessionId: type,
            workspaceId: 'another-workspace',
          }),
          null,
        )

        const history = await listOwnedPracticeSessions(
          'alice',
          { page: 1, pageSize: 20, type: 'all', evaluation: 'all' },
          'alice-personal',
        )
        assert.equal(history.total, typeIndex + 1)
        assert.equal(history.items[0]?.customer.name, input.config.buyer.name)
        assert.equal(
          history.items.every((item) => item.score === null),
          true,
        )
        assert.equal(JSON.stringify(history).includes('hiddenInsights'), false)
        assert.equal(
          (
            await listOwnedPracticeSessions(
              'bob',
              { page: 1, pageSize: 20, type: 'all', evaluation: 'all' },
              'alice-personal',
            )
          ).total,
          0,
        )
        assert.equal(
          (
            await listOwnedPracticeSessions(
              'alice',
              { page: 1, pageSize: 20, type: 'all', evaluation: 'all' },
              'another-workspace',
            )
          ).total,
          0,
        )
      },
    )
  }

  await t.test(
    'cleanup checks ownership and membership in the stored workspace',
    async () => {
      const personal = await getOwnedSessionForCleanup({
        userId: 'alice',
        sessionId: 'cold_call',
      })
      assert.equal(personal?.workspaceId, 'alice-personal')

      insert('organization', {
        id: 'company',
        company_id: 'company-parent',
        name: 'Company',
        slug: 'company',
      })
      insert('workspace_profiles', {
        workspace_id: 'company',
        kind: 'company',
        status: 'pending_subscription',
      })
      for (const userId of ['alice', 'bob']) {
        insert('member', {
          id: `${userId}-company-member`,
          organization_id: 'company',
          user_id: userId,
          role: 'member',
        })
      }
      // An existing call must remain stoppable if its subscription state changes.
      insert('practice_sessions', {
        id: 'company-call',
        practice_id: 'cold_call',
        user_id: 'alice',
        workspace_id: 'company',
        status: 'in_progress',
        created_at: '2026-10-01T00:00:00Z',
      })
      insert('session', {
        id: 'alice-auth-session',
        user_id: 'alice',
        active_organization_id: 'alice-personal',
      })
      // The active workspace differs from the call; cleanup must use its stored one.
      const company = await getOwnedSessionForCleanup({
        userId: 'alice',
        sessionId: 'company-call',
      })
      assert.equal(company?.workspaceId, 'company')
      database
        .prepare('UPDATE session SET active_organization_id = ? WHERE id = ?')
        .run('company', 'alice-auth-session')
      assert.equal(
        (
          await getOwnedSessionForCleanup({
            userId: 'alice',
            sessionId: 'cold_call',
          })
        )?.workspaceId,
        'alice-personal',
      )
      assert.equal(
        await getOwnedSessionForCleanup({
          userId: 'bob',
          sessionId: 'company-call',
        }),
        null,
      )

      database
        .prepare('DELETE FROM member WHERE id = ?')
        .run('alice-company-member')
      assert.equal(
        await getOwnedSessionForCleanup({
          userId: 'alice',
          sessionId: 'company-call',
        }),
        null,
      )
    },
  )

  await t.test(
    'history reads score from the evaluation and filters it correctly',
    async () => {
      database
        .prepare(
          'UPDATE practice_session_evaluations SET overall_score = ? WHERE session_id = ?',
        )
        .run(84, 'warm_call')

      const graded = await listOwnedPracticeSessions(
        'alice',
        { page: 1, pageSize: 20, type: 'all', evaluation: 'graded' },
        'alice-personal',
      )
      assert.equal(graded.total, 1)
      assert.equal(graded.items[0]?.score, 84)
      assert.equal(graded.items[0]?.durationSeconds, 300)

      const ungraded = await listOwnedPracticeSessions(
        'alice',
        { page: 1, pageSize: 20, type: 'all', evaluation: 'ungraded' },
        'alice-personal',
      )
      assert.equal(ungraded.total, 1)
      assert.equal(ungraded.items[0]?.id, 'cold_call')

      const highScore = await listOwnedPracticeSessions(
        'alice',
        { page: 1, pageSize: 20, type: 'all', evaluation: '80_100' },
        'alice-personal',
      )
      assert.equal(highScore.total, 1)
      assert.equal(highScore.items[0]?.id, 'warm_call')
    },
  )

  await t.test(
    'history and deletion remain isolated by session workspace',
    async () => {
      const filters = {
        page: 1,
        pageSize: 20,
        type: 'all',
        evaluation: 'all',
      } as const
      const personal = await listOwnedPracticeSessions(
        'alice',
        filters,
        'alice-personal',
      )
      const company = await listOwnedPracticeSessions(
        'alice',
        filters,
        'company',
      )
      assert.equal(personal.total, 2)
      assert.equal(
        personal.items.some((item) => item.id === 'company-call'),
        false,
      )
      assert.equal(company.total, 1)
      assert.equal(company.items[0]?.id, 'company-call')

      assert.equal(
        await deleteOwnedPracticeSession('alice', 'cold_call', 'company'),
        'missing',
      )
      assert.equal(
        await deleteOwnedPracticeSession(
          'alice',
          'company-call',
          'alice-personal',
        ),
        'missing',
      )
      assert.equal(
        await deleteOwnedPracticeSession('bob', 'cold_call', 'alice-personal'),
        'missing',
      )
      assert.equal(
        await deleteOwnedPracticeSession('alice', 'company-call', 'company'),
        'unfinished',
      )
      assert.equal(
        database
          .prepare('SELECT deleted_at FROM practice_sessions WHERE id = ?')
          .get('cold_call')?.deleted_at,
        null,
      )
      assert.equal(
        await deleteOwnedPracticeSession(
          'alice',
          'cold_call',
          'alice-personal',
        ),
        'deleted',
      )
      assert.equal(
        await deleteOwnedPracticeSession(
          'alice',
          'cold_call',
          'alice-personal',
        ),
        'deleted',
      )
      assert.equal(
        await deleteOwnedPracticeSession('alice', 'cold_call', 'company'),
        'missing',
      )
      const remaining = await listOwnedPracticeSessions(
        'alice',
        filters,
        'alice-personal',
      )
      assert.equal(remaining.total, 1)
      assert.equal(remaining.items[0]?.id, 'warm_call')
      assert.equal(
        await getOwnedSessionSnapshot({
          userId: 'alice',
          sessionId: 'cold_call',
          workspaceId: 'alice-personal',
        }),
        null,
      )
      assert.equal(
        await getOwnedSessionFeedback({
          userId: 'alice',
          sessionId: 'cold_call',
          workspaceId: 'alice-personal',
        }),
        null,
      )
      assert.ok(
        database
          .prepare(
            'SELECT * FROM practice_session_evaluations WHERE session_id = ?',
          )
          .get('cold_call'),
      )
      assert.equal(
        (await listOwnedPracticeSessions('alice', filters, 'company')).total,
        1,
      )

      insert('practice_sessions', {
        id: 'company-abandoned',
        practice_id: 'cold_call',
        user_id: 'alice',
        workspace_id: 'company',
        status: 'abandoned',
        created_at: '2026-10-01T00:00:00Z',
      })
      assert.equal(
        await deleteOwnedPracticeSession(
          'alice',
          'company-abandoned',
          'company',
        ),
        'deleted',
      )
      assert.equal(
        (await listOwnedPracticeSessions('alice', filters, 'company')).total,
        1,
      )
    },
  )
})
