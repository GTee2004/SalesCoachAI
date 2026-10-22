import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Pool } from 'pg'
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import * as schema from '#/db/schema'

// Opt-in PostgreSQL integration for the seat history: every assignment is a
// stint that is closed, never reopened. Every object lives in a fresh private
// schema that is dropped afterwards, and SePay is stubbed.
test(
  'seat stints record who held each seat and why it changed',
  { timeout: 120_000 },
  async (t) => {
    const connection = process.env.BILLING_TEST_DATABASE_URL
    if (!connection) {
      t.skip('Set BILLING_TEST_DATABASE_URL to a throwaway test database')
      return
    }
    const url = new URL(connection)
    assert.match(
      decodeURIComponent(url.pathname),
      /_test$/,
      'Use a database whose name ends in _test',
    )
    const namespace = `seat_history_test_${randomUUID().replaceAll('-', '')}`
    url.searchParams.set('options', `-c search_path=${namespace}`)
    const admin = new Pool({ connectionString: url.toString() })
    const overrides = {
      DATABASE_URL: url.toString(),
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
      SEPAY_ENV: 'sandbox',
      SEPAY_MERCHANT_ID: 'isolated-merchant',
      SEPAY_SECRET_KEY: 'isolated-secret',
      SEPAY_IPN_SECRET: 'isolated-ipn',
    }
    const previous = Object.fromEntries(
      Object.keys(overrides).map((key) => [key, process.env[key]]),
    )
    const previousFetch = globalThis.fetch
    const resources: { pool?: Pool } = {}
    let created = false
    t.after(async () => {
      globalThis.fetch = previousFetch
      await resources.pool?.end()
      try {
        if (created) await admin.query(`DROP SCHEMA "${namespace}" CASCADE`)
      } finally {
        await admin.end()
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }
    })
    await admin.query(`CREATE SCHEMA "${namespace}"`)
    created = true
    const ddl = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(schema),
    )
    await admin.query(ddl.join('\n').replaceAll('"public".', `"${namespace}".`))
    Object.assign(process.env, overrides)
    // Any pending order is re-checked with SePay before a new checkout; an
    // unknown order (404) means there is nothing to recover.
    globalThis.fetch = () => Promise.resolve(new Response('', { status: 404 }))

    const { db } = await import('#/db')
    resources.pool = db.$client
    const { createCompanyWorkspace } = await import('../workspaces')
    const { createCheckout, processSepayIpn } = await import('./checkout')
    const { assignWorkspaceSeat, ensureIncludedAllowance } =
      await import('./credits')
    const { prepareToLeave, prepareToRemove } =
      await import('../workspace-members')

    await db.insert(schema.user).values(
      ['alice', 'bob', 'carol'].map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
        roles: [],
        emailVerified: true,
      })),
    )
    const workspaceId = await createCompanyWorkspace('alice', {
      name: 'Seat history company',
      requestId: randomUUID(),
    })
    const memberIds = { bob: randomUUID(), carol: randomUUID() }
    await db.insert(schema.member).values(
      Object.entries(memberIds).map(([userId, id]) => ({
        id,
        organizationId: workspaceId,
        userId,
        role: 'member',
      })),
    )

    const seats = schema.workspaceSeatAssignments
    const stintsOf = (userId: string) =>
      db
        .select()
        .from(seats)
        .where(
          and(eq(seats.workspaceId, workspaceId), eq(seats.userId, userId)),
        )
    const subscription = async () =>
      (await db.query.workspaceSubscriptions.findFirst({
        where: eq(schema.workspaceSubscriptions.workspaceId, workspaceId),
      }))!
    const buyBusiness = async (
      expectedSubscriptionPeriodEnd: string | null,
      transactionId: string,
    ) => {
      const result = await createCheckout({
        userId: 'alice',
        workspaceId,
        idempotencyKey: randomUUID(),
        productCode: 'business_monthly',
        seatQuantity: 2,
        expectedSubscriptionPeriodEnd,
        publicBaseUrl: 'http://localhost:4500',
      })
      assert.ok('fields' in result)
      const invoice = result.fields.order_invoice_number
      const order = (await db.query.billingOrders.findFirst({
        where: eq(schema.billingOrders.orderInvoiceNumber, invoice),
      }))!
      await processSepayIpn(
        {
          notification_type: 'ORDER_PAID',
          order: {
            order_invoice_number: invoice,
            order_id: `sepay-${invoice}`,
            order_amount: String(order.amountVnd),
            order_currency: 'VND',
            order_status: 'CAPTURED',
          },
          transaction: {
            transaction_id: transactionId,
            transaction_amount: String(order.amountVnd),
            transaction_currency: 'VND',
            transaction_status: 'APPROVED',
          },
        },
        'sandbox',
      )
      assert.equal(
        (await db.query.billingOrders.findFirst({
          where: eq(schema.billingOrders.id, order.id),
        }))!.status,
        'paid',
      )
    }
    const includedGrantsForSeat = (seatNumber: number) =>
      db
        .select()
        .from(schema.creditGrants)
        .where(
          and(
            eq(schema.creditGrants.workspaceId, workspaceId),
            eq(schema.creditGrants.type, 'included'),
            eq(schema.creditGrants.seatNumber, seatNumber),
          ),
        )
    const status = (code: number) => (error: unknown) =>
      error instanceof Response && error.status === code

    await t.test('the first Business payment seats the purchaser', async () => {
      await buyBusiness(null, 'tx-activate')
      const [stint, ...rest] = await stintsOf('alice')
      assert.equal(rest.length, 0)
      assert.equal(stint.seatNumber, 1)
      assert.equal(stint.assignReason, 'subscription_activated')
      assert.equal(stint.assignedByUserId, null)
      assert.equal(stint.revokedAt, null)
    })

    await t.test('a renewal leaves the purchaser seat untouched', async () => {
      const [before] = await stintsOf('alice')
      await buyBusiness(
        (await subscription()).currentPeriodEnd.toISOString(),
        'tx-renew',
      )
      assert.deepEqual(await stintsOf('alice'), [before])
    })

    await t.test(
      'removing and re-adding a member opens a new stint without new minutes',
      async () => {
        await assignWorkspaceSeat({
          workspaceId,
          userId: 'bob',
          assignedBy: 'alice',
          reason: 'owner_assigned',
        })
        await ensureIncludedAllowance(workspaceId, 'bob')
        // Bob practises for 200 of the seat's 300 minutes.
        await db
          .update(schema.creditGrants)
          .set({ remainingSeconds: 100 * 60 })
          .where(eq(schema.creditGrants.seatNumber, 2))

        await prepareToRemove({
          actorId: 'alice',
          workspaceId,
          memberIdOrEmail: memberIds.bob,
        })
        await assignWorkspaceSeat({
          workspaceId,
          userId: 'bob',
          assignedBy: 'alice',
          reason: 'owner_assigned',
        })
        await ensureIncludedAllowance(workspaceId, 'bob')

        const stints = await stintsOf('bob')
        assert.equal(stints.length, 2)
        const closed = stints.find((stint) => stint.revokedAt)!
        const open = stints.find((stint) => !stint.revokedAt)!
        assert.equal(closed.seatNumber, 2)
        assert.equal(closed.assignedByUserId, 'alice')
        assert.equal(closed.revokedByUserId, 'alice')
        assert.equal(closed.revokeReason, 'member_removed')
        assert.equal(open.seatNumber, 2, 'the member gets their seat back')
        assert.notEqual(open.id, closed.id)

        const grants = await includedGrantsForSeat(2)
        assert.equal(grants.length, 1)
        assert.equal(grants[0].remainingSeconds, 100 * 60)
      },
    )

    await t.test('a seat handed to someone else stays traceable', async () => {
      await prepareToRemove({
        actorId: 'alice',
        workspaceId,
        memberIdOrEmail: 'BOB@example.test',
      })
      await assignWorkspaceSeat({
        workspaceId,
        userId: 'carol',
        assignedBy: 'alice',
        reason: 'owner_assigned',
      })
      const [carol] = await stintsOf('carol')
      assert.equal(carol.seatNumber, 2)

      // Carol inherits what is left on the seat, and the ledger says so.
      const [grant] = await includedGrantsForSeat(2)
      assert.equal(grant.userId, 'carol')
      assert.equal(grant.remainingSeconds, 100 * 60)
      const handovers = await db
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.grantId, grant.id))
      assert.deepEqual(
        handovers
          .filter((entry) => entry.reason === 'seat_reassignment')
          .map((entry) => [entry.fromUserId, entry.toUserId]),
        [['bob', 'carol']],
      )

      const history = await db
        .select()
        .from(seats)
        .where(and(eq(seats.workspaceId, workspaceId), eq(seats.seatNumber, 2)))
      assert.deepEqual(history.map((stint) => stint.userId).sort(), [
        'bob',
        'bob',
        'carol',
      ])

      const at = carol.assignedAt
      const holders = await db
        .select({ userId: seats.userId })
        .from(seats)
        .where(
          and(
            eq(seats.workspaceId, workspaceId),
            eq(seats.seatNumber, 2),
            lte(seats.assignedAt, at),
            or(isNull(seats.revokedAt), gt(seats.revokedAt, at)),
          ),
        )
      assert.deepEqual(holders, [{ userId: 'carol' }])

      // Both paid seats are taken, so Bob cannot come back yet.
      await assert.rejects(
        assignWorkspaceSeat({
          workspaceId,
          userId: 'bob',
          assignedBy: 'alice',
          reason: 'owner_assigned',
        }),
        status(409),
      )
    })

    await t.test('leaving records the member as the one who left', async () => {
      await prepareToLeave({ userId: 'carol', workspaceId })
      const [carol] = await stintsOf('carol')
      assert.ok(carol.revokedAt)
      assert.equal(carol.revokedByUserId, 'carol')
      assert.equal(carol.revokeReason, 'member_left')
    })

    await t.test(
      'the database refuses two open stints for one member',
      async () => {
        await assert.rejects(
          db
            .insert(seats)
            .values({ workspaceId, userId: 'alice', seatNumber: 2 }),
          (error: Error) =>
            (error.cause as { constraint?: string } | undefined)?.constraint ===
            'workspace_seat_assignments_active_user_unique',
        )
      },
    )
  },
)
