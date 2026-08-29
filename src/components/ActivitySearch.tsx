import { useEffect, useMemo, useState } from 'react'
import type { Activity } from '../stores/activityStore'
import { categoryVisual } from '../utils/categoryStyles'
import { dbSearchActivities, type DbActivity } from '../utils/db'
import { parseSearchQuery, type ParsedSearchQuery } from '../utils/searchQuery'

interface ActivitySearchProps {
  activities: Activity[]
}

function mapDbActivity(item: DbActivity): Activity {
  return {
    id: item.id,
    timestamp: item.timestamp,
    category: item.category as Activity['category'],
    app: item.app_name,
    title: item.title ?? '',
    description: item.description,
    ...(item.screenshot_base64 ? { screenshotBase64: item.screenshot_base64 } : {}),
    ...(item.duration_seconds !== null && item.duration_seconds !== undefined ? { durationSeconds: item.duration_seconds } : {}),
    ...(item.browser_domain ? { browserDomain: item.browser_domain } : {}),
    ...(item.ide_project ? { ideProject: item.ide_project } : {}),
  }
}

function matchesFallback(activity: Activity, parsed: ParsedSearchQuery): boolean {
  const timestamp = Date.parse(activity.timestamp)
  if (parsed.startAt && timestamp < Date.parse(parsed.startAt)) return false
  if (parsed.endAt && timestamp >= Date.parse(parsed.endAt)) return false
  if (!parsed.query) return true
  const keyword = parsed.query.toLowerCase()
  return [activity.app, activity.title, activity.description, activity.browserDomain, activity.ideProject]
    .filter(Boolean)
    .some(value => value!.toLowerCase().includes(keyword))
}

export function ActivitySearch({ activities }: ActivitySearchProps) {
  const [input, setInput] = useState('本周')
  const [parsed, setParsed] = useState(() => parseSearchQuery('本周'))
  const [results, setResults] = useState<Activity[]>([])
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState<'sqlite' | 'memory'>('memory')

  const fallback = useMemo(
    () => activities.filter(activity => matchesFallback(activity, parsed)).slice(0, 200),
    [activities, parsed],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void dbSearchActivities({
      query: parsed.query,
      startAt: parsed.startAt,
      endAt: parsed.endAt,
      limit: 200,
    }).then(items => {
      if (cancelled) return
      if (items) {
        setResults(items.map(mapDbActivity))
        setSource('sqlite')
      } else {
        setResults(fallback)
        setSource('memory')
      }
    }).catch(() => {
      if (!cancelled) {
        setResults(fallback)
        setSource('memory')
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [fallback, parsed])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setParsed(parseSearchQuery(input))
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h2 font-semibold text-ink">活动回溯</h1>
          <p className="mt-1 text-sm text-ink-muted">{source === 'sqlite' ? '本地 SQLite' : '当前会话'} · {results.length} 条结果</p>
        </div>
        {parsed.rangeLabel && <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-ink">{parsed.rangeLabel}</span>}
      </div>

      <form onSubmit={submit} className="mb-6 flex gap-2">
        <input
          type="search"
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder="搜索昨天处理过的内容"
          aria-label="搜索本地活动"
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
        />
        <button type="submit" className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover">
          搜索
        </button>
      </form>

      <div className="divide-y divide-line border-y border-line">
        {loading && <p className="py-8 text-center text-sm text-ink-muted">正在检索…</p>}
        {!loading && results.length === 0 && <p className="py-8 text-center text-sm text-ink-muted">没有匹配的本地活动</p>}
        {!loading && results.map(activity => {
          const visual = categoryVisual(activity.category)
          return (
            <article key={activity.id} className="grid gap-2 py-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <div className="text-xs text-ink-muted">
                <p>{new Date(activity.timestamp).toLocaleDateString('zh-CN')}</p>
                <p className="mt-0.5">{new Date(activity.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ backgroundColor: visual.soft, color: visual.color }}
                  >
                    {visual.label}
                  </span>
                  <span className="truncate text-sm font-medium text-ink">{activity.app}</span>
                </div>
                <p className="mt-1 break-words text-sm text-ink-muted">{activity.title || activity.description}</p>
                {activity.title && activity.description !== activity.title && <p className="mt-1 break-words text-xs leading-5 text-ink-muted">{activity.description}</p>}
                {(activity.browserDomain || activity.ideProject) && (
                  <p className="mt-2 flex flex-wrap gap-2 text-xs text-ink-muted">
                    {activity.browserDomain && <span>域名：{activity.browserDomain}</span>}
                    {activity.ideProject && <span>项目：{activity.ideProject}</span>}
                  </p>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
