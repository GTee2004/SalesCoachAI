import { createFileRoute } from '@tanstack/react-router'
import {
  companyWorkspaceInput,
  createCompanyWorkspace,
} from '#/lib/server/workspaces'
import {
  json,
  readJson,
  requireSameOrigin,
  requireUser,
} from '#/lib/server/http'

export const Route = createFileRoute('/api/workspaces')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        requireSameOrigin(request)

        const user = await requireUser(request)
        const body = await readJson(request)
        const parsed = companyWorkspaceInput.safeParse(body)

        if (!parsed.success) {
          return json(
            {
              error: 'Tên không gian làm việc phải có từ 2 đến 100 ký tự.',
            },
            { status: 400 },
          )
        }

        const workspaceId = await createCompanyWorkspace(user.id, parsed.data)

        return json(
          {
            workspaceId,
            status: 'pending_subscription',
          },
          { status: 201 },
        )
      },
    },
  },
})
