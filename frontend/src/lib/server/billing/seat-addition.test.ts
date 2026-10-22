import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import * as schema from '#/db/schema'
import { quoteSeatAddition } from '#/lib/billing/proration'

// Opt-in PostgreSQL integration for paying for extra seats mid-term. Every
// object lives in a fresh private schema that is dropped afterwards, and SePay
// is stubbed, so nothing outside the schema is read or changed.
test(
  'extra seats are priced, guarded and applied in PostgreSQL',
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
    const namespace = `seat_test_${randomUUID().replaceAll('-', '')}`
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
    const { getSeatAvailability } = await import('./seats')

    await db.insert(schema.user).values(
      ['alice', 'bob'].map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
        roles: [],
        emailVerified: true,
      })),
    )
    const workspaceId = await createCompanyWorkspace('alice', {
      name: 'Seat test company',
      requestId: randomUUID(),
    })
    await db.insert(schema.member).values({
      id: randomUUID(),
      organizationId: workspaceId,
      userId: 'bob',
      role: 'member',
    })
    const periodStart = new Date(Date.now() - 10 * 86_400_000)
    const periodEnd = new Date(Date.now() + 20 * 86_400_000)
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      plan: 'business',
      interval: 'monthly',
      status: 'active',
      seatQuantity: 2,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    })
    await db
      .update(schema.workspaceProfiles)
      .set({ status: 'ready' })
      .where(eq(schema.workspaceProfiles.workspaceId, workspaceId))
    await db.insert(schema.workspaceSeatAssignments).values([
      { workspaceId, userId: 'alice', seatNumber: 1 },
      { workspaceId, userId: 'bob', seatNumber: 2 },
    ])

    const subscription = async () =>
      (await db.query.workspaceSubscriptions.findFirst({
        where: eq(schema.workspaceSubscriptions.workspaceId, workspaceId),
      }))!
    const orderByInvoice = async (invoice: string) =>
      (await db.query.billingOrders.findFirst({
        where: eq(schema.billingOrders.orderInvoiceNumber, invoice),
      }))!
    const checkout = (
      productCode: string,
      seatQuantity: number,
      extra: Partial<Parameters<typeof createCheckout>[0]> = {},
    ) =>
      createCheckout({
        userId: 'alice',
        workspaceId,
        idempotencyKey: randomUUID(),
        productCode,
        seatQuantity,
        expectedSubscriptionPeriodEnd: periodEnd.toISOString(),
        publicBaseUrl: 'http://localhost:4500',
        ...extra,
      })
    const invoiceOf = (result: Awaited<ReturnType<typeof checkout>>) => {
      assert.ok('fields' in result)
      return result.fields.order_invoice_number
    }
    const status = (code: number) => (error: unknown) =>
      error instanceof Response && error.status === code
    const pay = (invoice: string, amount: number, transactionId: string) =>
      processSepayIpn(
        {
          notification_type: 'ORDER_PAID',
          order: {
            order_invoice_number: invoice,
            order_id: `sepay-${invoice}`,
            order_amount: String(amount),
            order_currency: 'VND',
            order_status: 'CAPTURED',
          },
          transaction: {
            transaction_id: transactionId,
            transaction_amount: String(amount),
            transaction_currency: 'VND',
            transaction_status: 'APPROVED',
          },
        },
        'sandbox',
      )
    const cancelOpenOrders = () =>
      db
        .update(schema.billingOrders)
        .set({ status: 'cancelled' })
        .where(eq(schema.billingOrders.status, 'pending'))

    let invoice = ''
    let amount = 0

    await t.test(
      'an order is priced for the rest of the paid term',
      async () => {
        const before = new Date()
        const result = await checkout('business_seats_monthly', 2)
        const after = new Date()
        invoice = invoiceOf(result)
        const order = await orderByInvoice(invoice)
        amount = order.amountVnd
        const quote = (now: Date) =>
          quoteSeatAddition({
            interval: 'monthly',
            currentPeriodEnd: periodEnd,
            seatsToAdd: 2,
            now,
          }).amountVnd
        assert.equal(order.type, 'seat_addition')
        assert.equal(order.seatQuantity, 2)
        assert.equal(order.interval, 'monthly')
        assert.ok('fields' in result)
        assert.equal(result.fields.order_amount, String(amount))
        assert.ok(amount % 1_000 === 0)
        assert.ok(amount <= quote(before) && amount >= quote(after))
        // Roughly two thirds of a month remains: well under the full price.
        assert.ok(amount < 2 * 499_000 && amount > 0)
      },
    )

    await t.test('retrying while the order is open resumes it', async () => {
      const again = await checkout('business_seats_monthly', 2)
      assert.equal(invoiceOf(again), invoice)
    })

    await t.test(
      'a renewal cannot be opened beside an open seat order',
      async () => {
        await assert.rejects(checkout('business_monthly', 2), status(409))
        await assert.rejects(checkout('business_seats_monthly', 3), status(409))
      },
    )

    await t.test(
      'paying adds the seats now and keeps the period end',
      async () => {
        await pay(invoice, amount, 'tx-1')
        const current = await subscription()
        assert.equal(current.seatQuantity, 4)
        assert.equal(current.currentPeriodEnd.getTime(), periodEnd.getTime())
        assert.equal(current.pendingPlan, null)
        assert.equal((await orderByInvoice(invoice)).status, 'paid')
        const seats = await getSeatAvailability(workspaceId)
        assert.equal(seats.limit, 4)
        assert.equal(seats.free, 2)
      },
    )

    await t.test(
      'a replayed notification does not add seats twice',
      async () => {
        await pay(invoice, amount, 'tx-1')
        await pay(invoice, amount, 'tx-2')
        assert.equal((await subscription()).seatQuantity, 4)
      },
    )

    await t.test(
      'a notification with the wrong amount is ignored',
      async () => {
        const result = await checkout('business_seats_monthly', 1)
        const open = invoiceOf(result)
        await pay(open, amount + 1_000, 'tx-wrong')
        assert.equal((await orderByInvoice(open)).status, 'pending')
        assert.equal((await subscription()).seatQuantity, 4)
        await cancelOpenOrders()
      },
    )

    await t.test('a seat order cannot be opened beside a renewal', async () => {
      await checkout('business_monthly', 4)
      await assert.rejects(checkout('business_seats_monthly', 1), status(409))
      await cancelOpenOrders()
    })

    await t.test(
      'requests that do not fit the subscription are refused',
      async () => {
        await assert.rejects(
          checkout('business_seats_monthly', 1, { userId: 'bob' }),
          status(403),
        )
        await assert.rejects(checkout('business_seats_yearly', 1), status(409))
        await assert.rejects(
          checkout('business_seats_monthly', 497),
          status(400),
        )
        await assert.rejects(
          checkout('business_seats_monthly', 1, {
            expectedSubscriptionPeriodEnd: new Date(
              periodEnd.getTime() + 60_000,
            ).toISOString(),
          }),
          status(409),
        )
      },
    )

    await t.test(
      'seats cannot be added while a change is scheduled',
      async () => {
        await db
          .update(schema.workspaceSubscriptions)
          .set({
            pendingPlan: 'business',
            pendingInterval: 'yearly',
            pendingSeatQuantity: 4,
          })
          .where(eq(schema.workspaceSubscriptions.workspaceId, workspaceId))
        await assert.rejects(checkout('business_seats_monthly', 1), status(409))
        await db
          .update(schema.workspaceSubscriptions)
          .set({
            pendingPlan: null,
            pendingInterval: null,
            pendingSeatQuantity: null,
          })
          .where(eq(schema.workspaceSubscriptions.workspaceId, workspaceId))
      },
    )

    await t.test(
      'a payment that no longer fits is parked for review, not applied',
      async () => {
        const result = await checkout('business_seats_monthly', 1)
        const open = invoiceOf(result)
        const openAmount = (await orderByInvoice(open)).amountVnd
        // The subscription changed after the order was created.
        await db
          .update(schema.workspaceSubscriptions)
          .set({
            pendingPlan: 'business',
            pendingInterval: 'yearly',
            pendingSeatQuantity: 4,
          })
          .where(eq(schema.workspaceSubscriptions.workspaceId, workspaceId))
        await pay(open, openAmount, 'tx-conflict')
        assert.equal((await orderByInvoice(open)).status, 'review')
        assert.equal((await subscription()).seatQuantity, 4)
        await db
          .update(schema.workspaceSubscriptions)
          .set({
            pendingPlan: null,
            pendingInterval: null,
            pendingSeatQuantity: null,
          })
          .where(eq(schema.workspaceSubscriptions.workspaceId, workspaceId))
      },
    )

    await t.test('a lapsed subscription cannot gain seats', async () => {
      await db
        .update(schema.workspaceSubscriptions)
        .set({ currentPeriodEnd: new Date(Date.now() - 1_000) })
        .where(eq(schema.workspaceSubscriptions.workspaceId, workspaceId))
      await assert.rejects(
        checkout('business_seats_monthly', 1, {
          expectedSubscriptionPeriodEnd: undefined,
        }),
        status(409),
      )
      await db
        .update(schema.workspaceSubscriptions)
        .set({ currentPeriodEnd: periodEnd })
        .where(eq(schema.workspaceSubscriptions.workspaceId, workspaceId))
    })

    await t.test(
      'seats held by invitations cannot be dropped from the next period',
      async () => {
        await db.insert(schema.invitation).values({
          id: randomUUID(),
          organizationId: workspaceId,
          email: 'carol@example.test',
          role: 'member',
          status: 'pending',
          inviterId: 'alice',
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        // Two members hold seats and one invitation holds a third.
        await assert.rejects(checkout('business_monthly', 2), status(409))
        const ok = await checkout('business_monthly', 3)
        assert.ok(invoiceOf(ok))
        await cancelOpenOrders()
      },
    )
  },
)
