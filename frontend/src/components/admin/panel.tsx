import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

export function Panel({
  titleId,
  title,
  description,
  level = 3,
  action,
  surface = 'plain',
  children,
}: {
  titleId: string
  title: string
  description?: string
  level?: 2 | 3
  action?: ReactNode
  surface?: 'plain' | 'muted' | 'blue'
  children: ReactNode
}) {
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <section
      role="region"
      aria-labelledby={titleId}
      className={`flex min-w-0 flex-col gap-5 ${surface === 'plain' ? '' : `rounded-[18px] p-5 sm:p-6 ${surface === 'blue' ? 'bg-secondary' : 'bg-muted'}`}`}
    >
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:justify-between">
        <div className="min-w-0 sm:flex-1 sm:basis-[220px]">
          <Heading
            id={titleId}
            className={`font-medium leading-[1.5] ${level === 2 || surface === 'plain' ? 'text-xl' : 'text-lg'}`}
          >
            {title}
          </Heading>
          {description ? (
            <p className="mt-2 text-xs leading-[1.6] text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export const TONES = {
  good: 'bg-[#eaf4ee] text-[#276349] dark:bg-emerald-900/30 dark:text-emerald-300',
  warning: 'bg-warm text-[#795a1c] dark:text-warning',
  critical: 'bg-destructive-subtle text-destructive',
  neutral: 'bg-muted text-muted-foreground',
  live: 'bg-secondary text-brand',
}

export type Tone = keyof typeof TONES

/** State is always spelled out; the color only repeats it. */
export function StatusPill({
  tone,
  icon: Icon,
  children,
}: {
  tone: Tone
  icon?: LucideIcon
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}
    >
      {Icon ? <Icon size={14} strokeWidth={2} aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

export function PanelMessage({
  kind = 'status',
  tone = 'critical',
  children,
}: {
  kind?: 'status' | 'alert'
  tone?: 'warning' | 'critical'
  children: ReactNode
}) {
  return (
    <div
      role={kind}
      className={`flex items-start gap-2.5 rounded-[10px] p-4 text-[13px] leading-[1.6] ${kind === 'alert' ? TONES[tone] : 'bg-muted text-muted-foreground'}`}
    >
      {kind === 'alert' ? (
        <TriangleAlert
          size={16}
          className="mt-0.5 shrink-0"
          aria-hidden="true"
        />
      ) : null}
      <p>{children}</p>
    </div>
  )
}
