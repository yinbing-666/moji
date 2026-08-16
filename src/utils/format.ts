/** 活动时长展示：秒 → 「x 小时 y 分钟」/「x 分钟」/「x 秒」；无值返回 null */
export function formatDuration(seconds?: number): string | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null
  if (seconds < 60) return `${Math.round(seconds)} 秒`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} 分钟`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`
}
