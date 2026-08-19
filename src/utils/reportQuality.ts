import type { Activity } from '../stores/activityStore'

export interface ReportQuality {
  score: number
  label: string
  detail: string
}

/**
 * 用记录数量、覆盖时长和分类多样性给报告输入打分。
 * 这是数据完整度提示，不代表工作效率或个人表现。
 */
export function calculateReportQuality(activities: Activity[]): ReportQuality {
  if (activities.length === 0) {
    return { score: 0, label: '暂无数据', detail: '当天没有可用于报告的活动记录' }
  }

  const timestamps = activities
    .map(activity => Date.parse(activity.timestamp))
    .filter(timestamp => Number.isFinite(timestamp))
  const spanMs = timestamps.length > 1
    ? Math.max(...timestamps) - Math.min(...timestamps)
    : 0
  const countScore = Math.min(40, activities.length * 4)
  const spanScore = Math.min(35, (spanMs / (8 * 60 * 60 * 1000)) * 35)
  const diversityScore = Math.min(25, new Set(activities.map(activity => activity.category)).size * 5)
  const score = Math.round(countScore + spanScore + diversityScore)

  if (score >= 80) {
    return { score, label: '信息充分', detail: '记录数量、时间覆盖和分类都较完整' }
  }
  if (score >= 60) {
    return { score, label: '基本完整', detail: '可以生成稳定的日总结，仍有补充空间' }
  }
  if (score >= 35) {
    return { score, label: '信息有限', detail: '报告可生成，但结论可能不够完整' }
  }
  return { score, label: '记录不足', detail: '建议增加采集时间或补充活动记录' }
}
