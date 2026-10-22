import { createAuthClient } from 'better-auth/react'
import {
  emailOTPClient,
  organizationClient,
  usernameClient,
} from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [emailOTPClient(), usernameClient(), organizationClient()],
})
