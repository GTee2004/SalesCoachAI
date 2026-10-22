import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canInviteWorkspaceRole,
  canManageWorkspaceMember,
  canManageWorkspaceMembers,
  canManageWorkspacePractices,
  canRenameWorkspace,
  getWorkspaceRole,
} from './workspace-roles'

test('the highest of several comma-joined roles wins', () => {
  assert.equal(getWorkspaceRole('member,admin'), 'admin')
  assert.equal(getWorkspaceRole('admin, owner'), 'owner')
  assert.equal(getWorkspaceRole('member'), 'member')
})

test('unknown or missing roles are treated as plain members', () => {
  assert.equal(getWorkspaceRole(null), 'member')
  assert.equal(getWorkspaceRole(undefined), 'member')
  assert.equal(getWorkspaceRole('superuser'), 'member')
})

test('only owners rename a workspace', () => {
  assert.equal(canRenameWorkspace('owner'), true)
  assert.equal(canRenameWorkspace('admin'), false)
  assert.equal(canRenameWorkspace('member'), false)
})

test('owners and managers manage the member list, members do not', () => {
  assert.equal(canManageWorkspaceMembers('owner'), true)
  assert.equal(canManageWorkspaceMembers('admin'), true)
  assert.equal(canManageWorkspaceMembers('member'), false)
})

test('managers invite only members; owners can also invite managers', () => {
  assert.equal(canInviteWorkspaceRole('admin', 'member'), true)
  assert.equal(canInviteWorkspaceRole('admin', 'admin'), false)
  assert.equal(canInviteWorkspaceRole('admin', 'owner'), false)
  assert.equal(canInviteWorkspaceRole('owner', 'admin'), true)
  assert.equal(canInviteWorkspaceRole('owner', 'owner'), false)
  assert.equal(canInviteWorkspaceRole('member', 'member'), false)
})

test('managers cannot touch other managers or the owner', () => {
  assert.equal(canManageWorkspaceMember('admin', 'member'), true)
  assert.equal(canManageWorkspaceMember('admin', 'admin'), false)
  assert.equal(canManageWorkspaceMember('admin', 'owner'), false)
  assert.equal(canManageWorkspaceMember('owner', 'admin'), true)
  assert.equal(canManageWorkspaceMember('owner', 'owner'), false)
  assert.equal(canManageWorkspaceMember('member', 'member'), false)
})

test('only owners and managers of a company workspace manage practices', () => {
  assert.equal(canManageWorkspacePractices('company', 'owner'), true)
  assert.equal(canManageWorkspacePractices('company', 'admin'), true)
  assert.equal(canManageWorkspacePractices('company', 'member,admin'), true)
  assert.equal(canManageWorkspacePractices('company', 'member'), false)
  assert.equal(canManageWorkspacePractices('company', null), false)
  // Personal workspaces are a Business upsell, even for their owner.
  assert.equal(canManageWorkspacePractices('personal', 'owner'), false)
  assert.equal(canManageWorkspacePractices(undefined, 'owner'), false)
})
