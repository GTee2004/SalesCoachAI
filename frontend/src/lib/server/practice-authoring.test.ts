import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mock, test } from 'node:test'

test('custom practice deletion stays in its workspace and preserves call history', async (t) => {
  const previousUrl = process.env.DATABASE_URL
  // Initialize the lazy pool without connecting to any application database.
  process.env.DATABASE_URL = 'postgresql://test:test@localhost/test'
  const { db } = await import('#/db')
  const { deleteCustomPractice } = await import('./practice-authoring')
  if (previousUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = previousUrl
  // Execute the actual Drizzle UPDATE against an isolated relational database.
  // Only the Postgres driver is replaced; the workspace predicate is unchanged.
  const database = new DatabaseSync(':memory:')
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE practices (
      id TEXT PRIMARY KEY,
      created_by_user_id TEXT,
      status TEXT NOT NULL,
      workspace_id TEXT,
      is_global INTEGER NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE practice_sessions (
      id TEXT PRIMARY KEY,
      practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE RESTRICT
    );
    INSERT INTO practices VALUES
      ('owned', 'alice', 'published', 'personal', 0, NULL),
      ('other', 'bob', 'published', 'personal', 0, NULL),
      ('premade', NULL, 'published', NULL, 1, NULL),
      ('draft', 'alice', 'draft', 'personal', 0, NULL);
    INSERT INTO practice_sessions VALUES ('existing-call', 'owned');
  `)
  const queryMock = mock.method(
    db.$client,
    'query',
    async (query: { text: string; rowMode?: string }, values: string[]) => {
      const statement = database.prepare(query.text.replace(/\$\d+/g, '?'))
      const records = statement.all(
        ...values.map((v) => (typeof v === 'boolean' ? Number(v) : v)),
      )
      return {
        rows: query.rowMode === 'array' ? records.map(Object.values) : records,
        rowCount: records.length,
      }
    },
  )
  t.after(() => {
    queryMock.mock.restore()
    database.close()
  })
  function status(id: string) {
    return database.prepare('SELECT status FROM practices WHERE id = ?').get(id)
      ?.status
  }

  await t.test(
    'practices cannot be deleted through another workspace',
    async () => {
      assert.equal(await deleteCustomPractice('owned', 'company'), null)
      assert.equal(status('owned'), 'published')
    },
  )
  await t.test(
    'a practiced custom practice is archived, not removed',
    async () => {
      assert.deepEqual(await deleteCustomPractice('owned', 'personal'), {
        id: 'owned',
      })
      assert.equal(status('owned'), 'archived')
      assert.equal(
        database
          .prepare('SELECT COUNT(*) AS count FROM practice_sessions')
          .get()?.count,
        1,
      )
    },
  )
  // Role checks happen in the route; any authorized manager may delete any
  // practice in the workspace, whoever authored it.
  await t.test(
    'practices by another author in the workspace can be deleted',
    async () => {
      assert.deepEqual(await deleteCustomPractice('other', 'personal'), {
        id: 'other',
      })
      assert.equal(status('other'), 'archived')
    },
  )
  await t.test('premade practices cannot be deleted', async () => {
    assert.equal(await deleteCustomPractice('premade', 'personal'), null)
    assert.equal(status('premade'), 'published')
  })
  await t.test('missing IDs do not change any practice', async () => {
    assert.equal(await deleteCustomPractice('missing', 'personal'), null)
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM practices').get()?.count,
      4,
    )
  })
  await t.test('repeated deletion is idempotent', async () => {
    assert.deepEqual(await deleteCustomPractice('owned', 'personal'), {
      id: 'owned',
    })
    assert.equal(status('owned'), 'archived')
  })
  await t.test('drafts can be deleted', async () => {
    assert.deepEqual(await deleteCustomPractice('draft', 'personal'), {
      id: 'draft',
    })
    assert.equal(status('draft'), 'archived')
  })
})
