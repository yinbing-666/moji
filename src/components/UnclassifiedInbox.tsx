import { useMemo, useState } from 'react'
import { useActivityStore, type Activity } from '../stores/activityStore'
import { categoryVisual } from '../utils/categoryStyles'
import { createClassificationRule, RULE_CATEGORIES, type RuleCategory } from '../utils/classificationRules'
import { formatDuration } from '../utils/format'

interface InboxGroup {
  key: string
  app: string
  title: string
  activities: Activity[]
  seconds: number
}

const GENERIC_APPS = /chrome|msedge|edge|firefox|brave|opera|safari|explorer/i

function suggestedKeywords(group: InboxGroup): { app: string; title: string; label: string } {
  if (GENERIC_APPS.test(group.app) && group.title.trim()) {
    const title = group.title.split(/\s[-—|]\s/)[0].trim().slice(0, 80)
    return { app: '', title, label: `标题包含“${title}”` }
  }
  return { app: group.app, title: '', label: `应用名包含“${group.app}”` }
}

export function UnclassifiedInbox({ activities }: { activities: Activity[] }) {
  const { settings, updateSettings, updateActivitiesCategory } = useActivityStore()
  const [open, setOpen] = useState(false)
  const [categories, setCategories] = useState<Record<string, RuleCategory>>({})

  const groups = useMemo(() => {
    const grouped = new Map<string, InboxGroup>()
    for (const activity of activities) {
      if (activity.category !== 'unclassified') continue
      const key = `${activity.app}\u0000${activity.title}`
      const current = grouped.get(key)
      if (current) {
        current.activities.push(activity)
        current.seconds += Math.max(activity.durationSeconds ?? 0, 0)
      } else {
        grouped.set(key, {
          key,
          app: activity.app,
          title: activity.title,
          activities: [activity],
          seconds: Math.max(activity.durationSeconds ?? 0, 0),
        })
      }
    }
    return Array.from(grouped.values()).sort((a, b) => b.seconds - a.seconds || b.activities.length - a.activities.length)
  }, [activities])

  const totalActivities = groups.reduce((sum, group) => sum + group.activities.length, 0)
  const totalSeconds = groups.reduce((sum, group) => sum + group.seconds, 0)
  if (totalActivities === 0) return null

  const classify = (group: InboxGroup, remember: boolean) => {
    const category = categories[group.key] ?? 'other'
    updateActivitiesCategory(group.activities.map(activity => activity.id), category)
    if (!remember) return
    const keywords = suggestedKeywords(group)
    const rule = createClassificationRule(category, keywords.app, keywords.title)
    rule.name = `${keywords.app || keywords.title} → ${categoryVisual(category).label}`
    updateSettings({ classificationRules: [...settings.classificationRules, rule] })
  }

  return (
    <section className="mb-4 border-y border-amber-200 bg-amber-50/50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">未分类收件箱</h2>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{totalActivities} 条</span>
          </div>
          <p className="mt-1 text-xs text-gray-600">
            {groups.length} 组未命中规则的活动{totalSeconds > 0 ? `，共 ${formatDuration(totalSeconds)}` : ''}。优先处理耗时最长的项目。
          </p>
        </div>
        <button type="button" onClick={() => setOpen(value => !value)} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50">
          {open ? '收起' : '开始整理'}
        </button>
      </div>

      {open && (
        <div className="mt-3 divide-y divide-amber-200 border-t border-amber-200">
          {groups.slice(0, 30).map(group => {
            const category = categories[group.key] ?? 'other'
            const suggestion = suggestedKeywords(group)
            return (
              <div key={group.key} className="grid gap-2 py-3 lg:grid-cols-[minmax(0,1fr)_130px_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-medium text-gray-800">{group.app}</span>
                    <span className="text-xs tabular-nums text-gray-500">{group.activities.length} 条{group.seconds > 0 ? ` · ${formatDuration(group.seconds)}` : ''}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-500" title={group.title}>{group.title || '无窗口标题'}</p>
                  <p className="mt-1 text-[11px] text-amber-700">记住后：{suggestion.label}</p>
                </div>
                <select
                  value={category}
                  onChange={event => setCategories(current => ({ ...current, [group.key]: event.target.value as RuleCategory }))}
                  aria-label={`为 ${group.app} 选择分类`}
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
                >
                  {RULE_CATEGORIES.map(item => <option key={item} value={item}>{categoryVisual(item).label}</option>)}
                </select>
                <div className="flex items-center gap-2 lg:justify-end">
                  <button type="button" onClick={() => classify(group, false)} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400">
                    仅归类
                  </button>
                  <button type="button" onClick={() => classify(group, true)} className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
                    归类并记住
                  </button>
                </div>
              </div>
            )
          })}
          {groups.length > 30 && <p className="py-3 text-center text-xs text-gray-500">先显示耗时最高的 30 组，处理后会继续显示其余项目。</p>}
        </div>
      )}
    </section>
  )
}
