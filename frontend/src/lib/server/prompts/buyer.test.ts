import assert from 'node:assert/strict'
import test from 'node:test'
import type { AddressTerm, PracticeAgentConfig } from '#/db/schema'
import { checkInLine, hangUpLine } from './buyer'

const buyer = (addressTerm: AddressTerm) =>
  ({ buyer: { addressTerm } }) as PracticeAgentConfig

test('Silence lines address the caller as the buyer would', () => {
  assert.equal(checkInLine(buyer('anh')), 'Alo, em còn ở đó không?')
  assert.equal(hangUpLine(buyer('anh')), 'Anh cúp máy nhé.')
  assert.equal(checkInLine(buyer('bác')), 'Alo, cháu còn ở đó không?')
  assert.equal(hangUpLine(buyer('chị')), 'Chị cúp máy nhé.')
})

test('A younger buyer leaves the caller unnamed', () => {
  assert.equal(checkInLine(buyer('em')), 'Alo?')
  assert.equal(hangUpLine(buyer('em')), 'Em cúp máy nhé.')
})
