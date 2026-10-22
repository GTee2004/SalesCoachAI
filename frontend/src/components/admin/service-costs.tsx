import type { AdminServiceCosts, CostLine } from '#/lib/admin/contracts'
import {
  describeChange,
  formatCompact,
  formatCount,
  formatDecimal,
  formatUsd,
} from '#/lib/admin/format'
import { COST_PROVIDER_LABELS, COST_SERIES_LABELS } from '#/lib/admin/labels'
import { findPrice } from '#/lib/admin/service-prices'
import type { ServicePrice } from '#/lib/admin/service-prices'
import { Panel, PanelMessage } from './panel'
import { StatTiles } from './usage-overview'
import type { StatTile } from './usage-overview'

export function CostTiles({ costs }: { costs: AdminServiceCosts }) {
  const { current, previous } = costs
  const evaluationShare = current.totalUsd
    ? (current.evaluationUsd / current.totalUsd) * 100
    : null
  const tiles: StatTile[] = [
    {
      label: 'Tổng chi phí',
      value: formatUsd(current.totalUsd),
      change: describeChange(
        current.totalUsd,
        previous.totalUsd,
        'percent',
        '%',
      ),
      better: 'down',
      note: 'STT, LLM và TTS của cuộc gọi, cộng chấm điểm',
    },
    {
      label: 'Chi phí mỗi cuộc gọi',
      value: current.perCallUsd == null ? '–' : formatUsd(current.perCallUsd),
      change: describeChange(
        current.perCallUsd,
        previous.perCallUsd,
        'percent',
        '%',
      ),
      better: 'down',
      note: `Trên ${formatCount(current.calls)} cuộc gọi bắt đầu trong kỳ`,
    },
    {
      label: 'Chi phí mỗi phút gọi',
      value:
        current.perMinuteUsd == null ? '–' : formatUsd(current.perMinuteUsd),
      change: describeChange(
        current.perMinuteUsd,
        previous.perMinuteUsd,
        'percent',
        '%',
      ),
      better: 'down',
      note: `${formatCount(Math.round(current.callMinutes))} phút âm thanh gửi nhận dạng`,
    },
    {
      label: 'Chấm điểm',
      value: formatUsd(current.evaluationUsd),
      change: describeChange(
        current.evaluationUsd,
        previous.evaluationUsd,
        'percent',
        '%',
      ),
      better: 'down',
      note:
        evaluationShare == null
          ? 'Chưa có chi phí trong kỳ'
          : `${formatDecimal(evaluationShare)}% tổng chi phí`,
    },
  ]
  return <StatTiles tiles={tiles} />
}

/** "3,2 giờ âm thanh", "120 nghìn ký tự", "1,2 triệu token vào · 50 nghìn ra". */
function describeUsage(line: CostLine) {
  if (line.service === 'stt') {
    const minutes = line.audioSeconds / 60
    return minutes >= 60
      ? `${formatDecimal(minutes / 60)} giờ âm thanh`
      : `${formatCount(Math.round(minutes))} phút âm thanh`
  }
  if (line.service === 'tts') return `${formatCompact(line.characters)} ký tự`
  const cached = line.cachedInputTokens
    ? ` (${formatDecimal((line.cachedInputTokens / line.inputTokens) * 100)}% cache)`
    : ''
  return `${formatCompact(line.inputTokens)} token vào${cached} · ${formatCompact(line.outputTokens)} ra`
}

function describePrice(price: ServicePrice | null) {
  if (!price) return null
  if (price.service === 'stt') return `${formatUsd(price.perHour)}/giờ`
  if (price.service === 'tts')
    return `${formatUsd(price.perMillionCharacters)}/1 triệu ký tự`
  return `${formatUsd(price.perMillionInput)} vào · ${formatUsd(price.perMillionOutput)} ra /1 triệu token`
}

export function CostBreakdown({ costs }: { costs: AdminServiceCosts }) {
  const unpriced = costs.lines.filter((line) => line.costUsd == null)
  return (
    <Panel
      titleId="cost-breakdown-title"
      title="Theo dịch vụ và mô hình"
      description={`Lượng dùng trong kỳ nhân với giá niêm yết của nhà cung cấp, cập nhật ngày ${costs.pricesCheckedOn.split('-').reverse().join('/')}. Đổi giá sẽ tính lại cả các kỳ trước.`}
    >
      {unpriced.length ? (
        <PanelMessage kind="alert" tone="warning">
          Chưa có giá cho{' '}
          {unpriced
            .map(
              (line) =>
                `${COST_PROVIDER_LABELS[line.provider] ?? line.provider} ${line.model}`,
            )
            .join(', ')}
          . Tổng chi phí chưa tính các dòng này.
        </PanelMessage>
      ) : null}
      {costs.lines.length === 0 ? (
        <PanelMessage>
          Chưa có lượng dùng nào được ghi nhận trong kỳ này.
        </PanelMessage>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-muted text-left text-xs text-muted-foreground">
                <th className="rounded-l-md px-2.5 py-3 font-medium">
                  Dịch vụ
                </th>
                <th className="px-2.5 py-3 font-medium">Nhà cung cấp</th>
                <th className="px-2.5 py-3 font-medium">Lượng dùng</th>
                <th className="rounded-r-md px-2.5 py-3 text-right font-medium">
                  Chi phí
                </th>
              </tr>
            </thead>
            <tbody>
              {costs.lines.map((line) => {
                const kind =
                  line.source === 'evaluation' ? 'evaluation' : line.service
                const price = describePrice(
                  findPrice(line.service, line.provider, line.model),
                )
                return (
                  <tr
                    key={`${line.source}/${line.service}/${line.provider}/${line.model}`}
                    className="align-top [&>td]:border-b [&>td]:border-border [&>td]:px-2.5 [&>td]:py-3"
                  >
                    <td>
                      <span className="block font-medium">
                        {COST_SERIES_LABELS[kind].name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {COST_SERIES_LABELS[kind].detail}
                      </span>
                    </td>
                    <td>
                      <span className="block">
                        {COST_PROVIDER_LABELS[line.provider] ?? line.provider}
                      </span>
                      <span className="block break-all text-xs text-muted-foreground">
                        {line.model}
                      </span>
                    </td>
                    <td className="tabular-nums">
                      <span className="block">{describeUsage(line)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {price ?? 'Chưa có giá'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-right font-medium tabular-nums">
                      {line.costUsd == null ? '–' : formatUsd(line.costUsd)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
