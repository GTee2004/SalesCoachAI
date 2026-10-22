import { useId, useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import type { DateRange, Matcher } from 'react-day-picker'
import { vi } from 'react-day-picker/locale'
import { calendarDate, displayDate } from '#/components/admin/usage-range'
import { Button } from '#/components/ui/button'
import { Calendar } from '#/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import { ADMIN_RANGE_MIN_DATE } from '#/lib/admin/contracts'
import { APP_TIME_ZONE, shiftDateKey, toDateKey } from '#/lib/admin/usage'
import {
  TEAM_RANGE_MAX_DAYS,
  TEAM_RANGE_MIN_DAYS,
  teamRangeProblem,
  teamRangeProblems,
} from '#/lib/workspace/performance'

const LIMITS = `Tối thiểu ${TEAM_RANGE_MIN_DAYS} ngày, tối đa ${TEAM_RANGE_MAX_DAYS} ngày.`

/**
 * Days that cannot end a range which starts on `start`: those that would make
 * it shorter than the minimum or longer than the maximum. The start itself
 * stays pickable, so clicking it again explains the minimum.
 */
function unreachableFrom(start: string): Matcher[] {
  const day = (offset: number) => calendarDate(shiftDateKey(start, offset))
  return [
    { from: day(-(TEAM_RANGE_MIN_DAYS - 2)), to: day(-1) },
    { from: day(1), to: day(TEAM_RANGE_MIN_DAYS - 2) },
    { before: day(-(TEAM_RANGE_MAX_DAYS - 1)) },
    { after: day(TEAM_RANGE_MAX_DAYS - 1) },
  ]
}

/** A calendar popover for any period of at least a week, ending no later than today. */
export function TeamRangePicker({
  applied,
  active,
  today,
  onChange,
  className,
}: {
  /** The period on screen, which the calendar opens on. */
  applied: { from: string; to: string }
  /** Whether that period was picked here rather than chosen from the presets. */
  active: boolean
  today: string
  onChange: (range: { from: string; to: string }) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange>()
  const errorId = useId()
  const earliest = calendarDate(ADMIN_RANGE_MIN_DATE)
  const latest = calendarDate(today)
  const start = draft?.from && !draft.to ? toDateKey(draft.from) : null
  const problem =
    draft?.from && draft.to
      ? teamRangeProblem(toDateKey(draft.from), toDateKey(draft.to), today)
      : null

  const pick = (next: DateRange | undefined, day: Date) => {
    // Always start a fresh range on the first click, even when a previous
    // range is highlighted.
    if (!draft?.from || draft.to) {
      setDraft({ from: day })
      return
    }
    setDraft(next)
    if (!next?.from || !next.to) return

    const range = { from: toDateKey(next.from), to: toDateKey(next.to) }
    if (teamRangeProblem(range.from, range.to, today)) return

    onChange(range)
    setDraft(undefined)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        setDraft(undefined)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            aria-current={active ? 'page' : undefined}
            aria-label={
              active
                ? `Khoảng thời gian tùy chọn: ${displayDate(applied.from)} đến ${displayDate(applied.to)}`
                : 'Chọn khoảng thời gian tùy chọn'
            }
            className={className}
          />
        }
      >
        <CalendarIcon aria-hidden="true" />
        <span className="tabular-nums">
          {active
            ? `${displayDate(applied.from)} – ${displayDate(applied.to)}`
            : 'Tùy chọn'}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[var(--available-height)] w-auto max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto border-border bg-background p-0 font-sans text-foreground"
      >
        <PopoverHeader className="px-3 pt-3">
          <PopoverTitle>Khoảng thời gian tùy chọn</PopoverTitle>
          <PopoverDescription className="max-w-64 text-xs">
            {start
              ? `Từ ${displayDate(start)}. Chọn ngày kết thúc. ${LIMITS}`
              : `Chọn ngày bắt đầu, rồi chọn ngày kết thúc. ${LIMITS}`}
          </PopoverDescription>
        </PopoverHeader>
        <Calendar
          mode="range"
          required
          autoFocus
          locale={vi}
          timeZone={APP_TIME_ZONE}
          today={latest}
          captionLayout="dropdown"
          defaultMonth={calendarDate(applied.from)}
          startMonth={earliest}
          endMonth={latest}
          disabled={[
            { before: earliest },
            { after: latest },
            ...(start ? unreachableFrom(start) : []),
          ]}
          selected={
            draft ?? {
              from: calendarDate(applied.from),
              to: calendarDate(applied.to),
            }
          }
          onSelect={pick}
          aria-label="Chọn ngày bắt đầu và ngày kết thúc"
          aria-describedby={problem ? errorId : undefined}
        />
        {problem ? (
          <p
            id={errorId}
            role="alert"
            className="max-w-64 px-3 pb-3 text-xs text-destructive"
          >
            {teamRangeProblems[problem]}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
