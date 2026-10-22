import { createInterface } from 'node:readline/promises'
import { config } from 'dotenv'
import { Client } from 'pg'

// One-off hot fix: sessions evaluated before the any-order behavior scoring
// (3a41cad) keep their old stored scores and key coaching points, which the
// team performance page, history filters and competency profiles read
// directly. Removing practice history lets every view agree. Accounts,
// workspaces, practices, billing and credits are left untouched.

config({ path: ['.env.local', '.env'] })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

// Turns, evaluations and competency scores cascade from practice_sessions.
const countsSql = `
  SELECT
    (SELECT count(*) FROM public.practice_sessions)::int AS sessions,
    (SELECT count(*) FROM public.practice_sessions WHERE status = 'in_progress')::int AS "inProgress",
    (SELECT count(*) FROM public.practice_session_turns)::int AS turns,
    (SELECT count(*) FROM public.practice_session_evaluations)::int AS evaluations,
    (SELECT count(*) FROM public.practice_session_competency_scores)::int AS "competencyScores",
    (SELECT count(*) FROM public.learner_competency_profiles)::int AS profiles
`

type Counts = {
  sessions: number
  inProgress: number
  turns: number
  evaluations: number
  competencyScores: number
  profiles: number
}

function describeTarget(url: string) {
  const parsed = new URL(url)
  return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}`
}

function printCounts(counts: Counts) {
  console.log(`  practice_sessions                   ${counts.sessions}`)
  console.log(`  practice_session_turns              ${counts.turns}`)
  console.log(`  practice_session_evaluations        ${counts.evaluations}`)
  console.log(
    `  practice_session_competency_scores  ${counts.competencyScores}`,
  )
  console.log(`  learner_competency_profiles         ${counts.profiles}`)
}

async function main() {
  if (!process.stdin.isTTY) {
    throw new Error(
      'An interactive terminal is required to confirm this operation',
    )
  }

  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const {
      rows: [before],
    } = await client.query<Counts>(countsSql)

    console.warn(
      `WARNING: This will permanently delete all practice sessions, their turns, evaluations and competency scores, and every learner competency profile in ${describeTarget(databaseUrl!)}.`,
    )
    printCounts(before)
    if (before.inProgress)
      console.warn(
        `${before.inProgress} session(s) are in progress. Anyone mid-call will lose that session.`,
      )

    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    let confirmed = false
    try {
      const answer = await prompt.question('Type PURGE to confirm: ')
      confirmed = answer.trim() === 'PURGE'
    } finally {
      prompt.close()
    }

    if (!confirmed) {
      console.log('Cancelled. Nothing was deleted.')
      return
    }

    let deleted: Counts
    await client.query('BEGIN')
    try {
      // Sessions can be created while the prompt waits; report what is removed.
      ;({
        rows: [deleted],
      } = await client.query<Counts>(countsSql))
      await client.query('DELETE FROM public.learner_competency_profiles')
      await client.query('DELETE FROM public.practice_sessions')

      const {
        rows: [after],
      } = await client.query<Counts>(countsSql)
      if (Object.values(after).some((count) => count !== 0))
        throw new Error('Expected every practice history table to be empty')

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
    console.log('Deleted:')
    printCounts(deleted)
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
