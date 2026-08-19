import type { Activity } from '../stores/activityStore'
import { categoryVisual } from './categoryStyles'
import { localDateKey } from './date'

export type EfficiencyPeriod = 'today' | 'this-week' | 'last-week'

export interface AwReportLevel {
  level: string
  seconds: number
  percent: number
  points: number
}

export interface AwReportRank {
  app?: string
  domain?: string
  seconds: number
  percent: number
  count?: number
}

export interface AwReportCategory {
  path: string
  seconds: number
  percent: number
  count?: number
}

export interface AwReportTrendPoint {
  date: string
  pulse: number
  active_seconds: number
  productive_percent: number
  productive_seconds?: number
  ai_seconds?: number
  deep_work?: { seconds?: number }
}

export interface AwReportInsight {
  kind?: string
  severity?: string
  title?: string
  evidence?: string
  action?: string
  verify?: string
}

export interface AwReportRuleHealth {
  rule_count?: number
  issue_count?: number
  conflict_seconds?: number
  coverage_percent?: number
  suggestions?: Array<{
    source?: string
    value?: string
    expected_seconds?: number
    confidence?: string
  }>
}

export interface AwReportData {
  generated_at?: string
  locale?: string
  period?: {
    id?: string
    start?: string
    end?: string
    label?: string
  }
  source?: {
    mode?: string
    host?: string
    afk_available?: boolean
    browser_available?: boolean
  }
  privacy?: Record<string, string>
  summary: {
    activity_count?: number
    has_duration_data?: boolean
    pulse?: number
    score_status?: string
    active_seconds?: number
    categorized_seconds?: number
    uncategorized_seconds?: number
    category_coverage_percent?: number
    productive_seconds?: number
    productive_percent?: number
    confirmed_mapping_percent?: number
    mapped_percent?: number
    ai_seconds?: number
    ai_count?: number
    afk_seconds?: number
    levels?: AwReportLevel[]
    categories?: AwReportCategory[]
    apps?: AwReportRank[]
    domains?: AwReportRank[]
    hourly?: number[]
    deep_work?: {
      seconds?: number
      longest_seconds?: number
      block_count?: number
      start_hours?: number[]
    }
  }
  comparison?: {
    previous_available?: boolean
    pulse_change?: number | null
    active_percent_change?: number | null
    productive_percent_change?: number | null
  }
  baseline?: {
    sample_count?: number
    sufficient?: boolean
    pulse?: number | null
  }
  trend?: AwReportTrendPoint[]
  insights?: AwReportInsight[]
  rule_health?: AwReportRuleHealth
}

const CATEGORY_POINTS: Record<Activity['category'], number> = {
  dev: 100,
  doc: 80,
  meeting: 65,
  communication: 60,
  other: 50,
}

const CATEGORY_LEVEL: Record<Activity['category'], AwReportLevel['level']> = {
  dev: 'focus',
  doc: 'other_work',
  meeting: 'neutral',
  communication: 'neutral',
  other: 'neutral',
}

const LEVEL_POINTS: Record<string, number> = {
  focus: 100,
  other_work: 75,
  neutral: 50,
  personal: 25,
  distracting: 0,
}

function startOfDay(date: Date): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

function startOfWeek(date: Date): Date {
  const result = startOfDay(date)
  const weekday = result.getDay() || 7
  result.setDate(result.getDate() - weekday + 1)
  return result
}

function periodBounds(period: EfficiencyPeriod, now = new Date()): { start: Date; end: Date } {
  if (period === 'today') return { start: startOfDay(now), end: now }
  const thisWeek = startOfWeek(now)
  if (period === 'this-week') return { start: thisWeek, end: now }
  const lastWeek = new Date(thisWeek)
  lastWeek.setDate(lastWeek.getDate() - 7)
  return { start: lastWeek, end: thisWeek }
}

function weightedUnits(activities: Activity[], hasDuration: boolean): number {
  return activities.reduce((sum, activity) => sum + (hasDuration ? Math.max(activity.durationSeconds ?? 0, 0) : 1), 0)
}

function localScore(activities: Activity[], hasDuration: boolean): number {
  const total = weightedUnits(activities, hasDuration)
  if (total <= 0) return 0
  const points = activities.reduce((sum, activity) => {
    const weight = hasDuration ? Math.max(activity.durationSeconds ?? 0, 0) : 1
    return sum + CATEGORY_POINTS[activity.category] * weight
  }, 0)
  return Math.round((points / total) * 10) / 10
}

function isAiActivity(activity: Activity): boolean {
  return /chatgpt|claude|gemini|copilot|cursor|deepseek|kimi|豆包|通义|元宝|hermes|ai\b/i.test(
    `${activity.app} ${activity.title}`,
  )
}

/** Build a deterministic efficiency overview from Moji's own activity records. */
export function buildLocalEfficiencyReport(
  activities: Activity[],
  period: EfficiencyPeriod,
  now = new Date(),
): AwReportData {
  const { start, end } = periodBounds(period, now)
  const selected = activities.filter(activity => {
    const timestamp = Date.parse(activity.timestamp)
    return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp < end.getTime()
  })
  const hasDuration = selected.some(activity => (activity.durationSeconds ?? 0) > 0)
  const totalUnits = Math.max(weightedUnits(selected, hasDuration), 1)
  const totalSeconds = selected.reduce((sum, activity) => sum + Math.max(activity.durationSeconds ?? 0, 0), 0)

  const categoryUnits = new Map<Activity['category'], number>()
  const appStats = new Map<string, { seconds: number; count: number }>()
  const levelUnits = new Map<string, number>()
  const hourly = Array.from({ length: 24 }, () => 0)
  let aiSeconds = 0
  let aiCount = 0
  let focusSeconds = 0
  let focusCount = 0

  for (const activity of selected) {
    const seconds = Math.max(activity.durationSeconds ?? 0, 0)
    const units = hasDuration ? seconds : 1
    categoryUnits.set(activity.category, (categoryUnits.get(activity.category) ?? 0) + units)
    const app = appStats.get(activity.app) ?? { seconds: 0, count: 0 }
    app.seconds += seconds
    app.count += 1
    appStats.set(activity.app, app)
    const level = CATEGORY_LEVEL[activity.category]
    levelUnits.set(level, (levelUnits.get(level) ?? 0) + units)
    const hour = new Date(activity.timestamp).getHours()
    hourly[hour] += hasDuration ? seconds : 1
    if (isAiActivity(activity)) {
      aiSeconds += seconds
      aiCount += 1
    }
    if (activity.category === 'dev') {
      focusSeconds += seconds
      focusCount += 1
    }
  }

  const categories = Array.from(categoryUnits.entries())
    .map(([category, units]) => ({
      path: categoryVisual(category).label,
      seconds: hasDuration ? units : 0,
      percent: (units / totalUnits) * 100,
      count: selected.filter(activity => activity.category === category).length,
    }))
    .sort((a, b) => b.percent - a.percent)
  const apps = Array.from(appStats.entries())
    .map(([app, value]) => ({
      app,
      seconds: value.seconds,
      count: value.count,
      percent: ((hasDuration ? value.seconds : value.count) / totalUnits) * 100,
    }))
    .sort((a, b) => (hasDuration ? b.seconds - a.seconds : (b.count ?? 0) - (a.count ?? 0)))
  const levels = Array.from(levelUnits.entries()).map(([level, units]) => ({
    level,
    seconds: hasDuration ? units : 0,
    percent: (units / totalUnits) * 100,
    points: LEVEL_POINTS[level] ?? 50,
  }))
  const productiveUnits = (categoryUnits.get('dev') ?? 0) + (categoryUnits.get('doc') ?? 0)

  const trendEnd = startOfDay(end)
  const trend = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(trendEnd)
    date.setDate(date.getDate() - 13 + index)
    const key = localDateKey(date)
    const day = activities.filter(activity => localDateKey(activity.timestamp) === key)
    const dayHasDuration = day.some(activity => (activity.durationSeconds ?? 0) > 0)
    const dayTotalUnits = weightedUnits(day, dayHasDuration)
    const dayProductiveUnits = weightedUnits(
      day.filter(activity => activity.category === 'dev' || activity.category === 'doc'),
      dayHasDuration,
    )
    return {
      date: key,
      pulse: localScore(day, dayHasDuration),
      active_seconds: day.reduce((sum, activity) => sum + Math.max(activity.durationSeconds ?? 0, 0), 0),
      productive_percent: dayTotalUnits > 0 ? (dayProductiveUnits / dayTotalUnits) * 100 : 0,
    }
  })

  const topCategory = categories[0]
  const insights: AwReportInsight[] = selected.length === 0
    ? [{ title: '本周期暂无活动记录', evidence: '墨记还没有采集到这个周期的活动。', action: '返回仪表盘开始采集，或切换其他周期。' }]
    : [
        {
          title: topCategory ? `${topCategory.path}是主要活动` : '活动结构已生成',
          evidence: topCategory ? `该分类占本周期记录的 ${topCategory.percent.toFixed(0)}%。` : undefined,
          action: '结合应用排行检查时间投入是否符合本周期目标。',
        },
        ...(!hasDuration ? [{
          title: '当前按记录数估算',
          evidence: '这些活动没有可用的持续时长，因此占比和排行按记录条数计算。',
          action: '持续运行采集后，新记录会逐步累积停留时长。',
        }] : []),
      ]

  return {
    generated_at: now.toISOString(),
    locale: 'zh-CN',
    period: {
      id: period,
      start: start.toISOString(),
      end: end.toISOString(),
      label: period === 'today' ? '今天' : period === 'this-week' ? '本周' : '上周',
    },
    source: { mode: 'moji', host: '本机' },
    privacy: {
      window_titles: 'stored_locally',
      full_urls: 'not_collected',
      domains: 'not_collected',
      raw_events: 'stored_locally',
    },
    summary: {
      activity_count: selected.length,
      has_duration_data: hasDuration,
      pulse: localScore(selected, hasDuration),
      score_status: 'local',
      active_seconds: totalSeconds,
      category_coverage_percent: selected.length > 0 ? 100 : 0,
      productive_percent: selected.length > 0 ? (productiveUnits / totalUnits) * 100 : 0,
      ai_seconds: aiSeconds,
      ai_count: aiCount,
      levels,
      categories,
      apps,
      domains: [],
      hourly,
      deep_work: { seconds: focusSeconds, block_count: focusCount, start_hours: [] },
    },
    comparison: { previous_available: false },
    baseline: { sample_count: trend.filter(item => item.active_seconds > 0 || item.pulse > 0).length, sufficient: false },
    trend,
    insights,
    rule_health: { rule_count: 0, issue_count: 0, coverage_percent: selected.length > 0 ? 100 : 0, suggestions: [] },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Parse the JSON returned by the bundled ActivityWatch analysis script. */
export function parseAwReport(raw: string): AwReportData | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || !isRecord(value.summary)) return null
    return value as unknown as AwReportData
  } catch {
    return null
  }
}