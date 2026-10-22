import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { currentUserQueryKey } from '#/lib/auth/authQueries'

// The account page reads the cached identity, so a saved change must refresh it.
export function useRefreshCurrentUser() {
  const queryClient = useQueryClient()
  const router = useRouter()
  return async () => {
    await queryClient.invalidateQueries({ queryKey: currentUserQueryKey })
    await router.invalidate()
  }
}
