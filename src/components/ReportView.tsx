import { useMemo, useState } from 'react'
import type { Activity } from '../stores/activityStore'
import { useActivityStore } from '../stores/activityStore'
import { categoryVisual } from '../utils/categoryStyles'

interface ReportViewProps {
  activities: Activity[]
}

export function ReportView({ activities }: ReportViewProps) {
  const { isGeneratingReport, generateDailyReport } = useActivityStore()
  const [reportDate, setReportDate] = useState(() => {
    const now = new Date()
    return now.toISOString().slice(0, 10)
  })

  /* P1优化: 报告数据聚合 */
  const reportData = useMemo(() => {
    const dayActivities = activities.filter(a => a.timestamp.startsWith(reportDate))
    
    if (dayActivities.length === 0) {
      return null
    }

    // 按应用统计
    const appMap = new Map<string, { count: number; duration: number; categories: Set<Activity['category']> }>()
    for (const a of dayActivities) {
      const existing = appMap.get(a.app) || { count: 0, duration: 0, categories: new Set() }
      existing.count++
      existing.categories.add(a.category)
      appMap.set(a.app, existing)
    }

    // 按分类统计
    const catMap = new Map<Activity['category'], number>()
    for (const a of dayActivities) {
      catMap.set(a.category, (catMap.get(a.category) || 0) + 1)
    }

    // 时间分布（按小时）
    const hourlyBuckets = Array.from({ length: 24 }, () => 0)
    for (const a of dayActivities) {
      hourlyBuckets[new Date(a.timestamp).getHours()]++
    }

    return {
      total: dayActivities.length,
      date: reportDate,
      apps: Array.from(appMap.entries())
        .map(([app, data]) => ({ app, ...data, categories: Array.from(data.categories) }))
        .sort((a, b) => b.count - a.count),
      categories: Array.from(catMap.entries()).sort((a, b) => b[1] - a[1]),
      hourly: hourlyBuckets,
      startTime: dayActivities[dayActivities.length - 1]?.timestamp,
      endTime: dayActivities[0]?.timestamp,
    }
  }, [activities, reportDate])

  /* P1优化: 报告生成处理 */
  const handleGenerateReport = async () => {
    try {
      await generateDailyReport(reportDate)
    } catch (err) {
      console.error('报告生成失败:', err)
    }
  }

  /* P1优化: 报告页面布局 - 使用层级化卡片系统 */
  return (
    <div className="space-y-6">
      {/* 报告控制栏 - 层级2：标准卡片 */}
      <section className="rounded-xl border border-gray-200/60 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-date" className="text-xs font-medium text-gray-500">选择日期</label>
            <input
              id="report-date"
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
            />
          </div>

          <button
            type="button"
            onClick={handleGenerateReport}
            disabled={isGeneratingReport || !reportData}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isGeneratingReport
                ? 'border border-orange-200 bg-orange-50 text-orange-700'
                : 'bg-brand-600 text-white hover:bg-brand-700'
            }`}
          >
            {isGeneratingReport ? '生成中...' : 'AI 生成报告'}
          </button>
        </div>
      </section>

      {!reportData ? (
        /* P1优化: 无数据提示 - 使用左侧色条风格 */
        <section className="border-l-4 border-l-gray-300 bg-white rounded-r-xl p-6 shadow-sm text-center">
          <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="mt-3 text-sm font-medium text-gray-900">该日期暂无数据</p>
          <p className="mt-1 text-xs text-gray-400">选择其他日期或开始采集活动数据</p>
        </section>
      ) : (
        <>
          {/* P1优化: 统计概览 - 层级1：大圆角渐变背景 */}
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-gradient-to-br from-gray-50 to-white p-5 shadow-sm">
              <p className="text-xs font-medium text-gray-500">总活动数</p>
              <p className="mt-1.5 text-h2 font-bold tabular-nums text-gray-900">{reportData.total}</p>
            </div>
            
            <div className="rounded-xl border border-gray-200/60 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-500">活跃应用</p>
              <p className="mt-1.5 text-lg font-semibold tabular-nums text-gray-900">{reportData.apps.length}</p>
            </div>
            
            <div className="rounded-xl border border-gray-200/60 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-500">主要类型</p>
              <div className="mt-1.5 flex items-center gap-2">
                {reportData.categories[0] && (
                  <>
                    <span 
                      className="h-2 w-2 rounded-full" 
                      style={{ backgroundColor: categoryVisual(reportData.categories[0][0]).hex }} 
                    />
                    <span className="text-lg font-semibold text-gray-900">
                      {categoryVisual(reportData.categories[0][0]).label}
                    </span>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* P1优化: 应用排行表 - 层级3：轻量容器 */}
          <section className="rounded-lg bg-white/80 backdrop-blur-sm p-4 border border-gray-100">
            <h2 className="text-h3 font-semibold text-gray-900 mb-3">应用使用排行</h2>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="pb-2 text-left text-xs font-medium text-gray-500">#</th>
                    <th className="pb-2 text-left text-xs font-medium text-gray-500">应用</th>
                    <th className="pb-2 text-right text-xs font-medium text-gray-500">次数</th>
                    <th className="pb-2 text-left text-xs font-medium text-gray-500 pl-4">分类</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reportData.apps.slice(0, 10).map((app, i) => (
                    <tr key={app.app} className="group hover:bg-gray-50/50 transition-colors">
                      <td className="py-2.5 tabular-nums text-gray-400">{i + 1}</td>
                      <td className="py-2.5 font-medium text-gray-900">{app.app}</td>
                      <td className="py-2.5 text-right tabular-nums text-gray-700">{app.count}</td>
                      <td className="py-2.5 pl-4">
                        <div className="flex flex-wrap gap-1">
                          {app.categories.map(cat => {
                            const visual = categoryVisual(cat)
                            return (
                              <span
                                key={cat}
                                className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                style={{
                                  backgroundColor: `${visual.hex}15`,
                                  color: visual.hex,
                                }}
                              >
                                {visual.label}
                              </span>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* P1优化: 分类饼图（用条形图替代）- 左侧色条强调 */}
          <section className="border-l-4 border-l-brand-500 bg-white rounded-r-xl p-4 shadow-sm">
            <h2 className="text-h3 font-semibold text-gray-900 mb-3">分类分布</h2>
            
            {/* 分布条 */}
            <div className="mb-3 h-2.5 w-full overflow-hidden rounded-full bg-gray-100 flex">
              {reportData.categories.map(([cat, count]) => {
                const visual = categoryVisual(cat)
                const pct = Math.round((count / reportData.total) * 100)
                return (
                  <div
                    key={cat}
                    style={{ width: `${pct}%`, backgroundColor: visual.hex }}
                    className="first:rounded-l-full last:rounded-r-full transition-all"
                    title={`${visual.label}: ${count} (${pct}%)`}
                  />
                )
              })}
            </div>

            {/* 图例列表 */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {reportData.categories.map(([cat, count]) => {
                const visual = categoryVisual(cat)
                const pct = Math.round((count / reportData.total) * 100)
                return (
                  <div key={cat} className="flex items-center gap-2 rounded-md bg-gray-50 px-2 py-1.5">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: visual.hex }} />
                    <span className="truncate text-xs text-gray-700">{visual.label}</span>
                    <span className="ml-auto tabular-nums text-xs text-gray-400">{pct}%</span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* P1优化: 时间热力图 - 轻量容器 */}
          <section className="rounded-lg bg-white/80 backdrop-blur-sm p-4 border border-gray-100">
            <h2 className="text-h3 font-semibold text-gray-900 mb-3">时间分布</h2>
            
            <div className="flex items-end gap-0.5 h-20">
              {reportData.hourly.map((count, i) => {
                const hasActivity = count > 0
                const hourActivity = dayActivitiesForHour(activities, reportDate, i)
                
                return (
                  <div
                    key={i}
                    title={`${i.toString().padStart(2, '0')}:00 — ${count}条`}
                    className={`flex-1 min-w-[6px] rounded-t transition-opacity ${
                      hasActivity ? 'opacity-100' : 'opacity-20 bg-gray-100'
                    }`}
                    style={{
                      height: `${Math.max(count * 8, hasActivity ? 4 : 0)}px`,
                      backgroundColor: hasActivity && hourActivity 
                        ? categoryVisual(hourActivity.category).hex 
                        : undefined,
                    }}
                  />
                )
              })}
            </div>

            <div className="mt-2 flex justify-between text-[10px] text-gray-400">
              <span>00:00</span>
              <span>06:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>24:00</span>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

/* 辅助函数：获取某小时的活动（用于颜色映射） */
function dayActivitiesForHour(activities: Activity[], date: string, hour: number): Activity | undefined {
  return activities.find(a => {
    const d = new Date(a.timestamp)
    return a.timestamp.startsWith(date) && d.getHours() === hour
  })
}
