import type { Activity } from '../stores/activityStore'
import { localDateKey } from './date'
import { formatDuration } from './format'

export type LocalReportTemplate = 'standard' | 'brief' | 'technical' | 'okr'

const CATEGORY_LABEL: Record<Activity['category'], string> = {
  dev: '开发',
  meeting: '会议',
  doc: '文档',
  communication: '沟通',
  other: '其他',
  unclassified: '未分类',
}

const VALID_TEMPLATES: LocalReportTemplate[] = ['standard', 'brief', 'technical', 'okr']

function normalizeTemplate(value: string): LocalReportTemplate {
  return (VALID_TEMPLATES as string[]).includes(value) ? value as LocalReportTemplate : 'standard'
}

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function activityText(activity: Activity): string {
  const title = cleanText(activity.title)
  const description = cleanText(activity.description)
  const subject = title && title !== activity.app ? `${activity.app}｜${title}` : activity.app
  return description && description !== '无描述' ? `${subject}：${description}` : subject
}

function activityLine(activity: Activity): string {
  const time = new Date(activity.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const duration = formatDuration(activity.durationSeconds)
  const suffix = duration ? `（${duration}）` : ''
  const context = [
    activity.browserDomain ? `域名 ${activity.browserDomain}` : '',
    activity.ideProject ? `项目 ${activity.ideProject}` : '',
  ].filter(Boolean)
  const contextText = context.length > 0 ? ` · ${context.join(' · ')}` : ''
  return `- ${time} · ${CATEGORY_LABEL[activity.category]} · ${activityText(activity)}${suffix}${contextText}`
}

function rankedApps(activities: Activity[]): Array<[string, number, number]> {
  const counts = new Map<string, { count: number; seconds: number }>()
  for (const activity of activities) {
    const current = counts.get(activity.app) ?? { count: 0, seconds: 0 }
    current.count += 1
    current.seconds += activity.durationSeconds ?? 0
    counts.set(activity.app, current)
  }
  return Array.from(counts.entries())
    .map(([app, value]) => [app, value.count, value.seconds] as [string, number, number])
    .sort((a, b) => b[1] - a[1] || b[2] - a[2] || a[0].localeCompare(b[0]))
}

function categorySummary(activities: Activity[]): string[] {
  const counts = new Map<Activity['category'], number>()
  for (const activity of activities) {
    counts.set(activity.category, (counts.get(activity.category) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `- ${CATEGORY_LABEL[category]}：${count} 条`)
}

function dateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00`)
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
}

function overviewLines(activities: Activity[]): string[] {
  const totalSeconds = activities.reduce((sum, activity) => sum + (activity.durationSeconds ?? 0), 0)
  const apps = rankedApps(activities)
  const first = activities[0]
  const last = activities[activities.length - 1]
  const timeRange = first && last
    ? `${new Date(first.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}—${new Date(last.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : '暂无时间范围'
  return [
    `- 记录数：${activities.length} 条`,
    `- 累计时长：${formatDuration(totalSeconds) ?? '暂无有效时长'}`,
    `- 活动范围：${timeRange}`,
    `- 主要应用：${apps[0]?.[0] ?? '暂无'}`,
  ]
}

function standardReport(date: string, activities: Activity[]): string[] {
  const apps = rankedApps(activities)
  return [
    `# ${dateLabel(date)} 工作日报`,
    '',
    '> 本报告由墨记根据本地活动记录按固定模板生成，未调用 LLM。',
    '',
    '## 今日概览',
    ...overviewLines(activities),
    '',
    '## 应用使用',
    ...(apps.length > 0
      ? apps.slice(0, 8).map(([app, count, seconds]) => `- ${app}：${count} 条${formatDuration(seconds) ? `，${formatDuration(seconds)}` : ''}`)
      : ['- 暂无活动记录。']),
    '',
    '## 分类分布',
    ...(categorySummary(activities).length > 0 ? categorySummary(activities) : ['- 暂无活动记录。']),
    '',
    '## 时间线摘要',
    ...(activities.length > 0 ? activities.map(activityLine) : ['- 暂无活动记录。']),
  ]
}

function briefReport(date: string, activities: Activity[]): string[] {
  const apps = rankedApps(activities)
  return [
    `# ${dateLabel(date)} 工作日报（简洁版）`,
    '',
    '> 本报告由墨记根据本地活动记录按固定模板生成，未调用 LLM。',
    '',
    '## 核心摘要',
    ...overviewLines(activities),
    '',
    '## 重点活动',
    ...(activities.length > 0
      ? activities.slice(0, 8).map(activityLine)
      : ['- 暂无活动记录。']),
    '',
    '## 主要应用',
    ...(apps.length > 0
      ? apps.slice(0, 5).map(([app, count]) => `- ${app}：${count} 条`)
      : ['- 暂无活动记录。']),
  ]
}

function technicalReport(date: string, activities: Activity[]): string[] {
  const technical = activities.filter(activity => activity.category === 'dev')
  const other = activities.filter(activity => activity.category !== 'dev')
  return [
    `# ${dateLabel(date)} 技术日报`,
    '',
    '> 本报告由墨记根据本地活动记录按固定模板生成，未调用 LLM。',
    '',
    '## 技术活动',
    ...(technical.length > 0 ? technical.map(activityLine) : ['- 今日没有明确标记为开发的活动。']),
    '',
    '## 技术统计',
    ...overviewLines(technical.length > 0 ? technical : activities),
    '',
    '## 其他记录',
    ...(other.length > 0 ? other.map(activityLine) : ['- 暂无其他分类记录。']),
    '',
    '## 风险与后续',
    '- 当前活动记录没有单独的风险或后续字段，请根据时间线人工补充。',
  ]
}

function okrReport(date: string, activities: Activity[]): string[] {
  return [
    `# ${dateLabel(date)} 工作复盘（固定格式）`,
    '',
    '> 本报告由墨记根据本地活动记录按固定模板生成，未调用 LLM。',
    '',
    '## 目标',
    '- 当前活动记录未包含明确目标字段，请人工补充本日目标。',
    '',
    '## 关键结果进展',
    ...(activities.length > 0 ? activities.map(activityLine) : ['- 暂无活动记录。']),
    '',
    '## 阻塞与风险',
    '- 当前活动记录未包含明确阻塞字段，请人工确认。',
    '',
    '## 下一步行动',
    '- 根据上述活动记录补充可执行的下一步行动。',
  ]
}

/** 使用固定 Markdown 模板生成本地日报，不读取 API 配置，也不调用网络。 */
export function generateLocalDailyReport(
  activities: Activity[],
  date: string,
  templateKey = 'standard',
): string {
  const dayActivities = activities
    .filter(activity => localDateKey(activity.timestamp) === date)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const template = normalizeTemplate(templateKey)

  const lines = template === 'brief'
    ? briefReport(date, dayActivities)
    : template === 'technical'
      ? technicalReport(date, dayActivities)
      : template === 'okr'
        ? okrReport(date, dayActivities)
        : standardReport(date, dayActivities)

  return `${lines.join('\n')}\n`
}
