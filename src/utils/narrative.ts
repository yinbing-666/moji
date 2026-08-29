import type { Activity } from '../stores/activityStore'
import type { ActivityCategory } from './classificationRules'

export interface NarrativeSummary {
  totalSeconds: number
  totalMinutes: number
  activeRange: {
    start: string
    end: string
    totalSeconds: number
  } | null
  longestFocus: {
    app: string
    category: ActivityCategory
    start: string
    end: string
    seconds: number
  } | null
  mainThread: {
    category: ActivityCategory
    share: number
    app: string
    appSeconds: number
  } | null
  topApps: Array<{ app: string; seconds: number }>
  categoryRatio: Partial<Record<ActivityCategory, number>>
  distinctApps: number
}

interface ActivityInterval {
  activity: Activity
  startMs: number
  endMs: number
}

interface MergedInterval {
  startMs: number
  endMs: number
}

const MAX_INFERRED_SECONDS = 300

function isValidDate(date: Date): boolean {
  return Number.isFinite(date.getTime())
}

function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

function mergeIntervals(intervals: ActivityInterval[] | MergedInterval[]): MergedInterval[] {
  const sorted = intervals
    .filter((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs))
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)

  const merged: MergedInterval[] = []

  for (const interval of sorted) {
    const previous = merged[merged.length - 1]

    if (!previous || interval.startMs > previous.endMs) {
      merged.push({
        startMs: interval.startMs,
        endMs: interval.endMs,
      })
    } else if (interval.endMs > previous.endMs) {
      previous.endMs = interval.endMs
    }
  }

  return merged
}

function sumIntervals(intervals: MergedInterval[]): number {
  return intervals.reduce((total, interval) => {
    return total + (interval.endMs - interval.startMs) / 1000
  }, 0)
}

function groupBy<T>(items: T[], keySelector: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()

  for (const item of items) {
    const key = keySelector(item)
    const group = groups.get(key)

    if (group) {
      group.push(item)
    } else {
      groups.set(key, [item])
    }
  }

  return groups
}

function getFocusSegments(intervals: ActivityInterval[]): ActivityInterval[][] {
  const sorted = [...intervals].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
  )
  const segments: ActivityInterval[][] = []

  for (const interval of sorted) {
    const current = segments[segments.length - 1]

    if (!current) {
      segments.push([interval])
      continue
    }

    const currentEnd = Math.max(...current.map((item) => item.endMs))
    if (interval.startMs - currentEnd <= MAX_INFERRED_SECONDS * 1000) {
      current.push(interval)
    } else {
      segments.push([interval])
    }
  }

  return segments
}

function getSegmentSummary(segment: ActivityInterval[]): {
  startMs: number
  endMs: number
  seconds: number
  activity: ActivityInterval
} {
  const merged = mergeIntervals(segment)
  const startMs = merged[0].startMs
  const endMs = merged[merged.length - 1].endMs
  const segmentSeconds = sumIntervals(merged)

  let selected = segment[0]
  let selectedSeconds = -1

  for (const item of segment) {
    const contribution = sumIntervals(
      mergeIntervals([
        {
          startMs: Math.max(item.startMs, startMs),
          endMs: Math.min(item.endMs, endMs),
        },
      ]),
    )

    if (contribution > selectedSeconds) {
      selected = item
      selectedSeconds = contribution
    }
  }

  return {
    startMs,
    endMs,
    seconds: segmentSeconds,
    activity: selected,
  }
}

export function isToday(iso: string, now: Date = new Date()): boolean {
  const date = new Date(iso)
  return isValidDate(date) && isValidDate(now) && date.toDateString() === now.toDateString()
}

export function computeNarrativeSummary(
  activities: Activity[],
  now: Date = new Date(),
): NarrativeSummary {
  const emptySummary: NarrativeSummary = {
    totalSeconds: 0,
    totalMinutes: 0,
    activeRange: null,
    longestFocus: null,
    mainThread: null,
    topApps: [],
    categoryRatio: {},
    distinctApps: 0,
  }

  try {
    const todayActivities = activities
      .filter((activity) => isToday(activity.timestamp, now))
      .map((activity) => ({
        activity,
        timestampMs: new Date(activity.timestamp).getTime(),
      }))
      .filter((item) => Number.isFinite(item.timestampMs))
      .sort((a, b) => a.timestampMs - b.timestampMs)

    if (
      todayActivities.length === 0 ||
      !todayActivities.some(
        ({ activity }) =>
          typeof activity.durationSeconds === 'number' &&
          Number.isFinite(activity.durationSeconds) &&
          activity.durationSeconds > 0,
      )
    ) {
      return emptySummary
    }

    const intervals: ActivityInterval[] = []

    for (let index = 0; index < todayActivities.length; index += 1) {
      const current = todayActivities[index]
      const durationSeconds = current.activity.durationSeconds ?? 0

      if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
        intervals.push({
          activity: current.activity,
          startMs: current.timestampMs,
          endMs: current.timestampMs + durationSeconds * 1000,
        })
        continue
      }

      const next = todayActivities[index + 1]
      if (!next) {
        continue
      }

      const inferredSeconds = Math.min(
        MAX_INFERRED_SECONDS,
        (next.timestampMs - current.timestampMs) / 1000,
      )

      if (inferredSeconds > 0 && Number.isFinite(inferredSeconds)) {
        intervals.push({
          activity: current.activity,
          startMs: current.timestampMs,
          endMs: current.timestampMs + inferredSeconds * 1000,
        })
      }
    }

    if (intervals.length === 0) {
      return emptySummary
    }

    const activeIntervals = mergeIntervals(intervals)
    const totalSeconds = sumIntervals(activeIntervals)

    if (!(totalSeconds > 0) || !Number.isFinite(totalSeconds)) {
      return emptySummary
    }

    const appGroups = groupBy(intervals, (interval) => interval.activity.app)
    const appSeconds = new Map<string, number>()

    for (const [app, appIntervals] of appGroups) {
      appSeconds.set(app, sumIntervals(mergeIntervals(appIntervals)))
    }

    const categoryGroups = groupBy(
      intervals,
      (interval) => interval.activity.category,
    )
    const categorySeconds = new Map<ActivityCategory, number>()
    const categoryRatio: Partial<Record<ActivityCategory, number>> = {}

    for (const [category, categoryIntervals] of categoryGroups) {
      const seconds = sumIntervals(mergeIntervals(categoryIntervals))
      categorySeconds.set(category as ActivityCategory, seconds)
      categoryRatio[category as ActivityCategory] = seconds / totalSeconds
    }

    const topApps = [...appSeconds.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([app, seconds]) => ({ app, seconds }))

    const focusByApp = new Map<string, ActivityInterval[]>()
    for (const interval of intervals) {
      const group = focusByApp.get(interval.activity.app)
      if (group) {
        group.push(interval)
      } else {
        focusByApp.set(interval.activity.app, [interval])
      }
    }

    let longestFocus: NarrativeSummary['longestFocus'] = null

    for (const appIntervals of focusByApp.values()) {
      for (const segment of getFocusSegments(appIntervals)) {
        const segmentSummary = getSegmentSummary(segment)

        if (!longestFocus || segmentSummary.seconds > longestFocus.seconds) {
          longestFocus = {
            app: segmentSummary.activity.activity.app,
            category: segmentSummary.activity.activity.category,
            start: toIso(segmentSummary.startMs),
            end: toIso(segmentSummary.endMs),
            seconds: segmentSummary.seconds,
          }
        }
      }
    }

    let mainCategory: ActivityCategory | null = null
    let mainShare = -1

    for (const [category, seconds] of categorySeconds.entries()) {
      const share = seconds / totalSeconds
      if (share > mainShare) {
        mainCategory = category
        mainShare = share
      }
    }

    let mainThread: NarrativeSummary['mainThread'] = null

    if (mainCategory !== null && Number.isFinite(mainShare)) {
      const mainCategoryApps = new Map<string, ActivityInterval[]>()

      for (const interval of intervals) {
        if (interval.activity.category !== mainCategory) {
          continue
        }

        const group = mainCategoryApps.get(interval.activity.app)
        if (group) {
          group.push(interval)
        } else {
          mainCategoryApps.set(interval.activity.app, [interval])
        }
      }

      let selectedApp = ''
      let selectedAppSeconds = -1

      for (const [app, appIntervals] of mainCategoryApps.entries()) {
        const seconds = sumIntervals(mergeIntervals(appIntervals))
        if (seconds > selectedAppSeconds) {
          selectedApp = app
          selectedAppSeconds = seconds
        }
      }

      if (selectedAppSeconds >= 0) {
        mainThread = {
          category: mainCategory,
          share: mainShare,
          app: selectedApp,
          appSeconds: selectedAppSeconds,
        }
      }
    }

    return {
      totalSeconds,
      totalMinutes: totalSeconds / 60,
      activeRange: {
        start: toIso(activeIntervals[0].startMs),
        end: toIso(activeIntervals[activeIntervals.length - 1].endMs),
        totalSeconds,
      },
      longestFocus,
      mainThread,
      topApps,
      categoryRatio,
      distinctApps: appSeconds.size,
    }
  } catch {
    return emptySummary
  }
}

function getTimePeriod(iso: string): string {
  const hour = new Date(iso).getHours()

  if (hour <= 5) return '凌晨'
  if (hour <= 11) return '上午'
  if (hour <= 13) return '中午'
  if (hour <= 17) return '下午'
  if (hour <= 22) return '晚上'
  return '深夜'
}

function getCategoryLabel(category: ActivityCategory): string {
  const labels: Record<ActivityCategory, string> = {
    dev: '开发',
    meeting: '会议',
    doc: '文档',
    communication: '沟通',
    other: '其他',
    unclassified: '未分类',
  }

  return labels[category]
}

function formatLocalTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function buildLocalTemplate(summary: NarrativeSummary): string {
  try {
    if (
      summary.mainThread &&
      summary.mainThread.share >= 0.5 &&
      summary.longestFocus &&
      summary.activeRange
    ) {
      const minutes = Math.round(summary.longestFocus.seconds / 60)
      return `${getTimePeriod(summary.activeRange.start)}主要在${getCategoryLabel(summary.mainThread.category)}，${summary.longestFocus.app} 连续 ${minutes} 分钟。`
    }

    if (summary.distinctApps >= 6) {
      return `今天在 ${summary.distinctApps} 个应用间切换，节奏较碎。`
    }

    if (summary.totalSeconds > 0) {
      if (summary.totalSeconds < 120 || !summary.activeRange) {
        return '今天还没有记录。'
      }

      return `从 ${formatLocalTime(summary.activeRange.start)} 到 ${formatLocalTime(summary.activeRange.end)}，共 ${Math.round(summary.totalSeconds / 60)} 分钟。`
    }

    return '今天还没有记录。'
  } catch {
    return '今天还没有记录。'
  }
}
