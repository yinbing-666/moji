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

  /* P1优化: 时间轴数据 - 按小时聚合 */
  const hourlyBuckets = useMemo(() => {
    const buckets: number[] = Array.from({ length: 24 }, () => 0)
    for (const a of todayActivities) {
      const h = new Date(a.timestamp).getHours()
      buckets[h]++
    }
    return buckets
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
        <div className="rounded-2xl bg-gradient-to-br from-gray-50 to-white p-5 shadow-sm transition-shadow hover:shadow-md">
          <p className="text-xs font-medium text-gray-500">今日记录</p>
          <p className="mt-1.5 text-h2 font-bold tabular-nums text-gray-900">
            {stats.todayCount}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            较昨日 <span className={stats.yesterdayCount > 0 ? 'text-teal-600' : 'text-gray-600'}>{stats.yesterdayCount}</span>
          </p>
        </div>

        {/* 主要应用 - 使用标准卡片（层级2） */}
        <div className="rounded-xl border border-gray-200/60 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
          <p className="text-xs font-medium text-gray-500">主要应用</p>
          <p className="mt-1.5 truncate text-lg font-semibold text-gray-900">{stats.topApp || '-'}</p>
          <p className="mt-1 text-xs text-gray-400">{stats.topAppCount} 条记录</p>
        </div>

        {/* 主要类型 - 带分类色标识 */}
        <div className="rounded-xl border border-gray-200/60 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
          <p className="text-xs font-medium text-gray-500">主要类型</p>
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

        {/* P1优化: 时间轴柱状图 - 删除hover缩放动画 */}
        <div className="flex items-end gap-0.5 h-16">
          {hourlyBuckets.map((count, i) => {
            const hasActivity = count > 0
            const visual = hasActivity && todayActivities.find(a => new Date(a.timestamp).getHours() === i)
              ? categoryVisual(todayActivities.find(a => new Date(a.timestamp).getHours() === i)!.category)
              : null
            
            return (
              <div
                key={i}
                title={`${i.toString().padStart(2, '0')}:00 — ${count}条`}
                className={`flex-1 min-w-[6px] rounded-t transition-opacity ${
                  hasActivity 
                    ? 'opacity-100'  /* P1: 只用透明度变化，删除scale-y-110 */
                    : 'opacity-20 bg-gray-100'
                }`}
                style={{
                  height: `${Math.max(count * 12, 4)}px`,
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
        <section className="mb-6 border-l-4 border-l-brand-500 bg-white rounded-r-xl p-4 shadow-sm">
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
