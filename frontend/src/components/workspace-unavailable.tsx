import { MobileHeader, SidebarContent } from '#/components/practice-navigation'
import type { NavigationSection } from '#/components/practice-navigation'
import { ButtonLink } from '#/components/ui/button-link'
import { Card } from '#/components/ui/card'

type LockedSection = Extract<
  NavigationSection,
  'practice' | 'history' | 'performance'
>

const sectionTitles: Record<LockedSection, string> = {
  practice: 'Luyện tập',
  history: 'Lịch sử',
  performance: 'Năng lực của tôi',
}

type WorkspaceUnavailableProps = {
  workspaceName?: string
  section: LockedSection
}

export function WorkspaceUnavailable({
  workspaceName,
  section,
}: WorkspaceUnavailableProps) {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <aside className="fixed inset-y-6 left-6 z-30 hidden w-56 flex-col border-r border-border bg-background pr-3 lg:flex">
        <SidebarContent activeSection={section} />
      </aside>

      <div className="lg:ml-[280px]">
        <MobileHeader activeSection={section} />

        <main className="mx-auto max-w-[720px] px-5 pb-11 pt-6 sm:px-6 lg:px-4 lg:pt-12">
          <h1 className="text-[30px] font-normal leading-[1.55] tracking-[-1px] lg:text-[38px]">
            {sectionTitles[section]}
          </h1>
          <Card className="gap-0 rounded-[20px] border-0 bg-practice-gradient mt-6 p-6 text-foreground shadow-none ring-0 sm:p-8">
            {workspaceName ? (
              <p className="mb-3 text-xs font-semibold leading-[1.55] tracking-[0.6px] text-brand">
                {workspaceName}
              </p>
            ) : null}

            <h2 className="text-[23px] font-normal leading-[1.55] tracking-[-0.6px]">
              {workspaceName
                ? 'Không gian làm việc chưa kích hoạt'
                : 'Chưa có không gian làm việc hợp lệ'}
            </h2>

            <p className="mt-3 text-sm leading-[1.55] text-muted-foreground">
              {workspaceName
                ? 'Không gian làm việc công ty đang chờ kích hoạt gói Business. Bạn chưa thể luyện tập trong không gian làm việc này.'
                : 'Không gian làm việc hiện tại không khả dụng hoặc bạn không còn quyền truy cập.'}
            </p>

            <p className="mt-4 text-sm leading-[1.55] text-muted-foreground">
              Mở menu tài khoản và chọn tài khoản cá nhân để tiếp tục luyện tập.
            </p>

            {workspaceName ? (
              <ButtonLink
                to="/billing"
                className="mt-6 h-11 w-fit rounded-lg bg-primary px-5 text-[13px] font-normal text-primary-foreground hover:bg-primary-hover-strong"
              >
                Xem thanh toán Business
              </ButtonLink>
            ) : null}
          </Card>
        </main>
      </div>
    </div>
  )
}
