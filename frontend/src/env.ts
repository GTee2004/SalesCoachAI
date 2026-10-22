import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'
import { createIsomorphicFn } from '@tanstack/react-start'
// Dynamically target process.env on the server and import.meta.env on Vite client
const getRuntimeEnv = createIsomorphicFn()
  .server(() => process.env)
  .client(() => import.meta.env)
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'production']).default('development'),
    DATABASE_URL: z.url(),
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().trim().min(1),
    SMTP_USER: z.string().trim().min(1),
    SMTP_PASSWORD: z.string().trim().min(1),
    SMTP_HOST: z.string().trim().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    VOICE_BACKEND_INTERNAL_URL: z.url(),
    VOICE_BACKEND_PUBLIC_URL: z.url(),
    VOICE_CONTROL_API_KEY: z.string().trim().min(32),
    VOICE_TOKEN_SECRET: z.string().trim().min(32),
    VOICE_EVENT_INGEST_KEY: z.string().trim().min(32),
    // Outage emails to admins. Unset: on in production, off in development.
    SERVICE_ALERT_EMAILS: z.enum(['on', 'off']).optional(),
    SEPAY_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
    BILLING_PUBLIC_BASE_URL: z.url().optional(),
    SEPAY_MERCHANT_ID: z.string().trim().min(1).optional(),
    SEPAY_SECRET_KEY: z.string().trim().min(1).optional(),
    // Billing may be unconfigured at startup; checkout and IPNs require this
    // secret in both sandbox and production.
    SEPAY_IPN_SECRET: z.string().trim().min(1).optional(),
    BILLING_SWEEP_SECRET: z.string().trim().min(32).optional(),
    // Links admins from a call to its voice trace. Same host as the voice
    // backend's LANGFUSE_BASE_URL; the project id is in the Langfuse URL.
    LANGFUSE_BASE_URL: z.url().optional(),
    LANGFUSE_PROJECT_ID: z.string().trim().min(1).optional(),
    // Shows the demo account's credentials on the login page.
    DEMO_LOGIN: z.enum(['on', 'off']).optional(),
  },

  /**
   * The prefix that client-side variables must have. This is enforced both at
   * a type-level and at runtime.
   */
  clientPrefix: 'VITE_',

  client: {
    VITE_APP_TITLE: z.string().min(1).optional(),
  },

  /**
   * What object holds the environment variables at runtime. This is usually
   * `process.env` or `import.meta.env`.
   */
  runtimeEnv: getRuntimeEnv(),

  /**
   * By default, this library will feed the environment variables directly to
   * the Zod validator.
   *
   * This means that if you have an empty string for a value that is supposed
   * to be a number (e.g. `PORT=` in a ".env" file), Zod will incorrectly flag
   * it as a type mismatch violation. Additionally, if you have an empty string
   * for a value that is supposed to be a string with a default value (e.g.
   * `DOMAIN=` in an ".env" file), the default value will never be applied.
   *
   * In order to solve these issues, we recommend that all new projects
   * explicitly specify this option as true.
   */
  emptyStringAsUndefined: true,
})
