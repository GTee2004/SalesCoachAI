import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { getLearnerPractice } from '#/lib/server/practice-domain'
import { deleteCustomPractice } from '#/lib/server/practice-authoring'
import { canManageWorkspacePractices } from '#/lib/auth/workspace-roles'
import { json, requireSameOrigin, requirePracticeUser } from '#/lib/server/http'

const privateHeaders = { 'Cache-Control': 'private, no-store' }

export const Route = createFileRoute('/api/practices/$id')({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        requireSameOrigin(request)
        const user = await requirePracticeUser(request)
        // Checked on every request, so a demoted manager loses this at once.
        if (
          !canManageWorkspacePractices(user.workspaceKind, user.workspaceRole)
        )
          return json(
            {
              error:
                'Chỉ chủ sở hữu hoặc quản lý của không gian làm việc mới có thể xóa bài luyện.',
            },
            { status: 403 },
          )
        const id = z.uuid().safeParse(params.id)
        if (!id.success)
          return json({ error: 'Mã bài luyện không hợp lệ.' }, { status: 400 })
        const deleted = await deleteCustomPractice(id.data, user.workspaceId)
        return deleted
          ? json({ id: deleted.id })
          : json(
              {
                error:
                  'Bài luyện không tồn tại hoặc không thuộc không gian làm việc này.',
              },
              { status: 404 },
            )
      },
      GET: async ({ request, params }) => {
        const user = await requirePracticeUser(request)
        const id = z.uuid().safeParse(params.id)
        if (!id.success)
          return Response.json(
            { error: 'Invalid practice ID' },
            { status: 400, headers: privateHeaders },
          )
        const practice = await getLearnerPractice(
          id.data,
          user.id,
          user.workspaceId,
        )
        return practice
          ? Response.json(practice, { headers: privateHeaders })
          : Response.json(
              { error: 'Practice not found' },
              { status: 404, headers: privateHeaders },
            )
      },
    },
  },
})
