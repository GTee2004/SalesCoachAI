import { z } from 'zod'

export const practiceHistoryInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(50).default(20),
  type: z.enum(['all', 'cold_call', 'warm_call']).default('all'),
  evaluation: z
    .enum(['all', 'graded', 'ungraded', 'under_50', '50_79', '80_100'])
    .default('all'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export type PracticeHistoryInput = z.infer<typeof practiceHistoryInputSchema>

export type PracticeHistoryItem = {
  id: string
  status: 'created' | 'in_progress' | 'completed' | 'abandoned'
  startedAt: string
  completedAt: string | null
  durationSeconds: number | null
  score: number | null
  practice: {
    title: string
    type: 'cold_call' | 'warm_call'
    difficulty: 'beginner' | 'intermediate' | 'advanced'
    projectName: string | null
  }
  customer: {
    name: string
    addressTerm: string
  }
}

export type PracticeHistoryResult = {
  items: PracticeHistoryItem[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}
