import { useMemo } from 'react'
import type { Activity } from '../stores/activityStore'
import { categoryVisual } from '../utils/categoryStyles'
import { formatDuration } from '../utils/format'
import { NarrativeCard } from './NarrativeCard'

function isToday(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString()
}

interface TodayOverviewProps {
  activities: Activity[]
}

export function TodayOverview({ activities }: TodayOverviewProps) {
  const todayActivities = useMemo(() => activities.filter(a => isToday(a.timestamp)), [activities])
  
  const stats = useMemo(() => {
    const todayCount = todayActivities.length
    const yesterdayCount = activities.filter(a => {
      const d = new Date(a.timestamp)
      const y = new Date()
      y.setDate(y.getDate() - 1)
      return d.toDateString() === y.toDateString()
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

  /* P1优化: 时间轴数据 - 按小时聚合（同时统计每小时的主要分类，避免渲染时反复查找） */
  const hourlyBuckets = useMemo(() => {
    const counts: number[] = Array.from({ length: 24 }, () => 0)
    const catCounts: Map<Activity['category'], number>[] = Array.from({ length: 24 }, () => new Map())
    for (const a of todayActivities) {
      const h = new Date(a.timestamp).getHours()
      counts[h]++
      catCounts[h].set(a.category, (catCounts[h].get(a.category) || 0) + 1)
    }
    const dominant = catCounts.map(counts2 => {
      let best: Activity['category'] | null = null
      let bestCount = 0
      for (const [cat, c] of counts2) {
        if (c > bestCount) { best = cat; bestCount = c }
      }
      return best
    })
    return { counts, dominant }
  }, [todayActivities])

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

  /* 统计卡：三张同一容器，层级只由数值字号与颜色承载；强调色仅给主指标数值本身 */
  return (
    <>
      <NarrativeCard activities={activities} />
      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        {/* 今日总时长 - 主指标，页面唯一的强调色数值 */}
        <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs font-medium text-ink-muted">今日投入</p>
            </div>
            <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-2xs tabular-nums text-ink-muted">{stats.todayCount} 条记录</span>
          </div>
          <p className="mt-2 text-h2 font-bold tabular-nums text-accent-ink">
            {totalDurationText ?? '—'}
            {!totalDurationText && <span className="ml-1 text-sm font-normal text-ink-faint">暂无时长数据</span>}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            较昨日 <span className="text-ink-muted">{stats.yesterdayCount}</span> 条
          </p>
        </div>

        {/* 主要应用 - 次级指标 */}
        <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <div className="flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V9m4 8V5m4 12v-6M4 21h16a1 1 0 001-1V4a1 1 0 00-1-1H4a1 1 0 00-1 1v16a1 1 0 001 1z" />
            </svg>
            <p className="text-xs font-medium text-ink-muted">主要应用</p>
          </div>
          <p className="mt-2 truncate text-h3 font-semibold text-ink">{stats.topApp || '—'}</p>
          <p className="mt-1 text-xs text-ink-faint">{stats.topAppCount} 条记录</p>
        </div>

        {/* 主要类型 - 次级指标，分类身份用圆点表达 */}
        <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <div className="flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <p className="text-xs font-medium text-ink-muted">主要类型</p>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: topCatVisual.color }} />
            <p className="truncate text-h3 font-semibold text-ink">{topCatVisual.label}</p>
          </div>
          <p className="mt-1 text-xs text-ink-faint">{stats.topCatCount} 条记录</p>
        </div>
      </section>

      {/* 今日时间轴：24 小时活动密度 */}
      <section className="mb-6 rounded-xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-h3 font-semibold text-ink">今日时间轴</h2>
          <span className="text-xs text-ink-faint">共 {todayActivities.length} 条记录</span>
        </div>

        {todayActivities.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-faint">今天还没有记录，采集开启后这里会按小时显示活动密度</p>
        ) : (
          <>
            {/* 柱状图 - 对数缩放,小柱子也可辨;底部基线让稀疏数据仍读作坐标轴而非空白。
                基线取 ink-faint/70：border-line 在两个主题下都只有 1.2–1.4:1，实测不可见 */}
            <div className="flex h-16 items-end gap-0.5 overflow-hidden border-b border-ink-faint/70">
              {hourlyBuckets.counts.map((count, i) => {
                const dominantCat = hourlyBuckets.dominant[i]
                const visual = dominantCat ? categoryVisual(dominantCat) : null
                const maxCount = Math.max(...hourlyBuckets.counts, 1)
                // 对数缩放:log(count+1)/log(max+1),让 1 条也有 ~15% 高度,极值不被压扁
                const ratio = Math.log(count + 1) / Math.log(maxCount + 1)
                return (
                  <div
                    key={i}
                    title={`${i.toString().padStart(2, '0')}:00 — ${count}条`}
                    className="min-w-[6px] flex-1 rounded-t transition-opacity hover:opacity-75"
                    style={{
                      height: count > 0 ? `${Math.max(ratio * 100, 8)}%` : 0,
                      backgroundColor: visual?.color || undefined,
                    }}
                  />
                )
              })}
            </div>

            {/* 时间标签 - 5 个刻度均分,避免窄容器挤压溢出 */}
            <div className="mt-2 flex justify-between text-[10px] tabular-nums text-ink-faint">
              <span className="whitespace-nowrap">00:00</span>
              <span className="whitespace-nowrap">06:00</span>
              <span className="whitespace-nowrap">12:00</span>
              <span className="whitespace-nowrap">18:00</span>
              <span className="whitespace-nowrap">24:00</span>
            </div>
          </>
        )}
      </section>

      {/* 分类分布 */}
      {categoryDistribution.length > 0 && (
        <section className="mb-6 rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="mb-3 text-h3 font-semibold text-ink">分类分布</h2>
          
          {/* 分布条 */}
          <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-sunken flex">
            {categoryDistribution.map(([cat, count]) => {
              const visual = categoryVisual(cat)
              const pct = Math.round((count / todayActivities.length) * 100)
              return (
                <div
                  key={cat}
                  style={{ width: `${pct}%`, backgroundColor: visual.color }}
                  className="first:rounded-l-full last:rounded-r-full"
                  title={`${visual.label}: ${count} (${pct}%)`}
                />
              )
            })}
          </div>

          {/* 图例 - 分类色 + 占比，纯展示 */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {categoryDistribution.map(([cat, count]) => {
              const visual = categoryVisual(cat)
              const pct = Math.round((count / todayActivities.length) * 100)
              return (
                <span key={cat} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: visual.color }} />
                  <span className="text-ink-muted">{visual.label}</span>
                  <span className="tabular-nums text-ink-faint">{count} · {pct}%</span>
                </span>
              )
            })}
          </div>
        </section>
      )}
    </>
  )
}
