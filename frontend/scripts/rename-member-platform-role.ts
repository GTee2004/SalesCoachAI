import { config } from 'dotenv'
import { Client } from 'pg'

// One-off data migration: the default platform role changed from 'member' to
// 'user' so it no longer clashes with the workspace 'member' role. db:push only
// changes the schema, so existing rows are rewritten here. Safe to re-run.
config({ path: ['.env.local', '.env'] })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

async function main() {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const result = await client.query(
      `UPDATE "user" SET roles = array_replace(roles, 'member', 'user')
       WHERE 'member' = ANY(roles)`,
    )
    console.log(`Updated ${result.rowCount ?? 0} user(s).`)
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
