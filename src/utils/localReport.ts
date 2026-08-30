import type { Activity } from '../stores/activityStore'
import { formatDuration } from './format'
import { filterActivitiesForReportPeriod, type ReportType } from './reportHistory'

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

function activityTimeLabel(activity: Activity, type: ReportType): string {
  const date = new Date(activity.timestamp)
  const time = date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return type === 'daily' ? time : `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

function activityLine(activity: Activity, type: ReportType): string {
  const time = activityTimeLabel(activity, type)
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

function reportPeriodLabel(type: ReportType, date: string): string {
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  if (type === 'daily') return dateLabel(date)
  if (type === 'monthly') return `${parsed.getFullYear()}年${parsed.getMonth() + 1}月`

  const weekday = parsed.getDay() || 7
  const monday = new Date(parsed)
  monday.setDate(parsed.getDate() - weekday + 1)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const start = `${monday.getFullYear()}年${monday.getMonth() + 1}月${monday.getDate()}日`
  const end = monday.getFullYear() === sunday.getFullYear()
    ? `${sunday.getMonth() + 1}月${sunday.getDate()}日`
    : `${sunday.getFullYear()}年${sunday.getMonth() + 1}月${sunday.getDate()}日`
  return `${start}至${end}`
}

function reportScope(type: ReportType): string {
  return type === 'daily' ? '今日' : type === 'weekly' ? '本周' : '本月'
}

function reportName(type: ReportType): string {
  return type === 'daily' ? '日报' : type === 'weekly' ? '周报' : '月报'
}

function overviewLines(activities: Activity[], type: ReportType): string[] {
  const totalSeconds = activities.reduce((sum, activity) => sum + (activity.durationSeconds ?? 0), 0)
  const apps = rankedApps(activities)
  const first = activities[0]
  const last = activities[activities.length - 1]
  const timeRange = first && last
    ? `${activityTimeLabel(first, type)}—${activityTimeLabel(last, type)}`
    : '暂无时间范围'
  return [
    `- 记录数：${activities.length} 条`,
    `- 累计时长：${formatDuration(totalSeconds) ?? '暂无有效时长'}`,
    `- 活动范围：${timeRange}`,
    `- 主要应用：${apps[0]?.[0] ?? '暂无'}`,
  ]
}

function standardReport(type: ReportType, date: string, activities: Activity[]): string[] {
  const apps = rankedApps(activities)
  return [
    `# ${reportPeriodLabel(type, date)} 工作${reportName(type)}`,
    '',
    '> 本报告由墨记根据本地活动记录按固定模板生成，未调用 LLM。',
    '',
    `## ${reportScope(type)}概览`,
    ...overviewLines(activities, type),
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
    ...(activities.length > 0 ? activities.map(activity => activityLine(activity, type)) : ['- 暂无活动记录。']),
  ]
}

function briefReport(type: ReportType, date: string, activities: Activity[]): string[] {
  const apps = rankedApps(activities)
  return [
    `# ${reportPeriodLabel(type, date)} 工作${reportName(type)}（简洁版）`,
    '',
    '> 本报告由墨记根据本地活动记录按固定模板生成，未调用 LLM。',
    '',
    '## 核心摘要',
    ...overviewLines(activities, type),
    '',
    '## 重点活动',
    ...(activities.length > 0
      ? activities.slice(0, 8).map(activity => activityLine(activity, type))
      : ['- 暂无活动记录。']),
    '',
    '## 主要应用',
    ...(apps.length > 0
      ? apps.slice(0, 5).map(([app, count]) => `- ${app}：${count} 条`)
      : ['- 暂无活动记录。']),
  ]
}

function technicalReport(type: ReportType, date: string, activities: Activity[]): string[] {
  const technical = activities.filter(activity => activity.category === 'dev')
  const other = activities.filter(activity => activity.category !== 'dev')
  return [
    `# ${reportPeriodLabel(type, date)} 技术${reportName(type)}`,
    '',
    '> 本报告由墨记根据本地活动记录按固定模板生成，未调用 LLM。',
    '',
    '## 技术活动',
    ...(technical.length > 0
      ? technical.map(activity => activityLine(activity, type))
      : [`- ${reportScope(type)}没有明确标记为开发的活动。`]),
    '',
    '## 技术统计',
    ...overviewLines(technical.length > 0 ? technical : activities, type),
    '',
    '## 其他记录',
    ...(other.length > 0 ? other.map(activity => activityLine(activity, type)) : ['- 暂无其他分类记录。']),
    '',
    '## 风险与后续',
    '- 当前活动记录没有单独的风险或后续字段，请根据时间线人工补充。',
  ]
}

function okrReport(type: ReportType, date: string, activities: Activity[]): string[] {
  return [
    `# ${reportPeriodLabel(type, date)} 工作${reportName(type)}（固定格式）`,
    '',
    '> 本报告由墨记根据本地活动记录按固定模板生成，未调用 LLM。',
    '',
    '## 目标',
    '- 当前活动记录未包含明确目标字段，请人工补充本日目标。',
    '',
    '## 关键结果进展',
    ...(activities.length > 0 ? activities.map(activity => activityLine(activity, type)) : ['- 暂无活动记录。']),
    '',
    '## 阻塞与风险',
    '- 当前活动记录未包含明确阻塞字段，请人工确认。',
    '',
    '## 下一步行动',
    '- 根据上述活动记录补充可执行的下一步行动。',
  ]
}

/** 使用固定 Markdown 模板生成本地日／周／月报告，不读取 API 配置，也不调用网络。 */
export function generateLocalReport(
  activities: Activity[],
  date: string,
  type: ReportType,
  templateKey = 'standard',
): string {
  const periodActivities = filterActivitiesForReportPeriod(activities, type, date)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const template = normalizeTemplate(templateKey)

  const lines = template === 'brief'
    ? briefReport(type, date, periodActivities)
    : template === 'technical'
      ? technicalReport(type, date, periodActivities)
      : template === 'okr'
        ? okrReport(type, date, periodActivities)
        : standardReport(type, date, periodActivities)

  return `${lines.join('\n')}\n`
}
