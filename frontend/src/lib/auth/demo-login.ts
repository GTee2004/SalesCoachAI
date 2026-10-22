import { createServerFn } from '@tanstack/react-start'

// Kept on the server so the credentials only reach the browser when enabled.
const DEMO_ACCOUNT = { email: 'demo@demo.com', password: 'demo1234' }

export const getDemoLogin = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { env } = await import('#/env')
    return env.DEMO_LOGIN === 'on' ? DEMO_ACCOUNT : null
  },
)
