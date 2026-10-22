import { createFileRoute, Link } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowUpRight,
  AudioLines,
  Check,
  History,
  LogOut,
  Menu,
  MessagesSquare,
  PhoneForwarded,
  PhoneOutgoing,
  Plus,
  ShieldCheck,
  TrendingUp,
  X,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ButtonLink } from '@/components/ui/button-link'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { authClient } from '@/lib/auth/client'
import { env } from '@/env'

// Open Graph needs absolute URLs; crawlers only see the server render.
const getSiteOrigin = createIsomorphicFn()
  .server(() => env.BETTER_AUTH_URL.replace(/\/$/, ''))
  .client(() => window.location.origin)

const seo = {
  title: 'SalesCoach AI — Luyện gọi điện bán hàng với khách hàng AI',
  description:
    'Thực hành cuộc gọi với khách hàng AI, thử cách xử lý tình huống và nhận phản hồi cụ thể trước khi gọi khách thật.',
  image: '/images/og-home.jpg',
  imageAlt:
    'SalesCoach AI — Luyện với AI. Tự tin khi gọi khách thật. Minh họa cuộc gọi với khách hàng AI và phản hồi sau cuộc gọi.',
}

export const Route = createFileRoute('/')({
  head: () => {
    const origin = getSiteOrigin()
    const image = `${origin}${seo.image}`
    return {
      meta: [
        { title: seo.title },
        { name: 'description', content: seo.description },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'SalesCoach AI' },
        { property: 'og:locale', content: 'vi_VN' },
        { property: 'og:url', content: `${origin}/` },
        { property: 'og:title', content: seo.title },
        { property: 'og:description', content: seo.description },
        { property: 'og:image', content: image },
        { property: 'og:image:type', content: 'image/jpeg' },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:image:alt', content: seo.imageAlt },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: seo.title },
        { name: 'twitter:description', content: seo.description },
        { name: 'twitter:image', content: image },
        { name: 'twitter:image:alt', content: seo.imageAlt },
      ],
      links: [{ rel: 'canonical', href: `${origin}/` }],
    }
  },
  component: HomePage,
})

interface HomeAccount {
  name: string
  email: string
}

const navigation = [
  ['product', 'Sản phẩm'],
  ['how-it-works', 'Cách hoạt động'],
  ['teams', 'Dành cho đội ngũ'],
  ['pricing', 'Bảng giá'],
] as const

const benefits = [
  {
    icon: ShieldCheck,
    title: 'Thử sai, không mất cơ hội',
    description: 'Luyện tình huống khó trước khi gọi khách thật.',
  },
  {
    icon: MessagesSquare,
    title: 'Hội thoại, không phải kịch bản',
    description: 'Khách hàng AI phản hồi theo cách bạn trao đổi.',
  },
  {
    icon: TrendingUp,
    title: 'Biết rõ cần cải thiện gì',
    description: 'Nhận phản hồi theo từng kỹ năng sau cuộc gọi.',
  },
]

const practiceSteps = [
  {
    number: '01',
    title: 'Chọn bài, hiểu bối cảnh',
    description:
      'Xem khách hàng, sản phẩm, mục tiêu cuộc gọi và tiêu chí đánh giá trước khi bắt đầu.',
    example: 'Cold call · Anh Minh · Khoảng 5 phút',
  },
  {
    number: '02',
    title: 'Gọi cho khách hàng AI',
    description:
      'Bạn mở đầu cuộc gọi. Khách hàng AI lắng nghe và phản hồi theo cách bạn trao đổi.',
    example: 'Khách hàng AI: “Có căn giá tốt hơn không em?”',
  },
  {
    number: '03',
    title: 'Nhận phản hồi, luyện tiếp',
    description:
      'Biết điều đã làm tốt, kỹ năng cần cải thiện và cách tiếp cận cho lần thực hành tiếp theo.',
    example: 'Điểm kỹ năng · Mục tiêu · Gợi ý cải thiện',
  },
]

const scenarios = [
  {
    type: 'cold',
    icon: PhoneOutgoing,
    title: 'Một khởi đầu có chủ đích.',
    description:
      'Giới thiệu lý do gọi, khám phá nhu cầu và hẹn bước tiếp theo với khách hàng mới.',
    customer: 'Anh Minh',
    portrait: '/images/CcmeZ.png',
    context: 'Chưa từng trao đổi',
    quote: '“Em lấy số của anh ở đâu đó?”',
    exercise: 'Anh Minh · Để lại số trên landing page.',
    details:
      'The Paris - Vinhomes Ocean Park · Căn hộ 2 phòng ngủ.\nMục tiêu: Hẹn xem nhà mẫu.',
  },
  {
    type: 'warm',
    icon: PhoneForwarded,
    title: 'Tiếp nối, không bắt đầu lại.',
    description:
      'Dựa vào cuộc trao đổi trước để làm rõ băn khoăn và cùng khách thống nhất bước tiếp theo.',
    customer: 'Chị Lan',
    portrait: '/images/IOSaV.png',
    context: 'Tiếp nối cuộc trao đổi',
    quote: '“Chị muốn hỏi thêm về giá.”',
    exercise: 'Chị Lan · Đã từng trao đổi.',
    details: 'Mục tiêu: Làm rõ băn khoăn và\nthống nhất bước tiếp theo.',
  },
] as const

const audienceOutcomes = [
  {
    audience: 'Cho nhân viên kinh doanh',
    title: 'Một nơi để chuẩn bị, thử lại và tiến bộ.',
    points: [
      'Luyện tình huống khó trước khi gọi khách thật',
      'Nhận phản hồi theo từng kỹ năng',
      'Thử lại với một cách tiếp cận mới',
    ],
  },
  {
    audience: 'Cho đội ngũ kinh doanh',
    title: 'Một cơ sở cụ thể cho buổi coaching.',
    points: [
      'Cùng thảo luận từ tình huống đã thực hành',
      'Thống nhất cách trao đổi về kỹ năng gọi điện',
      'Dùng phản hồi làm cơ sở cho buổi coaching',
    ],
  },
]

const pricingFeatures = [
  'Thời gian luyện giọng nói',
  'Thư viện bài luyện',
  'Phản hồi sau buổi luyện',
  'Theo dõi tiến bộ',
  'Bài luyện tùy chỉnh',
  'Quản trị đội ngũ / công ty',
  'Hỗ trợ',
] as const

type PricingPlan = {
  name: string
  audience: string
  monthlyPrice: number
  yearlyPrice: number
  unit: string
  action: string
  features: [string, string, string, string, string, string, string]
}

const pricingPlans: PricingPlan[] = [
  {
    name: 'Free',
    audience: 'Khởi đầu và trải nghiệm',
    monthlyPrice: 0,
    yearlyPrice: 0,
    unit: '',
    action: 'Bắt đầu miễn phí',
    features: [
      '15 phút / tháng',
      'Tình huống nhập môn',
      'Bảng điểm AI, điểm mạnh, điểm cần cải thiện và nhận xét từ bản ghi',
      'Kết quả từng buổi luyện',
      'Chưa bao gồm',
      'Chưa bao gồm',
      'Trung tâm trợ giúp tự phục vụ',
    ],
  },
  {
    name: 'Pro',
    audience: 'Dành cho người bán hàng muốn tiến xa',
    monthlyPrice: 299000,
    yearlyPrice: 2990000,
    unit: 'người',
    action: 'Chọn gói Pro',
    features: [
      '150 phút / tháng',
      'Toàn bộ tình huống, mọi cấp độ',
      'Đầy đủ như Free',
      'Xu hướng kỹ năng và gợi ý bài luyện tiếp theo',
      'Chưa bao gồm',
      'Chưa bao gồm',
      'Email tiêu chuẩn',
    ],
  },
  {
    name: 'Business',
    audience: 'Huấn luyện nhất quán cho cả công ty',
    monthlyPrice: 499000,
    yearlyPrice: 4990000,
    unit: 'người',
    action: 'Chọn gói Business',
    features: [
      '300 phút / người / tháng',
      'Toàn bộ + tình huống riêng của công ty',
      'Đầy đủ như Pro',
      'Tiến bộ cá nhân, bảng điều khiển quản lý và báo cáo công ty',
      'Tạo không giới hạn các bài luyện tuỳ chỉnh trong thư viện dùng chung',
      'Mời và quản lý thành viên, giao bài luyện',
      'Email ưu tiên và hướng dẫn triển khai',
    ],
  },
]

const subscriptionTerms = [
  'Hạn mức luyện tập được làm mới mỗi tháng với cả gói tháng và gói năm; phần chưa dùng không được cộng dồn.',
  'Mỗi không gian làm việc Business yêu cầu tối thiểu 2 người dùng trả phí.',
  'Hạn mức cá nhân và công ty tách biệt. Thành viên Business không cần mua thêm Pro.',
]

const pricingNumberFormat = new Intl.NumberFormat('vi-VN')
const primaryActionClass =
  'h-[54px] gap-3 rounded-[10px] bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary-hover'
const sectionClass = 'px-5 py-11 lg:px-16 lg:pt-16 lg:pb-[72px]'
const headingClass =
  'text-[30px] leading-[1.3] font-normal tracking-[-0.7px] lg:text-[42px] lg:tracking-[-1.2px]'

function formatPrice(amount: number) {
  return `${pricingNumberFormat.format(amount)} ₫`
}

function HomeAccountMenu({ user }: { user: HomeAccount }) {
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const nameParts = user.name.trim().split(/\s+/)
  const firstInitial = nameParts[0]?.charAt(0) ?? ''
  const lastInitial =
    nameParts.length > 1 ? (nameParts.at(-1)?.charAt(0) ?? '') : ''
  const initials =
    (firstInitial + lastInitial).toLocaleUpperCase('vi') ||
    user.email.charAt(0).toLocaleUpperCase('vi') ||
    '?'

  async function handleSignOut() {
    setError('')
    setSigningOut(true)
    try {
      const result = await authClient.signOut()
      if (result.error) throw result.error
      window.location.assign('/login')
    } catch {
      setError('Chưa thể đăng xuất. Vui lòng thử lại.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="relative shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={signingOut ? 'Đang đăng xuất' : 'Mở menu tài khoản'}
              className="size-11 rounded-full bg-secondary p-0 hover:bg-secondary-hover-soft"
            />
          }
        >
          <Avatar className="size-11 after:border-0">
            <AvatarFallback className="bg-secondary text-xs font-semibold text-brand">
              {initials}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-[260px] max-w-[calc(100vw-24px)] rounded-xl border border-border bg-background p-2 font-sans text-foreground shadow-[0_6px_18px_var(--shadow-ink)] ring-0"
        >
          <div className="flex h-[64px] items-start gap-3 px-2 pt-[9px]">
            <Avatar className="size-10 shrink-0 after:border-0">
              <AvatarFallback className="bg-secondary text-xs font-semibold text-brand">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm leading-[21px] font-semibold">
                {user.name}
              </p>
              <p className="mt-[3px] truncate text-xs leading-[18px] text-muted-foreground">
                {user.email}
              </p>
            </div>
          </div>
          <DropdownMenuSeparator className="mx-0 my-[3px] h-px bg-border" />
          <DropdownMenuItem
            nativeButton={false}
            render={<Link to="/account" search={{ tab: 'profile' }} />}
            className="h-11 rounded-md px-3 text-sm font-normal text-foreground focus:bg-muted focus:text-foreground"
          >
            Hồ sơ cá nhân
          </DropdownMenuItem>
          <DropdownMenuItem
            nativeButton={false}
            render={<Link to="/account" search={{ tab: 'plan' }} />}
            className="h-11 rounded-md px-3 text-sm font-normal text-foreground focus:bg-muted focus:text-foreground"
          >
            Gói &amp; hạn mức
          </DropdownMenuItem>
          <DropdownMenuSeparator className="mx-0 my-0.5 h-px bg-border" />
          <DropdownMenuItem
            variant="destructive"
            disabled={signingOut}
            onClick={() => void handleSignOut()}
            className="h-[50px] gap-3 rounded-md px-3 text-sm font-normal data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive-subtle data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:text-destructive"
          >
            <LogOut className="size-[18px] text-destructive" />
            {signingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p
          role="alert"
          className="absolute top-full right-0 z-50 mt-2 w-[260px] max-w-[calc(100vw-24px)] rounded-lg border border-destructive-border bg-background px-3 py-2 font-sans text-xs text-destructive shadow-md"
        >
          {error}
        </p>
      )}
    </div>
  )
}

function HomePage() {
  const { user } = Route.useRouteContext()
  const practiceAction = user ? 'Vào luyện tập' : 'Bắt đầu luyện tập'

  return (
    <main className="min-h-screen bg-background font-sans text-foreground">
      <div className="mx-auto max-w-[1600px] p-3 lg:p-6">
        <section
          id="top"
          className="overflow-hidden rounded-[20px] bg-brand-gradient p-5 lg:min-h-[700px] lg:rounded-[28px] lg:px-12 lg:pt-7 lg:pb-[39px]"
        >
          <header>
            <nav
              aria-label="Điều hướng chính"
              className="flex items-center justify-between gap-3"
            >
              <HomeLogo />
              <div className="hidden shrink-0 items-center gap-8 text-sm whitespace-nowrap xl:flex">
                {navigation.map(([id, label]) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    className="text-foreground transition hover:text-brand"
                  >
                    {label}
                  </a>
                ))}
              </div>
              <div className="flex shrink-0 items-center gap-3 xl:gap-6">
                {!user && (
                  <Link
                    to="/login"
                    className="shrink-0 text-xs text-foreground hover:text-brand lg:text-sm"
                  >
                    Đăng nhập
                  </Link>
                )}
                <ButtonLink
                  to="/practice"
                  className={`hidden xl:inline-flex ${primaryActionClass}`}
                >
                  {practiceAction} <ArrowUpRight className="size-[18px]" />
                </ButtonLink>
                {user && <HomeAccountMenu user={user} />}
                <Sheet>
                  <SheetTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Mở menu"
                        className="h-11 w-10 shrink-0 rounded-lg bg-background text-foreground hover:bg-secondary xl:hidden"
                      />
                    }
                  >
                    <Menu className="size-5" />
                  </SheetTrigger>
                  <SheetContent
                    side="right"
                    showCloseButton={false}
                    className="gap-0 overflow-y-auto border-0 bg-background p-3 font-sans text-foreground shadow-none data-[side=right]:h-dvh data-[side=right]:w-full data-[side=right]:sm:max-w-none"
                  >
                    <SheetTitle className="sr-only">
                      Điều hướng SalesCoach AI
                    </SheetTitle>
                    <SheetDescription className="sr-only">
                      Chọn một mục để tìm hiểu về SalesCoach AI.
                    </SheetDescription>
                    <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col">
                      <div className="flex h-[88px] shrink-0 items-center justify-between rounded-[20px] bg-brand-gradient px-5">
                        <SheetClose
                          render={
                            <a
                              href="#top"
                              aria-label="SalesCoach AI — Trang chủ"
                            />
                          }
                          className="shrink-0"
                        >
                          <img
                            src="/images/LOGO_salescoachAI.png"
                            alt="SalesCoach AI"
                            width={148}
                            height={50}
                            className="h-[50px] w-[148px] object-contain"
                          />
                        </SheetClose>
                        <SheetClose
                          render={
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Đóng menu"
                              className="size-11 rounded-lg bg-background text-foreground hover:bg-secondary"
                            />
                          }
                        >
                          <X className="size-5" />
                        </SheetClose>
                      </div>
                      <nav
                        aria-label="Điều hướng di động"
                        className="px-5 pt-11"
                      >
                        <p className="text-xs leading-[18px] text-brand">
                          KHÁM PHÁ SALESCOACH AI
                        </p>
                        <div className="mt-8 flex flex-col gap-3">
                          {navigation.map(([id, label]) => (
                            <SheetClose
                              key={id}
                              render={<a href={`#${id}`} />}
                              className="flex min-h-16 items-center justify-between gap-4 border-b border-border text-[21px] leading-[1.5] text-foreground transition hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                            >
                              {label}
                              <ArrowUpRight className="size-5 shrink-0 text-muted-foreground" />
                            </SheetClose>
                          ))}
                        </div>
                      </nav>
                      <div className="mt-auto px-5 pt-12 pb-[max(84px,env(safe-area-inset-bottom))]">
                        {!user && (
                          <SheetClose
                            render={<Link to="/login" />}
                            className="mb-3 flex h-12 items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted"
                          >
                            Đăng nhập
                          </SheetClose>
                        )}
                        <SheetClose
                          render={<Link to="/practice" />}
                          className="relative flex h-[52px] items-center justify-center rounded-[9px] bg-primary px-12 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
                        >
                          {practiceAction}
                          <ArrowUpRight className="absolute right-[30px] size-[18px]" />
                        </SheetClose>
                        <p className="mt-4 text-xs leading-[18px] text-muted-foreground">
                          Không áp lực. Luyện lại nhiều lần.
                        </p>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </nav>
          </header>
          <div className="mt-7 grid items-start gap-7 lg:mt-[55px] lg:grid-cols-[minmax(0,620fr)_minmax(0,628fr)] lg:gap-12">
            <div className="flex min-w-0 flex-col gap-[18px] lg:pt-[18px] lg:gap-[22px]">
              <p className="rounded-full border border-white/80 bg-background-translucent px-3 py-2 text-[11px] leading-[1.5] font-semibold tracking-[0.7px] text-brand lg:w-fit lg:px-4 lg:text-xs">
                AI COACH CHO KINH DOANH BẤT ĐỘNG SẢN
              </p>
              <h1 className="text-[34px] leading-[1.25] font-normal tracking-[-1px] lg:text-[56px] lg:leading-[1.2] lg:tracking-[-1.8px]">
                Luyện với AI.
                <br />
                Tự tin khi gọi khách thật.
              </h1>
              <p className="text-[15px] leading-[1.65] lg:text-[17px] lg:leading-[1.7]">
                Thực hành cuộc gọi với khách hàng AI, thử cách xử lý tình huống
                và nhận phản hồi cụ thể. Để cuộc gọi tiếp theo không còn là một
                lần thử sai.
              </p>
              <div className="flex flex-col gap-2.5 py-2 sm:flex-row sm:gap-3.5">
                <ButtonLink to="/practice" className={primaryActionClass}>
                  {practiceAction} <ArrowUpRight className="size-[18px]" />
                </ButtonLink>
                <ButtonLink
                  to="/"
                  hash="how-it-works"
                  variant="outline"
                  className="h-[54px] gap-3 rounded-[10px] border-border bg-background/60 px-6 text-sm font-medium text-foreground shadow-none hover:bg-background"
                >
                  Xem cách hoạt động <ArrowUpRight className="size-[18px]" />
                </ButtonLink>
              </div>
              <p className="text-xs leading-[1.5] lg:text-sm">
                Không áp lực. Luyện lại nhiều lần. Tiến bộ từng cuộc gọi.
              </p>
            </div>
            <div className="relative overflow-hidden rounded-3xl lg:mt-[-4px]">
              <img
                src="/images/homepage-call-dashboard.jpg"
                alt="Minh họa luyện gọi với khách hàng AI và phản hồi sau cuộc gọi trên SalesCoach AI"
                width={1536}
                height={1024}
                fetchPriority="high"
                className="aspect-[3/2] w-full object-cover"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-brand-gradient opacity-40 mix-blend-multiply"
              />
            </div>
          </div>
        </section>

        <section
          aria-label="Lợi ích của SalesCoach AI"
          className="grid gap-7 px-5 py-9 md:grid-cols-3 lg:gap-11 lg:px-16 lg:pt-11 lg:pb-[54px]"
        >
          {benefits.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex flex-col gap-2.5">
              <Icon className="size-6 text-brand" strokeWidth={1.8} />
              <h2 className="text-[19px] leading-[1.5] font-medium">{title}</h2>
              <p className="text-sm leading-[1.5] text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </section>

        <section
          id="how-it-works"
          className={`border-t border-border ${sectionClass}`}
        >
          <SectionIntro
            label="CÁCH HOẠT ĐỘNG"
            title="Một cuộc gọi thử. Một bước tiến thật."
            description="Từ chuẩn bị đến phản hồi, mọi bước đều hướng đến cuộc gọi tiếp theo của bạn."
          />
          <div className="mt-7 grid gap-7 lg:mt-10 lg:grid-cols-3 lg:gap-10">
            {practiceSteps.map((step) => (
              <article key={step.number} className="flex flex-col gap-4">
                <p className="font-numeric text-[30px] leading-[1.2] text-brand lg:text-[40px]">
                  {step.number}
                </p>
                <h3 className="text-[22px] leading-[1.5] font-medium">
                  {step.title}
                </h3>
                <p className="text-[15px] leading-[1.7] text-muted-foreground">
                  {step.description}
                </p>
                <p className="border-t border-border py-[18px] text-xs leading-[1.6] text-brand">
                  {step.example}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section
          id="product"
          className="rounded-[18px] bg-muted px-5 py-10 lg:rounded-3xl lg:px-16 lg:pt-[60px] lg:pb-[72px]"
        >
          <SectionLabel>TÌNH HUỐNG THỰC TẾ</SectionLabel>
          <h2 className={`mt-6 lg:mt-[30px] ${headingClass}`}>
            Luyện đúng cuộc gọi
            <br />
            bạn sắp thực hiện.
          </h2>
          <div className="mt-6 grid gap-6 lg:mt-[30px] lg:grid-cols-2">
            {scenarios.map(({ icon: Icon, ...scenario }) => (
              <article
                key={scenario.type}
                className="flex min-w-0 flex-col gap-[18px] rounded-[18px] bg-background p-5 lg:p-[30px]"
              >
                <div className="flex items-center justify-between text-brand">
                  <p className="text-xs tracking-[1.2px]">
                    {scenario.type.toUpperCase()} CALL
                  </p>
                  <Icon className="size-6" />
                </div>
                <h3 className="text-[25px] leading-[1.4] tracking-[-0.6px]">
                  {scenario.title}
                </h3>
                <p className="text-[15px] leading-[1.6] text-muted-foreground">
                  {scenario.description}
                </p>
                <div
                  className={`flex min-h-40 flex-col gap-3 rounded-xl p-[18px] ${scenario.type === 'cold' ? 'bg-secondary' : 'bg-warm'}`}
                >
                  <div className="flex items-center gap-2.5">
                    <img
                      src={scenario.portrait}
                      alt=""
                      width={44}
                      height={44}
                      loading="lazy"
                      className="size-11 shrink-0 rounded-full"
                    />
                    <div>
                      <p className="text-[13px] font-semibold">
                        {scenario.customer}
                      </p>
                      <p className="mt-0.5 text-xs leading-[1.5] text-muted-foreground">
                        {scenario.context}
                      </p>
                    </div>
                  </div>
                  {scenario.type === 'warm' && (
                    <p className="flex items-center gap-[7px] text-xs text-brand">
                      <History className="size-3.5 shrink-0" />
                      Đã trao đổi về căn 2PN
                    </p>
                  )}
                  <p className="rounded-xl rounded-tl-[2px] bg-background px-3.5 py-2.5 text-base leading-[1.5] font-medium">
                    {scenario.quote}
                  </p>
                </div>
                <div className="space-y-2.5 border-t border-border pt-5">
                  <p className="text-xs leading-[1.6] tracking-[0.7px] text-brand">
                    BÀI LUYỆN MINH HỌA
                  </p>
                  <p className="text-sm leading-[1.6] font-medium">
                    {scenario.exercise}
                  </p>
                  <p className="text-[13px] leading-[1.6] whitespace-pre-line">
                    {scenario.details}
                  </p>
                </div>
                <Link
                  to="/practice"
                  className="mt-auto flex items-center gap-2 text-sm leading-[1.6] font-semibold text-foreground hover:text-brand"
                >
                  Luyện gọi {scenario.type} call{' '}
                  <ArrowUpRight className="size-4" />
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section
          id="feedback"
          className="grid items-center gap-7 px-5 py-11 lg:grid-cols-[minmax(0,560fr)_minmax(0,520fr)] lg:gap-[76px] lg:px-16 lg:py-[90px]"
        >
          <div className="space-y-[22px]">
            <SectionLabel>PHẢN HỒI SAU CUỘC GỌI</SectionLabel>
            <h2 className={headingClass}>
              Không chỉ chấm điểm.
              <br />
              Biết cách làm tốt hơn.
            </h2>
            <p className="text-base leading-[1.6] text-muted-foreground">
              Phản hồi dựa trên những gì bạn đã nói: cách mở đầu, khám phá nhu
              cầu, xử lý phản đối và chốt bước tiếp theo.
            </p>
            <p className="text-[15px] leading-[1.6] text-muted-foreground">
              Khi có kết quả phù hợp, SalesCoach AI có thể gợi ý bài luyện cho
              kỹ năng cần cải thiện. Bạn vẫn có thể tự chọn bài khác.
            </p>
            <Link
              to="/practice"
              className="inline-flex items-center gap-2 text-sm leading-[1.6] font-semibold text-foreground hover:text-brand"
            >
              Khám phá cách nhận phản hồi <ArrowUpRight className="size-4" />
            </Link>
          </div>
          <article className="min-w-0 space-y-[22px] rounded-[22px] border border-border bg-report p-5 lg:p-[30px]">
            <h3 className="text-[15px] leading-[1.6] font-medium">
              Kết quả sau cuộc gọi · Minh họa
            </h3>
            <div className="flex items-center gap-4 lg:gap-6">
              <div className="relative flex size-[84px] shrink-0 items-center justify-center rounded-full bg-[conic-gradient(var(--brand)_0%_68%,var(--secondary)_68%_100%)] lg:size-[100px]">
                <div className="absolute inset-[6px] rounded-full bg-report" />
                <span className="relative text-[28px] font-semibold lg:text-[34px]">
                  68
                </span>
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] leading-[1.5] text-brand">
                  ĐIỂM KỸ NĂNG · MINH HỌA
                </p>
                <p className="text-xl">68 / 100</p>
                <p className="text-xs leading-[1.6] text-muted-foreground">
                  Mục tiêu cuộc gọi: Đạt một phần
                </p>
              </div>
            </div>
            <div className="space-y-2 rounded-xl bg-background p-5">
              <SectionLabel>ĐIỂM MẠNH</SectionLabel>
              <p className="text-sm leading-[1.6]">
                Bạn đã nêu lý do gọi gắn với thông tin khách đã đăng ký.
              </p>
            </div>
            <div className="space-y-2 rounded-xl bg-warm p-5">
              <SectionLabel>CẦN CẢI THIỆN</SectionLabel>
              <p className="text-sm leading-[1.6]">
                Chưa chốt ngày giờ xem nhà mẫu. Hãy đề xuất một thời điểm cụ
                thể.
              </p>
            </div>
          </article>
        </section>

        <section
          id="teams"
          className={`border-t border-border ${sectionClass}`}
        >
          <SectionLabel>DÀNH CHO ĐỘI NGŨ KINH DOANH</SectionLabel>
          <h2 className={`mt-6 lg:mt-[34px] ${headingClass}`}>
            Biến thực hành thành
            <br />
            lợi thế của cả đội.
          </h2>
          <div className="mt-6 grid gap-6 lg:mt-[34px] lg:grid-cols-2 lg:gap-16">
            {audienceOutcomes.map(({ audience, title, points }) => (
              <article
                key={audience}
                className="space-y-[18px] border-t border-border py-[26px]"
              >
                <p className="text-[13px] font-medium text-brand">{audience}</p>
                <h3 className="text-2xl leading-[1.4]">{title}</h3>
                <ul className="space-y-3">
                  {points.map((point) => (
                    <li
                      key={point}
                      className="flex items-start gap-2.5 text-sm leading-[1.6] text-muted-foreground"
                    >
                      <Check className="mt-1 size-4 shrink-0 text-brand" />
                      {point}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <PricingSection signedIn={Boolean(user)} />

        <section className="flex flex-col items-center gap-5 rounded-[20px] bg-invitation-gradient px-5 py-11 text-center lg:gap-6 lg:rounded-[28px] lg:px-[100px] lg:pt-[70px] lg:pb-[72px]">
          <AudioLines className="size-11 text-brand" strokeWidth={1.5} />
          <h2 className="text-[30px] leading-[1.3] tracking-[-0.7px] lg:text-[46px] lg:tracking-[-1.5px]">
            Cuộc gọi tốt hơn
            <br />
            bắt đầu từ một lần luyện.
          </h2>
          <p className="text-base leading-[1.6]">
            Chọn bài luyện. Gọi cho khách hàng AI.
            <br />
            Mang sự chuẩn bị đó vào cuộc gọi thật.
          </p>
          <ButtonLink
            to="/practice"
            className={`w-full sm:w-auto ${primaryActionClass}`}
          >
            {practiceAction} <ArrowUpRight className="size-[18px]" />
          </ButtonLink>
        </section>

        <footer className="space-y-6 px-5 pt-9 pb-3 lg:space-y-8 lg:px-16 lg:pt-12">
          <div className="flex flex-col items-start gap-6 lg:flex-row lg:items-center lg:justify-between">
            <HomeLogo />
            <div className="flex flex-col gap-4 text-sm text-muted-foreground lg:flex-row lg:gap-8">
              {navigation.map(([id, label]) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="text-muted-foreground hover:text-brand"
                >
                  {label}
                </a>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-4 border-t border-border py-6 text-xs leading-[1.6] text-muted-foreground lg:flex-row lg:justify-between">
            <p>© 2026 SalesCoach AI</p>
            <div className="flex gap-2">
              <a
                href="#terms"
                className="text-muted-foreground hover:text-brand"
              >
                Điều khoản
              </a>
              <span>·</span>
              <a
                href="#privacy"
                className="text-muted-foreground hover:text-brand"
              >
                Quyền riêng tư
              </a>
            </div>
          </div>
        </footer>
      </div>
    </main>
  )
}

function HomeLogo() {
  return (
    <a href="#top" aria-label="SalesCoach AI — Trang chủ" className="shrink-0">
      <img
        src="/images/LOGO_salescoachAI.png"
        alt="SalesCoach AI"
        width={210}
        height={70}
        className="h-[50px] w-[148px] object-contain lg:h-[70px] lg:w-[210px]"
      />
    </a>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs leading-[1.6] font-semibold tracking-[1.2px] text-brand">
      {children}
    </p>
  )
}

function SectionIntro({
  label,
  title,
  description,
}: {
  label: string
  title: string
  description: string
}) {
  return (
    <div className="space-y-3.5">
      <SectionLabel>{label}</SectionLabel>
      <h2 className={headingClass}>{title}</h2>
      <p className="text-[15px] leading-[1.5] text-muted-foreground lg:text-base">
        {description}
      </p>
    </div>
  )
}

function PricingSection({ signedIn }: { signedIn: boolean }) {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>(
    'monthly',
  )
  const yearly = billingPeriod === 'yearly'
  const annualNote =
    'Gói năm tiết kiệm 16,7%. Thanh toán một lần cho cả năm; hạn mức vẫn làm mới mỗi tháng.'

  function billingLinkProps(search: Record<string, string>) {
    return signedIn
      ? ({ to: '/billing', search } as const)
      : ({
          to: '/login',
          search: {
            callbackUrl: `/billing?${new URLSearchParams(search)}`,
          },
        } as const)
  }

  function planHeader(plan: PricingPlan) {
    const free = plan.name === 'Free'
    const popular = plan.name === 'Pro'
    const savings = plan.monthlyPrice * 12 - plan.yearlyPrice
    const actionClass = `flex h-12 w-full items-center justify-center rounded-lg border border-primary px-3 text-[13px] font-medium transition lg:h-[46px] ${popular ? 'bg-primary text-primary-foreground hover:bg-primary-hover' : 'bg-background text-foreground hover:bg-muted'}`

    return (
      <div className="flex flex-col gap-2.5 lg:gap-3.5">
        <h3 className="text-[22px] leading-[1.5] font-normal">
          {plan.name}
          {popular && ' / PHỔ BIẾN'}
        </h3>
        <p className="text-[13px] leading-[1.55] lg:min-h-10">
          {plan.audience}
        </p>
        <p className="text-[30px] leading-[1.5] lg:text-[32px]">
          {formatPrice(yearly ? plan.yearlyPrice : plan.monthlyPrice)}
        </p>
        <p className="text-[13px] leading-[1.5]">
          / {plan.unit && `${plan.unit} / `}
          {yearly ? 'năm' : 'tháng'}
        </p>
        <p
          className={`text-[13px] leading-[1.55] text-brand lg:min-h-[54px] lg:text-xs ${free ? 'lg:text-foreground' : ''}`}
        >
          {free
            ? 'Luôn miễn phí · 0 ₫ / tháng'
            : yearly
              ? `Trả trước cho cả năm · tương đương ${formatPrice(plan.yearlyPrice / 12)} / tháng. Tiết kiệm ${formatPrice(savings)} / người / năm.`
              : `Gói năm: ${formatPrice(plan.yearlyPrice)} / người / năm. Tiết kiệm ${formatPrice(savings)} / người / năm.`}
        </p>
        {free ? (
          <ButtonLink to="/practice" variant="outline" className={actionClass}>
            {plan.action}
          </ButtonLink>
        ) : (
          <Link
            {...billingLinkProps({
              plan: plan.name.toLowerCase(),
              interval: billingPeriod,
            })}
            className={actionClass}
          >
            {plan.action}
          </Link>
        )}
      </div>
    )
  }

  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className={`border-t border-border ${sectionClass}`}
    >
      <div className="space-y-4">
        <SectionLabel>BẢNG GIÁ</SectionLabel>
        <h2 id="pricing-heading" className={headingClass}>
          Chọn gói luyện tập phù hợp với bạn
        </h2>
        <p className="text-base leading-[1.5] text-muted-foreground">
          Bắt đầu miễn phí, nâng cấp khi cần thêm thời gian luyện tập hoặc triển
          khai cho cả đội ngũ.
        </p>
      </div>
      <fieldset className="mt-6 lg:mt-8">
        <legend className="sr-only">Chu kỳ thanh toán</legend>
        <div className="inline-flex gap-1 rounded-[10px] bg-muted p-1">
          {(
            [
              ['monthly', 'Hàng tháng'],
              ['yearly', 'Hàng năm'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name="billing-period"
                value={value}
                checked={billingPeriod === value}
                onChange={() => setBillingPeriod(value)}
                className="peer sr-only"
              />
              <span className="flex min-h-11 items-center justify-center rounded-[7px] px-[18px] text-sm text-muted-foreground peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
                {label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-6 border-t border-border py-4 text-[13px] leading-[1.55] text-brand lg:hidden">
        {annualNote}
      </p>
      <div className="mt-8 hidden overflow-hidden rounded-2xl border border-border lg:block">
        <table className="w-full table-fixed border-collapse text-left text-[13px] leading-[1.5]">
          <caption className="sr-only">
            So sánh gói luyện tập — thanh toán{' '}
            {yearly ? 'hàng năm' : 'hàng tháng'}
          </caption>
          <thead>
            <tr>
              <td className="w-[23.1%] p-6 align-bottom">
                <p className="text-xl leading-[1.5]">
                  Một nơi để bắt đầu. Thêm không gian để tiến xa.
                </p>
                <p className="mt-4 text-[13px] leading-[1.5] text-muted-foreground">
                  {annualNote}
                </p>
              </td>
              {pricingPlans.map((plan) => (
                <th
                  key={plan.name}
                  scope="col"
                  className={`p-6 align-top font-normal ${plan.name === 'Pro' ? 'bg-secondary' : ''}`}
                >
                  {planHeader(plan)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pricingFeatures.map((feature, index) => (
              <tr key={feature} className="border-t border-border">
                <th scope="row" className="px-6 py-5 font-semibold">
                  {feature}
                </th>
                {pricingPlans.map((plan) => (
                  <td
                    key={plan.name}
                    className={`px-6 py-5 ${plan.name === 'Pro' ? 'bg-secondary' : ''} ${plan.features[index] === 'Chưa bao gồm' ? 'text-muted-foreground' : ''}`}
                  >
                    {plan.features[index]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 lg:hidden">
        {pricingPlans.map((plan) => (
          <article
            key={plan.name}
            aria-label={`Gói ${plan.name}`}
            className={`rounded-xl border border-border p-5 ${plan.name === 'Pro' ? 'bg-secondary' : ''}`}
          >
            {planHeader(plan)}
            <dl className="mt-2.5 space-y-2.5">
              {pricingFeatures.map((feature, index) => (
                <div
                  key={feature}
                  className="space-y-1 border-t border-border pt-3"
                >
                  <dt className="text-xs leading-[1.55] font-semibold">
                    {feature}
                  </dt>
                  <dd
                    className={`text-[13px] leading-[1.55] ${plan.features[index] === 'Chưa bao gồm' ? 'text-muted-foreground' : ''}`}
                  >
                    {plan.features[index]}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      <article
        aria-labelledby="extra-practice-heading"
        className="mt-6 flex flex-col gap-5 rounded-xl bg-warm p-5 lg:mt-8 lg:flex-row lg:items-center lg:gap-9 lg:p-7"
      >
        <div className="min-w-0 flex-1 space-y-2.5">
          <SectionLabel>THANH TOÁN THEO MỨC SỬ DỤNG</SectionLabel>
          <h3
            id="extra-practice-heading"
            className="text-[22px] leading-[1.55] lg:text-2xl"
          >
            Luyện tập thêm — 3.000đ/phút
          </h3>
          <p className="text-[13px] leading-[1.55]">
            Chọn gói 15, 75, 150 hoặc 300 phút. Gói 150 phút bằng hạn mức Pro
            một tháng; gói 300 phút bằng hạn mức một suất Business. Phút mua
            thêm không hết hạn và được dùng sau hạn mức tháng.
          </p>
        </div>
        <Link
          {...billingLinkProps({ topup: 'topup_15' })}
          className="inline-flex h-[52px] w-full shrink-0 items-center justify-center gap-2.5 rounded-lg bg-primary px-[22px] text-[13px] font-semibold text-primary-foreground hover:bg-primary-hover lg:w-auto"
        >
          <Plus className="size-4" />
          Chọn gói phút
        </Link>
      </article>
      <div className="mt-6 border-t border-border py-6 lg:mt-8">
        <h3 className="text-base leading-[1.6] font-semibold">
          Lưu ý về hạn mức và thành viên
        </h3>
        <ol className="mt-3 space-y-3">
          {subscriptionTerms.map((term, index) => (
            <li
              key={term}
              className="flex items-start gap-3 text-[13px] leading-[1.6] text-muted-foreground"
            >
              <span className="shrink-0">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span>{term}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
