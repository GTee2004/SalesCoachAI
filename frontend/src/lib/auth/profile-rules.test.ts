import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  nameSchema,
  normalizeUsername,
  usernameCodeSchema,
  usernameSchema,
} from './profile-rules'

test('usernames follow the signup rule: 3-30 letters, digits, _ and .', () => {
  assert.ok(usernameSchema.safeParse('lan_nguyen.01').success)
  assert.ok(usernameSchema.safeParse('  lan  ').success)
  assert.ok(!usernameSchema.safeParse('ab').success)
  assert.ok(!usernameSchema.safeParse('a'.repeat(31)).success)
  assert.ok(!usernameSchema.safeParse('lan nguyen').success)
  assert.ok(!usernameSchema.safeParse('lan@nguyen').success)
})

test('usernames are compared lower-case and trimmed', () => {
  assert.equal(normalizeUsername('  Lan_Nguyen '), 'lan_nguyen')
})

test('a name is trimmed and cannot be blank', () => {
  assert.equal(nameSchema.parse('  Nguyễn Văn A '), 'Nguyễn Văn A')
  assert.ok(!nameSchema.safeParse('   ').success)
  assert.ok(!nameSchema.safeParse('a'.repeat(101)).success)
})

test('the emailed code is exactly six digits', () => {
  assert.ok(usernameCodeSchema.safeParse('012345').success)
  assert.ok(!usernameCodeSchema.safeParse('12345').success)
  assert.ok(!usernameCodeSchema.safeParse('12345a').success)
})
