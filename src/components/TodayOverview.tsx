import { useMemo, useState } from 'react'
import type { Activity } from '../stores/activityStore'
import { categoryVisual } from '../utils/categoryStyles'
import { formatDuration } from '../utils/format'
import { localDateKey } from '../utils/date'

function isToday(iso: string) {
  return localDateKey(iso) === localDateKey(new Date())
}

interface TodayOverviewProps {
  activities: Activity[]
}

export function TodayOverview({ activities }: TodayOverviewProps) {
  const [timelineMinutes, setTimelineMinutes] = useState<15 | 30>(30)
  const todayActivities = useMemo(() => activities.filter(a => isToday(a.timestamp)), [activities])
  
  const stats = useMemo(() => {
    const todayCount = todayActivities.length
    const yesterdayCount = activities.filter(a => {
      const d = new Date(a.timestamp)
      const y = new Date()
      y.setDate(y.getDate() - 1)
      return localDateKey(d) === localDateKey(y)
    }).length
    
    // 主要应用：出现次数最多的
    const appCounts = new Map<string, number>()
    for (const a of todayActivities) {
      appCounts.set(a.app, (appCounts.get(a.app) || 0) + 1)
    }
    let topApp = ''
    let topAppCount = 0
    for (const [app, count] of appCounts.entries()) {
      if (count > topAppCount) { topApp = app; topAppCount = count }
    }

    // 主要类型
    const catCounts = new Map<string, number>()
    for (const a of todayActivities) {
      catCounts.set(a.category, (catCounts.get(a.category) || 0) + 1)
    }
    let topCat: Activity['category'] = 'other'
    let topCatCount = 0
    for (const [cat, count] of catCounts.entries()) {
      if (count > topCatCount) { topCat = cat as Activity['category']; topCatCount = count }
    }

    // 今日记录的总时长（有 durationSeconds 的记录求和；AW 源为事件时长，UIA 源为累计停留）
    const totalSeconds = todayActivities.reduce((sum, a) => sum + (a.durationSeconds ?? 0), 0)

    return { todayCount, yesterdayCount, topApp, topAppCount, topCat, topCatCount, totalSeconds }
  }, [todayActivities])

  /* 时间轴数据：按 30/15 分钟聚合，同时缓存主要分类和具体活动摘要。 */
  const timelineBuckets = useMemo(() => {
    const bucketCount = (24 * 60) / timelineMinutes
    const counts: number[] = Array.from({ length: bucketCount }, () => 0)
    const catCounts: Map<Activity['category'], number>[] = Array.from({ length: bucketCount }, () => new Map())
    const details: string[][] = Array.from({ length: bucketCount }, () => [])
    for (const a of todayActivities) {
      const date = new Date(a.timestamp)
      const bucket = Math.floor((date.getHours() * 60 + date.getMinutes()) / timelineMinutes)
      counts[bucket]++
      catCounts[bucket].set(a.category, (catCounts[bucket].get(a.category) || 0) + 1)
      const detail = a.title && a.title !== a.app ? `${a.app} · ${a.title}` : a.app
      if (!details[bucket].includes(detail)) details[bucket].push(detail)
    }
    const dominant = catCounts.map(counts2 => {
      let best: Activity['category'] | null = null
      let bestCount = 0
      for (const [cat, c] of counts2) {
        if (c > bestCount) { best = cat; bestCount = c }
      }
      return best
    })
    return { counts, dominant, details }
  }, [timelineMinutes, todayActivities])

  /* P1优化: 分类分布 */
  const categoryDistribution = useMemo(() => {
    const map = new Map<Activity['category'], number>()
    for (const a of todayActivities) {
      map.set(a.category, (map.get(a.category) || 0) + 1)
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [todayActivities])

  const topCatVisual = categoryVisual(stats.topCat)
  const totalDurationText = formatDuration(stats.totalSeconds)

  /* 统计卡：今日总时长为主指标（深色英雄卡），应用/类型为次级 */
  return (
    <>
      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        {/* 今日总时长 - 品牌色主指标卡（页面唯一强色，克制而聚焦） */}
        <div className="rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50/70 to-white p-5 shadow-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs font-medium text-brand-700">今日投入</p>
            </div>
            <span className="rounded-full bg-white px-2 py-0.5 text-2xs tabular-nums text-gray-500 ring-1 ring-brand-100">{stats.todayCount} 条记录</span>
          </div>
          <p className="mt-2 text-h2 font-bold tabular-nums text-brand-700">
            {totalDurationText ?? '—'}
            {!totalDurationText && <span className="ml-1 text-sm font-normal text-gray-400">暂无时长数据</span>}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            较昨日 <span className="text-gray-600">{stats.yesterdayCount}</span> 条
          </p>
        </div>

        {/* 主要应用 - 使用标准卡片（层级2） */}
        <div className="rounded-xl border border-gray-200/60 bg-white p-4 shadow-card transition-shadow hover:shadow-elevated">
          <div className="flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V9m4 8V5m4 12v-6M4 21h16a1 1 0 001-1V4a1 1 0 00-1-1H4a1 1 0 00-1 1v16a1 1 0 001 1z" />
            </svg>
            <p className="text-xs font-medium text-gray-500">主要应用</p>
          </div>
          <p className="mt-1.5 truncate text-lg font-semibold text-gray-900">{stats.topApp || '-'}</p>
          <p className="mt-1 text-xs text-gray-400">{stats.topAppCount} 条记录</p>
        </div>

        {/* 主要类型 - 带分类色标识 */}
        <div className="rounded-xl border border-gray-200/60 bg-white p-4 shadow-card transition-shadow hover:shadow-elevated">
          <div className="flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <p className="text-xs font-medium text-gray-500">主要类型</p>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: topCatVisual.hex }} />
            <p className="truncate text-lg font-semibold text-gray-900">{topCatVisual.label}</p>
          </div>
          <p className="mt-1 text-xs text-gray-400">{stats.topCatCount} 条记录</p>
        </div>
      </section>

      {/* P1优化: 时间轴容器 - 使用轻量样式（层级3） */}
      <section className="mb-6 rounded-xl border border-gray-200/60 bg-white p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-h3 font-semibold text-gray-900">今日时间轴</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">共 {todayActivities.length} 条记录</span>
            <div className="flex rounded-md border border-gray-200 bg-gray-50 p-0.5" aria-label="时间轴粒度">
              {([30, 15] as const).map(minutes => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => setTimelineMinutes(minutes)}
                  aria-pressed={timelineMinutes === minutes}
                  className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    timelineMinutes === minutes
                      ? 'bg-white text-gray-800 shadow-sm'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {minutes} 分钟
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 对数缩放让低频活动也可辨；15 分钟模式在窄屏横向滚动。 */}
        <div className="overflow-x-auto pb-1">
          <div
            className="flex h-16 items-end gap-0.5 overflow-hidden"
            style={{ minWidth: timelineMinutes === 15 ? '720px' : '420px' }}
          >
            {timelineBuckets.counts.map((count, i) => {
              const hasActivity = count > 0
              const dominantCat = timelineBuckets.dominant[i]
              const visual = dominantCat ? categoryVisual(dominantCat) : null
              const maxCount = Math.max(...timelineBuckets.counts, 1)
              const ratio = Math.log(count + 1) / Math.log(maxCount + 1)
              const startMinutes = i * timelineMinutes
              const timeLabel = `${String(Math.floor(startMinutes / 60)).padStart(2, '0')}:${String(startMinutes % 60).padStart(2, '0')}`
              const detailText = timelineBuckets.details[i].slice(0, 3).join('、')
              const title = `${timeLabel} · ${count} 条${visual ? ` · ${visual.label}` : ''}${detailText ? `\n${detailText}` : ''}`
              return (
                <div
                  key={i}
                  title={title}
                  className={`min-w-[4px] flex-1 rounded-t transition-opacity ${
                    hasActivity
                      ? 'opacity-100 hover:opacity-75'
                      : 'bg-gray-100 opacity-20'
                  }`}
                  style={{
                    height: `${Math.max(ratio * 100, count > 0 ? 8 : 0)}%`,
                    backgroundColor: visual?.hex || undefined,
                  }}
                />
              )
            })}
          </div>
        </div>

        {/* 时间标签 - 5 个刻度均分,避免窄容器挤压溢出 */}
        <div className="mt-2 flex justify-between text-[10px] tabular-nums text-gray-400">
          <span className="whitespace-nowrap">00:00</span>
          <span className="whitespace-nowrap">06:00</span>
          <span className="whitespace-nowrap">12:00</span>
          <span className="whitespace-nowrap">18:00</span>
          <span className="whitespace-nowrap">24:00</span>
        </div>
      </section>

      {/* P1优化: 分类分布 - 使用左侧色条强调（差异化设计） */}
      {categoryDistribution.length > 0 && (
        <section className="mb-6 border-l-4 border-l-brand-500 bg-white rounded-r-xl p-4 shadow-card">
          <h2 className="text-h3 font-semibold text-gray-900 mb-3">分类分布</h2>
          
          {/* 分布条 */}
          <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-gray-100 flex">
            {categoryDistribution.map(([cat, count]) => {
              const visual = categoryVisual(cat)
              const pct = Math.round((count / todayActivities.length) * 100)
              return (
                <div
                  key={cat}
                  style={{ width: `${pct}%`, backgroundColor: visual.hex }}
                  className="first:rounded-l-full last:rounded-r-full"
                  title={`${visual.label}: ${count} (${pct}%)`}
                />
              )
            })}
          </div>

          {/* 图例 - 使用新的莫兰迪色系 */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {categoryDistribution.map(([cat, count]) => {
              const visual = categoryVisual(cat)
              const pct = Math.round((count / todayActivities.length) * 100)
              return (
                <button
                  key={cat}
                  type="button"
                  className="inline-flex items-center gap-1.5 hover:opacity-70 transition-opacity"
                >
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: visual.hex }} />
                  <span className="text-gray-700">{visual.label}</span>
                  <span className="tabular-nums text-gray-400">{count} · {pct}%</span>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </>
  )
}
