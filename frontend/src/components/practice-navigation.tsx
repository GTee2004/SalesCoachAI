import { Link, useRouteContext } from '@tanstack/react-router'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  announceWorkspaceChange,
  hasActiveVoiceCall,
} from '#/lib/auth/workspace-sync'
import {
  Home,
  AudioLines,
  History,
  ChartNoAxesColumn,
  // BookOpen, // used by the hidden "Tài liệu" item
  ShieldCheck,
  Ticket,
  UserRound,
  Building2,
  ChevronUp,
  Check,
  Plus,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '#/components/ui/sheet'
import { authClient } from '#/lib/auth/client'
import { PERMISSIONS, can } from '#/lib/auth/permissions'
import type { Permission } from '#/lib/auth/permissions'
import { getUserDisplay } from '#/lib/auth/user-display'
import { AddWorkspaceModal } from '#/components/add-workspace-modal'

export type NavigationSection =
  | 'home'
  | 'practice'
  | 'history'
  | 'performance'
  | 'workspace'
  | 'account'
  | 'admin'
  | 'coupons'

type NavigationItem = {
  label: string
  icon: LucideIcon
  to?:
    | '/'
    | '/practice'
    | '/practice/history'
    | '/performance'
    | '/admin/dashboard'
    | '/admin/coupons'
  section?: NavigationSection
}

const navigation: NavigationItem[] = [
  { label: 'Trang chủ', icon: Home, to: '/', section: 'home' },
  {
    label: 'Luyện tập',
    icon: AudioLines,
    to: '/practice',
    section: 'practice',
  },
  {
    label: 'Lịch sử',
    icon: History,
    to: '/practice/history',
    section: 'history',
  },
  {
    label: 'Năng lực của tôi',
    icon: ChartNoAxesColumn,
    to: '/performance',
    section: 'performance',
  },
  // Temporarily hidden until the documents page exists.
  // { label: 'Tài liệu', icon: BookOpen },
]
// Each entry is shown only to users holding its permission. The pages and
// server functions check again; this only keeps the menu honest.
const adminNavigation: Array<NavigationItem & { permission: Permission }> = [
  {
    label: 'Quản trị',
    icon: ShieldCheck,
    to: '/admin/dashboard',
    section: 'admin',
    permission: PERMISSIONS.adminDashboardView,
  },
  {
    label: 'Mã giảm giá',
    icon: Ticket,
    to: '/admin/coupons',
    section: 'coupons',
    permission: PERMISSIONS.couponsView,
  },
]

function useNavigation() {
  const { user } = useRouteContext({ from: '__root__' })
  return [
    ...navigation,
    ...adminNavigation.filter((item) => can(user, item.permission)),
  ]
}

export function SidebarContent({
  activeSection = 'practice',
}: {
  activeSection?: NavigationSection
}) {
  const items = useNavigation()
  return (
    <>
      <Link to="/" className="flex h-[62px] items-start">
        <img
          src="/images/LOGO_salescoachAI.png"
          alt="SalesCoach AI"
          className="h-[62px] w-[184px] object-contain"
        />
      </Link>
      <nav
        aria-label="Điều hướng chính"
        className="mt-14 flex flex-col gap-2 font-sans"
      >
        {items.map(({ label, icon: Icon, to, section }) => {
          const active = section === activeSection
          return (
            <Button
              key={label}
              type="button"
              variant="ghost"
              nativeButton={!to}
              render={to ? <Link to={to} /> : undefined}
              className={`h-12 w-full justify-start gap-3 rounded-lg px-[14px] text-[13px] ${active ? 'bg-secondary font-semibold text-foreground hover:bg-secondary hover:text-foreground' : 'font-normal text-muted-foreground hover:bg-secondary/40 hover:text-foreground'}`}
            >
              <Icon
                size={20}
                strokeWidth={1.8}
                className={active ? 'text-brand' : undefined}
              />{' '}
              {label}
            </Button>
          )
        })}
      </nav>
      <div className="flex-1" />
      <UserMenu />
    </>
  )
}

function useSignOut() {
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  async function signOut() {
    setError('')
    setSigningOut(true)
    try {
      const result = await authClient.signOut()
      if (result.error) throw result.error
      await queryClient.cancelQueries()
      queryClient.clear()
      announceWorkspaceChange()
      window.location.assign('/login')
    } catch {
      setError('Chưa thể đăng xuất. Vui lòng thử lại.')
    } finally {
      setSigningOut(false)
    }
  }
  return { error, signingOut, signOut }
}

function ActiveWorkspaceLabel() {
  const { user } = useRouteContext({ from: '__root__' })
  const queryClient = useQueryClient()
  const active = authClient.useActiveOrganization()
  const list = authClient.useListOrganizations()
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState('')

  async function switchWorkspace(organizationId: string) {
    if (switching || organizationId === active.data?.id) return
    if (user && hasActiveVoiceCall(user.id)) {
      setSwitchError(
        'Hãy kết thúc cuộc gọi đang mở trước khi chuyển không gian làm việc.',
      )
      return
    }

    setSwitching(true)
    setSwitchError('')

    try {
      const result = await authClient.organization.setActive({
        organizationId,
      })

      if (result.error) {
        throw new Error(result.error.message)
      }

      await queryClient.cancelQueries()
      queryClient.clear()
      announceWorkspaceChange()
      window.location.reload()
    } catch {
      setSwitchError('Chưa thể chuyển không gian làm việc. Vui lòng thử lại.')
      setSwitching(false)
    }
  }

  return (
    <>
      <div className="px-2 py-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Không gian làm việc
        </p>
        {active.isPending || active.error || !active.data ? (
          <p className="mt-1 truncate text-xs font-normal text-muted-foreground">
            {active.isPending
              ? 'Đang tải…'
              : active.error
                ? 'Không tải được không gian làm việc'
                : 'Chưa chọn không gian làm việc'}
          </p>
        ) : null}
      </div>

      {list.isPending ? (
        <p className="px-2 py-2 text-xs">Đang tải danh sách…</p>
      ) : list.error ? (
        <p role="alert" className="px-2 py-2 text-xs text-red-600">
          Không tải được danh sách không gian làm việc.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {list.data?.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              disabled={switching}
              closeOnClick={false}
              onClick={() => void switchWorkspace(workspace.id)}
              className={`h-[52px] gap-3 rounded-lg px-2 text-[13px] text-foreground focus:bg-secondary ${workspace.id === active.data?.id ? 'bg-secondary' : ''}`}
            >
              <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
              {workspace.id === active.data?.id ? (
                <Check size={18} className="shrink-0 text-brand" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </div>
      )}

      {switchError ? (
        <p role="alert" className="px-2 py-2 text-xs text-red-600">
          {switchError}
        </p>
      ) : null}
    </>
  )
}

const accountPanelClassName =
  'w-[300px] max-w-[calc(100vw-24px)] rounded-xl border border-border bg-background p-2 font-sans text-foreground shadow-[0_6px_18px_var(--shadow-ink)] ring-0 [&_[data-slot=dropdown-menu-separator]]:bg-border'

function AccountMenuItems({
  initials,
  name,
  detail,
  signingOut,
  onAddWorkspace,
  onSignOut,
}: {
  initials: string
  name: string
  detail: string
  signingOut: boolean
  onAddWorkspace: () => void
  onSignOut: () => void
}) {
  const { user } = useRouteContext({ from: '__root__' })
  return (
    <>
      <div className="flex items-center gap-3 p-2">
        <Avatar className="size-10 shrink-0 after:border-0">
          <AvatarFallback className="bg-secondary text-[13px] font-semibold text-brand">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {detail}
          </p>
        </div>
      </div>
      <DropdownMenuSeparator />
      <ActiveWorkspaceLabel />
      <DropdownMenuItem
        onClick={onAddWorkspace}
        className="mt-1 h-11 gap-3 rounded-lg px-2 text-[13px] focus:bg-secondary"
      >
        <Plus className="text-brand" size={18} />
        Thêm không gian làm việc mới
      </DropdownMenuItem>
      {/* Cá nhân không có gì để quản lý, nên chỉ không gian công ty có mục này. */}
      {user?.workspace?.kind === 'company' ? (
        <DropdownMenuItem
          nativeButton={false}
          render={<Link to="/workspace" />}
          className="h-11 gap-3 rounded-lg px-2 text-[13px] focus:bg-secondary"
        >
          <Building2 className="shrink-0 text-brand" size={18} />
          <span className="min-w-0 flex-1 truncate whitespace-nowrap">
            Quản lý không gian làm việc
          </span>
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        nativeButton={false}
        render={<Link to="/account" search={{ tab: 'profile' }} />}
        className="h-11 gap-3 rounded-lg px-2 text-[13px] text-foreground focus:bg-secondary focus:text-foreground"
      >
        <UserRound className="shrink-0 text-brand" size={18} />
        Tài khoản
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={signingOut}
        onClick={onSignOut}
        className="h-11 gap-3 rounded-lg px-2 text-[13px] text-destructive focus:bg-destructive/10 focus:text-destructive"
      >
        <LogOut size={18} className="text-destructive" />
        {signingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
      </DropdownMenuItem>
    </>
  )
}

function UserMenu({ mobile = false }: { mobile?: boolean }) {
  const { user } = useRouteContext({ from: '__root__' })
  const { initials, name, detail } = getUserDisplay(user)
  const { error, signingOut, signOut } = useSignOut()
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false)
  return (
    <div
      className={`border-t border-border px-2 pt-4 font-sans text-foreground ${mobile ? 'pb-2' : ''}`}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              className={`h-auto w-full justify-start px-0 py-0 text-left hover:bg-transparent ${mobile ? 'gap-3' : 'gap-2.5'}`}
            />
          }
        >
          <Avatar className="size-10 shrink-0 after:border-0">
            <AvatarFallback className="bg-secondary text-[13px] font-semibold text-brand">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">
              {name}
            </span>
            <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
              {detail}
            </span>
          </span>
          <ChevronUp size={16} className="shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          className={accountPanelClassName}
        >
          <AccountMenuItems
            initials={initials}
            name={name}
            detail={detail}
            signingOut={signingOut}
            onAddWorkspace={() => setWorkspaceModalOpen(true)}
            onSignOut={() => void signOut()}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {workspaceModalOpen ? (
        <AddWorkspaceModal
          open={workspaceModalOpen}
          onOpenChange={setWorkspaceModalOpen}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function MobileAccountMenu() {
  const { user } = useRouteContext({ from: '__root__' })
  const { initials, name, detail } = getUserDisplay(user)
  const { error, signingOut, signOut } = useSignOut()
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false)
  return (
    <div className="relative shrink-0 font-sans">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Mở tài khoản"
              className="size-11 rounded-full p-0 hover:bg-transparent"
            />
          }
        >
          <Avatar className="size-10 after:border-0">
            <AvatarFallback className="bg-secondary text-[13px] font-semibold text-brand">
              {initials}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="end"
          className={accountPanelClassName}
        >
          <AccountMenuItems
            initials={initials}
            name={name}
            detail={detail}
            signingOut={signingOut}
            onAddWorkspace={() => setWorkspaceModalOpen(true)}
            onSignOut={() => void signOut()}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {workspaceModalOpen ? (
        <AddWorkspaceModal
          open={workspaceModalOpen}
          onOpenChange={setWorkspaceModalOpen}
        />
      ) : null}
      {error ? (
        <p
          role="alert"
          className="absolute right-0 top-12 z-50 w-48 rounded-lg border border-border bg-background p-2 text-xs text-destructive shadow-sm"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function MobileHeader({
  activeSection = 'practice',
}: {
  activeSection?: NavigationSection
}) {
  const items = useNavigation()
  return (
    <div className="flex h-16 items-center gap-2 border-b border-border bg-background px-4 font-sans text-foreground lg:hidden">
      <Sheet>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Mở menu"
              className="size-11 text-brand"
            />
          }
        >
          <Menu size={22} />
        </SheetTrigger>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="!w-full !max-w-none gap-0 border-0 bg-background p-0 font-sans text-foreground lg:hidden"
        >
          <SheetTitle className="sr-only">Điều hướng chính</SheetTitle>
          <SheetDescription className="sr-only">
            Chọn một mục trong menu SalesCoach AI.
          </SheetDescription>
          <div className="flex h-full flex-col">
            <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4">
              <SheetClose
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Đóng menu"
                    className="size-11 text-brand"
                  />
                }
              >
                <X size={22} />
              </SheetClose>
              <SheetClose render={<Link to="/" />} nativeButton={false}>
                <img
                  src="/images/LOGO_salescoachAI.png"
                  alt="SalesCoach AI"
                  className="h-[58px] w-[172px] object-contain"
                />
              </SheetClose>
            </div>
            <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-7">
              <p className="text-xs font-medium text-muted-foreground">
                Không gian của bạn
              </p>
              <nav
                aria-label="Điều hướng chính"
                className="mt-[18px] flex flex-col gap-2"
              >
                {items.map(({ label, icon: Icon, to, section }) => {
                  const active = section === activeSection
                  const button = (
                    <Button
                      key={label}
                      type="button"
                      variant="ghost"
                      nativeButton={!to}
                      render={to ? <Link to={to} /> : undefined}
                      className={`h-12 w-full justify-start gap-3 rounded-lg px-[14px] text-[13px] ${active ? 'bg-secondary font-semibold text-foreground hover:bg-secondary hover:text-foreground' : 'font-normal text-muted-foreground hover:bg-secondary/40 hover:text-foreground'}`}
                    >
                      <Icon
                        size={20}
                        strokeWidth={1.8}
                        className={active ? 'text-brand' : undefined}
                      />{' '}
                      {label}
                    </Button>
                  )
                  return to ? (
                    <SheetClose
                      key={label}
                      render={button}
                      nativeButton={false}
                    />
                  ) : (
                    button
                  )
                })}
              </nav>
              <div className="mt-auto">
                <UserMenu mobile />
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <Link to="/" className="shrink-0">
        <img
          src="/images/LOGO_salescoachAI.png"
          alt="SalesCoach AI"
          className="h-[58px] w-[172px] object-contain"
        />
      </Link>
      <div className="min-w-0 flex-1" />
      <MobileAccountMenu />
    </div>
  )
}
