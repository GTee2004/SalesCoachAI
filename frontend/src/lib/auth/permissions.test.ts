import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PERMISSIONS, can, canAny } from './permissions'

test('platform admins hold every permission', () => {
  for (const permission of Object.values(PERMISSIONS))
    assert.equal(can({ roles: ['admin'] }, permission), true)
})

test('ordinary users hold none', () => {
  for (const permission of Object.values(PERMISSIONS))
    assert.equal(can({ roles: ['user'] }, permission), false)
})

test('missing users, missing roles and unknown roles fail closed', () => {
  assert.equal(can(null, PERMISSIONS.couponsManage), false)
  assert.equal(can(undefined, PERMISSIONS.couponsManage), false)
  assert.equal(can({ roles: null }, PERMISSIONS.couponsManage), false)
  assert.equal(can({ roles: [] }, PERMISSIONS.couponsManage), false)
  assert.equal(can({ roles: ['superuser'] }, PERMISSIONS.couponsManage), false)
  // Built-in object keys must never be read as roles.
  assert.equal(
    can({ roles: ['constructor', '__proto__'] }, PERMISSIONS.couponsManage),
    false,
  )
})

test('a workspace manager is not a platform admin', () => {
  // Better Auth names the workspace manager role "admin" on the member row,
  // but only `user.roles` is ever passed here.
  assert.equal(can({ roles: ['user'] }, PERMISSIONS.couponsView), false)
})

test('canAny is true when one permission matches', () => {
  assert.equal(canAny({ roles: ['admin'] }, [PERMISSIONS.couponsView]), true)
  assert.equal(canAny({ roles: ['user'] }, Object.values(PERMISSIONS)), false)
})

test('moderators can view the admin dashboard but nothing else', () => {
  assert.equal(
    can({ roles: ['moderator'] }, PERMISSIONS.adminDashboardView),
    true,
  )
  assert.equal(can({ roles: ['moderator'] }, PERMISSIONS.couponsView), false)
  assert.equal(can({ roles: ['moderator'] }, PERMISSIONS.couponsManage), false)
})
