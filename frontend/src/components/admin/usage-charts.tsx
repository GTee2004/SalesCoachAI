import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { RectangleProps } from 'recharts'
import { Button } from '#/components/ui/button'
import type {
  AdminServiceCosts,
  AdminUsage,
  AdminVoiceLatency,
  CostBucket,
  LatencyBucket,
  UsageBucket,
  UsageGranularity,
} from '#/lib/admin/contracts'
import { SLOW_REPLY_MS } from '#/lib/admin/contracts'
import {
  formatBucketLong,
  formatBucketShort,
  formatCount,
  formatDecimal,
  formatLatency,
  formatPeriod,
  formatUsd,
} from '#/lib/admin/format'
import { GRANULARITY_LABELS } from '#/lib/admin/labels'
import { CALL_SERIES, CallLegend } from './call-series'
import { COST_SERIES, CostLegend } from './cost-series'
import { Panel, PanelMessage } from './panel'

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 }
const CHART_MARGIN = { top: 8, bottom: 0, left: 0 }

/**
 * Room on the right for the centered label of the last bucket. A month label
 * such as "10/2026" is wider than a day label.
 */
const lastTickRoom = (granularity: UsageGranularity) =>
  granularity === 'month' ? 24 : 12

/** About seven evenly spaced labels that always include the last bucket. */
function bucketTicks(series: Array<Pick<UsageBucket, 'date'>>) {
  const step = Math.ceil(series.length / 7)
  return series
    .filter((_, index) => (series.length - 1 - index) % step === 0)
    .map((bucket) => bucket.date)
}

const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1)

/** Said of the bucket that today falls in, whose numbers can still grow. */
const unfinishedNote = (granularity: UsageGranularity) =>
  granularity === 'day' ? 'chưa hết ngày' : 'tính đến hiện tại'

/** A chart with the same numbers one click away as a table. */
function ChartPanel({
  titleId,
  title,
  description,
  empty,
  surface,
  chart,
  table,
}: {
  titleId: string
  title: string
  description: string
  empty: string | null
  surface: 'muted' | 'blue'
  chart: ReactNode
  table: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <Panel
      titleId={titleId}
      title={title}
      description={description}
      surface={surface}
      action={
        empty ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={asTable}
            onClick={() => setAsTable((current) => !current)}
            className="h-9 px-0 text-xs font-medium text-brand hover:bg-transparent hover:text-brand-hover"
          >
            {asTable ? 'Xem biểu đồ' : 'Xem bảng'}
          </Button>
        )
      }
    >
      {empty ? (
        <PanelMessage>{empty}</PanelMessage>
      ) : asTable ? (
        <div className="max-h-[286px] overflow-auto">{table}</div>
      ) : (
        chart
      )}
    </Panel>
  )
}

function BucketTable({
  heading,
  columns,
  rows,
  format = formatCount,
}: {
  heading: string
  columns: string[]
  rows: Array<{ date: string; label: string; values: Array<number | null> }>
  /** Formats the value in column `index`. */
  format?: (value: number, index: number) => string
}) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th className="sticky top-0 border-b border-border bg-background px-2.5 py-2 text-left font-medium">
            {heading}
          </th>
          {columns.map((column) => (
            <th
              key={column}
              className="sticky top-0 whitespace-nowrap border-b border-border bg-background px-2.5 py-2 text-right font-medium"
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.date}
            className="[&:not(:last-child)>td]:border-b [&>td]:border-border [&>td]:px-2.5 [&>td]:py-2"
          >
            <td className="whitespace-nowrap">{row.label}</td>
            {row.values.map((value, index) => (
              <td key={columns[index]} className="text-right tabular-nums">
                {value == null ? '–' : format(value, index)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ChartTooltip({
  title,
  rows,
  footer,
  format = formatCount,
}: {
  title: string
  rows: Array<{ color: string; value: number; label: string }>
  footer?: string
  format?: (value: number) => string
}) {
  return (
    <div className="min-w-[150px] rounded-[10px] border border-border bg-background px-3 py-2.5 font-sans text-xs text-muted-foreground shadow-lg">
      <p className="mb-1 font-medium text-foreground">{title}</p>
      {rows.map((row) => (
        <p
          key={row.label}
          className="flex items-center gap-[7px] leading-[1.7]"
        >
          <span
            aria-hidden="true"
            className="h-0.5 w-3 shrink-0 rounded-[1px]"
            style={{ background: row.color }}
          />
          <b className="min-w-[22px] text-right font-medium tabular-nums text-foreground">
            {format(row.value)}
          </b>
          {row.label}
        </p>
      ))}
      {footer ? (
        <p className="mt-1 border-t border-border pt-1 text-muted-foreground">
          {footer}
        </p>
      ) : null}
    </div>
  )
}

// Recharts injects `active` and `payload` into the tooltip element it is given.
type TooltipState = {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: UsageBucket }>
  today: string
  granularity: UsageGranularity
}

function CallsTooltip({ active, payload, today, granularity }: TooltipState) {
  const bucket = payload?.[0]?.payload
  if (!active || !bucket) return null
  return (
    <ChartTooltip
      title={formatBucketLong(bucket, granularity, today)}
      rows={CALL_SERIES.map((series) => ({
        color: series.color,
        value: bucket[series.key],
        label: series.label,
      }))}
      footer={`Tổng ${formatCount(bucket.calls)} cuộc gọi${bucket.endDate === today ? ` · ${unfinishedNote(granularity)}` : ''}`}
    />
  )
}

function ActiveUsersTooltip({
  active,
  payload,
  today,
  granularity,
}: TooltipState) {
  const bucket = payload?.[0]?.payload
  if (!active || !bucket) return null
  return (
    <ChartTooltip
      title={formatBucketLong(bucket, granularity, today)}
      rows={[
        {
          color: CALL_SERIES[0].color,
          value: bucket.activeUsers,
          label: 'người dùng hoạt động',
        },
      ]}
      footer={
        bucket.endDate === today
          ? capitalize(unfinishedNote(granularity))
          : undefined
      }
    />
  )
}

export function CallsChart({ usage }: { usage: AdminUsage }) {
  const { series, granularity, today } = usage
  const unit = GRANULARITY_LABELS[granularity]
  // Past two months of bars, each one is only a few pixels wide: the hairline
  // between segments and the rounded cap would swallow it.
  const dense = series.length > 62
  return (
    <ChartPanel
      titleId="daily-calls-title"
      surface="muted"
      title={`Cuộc gọi theo ${unit}`}
      description={`Số cuộc gọi bắt đầu mỗi ${unit}, chia theo kết quả.`}
      empty={
        series.some((bucket) => bucket.calls > 0)
          ? null
          : 'Chưa có cuộc gọi nào trong kỳ này.'
      }
      chart={
        <>
          <CallLegend />
          <div className="h-[210px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={series}
                margin={{ ...CHART_MARGIN, right: lastTickRoom(granularity) }}
                barCategoryGap={dense ? '12%' : '28%'}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date: string) =>
                    formatBucketShort({ date, endDate: date }, granularity)
                  }
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  ticks={bucketTicks(series)}
                  interval={0}
                />
                <YAxis
                  allowDecimals={false}
                  width={34}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'var(--border)', opacity: 0.4 }}
                  content={
                    <CallsTooltip today={today} granularity={granularity} />
                  }
                />
                {CALL_SERIES.map((item, index) => (
                  <Bar
                    key={item.key}
                    dataKey={item.key}
                    name={item.label}
                    stackId="calls"
                    fill={item.color}
                    maxBarSize={32}
                    isAnimationActive={false}
                    // The hairline separates touching segments, and the
                    // cap is rounded on whichever segment ends that stack.
                    shape={(
                      props: RectangleProps & { payload?: UsageBucket },
                    ) => (
                      <Rectangle
                        {...props}
                        stroke="var(--muted)"
                        strokeWidth={dense ? 0 : 1}
                        radius={
                          !dense &&
                          CALL_SERIES.slice(index + 1).every(
                            (above) => !props.payload?.[above.key],
                          )
                            ? [4, 4, 0, 0]
                            : 0
                        }
                      />
                    )}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs leading-[1.6] text-muted-foreground">
            {formatPeriod(usage.period, today)}
            {usage.period.to === today ? ' · Hôm nay tính đến hiện tại.' : ''}
          </p>
        </>
      }
      table={
        <BucketTable
          heading={capitalize(unit)}
          columns={[...CALL_SERIES.map((item) => item.label), 'Tổng']}
          rows={series
            .map((bucket) => ({
              date: bucket.date,
              label: formatBucketLong(bucket, granularity, today),
              values: [
                ...CALL_SERIES.map((item) => bucket[item.key]),
                bucket.calls,
              ],
            }))
            .reverse()}
        />
      }
    />
  )
}

export function ActiveUsersChart({ usage }: { usage: AdminUsage }) {
  const { series, granularity, today } = usage
  const unit = GRANULARITY_LABELS[granularity]
  const color = CALL_SERIES[0].color
  return (
    <ChartPanel
      titleId="active-users-title"
      surface="blue"
      title="Người dùng hoạt động"
      description={`Số người khác nhau có đăng nhập trong ${unit}.`}
      empty={
        series.some((bucket) => bucket.activeUsers > 0)
          ? null
          : 'Chưa có người dùng nào đăng nhập trong kỳ này.'
      }
      chart={
        <>
          <div className="h-[210px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={series}
                margin={{ ...CHART_MARGIN, right: lastTickRoom(granularity) }}
                barCategoryGap={series.length > 62 ? '12%' : '28%'}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date: string) =>
                    formatBucketShort({ date, endDate: date }, granularity)
                  }
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  ticks={bucketTicks(series)}
                  interval={0}
                />
                <YAxis
                  allowDecimals={false}
                  width={34}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'var(--border)', opacity: 0.4 }}
                  content={
                    <ActiveUsersTooltip
                      today={today}
                      granularity={granularity}
                    />
                  }
                />
                <Bar
                  dataKey="activeUsers"
                  name="Người dùng hoạt động"
                  fill={color}
                  radius={series.length > 62 ? 0 : [3, 3, 0, 0]}
                  maxBarSize={32}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs leading-[1.6] text-muted-foreground">
            Người dùng duy nhất trong kỳ:{' '}
            {formatCount(usage.current.activeUsers)}.
          </p>
        </>
      }
      table={
        <BucketTable
          heading={capitalize(unit)}
          columns={['Người dùng hoạt động']}
          rows={series
            .map((bucket) => ({
              date: bucket.date,
              label: formatBucketLong(bucket, granularity, today),
              values: [bucket.activeUsers],
            }))
            .reverse()}
        />
      }
    />
  )
}

/** p95 is the headline; p50 sits behind it in a quieter color. */
export const LATENCY_SERIES = [
  { key: 'p95Ms', label: 'p95', color: 'var(--brand)' },
  { key: 'p50Ms', label: 'p50 (trung vị)', color: '#9bafac' },
] as const satisfies ReadonlyArray<{
  key: keyof LatencyBucket
  label: string
  color: string
}>

function LatencyTooltip({
  active,
  payload,
  today,
  granularity,
}: Omit<TooltipState, 'payload'> & {
  payload?: ReadonlyArray<{ payload?: LatencyBucket }>
}) {
  const bucket = payload?.[0]?.payload
  if (!active || !bucket) return null
  return (
    <ChartTooltip
      title={formatBucketLong(bucket, granularity, today)}
      rows={LATENCY_SERIES.flatMap((series) => {
        const value = bucket[series.key]
        return value == null
          ? []
          : [{ color: series.color, value, label: series.label }]
      })}
      format={formatLatency}
      footer={
        bucket.replies
          ? `${formatCount(bucket.replies)} phản hồi đã đo${bucket.endDate === today ? ` · ${unfinishedNote(granularity)}` : ''}`
          : 'Chưa có phản hồi nào được đo'
      }
    />
  )
}

export function LatencyChart({ latency }: { latency: AdminVoiceLatency }) {
  const { series, granularity, today } = latency
  const unit = GRANULARITY_LABELS[granularity]
  // Keep the slow-reply line on screen even when every reply is quick.
  const top = Math.max(
    SLOW_REPLY_MS * 1.25,
    ...series.map((bucket) => bucket.p95Ms ?? 0),
  )
  return (
    <ChartPanel
      titleId="latency-trend-title"
      surface="muted"
      title={`Độ trễ phản hồi theo ${unit}`}
      description={`Từ lúc người học ngừng nói đến khi khách hàng AI cất lời. Đường đứt là ngưỡng chậm ${formatLatency(SLOW_REPLY_MS)}.`}
      empty={
        latency.current.replies
          ? null
          : 'Chưa có phản hồi nào được đo trong kỳ này.'
      }
      chart={
        <>
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {LATENCY_SERIES.map((item) => (
              <li key={item.key} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-0.5 w-3 shrink-0 rounded-[1px]"
                  style={{ background: item.color }}
                />
                {item.label}
              </li>
            ))}
          </ul>
          <div className="h-[210px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                margin={{ ...CHART_MARGIN, right: lastTickRoom(granularity) }}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date: string) =>
                    formatBucketShort({ date, endDate: date }, granularity)
                  }
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  ticks={bucketTicks(series)}
                  interval={0}
                />
                <YAxis
                  domain={[0, Math.ceil(top / 500) * 500]}
                  tickFormatter={(ms: number) => `${formatDecimal(ms / 1000)}s`}
                  width={40}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                />
                <ReferenceLine
                  y={SLOW_REPLY_MS}
                  stroke="var(--destructive)"
                  strokeDasharray="4 4"
                />
                <Tooltip
                  cursor={{ stroke: 'var(--border)' }}
                  content={
                    <LatencyTooltip today={today} granularity={granularity} />
                  }
                />
                {LATENCY_SERIES.map((item) => (
                  <Line
                    key={item.key}
                    dataKey={item.key}
                    name={item.label}
                    stroke={item.color}
                    strokeWidth={2}
                    // A bucket without replies is a gap, not a fall to zero.
                    connectNulls={false}
                    dot={series.length <= 31 ? { r: 2.5 } : false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs leading-[1.6] text-muted-foreground">
            {formatPeriod(latency.period, today)}
            {latency.period.to === today ? ' · Hôm nay tính đến hiện tại.' : ''}
          </p>
        </>
      }
      table={
        <BucketTable
          heading={capitalize(unit)}
          columns={['Phản hồi', 'p50', 'p95']}
          format={(value, index) =>
            index === 0 ? formatCount(value) : formatLatency(value)
          }
          rows={series
            .map((bucket) => ({
              date: bucket.date,
              label: formatBucketLong(bucket, granularity, today),
              values: [bucket.replies, bucket.p50Ms, bucket.p95Ms],
            }))
            .reverse()}
        />
      }
    />
  )
}

function CostTooltip({
  active,
  payload,
  today,
  granularity,
}: Omit<TooltipState, 'payload'> & {
  payload?: ReadonlyArray<{ payload?: CostBucket }>
}) {
  const bucket = payload?.[0]?.payload
  if (!active || !bucket) return null
  return (
    <ChartTooltip
      title={formatBucketLong(bucket, granularity, today)}
      rows={COST_SERIES.map((series) => ({
        color: series.color,
        value: bucket[series.key],
        label: series.label,
      }))}
      format={formatUsd}
      footer={`Tổng ${formatUsd(bucket.total)}${bucket.endDate === today ? ` · ${unfinishedNote(granularity)}` : ''}`}
    />
  )
}

export function CostChart({ costs }: { costs: AdminServiceCosts }) {
  const { series, granularity, today } = costs
  const unit = GRANULARITY_LABELS[granularity]
  const dense = series.length > 62
  return (
    <ChartPanel
      titleId="cost-trend-title"
      surface="muted"
      title={`Chi phí theo ${unit}`}
      description={`Chi phí của các cuộc gọi bắt đầu mỗi ${unit}, kể cả chấm điểm sau cuộc gọi.`}
      empty={
        series.some((bucket) => bucket.total > 0)
          ? null
          : 'Chưa có chi phí nào được ghi nhận trong kỳ này.'
      }
      chart={
        <>
          <CostLegend />
          <div className="h-[210px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={series}
                margin={{ ...CHART_MARGIN, right: lastTickRoom(granularity) }}
                barCategoryGap={dense ? '12%' : '28%'}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date: string) =>
                    formatBucketShort({ date, endDate: date }, granularity)
                  }
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  ticks={bucketTicks(series)}
                  interval={0}
                />
                <YAxis
                  tickFormatter={(value: number) => `$${value}`}
                  width={44}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'var(--border)', opacity: 0.4 }}
                  content={
                    <CostTooltip today={today} granularity={granularity} />
                  }
                />
                {COST_SERIES.map((item, index) => (
                  <Bar
                    key={item.key}
                    dataKey={item.key}
                    name={item.label}
                    stackId="cost"
                    fill={item.color}
                    maxBarSize={32}
                    isAnimationActive={false}
                    shape={(
                      props: RectangleProps & { payload?: CostBucket },
                    ) => (
                      <Rectangle
                        {...props}
                        stroke="var(--muted)"
                        strokeWidth={dense ? 0 : 1}
                        radius={
                          !dense &&
                          COST_SERIES.slice(index + 1).every(
                            (above) => !props.payload?.[above.key],
                          )
                            ? [4, 4, 0, 0]
                            : 0
                        }
                      />
                    )}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs leading-[1.6] text-muted-foreground">
            {formatPeriod(costs.period, today)}
            {costs.period.to === today ? ' · Hôm nay tính đến hiện tại.' : ''}
          </p>
        </>
      }
      table={
        <BucketTable
          heading={capitalize(unit)}
          columns={[...COST_SERIES.map((item) => item.label), 'Tổng']}
          format={formatUsd}
          rows={series
            .map((bucket) => ({
              date: bucket.date,
              label: formatBucketLong(bucket, granularity, today),
              values: [
                ...COST_SERIES.map((item) => bucket[item.key]),
                bucket.total,
              ],
            }))
            .reverse()}
        />
      }
    />
  )
}
