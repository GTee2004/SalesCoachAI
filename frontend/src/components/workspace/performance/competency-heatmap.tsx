import { CallTypeBadge, callTypes } from '#/components/practice/call-type-badge'
import { describeChange, formatDecimal } from '#/lib/admin/format'
import type { TeamPerformance } from '#/lib/workspace/performance'
import { changeClass, scoreBand } from './shared'

export function CompetencyHeatmap({
  data,
  onSelectMember,
}: {
  data: TeamPerformance
  onSelectMember: (userId: string) => void
}) {
  const { competencies, members } = data
  const change = data.advanced?.competencyChange ?? null
  const weakest = competencies
    .filter((column) => column.teamAverage !== null)
    .reduce<(typeof competencies)[number] | null>(
      (low, column) =>
        !low || (column.teamAverage ?? 0) < (low.teamAverage ?? 0)
          ? column
          : low,
      null,
    )

  if (!competencies.length)
    return (
      <p className="text-sm text-muted-foreground">
        Chưa có kỹ năng nào được chấm trong kỳ này. Dữ liệu sẽ xuất hiện khi
        thành viên hoàn thành phiên luyện tập trong kỳ.
      </p>
    )

  return (
    <div className="space-y-4">
      {weakest?.teamAverage != null && (
        <p className="text-sm">
          Nhóm yếu nhất ở <b className="font-medium">{weakest.name}</b> ·{' '}
          {callTypes[weakest.callType].vietnamese}
          <span className="text-muted-foreground">
            {' '}
            (trung bình {formatDecimal(weakest.teamAverage)}/100,{' '}
            {weakest.assessedMembers} người được chấm)
          </span>
          .
        </p>
      )}
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th
                scope="col"
                className="sticky left-0 z-10 min-w-[160px] border-b border-border bg-background px-3 py-2 text-left font-medium"
              >
                Thành viên
              </th>
              {competencies.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className="min-w-[104px] border-b border-border px-2 py-2 text-center align-bottom font-medium"
                >
                  <span className="flex flex-col items-center gap-1.5">
                    {column.name}
                    <CallTypeBadge type={column.callType} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-[200px] border-b border-border bg-background px-3 py-1.5 text-left font-normal"
                >
                  <button
                    type="button"
                    onClick={() => onSelectMember(member.userId)}
                    className="block max-w-full truncate rounded-md text-left hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {member.name}
                  </button>
                </th>
                {competencies.map((column) => {
                  const score = member.mastery[column.id] ?? null
                  const band = scoreBand(score)
                  return (
                    <td
                      key={column.id}
                      className="border-b border-border px-1.5 py-1.5"
                    >
                      <span
                        title={
                          score === null
                            ? 'Chưa được chấm trong kỳ'
                            : band.label
                        }
                        className={`block rounded-[7px] px-2 py-1.5 text-center text-[13px] tabular-nums ${band.className} ${score === null ? '' : 'font-medium'}`}
                      >
                        {score ?? '–'}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th
                scope="row"
                className="sticky left-0 z-10 bg-background px-3 py-2 text-left text-xs font-medium text-muted-foreground"
              >
                Trung bình nhóm (điểm gần nhất)
              </th>
              {competencies.map((column) => (
                <td
                  key={column.id}
                  className="px-2 py-2 text-center text-[13px] font-medium tabular-nums"
                >
                  {column.teamAverage === null
                    ? '–'
                    : formatDecimal(column.teamAverage)}
                </td>
              ))}
            </tr>
            {change && (
              <tr className="align-top">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-background px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                >
                  Điểm các phiên trong kỳ
                </th>
                {competencies.map((column) => {
                  const entry = change[column.id]
                  const diff = entry
                    ? describeChange(
                        entry.current,
                        entry.previous,
                        'points',
                        ' điểm',
                      )
                    : null
                  return (
                    <td
                      key={column.id}
                      className="px-2 py-2 text-center text-[13px] tabular-nums"
                    >
                      <p className="font-medium">
                        {entry?.current == null
                          ? '–'
                          : formatDecimal(entry.current)}
                      </p>
                      {diff && (
                        <p className={`text-xs ${changeClass(diff.direction)}`}>
                          {diff.text}
                        </p>
                      )}
                    </td>
                  )
                })}
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Mỗi ô là điểm gần nhất của kỹ năng trong kỳ đang chọn, tách riêng cuộc
        gọi lần đầu và gọi lại, giống trang Năng lực của tôi của từng người. Màu
        và con số cùng thể hiện mức độ: từ 70 là tốt, từ 50 đến dưới 70 là trung
        bình, dưới 50 cần cải thiện. Dấu “–” là chưa được chấm trong kỳ.{' '}
        {change
          ? 'Hàng “Điểm các phiên trong kỳ” là điểm trung bình của riêng các phiên trong kỳ, kèm mức thay đổi so với kỳ trước.'
          : 'Chuyển sang chế độ Nâng cao để xem điểm và mức thay đổi của riêng kỳ này.'}
      </p>
    </div>
  )
}
