import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Pool } from 'pg'
import { and, eq } from 'drizzle-orm'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import * as schema from '#/db/schema'

// Opt-in PostgreSQL integration for coupons at checkout. Every object lives in
// a fresh private schema that is dropped afterwards, and SePay is stubbed, so
// nothing outside the schema is read or changed.
test(
  'coupons discount, settle free orders and respect their limits in PostgreSQL',
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
    const namespace = `coupon_test_${randomUUID().replaceAll('-', '')}`
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
    globalThis.fetch = () => Promise.resolve(new Response('', { status: 404 }))

    const { db } = await import('#/db')
    resources.pool = db.$client
    const { ensurePersonalWorkspace, createCompanyWorkspace } =
      await import('../workspaces')
    const { createCheckout, processSepayIpn } = await import('./checkout')
    const { createCoupon, listCouponRedemptions } = await import('./coupons')
    const { createCouponSchema } = await import('#/lib/billing/coupon-schemas')

    const people = ['admin', 'alice', 'bob', 'carol', 'dave']
    await db.insert(schema.user).values(
      people.map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
        roles: id === 'admin' ? ['admin'] : ['user'],
        emailVerified: true,
      })),
    )
    const workspaces: Record<string, string> = {}
    for (const id of people.slice(1))
      workspaces[id] = await ensurePersonalWorkspace(id)

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString()
    const makeCoupon = (input: Record<string, unknown>) =>
      createCoupon(
        createCouponSchema.parse({
          name: 'Test',
          maxDiscountVnd: null,
          appliesTo: ['subscription', 'topup'],
          startsAt: null,
          expiresAt: tomorrow,
          maxRedemptions: null,
          maxRedemptionsPerWorkspace: 1,
          ...input,
        }),
        'admin',
      )
    const checkout = (
      who: string,
      productCode: string,
      couponCode?: string,
      idempotencyKey: string = randomUUID(),
    ) =>
      createCheckout({
        userId: who,
        workspaceId: workspaces[who],
        idempotencyKey,
        productCode,
        seatQuantity: 1,
        couponCode,
        publicBaseUrl: 'http://localhost:4500',
      })
    const orderByInvoice = async (invoice: string) =>
      (await db.query.billingOrders.findFirst({
        where: eq(schema.billingOrders.orderInvoiceNumber, invoice),
      }))!
    // Checkout rejects with a Response; assert its status and message.
    const rejectsWith = async (
      promise: Promise<unknown>,
      code: number,
      pattern: RegExp,
    ) => {
      const error = await promise.then(
        () => undefined,
        (reason: unknown) => reason,
      )
      assert.ok(error instanceof Response, 'expected a rejected Response')
      assert.equal(error.status, code)
      assert.match(await error.text(), pattern)
    }
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
    const asSepayForm = (result: Awaited<ReturnType<typeof checkout>>) => {
      assert.ok('fields' in result)
      return result
    }

    await makeCoupon({ code: 'PCT20', discountType: 'percent', value: 20 })

    await t.test(
      'a percent coupon lowers the amount sent to SePay',
      async () => {
        const result = asSepayForm(await checkout('alice', 'topup_15', 'pct20'))
        assert.equal(result.fields.order_amount, '36000')
        const order = await orderByInvoice(result.fields.order_invoice_number)
        assert.equal(order.status, 'pending')
        assert.equal(order.amountVnd, 36_000)
        assert.equal(order.discountVnd, 9_000)
        assert.equal(order.couponCode, 'PCT20')
      },
    )

    await t.test(
      'the discounted amount, not the list price, settles the order',
      async () => {
        const order = (await db.query.billingOrders.findFirst({
          where: eq(schema.billingOrders.couponCode, 'PCT20'),
        }))!
        // Paying the undiscounted price must not fulfil the order.
        await pay(order.orderInvoiceNumber, 45_000, 'tx-list-price')
        assert.equal(
          (await orderByInvoice(order.orderInvoiceNumber)).status,
          'pending',
        )
        await pay(order.orderInvoiceNumber, 36_000, 'tx-net-price')
        assert.equal(
          (await orderByInvoice(order.orderInvoiceNumber)).status,
          'paid',
        )
        const grant = await db.query.creditGrants.findFirst({
          where: eq(schema.creditGrants.orderId, order.id),
        })
        assert.equal(grant?.totalSeconds, 15 * 60)
      },
    )

    await t.test(
      'a paid order keeps holding the per-workspace limit',
      async () => {
        await rejectsWith(
          checkout('alice', 'topup_75', 'PCT20'),
          409,
          /đã sử dụng/,
        )
        // Another workspace is unaffected.
        asSepayForm(await checkout('bob', 'topup_75', 'PCT20'))
      },
    )

    await t.test('cancelling an unpaid order releases its coupon', async () => {
      await db
        .update(schema.billingOrders)
        .set({ status: 'cancelled' })
        .where(
          and(
            eq(schema.billingOrders.purchasedByUserId, 'bob'),
            eq(schema.billingOrders.status, 'pending'),
          ),
        )
      const again = asSepayForm(await checkout('bob', 'topup_15', 'PCT20'))
      assert.equal(again.fields.order_amount, '36000')
    })

    await t.test('repeating a request does not redeem twice', async () => {
      const key = randomUUID()
      const first = asSepayForm(
        await checkout('carol', 'topup_15', 'PCT20', key),
      )
      const second = asSepayForm(
        await checkout('carol', 'topup_15', 'PCT20', key),
      )
      assert.equal(
        second.fields.order_invoice_number,
        first.fields.order_invoice_number,
      )
      const rows = await db.query.couponRedemptions.findMany({
        where: eq(schema.couponRedemptions.workspaceId, workspaces.carol),
      })
      assert.equal(rows.length, 1)
    })

    await makeCoupon({ code: 'FREE100', discountType: 'percent', value: 100 })

    await t.test(
      'a 100% coupon on a subscription is settled without SePay',
      async () => {
        const key = randomUUID()
        const result = await checkout('dave', 'pro_monthly', 'free100', key)
        assert.ok('free' in result)
        const order = await orderByInvoice(result.invoice)
        assert.equal(order.status, 'paid')
        assert.equal(order.amountVnd, 0)
        assert.equal(order.discountVnd, 299_000)
        assert.ok(order.paidAt)
        const subscription = await db.query.workspaceSubscriptions.findFirst({
          where: eq(schema.workspaceSubscriptions.workspaceId, workspaces.dave),
        })
        assert.equal(subscription?.plan, 'pro')
        assert.equal(subscription.status, 'active')
        assert.ok(subscription.currentPeriodEnd > new Date())

        // A double click replays the same free order instead of failing.
        const again = await checkout('dave', 'pro_monthly', 'free100', key)
        assert.ok('free' in again)
        assert.equal(again.invoice, result.invoice)
        const rows = await db.query.couponRedemptions.findMany({
          where: eq(schema.couponRedemptions.orderId, order.id),
        })
        assert.equal(rows.length, 1)
      },
    )

    await makeCoupon({
      code: 'BIGFIXED',
      discountType: 'fixed',
      value: 500_000,
    })

    await t.test(
      'a fixed coupon larger than the order is capped and still grants minutes',
      async () => {
        const result = await checkout('alice', 'topup_15', 'BIGFIXED')
        assert.ok('free' in result)
        const order = await orderByInvoice(result.invoice)
        assert.equal(order.amountVnd, 0)
        assert.equal(order.discountVnd, 45_000)
        const grant = await db.query.creditGrants.findFirst({
          where: eq(schema.creditGrants.orderId, order.id),
        })
        assert.equal(grant?.remainingSeconds, 15 * 60)
      },
    )

    await t.test('a zero-amount order needs a discount', async () => {
      const order = (await db.query.billingOrders.findFirst({
        where: eq(schema.billingOrders.couponCode, 'BIGFIXED'),
      }))!
      await assert.rejects(
        db.insert(schema.billingOrders).values({
          workspaceId: workspaces.alice,
          purchasedByUserId: 'alice',
          orderInvoiceNumber: `ZERO${randomUUID()}`.slice(0, 40),
          idempotencyKey: randomUUID(),
          type: 'topup',
          productCode: 'topup_15',
          amountVnd: 0,
          discountVnd: 0,
          expiresAt: new Date(Date.now() + 60_000),
          creditRecipientUserId: order.creditRecipientUserId,
        }),
        // Drizzle wraps the database error; the constraint name is on the cause.
        (error: unknown) =>
          /billing_orders_amount_valid/.test(
            String((error as { cause?: { message?: string } }).cause?.message),
          ),
      )
    })

    await t.test(
      'a coupon cannot leave a payable amount below the SePay minimum',
      async () => {
        await makeCoupon({
          code: 'ALMOST',
          discountType: 'fixed',
          value: 44_500,
        })
        const result = asSepayForm(await checkout('dave', 'topup_15', 'ALMOST'))
        assert.equal(result.fields.order_amount, '1000')
        const order = await orderByInvoice(result.fields.order_invoice_number)
        assert.equal(order.amountVnd, 1_000)
        assert.equal(order.discountVnd, 44_000)
      },
    )

    await t.test('an order above the SePay maximum is refused', async () => {
      const company = await createCompanyWorkspace('bob', {
        name: 'Big company',
        requestId: randomUUID(),
      })
      const buy = (seats: number) =>
        createCheckout({
          userId: 'bob',
          workspaceId: company,
          idempotencyKey: randomUUID(),
          productCode: 'business_yearly',
          seatQuantity: seats,
          publicBaseUrl: 'http://localhost:4500',
        })
      // 100 seats is exactly 499,000,000; 101 seats is over.
      await rejectsWith(buy(101), 400, /tối đa 499\.000\.000/)
      const before = await db.query.billingOrders.findMany({
        where: eq(schema.billingOrders.workspaceId, company),
      })
      assert.equal(before.length, 0)
      const ok = asSepayForm(await buy(100))
      assert.equal(ok.fields.order_amount, '499000000')
    })

    await t.test(
      'a percent coupon is limited by its maximum discount',
      async () => {
        await makeCoupon({
          code: 'CAPPED',
          discountType: 'percent',
          value: 50,
          maxDiscountVnd: 10_000,
        })
        // 50% of 900,000 would be 450,000; the ceiling holds it to 10,000.
        const result = asSepayForm(
          await checkout('carol', 'topup_300', 'CAPPED'),
        )
        assert.equal(result.fields.order_amount, '890000')
        const order = await orderByInvoice(result.fields.order_invoice_number)
        assert.equal(order.discountVnd, 10_000)
      },
    )

    await t.test('a ceiling is rejected on a fixed coupon', async () => {
      assert.equal(
        createCouponSchema.safeParse({
          code: 'BADCAP',
          name: 'Bad',
          discountType: 'fixed',
          value: 50_000,
          maxDiscountVnd: 10_000,
          appliesTo: ['topup'],
          startsAt: null,
          expiresAt: null,
          maxRedemptions: null,
          maxRedemptionsPerWorkspace: 1,
        }).success,
        false,
      )
    })

    await t.test('an admin can list who used a coupon and when', async () => {
      const coupon = (await db.query.coupons.findFirst({
        where: eq(schema.coupons.code, 'PCT20'),
      }))!
      const rows = await listCouponRedemptions(coupon.id)
      // alice (paid), bob (cancelled, then pending again) and carol (pending).
      assert.equal(rows.length, 4)
      const alice = rows.find((row) => row.userName === 'alice')!
      assert.equal(alice.userEmail, 'alice@example.test')
      assert.equal(alice.orderStatus, 'paid')
      assert.equal(alice.counted, true)
      assert.equal(alice.discountVnd, 9_000)
      assert.equal(alice.workspaceName, 'Tài khoản cá nhân')
      assert.ok(
        rows.some((row) => row.orderStatus === 'cancelled' && !row.counted),
      )
      const times = rows.map((row) => Date.parse(row.createdAt))
      assert.deepEqual(
        times,
        [...times].sort((a, b) => b - a),
      )
    })

    await t.test('unusable codes share one message', async () => {
      await makeCoupon({
        code: 'OFF',
        discountType: 'percent',
        value: 10,
      })
      await db
        .update(schema.coupons)
        .set({ active: false })
        .where(eq(schema.coupons.code, 'OFF'))
      await db.insert(schema.coupons).values({
        code: 'OLD',
        name: 'Old',
        discountType: 'percent',
        value: 10,
        appliesTo: ['topup'],
        expiresAt: new Date(Date.now() - 1000),
        createdByUserId: 'admin',
      })
      for (const code of ['NOPE', 'OFF', 'OLD'])
        await rejectsWith(
          checkout('bob', 'topup_150', code),
          400,
          /không hợp lệ hoặc đã hết hạn/,
        )
    })

    await t.test('a coupon only applies to its product types', async () => {
      await makeCoupon({
        code: 'SUBONLY',
        discountType: 'percent',
        value: 10,
        appliesTo: ['subscription'],
      })
      await rejectsWith(
        checkout('bob', 'topup_150', 'SUBONLY'),
        409,
        /không áp dụng/,
      )
    })

    await t.test(
      'the total limit holds under concurrent checkouts',
      async () => {
        await makeCoupon({
          code: 'ONLYONE',
          discountType: 'percent',
          value: 10,
          maxRedemptions: 1,
        })
        const results = await Promise.allSettled([
          checkout('alice', 'topup_300', 'ONLYONE'),
          checkout('bob', 'topup_300', 'ONLYONE'),
          checkout('carol', 'topup_300', 'ONLYONE'),
        ])
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
        const rejected = results.filter((r) => r.status === 'rejected')
        assert.equal(rejected.length, 2)
        for (const r of rejected) {
          assert.ok(r.reason instanceof Response)
          assert.equal(r.reason.status, 409)
          assert.match(await r.reason.text(), /hết lượt/)
        }
      },
    )
  },
)
