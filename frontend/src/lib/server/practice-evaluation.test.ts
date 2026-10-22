import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { templateDraft } from '#/lib/practice/workbook'
import { validateDraft } from '#/lib/practice/authoring'
import { createServer } from 'node:http'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import * as schema from '#/db/schema'

test(
  'profile evidence claims are retry-safe and roll back with profile writes',
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
    const root = mkdtempSync(join(tmpdir(), 'practice-profile-'))
    const data = join(root, 'data')
    let started = false
    const resources: { pool?: { end: () => Promise<void> } } = {}
    const overrides = {
      DATABASE_URL: `postgresql://profile_test@localhost/postgres?host=${encodeURIComponent(root)}`,
      BETTER_AUTH_URL: 'http://localhost:4500',
      BETTER_AUTH_SECRET: 'isolated-test',
      SMTP_USER: 'isolated-test',
      SMTP_PASSWORD: 'isolated-test',
      VOICE_BACKEND_INTERNAL_URL: 'http://localhost:1',
      VOICE_BACKEND_PUBLIC_URL: 'http://localhost:1',
      VOICE_CONTROL_API_KEY: 'isolated-test-key'.repeat(3),
      VOICE_TOKEN_SECRET: 'isolated-test-key'.repeat(3),
      VOICE_EVENT_INGEST_KEY: 'isolated-test-key'.repeat(3),
    }
    const previous = Object.fromEntries(
      Object.keys(overrides).map((key) => [key, process.env[key]]),
    )
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
      ['-D', data, '-A', 'trust', '-U', 'profile_test', '--no-locale'],
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
    // Exercise the module initialization boundary after installing isolated DB/env settings.
    // Static imports would construct the application pool and validate env before setup.
    const { db } = await import('#/db')
    resources.pool = db.$client
    const { evaluatePracticeSessionUnlocked } =
      await import('./practice-evaluation')
    const { getCompetencyProfiles, getPracticeRecommendations } =
      await import('./practice-recommendations')
    const { applySessionProfileEvidence } = await import('./learner-profile')
    const {
      deleteOwnedPracticeSession,
      withSessionOperation,
      SessionOperationBusyError,
      getOwnedSessionSnapshot,
      getOwnedSessionFeedback,
      createPracticeSession,
    } = await import('./practice-sessions')
    const ddl = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(schema),
    )
    for (const statement of ddl) await db.$client.query(statement)
    await db.insert(schema.user).values({
      id: 'learner',
      name: 'Learner',
      email: 'learner@example.test',
      roles: [],
    })
    const { ensurePersonalWorkspace, createCompanyWorkspace } =
      await import('./workspaces')
    const workspaceId = await ensurePersonalWorkspace('learner')
    const [offering] = await db
      .insert(schema.salesOfferings)
      .values({
        name: 'Test offering',
        isGlobal: true,
        offering: {
          productType: 'apartment',
          projectName: 'Test',
          location: { district: 'Test', city: 'Test' },
          unit: { areaM2: 70 },
          price: { amount: 2_000_000_000, currency: 'VND' },
          paymentPlan: { summary: 'Test' },
          keyStrengths: ['Test'],
          keyWeaknesses: ['Test'],
        },
      })
      .returning()
    const [practice] = await db
      .insert(schema.practices)
      .values({
        slug: 'profile-test',
        isGlobal: true,
        type: 'cold_call',
        title: 'Test',
        difficulty: 'beginner',
        salesOfferingId: offering.id,
        learnerBrief: { background: 'Test', objective: 'Test' },
      })
      .returning()
    const [competency] = await db
      .insert(schema.competencies)
      .values({ code: 'needs_discovery', name: 'Discovery' })
      .returning()
    const [secondary] = await db
      .insert(schema.competencies)
      .values({ code: 'next_step_closing', name: 'Next step' })
      .returning()
    const input = validateDraft(templateDraft()).result
    assert.ok(input.success)
    const scoringRubrics = input.data.scorecard.map((item) => item.rubric)
    await db
      .insert(schema.practiceAgentConfigs)
      .values({ practiceId: practice.id, config: input.data.config })
    await db
      .update(schema.practices)
      .set({ learnerBrief: input.data.learnerBrief })
      .where(eq(schema.practices.id, practice.id))
    await db.insert(schema.practiceCompetencies).values([
      {
        practiceId: practice.id,
        competencyId: competency.id,
        weight: 20,
        rubric: input.data.scorecard[0].rubric,
      },
      {
        practiceId: practice.id,
        competencyId: secondary.id,
        weight: 80,
        rubric: input.data.scorecard[1].rubric,
      },
    ])
    async function completedSession(
      score: number,
      extraScore = false,
      practiceId = practice.id,
      sessionWorkspaceId = workspaceId,
    ) {
      const completedAt = new Date('2026-10-04T12:00:00Z')
      const [session] = await db
        .insert(schema.practiceSessions)
        .values({
          userId: 'learner',
          workspaceId: sessionWorkspaceId,
          practiceId,
          status: 'completed',
          completedAt,
        })
        .returning()
      await db.insert(schema.practiceSessionEvaluations).values({
        sessionId: session.id,
        overallScore: score,
        assessmentCoverage: {
          assessedCount: extraScore ? 2 : 1,
          totalCount: extraScore ? 2 : 1,
          weightedPercent: 100,
        },
        summary: 'Valid evaluation',
        summaryFindings: [],
        objectiveEvidence: [],
        strengths: [],
        improvements: [],
      })
      await db.insert(schema.practiceSessionCompetencyScores).values([
        {
          sessionId: session.id,
          competencyId: competency.id,
          score,
          assessmentStatus: 'observed' as const,
          evidence: [{ turnNumber: 1, observation: 'Asked a question' }],
          findings: [],
          scoringRubric: scoringRubrics[0],
        },
        ...(extraScore
          ? [
              {
                sessionId: session.id,
                competencyId: secondary.id,
                score: 60,
                assessmentStatus: 'observed' as const,
                evidence: [
                  { turnNumber: 1, observation: 'Agreed a next step' },
                ],
                findings: [],
                scoringRubric: scoringRubrics[1],
              },
            ]
          : []),
      ])
      return session
    }
    const first = await completedSession(80)
    await Promise.all([
      evaluatePracticeSessionUnlocked(first.id),
      evaluatePracticeSessionUnlocked(first.id),
      evaluatePracticeSessionUnlocked(first.id),
    ])
    await evaluatePracticeSessionUnlocked(first.id)
    let profiles = await getCompetencyProfiles('learner', workspaceId)
    assert.equal(profiles[0].masteryScore, 80)
    assert.equal(profiles[0].assessedSessionCount, 1)
    assert.equal(profiles[0].scenarioCount, 1)
    assert.equal(
      profiles[0].lastPracticedAt?.toISOString(),
      first.completedAt?.toISOString(),
    )
    const firstScore = await db.query.practiceSessionCompetencyScores.findFirst(
      { where: eq(schema.practiceSessionCompetencyScores.sessionId, first.id) },
    )
    assert.ok(firstScore?.profileAppliedAt)

    await t.test(
      'profile application, coverage and deletion rebuild stay in their workspace',
      async () => {
        const companyWorkspaceId = await createCompanyWorkspace('learner', {
          name: 'Profile isolation company',
          requestId: randomUUID(),
        })
        const companyFirst = await completedSession(
          20,
          false,
          practice.id,
          companyWorkspaceId,
        )
        await applySessionProfileEvidence(
          companyFirst.id,
          'learner',
          workspaceId,
        )
        assert.deepEqual(
          await getCompetencyProfiles('learner', companyWorkspaceId),
          [],
        )
        await evaluatePracticeSessionUnlocked(companyFirst.id)
        const futureAppliedAt = new Date('2099-01-01T00:00:00Z')
        await db
          .update(schema.practiceSessionCompetencyScores)
          .set({ profileAppliedAt: futureAppliedAt })
          .where(
            eq(
              schema.practiceSessionCompetencyScores.sessionId,
              companyFirst.id,
            ),
          )
        const companySecond = await completedSession(
          60,
          false,
          practice.id,
          companyWorkspaceId,
        )
        await evaluatePracticeSessionUnlocked(companySecond.id)
        const [companyProfile] = await getCompetencyProfiles(
          'learner',
          companyWorkspaceId,
        )
        assert.equal(companyProfile.masteryScore, 30)
        assert.equal(companyProfile.assessedSessionCount, 2)
        assert.equal(companyProfile.scenarioCount, 1)
        assert.deepEqual(
          await getCompetencyProfiles('learner', workspaceId),
          profiles,
        )

        const personalLater = await completedSession(100)
        await evaluatePracticeSessionUnlocked(personalLater.id)
        const personalScore =
          await db.query.practiceSessionCompetencyScores.findFirst({
            where: eq(
              schema.practiceSessionCompetencyScores.sessionId,
              personalLater.id,
            ),
          })
        assert.ok(personalScore?.profileAppliedAt)
        assert.ok(personalScore.profileAppliedAt < futureAppliedAt)
        await deleteOwnedPracticeSession(
          'learner',
          personalLater.id,
          workspaceId,
        )
        assert.deepEqual(
          await getCompetencyProfiles('learner', workspaceId),
          profiles,
        )

        assert.equal(
          await deleteOwnedPracticeSession(
            'learner',
            companyFirst.id,
            workspaceId,
          ),
          'missing',
        )
        await deleteOwnedPracticeSession(
          'learner',
          companyFirst.id,
          companyWorkspaceId,
        )
        const [rebuiltCompany] = await getCompetencyProfiles(
          'learner',
          companyWorkspaceId,
        )
        assert.equal(rebuiltCompany.masteryScore, 60)
        assert.equal(rebuiltCompany.assessedSessionCount, 1)
        assert.deepEqual(
          await getCompetencyProfiles('learner', workspaceId),
          profiles,
        )
        await deleteOwnedPracticeSession(
          'learner',
          companySecond.id,
          companyWorkspaceId,
        )
        assert.deepEqual(
          await getCompetencyProfiles('learner', companyWorkspaceId),
          [],
        )
        assert.deepEqual(
          await getCompetencyProfiles('learner', workspaceId),
          profiles,
        )
      },
    )

    await t.test(
      'coverage counts assessments, not confidence or observations',
      async () => {
        await db
          .update(schema.practices)
          .set({ status: 'published' })
          .where(eq(schema.practices.id, practice.id))
        const recommendations = await getPracticeRecommendations(
          'learner',
          workspaceId,
        )
        // Discovery need = 20, unassessed closing need = 50, recent penalty = 50.
        assert.equal(
          recommendations.find((item) => item.practice.id === practice.id)!
            .priority,
          0,
        )
        await db
          .update(schema.practices)
          .set({ status: practice.status })
          .where(eq(schema.practices.id, practice.id))

        const [otherPractice] = await db
          .insert(schema.practices)
          .values({
            slug: 'coverage-test',
            isGlobal: true,
            type: 'cold_call',
            title: 'Coverage scenario',
            difficulty: 'beginner',
            salesOfferingId: offering.id,
            learnerBrief: practice.learnerBrief,
          })
          .returning()
        const repeated = await completedSession(0)
        const varied = await completedSession(100, false, otherPractice.id)
        // No supporting observations: these remain assessments, not validated evidence.
        await db
          .update(schema.practiceSessionCompetencyScores)
          .set({ evidence: [] })
          .where(
            inArray(schema.practiceSessionCompetencyScores.sessionId, [
              repeated.id,
              varied.id,
            ]),
          )
        await evaluatePracticeSessionUnlocked(repeated.id)
        await evaluatePracticeSessionUnlocked(varied.id)

        await db.insert(schema.user).values({
          id: 'coverage-other',
          name: 'Other learner',
          email: 'coverage@example.test',
          roles: [],
        })
        const excluded = await db
          .insert(schema.practiceSessions)
          .values([
            {
              userId: 'learner',
              workspaceId,
              practiceId: otherPractice.id,
              status: 'completed' as const,
            },
            {
              userId: 'learner',
              workspaceId,
              practiceId: otherPractice.id,
              status: 'completed' as const,
              deletedAt: new Date(),
            },
            {
              userId: 'learner',
              workspaceId,
              practiceId: otherPractice.id,
              status: 'in_progress' as const,
            },
            {
              userId: 'coverage-other',
              workspaceId,
              practiceId: otherPractice.id,
              status: 'completed' as const,
            },
            {
              userId: 'learner',
              workspaceId,
              practiceId: otherPractice.id,
              status: 'completed' as const,
            },
          ])
          .returning()
        await db.insert(schema.practiceSessionCompetencyScores).values(
          excluded.map((session, index) => ({
            sessionId: session.id,
            competencyId: competency.id,
            score: index === 4 ? null : 80,
            assessmentStatus:
              index === 4 ? ('not_assessed' as const) : ('observed' as const),
            profileAppliedAt: index === 0 ? null : new Date(),
            findings: [],
            scoringRubric: input.data.scorecard[0].rubric,
          })),
        )
        // A stale aggregate must not determine the API's assessment coverage.
        await db
          .update(schema.learnerCompetencyProfiles)
          .set({ evidenceCount: 99 })
          .where(
            eq(schema.learnerCompetencyProfiles.competencyId, competency.id),
          )
        const [coverage] = await getCompetencyProfiles('learner', workspaceId)
        assert.equal(coverage.assessedSessionCount, 3)
        assert.equal(coverage.scenarioCount, 2)
        assert.equal(coverage.evidenceLabel, 'Limited evidence')
        assert.equal(
          coverage.assessmentSummary,
          'Assessed in 3 sessions across 2 practice scenarios.',
        )
        assert.equal('confidence' in coverage, false)
        assert.equal('evidenceCount' in coverage, false)
        await db.delete(schema.practiceSessions).where(
          inArray(
            schema.practiceSessions.id,
            excluded.map((session) => session.id),
          ),
        )
        await db.delete(schema.user).where(eq(schema.user.id, 'coverage-other'))
        await deleteOwnedPracticeSession('learner', varied.id, workspaceId)
        const [remaining] = await getCompetencyProfiles('learner', workspaceId)
        assert.equal(remaining.assessedSessionCount, 2)
        assert.equal(remaining.scenarioCount, 1)
        await deleteOwnedPracticeSession('learner', repeated.id, workspaceId)
        assert.deepEqual(
          await getCompetencyProfiles('learner', workspaceId),
          profiles,
        )
        await db.insert(schema.learnerCompetencyProfiles).values({
          userId: 'learner',
          workspaceId,
          competencyId: secondary.id,
          masteryScore: 60,
          evidenceCount: 99,
        })
        const emptyCoverage = (
          await getCompetencyProfiles('learner', workspaceId)
        ).find((item) => item.code === secondary.code)!
        assert.equal(emptyCoverage.assessedSessionCount, 0)
        assert.equal(emptyCoverage.scenarioCount, 0)
        await db
          .delete(schema.learnerCompetencyProfiles)
          .where(
            eq(schema.learnerCompetencyProfiles.competencyId, secondary.id),
          )
      },
    )

    // A failure after the score claim must not lose the evidence or invalidate the evaluation.
    const retry = await completedSession(40, true)
    await db.$client.query(
      `create function reject_profile_update() returns trigger language plpgsql as $$ begin if NEW.competency_id = '${secondary.id}'::uuid then raise exception 'profile write unavailable'; end if; return NEW; end $$`,
    )
    await db.$client.query(
      `create trigger reject_profile_update before insert or update on learner_competency_profiles for each row execute function reject_profile_update()`,
    )
    const result = await evaluatePracticeSessionUnlocked(retry.id)
    assert.equal(result.sessionId, retry.id)
    assert.equal(result.overallScore, 40)
    const rolledBack = await db
      .select()
      .from(schema.practiceSessionCompetencyScores)
      .where(eq(schema.practiceSessionCompetencyScores.sessionId, retry.id))
    assert.ok(rolledBack.every((score) => score.profileAppliedAt === null))
    profiles = await getCompetencyProfiles('learner', workspaceId)
    assert.equal(profiles.length, 1)
    assert.equal(profiles[0].assessedSessionCount, 1)
    assert.equal(profiles[0].masteryScore, 80)
    await db.$client.query(
      'drop trigger reject_profile_update on learner_competency_profiles',
    )
    await Promise.all([
      evaluatePracticeSessionUnlocked(retry.id),
      evaluatePracticeSessionUnlocked(retry.id),
    ])
    profiles = await getCompetencyProfiles('learner', workspaceId)
    const discovery = profiles.find(
      (profile) => profile.code === 'needs_discovery',
    )!
    assert.equal(discovery.assessedSessionCount, 2)
    assert.equal(discovery.scenarioCount, 1)
    assert.equal(discovery.masteryScore, 70)
    const closing = profiles.find(
      (profile) => profile.code === 'next_step_closing',
    )!
    assert.equal(closing.assessedSessionCount, 1)
    assert.equal(closing.masteryScore, 60)
    const applied = await db
      .select()
      .from(schema.practiceSessionCompetencyScores)
      .where(eq(schema.practiceSessionCompetencyScores.sessionId, retry.id))
    assert.ok(applied.every((score) => score.profileAppliedAt instanceof Date))
    const laterSessions: string[] = []
    for (const [score, mastery] of [
      [100, 78],
      [0, 59],
      [80, 64],
    ]) {
      const session = await completedSession(score)
      await evaluatePracticeSessionUnlocked(session.id)
      laterSessions.push(session.id)
      const profile = (
        await getCompetencyProfiles('learner', workspaceId)
      ).find((item) => item.code === 'needs_discovery')!
      assert.equal(profile.masteryScore, mastery)
    }
    // Exercise evaluation persistence and feedback over the real HTTP/SQL boundaries.
    let status: 'not_assessed' | 'opportunity_missed' | 'observed' = 'observed'
    let failNextEvaluation = false
    const evaluationRequests: Record<string, unknown>[] = []
    const evaluator = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      evaluationRequests.push(
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
      )
      response.setHeader('content-type', 'application/json')
      if (failNextEvaluation) {
        failNextEvaluation = false
        response.statusCode = 502
        response.end(JSON.stringify({ detail: 'provider unavailable' }))
        return
      }
      response.end(
        JSON.stringify({
          discoveredInsightKeys: [],
          missedInsightKeys: input.data.config.hiddenInsights.map(
            (item) => item.key,
          ),
          objectiveEvidence: [],
          objectionOutcomes: input.data.config.objections.map((item) => ({
            key: item.key,
            raised: false,
            evidence: [],
          })),
          competencyAssessments: [
            {
              competencyCode: competency.code,
              assessmentStatus: status,
              findings:
                status === 'not_assessed'
                  ? []
                  : [
                      {
                        id: 'needs_finding',
                        kind:
                          status === 'opportunity_missed'
                            ? 'opportunity_missed'
                            : 'demonstrated',
                        behaviorId:
                          input.data.scorecard[0].rubric.behaviors[0].id,
                        rationale:
                          status === 'opportunity_missed'
                            ? 'Buyer invited discovery; learner changed subject.'
                            : 'Learner asked about needs.',
                        evidence:
                          status === 'opportunity_missed'
                            ? [
                                {
                                  turnNumber: 1,
                                  observation: 'Buyer asked about needs.',
                                },
                                {
                                  turnNumber: 2,
                                  observation: 'Learner changed subject.',
                                },
                              ]
                            : [
                                {
                                  turnNumber: 1,
                                  observation: 'Learner asked about needs.',
                                },
                              ],
                        opportunityTurnNumbers:
                          status === 'opportunity_missed' ? [1] : [],
                        responseTurnNumbers:
                          status === 'opportunity_missed' ? [2] : [],
                      },
                    ],
            },
            {
              competencyCode: secondary.code,
              assessmentStatus: 'not_assessed',
              findings: [],
            },
          ],
        }),
      )
    })
    await new Promise<void>((resolve) =>
      evaluator.listen(0, '127.0.0.1', resolve),
    )
    t.after(
      () =>
        new Promise<void>((resolve, reject) =>
          evaluator.close((error) => (error ? reject(error) : resolve())),
        ),
    )
    const address = evaluator.address()
    assert.ok(address && typeof address !== 'string')
    // Static env import would validate before isolated settings are installed.
    const { env } = await import('#/env')
    t.after(() => {
      Object.assign(env, {
        VOICE_BACKEND_INTERNAL_URL: overrides.VOICE_BACKEND_INTERNAL_URL,
      })
    })
    Object.assign(env, {
      VOICE_BACKEND_INTERNAL_URL: `http://127.0.0.1:${address.port}`,
    })
    await t.test(
      'sessions retain practice references and grading retries finalized input',
      async () => {
        await db
          .update(schema.practices)
          .set({ status: 'published' })
          .where(eq(schema.practices.id, practice.id))
        const created = await createPracticeSession(
          'learner',
          practice.id,
          workspaceId,
        )
        assert.ok(created)
        const session = await db.query.practiceSessions.findFirst({
          where: eq(schema.practiceSessions.id, created.id),
        })
        assert.equal(session?.practiceId, practice.id)
        const visible = await getOwnedSessionSnapshot({
          userId: 'learner',
          sessionId: created.id,
          workspaceId,
        })
        assert.equal(visible?.practice?.title, practice.title)
        assert.equal(JSON.stringify(visible).includes('hiddenInsights'), false)
        assert.equal(JSON.stringify(visible).includes('rubric'), false)
        await db.insert(schema.practiceSessionTurns).values({
          sessionId: created.id,
          sequence: 1,
          speaker: 'salesperson',
          text: 'Final transcript',
        })
        await db
          .update(schema.practiceSessions)
          .set({ status: 'completed', completedAt: new Date() })
          .where(eq(schema.practiceSessions.id, created.id))
        status = 'not_assessed'
        failNextEvaluation = true
        await assert.rejects(
          withSessionOperation(created.id, () =>
            evaluatePracticeSessionUnlocked(created.id),
          ),
          /502/,
        )
        assert.equal(
          await db.query.practiceSessionEvaluations.findFirst({
            where: eq(schema.practiceSessionEvaluations.sessionId, created.id),
          }),
          undefined,
        )
        const firstRequest = evaluationRequests.at(-1)
        await withSessionOperation(created.id, () =>
          evaluatePracticeSessionUnlocked(created.id),
        )
        assert.deepEqual(evaluationRequests.at(-1), firstRequest)
        assert.deepEqual(firstRequest?.turns, [
          { sequence: 1, speaker: 'user', text: 'Final transcript' },
        ])
        assert.deepEqual(firstRequest.agentConfig, input.data.config)
        await deleteOwnedPracticeSession('learner', created.id, workspaceId)
        await db
          .update(schema.practices)
          .set({ status: practice.status })
          .where(eq(schema.practices.id, practice.id))
      },
    )
    const closingBefore = (
      await getCompetencyProfiles('learner', workspaceId)
    ).find((item) => item.code === secondary.code)!
    let discoveryBefore = (
      await getCompetencyProfiles('learner', workspaceId)
    ).find((item) => item.code === competency.code)!
    const partialSessions: string[] = []
    for (const assessmentStatus of [
      'observed',
      'opportunity_missed',
      'not_assessed',
    ] as const) {
      status = assessmentStatus
      const [session] = await db
        .insert(schema.practiceSessions)
        .values({
          userId: 'learner',
          workspaceId,
          practiceId: practice.id,
          status: 'completed',
          completedAt: new Date(),
        })
        .returning()
      await db.insert(schema.practiceSessionTurns).values({
        sessionId: session.id,
        sequence: 1,
        speaker: status === 'observed' ? 'salesperson' : 'buyer',
        text:
          status === 'observed'
            ? 'What are your needs?'
            : 'What is the next step?',
      })
      if (status === 'opportunity_missed')
        await db.insert(schema.practiceSessionTurns).values({
          sessionId: session.id,
          sequence: 2,
          speaker: 'salesperson',
          text: 'Let us talk about the location instead.',
        })
      const evaluation = await evaluatePracticeSessionUnlocked(session.id)
      assert.equal(
        evaluation.overallScore,
        status === 'not_assessed'
          ? null
          : status === 'opportunity_missed'
            ? 0
            : 40,
      )
      assert.deepEqual(evaluation.assessmentCoverage, {
        assessedCount: status === 'not_assessed' ? 0 : 1,
        totalCount: 2,
        weightedPercent: status === 'not_assessed' ? 0 : 20,
      })
      await evaluatePracticeSessionUnlocked(session.id)
      partialSessions.push(session.id)
      const scoreRows = await db
        .select()
        .from(schema.practiceSessionCompetencyScores)
        .where(eq(schema.practiceSessionCompetencyScores.sessionId, session.id))
      for (const row of scoreRows) {
        if (row.assessmentStatus === 'not_assessed') {
          assert.equal(row.score, null)
          assert.equal(row.profileAppliedAt, null)
        } else {
          assert.ok(row.profileAppliedAt instanceof Date)
        }
      }
      const feedback = await getOwnedSessionFeedback({
        userId: 'learner',
        sessionId: session.id,
        workspaceId,
      })
      assert.ok(feedback?.state === 'ready')
      assert.equal(
        feedback.competencyScores.find((item) => item.code === secondary.code)
          ?.score,
        null,
      )
      assert.equal(feedback.overallScore, evaluation.overallScore)
      const currentProfiles = await getCompetencyProfiles(
        'learner',
        workspaceId,
      )
      assert.deepEqual(
        currentProfiles.find((item) => item.code === secondary.code),
        closingBefore,
      )
      const discoveryNow = currentProfiles.find(
        (item) => item.code === competency.code,
      )!
      if (status === 'not_assessed')
        assert.deepEqual(discoveryNow, discoveryBefore)
      else {
        assert.equal(
          discoveryNow.assessedSessionCount,
          discoveryBefore.assessedSessionCount + 1,
        )
        assert.equal(
          discoveryNow.masteryScore,
          Math.round(
            discoveryBefore.masteryScore! * 0.75 +
              (status === 'observed' ? 40 : 0) * 0.25,
          ),
        )
      }
      discoveryBefore = discoveryNow
    }
    // Remove assessment-loop evidence before exercising the original history fold.
    for (const sessionId of partialSessions)
      await deleteOwnedPracticeSession('learner', sessionId, workspaceId)
    const restoredProfiles = await getCompetencyProfiles('learner', workspaceId)
    assert.deepEqual(
      restoredProfiles.find((item) => item.code === secondary.code),
      closingBefore,
    )
    const restoredDiscovery = restoredProfiles.find(
      (item) => item.code === competency.code,
    )!
    assert.equal(restoredDiscovery.masteryScore, 64)
    assert.equal(restoredDiscovery.assessedSessionCount, 5)

    await t.test(
      'deletion rebuilds applied evidence and retains hidden results',
      async () => {
        assert.equal(
          await deleteOwnedPracticeSession('other', retry.id, workspaceId),
          'missing',
        )
        const [unfinished] = await db
          .insert(schema.practiceSessions)
          .values({
            userId: 'learner',
            workspaceId,
            practiceId: practice.id,
          })
          .returning()
        assert.equal(
          await deleteOwnedPracticeSession(
            'learner',
            unfinished.id,
            workspaceId,
          ),
          'unfinished',
        )
        await withSessionOperation(retry.id, async () => {
          await assert.rejects(
            deleteOwnedPracticeSession('learner', retry.id, workspaceId),
            SessionOperationBusyError,
          )
        })
        assert.equal(
          await deleteOwnedPracticeSession('learner', retry.id, workspaceId),
          'deleted',
        )
        // Remaining evidence: 80 -> 100 -> 0 -> 80 = 68, not the original 64.
        let current = await getCompetencyProfiles('learner', workspaceId)
        assert.equal(current.length, 1)
        assert.equal(current[0].masteryScore, 68)
        assert.equal(current[0].assessedSessionCount, 4)
        assert.equal(current[0].scenarioCount, 1)
        assert.equal(
          await getOwnedSessionSnapshot({
            userId: 'learner',
            sessionId: retry.id,
            workspaceId,
          }),
          null,
        )
        assert.equal(
          await getOwnedSessionFeedback({
            userId: 'learner',
            sessionId: retry.id,
            workspaceId,
          }),
          null,
        )
        assert.ok(
          (
            await db.query.practiceSessions.findFirst({
              where: eq(schema.practiceSessions.id, retry.id),
            })
          )?.deletedAt,
        )
        assert.ok(
          await db.query.practiceSessionEvaluations.findFirst({
            where: eq(schema.practiceSessionEvaluations.sessionId, retry.id),
          }),
        )
        await assert.rejects(
          evaluatePracticeSessionUnlocked(retry.id),
          /Session is not completed/,
        )
        assert.equal(
          await deleteOwnedPracticeSession('learner', retry.id, workspaceId),
          'deleted',
        )
        assert.equal(
          (await getCompetencyProfiles('learner', workspaceId))[0]
            .assessedSessionCount,
          4,
        )
        // First evidence removal re-seeds the fold; latest removal restores the prior fold.
        await deleteOwnedPracticeSession('learner', first.id, workspaceId)
        assert.equal(
          (await getCompetencyProfiles('learner', workspaceId))[0].masteryScore,
          76,
        )
        await deleteOwnedPracticeSession(
          'learner',
          laterSessions[2],
          workspaceId,
        )
        assert.equal(
          (await getCompetencyProfiles('learner', workspaceId))[0].masteryScore,
          75,
        )
        for (const id of laterSessions.slice(0, 2))
          await deleteOwnedPracticeSession('learner', id, workspaceId)
        current = await getCompetencyProfiles('learner', workspaceId)
        assert.deepEqual(current, [])
      },
    )

    await t.test('profile rebuild failure rolls back deletion', async () => {
      const keep = await completedSession(80)
      const remove = await completedSession(40)
      await evaluatePracticeSessionUnlocked(keep.id)
      await evaluatePracticeSessionUnlocked(remove.id)
      await db.$client.query(
        `create trigger reject_profile_update before insert or update on learner_competency_profiles for each row execute function reject_profile_update()`,
      )
      // Replace the existing trigger function so rebuilding the primary profile fails.
      await db.$client.query(
        `create or replace function reject_profile_update() returns trigger language plpgsql as $$ begin raise exception 'profile write unavailable'; end $$`,
      )
      await assert.rejects(
        deleteOwnedPracticeSession('learner', remove.id, workspaceId),
        (error: unknown) =>
          error instanceof Error &&
          (error.cause as { code?: string } | undefined)?.code === 'P0001',
      )
      assert.equal(
        (
          await db.query.practiceSessions.findFirst({
            where: eq(schema.practiceSessions.id, remove.id),
          })
        )?.deletedAt,
        null,
      )
      assert.equal(
        (await getCompetencyProfiles('learner', workspaceId))[0].masteryScore,
        70,
      )
      await db.$client.query(
        'drop trigger reject_profile_update on learner_competency_profiles',
      )
      await deleteOwnedPracticeSession('learner', remove.id, workspaceId)
      assert.equal(
        (await getCompetencyProfiles('learner', workspaceId))[0].masteryScore,
        80,
      )
      await deleteOwnedPracticeSession('learner', keep.id, workspaceId)
    })

    await t.test(
      'deletion and grading of another session serialize without lost evidence',
      async () => {
        const old = await completedSession(80)
        const fresh = await completedSession(40, true)
        await evaluatePracticeSessionUnlocked(old.id)
        await Promise.all([
          deleteOwnedPracticeSession('learner', old.id, workspaceId),
          evaluatePracticeSessionUnlocked(fresh.id),
        ])
        const current = await getCompetencyProfiles('learner', workspaceId)
        assert.equal(
          current.find((item) => item.code === 'needs_discovery')?.masteryScore,
          40,
        )
        assert.equal(
          current.find((item) => item.code === 'needs_discovery')
            ?.assessedSessionCount,
          1,
        )
        assert.equal(
          current.find((item) => item.code === 'next_step_closing')
            ?.masteryScore,
          60,
        )
        const [ungraded] = await db
          .insert(schema.practiceSessions)
          .values({
            userId: 'learner',
            workspaceId,
            practiceId: practice.id,
            status: 'abandoned',
          })
          .returning()
        await deleteOwnedPracticeSession('learner', ungraded.id, workspaceId)
        assert.deepEqual(
          await getCompetencyProfiles('learner', workspaceId),
          current,
        )
      },
    )
  },
)
