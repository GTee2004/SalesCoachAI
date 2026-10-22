import { drizzle } from 'drizzle-orm/node-postgres'

import * as schema from './schema.ts'

// A new TLS connection to a managed database in another region takes 3-4 s.
// Without a deadline, a server that accepts TCP but never answers keeps its
// pool slot forever, and so does every caller queued behind a full pool.
const DATABASE_CONNECT_TIMEOUT_MS = 10_000

export const db = drizzle({
  connection: {
    connectionString: process.env.DATABASE_URL!,
    connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS,
  },
  schema,
})
