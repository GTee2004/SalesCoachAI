import { Badge } from '#/components/ui/badge'
import { formatCount, formatDecimal } from '#/lib/admin/format'
import type { TeamScenarioStat } from '#/lib/workspace/performance'
import { callTypeLabels, difficultyLabels, scoreBand } from './shared'

export function ScenarioResults({
  scenarios,
}: {
  scenarios: TeamScenarioStat[]
}) {
  if (!scenarios.length)
    return (
      <p className="text-sm text-muted-foreground">
        Chưa có tình huống nào được luyện trong kỳ này.
      </p>
    )
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Tình huống
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Phiên
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Người luyện
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Điểm TB
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Đạt mục tiêu
            </th>
          </tr>
        </thead>
        <tbody>
          {scenarios.map((scenario) => {
            const band = scoreBand(scenario.averageScore)
            return (
              <tr
                key={scenario.practiceId}
                className="[&>td]:border-t [&>td]:border-border"
              >
                <td className="px-3 py-2.5">
                  <p className="min-w-[160px]">{scenario.title}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    <Badge variant="secondary">
                      {callTypeLabels[scenario.callType]}
                    </Badge>
                    <Badge variant="secondary">
                      {difficultyLabels[scenario.difficulty]}
                    </Badge>
                  </p>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatCount(scenario.sessions)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatCount(scenario.members)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {scenario.averageScore === null ? (
                    <span className="text-muted-foreground">–</span>
                  ) : (
                    <span
                      title={band.label}
                      className={`inline-block rounded-[7px] px-2 py-1 text-[13px] font-medium tabular-nums ${band.className}`}
                    >
                      {formatDecimal(scenario.averageScore)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {scenario.objectiveAchievedRate === null
                    ? '–'
                    : `${formatDecimal(scenario.objectiveAchievedRate)}%`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
