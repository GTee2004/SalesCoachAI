import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { creditGrants, creditReservations } from '#/db/schema'
import { allocateSettlement } from './credits'

test('credit reservations hold unconsumed balance until settlement', () => {
  const database = new DatabaseSync(':memory:')
  try {
    const constraint = getTableConfig(creditGrants).checks.find(
      (check) => check.name === 'credit_grants_balance_valid',
    )!
    const expression = new PgDialect().sqlToQuery(constraint.value).sql
    database.exec(`CREATE TABLE credit_grants (
      total_seconds INTEGER NOT NULL,
      remaining_seconds INTEGER NOT NULL,
      reserved_seconds INTEGER NOT NULL,
      CHECK (${expression})
    )`)
    database.exec('INSERT INTO credit_grants VALUES (9000, 9000, 0)')
    database.exec('UPDATE credit_grants SET reserved_seconds = 900')
    assert.deepEqual(
      { ...database.prepare('SELECT * FROM credit_grants').get() },
      { total_seconds: 9000, remaining_seconds: 9000, reserved_seconds: 900 },
    )
    database.exec('UPDATE credit_grants SET reserved_seconds = 9000')
    assert.throws(
      () => database.exec('UPDATE credit_grants SET reserved_seconds = 9001'),
      /CHECK constraint failed/,
    )
    database.exec(
      'UPDATE credit_grants SET remaining_seconds = 8700, reserved_seconds = 0',
    )
    assert.deepEqual(
      { ...database.prepare('SELECT * FROM credit_grants').get() },
      { total_seconds: 9000, remaining_seconds: 8700, reserved_seconds: 0 },
    )
    for (const assignment of [
      'reserved_seconds = -1',
      'remaining_seconds = -1',
      'remaining_seconds = 9001',
      'reserved_seconds = 8701',
    ]) {
      assert.throws(
        () => database.exec(`UPDATE credit_grants SET ${assignment}`),
        /CHECK constraint failed/,
      )
    }
    database.exec(
      'UPDATE credit_grants SET remaining_seconds = 0, reserved_seconds = 0',
    )
  } finally {
    database.close()
  }
})

test('settlement charges active time minus the waived outage', () => {
  assert.deepEqual(allocateSettlement([300], 240, 40), [
    { consumed: 200, waived: 40 },
  ])
  // The charge fills reservations in order; the waiver is recorded once.
  assert.deepEqual(allocateSettlement([100, 200], 250, 120), [
    { consumed: 100, waived: 120 },
    { consumed: 30, waived: 0 },
  ])
  // An attempt that never started is waived in full.
  assert.deepEqual(allocateSettlement([60], 55, 55), [
    { consumed: 0, waived: 55 },
  ])
  // Unused reservations release everything; waiving never exceeds use.
  assert.deepEqual(allocateSettlement([100, 200], 80, 500), [
    { consumed: 0, waived: 80 },
    { consumed: 0, waived: 0 },
  ])
  assert.deepEqual(allocateSettlement([300], 240, 0), [
    { consumed: 240, waived: 0 },
  ])
})

test('a call extended by an outage is charged no more than its reservation', () => {
  // 300 s reserved, 340 s used, 40 s of it lost to an outage.
  assert.deepEqual(allocateSettlement([300], 340, 40), [
    { consumed: 300, waived: 40 },
  ])
  assert.deepEqual(allocateSettlement([100, 200], 340, 40), [
    { consumed: 100, waived: 40 },
    { consumed: 200, waived: 0 },
  ])
})

test('settled time stays within the reservation; waived time is never negative', () => {
  const database = new DatabaseSync(':memory:')
  try {
    const dialect = new PgDialect()
    const checks = getTableConfig(creditReservations).checks.filter((check) =>
      [
        'credit_reservations_settlement_valid',
        'credit_reservations_waiver_valid',
      ].includes(check.name),
    )
    database.exec(`CREATE TABLE credit_reservations (
      reserved_seconds INTEGER NOT NULL,
      settled_seconds INTEGER,
      waived_seconds INTEGER NOT NULL DEFAULT 0,
      ${checks.map((check) => `CHECK (${dialect.sqlToQuery(check.value).sql})`).join(',\n')}
    )`)
    database.exec('INSERT INTO credit_reservations VALUES (300, NULL, 0)')
    // An extended call: fully charged reservation plus its waived outage.
    database.exec(
      'UPDATE credit_reservations SET settled_seconds = 300, waived_seconds = 40',
    )
    for (const assignment of ['waived_seconds = -1', 'settled_seconds = 301'])
      assert.throws(
        () => database.exec(`UPDATE credit_reservations SET ${assignment}`),
        /CHECK constraint failed/,
      )
  } finally {
    database.close()
  }
})
