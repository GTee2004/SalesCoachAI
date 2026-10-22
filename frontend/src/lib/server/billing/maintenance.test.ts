import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import * as schema from '#/db/schema'
import { createMaintenanceStore } from './maintenance-store'
import type { SepayOrder } from './sepay-client'

// Opt-in isolated PostgreSQL integration; never touches application tables.
test(
  'billing maintenance leases and payment races in PostgreSQL',
  { timeout: 60_000 },
  async (t) => {
    const connection = process.env.BILLING_TEST_DATABASE_URL
    if (!connection) {
      t.skip('Set BILLING_TEST_DATABASE_URL to an isolated *_test database')
      return
    }
    const url = new URL(connection)
    assert.match(decodeURIComponent(url.pathname), /_test$/)
    const namespace = `billing_test_${randomUUID().replaceAll('-', '')}`
    url.searchParams.set('options', `-c search_path=${namespace}`)
    const pool = new Pool({
      connectionString: url.toString(),
      connectionTimeoutMillis: 5_000,
    })
    let created = false
    const resources: { appPool?: Pool } = {}
    const originalFetch = globalThis.fetch
    const previousEnv = { ...process.env }
    t.after(async () => {
      globalThis.fetch = originalFetch
      process.env = previousEnv
      await resources.appPool?.end()
      try {
        if (created) await pool.query(`DROP SCHEMA "${namespace}" CASCADE`)
      } finally {
        await pool.end()
      }
    })
    await pool.query(`CREATE SCHEMA "${namespace}"`)
    created = true
    const ddl = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(schema),
    )
    await pool.query(ddl.join('\n').replaceAll('"public".', `"${namespace}".`))
    const database = drizzle(pool, { schema })
    const store = createMaintenanceStore(database)
    await database.insert(schema.user).values({
      id: 'buyer',
      name: 'Buyer',
      email: 'buyer@example.test',
      roles: [],
      emailVerified: true,
    })
    const company = (
      await database.insert(schema.company).values({ name: 'Test' }).returning()
    )[0]
    await database.insert(schema.organization).values({
      id: 'workspace',
      companyId: company.id,
      name: 'Test',
      slug: namespace,
    })
    await database.insert(schema.workspaceProfiles).values({
      workspaceId: 'workspace',
      kind: 'personal',
      personalOwnerUserId: 'buyer',
      status: 'ready',
    })

    async function makeOrder(
      overrides: Partial<typeof schema.billingOrders.$inferInsert> = {},
    ) {
      return (
        await database
          .insert(schema.billingOrders)
          .values({
            workspaceId: 'workspace',
            purchasedByUserId: 'buyer',
            creditRecipientUserId: 'buyer',
            orderInvoiceNumber: randomUUID(),
            idempotencyKey: randomUUID(),
            type: 'topup',
            productCode: 'topup_15',
            amountVnd: 299000,
            creditMinutes: 15,
            expiresAt: new Date(Date.now() - 60_000),
            maintenanceNextAt: new Date(Date.now() - 60_000),
            ...overrides,
          })
          .returning()
      )[0]
    }
    async function current(id: string) {
      return (
        await database
          .select()
          .from(schema.billingOrders)
          .where(eq(schema.billingOrders.id, id))
      )[0]
    }

    await t.test(
      'concurrent sweep/manual claims grant exactly one lease',
      async () => {
        const order = await makeOrder()
        const claims = await Promise.all(
          Array.from({ length: 8 }, (_, index) =>
            store.claimOrder(order.id, index % 2 === 0),
          ),
        )
        assert.equal(claims.filter(Boolean).length, 1)
        assert.equal((await current(order.id)).maintenanceAttempts, 1)
        await store.release(claims.find(Boolean)!)
        assert.equal((await current(order.id)).maintenanceLeaseToken, null)
        assert.ok((await current(order.id)).maintenanceNextAt > new Date())
        assert.equal(await store.claimOrder(order.id, true), undefined)
        // An explicit owner action can bypass backoff, but not an active lease.
        assert.ok(await store.claimOrder(order.id, false))
      },
    )

    await t.test(
      'expired leases are recovered and stale release cannot clear the new lease',
      async () => {
        const order = await makeOrder()
        const old = (await store.claimOrder(order.id, true))!
        await database
          .update(schema.billingOrders)
          .set({ maintenanceLeaseUntil: new Date(Date.now() - 1000) })
          .where(eq(schema.billingOrders.id, order.id))
        const replacement = (await store.claimOrder(order.id, true))!
        assert.notEqual(
          old.maintenanceLeaseToken,
          replacement.maintenanceLeaseToken,
        )
        await store.release(old)
        assert.equal(
          (await current(order.id)).maintenanceLeaseToken,
          replacement.maintenanceLeaseToken,
        )
        await store.release(replacement)
      },
    )

    await t.test(
      'sweep excludes unexpired, terminal, leased and backed-off orders',
      async () => {
        const ready = await makeOrder()
        const excluded = await Promise.all([
          makeOrder({ expiresAt: new Date(Date.now() + 60_000) }),
          makeOrder({ status: 'paid' }),
          makeOrder({ status: 'cancelled' }),
          makeOrder({ maintenanceNextAt: new Date(Date.now() + 60_000) }),
          makeOrder({
            maintenanceLeaseUntil: new Date(Date.now() + 60_000),
            maintenanceLeaseToken: randomUUID(),
          }),
        ])
        const due = await store.dueOrders()
        assert.ok(due.some(({ id }) => id === ready.id))
        for (const order of excluded)
          assert.ok(!due.some(({ id }) => id === order.id))
        // Simulate an IPN arriving after candidate selection but before claim.
        await database
          .update(schema.billingOrders)
          .set({ status: 'paid' })
          .where(eq(schema.billingOrders.id, ready.id))
        assert.equal(await store.claimOrder(ready.id, true), undefined)
      },
    )

    // Real reconciliation and fulfillment, with only the provider HTTP replaced.
    Object.assign(process.env, {
      DATABASE_URL: url.toString(),
      NODE_ENV: 'development',
      BETTER_AUTH_URL: 'http://localhost:4500',
      BETTER_AUTH_SECRET: 'test-secret',
      SMTP_USER: 'test',
      SMTP_PASSWORD: 'test',
      VOICE_BACKEND_INTERNAL_URL: 'http://localhost:8000',
      VOICE_BACKEND_PUBLIC_URL: 'http://localhost:8000',
      VOICE_CONTROL_API_KEY: 'x'.repeat(32),
      VOICE_TOKEN_SECRET: 'y'.repeat(32),
      VOICE_EVENT_INGEST_KEY: 'z'.repeat(32),
      SEPAY_ENV: 'sandbox',
      SEPAY_MERCHANT_ID: 'test',
      SEPAY_SECRET_KEY: 'test',
      SEPAY_IPN_SECRET: 'test',
    })
    const { db } = await import('#/db')
    resources.appPool = db.$client
    const { cancelBillingOrder, sweepExpiredBillingOrders } =
      await import('./maintenance')
    const { reconcileSepayOrder, processSepayIpn } = await import('./checkout')
    const remoteOrders = new Map<string, SepayOrder>()
    let cancelCalls = 0
    globalThis.fetch = async (input, init) => {
      const requestUrl = new URL(String(input))
      if (init?.method === 'POST') {
        cancelCalls++
        const invoice = (
          JSON.parse(String(init.body)) as { order_invoice_number: string }
        ).order_invoice_number
        const remote = remoteOrders.get(invoice)
        assert.ok(remote)
        remote.order_status = 'CANCELLED'
        return Response.json({ message: 'Cancelled' })
      }
      const invoice = decodeURIComponent(requestUrl.pathname.split('/').at(-1)!)
      const remote = remoteOrders.get(invoice)
      if (remote) return Response.json({ data: remote })
      if (requestUrl.pathname === '/v1/order')
        return Response.json({ data: [] })
      return new Response(null, { status: 404 })
    }
    function remoteFor(
      order: typeof schema.billingOrders.$inferSelect,
      order_status = 'AUTHENTICATION_NOT_NEEDED',
    ): SepayOrder {
      return {
        id: randomUUID(),
        order_id: `SEPAY-${order.id}`,
        order_invoice_number: order.orderInvoiceNumber,
        order_status,
        order_amount: String(order.amountVnd),
        order_currency: 'VND',
        transactions: [],
      }
    }

    await t.test(
      'manual cancellation is scoped to workspace and records confirmed provider cancellation',
      async () => {
        const order = await makeOrder({
          expiresAt: new Date(Date.now() + 60_000),
        })
        remoteOrders.set(order.orderInvoiceNumber, remoteFor(order))
        await assert.rejects(
          cancelBillingOrder('another-workspace', order.orderInvoiceNumber),
          (error: Response) => error.status === 404,
        )
        assert.equal(
          (await cancelBillingOrder('workspace', order.orderInvoiceNumber))
            .status,
          'cancelled',
        )
        assert.equal((await current(order.id)).status, 'cancelled')
        assert.equal((await current(order.id)).maintenanceLeaseToken, null)
        assert.equal(
          (await cancelBillingOrder('workspace', order.orderInvoiceNumber))
            .status,
          'cancelled',
        )
      },
    )

    await t.test(
      'captured reconciliation fulfills once and a stale cancellation cannot downgrade it',
      async () => {
        const order = await makeOrder()
        const remote = remoteFor(order, 'CAPTURED')
        const transaction = {
          id: randomUUID(),
          transaction_id: randomUUID(),
          transaction_type: 'PAYMENT',
          transaction_status: 'APPROVED',
          transaction_amount: String(order.amountVnd),
          transaction_currency: 'VND',
        }
        remote.transactions = [transaction]
        remoteOrders.set(order.orderInvoiceNumber, remote)
        const callsBefore = cancelCalls
        assert.equal(
          (await cancelBillingOrder('workspace', order.orderInvoiceNumber))
            .status,
          'paid',
        )
        assert.equal(cancelCalls, callsBefore)
        await reconcileSepayOrder(order, {
          ...remote,
          order_status: 'CANCELLED',
        })
        await processSepayIpn(
          { notification_type: 'ORDER_PAID', order: remote, transaction },
          'sandbox',
        )
        assert.equal((await current(order.id)).status, 'paid')
        assert.equal(
          (
            await database
              .select()
              .from(schema.creditGrants)
              .where(eq(schema.creditGrants.orderId, order.id))
          ).length,
          1,
        )
      },
    )

    await t.test(
      'payment after confirmed cancellation enters review without granting credits',
      async () => {
        const order = await makeOrder({ status: 'cancelled' })
        const remote = remoteFor(order, 'CAPTURED')
        remote.transactions = [
          {
            id: randomUUID(),
            transaction_type: 'PAYMENT',
            transaction_status: 'APPROVED',
            transaction_amount: String(order.amountVnd),
            transaction_currency: 'VND',
          },
        ]
        await reconcileSepayOrder(order, remote)
        assert.equal((await current(order.id)).status, 'review')
        assert.equal(
          (
            await database
              .select()
              .from(schema.creditGrants)
              .where(eq(schema.creditGrants.orderId, order.id))
          ).length,
          0,
        )
      },
    )

    await t.test(
      'overlapping sweeps cancel overdue orders and persist retry on missing remote orders',
      async () => {
        const order = await makeOrder()
        remoteOrders.set(order.orderInvoiceNumber, remoteFor(order))
        const missing = await makeOrder()
        const callsBefore = cancelCalls
        await Promise.all([
          sweepExpiredBillingOrders(),
          sweepExpiredBillingOrders(),
        ])
        assert.equal((await current(order.id)).status, 'cancelled')
        assert.equal(cancelCalls, callsBefore + 1)
        assert.equal((await current(missing.id)).status, 'pending')
        assert.ok((await current(missing.id)).maintenanceNextAt > new Date())
        assert.equal((await current(missing.id)).maintenanceLeaseToken, null)
      },
    )
  },
)
