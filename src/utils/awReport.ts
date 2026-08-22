import type { Activity } from '../stores/activityStore'
import { categoryVisual } from './categoryStyles'
import { findClassificationRuleConflicts, type ClassificationRule } from './classificationRules'
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
  coverage_percent?: number
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
    focus_analysis?: {
      focus_seconds?: number
      longest_focus_seconds?: number
      focus_block_count?: number
      deep_block_count?: number
      interruption_count?: number
      interruption_seconds?: number
      fragment_count?: number
      fragment_seconds?: number
      switch_count?: number
      top_interruptions?: Array<{ app: string; count: number; seconds: number }>
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
  unclassified: 50,
}

const CATEGORY_LEVEL: Record<Activity['category'], AwReportLevel['level']> = {
  dev: 'focus',
  doc: 'other_work',
  meeting: 'neutral',
  communication: 'neutral',
  other: 'neutral',
  unclassified: 'neutral',
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

function previousPeriodBounds(start: Date, end: Date): { start: Date; end: Date } {
  const previousStart = new Date(start)
  const previousEnd = new Date(end)
  previousStart.setDate(previousStart.getDate() - 7)
  previousEnd.setDate(previousEnd.getDate() - 7)
  return { start: previousStart, end: previousEnd }
}

function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

const FOCUS_CATEGORIES = new Set<Activity['category']>(['dev', 'doc'])
const DEEP_WORK_SECONDS = 25 * 60
const MAX_FOCUS_GAP_SECONDS = 5 * 60
const MAX_INTERRUPTION_SECONDS = 15 * 60
const FRAGMENT_SECONDS = 5 * 60

interface ActivitySegment {
  activity: Activity
  start: number
  end: number
  seconds: number
  focus: boolean
}

export function analyzeFocusPatterns(activities: Activity[]) {
  const segments: ActivitySegment[] = activities
    .map(activity => {
      const start = Date.parse(activity.timestamp)
      const seconds = Math.max(activity.durationSeconds ?? 60, 1)
      return {
        activity,
        start,
        end: start + seconds * 1000,
        seconds,
        focus: FOCUS_CATEGORIES.has(activity.category),
      }
    })
    .filter(segment => Number.isFinite(segment.start))
    .sort((a, b) => a.start - b.start)

  const focusBlocks: Array<{ start: number; end: number; seconds: number }> = []
  let current: { start: number; end: number; seconds: number } | null = null
  let switchCount = 0
  let fragmentCount = 0
  let fragmentSeconds = 0
  const interruptions = new Map<string, { count: number; seconds: number }>()
  let interruptionCount = 0
  let interruptionSeconds = 0

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    const previous = segments[index - 1]
    const next = segments[index + 1]

    if (segment.seconds < FRAGMENT_SECONDS) {
      fragmentCount++
      fragmentSeconds += segment.seconds
    }
    if (previous
      && segment.start >= previous.end
      && previous.activity.app !== segment.activity.app
      && segment.start - previous.end <= MAX_FOCUS_GAP_SECONDS * 1000) {
      switchCount++
    }

    if (segment.focus) {
      if (current && segment.start - current.end <= MAX_FOCUS_GAP_SECONDS * 1000) {
        const overlapSeconds = Math.max((current.end - segment.start) / 1000, 0)
        current.end = Math.max(current.end, segment.end)
        current.seconds += Math.max(segment.seconds - overlapSeconds, 0)
      } else {
        if (current) focusBlocks.push(current)
        current = { start: segment.start, end: segment.end, seconds: segment.seconds }
      }
      continue
    }

    if (current) {
      focusBlocks.push(current)
      current = null
    }

    const interruptsFocus = previous?.focus
      && next?.focus
      && segment.seconds <= MAX_INTERRUPTION_SECONDS
      && segment.start >= previous.end
      && next.start >= segment.end
      && segment.start - previous.end <= MAX_FOCUS_GAP_SECONDS * 1000
      && next.start - segment.end <= MAX_FOCUS_GAP_SECONDS * 1000
    if (interruptsFocus) {
      interruptionCount++
      interruptionSeconds += segment.seconds
      const currentApp = interruptions.get(segment.activity.app) ?? { count: 0, seconds: 0 }
      currentApp.count++
      currentApp.seconds += segment.seconds
      interruptions.set(segment.activity.app, currentApp)
    }
  }
  if (current) focusBlocks.push(current)

  const deepBlocks = focusBlocks.filter(block => block.seconds >= DEEP_WORK_SECONDS)
  return {
    focusSeconds: focusBlocks.reduce((sum, block) => sum + block.seconds, 0),
    longestFocusSeconds: focusBlocks.reduce((max, block) => Math.max(max, block.seconds), 0),
    focusBlockCount: focusBlocks.length,
    deepBlockCount: deepBlocks.length,
    deepSeconds: deepBlocks.reduce((sum, block) => sum + block.seconds, 0),
    deepStartHours: deepBlocks.map(block => new Date(block.start).getHours()),
    interruptionCount,
    interruptionSeconds,
    fragmentCount,
    fragmentSeconds,
    switchCount,
    topInterruptions: Array.from(interruptions.entries())
      .map(([app, value]) => ({ app, ...value }))
      .sort((a, b) => b.seconds - a.seconds || b.count - a.count)
      .slice(0, 5),
  }
}

function ruleIssues(rules: ClassificationRule[]): number {
  const emptyRules = rules.filter(rule => rule.enabled && rule.appKeywords.length + rule.titleKeywords.length === 0).length
  return emptyRules + findClassificationRuleConflicts(rules).length
}

/** Build a deterministic efficiency overview from Moji's own activity records. */
export function buildLocalEfficiencyReport(
  activities: Activity[],
  period: EfficiencyPeriod,
  now = new Date(),
  classificationRules: ClassificationRule[] = [],
): AwReportData {
  const { start, end } = periodBounds(period, now)
  const selected = activities.filter(activity => {
    const timestamp = Date.parse(activity.timestamp)
    return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp < end.getTime()
  })
  const previousBounds = previousPeriodBounds(start, end)
  const previousSelected = activities.filter(activity => {
    const timestamp = Date.parse(activity.timestamp)
    return Number.isFinite(timestamp)
      && timestamp >= previousBounds.start.getTime()
      && timestamp < previousBounds.end.getTime()
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
  const focus = analyzeFocusPatterns(selected)
  const previousHasDuration = previousSelected.some(activity => (activity.durationSeconds ?? 0) > 0)
  const previousTotalUnits = weightedUnits(previousSelected, previousHasDuration)
  const previousProductiveUnits = weightedUnits(
    previousSelected.filter(activity => activity.category === 'dev' || activity.category === 'doc'),
    previousHasDuration,
  )
  const previousTotalSeconds = previousSelected.reduce((sum, activity) => sum + Math.max(activity.durationSeconds ?? 0, 0), 0)
  const previousProductivePercent = previousTotalUnits > 0 ? (previousProductiveUnits / previousTotalUnits) * 100 : 0
  const previousAvailable = previousSelected.length > 0

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
  const productivePercent = selected.length > 0 ? (productiveUnits / totalUnits) * 100 : 0
  const productivePercentChange = Math.abs(productivePercent - previousProductivePercent) < 0.05
    ? 0
    : productivePercent - previousProductivePercent
  const unclassifiedUnits = categoryUnits.get('unclassified') ?? 0
  const classifiedUnits = Math.max(totalUnits - unclassifiedUnits, 0)

  const unclassifiedGroups = new Map<string, { app: string; title: string; units: number }>()
  for (const activity of selected.filter(item => item.category === 'unclassified')) {
    const key = `${activity.app}\u0000${activity.title}`
    const units = hasDuration ? Math.max(activity.durationSeconds ?? 0, 0) : 1
    const current = unclassifiedGroups.get(key)
    if (current) current.units += units
    else unclassifiedGroups.set(key, { app: activity.app, title: activity.title, units })
  }
  const ruleSuggestions = Array.from(unclassifiedGroups.values())
    .sort((a, b) => b.units - a.units)
    .slice(0, 5)
    .map(item => ({
      source: item.app,
      value: item.title || item.app,
      expected_seconds: hasDuration ? item.units : undefined,
      confidence: 'needs_confirmation',
    }))

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
    const dayClassifiedUnits = weightedUnits(
      day.filter(activity => activity.category !== 'unclassified'),
      dayHasDuration,
    )
    return {
      date: key,
      pulse: localScore(day, dayHasDuration),
      active_seconds: day.reduce((sum, activity) => sum + Math.max(activity.durationSeconds ?? 0, 0), 0),
      productive_percent: dayTotalUnits > 0 ? (dayProductiveUnits / dayTotalUnits) * 100 : 0,
      coverage_percent: dayTotalUnits > 0 ? (dayClassifiedUnits / dayTotalUnits) * 100 : 0,
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
        ...(previousAvailable ? [{
          title: `投入较上周${totalSeconds >= previousTotalSeconds ? '增加' : '减少'} ${Math.abs(percentChange(totalSeconds, previousTotalSeconds) ?? 0).toFixed(0)}%`,
          evidence: `本周期 ${Math.round(totalSeconds / 360) / 10} 小时，上周同期 ${Math.round(previousTotalSeconds / 360) / 10} 小时；专注占比变化 ${productivePercentChange > 0 ? '+' : ''}${productivePercentChange.toFixed(1)} 个百分点。`,
          action: focus.interruptionCount > 0 ? '下周先固定一段免打扰时间，再集中处理沟通消息。' : '保留当前高产时段，并为下周安排一个可验证的交付目标。',
        }] : []),
        ...(!hasDuration ? [{
          title: '当前按记录数估算',
          evidence: '这些活动没有可用的持续时长，因此占比和排行按记录条数计算。',
          action: '持续运行采集后，新记录会逐步累积停留时长。',
        }] : []),
        ...(focus.interruptionCount > 0 ? [{
          severity: 'warning',
          title: `检测到 ${focus.interruptionCount} 次专注打断`,
          evidence: `打断共占用 ${Math.round(focus.interruptionSeconds / 60)} 分钟，期间发生 ${focus.switchCount} 次应用切换。`,
          action: '查看打断来源，考虑集中处理沟通或关闭非必要通知。',
        }] : []),
        ...(unclassifiedUnits > 0 ? [{
          severity: 'warning',
          title: '仍有活动未分类',
          evidence: `${((unclassifiedUnits / totalUnits) * 100).toFixed(0)}% 的活动尚未命中规则。`,
          action: '前往时间轴的未分类收件箱，优先处理耗时最高的项目。',
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
      categorized_seconds: hasDuration ? classifiedUnits : undefined,
      uncategorized_seconds: hasDuration ? unclassifiedUnits : undefined,
      category_coverage_percent: selected.length > 0 ? (classifiedUnits / totalUnits) * 100 : 0,
      productive_percent: productivePercent,
      ai_seconds: aiSeconds,
      ai_count: aiCount,
      levels,
      categories,
      apps,
      domains: [],
      hourly,
      deep_work: {
        seconds: focus.deepSeconds,
        longest_seconds: focus.longestFocusSeconds,
        block_count: focus.deepBlockCount,
        start_hours: focus.deepStartHours,
      },
      focus_analysis: {
        focus_seconds: focus.focusSeconds,
        longest_focus_seconds: focus.longestFocusSeconds,
        focus_block_count: focus.focusBlockCount,
        deep_block_count: focus.deepBlockCount,
        interruption_count: focus.interruptionCount,
        interruption_seconds: focus.interruptionSeconds,
        fragment_count: focus.fragmentCount,
        fragment_seconds: focus.fragmentSeconds,
        switch_count: focus.switchCount,
        top_interruptions: focus.topInterruptions,
      },
    },
    comparison: {
      previous_available: previousAvailable,
      pulse_change: previousAvailable ? localScore(selected, hasDuration) - localScore(previousSelected, previousHasDuration) : null,
      active_percent_change: previousAvailable ? percentChange(totalSeconds, previousTotalSeconds) : null,
      productive_percent_change: previousAvailable ? productivePercentChange : null,
    },
    baseline: { sample_count: trend.filter(item => item.active_seconds > 0 || item.pulse > 0).length, sufficient: false },
    trend,
    insights,
    rule_health: {
      rule_count: classificationRules.filter(rule => rule.enabled).length,
      issue_count: ruleIssues(classificationRules),
      coverage_percent: selected.length > 0 ? (classifiedUnits / totalUnits) * 100 : 0,
      suggestions: ruleSuggestions,
    },
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
