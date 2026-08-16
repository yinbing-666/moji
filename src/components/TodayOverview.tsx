import { useMemo } from 'react'
import type { Activity } from '../stores/activityStore'
import { categoryVisual } from '../utils/categoryStyles'

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

    return { todayCount, yesterdayCount, topApp, topAppCount, topCat, topCatCount }
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

  /* P1优化: 统计卡片 - 使用大圆角+渐变背景（层级1） */
  return (
    <>
      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        {/* 今日记录 - 主数字使用text-h2 */}
        <div className="rounded-2xl bg-gradient-to-br from-gray-50 to-white p-5 shadow-card transition-shadow hover:shadow-elevated">
          <div className="flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-xs font-medium text-gray-500">今日记录</p>
          </div>
          <p className="mt-1.5 text-h2 font-bold tabular-nums text-gray-900">
            {stats.todayCount}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            较昨日 <span className={stats.yesterdayCount > 0 ? 'text-teal-600' : 'text-gray-600'}>{stats.yesterdayCount}</span>
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
            {/* P1优化: 分类点使用新颜色 */}
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: topCatVisual.hex }} />
            <p className="truncate text-lg font-semibold text-gray-900">{topCatVisual.label}</p>
          </div>
          <p className="mt-1 text-xs text-gray-400">{stats.topCatCount} 条记录</p>
        </div>
      </section>

      {/* P1优化: 时间轴容器 - 使用轻量样式（层级3） */}
      <section className="mb-6 rounded-lg bg-white/80 backdrop-blur-sm p-4 border border-gray-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-h3 font-semibold text-gray-900">今日时间轴</h2>
          <span className="text-xs text-gray-400">共 {todayActivities.length} 条记录</span>
        </div>

        {/* P1优化: 时间轴柱状图 - 对数缩放,小柱子也可辨;容器防溢出 */}
        <div className="flex items-end gap-0.5 h-16 overflow-hidden">
          {hourlyBuckets.counts.map((count, i) => {
            const hasActivity = count > 0
            const dominantCat = hourlyBuckets.dominant[i]
            const visual = dominantCat ? categoryVisual(dominantCat) : null
            const maxCount = Math.max(...hourlyBuckets.counts, 1)
            // 对数缩放:log(count+1)/log(max+1),让 1 条也有 ~15% 高度,极值不被压扁
            const ratio = Math.log(count + 1) / Math.log(maxCount + 1)
            return (
              <div
                key={i}
                title={`${i.toString().padStart(2, '0')}:00 — ${count}条`}
                className={`flex-1 min-w-[6px] rounded-t transition-opacity ${
                  hasActivity 
                    ? 'opacity-100 hover:opacity-75' 
                    : 'opacity-20 bg-gray-100'
                }`}
                style={{
                  height: `${Math.max(ratio * 100, count > 0 ? 8 : 0)}%`,
                  backgroundColor: visual?.hex || undefined,
                }}
              />
            )
          })}
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
