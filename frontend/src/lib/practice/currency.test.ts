import assert from 'node:assert/strict'
import { test } from 'node:test'
import { editVndInput, formatVndInput } from './currency'
import { draftPayload } from './authoring'
import { templateDraft } from './workbook'

test('VND inputs group amounts without rounding and preserve empty or invalid imported values', () => {
  assert.equal(formatVndInput('2500000000'), '2.500.000.000')
  assert.equal(formatVndInput('0'), '0')
  assert.equal(formatVndInput(''), '')
  assert.equal(formatVndInput('9007199254740993'), '9.007.199.254.740.993')
  assert.equal(formatVndInput('-1000'), '-1000')
  assert.equal(formatVndInput('1000.5'), '1000.5')
})

test('typing, pasting grouped currency, clearing and leading zeros keep raw digits', () => {
  assert.deepEqual(editVndInput('250000000', '250.000.0000', 12), {
    value: '2500000000',
    caret: 13,
  })
  for (const text of [
    '2500000000',
    '2.500.000.000',
    '2,500,000,000 VND',
    '2 500 000 000 ₫',
  ]) {
    assert.equal(editVndInput('', text, text.length).value, '2500000000')
  }
  assert.deepEqual(editVndInput('1000', '', 0), { value: '', caret: 0 })
  assert.deepEqual(editVndInput('0', '0001', 4), { value: '1', caret: 1 })
  assert.equal(editVndInput('1000', '-1.000', 6).value, '1000')
  assert.equal(editVndInput('1000', '1e3', 3).value, '1000')
})

test('editing in the middle and deleting beside separators preserve the logical caret', () => {
  assert.deepEqual(editVndInput('2500000000', '2.5600.000.000', 4), {
    value: '25600000000',
    caret: 4,
  })
  assert.deepEqual(editVndInput('1000', '1000', 1, 'deleteContentBackward'), {
    value: '0',
    caret: 0,
  })
  assert.deepEqual(editVndInput('1234', '1234', 1, 'deleteContentForward'), {
    value: '134',
    caret: 1,
  })
  assert.deepEqual(
    editVndInput('2500000000', '2..000.000', 2, 'deleteContentBackward'),
    {
      value: '2000000',
      caret: 1,
    },
  )
})

test('formatted currency edits still produce numeric practice payloads', () => {
  const draft = templateDraft()
  for (const key of [
    'offering.price.amount',
    'offering.price.pricePerM2',
    'config.buyer.budget.min',
    'config.buyer.budget.max',
  ]) {
    draft[key] = editVndInput('', '2.500.000.000', 13).value
  }
  const payload = draftPayload(draft) as {
    offering: { price: { amount: number; pricePerM2: number } }
    config: { buyer: { budget: { min: number; max: number } } }
  }
  assert.equal(payload.offering.price.amount, 2500000000)
  assert.equal(payload.offering.price.pricePerM2, 2500000000)
  assert.equal(payload.config.buyer.budget.min, 2500000000)
  assert.equal(payload.config.buyer.budget.max, 2500000000)
})
