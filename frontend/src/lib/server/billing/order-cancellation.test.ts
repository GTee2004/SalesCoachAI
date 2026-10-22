import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cancelUnpaidOrder, maintenanceRetryDelay } from './order-cancellation'
import type { SepayOrder } from './sepay-client'

const order = {
  orderInvoiceNumber: 'INV-123',
  amountVnd: 299000,
  currency: 'VND',
}
const unpaid: SepayOrder = {
  id: '1',
  order_id: 'SEPAY-123',
  order_invoice_number: order.orderInvoiceNumber,
  order_amount: '299000.00',
  order_currency: 'VND',
  order_status: 'AUTHENTICATION_NOT_NEEDED',
  transactions: [],
}

function fixture(initial = unpaid) {
  let remote: SepayOrder | null = { ...initial }
  let status = 'pending'
  let cancelCount = 0
  const dependencies = {
    lookup: async () => remote,
    cancel: async () => {
      cancelCount++
      remote = { ...unpaid, order_status: 'CANCELLED' }
    },
    reconcile: async (value: SepayOrder) => {
      // Match the production conditional transition; an IPN-paid order must
      // never be overwritten by an older cancellation lookup.
      if (
        ['CANCELLED', 'CANCELED'].includes(value.order_status) &&
        status === 'pending'
      )
        status = 'cancelled'
      if (value.order_status === 'CAPTURED')
        status = status === 'cancelled' ? 'review' : 'paid'
    },
    status: async () => status,
  }
  return {
    dependencies,
    cancelCount: () => cancelCount,
    setRemote: (value: SepayOrder | null) => {
      remote = value
    },
    setStatus: (value: string) => {
      status = value
    },
  }
}

test('unpaid cancellation is verified before and after; repeat cancellation is idempotent', async () => {
  const f = fixture()
  assert.equal(await cancelUnpaidOrder(order, f.dependencies), 'cancelled')
  assert.equal(await cancelUnpaidOrder(order, f.dependencies), 'cancelled')
  assert.equal(f.cancelCount(), 1)
})

test('paid or already cancelled remote orders are reconciled without sending cancellation', async () => {
  for (const order_status of ['CAPTURED', 'CANCELLED', 'CANCELED']) {
    const f = fixture({ ...unpaid, order_status })
    assert.equal(
      await cancelUnpaidOrder(order, f.dependencies),
      order_status === 'CAPTURED' ? 'paid' : 'cancelled',
    )
    assert.equal(f.cancelCount(), 0)
  }
})

test('payment completing during cancellation is retained even when the cancel request fails', async () => {
  const f = fixture()
  f.dependencies.cancel = async () => {
    f.setRemote({ ...unpaid, order_status: 'CAPTURED' })
    throw new Response('Already paid', { status: 503 })
  }
  assert.equal(await cancelUnpaidOrder(order, f.dependencies), 'paid')
})

test('an IPN paid status cannot be downgraded by a cancellation response', async () => {
  const f = fixture()
  f.dependencies.cancel = async () => {
    f.setStatus('paid')
    f.setRemote({ ...unpaid, order_status: 'CANCELLED' })
  }
  assert.equal(await cancelUnpaidOrder(order, f.dependencies), 'paid')
})

test('a timeout after successful provider cancellation can be recovered by lookup', async () => {
  const f = fixture()
  f.dependencies.cancel = async () => {
    f.setRemote({ ...unpaid, order_status: 'CANCELLED' })
    throw new Error('Timeout')
  }
  assert.equal(await cancelUnpaidOrder(order, f.dependencies), 'cancelled')
})

test('404, unknown state, cards and mismatching payment details never cause cancellation', async () => {
  for (const remote of [
    null,
    { ...unpaid, order_status: 'UNKNOWN' },
    { ...unpaid, payment_method: 'CARD' },
    {
      ...unpaid,
      transactions: [
        {
          id: '1',
          transaction_type: 'PAYMENT',
          transaction_status: 'APPROVED',
          transaction_amount: '299000',
          transaction_currency: 'VND',
        },
      ],
    },
    { ...unpaid, order_amount: '1' },
    { ...unpaid, order_currency: 'USD' },
    { ...unpaid, order_invoice_number: 'other' },
  ]) {
    const f = fixture()
    f.setRemote(remote)
    await assert.rejects(
      cancelUnpaidOrder(order, f.dependencies),
      (error: Response) => [409, 503].includes(error.status),
    )
    assert.equal(f.cancelCount(), 0)
    assert.equal(await f.dependencies.status(), 'pending')
  }
})

test('success response without confirmed cancellation stays unresolved and retries', async () => {
  const f = fixture()
  f.dependencies.cancel = async () => {}
  await assert.rejects(
    cancelUnpaidOrder(order, f.dependencies),
    (error: Response) => error.status === 503,
  )
  assert.equal(await f.dependencies.status(), 'pending')
})

test('cancellation failure without a terminal state keeps the order pending', async () => {
  const f = fixture()
  const failure = new Response('Unavailable', { status: 503 })
  f.dependencies.cancel = async () => {
    throw failure
  }
  await assert.rejects(
    cancelUnpaidOrder(order, f.dependencies),
    (error) => error === failure,
  )
  assert.equal(await f.dependencies.status(), 'pending')
})

test('retry delay doubles and remains capped at one hour', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 99].map(maintenanceRetryDelay),
    [1, 2, 4, 8, 16, 32, 60, 60].map((minutes) => minutes * 60_000),
  )
})
