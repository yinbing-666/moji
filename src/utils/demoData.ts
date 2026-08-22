import type { Activity } from '../stores/activityStore'

export const DEMO_ACTIVITY_PREFIX = 'demo-'

interface DemoSession {
  hour: number
  minute: number
  durationSeconds: number
  category: Activity['category']
  app: string
  title: string
  description: string
}

const WORKDAY_SESSIONS: DemoSession[] = [
  { hour: 9, minute: 5, durationSeconds: 2100, category: 'doc', app: 'Obsidian', title: '墨记产品路线图', description: '整理版本目标与本周交付范围' },
  { hour: 9, minute: 45, durationSeconds: 4800, category: 'dev', app: 'Code.exe', title: 'moji-clean - Visual Studio Code', description: '实现应用内效率分析与报告渲染' },
  { hour: 11, minute: 15, durationSeconds: 540, category: 'communication', app: 'WeChat', title: '墨记项目讨论', description: '确认报告展示细节和验收范围' },
  { hour: 13, minute: 35, durationSeconds: 2400, category: 'doc', app: 'Microsoft Edge', title: 'ActivityWatch / GitHub', description: '调研本地时间追踪产品的数据结构' },
  { hour: 14, minute: 25, durationSeconds: 5700, category: 'dev', app: 'Code.exe', title: 'AwReportDashboard.tsx - Visual Studio Code', description: '完善周复盘指标和同比信息' },
  { hour: 16, minute: 10, durationSeconds: 2100, category: 'meeting', app: 'TencentMeeting.exe', title: '产品复盘会', description: '演示本周版本并记录反馈' },
  { hour: 17, minute: 5, durationSeconds: 1800, category: 'unclassified', app: 'Figma.exe', title: 'Moji dashboard', description: '调整界面信息层级' },
]

function startOfWeek(date: Date): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  const weekday = result.getDay() || 7
  result.setDate(result.getDate() - weekday + 1)
  return result
}

function sessionActivity(
  weekStart: Date,
  dayOffset: number,
  session: DemoSession,
  sessionIndex: number,
  baseline: boolean,
): Activity {
  const timestamp = new Date(weekStart)
  timestamp.setDate(timestamp.getDate() + dayOffset)
  timestamp.setHours(session.hour, session.minute, 0, 0)
  const dayKey = timestamp.toISOString().slice(0, 10)
  return {
    id: `${DEMO_ACTIVITY_PREFIX}${baseline ? 'baseline' : 'current'}-${dayKey}-${sessionIndex}`,
    timestamp: timestamp.toISOString(),
    category: session.category,
    app: session.app,
    title: session.title,
    description: session.description,
    durationSeconds: Math.round(session.durationSeconds * (baseline ? 0.88 : 1)),
  }
}

/** 生成当前工作周，并附带上周同期作为同比基线。 */
export function createDemoWeek(now = new Date()): Activity[] {
  const currentWeek = startOfWeek(now)
  const previousWeek = new Date(currentWeek)
  previousWeek.setDate(previousWeek.getDate() - 7)
  const weekdayIndex = Math.min(Math.max((now.getDay() || 7) - 1, 0), 4)
  const activities: Activity[] = []

  for (let dayOffset = 0; dayOffset <= weekdayIndex; dayOffset++) {
    WORKDAY_SESSIONS.forEach((session, index) => {
      activities.push(sessionActivity(currentWeek, dayOffset, session, index, false))
      activities.push(sessionActivity(previousWeek, dayOffset, session, index, true))
    })
  }

  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const liveSessions: Array<DemoSession & { minutesAgo: number }> = [
    { minutesAgo: 90, hour: 0, minute: 0, durationSeconds: 3300, category: 'dev', app: 'Code.exe', title: 'moji-clean - Visual Studio Code', description: '完成首次引导和演示数据模式' },
    { minutesAgo: 20, hour: 0, minute: 0, durationSeconds: 900, category: 'doc', app: 'Obsidian', title: '墨记阶段复盘', description: '记录本轮验证结果与下一步计划' },
  ]
  liveSessions.forEach((session, index) => {
    const timestamp = new Date(Math.max(todayStart.getTime(), now.getTime() - session.minutesAgo * 60_000))
    const baselineTimestamp = new Date(timestamp)
    baselineTimestamp.setDate(baselineTimestamp.getDate() - 7)
    const current = sessionActivity(timestamp, 0, { ...session, hour: timestamp.getHours(), minute: timestamp.getMinutes() }, 100 + index, false)
    const baseline = sessionActivity(baselineTimestamp, 0, { ...session, hour: baselineTimestamp.getHours(), minute: baselineTimestamp.getMinutes() }, 100 + index, true)
    current.id = `${DEMO_ACTIVITY_PREFIX}current-live-${index}`
    baseline.id = `${DEMO_ACTIVITY_PREFIX}baseline-live-${index}`
    activities.push(current, baseline)
  })

  return activities.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
}

export function isDemoActivity(activity: Pick<Activity, 'id'>): boolean {
  return activity.id.startsWith(DEMO_ACTIVITY_PREFIX)
}
