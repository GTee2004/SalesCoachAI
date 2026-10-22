import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { MobileHeader, SidebarContent } from '#/components/practice-navigation'
import {
  canManageWorkspaceMembers,
  canViewWorkspacePerformance,
  getWorkspaceRole,
  workspaceRoleLabels,
} from '#/lib/auth/workspace-roles'
import {
  DEFAULT_TEAM_PERIOD,
  DEFAULT_TEAM_VIEW,
} from '#/lib/workspace/performance'

export const Route = createFileRoute('/workspace')({
  beforeLoad: ({ context, location }) => {
    if (!context.user)
      throw redirect({ to: '/login', search: { callbackUrl: location.href } })
    if (!context.user.emailVerified)
      throw redirect({
        to: '/verify-email',
        search: { email: context.user.email },
      })
    // Personal workspaces have no structure to manage.
    if (context.user.workspace?.kind !== 'company')
      throw redirect({ to: '/practice' })
  },
  head: () => ({ meta: [{ title: 'Không gian làm việc | SalesCoach AI' }] }),
  component: WorkspaceLayout,
})

const tabClassName =
  'inline-flex h-11 items-center rounded-[7px] px-5 text-sm font-normal text-muted-foreground'
const activeTabProps = {
  className: 'bg-background text-brand',
  'aria-current': 'page' as const,
}

function WorkspaceLayout() {
  const { user } = Route.useRouteContext()
  const workspace = user?.workspace
  if (!workspace) return null
  const role = getWorkspaceRole(workspace.role)

  return (
    <div className="min-h-screen bg-background font-sans font-normal text-foreground">
      <aside className="fixed inset-y-6 left-6 z-30 hidden w-56 flex-col border-r border-border bg-background pr-3 lg:flex">
        <SidebarContent activeSection="workspace" />
      </aside>
      <div className="lg:ml-[248px]">
        <MobileHeader activeSection="workspace" />
        <main className="mx-auto max-w-[1184px] px-5 py-8 sm:px-8 lg:mx-0 lg:px-20 lg:pb-12 lg:pt-[52px]">
          <header className="mb-8 lg:mb-10">
            <p className="text-xs font-normal uppercase tracking-wider text-brand">
              Quản lý không gian làm việc
            </p>
            <h1 className="mt-2 break-words text-[29px] font-normal leading-[1.55] lg:text-4xl lg:leading-[1.55]">
              {workspace.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Vai trò của bạn: {workspaceRoleLabels[role]}
            </p>
          </header>

          <nav
            aria-label="Quản lý không gian làm việc"
            className="mb-[30px] inline-flex rounded-md bg-border p-1"
          >
            <Link
              to="/workspace"
              activeOptions={{ exact: true }}
              activeProps={activeTabProps}
              className={tabClassName}
            >
              Chung
            </Link>
            {canManageWorkspaceMembers(workspace.role) && (
              <Link
                to="/workspace/members"
                activeProps={activeTabProps}
                className={tabClassName}
              >
                Thành viên
              </Link>
            )}
            {canViewWorkspacePerformance(workspace.role) && (
              <Link
                to="/workspace/performance"
                search={{
                  period: DEFAULT_TEAM_PERIOD,
                  view: DEFAULT_TEAM_VIEW,
                }}
                activeProps={activeTabProps}
                className={tabClassName}
              >
                Hiệu suất
              </Link>
            )}
          </nav>

          <Outlet />
        </main>
      </div>
    </div>
  )
}
