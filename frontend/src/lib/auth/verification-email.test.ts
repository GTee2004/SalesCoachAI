import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clearVerificationEmailFailure,
  markVerificationEmailFailed,
  takeVerificationEmailFailure,
} from './verification-email'

test('a failed send is reported once, whatever the email casing', () => {
  markVerificationEmailFailed('Lan@Example.com')
  assert.equal(takeVerificationEmailFailure(' lan@example.com '), true)
  assert.equal(takeVerificationEmailFailure('lan@example.com'), false)
})

test('emails that did not fail are not reported', () => {
  markVerificationEmailFailed('a@example.com')
  assert.equal(takeVerificationEmailFailure('b@example.com'), false)
  assert.equal(takeVerificationEmailFailure(undefined), false)
  clearVerificationEmailFailure('a@example.com')
})

test('clearing drops an earlier failure', () => {
  markVerificationEmailFailed('c@example.com')
  clearVerificationEmailFailure('c@example.com')
  assert.equal(takeVerificationEmailFailure('c@example.com'), false)
})

test('failures older than a minute are ignored', () => {
  markVerificationEmailFailed('d@example.com', 0)
  assert.equal(takeVerificationEmailFailure('d@example.com', 60_001), false)
})
