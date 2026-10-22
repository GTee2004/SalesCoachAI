import { config } from 'dotenv'
import { Client } from 'pg'

// One-off data migration: personal workspaces used to be stored as "Personal
// workspace" (and briefly "Không gian cá nhân"). New ones are created as
// "Tài khoản cá nhân", so existing rows are renamed here to match. Only
// personal workspaces that still carry an old default name are touched, and it
// is safe to re-run.
config({ path: ['.env.local', '.env'] })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const OLD_NAMES = ['Personal workspace', 'Không gian cá nhân']
const NEW_NAME = 'Tài khoản cá nhân'

async function main() {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('BEGIN')
    const companies = await client.query(
      `UPDATE company SET name = $2
       WHERE name = ANY($1) AND id IN (
         SELECT o.company_id FROM organization o
         JOIN workspace_profiles wp ON wp.workspace_id = o.id
         WHERE wp.kind = 'personal' AND o.name = ANY($1)
       )`,
      [OLD_NAMES, NEW_NAME],
    )
    const organizations = await client.query(
      `UPDATE organization o SET name = $2
       FROM workspace_profiles wp
       WHERE wp.workspace_id = o.id AND wp.kind = 'personal' AND o.name = ANY($1)`,
      [OLD_NAMES, NEW_NAME],
    )
    await client.query('COMMIT')
    console.log(
      `Renamed ${organizations.rowCount ?? 0} workspace(s) and ${companies.rowCount ?? 0} company record(s).`,
    )
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
