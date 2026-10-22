import { useId, useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import { TZDate } from 'react-day-picker'
import type { DateRange } from 'react-day-picker'
import { vi } from 'react-day-picker/locale'
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
import { ADMIN_RANGE_DAYS, ADMIN_RANGE_MIN_DATE } from '#/lib/admin/contracts'
import type { AdminUsageRange } from '#/lib/admin/contracts'
import {
  APP_TIME_ZONE,
  customRangeProblem,
  resolveRange,
  toDateKey,
} from '#/lib/admin/usage'
import type { RangeProblem } from '#/lib/admin/usage'

const PROBLEMS: Record<RangeProblem, string> = {
  incomplete: 'Chọn đủ ngày bắt đầu và ngày kết thúc.',
  reversed: 'Ngày bắt đầu phải trước hoặc trùng ngày kết thúc.',
  future: 'Ngày kết thúc không được sau hôm nay.',
  too_early: 'Ngày bắt đầu không được trước 01/01/2000.',
  too_long: 'Khoảng thời gian tối đa là 10 năm.',
}

export function calendarDate(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new TZDate(year, month - 1, day, APP_TIME_ZONE)
}

export function displayDate(key: string) {
  return key.split('-').reverse().join('/')
}

/** Shortcuts for the last days up to today, and a calendar for any period. */
export function UsageRangePicker({
  range,
  today,
  onChange,
}: {
  range: AdminUsageRange
  today: string
  onChange: (range: AdminUsageRange) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange>()
  const errorId = useId()
  const applied = resolveRange(range, today)
  const calendarRange = draft ?? {
    from: calendarDate(applied.from),
    to: calendarDate(applied.to),
  }
  const earliest = calendarDate(ADMIN_RANGE_MIN_DATE)
  const latest = calendarDate(today)
  const problem =
    draft?.from && draft.to
      ? customRangeProblem(toDateKey(draft.from), toDateKey(draft.to), today)
      : null

  const pick = (next: DateRange | undefined, day: Date) => {
    // Always start a fresh range on the first click, even when a previous
    // range is highlighted. A second click on the same day selects one day.
    if (!draft?.from || draft.to) {
      setDraft({ from: day })
      return
    }
    setDraft(next)
    if (!next?.from || !next.to) return

    const period = { from: toDateKey(next.from), to: toDateKey(next.to) }
    if (customRangeProblem(period.from, period.to, today)) return

    onChange(period)
    setDraft(undefined)
    setOpen(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <div
          role="group"
          aria-label="Khoảng thời gian gần đây"
          className="flex h-11 items-center gap-1 rounded-[9px] bg-muted p-1"
        >
          {ADMIN_RANGE_DAYS.map((days) => {
            const selected = !draft && 'days' in range && range.days === days
            return (
              <Button
                key={days}
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraft(undefined)
                  setOpen(false)
                  onChange({ days })
                }}
                aria-pressed={selected}
                className={`h-9 flex-1 rounded-md px-[13px] text-[13px] hover:bg-background sm:flex-none ${selected ? 'bg-background font-semibold text-brand' : 'font-normal text-muted-foreground'}`}
              >
                {days} ngày
              </Button>
            )
          })}
        </div>
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
                variant="outline"
                aria-label={`Chọn khoảng thời gian: ${displayDate(applied.from)} đến ${displayDate(applied.to)}`}
                className="h-11 w-full justify-start gap-2 rounded-[9px] border-border bg-background px-4 text-[13px] font-normal tabular-nums text-foreground shadow-none sm:w-auto"
              />
            }
          >
            <CalendarIcon aria-hidden="true" />
            <span className="min-w-0 truncate">
              {displayDate(applied.from)} – {displayDate(applied.to)}
            </span>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-auto max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto border-border bg-background p-0 font-sans text-foreground max-h-[var(--available-height)]"
          >
            <PopoverHeader className="px-3 pt-3">
              <PopoverTitle>Khoảng thời gian tùy chọn</PopoverTitle>
              <PopoverDescription className="text-xs">
                {draft?.from && !draft.to
                  ? `Từ ${displayDate(toDateKey(draft.from))}. Chọn ngày kết thúc.`
                  : 'Chọn ngày bắt đầu, rồi chọn ngày kết thúc.'}
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
              disabled={{ before: earliest, after: latest }}
              selected={calendarRange}
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
                {PROBLEMS[problem]}
              </p>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
