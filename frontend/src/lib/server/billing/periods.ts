export function monthAfter(anchor: Date, monthOffset: number) {
  const first = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + monthOffset, 1),
  )
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate()
  first.setUTCDate(Math.min(anchor.getUTCDate(), lastDay))
  first.setUTCHours(
    anchor.getUTCHours(),
    anchor.getUTCMinutes(),
    anchor.getUTCSeconds(),
    anchor.getUTCMilliseconds(),
  )
  return first
}

export function getAllowancePeriod(anchor: Date, now: Date) {
  let monthOffset =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    now.getUTCMonth() -
    anchor.getUTCMonth()
  while (monthOffset > 0 && monthAfter(anchor, monthOffset) > now)
    monthOffset -= 1
  while (monthAfter(anchor, monthOffset + 1) <= now) monthOffset += 1
  const startsAt = monthAfter(anchor, Math.max(0, monthOffset))
  return { startsAt, endsAt: monthAfter(anchor, Math.max(0, monthOffset) + 1) }
}
