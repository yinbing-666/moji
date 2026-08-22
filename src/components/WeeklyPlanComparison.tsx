import { useEffect, useMemo, useState } from 'react'
import type { Activity } from '../stores/activityStore'
import { categoryVisual } from '../utils/categoryStyles'
import { localDateKey } from '../utils/date'
import { dbLoadWeeklyPlan, dbSaveWeeklyPlan } from '../utils/db'
import { formatDuration } from '../utils/format'

const PLAN_CATEGORIES: Activity['category'][] = ['dev', 'doc', 'meeting', 'communication', 'other']
const STORAGE_KEY = 'moji-weekly-plans-v1'

type Targets = Record<string, number>

function currentWeekStart(now = new Date()): Date {
  const result = new Date(now)
  result.setHours(0, 0, 0, 0)
  const day = result.getDay() || 7
  result.setDate(result.getDate() - day + 1)
  return result
}

function loadLocalPlan(weekStart: string): Targets {
  try {
    const plans = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Targets>
    return plans[weekStart] ?? {}
  } catch {
    return {}
  }
}

function saveLocalPlan(weekStart: string, targets: Targets) {
  try {
    const plans = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Targets>
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...plans, [weekStart]: targets }))
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [weekStart]: targets }))
  }
}

export function WeeklyPlanComparison({ activities }: { activities: Activity[] }) {
  const weekStartDate = useMemo(() => currentWeekStart(), [])
  const weekStart = localDateKey(weekStartDate)
  const weekEnd = useMemo(() => {
    const result = new Date(weekStartDate)
    result.setDate(result.getDate() + 7)
    return result
  }, [weekStartDate])
  const [targets, setTargets] = useState<Targets>(() => loadLocalPlan(weekStart))
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void dbLoadWeeklyPlan(weekStart).then(item => {
      if (!item || cancelled) return
      try {
        const parsed = JSON.parse(item.targets_json) as Targets
        setTargets(parsed)
        saveLocalPlan(weekStart, parsed)
      } catch {
        // 保留本地降级数据。
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [weekStart])

  const actual = useMemo(() => {
    const values: Targets = {}
    const start = weekStartDate.getTime()
    const end = weekEnd.getTime()
    for (const activity of activities) {
      const timestamp = Date.parse(activity.timestamp)
      if (timestamp < start || timestamp >= end) continue
      values[activity.category] = (values[activity.category] ?? 0) + Math.max(0, activity.durationSeconds ?? 0)
    }
    return values
  }, [activities, weekEnd, weekStartDate])

  const plannedSeconds = Object.values(targets).reduce((sum, minutes) => sum + Math.max(0, minutes) * 60, 0)
  const actualSeconds = PLAN_CATEGORIES.reduce((sum, category) => sum + (actual[category] ?? 0), 0)
  const overallPercent = plannedSeconds > 0 ? Math.round(actualSeconds / plannedSeconds * 100) : 0

  const save = () => {
    saveLocalPlan(weekStart, targets)
    void dbSaveWeeklyPlan({
      weekStart,
      targetsJson: JSON.stringify(targets),
      updatedAt: new Date().toISOString(),
    }).catch(() => {})
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1600)
  }

  return (
    <section className="mb-6 rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h3 font-semibold text-ink">本周计划与实际</h2>
          <p className="mt-1 text-xs text-ink-muted">{weekStart} 开始 · 实际 {formatDuration(actualSeconds) || '0 分钟'} / 计划 {formatDuration(plannedSeconds) || '未设置'}</p>
        </div>
        <div className="text-right">
          <p className="text-h2 font-bold tabular-nums text-accent-ink">{plannedSeconds > 0 ? `${overallPercent}%` : '—'}</p>
          <p className="mt-1 text-xs text-ink-muted">总体完成度</p>
        </div>
      </div>

      <div className="space-y-3">
        {PLAN_CATEGORIES.map(category => {
          const visual = categoryVisual(category)
          const planned = Math.max(0, targets[category] ?? 0)
          const seconds = actual[category] ?? 0
          const percent = planned > 0 ? Math.min(100, Math.round(seconds / (planned * 60) * 100)) : 0
          return (
            <div key={category} className="grid items-center gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_7rem]">
              <span className="text-sm font-medium text-ink-muted">{visual.label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-sunken">
                <div className="h-full" style={{ width: `${percent}%`, backgroundColor: visual.color }} />
              </div>
              <label className="flex items-center justify-end gap-1 text-xs text-ink-muted">
                <input
                  type="number"
                  min="0"
                  max="10080"
                  step="30"
                  value={planned || ''}
                  onChange={event => setTargets(current => ({
                    ...current,
                    [category]: Math.max(0, Number(event.target.value) || 0),
                  }))}
                  aria-label={`${visual.label}计划分钟`}
                  className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1 text-right text-xs text-ink focus:border-accent focus:outline-none"
                />
                分钟
              </label>
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex justify-end">
        <button type="button" onClick={save} className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-muted hover:border-accent hover:text-accent-ink">
          {saved ? '已保存' : '保存本周计划'}
        </button>
      </div>
    </section>
  )
}
