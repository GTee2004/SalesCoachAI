import { createInterface } from 'node:readline/promises'
import { config } from 'dotenv'
import { Client } from 'pg'

config({ path: ['.env.local', '.env'] })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const authTables = ['user', 'session', 'account', 'verification'] as const
const authTableNames = new Set<string>(authTables)
const listTablesSql = `
  SELECT c.oid::text AS oid, c.relname AS name
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  ORDER BY c.relname
`

type Table = { oid: string; name: string }

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

async function main() {
  console.warn(
    `WARNING: This will permanently drop every non-auth table in public with CASCADE, including its data and dependent objects. Only these tables are preserved: ${authTables.join(', ')}.`,
  )

  if (!process.stdin.isTTY) {
    throw new Error(
      'An interactive terminal is required to confirm this operation',
    )
  }

  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  let confirmed = false
  try {
    const answer = await prompt.question('Type DROP to confirm: ')
    confirmed = answer.trim() === 'DROP'
  } finally {
    prompt.close()
  }

  if (!confirmed) {
    console.log('Cancelled. No tables were dropped.')
    return
  }

  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('BEGIN')
    try {
      const { rows: tables } = await client.query<Table>(listTablesSql)
      const tableByName = new Map(tables.map((table) => [table.name, table]))
      const missingAuthTables = authTables.filter(
        (name) => !tableByName.has(name),
      )
      if (missingAuthTables.length)
        throw new Error(`Missing auth tables: ${missingAuthTables.join(', ')}`)

      const toDrop = tables.filter((table) => !authTableNames.has(table.name))
      for (const table of toDrop) {
        await client.query(
          `DROP TABLE IF EXISTS public.${quoteIdentifier(table.name)} CASCADE`,
        )
      }

      const { rows: remaining } = await client.query<Table>(listTablesSql)
      if (
        remaining.length !== authTables.length ||
        remaining.some(
          (table) =>
            !authTableNames.has(table.name) ||
            table.oid !== tableByName.get(table.name)?.oid,
        )
      )
        throw new Error('Expected only the original auth tables to remain')

      await client.query('COMMIT')
      console.log(
        toDrop.length
          ? `Dropped ${toDrop.length} non-auth tables from public: ${toDrop.map((table) => table.name).join(', ')}`
          : 'No non-auth tables found in public',
      )
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
