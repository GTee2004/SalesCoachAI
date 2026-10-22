import { createFileRoute } from '@tanstack/react-router'
import { listLearnerPractices } from '#/lib/server/practice-domain'
import { customPracticeSchema } from '#/lib/practice/authoring'
import { saveCustomPractice } from '#/lib/server/practice-authoring'
import { canManageWorkspacePractices } from '#/lib/auth/workspace-roles'
import {
  json,
  readJson,
  requireSameOrigin,
  requirePracticeUser,
} from '#/lib/server/http'
import { z } from 'zod'

const privateHeaders = { 'Cache-Control': 'private, no-store' }

export const Route = createFileRoute('/api/practices')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        requireSameOrigin(request)
        const user = await requirePracticeUser(request)
        if (
          !canManageWorkspacePractices(user.workspaceKind, user.workspaceRole)
        )
          return json(
            {
              error:
                'Chỉ chủ sở hữu hoặc quản lý của không gian làm việc Business mới có thể tạo bài luyện.',
            },
            { status: 403 },
          )
        const body = (await readJson(request)) as Record<string, unknown> | null
        const parsed = customPracticeSchema.safeParse(body?.practice)
        const draftId = z
          .string()
          .uuid()
          .optional()
          .safeParse(body?.draftId ?? undefined)
        if (
          !parsed.success ||
          !draftId.success ||
          !['draft', 'published'].includes(String(body?.status))
        )
          return json(
            {
              error: 'Vui lòng kiểm tra thông tin bài luyện.',
              issues: parsed.success ? [] : parsed.error.issues,
            },
            { status: 400 },
          )
        try {
          const practice = await saveCustomPractice(
            user.id,
            user.workspaceId,
            parsed.data,
            body!.status as 'draft' | 'published',
            draftId.data,
          )
          return json({ id: practice.id }, { status: 201 })
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.startsWith('Bản nháp') ||
              error.message.startsWith('Bộ kỹ năng'))
          )
            return json({ error: error.message }, { status: 409 })
          throw error
        }
      },
      GET: async ({ request }) => {
        const user = await requirePracticeUser(request)
        return Response.json(
          { items: await listLearnerPractices(user.id, user.workspaceId) },
          { headers: privateHeaders },
        )
      },
    },
  },
})
