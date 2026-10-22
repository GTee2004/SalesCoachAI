import { db } from '#/db'
import { userActivityDays } from '#/db/schema'
import { toDateKey } from '#/lib/admin/usage'

// One write per user per day in this process; the primary key absorbs the rest.
const recorded = new Map<string, string>()

export async function recordUserActivity(userId: string, now = new Date()) {
  const activityDate = toDateKey(now)
  if (recorded.get(userId) === activityDate) return
  recorded.set(userId, activityDate)
  try {
    await db
      .insert(userActivityDays)
      .values({ userId, activityDate })
      .onConflictDoNothing()
  } catch (error) {
    recorded.delete(userId)
    console.error('User activity could not be recorded', { userId, error })
  }
}
