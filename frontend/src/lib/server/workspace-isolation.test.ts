import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Pool } from 'pg'
import { and, eq } from 'drizzle-orm'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import * as schema from '#/db/schema'
import { templateDraft } from '#/lib/practice/workbook'
import { validateDraft } from '#/lib/practice/authoring'
import { practiceHistoryInputSchema } from '#/lib/practice/history'

// Opt-in PostgreSQL integration. Every object is created in a fresh private
// schema, removed afterward. Never reads or changes application tables.
test(
  'workspace provisioning and data isolation in PostgreSQL',
  { timeout: 300_000 },
  async (t) => {
    const connection = process.env.WORKSPACE_TEST_DATABASE_URL
    if (!connection) {
      t.skip('Set WORKSPACE_TEST_DATABASE_URL to a test database')
      return
    }
    const url = new URL(connection)
    assert.match(
      decodeURIComponent(url.pathname),
      /_test$/,
      'Use a database whose name ends in _test',
    )
    // Neon transaction pooling does not accept startup search_path.
    if (url.hostname.endsWith('.neon.tech'))
      url.hostname = url.hostname.replace('-pooler.', '.')
    const namespace = `workspace_test_${randomUUID().replaceAll('-', '')}`
    url.searchParams.set('options', `-c search_path=${namespace}`)
    if (!url.searchParams.has('sslmode'))
      url.searchParams.set('sslmode', 'verify-full')
    const admin = new Pool({
      connectionString: url.toString(),
      connectionTimeoutMillis: 10_000,
    })
    const previousUrl = process.env.DATABASE_URL
    let created = false
    const resources: { pool?: Pool } = {}
    t.after(async () => {
      await resources.pool?.end()
      try {
        if (created) await admin.query(`DROP SCHEMA "${namespace}" CASCADE`)
      } finally {
        await admin.end()
        if (previousUrl === undefined) delete process.env.DATABASE_URL
        else process.env.DATABASE_URL = previousUrl
      }
    })
    assert.equal(
      (await admin.query('SHOW search_path')).rows[0].search_path,
      namespace,
    )
    await admin.query(`CREATE SCHEMA "${namespace}"`)
    created = true
    const ddl = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(schema),
    )
    await admin.query(ddl.join('\n').replaceAll('"public".', `"${namespace}".`))
    process.env.DATABASE_URL = url.toString()
    const { db } = await import('#/db')
    const appPool = db.$client
    resources.pool = appPool
    assert.equal(
      (await appPool.query('SHOW search_path')).rows[0].search_path,
      namespace,
    )
    const {
      ensurePersonalWorkspace,
      createCompanyWorkspace,
      getWorkspaceForUser,
      requireReadyWorkspace,
    } = await import('./workspaces')
    const { saveCustomPractice, deleteCustomPractice } =
      await import('./practice-authoring')
    const { listLearnerPractices, getLearnerPractice } =
      await import('./practice-domain')
    const {
      createPracticeSession,
      getOwnedSessionSnapshot,
      getOwnedSessionForCleanup,
      listOwnedPracticeSessions,
      deleteOwnedPracticeSession,
    } = await import('./practice-sessions')
    const { getCompetencyProfiles, getPracticeRecommendations } =
      await import('./practice-recommendations')
    await db.insert(schema.user).values(
      ['alice', 'bob'].map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
        roles: [],
        emailVerified: true,
      })),
    )
    let personal = ''
    let company = ''
    let bobPersonal = ''
    await t.test(
      'concurrent provisioning creates exactly one Personal with one owner',
      async () => {
        const ids = await Promise.all(
          Array.from({ length: 3 }, () => ensurePersonalWorkspace('alice')),
        )
        assert.equal(new Set(ids).size, 1)
        personal = ids[0]
        bobPersonal = await ensurePersonalWorkspace('bob')
        assert.notEqual(personal, bobPersonal)
        const memberships = await db
          .select()
          .from(schema.member)
          .where(eq(schema.member.organizationId, personal))
        assert.equal(memberships.length, 1)
        assert.equal(memberships[0].role, 'owner')
        assert.equal(
          (await requireReadyWorkspace('alice', personal)).kind,
          'personal',
        )
        const workspaces = await db.select().from(schema.organization)
        assert.equal(workspaces.length, 2)
        assert.equal(new Set(workspaces.map((row) => row.companyId)).size, 2)
        assert.equal((await db.select().from(schema.company)).length, 2)
      },
    )
    await t.test(
      'company creation is idempotent, pending and inaccessible to another user',
      async () => {
        const input = { name: 'Company test', requestId: randomUUID() }
        const ids = await Promise.all([
          createCompanyWorkspace('alice', input),
          createCompanyWorkspace('alice', input),
        ])
        assert.equal(ids[0], ids[1])
        company = ids[0]
        assert.equal((await db.select().from(schema.company)).length, 3)
        const parents = await db.select().from(schema.organization)
        assert.equal(new Set(parents.map((row) => row.companyId)).size, 3)
        assert.equal(
          (await getWorkspaceForUser('alice', company))?.status,
          'pending_subscription',
        )
        await assert.rejects(
          requireReadyWorkspace('alice', company),
          (error: unknown) => error instanceof Response && error.status === 403,
        )
        assert.equal(await getWorkspaceForUser('bob', company), null)
        assert.equal(await getWorkspaceForUser('bob', personal), null)
        // Even an accidentally inserted member must not enter someone else's Personal.
        await db.insert(schema.member).values({
          id: randomUUID(),
          userId: 'bob',
          organizationId: personal,
          role: 'member',
        })
        assert.equal(await getWorkspaceForUser('bob', personal), null)
      },
    )
    await t.test(
      'failed provisioning does not leave an orphan company',
      async () => {
        await assert.rejects(
          createCompanyWorkspace('bob', {
            name: 'Collision',
            requestId: company,
          }),
        )
        assert.equal((await db.select().from(schema.company)).length, 3)
        assert.equal((await db.select().from(schema.organization)).length, 3)
      },
    )
    await t.test(
      'real Better Auth endpoints protect Personal and reject direct organization creation',
      async () => {
        const { auth } = await import('#/lib/auth/server')
        const { requirePracticeUser } = await import('./http')
        const context = await auth.$context
        // Exercise the same user/session lifecycle hooks used by signup/signin,
        // without sending verification mail or using application credentials.
        const newUser = await context.internalAdapter.createUser(
          {
            name: 'New learner',
            email: 'new-learner@example.test',
            emailVerified: false,
          },
          { method: 'email-password' },
        )
        const profile = await db.query.workspaceProfiles.findFirst({
          where: eq(schema.workspaceProfiles.personalOwnerUserId, newUser.id),
        })
        assert.ok(profile)
        await context.internalAdapter.createSession(newUser.id)
        await context.internalAdapter.createSession(newUser.id)
        const newSessions = await db.query.session.findMany({
          where: eq(schema.session.userId, newUser.id),
        })
        assert.equal(newSessions.length, 2)
        assert.ok(
          newSessions.every(
            (row) => row.activeOrganizationId === profile.workspaceId,
          ),
        )
        const newWorkspace = await db.query.organization.findFirst({
          where: eq(schema.organization.id, profile.workspaceId),
        })
        assert.ok(newWorkspace?.companyId)
        assert.equal(
          (
            await db
              .select()
              .from(schema.company)
              .where(eq(schema.company.id, newWorkspace.companyId))
          ).length,
          1,
        )
        // A trusted server call must use application provisioning as well.
        await assert.rejects(
          auth.api.createOrganization({
            body: { name: 'Bypass', slug: 'server-bypass', userId: 'alice' },
          }),
          (error: unknown) =>
            error instanceof Error &&
            'status' in error &&
            error.status === 'FORBIDDEN',
        )
        const token = randomUUID()
        await db.insert(schema.session).values({
          id: randomUUID(),
          token,
          userId: 'alice',
          activeOrganizationId: personal,
          expiresAt: new Date(Date.now() + 60_000),
        })
        const signed = `${token}.${createHmac('sha256', context.secret).update(token).digest('base64')}`
        const base = process.env.BETTER_AUTH_URL!
        const headers = new Headers({
          cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`,
          origin: base,
          'content-type': 'application/json',
          'x-workspace-id': personal,
        })
        assert.equal(
          (
            await requirePracticeUser(
              new Request(`${base}/api/practices`, { headers }),
            )
          ).workspaceId,
          personal,
        )
        headers.set('x-workspace-id', company)
        await assert.rejects(
          requirePracticeUser(
            new Request(`${base}/api/practices`, { headers }),
          ),
          (error: unknown) => error instanceof Response && error.status === 409,
        )
        headers.delete('x-workspace-id')
        await assert.rejects(
          requirePracticeUser(
            new Request(`${base}/api/practices`, { headers }),
          ),
          (error: unknown) => error instanceof Response && error.status === 400,
        )
        for (const [path, body] of [
          ['create', { name: 'Bypass', slug: 'bypass' }],
          ['update', { organizationId: personal, data: { name: 'Changed' } }],
          ['delete', { organizationId: personal }],
          [
            'invite-member',
            {
              organizationId: personal,
              email: 'invited@example.test',
              role: 'member',
            },
          ],
          ['leave', { organizationId: personal }],
        ] as const) {
          const response = await auth.handler(
            new Request(`${base}/api/auth/organization/${path}`, {
              method: 'POST',
              headers,
              body: JSON.stringify(body),
            }),
          )
          assert.equal(response.status, 403, path)
        }
        const switchResponse = await auth.handler(
          new Request(`${base}/api/auth/organization/set-active`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ organizationId: company }),
          }),
        )
        assert.equal(switchResponse.status, 200)
        const [original] = await db
          .select()
          .from(schema.organization)
          .where(eq(schema.organization.id, company))
        const updateResponse = await auth.handler(
          new Request(`${base}/api/auth/organization/update`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              organizationId: company,
              data: { name: 'Renamed team', companyId: newWorkspace.companyId },
            }),
          }),
        )
        assert.equal(updateResponse.status, 200)
        const [updated] = await db
          .select()
          .from(schema.organization)
          .where(eq(schema.organization.id, company))
        assert.equal(updated.name, 'Renamed team')
        assert.equal(
          updated.companyId,
          original.companyId,
          'Workspace owners cannot change the company parent',
        )
        headers.set('x-workspace-id', company)
        await assert.rejects(
          requirePracticeUser(
            new Request(`${base}/api/practices`, { headers }),
          ),
          (error: unknown) => error instanceof Response && error.status === 403,
        )
      },
    )
    const parsed = validateDraft(templateDraft()).result
    assert.ok(parsed.success)
    const input = parsed.data
    await db.insert(schema.competencies).values(
      input.scorecard.map((item) => ({
        code: item.competencyCode,
        name: item.competencyCode,
      })),
    )
    // Domain tests deliberately use a pending company: HTTP guard denies its use;
    // the domain must independently retain workspace isolation.
    const own = await saveCustomPractice('alice', personal, input, 'published')
    const other = await saveCustomPractice('alice', company, input, 'published')
    const bob = await saveCustomPractice('bob', bobPersonal, input, 'published')
    const global = await saveCustomPractice(
      'alice',
      personal,
      input,
      'published',
    )
    const globalRow = await db.query.practices.findFirst({
      where: eq(schema.practices.id, global.id),
    })
    assert.ok(globalRow)
    await db
      .update(schema.practices)
      .set({ workspaceId: null, createdByUserId: null, isGlobal: true })
      .where(eq(schema.practices.id, global.id))
    await db
      .update(schema.salesOfferings)
      .set({ workspaceId: null, isGlobal: true })
      .where(eq(schema.salesOfferings.id, globalRow.salesOfferingId))
    const orphan = await saveCustomPractice(
      'alice',
      personal,
      input,
      'published',
    )
    await db
      .update(schema.practices)
      .set({ workspaceId: null, createdByUserId: null })
      .where(eq(schema.practices.id, orphan.id))
    await t.test(
      'catalog includes explicit global plus own workspace; excludes orphan and other workspaces',
      async () => {
        assert.deepEqual(
          (await listLearnerPractices('alice', personal))
            .map((p) => p.id)
            .sort(),
          [own.id, global.id].sort(),
        )
        assert.deepEqual(
          (await listLearnerPractices('alice', company))
            .map((p) => p.id)
            .sort(),
          [other.id, global.id].sort(),
        )
        assert.deepEqual(
          (await listLearnerPractices('bob', bobPersonal))
            .map((p) => p.id)
            .sort(),
          [bob.id, global.id].sort(),
        )
        assert.equal(
          await getLearnerPractice(other.id, 'alice', personal),
          null,
        )
        assert.equal(await deleteCustomPractice(other.id, personal), null)
        assert.equal(await deleteCustomPractice(global.id, personal), null)
        // Personal workspaces cannot manage custom practices, even their own.
        assert.ok(
          (await listLearnerPractices('alice', personal)).every(
            (row) => !row.canDelete,
          ),
        )
      },
    )
    await t.test(
      'teammates share published practices; only owners and managers may delete',
      async () => {
        await db.insert(schema.member).values({
          id: randomUUID(),
          userId: 'bob',
          organizationId: company,
          role: 'member',
        })
        const catalog = await listLearnerPractices('bob', company)
        assert.deepEqual(
          catalog.map((row) => row.id).sort(),
          [other.id, global.id].sort(),
        )
        assert.equal(
          catalog.find((row) => row.id === other.id)?.canDelete,
          false,
        )
        assert.equal(
          (await listLearnerPractices('alice', company)).find(
            (row) => row.id === other.id,
          )?.canDelete,
          true,
        )
        assert.equal(
          catalog.find((row) => row.id === global.id)?.canDelete,
          false,
        )
        // Role is read on every request: promotion grants delete, demotion
        // takes it away again.
        const setBobRole = (role: string) =>
          db
            .update(schema.member)
            .set({ role })
            .where(
              and(
                eq(schema.member.userId, 'bob'),
                eq(schema.member.organizationId, company),
              ),
            )
        await setBobRole('admin')
        assert.equal(
          (await listLearnerPractices('bob', company)).find(
            (row) => row.id === other.id,
          )?.canDelete,
          true,
        )
        await setBobRole('member')
        assert.equal(
          (await listLearnerPractices('bob', company)).find(
            (row) => row.id === other.id,
          )?.canDelete,
          false,
        )
        assert.ok(await getLearnerPractice(other.id, 'bob', company))
        const call = await createPracticeSession('bob', other.id, company)
        assert.ok(call)
        assert.ok(
          await getOwnedSessionSnapshot({
            userId: 'bob',
            workspaceId: company,
            sessionId: call.id,
          }),
        )
        assert.equal(
          await getOwnedSessionSnapshot({
            userId: 'alice',
            workspaceId: company,
            sessionId: call.id,
          }),
          null,
        )
      },
    )
    await t.test(
      'a company can group workspaces without granting access between them',
      async () => {
        const sibling = await createCompanyWorkspace('alice', {
          name: 'Second sales team',
          requestId: randomUUID(),
        })
        const [parent] = await db
          .select()
          .from(schema.organization)
          .where(eq(schema.organization.id, company))
        await db
          .update(schema.organization)
          .set({ companyId: parent.companyId })
          .where(eq(schema.organization.id, sibling))
        const grouped = await db
          .select()
          .from(schema.organization)
          .where(eq(schema.organization.companyId, parent.companyId))
        assert.equal(grouped.length, 2)
        assert.equal(await getWorkspaceForUser('bob', sibling), null)
        assert.equal(await getLearnerPractice(other.id, 'alice', sibling), null)
        await assert.rejects(
          db
            .delete(schema.company)
            .where(eq(schema.company.id, parent.companyId)),
        )
      },
    )
    await t.test(
      'draft cannot be moved across workspaces or update another offering',
      async () => {
        const draft = await saveCustomPractice('alice', company, input, 'draft')
        await assert.rejects(
          saveCustomPractice('alice', personal, input, 'published', draft.id),
        )
        const draftRow = await db.query.practices.findFirst({
          where: eq(schema.practices.id, draft.id),
        })
        assert.ok(draftRow)
        await db
          .update(schema.practices)
          .set({ salesOfferingId: globalRow.salesOfferingId })
          .where(eq(schema.practices.id, draft.id))
        await assert.rejects(
          saveCustomPractice('alice', company, input, 'published', draft.id),
        )
      },
    )
    await t.test(
      'session creation and reads enforce workspace; cleanup follows stored workspace',
      async () => {
        assert.equal(
          await createPracticeSession('alice', other.id, personal),
          null,
        )
        const session = await createPracticeSession('alice', own.id, personal)
        assert.ok(session)
        assert.ok(
          await getOwnedSessionSnapshot({
            userId: 'alice',
            workspaceId: personal,
            sessionId: session.id,
          }),
        )
        assert.equal(
          await getOwnedSessionSnapshot({
            userId: 'alice',
            workspaceId: company,
            sessionId: session.id,
          }),
          null,
        )
        assert.equal(
          await getOwnedSessionSnapshot({
            userId: 'bob',
            workspaceId: personal,
            sessionId: session.id,
          }),
          null,
        )
        assert.equal(
          (
            await getOwnedSessionForCleanup({
              userId: 'alice',
              sessionId: session.id,
            })
          )?.workspaceId,
          personal,
        )
        assert.equal(
          await getOwnedSessionForCleanup({
            userId: 'bob',
            sessionId: session.id,
          }),
          null,
        )
      },
    )
    await t.test(
      'history, performance and deletion remain workspace-scoped',
      async () => {
        // Import after DATABASE_URL is redirected to this test's private schema.
        const { getPerformanceSummary } = await import('./performance')
        const calls = []
        for (const [workspaceId, practiceId] of [
          [personal, own.id],
          [company, other.id],
        ] as const) {
          const [call] = await db
            .insert(schema.practiceSessions)
            .values({
              userId: 'alice',
              workspaceId,
              practiceId,
              status: 'completed',
              completedAt: new Date(),
            })
            .returning()
          calls.push(call)
        }
        const [personalCall, companyCall] = calls
        const historyInput = practiceHistoryInputSchema.parse({})
        const history = await listOwnedPracticeSessions(
          'alice',
          historyInput,
          personal,
        )
        assert.ok(history.items.some((item) => item.id === personalCall.id))
        assert.ok(history.items.every((item) => item.id !== companyCall.id))
        const before = await getPerformanceSummary('alice', company, 'all')
        assert.equal(
          await deleteOwnedPracticeSession('alice', personalCall.id, company),
          'missing',
        )
        assert.ok(
          await getOwnedSessionSnapshot({
            userId: 'alice',
            workspaceId: personal,
            sessionId: personalCall.id,
          }),
        )
        assert.equal(
          await deleteOwnedPracticeSession('alice', personalCall.id, personal),
          'deleted',
        )
        assert.equal(
          await getOwnedSessionSnapshot({
            userId: 'alice',
            workspaceId: personal,
            sessionId: personalCall.id,
          }),
          null,
        )
        const after = await getPerformanceSummary('alice', company, 'all')
        assert.equal(before.activity.completedSessions, 1)
        assert.deepEqual(after.activity, before.activity)
        assert.deepEqual(after.skills, before.skills)
        assert.deepEqual(after.focus, before.focus)
        assert.ok(
          !(
            await listOwnedPracticeSessions('alice', historyInput, personal)
          ).items.some((item) => item.id === personalCall.id),
        )
      },
    )
    await t.test(
      'progress and recommendations stay separate for the same user',
      async () => {
        const competency = (await db.select().from(schema.competencies))[0]
        const mapping = (
          await db
            .select()
            .from(schema.practiceCompetencies)
            .where(eq(schema.practiceCompetencies.competencyId, competency.id))
        )[0]
        const { evaluatePracticeSessionUnlocked } =
          await import('./practice-evaluation')
        for (const [workspaceId, practiceId, score] of [
          [personal, own.id, 20],
          [company, other.id, 90],
        ] as const) {
          const [call] = await db
            .insert(schema.practiceSessions)
            .values({
              userId: 'alice',
              workspaceId,
              practiceId,
              status: 'completed',
              completedAt: new Date(),
            })
            .returning()
          await db.insert(schema.practiceSessionEvaluations).values({
            sessionId: call.id,
            overallScore: score,
            assessmentCoverage: {
              assessedCount: 1,
              totalCount: 1,
              weightedPercent: 100,
            },
            summary: 'Test',
            summaryFindings: [],
            objectiveEvidence: [],
            strengths: [],
            improvements: [],
          })
          await db.insert(schema.practiceSessionCompetencyScores).values({
            sessionId: call.id,
            competencyId: competency.id,
            score,
            assessmentStatus: 'observed',
            evidence: [],
            findings: [],
            scoringRubric: mapping.rubric,
          })
          await evaluatePracticeSessionUnlocked(call.id)
          await evaluatePracticeSessionUnlocked(call.id)
          assert.equal(
            (await getCompetencyProfiles('alice', workspaceId))[0]
              .assessedSessionCount,
            1,
            'Retry must not double count evidence',
          )
        }
        assert.equal(
          (await getCompetencyProfiles('alice', personal))[0].masteryScore,
          20,
        )
        assert.equal(
          (await getCompetencyProfiles('alice', company))[0].masteryScore,
          90,
        )
        assert.equal(
          (await getCompetencyProfiles('bob', bobPersonal)).length,
          0,
        )
        const recommendations = await getPracticeRecommendations(
          'alice',
          personal,
        )
        assert.ok(
          recommendations.every(
            (p) => p.practice.id === own.id || p.practice.id === global.id,
          ),
        )
      },
    )
    await t.test(
      'revoked company membership denies access immediately',
      async () => {
        await db
          .delete(schema.member)
          .where(
            and(
              eq(schema.member.userId, 'alice'),
              eq(schema.member.organizationId, company),
            ),
          )
        assert.equal(await getWorkspaceForUser('alice', company), null)
      },
    )
  },
)
