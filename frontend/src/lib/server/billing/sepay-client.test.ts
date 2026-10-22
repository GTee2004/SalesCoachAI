import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSepayApi } from './sepay-client'
import {
  checkoutReturnUrl,
  readCheckoutOutcome,
} from '#/lib/billing/checkout-return'
import { safeSecretEqual } from '#/lib/server/voice-token'

const order = {
  id: 'internal-id',
  order_id: 'SEPAY-123',
  order_invoice_number: 'INV-123',
  order_status: 'AUTHENTICATION_NOT_NEEDED',
  order_amount: '299000.00',
  order_currency: 'VND',
}

function mockApi(responses: Response[]) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const api = createSepayApi({
    merchantId: 'merchant',
    secretKey: 'test-key',
    environment: 'sandbox',
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      const response = responses.shift()
      assert.ok(response, 'unexpected additional API call')
      return response
    },
  })
  return { ...api, calls }
}

test('retrieve by invoice matches official SDK and accepts an unpaid order without transactions', async () => {
  const api = mockApi([Response.json({ data: order })])
  assert.deepEqual(
    (await api.findSepayOrderByInvoice('INV-123'))?.transactions,
    [],
  )
  assert.equal(api.calls.length, 1)
  assert.equal(
    api.calls[0].url,
    'https://pgapi-sandbox.sepay.vn/v1/order/detail/INV-123',
  )
  assert.equal(api.calls[0].init?.redirect, 'error')
})

test('fallback uses exact invoice then provider order ID only after a genuine 404', async () => {
  const api = mockApi([
    new Response(null, { status: 404 }),
    Response.json({
      data: [{ ...order, order_invoice_number: 'INV-123-other' }, order],
    }),
    Response.json({ data: { ...order, transactions: null } }),
  ])
  assert.equal(
    (await api.findSepayOrderByInvoice('INV-123'))?.order_id,
    order.order_id,
  )
  assert.ok(api.calls[1].url.includes('q=INV-123'))
  assert.ok(api.calls[2].url.endsWith('/order/detail/SEPAY-123'))
})

test('authentication/server errors do not trigger the 404 fallback', async () => {
  for (const status of [401, 429, 500]) {
    const api = mockApi([new Response(null, { status })])
    await assert.rejects(
      api.findSepayOrderByInvoice('INV-123'),
      (error: Response) => error.status === 503,
    )
    assert.equal(api.calls.length, 1)
  }
})

test('reject wrong invoice, ambiguous search, and wrong provider ID', async () => {
  const cases = [
    [
      Response.json({
        data: { ...order, order_invoice_number: 'someone-else' },
      }),
    ],
    [
      new Response(null, { status: 404 }),
      Response.json({ data: [order, order] }),
    ],
    [
      new Response(null, { status: 404 }),
      Response.json({ data: [order], meta: { has_more: true } }),
    ],
    [
      new Response(null, { status: 404 }),
      Response.json({ data: [order] }),
      Response.json({ data: { ...order, order_id: 'wrong-id' } }),
    ],
    [
      new Response(null, { status: 404 }),
      Response.json({ data: [order] }),
      new Response(null, { status: 404 }),
    ],
  ]
  for (const responses of cases) {
    const api = mockApi(responses)
    await assert.rejects(
      api.findSepayOrderByInvoice('INV-123'),
      (error: Response) => error.status === 503,
    )
  }
})

test('no exact search match returns null without cancelling or fulfilling another order', async () => {
  const api = mockApi([
    new Response(null, { status: 404 }),
    Response.json({ data: [{ ...order, order_invoice_number: 'other' }] }),
  ])
  assert.equal(await api.findSepayOrderByInvoice('INV-123'), null)
})

test('cancel sends authenticated POST with invoice, rejects missing confirmation', async () => {
  const api = mockApi([
    Response.json({ message: 'Đã hủy đơn hàng thành công' }),
  ])
  await api.cancelSepayOrder('INV-123')
  assert.equal(api.calls[0].init?.method, 'POST')
  assert.equal(
    api.calls[0].init.body,
    JSON.stringify({ order_invoice_number: 'INV-123' }),
  )
  assert.equal(
    new Headers(api.calls[0].init.headers).get('Authorization'),
    `Basic ${Buffer.from('merchant:test-key').toString('base64')}`,
  )
  for (const response of [
    new Response(null, { status: 404 }),
    Response.json({}),
    new Response('not-json'),
  ]) {
    await assert.rejects(
      mockApi([response]).cancelSepayOrder('INV-123'),
      (error: Response) => error.status === 503,
    )
  }
})

test('checkout return hints remain distinct, preserve invoice, and reject arbitrary query values', () => {
  for (const outcome of ['success', 'error', 'cancel'] as const) {
    const url = new URL(
      checkoutReturnUrl('https://app.test/billing?order=INV-123', outcome),
    )
    assert.equal(url.searchParams.get('order'), 'INV-123')
    assert.equal(readCheckoutOutcome(url.searchParams.get('payment')), outcome)
  }
  for (const value of ['__proto__', 'constructor', 'paid', '', null])
    assert.equal(readCheckoutOutcome(value), null)
})

test('sweep authentication fails closed when unconfigured or given the wrong bearer', () => {
  assert.equal(safeSecretEqual(null, undefined), false)
  assert.equal(safeSecretEqual('secret', undefined), false)
  assert.equal(safeSecretEqual('wrong', 'secret'), false)
  assert.equal(safeSecretEqual('secret', 'secret'), true)
})
