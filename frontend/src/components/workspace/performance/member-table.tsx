import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { callTypes } from '#/components/practice/call-type-badge'
import { Badge } from '#/components/ui/badge'
import { describeChange, formatCount, formatDecimal } from '#/lib/admin/format'
import { workspaceRoleLabels } from '#/lib/auth/workspace-roles'
import type { TeamMember } from '#/lib/workspace/performance'
import { changeClass, MemberStatusPill, relativeDay, scoreBand } from './shared'

type SortKey = 'attention' | 'sessions' | 'score' | 'practiced'

// Missing values always sink to the bottom, whichever way the column sorts.
const sorters: Record<
  Exclude<SortKey, 'attention'>,
  (member: TeamMember) => number | null
> = {
  sessions: (member) => member.sessions,
  score: (member) => member.averageScore,
  practiced: (member) =>
    member.lastPracticedAt ? Date.parse(member.lastPracticedAt) : null,
}

function sortMembers(members: TeamMember[], key: SortKey, ascending: boolean) {
  if (key === 'attention') return members
  const read = sorters[key]
  return [...members].sort((a, b) => {
    const left = read(a)
    const right = read(b)
    if (left === null || right === null)
      return left === right ? 0 : left === null ? 1 : -1
    return ascending ? left - right : right - left
  })
}

function SortHeader({
  label,
  column,
  active,
  ascending,
  onSort,
  align = 'left',
}: {
  label: string
  column: SortKey
  active: SortKey
  ascending: boolean
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
}) {
  const isActive = active === column
  const Icon = ascending ? ArrowUp : ArrowDown
  return (
    <th
      scope="col"
      aria-sort={
        isActive ? (ascending ? 'ascending' : 'descending') : undefined
      }
      className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${isActive ? 'text-foreground' : ''}`}
      >
        {label}
        {isActive ? <Icon size={12} aria-hidden="true" /> : null}
      </button>
    </th>
  )
}

function Delta({
  current,
  previous,
  mode,
  unit,
}: {
  current: number | null
  previous: number | null
  mode: 'percent' | 'points'
  unit: string
}) {
  const change = describeChange(current, previous, mode, unit)
  if (!change || change.direction === 'flat') return null
  return (
    <span className={`text-xs ${changeClass(change.direction)}`}>
      {change.text}
    </span>
  )
}

function CountDelta({
  current,
  previous,
}: {
  current: number
  previous: number
}) {
  const difference = current - previous
  if (!difference) return null
  return (
    <span className={`text-xs ${changeClass(difference > 0 ? 'up' : 'down')}`}>
      {difference > 0 ? '▲ +' : '▼ −'}
      {formatCount(Math.abs(difference))}
    </span>
  )
}

export function MemberTable({
  members,
  viewerUserId,
  onSelect,
}: {
  members: TeamMember[]
  viewerUserId: string
  onSelect: (member: TeamMember) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('attention')
  const [ascending, setAscending] = useState(false)
  const rows = useMemo(
    () => sortMembers(members, sortKey, ascending),
    [members, sortKey, ascending],
  )

  function sortBy(key: SortKey) {
    if (key === sortKey) {
      // A third click on the same column restores the "needs attention" order.
      if (ascending) setSortKey('attention')
      setAscending((value) => !value)
      return
    }
    setSortKey(key)
    setAscending(false)
  }

  const header = { active: sortKey, ascending, onSort: sortBy }

  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Thành viên
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Trạng thái
            </th>
            <SortHeader
              {...header}
              label="Số phiên"
              column="sessions"
              align="right"
            />
            <SortHeader
              {...header}
              label="Điểm TB"
              column="score"
              align="right"
            />
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Năng lực yếu nhất
            </th>
            <SortHeader
              {...header}
              label="Luyện tập gần nhất"
              column="practiced"
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((member) => {
            const band = scoreBand(member.averageScore)
            return (
              <tr
                key={member.userId}
                className="border-b border-border last:border-b-0 hover:bg-muted/50"
              >
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={() => onSelect(member)}
                    className="block max-w-[240px] rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {member.name}
                        {member.userId === viewerUserId ? ' (bạn)' : ''}
                      </span>
                      {member.role !== 'member' && (
                        <Badge variant="secondary">
                          {workspaceRoleLabels[member.role]}
                        </Badge>
                      )}
                    </span>
                    <span className="block truncate text-[13px] text-muted-foreground">
                      {member.email}
                    </span>
                  </button>
                </td>
                <td className="px-3 py-3">
                  <MemberStatusPill status={member.status} />
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  <span className="flex flex-col items-end">
                    {formatCount(member.sessions)}
                    <CountDelta
                      current={member.sessions}
                      previous={member.previousSessions}
                    />
                  </span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  <span className="flex flex-col items-end">
                    {member.averageScore === null ? (
                      <span className="text-muted-foreground">–</span>
                    ) : (
                      <span
                        className={`rounded-[7px] px-2 py-0.5 font-medium ${band.className}`}
                      >
                        {formatDecimal(member.averageScore)}
                      </span>
                    )}
                    <Delta
                      current={member.averageScore}
                      previous={member.previousAverageScore}
                      mode="points"
                      unit=""
                    />
                  </span>
                </td>
                <td className="px-3 py-3">
                  {member.weakest ? (
                    <span className="block max-w-[200px]">
                      <span className="block truncate">
                        {member.weakest.name}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {callTypes[member.weakest.callType].vietnamese} ·{' '}
                        {member.weakest.score}/100
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Chưa có dữ liệu
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                  {relativeDay(member.lastPracticedAt)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
