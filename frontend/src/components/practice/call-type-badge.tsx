import { Flame, Snowflake } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from 'cn'
import { Badge } from '#/components/ui/badge'

export type PracticeCallType = 'cold_call' | 'warm_call'

export const callTypes: Record<
  PracticeCallType,
  { label: string; vietnamese: string; icon: LucideIcon; className: string }
> = {
  cold_call: {
    label: 'Cold call',
    vietnamese: 'Gọi lần đầu',
    icon: Snowflake,
    className: 'bg-cold text-cold-foreground',
  },
  warm_call: {
    label: 'Warm call',
    vietnamese: 'Gọi lại',
    icon: Flame,
    className: 'bg-warm text-warm-foreground',
  },
}

export function CallTypeBadge({
  type,
  className,
}: {
  type: PracticeCallType
  className?: string
}) {
  const { label, icon: Icon, className: colors } = callTypes[type]
  return (
    <Badge
      className={cn(
        'w-fit gap-1 rounded-[5px] border-0 px-2 py-1 text-xs font-medium',
        colors,
        className,
      )}
    >
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  )
}
