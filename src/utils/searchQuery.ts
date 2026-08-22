export interface ParsedSearchQuery {
  query: string
  startAt?: string
  endAt?: string
  rangeLabel?: string
}

function startOfDay(date: Date): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function mondayOf(date: Date): Date {
  const result = startOfDay(date)
  const day = result.getDay() || 7
  result.setDate(result.getDate() - day + 1)
  return result
}

export function parseSearchQuery(input: string, now = new Date()): ParsedSearchQuery {
  const trimmed = input.trim()
  const ranges: Array<{
    token: string
    label: string
    range: () => [Date, Date]
  }> = [
    { token: '前天', label: '前天', range: () => [addDays(startOfDay(now), -2), addDays(startOfDay(now), -1)] },
    { token: '昨天', label: '昨天', range: () => [addDays(startOfDay(now), -1), startOfDay(now)] },
    { token: '今天', label: '今天', range: () => [startOfDay(now), addDays(startOfDay(now), 1)] },
    { token: '上周', label: '上周', range: () => [addDays(mondayOf(now), -7), mondayOf(now)] },
    { token: '本周', label: '本周', range: () => [mondayOf(now), addDays(mondayOf(now), 7)] },
    {
      token: '本月',
      label: '本月',
      range: () => [
        new Date(now.getFullYear(), now.getMonth(), 1),
        new Date(now.getFullYear(), now.getMonth() + 1, 1),
      ],
    },
  ]

  const matched = ranges.find(item => trimmed.includes(item.token))
  const [start, end] = matched?.range() ?? []
  let query = matched ? trimmed.replace(matched.token, ' ') : trimmed
  query = query
    .replace(/^我\s*/, '')
    .replace(/^在哪里\s*/, '')
    .replace(/^(看过|做过|用过|打开过|处理过)\s*/, '')
    .replace(/[？?]+$/, '')
    .trim()

  return {
    query,
    ...(start ? { startAt: start.toISOString() } : {}),
    ...(end ? { endAt: end.toISOString() } : {}),
    ...(matched ? { rangeLabel: matched.label } : {}),
  }
}
