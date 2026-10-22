import { useState } from 'react'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import type { AdminVoiceLatency, LatencyStageKey } from '#/lib/admin/contracts'
import { SLOW_REPLY_MS } from '#/lib/admin/contracts'
import {
  describeChange,
  formatCount,
  formatDecimal,
  formatLatency,
} from '#/lib/admin/format'
import { LATENCY_STAGE_LABELS, TTS_PROVIDER_LABELS } from '#/lib/admin/labels'
import { Panel, PanelMessage } from './panel'
import { StatTiles } from './usage-overview'
import type { StatTile } from './usage-overview'

/** Seconds with one decimal, the unit the tiles are read in. */
const seconds = (ms: number | null) =>
  ms == null ? '–' : formatDecimal(ms / 1000)

export function LatencyTiles({ latency }: { latency: AdminVoiceLatency }) {
  const { current, previous } = latency
  const tiles: StatTile[] = [
    {
      label: 'Độ trễ p50',
      value: seconds(current.p50Ms),
      unit: current.p50Ms == null ? undefined : 'giây',
      change: describeChange(current.p50Ms, previous.p50Ms, 'percent', '%'),
      better: 'down',
      note: `Trên ${formatCount(current.replies)} phản hồi đã đo`,
    },
    {
      label: 'Độ trễ p95',
      value: seconds(current.p95Ms),
      unit: current.p95Ms == null ? undefined : 'giây',
      change: describeChange(current.p95Ms, previous.p95Ms, 'percent', '%'),
      better: 'down',
      note: '95% phản hồi nhanh hơn mức này',
    },
    {
      label: `Phản hồi chậm hơn ${formatLatency(SLOW_REPLY_MS)}`,
      value:
        current.slowPercent == null ? '–' : formatDecimal(current.slowPercent),
      unit: current.slowPercent == null ? undefined : '%',
      change: describeChange(
        current.slowPercent,
        previous.slowPercent,
        'points',
        ' điểm %',
      ),
      better: 'down',
      note: 'Người học cảm thấy cuộc gọi bị khựng',
    },
    {
      label: 'Khách hàng AI bị ngắt lời',
      value:
        current.interruptedPercent == null
          ? '–'
          : formatDecimal(current.interruptedPercent),
      unit: current.interruptedPercent == null ? undefined : '%',
      change: describeChange(
        current.interruptedPercent,
        previous.interruptedPercent,
        'points',
        ' điểm %',
      ),
      // Talking over a slow or long reply is a bad sign, but so is a learner
      // who never pushes back: neither direction is plainly better.
      better: null,
      note: 'Người học nói chen khi khách hàng AI đang nói',
    },
  ]
  return <StatTiles tiles={tiles} />
}

const STAGE_COLORS: Record<LatencyStageKey, string> = {
  turn_taking: '#9bafac',
  stt: '#5b9aa8',
  llm: 'var(--brand)',
  tts: '#c08a3e',
  other: 'var(--muted-foreground)',
}

export function LatencyStages({ latency }: { latency: AdminVoiceLatency }) {
  const [provider, setProvider] = useState('')
  // A provider missing from a newly picked period falls back to all of them.
  const selected = latency.providers.find((row) => row.provider === provider)
  const stages = selected?.stages ?? latency.stages
  const mean = stages.reduce((total, stage) => total + stage.averageMs, 0)
  const totals = selected ?? latency.current
  return (
    <Panel
      titleId="latency-stages-title"
      title="Thời gian chờ nằm ở đâu"
      description="Trung bình và tỷ lệ cho thấy đóng góp của từng giai đoạn vào tổng thời gian chờ. p95 giúp nhận biết giai đoạn thỉnh thoảng bị chậm."
      action={
        latency.providers.length > 1 ? (
          <NativeSelect
            size="sm"
            aria-label="Nhà cung cấp TTS"
            value={selected?.provider ?? ''}
            onChange={(event) => setProvider(event.target.value)}
            className="text-xs"
          >
            <NativeSelectOption value="">
              Tất cả nhà cung cấp
            </NativeSelectOption>
            {latency.providers.map((row) => (
              <NativeSelectOption key={row.provider} value={row.provider}>
                {TTS_PROVIDER_LABELS[row.provider] ?? row.provider}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null
      }
    >
      {stages.length === 0 ? (
        <PanelMessage>Chưa có phản hồi nào được đo trong kỳ này.</PanelMessage>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="flex h-3 w-full overflow-hidden rounded-[4px] bg-muted"
          >
            {stages.map((stage) =>
              stage.averageMs ? (
                <div
                  key={stage.key}
                  className="h-full border-r border-background last:border-r-0"
                  style={{
                    width: `${(stage.averageMs / mean) * 100}%`,
                    background: STAGE_COLORS[stage.key],
                  }}
                />
              ) : null,
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] border-collapse text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pb-2 text-left font-medium">Giai đoạn</th>
                  <th className="pb-2 text-right font-medium">Trung bình</th>
                  <th className="pb-2 pl-3 text-right font-medium">p95</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((stage) => (
                  <tr
                    key={stage.key}
                    className="[&>td]:border-t [&>td]:border-border [&>td]:py-2.5"
                  >
                    <td>
                      <span className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-[3px] size-2.5 shrink-0 rounded-[2px]"
                          style={{ background: STAGE_COLORS[stage.key] }}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground">
                            {LATENCY_STAGE_LABELS[stage.key].name}
                          </span>
                          <span className="block text-muted-foreground">
                            {LATENCY_STAGE_LABELS[stage.key].detail}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-right align-top tabular-nums">
                      {formatLatency(stage.averageMs)}
                      <span className="block text-muted-foreground">
                        {formatDecimal((stage.averageMs / mean) * 100)}%
                      </span>
                    </td>
                    <td className="whitespace-nowrap pl-3 text-right align-top tabular-nums">
                      {formatLatency(stage.p95Ms)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-medium [&>th]:py-3 [&>td]:py-3">
                  <th scope="row" className="text-left align-top">
                    Tổng thời gian chờ
                  </th>
                  <td className="whitespace-nowrap text-right align-top tabular-nums">
                    {formatLatency(mean)}
                  </td>
                  <td className="whitespace-nowrap pl-3 text-right align-top tabular-nums">
                    {totals.p95Ms == null ? '–' : formatLatency(totals.p95Ms)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs leading-[1.6] text-muted-foreground">
            Tổng trung bình là tổng các giai đoạn. p95 tổng được tính trên toàn
            bộ thời gian chờ của từng phản hồi, không phải cộng p95 các giai
            đoạn.
          </p>
        </>
      )}
    </Panel>
  )
}

export function LatencyByProvider({ latency }: { latency: AdminVoiceLatency }) {
  return (
    <Panel
      titleId="latency-providers-title"
      title="Theo nhà cung cấp TTS"
      description="Cùng phép đo, tách theo giọng đọc của phiên. Dùng để so sánh khi đổi nhà cung cấp."
    >
      {latency.providers.length === 0 ? (
        <PanelMessage>Chưa có phản hồi nào được đo trong kỳ này.</PanelMessage>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-muted text-left text-xs text-muted-foreground">
                <th className="rounded-l-md px-2.5 py-3 font-medium">
                  Nhà cung cấp
                </th>
                <th className="px-2.5 py-3 text-right font-medium">Phản hồi</th>
                <th className="px-2.5 py-3 text-right font-medium">p50</th>
                <th className="rounded-r-md px-2.5 py-3 text-right font-medium">
                  p95
                </th>
              </tr>
            </thead>
            <tbody>
              {latency.providers.map((row) => (
                <tr
                  key={row.provider}
                  className="[&>td]:border-b [&>td]:border-border [&>td]:px-2.5 [&>td]:py-3"
                >
                  <td className="font-medium">
                    {TTS_PROVIDER_LABELS[row.provider] ?? row.provider}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatCount(row.replies)}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {row.p50Ms == null ? '–' : formatLatency(row.p50Ms)}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {row.p95Ms == null ? '–' : formatLatency(row.p95Ms)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
