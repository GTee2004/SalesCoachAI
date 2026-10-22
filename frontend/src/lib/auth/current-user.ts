import { createServerFn } from '@tanstack/react-start'

export const getCurrentUser = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [
      { getRequestHeaders },
      { auth },
      { getWorkspaceForUser, ensurePersonalWorkspace },
      { recordUserActivity },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('#/lib/auth/server'),
      import('#/lib/server/workspaces'),
      import('#/lib/server/user-activity'),
    ])

    const current = await auth.api.getSession({
      headers: getRequestHeaders(),
    })

    if (!current?.user) return null
    // Every page load passes through here; never make it wait for the write.
    void recordUserActivity(current.user.id)

    let workspace = await getWorkspaceForUser(
      current.user.id,
      current.session.activeOrganizationId,
    )

    if (!workspace) {
      const personalId = await ensurePersonalWorkspace(current.user.id)
      await auth.api.setActiveOrganization({
        headers: getRequestHeaders(),
        body: { organizationId: personalId },
      })
      workspace = await getWorkspaceForUser(current.user.id, personalId)
    }

    return {
      id: current.user.id,
      name: current.user.name,
      username: current.user.username ?? null,
      email: current.user.email,
      emailVerified: current.user.emailVerified,
      roles: current.user.roles,
      workspace: workspace
        ? {
            id: workspace.id,
            name: workspace.name,
            kind: workspace.kind,
            status: workspace.status,
            role: workspace.role,
          }
        : null,
    }
  },
)
