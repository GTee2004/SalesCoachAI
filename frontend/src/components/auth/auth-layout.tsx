import type { ReactNode } from 'react'
import { BarChart3, MessagesSquare } from 'lucide-react'
import { Link } from '@tanstack/react-router'

const brandCopy = {
  signup: {
    eyebrow: 'NỀN TẢNG LUYỆN TẬP BÁN HÀNG VỚI AI',
    title: 'Mỗi cuộc trò chuyện, một bước tiến mới.',
    description:
      'Luyện tập tình huống tư vấn bất động sản trong không gian an toàn, nhận phản hồi rõ ràng và tự tin hơn mỗi ngày.',
    quote: '“Tự tin hơn trong từng cuộc tư vấn.”',
    note: 'Bắt đầu hành trình phát triển kỹ năng của bạn hôm nay.',
  },
  login: {
    eyebrow: 'CHÀO MỪNG BẠN TRỞ LẠI',
    title: 'Sẵn sàng cho cuộc tư vấn tiếp theo?',
    description:
      'Tiếp tục rèn luyện cùng SalesCoach AI và biến mỗi lần luyện tập thành sự tự tin trong cuộc trò chuyện thật.',
    quote: '“Tiến bộ đến từ việc luyện tập mỗi ngày.”',
    note: 'Đăng nhập để tiếp tục hành trình phát triển kỹ năng.',
  },
  general: {
    eyebrow: 'SALESCOACH AI',
    title: 'Luyện tập để tự tin hơn mỗi ngày.',
    description:
      'Không gian an toàn để thực hành tư vấn, nhận phản hồi và phát triển kỹ năng bán hàng.',
    quote: '“Tiến bộ đến từ việc luyện tập mỗi ngày.”',
    note: 'SalesCoach AI đồng hành cùng bạn trong từng cuộc tư vấn.',
  },
}

type AuthLayoutProps = {
  children: ReactNode
  variant?: 'signup' | 'login' | 'general'
}

export function AuthLayout({ children, variant = 'general' }: AuthLayoutProps) {
  const copy = brandCopy[variant]

  return (
    <main className="min-h-dvh bg-background p-3 font-sans text-foreground xl:grid xl:grid-cols-[minmax(0,600fr)_minmax(0,768fr)] xl:gap-6 xl:p-6">
      <aside className="hidden flex-col gap-12 rounded-[28px] bg-brand-gradient p-12 xl:flex">
        <img
          src="/images/LOGO_salescoachAI.png"
          alt="SalesCoach AI"
          width={190}
          height={64}
          className="h-16 w-[190px] object-contain"
        />
        <section className="space-y-[22px]">
          <p className="text-xs leading-[1.6] font-semibold tracking-[0.7px] text-brand">
            {copy.eyebrow}
          </p>
          <h2 className="text-[44px] leading-[1.25] font-normal tracking-[-1.2px]">
            {copy.title}
          </h2>
          <p className="text-base leading-[1.6]">{copy.description}</p>
        </section>
        <div className="grid gap-6">
          <Benefit
            icon={<MessagesSquare size={22} />}
            title="Thực hành hội thoại thực tế"
          >
            Nhập vai cùng khách hàng AI theo từng tình huống.
          </Benefit>
          <Benefit
            icon={<BarChart3 size={22} />}
            title="Nhận phản hồi để tiến bộ"
          >
            Hiểu điểm mạnh và điều cần cải thiện sau mỗi buổi.
          </Benefit>
        </div>
        <div className="space-y-2.5 border-t border-brand pt-7">
          <p className="text-[23px] leading-[1.5]">{copy.quote}</p>
          <p className="text-[13px] leading-[1.6]">{copy.note}</p>
        </div>
      </aside>

      <section className="flex min-h-[calc(100dvh-24px)] items-center justify-center px-5 py-8 sm:px-8 xl:min-h-[calc(100dvh-48px)] xl:px-14 xl:py-10">
        <div className="w-full max-w-[448px]">
          <img
            src="/images/LOGO_salescoachAI.png"
            alt="SalesCoach AI"
            className="mb-10 h-16 w-[190px] object-contain xl:hidden"
          />
          {children}
        </div>
      </section>
    </main>
  )
}

function Benefit({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-4">
      <span className="shrink-0 text-brand">{icon}</span>
      <span>
        <span className="block text-base leading-[1.6] font-medium">
          {title}
        </span>
        <span className="mt-1.5 block text-sm leading-[1.6]">{children}</span>
      </span>
    </div>
  )
}

export function AuthHeading({
  eyebrow,
  title,
  description,
  compactTitle = false,
}: {
  eyebrow: string
  title: string
  description: string
  compactTitle?: boolean
}) {
  return (
    <header className="mb-7 space-y-3">
      <p className="text-xs leading-[1.55] font-semibold tracking-[1px] text-brand">
        {eyebrow}
      </p>
      <h1
        className={`text-[30px] leading-[1.25] font-normal tracking-[-1px] ${compactTitle ? 'sm:text-[36px]' : 'sm:text-[38px]'}`}
      >
        {title}
      </h1>
      <p className="text-[15px] leading-[1.55] text-muted-foreground">
        {description}
      </p>
    </header>
  )
}

export function AuthField({
  id,
  label,
  type = 'text',
  placeholder,
  icon,
  autoComplete,
  value,
  onChange,
  required = true,
  maxLength,
  hint,
  inputMode,
}: {
  id: string
  label: string
  type?: string
  placeholder: string
  icon: ReactNode
  autoComplete?: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  maxLength?: number
  hint?: string
  inputMode?: 'text' | 'email' | 'numeric'
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-[13px] leading-[1.55] font-semibold"
      >
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted-foreground">
          {icon}
        </span>
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          maxLength={maxLength}
          inputMode={inputMode}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="h-[52px] w-full rounded-lg border border-border bg-background pr-4 pl-[46px] text-base text-foreground outline-none transition placeholder:text-muted-foreground focus:border-brand focus:ring-3 focus:ring-ring/10 sm:text-sm"
        />
      </div>
      {hint && (
        <p
          id={`${id}-hint`}
          className="mt-2 text-xs leading-[1.55] text-muted-foreground"
        >
          {hint}
        </p>
      )}
    </div>
  )
}

export function AuthNotice({
  children,
  kind = 'error',
}: {
  children: ReactNode
  kind?: 'error' | 'success' | 'info'
}) {
  const colors = {
    error: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    info: 'border-secondary bg-report text-brand',
  }
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={
        'rounded-lg border px-4 py-3 text-[13px] leading-[1.6] ' + colors[kind]
      }
    >
      {children}
    </div>
  )
}

export function AuthSubmit({
  children,
  disabled = false,
}: {
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="flex h-[52px] w-full items-center justify-center gap-3 rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-border disabled:text-muted-foreground"
    >
      {children}
    </button>
  )
}

export function AuthFooter({
  prompt,
  linkText,
  to,
  callbackUrl,
}: {
  prompt: string
  linkText: string
  to: '/signup' | '/login'
  callbackUrl?: string
}) {
  return (
    <p className="text-center text-sm leading-[1.55] text-muted-foreground">
      {prompt}{' '}
      <Link
        to={to}
        search={callbackUrl ? { callbackUrl } : undefined}
        className="font-semibold text-brand underline-offset-2 hover:underline"
      >
        {linkText}
      </Link>
    </p>
  )
}
