import { useMemo, useState } from 'react'
import type { Activity } from '../stores/activityStore'
import { useActivityStore } from '../stores/activityStore'
import { categoryVisual } from '../utils/categoryStyles'
import { dateStamp, exportReportAsMarkdown } from '../utils/export'
import { formatDuration } from '../utils/format'
import { AwAnalytics } from './AwAnalytics'

const REPORT_TYPE_LABEL: Record<string, string> = {
  daily: '日报',
  weekly: '周报',
  monthly: '月报',
}

interface ReportViewProps {
  activities: Activity[]
}

export function ReportView({ activities }: ReportViewProps) {
  const {
    isGeneratingReport,
    generateDailyReport,
    lastReport,
    reportHistory,
    viewReport,
    deleteReport,
  } = useActivityStore()
  const [copied, setCopied] = useState(false)
  // 默认日期与筛选都用本地时区语义：timestamp 是 UTC ISO 串，
  // startsWith 前缀匹配在东八区 0-8 点会把活动算错天
  const [reportDate, setReportDate] = useState(() => dateStamp())

  const handleCopyReport = async () => {
    if (!lastReport) return
    try {
      await navigator.clipboard.writeText(lastReport.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('复制失败:', err)
    }
  }

  const handleDownloadReport = () => {
    if (!lastReport) return
    const label = `${REPORT_TYPE_LABEL[lastReport.type] ?? '报告'}-${lastReport.createdAt.slice(0, 10)}`
    exportReportAsMarkdown(lastReport.content, label)
  }

  /* P1优化: 报告数据聚合 */
  const reportData = useMemo(() => {
    // timestamp 是 UTC ISO 串，先转成本地日期再与所选日期比对，避免错天
    const dayActivities = activities.filter(a => dateStamp(new Date(a.timestamp)) === reportDate)
    
    if (dayActivities.length === 0) {
      return null
    }

    // 按应用统计（含时长聚合）
    const appMap = new Map<string, { count: number; duration: number; categories: Set<Activity['category']> }>()
    for (const a of dayActivities) {
      const existing = appMap.get(a.app) || { count: 0, duration: 0, categories: new Set() }
      existing.count++
      existing.duration += a.durationSeconds ?? 0
      existing.categories.add(a.category)
      appMap.set(a.app, existing)
    }

    // 按分类统计
    const catMap = new Map<Activity['category'], number>()
    for (const a of dayActivities) {
      catMap.set(a.category, (catMap.get(a.category) || 0) + 1)
    }

    // 时间分布（按小时，同时记录每小时主要分类用于着色）
    const hourlyBuckets = Array.from({ length: 24 }, () => 0)
    const hourlyCats: Map<Activity['category'], number>[] = Array.from({ length: 24 }, () => new Map())
    for (const a of dayActivities) {
      const h = new Date(a.timestamp).getHours()
      hourlyBuckets[h]++
      hourlyCats[h].set(a.category, (hourlyCats[h].get(a.category) || 0) + 1)
    }
    const hourlyDominant: (Activity['category'] | null)[] = hourlyCats.map(cats => {
      let best: Activity['category'] | null = null
      let bestCount = 0
      for (const [cat, c] of cats) {
        if (c > bestCount) { best = cat; bestCount = c }
      }
      return best
    })

    return {
      total: dayActivities.length,
      date: reportDate,
      apps: Array.from(appMap.entries())
        .map(([app, data]) => ({ app, ...data, categories: Array.from(data.categories) }))
        .sort((a, b) => b.count - a.count),
      categories: Array.from(catMap.entries()).sort((a, b) => b[1] - a[1]),
      hourly: hourlyBuckets,
      hourlyDominant,
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
      {/* 效率分析(基于 ActivityWatch Analytics Skill,任何数据源模式可用) */}
      <AwAnalytics />

      {/* 报告控制栏 - 层级2：标准卡片 */}
      <section className="rounded-xl border border-gray-200/60 bg-white p-4 shadow-card">
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

      {/* 报告内容展示：生成后或从历史打开 */}
      {lastReport && (
        <section className="rounded-xl border border-gray-200/60 bg-white p-5 shadow-card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
                {REPORT_TYPE_LABEL[lastReport.type] ?? lastReport.type}
              </span>
              <p className="text-sm font-semibold text-gray-900">
                生成于 {new Date(lastReport.createdAt).toLocaleString('zh-CN', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyReport()}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700"
              >
                {copied ? '已复制' : '复制'}
              </button>
              <button
                type="button"
                onClick={handleDownloadReport}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700"
              >
                下载 Markdown
              </button>
            </div>
          </div>
          <div className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
            {lastReport.content}
          </div>
        </section>
      )}

      {/* 报告历史：最近生成的报告可随时回看 */}
      {reportHistory.length > 0 && (
        <section className="rounded-xl border border-gray-200/60 bg-white p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-h3 font-semibold text-gray-900">报告历史</h2>
            <span className="text-xs text-gray-400">最近 {reportHistory.length} 条</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {reportHistory.map(item => (
              <li
                key={item.id}
                className={`group flex items-center gap-3 py-2.5 transition-colors ${
                  lastReport?.id === item.id ? 'bg-brand-50/30' : 'hover:bg-gray-50/60'
                } -mx-2 rounded-md px-2`}
              >
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                  {REPORT_TYPE_LABEL[item.type] ?? item.type}
                </span>
                <button
                  type="button"
                  onClick={() => viewReport(item)}
                  className="min-w-0 flex-1 text-left"
                  title="查看这份报告"
                >
                  <p className="truncate text-sm text-gray-800">{item.content.split('\n')[0] || '（无内容）'}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {new Date(item.createdAt).toLocaleString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => deleteReport(item.id)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  title="删除这条报告"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!reportData ? (
        /* P1优化: 无数据提示 - 使用左侧色条风格 */
        <section className="border-l-4 border-l-gray-300 bg-white rounded-r-xl p-6 shadow-card text-center">
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
            <div className="rounded-2xl bg-gradient-to-br from-gray-50 to-white p-5 shadow-card">
              <p className="text-xs font-medium text-gray-500">总活动数</p>
              <p className="mt-1.5 text-h2 font-bold tabular-nums text-gray-900">{reportData.total}</p>
            </div>
            
            <div className="rounded-xl border border-gray-200/60 bg-white p-4 shadow-card">
              <p className="text-xs font-medium text-gray-500">活跃应用</p>
              <p className="mt-1.5 text-lg font-semibold tabular-nums text-gray-900">{reportData.apps.length}</p>
            </div>
            
            <div className="rounded-xl border border-gray-200/60 bg-white p-4 shadow-card">
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
                    <th className="pb-2 text-right text-xs font-medium text-gray-500">时长</th>
                    <th className="pb-2 text-left text-xs font-medium text-gray-500 pl-4">分类</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reportData.apps.slice(0, 10).map((app, i) => (
                    <tr key={app.app} className="group hover:bg-gray-50/50 transition-colors">
                      <td className="py-2.5 tabular-nums text-gray-400">{i + 1}</td>
                      <td className="py-2.5 font-medium text-gray-900">{app.app}</td>
                      <td className="py-2.5 text-right tabular-nums text-gray-700">{app.count}</td>
                      <td className="py-2.5 text-right tabular-nums text-gray-700">{formatDuration(app.duration) ?? '-'}</td>
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
          <section className="border-l-4 border-l-brand-500 bg-white rounded-r-xl p-4 shadow-card">
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

            <div className="flex items-end gap-0.5 h-20 overflow-hidden">
              {reportData.hourly.map((count, i) => {
                const hasActivity = count > 0
                const dominantCat = reportData.hourlyDominant[i]
                const maxCount = Math.max(...reportData.hourly, 1)
                // 对数缩放（与今日时间轴一致），避免高峰柱溢出容器
                const ratio = Math.log(count + 1) / Math.log(maxCount + 1)

                return (
                  <div
                    key={i}
                    title={`${i.toString().padStart(2, '0')}:00 — ${count}条`}
                    className={`flex-1 min-w-[6px] rounded-t transition-opacity ${
                      hasActivity ? 'opacity-100 hover:opacity-75' : 'opacity-20 bg-gray-100'
                    }`}
                    style={{
                      height: `${Math.max(ratio * 100, hasActivity ? 3 : 0)}%`,
                      backgroundColor: dominantCat ? categoryVisual(dominantCat).hex : undefined,
                    }}
                  />
                )
              })}
            </div>

            <div className="mt-2 flex justify-between text-[10px] tabular-nums text-gray-400">
              <span className="whitespace-nowrap">00:00</span>
              <span className="whitespace-nowrap">06:00</span>
              <span className="whitespace-nowrap">12:00</span>
              <span className="whitespace-nowrap">18:00</span>
              <span className="whitespace-nowrap">24:00</span>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
