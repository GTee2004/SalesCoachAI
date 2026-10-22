import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCount, formatDayShort, formatDecimal } from '#/lib/admin/format'
import type { TeamTrendPoint } from '#/lib/workspace/performance'

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 }

const rangeLabel = (point: TeamTrendPoint) =>
  point.from === point.to
    ? formatDayShort(point.from)
    : `${formatDayShort(point.from)} – ${formatDayShort(point.to)}`

function TrendTooltip({
  active,
  payload,
  render,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: TeamTrendPoint }>
  render: (point: TeamTrendPoint) => string
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="rounded-[10px] border border-border bg-background px-3 py-2.5 font-sans text-xs text-muted-foreground shadow-lg">
      <p className="mb-0.5 font-medium text-foreground">{rangeLabel(point)}</p>
      <p>{render(point)}</p>
    </div>
  )
}

function ChartBlock({
  title,
  summary,
  children,
}: {
  title: string
  summary: string
  children: React.ReactNode
}) {
  return (
    <figure className="min-w-0">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <div role="img" aria-label={summary} className="mt-3 h-[180px] w-full">
        {children}
      </div>
    </figure>
  )
}

/** Sessions and average score per slice of the period, side by side. */
export function TrendChart({ trend }: { trend: TeamTrendPoint[] }) {
  if (!trend.some((point) => point.sessions > 0))
    return (
      <p className="text-sm text-muted-foreground">
        Chưa có phiên luyện tập nào hoàn thành trong kỳ này.
      </p>
    )

  const data = trend.map((point) => ({
    ...point,
    label: formatDayShort(point.from),
    score: point.averageScore === null ? null : Math.round(point.averageScore),
  }))
  const xAxis = (
    <XAxis
      dataKey="label"
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={{ stroke: 'var(--border)' }}
      interval="preserveStartEnd"
      minTickGap={16}
    />
  )

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <ChartBlock
        title="Phiên luyện tập"
        summary={`Số phiên mỗi kỳ: ${trend.map((point) => `${rangeLabel(point)}: ${point.sessions}`).join('; ')}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, bottom: 0, left: 0, right: 8 }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            {xAxis}
            <YAxis
              allowDecimals={false}
              width={30}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: 'var(--border)', opacity: 0.4 }}
              content={
                <TrendTooltip
                  render={(point) => `${formatCount(point.sessions)} phiên`}
                />
              }
            />
            <Bar
              dataKey="sessions"
              fill="var(--brand)"
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartBlock>

      <ChartBlock
        title="Điểm trung bình"
        summary={`Điểm trung bình mỗi kỳ: ${trend.map((point) => `${rangeLabel(point)}: ${point.averageScore === null ? 'chưa có' : formatDecimal(point.averageScore)}`).join('; ')}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, bottom: 0, left: 0, right: 8 }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            {xAxis}
            <YAxis
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              width={30}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={
                <TrendTooltip
                  render={(point) =>
                    point.averageScore === null
                      ? 'Chưa có phiên được chấm điểm'
                      : `${formatDecimal(point.averageScore)}/100 · ${formatCount(point.sessions)} phiên`
                  }
                />
              }
            />
            <Line
              dataKey="score"
              type="linear"
              stroke="var(--brand)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--brand)', strokeWidth: 0 }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartBlock>
    </div>
  )
}
