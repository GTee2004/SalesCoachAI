import { betterAuth } from 'better-auth'
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import {
  emailOTP,
  organization as organizationPlugin,
  username,
} from 'better-auth/plugins'
import { createEmailVerificationEmail } from '@/lib/emails/email-templates/email-verification'
import { createResetPasswordEmail } from '@/lib/emails/email-templates/reset-password'
import { createWorkspaceInvitationEmail } from '@/lib/emails/email-templates/workspace-invitation'
import { sendMail } from '@/lib/emails/send-mail'
import {
  ensurePersonalWorkspace,
  isCompanyWorkspace,
} from '@/lib/server/workspaces'
import {
  assignWorkspaceSeat,
  revokeWorkspaceSeat,
} from '@/lib/server/billing/credits'
import { getSeatAvailability } from '@/lib/server/billing/seats'
import {
  assertCanCancelInvitation,
  assertCanChangeMemberRole,
  assertCanInvite,
  prepareToLeave,
  prepareToRemove,
  sanitizeWorkspaceUpdate,
} from '@/lib/server/workspace-members'
import { db } from '@/db'
import { company } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { nameSchema } from '@/lib/auth/profile-rules'
import { USER_ROLE } from '@/lib/auth/roles'
import {
  VERIFICATION_EMAIL_FAILED,
  clearVerificationEmailFailure,
  markVerificationEmailFailed,
  takeVerificationEmailFailure,
} from '@/lib/auth/verification-email'
import { env } from '@/env'

const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60

// Requests that send an email-verification code.
const VERIFICATION_EMAIL_PATHS = new Set([
  '/sign-up/email',
  '/sign-in/email',
  '/email-otp/send-verification-otp',
])

async function requireCompanyWorkspace(workspaceId: string) {
  if (!(await isCompanyWorkspace(workspaceId))) {
    throw new APIError('FORBIDDEN', {
      message: 'Không được thay đổi cấu trúc tài khoản cá nhân.',
    })
  }
}

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        ...createResetPasswordEmail({ url }),
      })
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 10 * 60,
  },
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          await ensurePersonalWorkspace(createdUser.id)
        },
      },
    },

    session: {
      create: {
        before: async (newSession) => {
          const workspaceId = await ensurePersonalWorkspace(newSession.userId)

          return {
            data: {
              ...newSession,
              activeOrganizationId: workspaceId,
            },
          }
        },
      },
    },
  },
  user: {
    additionalFields: {
      roles: {
        type: 'string[]',
        required: true,
        input: false,
        defaultValue: [USER_ROLE],
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path && VERIFICATION_EMAIL_PATHS.has(ctx.path))
        clearVerificationEmailFailure(ctx.body?.email)

      // Better Auth passes the removed or updated member to these hooks, not
      // the person acting, so the acting user is resolved here.
      if (
        ctx.path === '/organization/leave' ||
        ctx.path === '/organization/remove-member' ||
        ctx.path === '/organization/update-member-role'
      ) {
        const session = await getSessionFromCtx(ctx)
        if (!session)
          throw new APIError('UNAUTHORIZED', {
            message: 'Vui lòng đăng nhập.',
          })
        const workspaceId =
          ctx.body?.organizationId ?? session.session.activeOrganizationId

        if (typeof workspaceId !== 'string') {
          throw new APIError('BAD_REQUEST', {
            message: 'Thiếu mã không gian làm việc.',
          })
        }

        await requireCompanyWorkspace(workspaceId)
        if (ctx.path === '/organization/leave')
          await prepareToLeave({ userId: session.user.id, workspaceId })
        else if (ctx.path === '/organization/remove-member')
          await prepareToRemove({
            actorId: session.user.id,
            workspaceId,
            memberIdOrEmail: String(ctx.body?.memberIdOrEmail ?? ''),
          })
        else
          await assertCanChangeMemberRole({
            actorId: session.user.id,
            workspaceId,
            memberId: String(ctx.body?.memberId ?? ''),
            newRole: String(ctx.body?.role ?? ''),
          })
        return
      }

      if (ctx.path === '/update-user') {
        // A username change needs the emailed code, which only the
        // username-change server functions check.
        if (ctx.body?.username !== undefined)
          throw new APIError('FORBIDDEN', {
            message: 'Hãy đổi bí danh bằng mã xác minh gửi qua email.',
          })
        if (ctx.body?.name === undefined) return
        const parsedName = nameSchema.safeParse(ctx.body.name)
        if (!parsedName.success)
          throw new APIError('BAD_REQUEST', {
            message: parsedName.error.issues[0]?.message ?? 'Tên không hợp lệ.',
          })
        return {
          context: { body: { ...ctx.body, name: parsedName.data } },
        }
      }

      if (ctx.path !== '/sign-up/email') return

      const submittedUsername = ctx.body?.username
      if (typeof submittedUsername !== 'string' || !submittedUsername.trim()) {
        throw new APIError('BAD_REQUEST', {
          code: 'USERNAME_REQUIRED',
          message: 'Username is required',
        })
      }

      // Better Auth requires a name; email signup uses the username for it.
      const trimmedUsername = submittedUsername.trim()
      return {
        context: {
          body: {
            ...ctx.body,
            username: trimmedUsername,
            name: trimmedUsername,
          },
        },
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (!ctx.path || !VERIFICATION_EMAIL_PATHS.has(ctx.path)) return
      if (!takeVerificationEmailFailure(ctx.body?.email)) return

      const returned = ctx.context.returned
      if (ctx.path === '/sign-up/email') {
        // The account exists by now, so sign-up still succeeds and the
        // verify page offers to send the code again.
        if (returned instanceof APIError || !returned) return
        return ctx.json({ ...returned, verificationEmailSent: false })
      }
      throw new APIError(
        ctx.path === '/sign-in/email' ? 'FORBIDDEN' : 'SERVICE_UNAVAILABLE',
        {
          code: VERIFICATION_EMAIL_FAILED,
          message: 'Could not send the verification email',
        },
      )
    }),
  },
  plugins: [
    // Usernames are stored lower-case only; there is no separate display copy.
    username({ displayUsername: false }),
    emailOTP({
      overrideDefaultEmailVerification: true,
      otpLength: 6,
      expiresIn: 10 * 60,
      allowedAttempts: 5,
      storeOTP: 'hashed',
      rateLimit: { window: 60, max: 3 },
      async sendVerificationOTP({ email, otp, type }) {
        try {
          await sendMail({
            to: email,
            ...createEmailVerificationEmail({ otp, type }),
          })
        } catch (error) {
          if (type === 'email-verification') markVerificationEmailFailed(email)
          throw error
        }
      },
    }),
    organizationPlugin({
      allowUserToCreateOrganization: false,
      invitationExpiresIn: INVITATION_TTL_SECONDS,
      requireEmailVerificationOnInvitation: true,
      async sendInvitationEmail({ id, email, organization, inviter }) {
        await sendMail({
          to: email,
          ...createWorkspaceInvitationEmail({
            url: `${env.BETTER_AUTH_URL}/accept-invitation/${id}`,
            workspaceName: organization.name,
            inviterName: inviter.user.name,
          }),
        })
      },
      schema: {
        organization: {
          additionalFields: {
            companyId: { type: 'string', required: true, input: false },
          },
        },
      },
      organizationHooks: {
        // Even server-side Better Auth creation must not bypass the transaction
        // that provisions the company, workspace profile and owner membership.
        beforeCreateOrganization: async () => {
          throw new APIError('FORBIDDEN', {
            message:
              'Hãy tạo không gian làm việc qua luồng tạo không gian làm việc của ứng dụng.',
          })
        },
        beforeUpdateOrganization: async ({ organization, user, member }) => {
          await requireCompanyWorkspace(member.organizationId)
          const data = await sanitizeWorkspaceUpdate({
            actorId: user.id,
            actorRole: member.role,
            workspaceId: member.organizationId,
            data: organization,
          })
          return { data }
        },
        // The company keeps its own copy of the name.
        afterUpdateOrganization: async ({ organization }) => {
          if (!organization?.companyId) return
          await db
            .update(company)
            .set({ name: organization.name })
            .where(eq(company.id, organization.companyId))
        },
        beforeDeleteOrganization: async ({ organization }) => {
          await requireCompanyWorkspace(organization.id)
        },
        beforeCreateInvitation: async ({
          invitation,
          inviter,
          organization,
        }) => {
          await requireCompanyWorkspace(organization.id)
          await assertCanInvite({
            actorId: inviter.id,
            workspaceId: organization.id,
            role: invitation.role,
          })
        },
        beforeCancelInvitation: async ({
          invitation,
          cancelledBy,
          organization,
        }) => {
          await requireCompanyWorkspace(organization.id)
          await assertCanCancelInvitation({
            actorId: cancelledBy.id,
            workspaceId: organization.id,
            invitationRole: invitation.role,
          })
        },
        beforeAcceptInvitation: async ({ organization }) => {
          await requireCompanyWorkspace(organization.id)
          // Pending invitations already hold their seat, so only the seats
          // actually in use matter here; they can have grown or shrunk since.
          const seats = await getSeatAvailability(organization.id)
          if (!seats.active || seats.used >= seats.limit)
            throw new APIError('CONFLICT', {
              message:
                'Không gian làm việc chưa có suất trống cho bạn. Hãy liên hệ chủ sở hữu.',
            })
        },
        afterAcceptInvitation: async ({ member, organization }) => {
          try {
            await assignWorkspaceSeat({
              workspaceId: organization.id,
              userId: member.userId,
              assignedBy: null,
              reason: 'invitation_accepted',
            })
          } catch (error) {
            // The membership is already saved; the owner can still give this
            // member a seat from the members page.
            console.error('[Workspace] seat assignment after accept failed', {
              workspaceId: organization.id,
              userId: member.userId,
              error,
            })
          }
        },
        beforeAddMember: async ({ organization }) => {
          await requireCompanyWorkspace(organization.id)
        },
        // Requests through /organization/remove-member already released the
        // seat with the remover recorded; this covers any other caller.
        beforeRemoveMember: async ({ organization, member }) => {
          await requireCompanyWorkspace(organization.id)
          await revokeWorkspaceSeat({
            workspaceId: organization.id,
            userId: member.userId,
            revokedBy: null,
            reason: 'member_removed',
          })
        },
        beforeUpdateMemberRole: async ({ organization }) => {
          await requireCompanyWorkspace(organization.id)
        },
      },
    }),
    tanstackStartCookies(),
  ],
})
