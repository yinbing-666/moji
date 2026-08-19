import { useEffect, useMemo, useRef, useState } from 'react'
import type { Activity } from '../stores/activityStore'
import { useActivityStore } from '../stores/activityStore'
import { categoryVisual } from '../utils/categoryStyles'
import { exportReportAsMarkdown } from '../utils/export'
import { formatDuration } from '../utils/format'
import { todayDateKey, localDateKey } from '../utils/date'
import { calculateReportQuality } from '../utils/reportQuality'
import {
  BUILTIN_TEMPLATES,
  addCustomTemplate,
  loadCustomTemplates,
  removeCustomTemplate,
  updateCustomTemplate,
  type CustomTemplate,
} from '../utils/templates'
import { AwAnalytics } from './AwAnalytics'
import { MarkdownReport } from './MarkdownReport'

const REPORT_TYPE_LABEL: Record<string, string> = {
  daily: '日报',
  weekly: '周报',
  monthly: '月报',
}

interface ReportViewProps {
  activities: Activity[]
}

function reportPresentation(content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  let currentHeading = ''
  let actionItems = 0
  let riskItems = 0
  let sections = 0

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim())
    if (heading) {
      currentHeading = heading[2]
      sections++
      continue
    }
    if (!/^[-*]\s+/.test(line.trim())) continue
    if (/下一步|明日|后续|行动|待办/.test(currentHeading)) actionItems++
    if (/风险|问题|阻塞/.test(currentHeading)) riskItems++
  }

  return {
    sections,
    actionItems,
    riskItems,
    characters: content.replace(/\s/g, '').length,
  }
}

export function ReportView({ activities }: ReportViewProps) {
  const {
    settings,
    isGeneratingReport,
    generateDailyReport,
    lastReport,
    reportHistory,
    viewReport,
    deleteReport,
  } = useActivityStore()
  const [copied, setCopied] = useState(false)
  const [reportDate, setReportDate] = useState(todayDateKey)
  const [selectedTemplate, setSelectedTemplate] = useState('standard')
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(loadCustomTemplates)
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false)
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [templatePrompt, setTemplatePrompt] = useState('')
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'daily' | 'efficiency'>('daily')
  const reportContentRef = useRef<HTMLElement | null>(null)
  const isLocalMode = settings.dataSource === 'local'
  const effectiveTemplate = isLocalMode && selectedTemplate.startsWith('custom:') ? 'standard' : selectedTemplate

  useEffect(() => {
    if (isLocalMode && selectedTemplate.startsWith('custom:')) {
      setSelectedTemplate('standard')
    }
  }, [isLocalMode, selectedTemplate])

  const templateLabel = (templateKey: string) => {
    const builtin = BUILTIN_TEMPLATES.find(template => template.value === templateKey)
    if (builtin) return builtin.label
    if (templateKey.startsWith('custom:')) {
      return customTemplates.find(template => template.id === templateKey.slice(7))?.name ?? '自定义模板'
    }
    return '标准'
  }

  const openNewTemplateEditor = () => {
    setEditingTemplateId(null)
    setTemplateName('')
    setTemplatePrompt('')
    setTemplateError(null)
    setTemplateEditorOpen(true)
  }

  const openEditTemplateEditor = () => {
    if (!selectedTemplate.startsWith('custom:')) return
    const id = selectedTemplate.slice(7)
    const template = customTemplates.find(item => item.id === id)
    if (!template) return
    setEditingTemplateId(id)
    setTemplateName(template.name)
    setTemplatePrompt(template.prompt)
    setTemplateError(null)
    setTemplateEditorOpen(true)
  }

  const closeTemplateEditor = () => {
    setTemplateEditorOpen(false)
    setEditingTemplateId(null)
    setTemplateError(null)
  }

  const handleSaveTemplate = () => {
    const name = templateName.trim()
    const prompt = templatePrompt.trim()
    if (!name || !prompt) {
      setTemplateError('请填写模板名称和生成要求')
      return
    }

    if (editingTemplateId) {
      setCustomTemplates(updateCustomTemplate(editingTemplateId, name, prompt))
    } else {
      const previousIds = new Set(customTemplates.map(template => template.id))
      const next = addCustomTemplate(name, prompt)
      setCustomTemplates(next)
      const created = next.find(template => !previousIds.has(template.id))
      if (created) setSelectedTemplate(`custom:${created.id}`)
    }
    closeTemplateEditor()
  }

  const handleDeleteSelectedTemplate = () => {
    if (!selectedTemplate.startsWith('custom:')) return
    const id = selectedTemplate.slice(7)
    const template = customTemplates.find(item => item.id === id)
    if (!template || !window.confirm(`确定删除自定义模板“${template.name}”？`)) return
    setCustomTemplates(removeCustomTemplate(id))
    setSelectedTemplate('standard')
    closeTemplateEditor()
  }

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
    const label = `${REPORT_TYPE_LABEL[lastReport.type] ?? '报告'}-${localDateKey(lastReport.createdAt)}`
    exportReportAsMarkdown(lastReport.content, label)
  }

  const handlePrintReport = () => {
    if (!lastReport) return
    window.print()
  }

  useEffect(() => {
    if (lastReport && activeTab === 'daily') {
      reportContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [lastReport, activeTab])

  const handleDeleteReport = (id: string) => {
    const item = reportHistory.find(report => report.id === id)
    if (!item || !window.confirm('确定删除这份报告？删除后无法在历史记录中恢复。')) return
    deleteReport(id)
  }

  /* P1优化: 报告数据聚合 */
  const reportData = useMemo(() => {
    const dayActivities = activities.filter(a => localDateKey(a.timestamp) === reportDate)
    
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
      quality: calculateReportQuality(dayActivities),
      apps: Array.from(appMap.entries())
        .map(([app, data]) => ({ app, ...data, categories: Array.from(data.categories) }))
        .sort((a, b) => b.count - a.count),
      categories: Array.from(catMap.entries()).sort((a, b) => b[1] - a[1]),
      hourly: hourlyBuckets,
      hourlyDominant,
    }
  }, [activities, reportDate])

  const currentPresentation = useMemo(
    () => lastReport ? reportPresentation(lastReport.content) : null,
    [lastReport],
  )

  /* P1优化: 报告生成处理 */
  const handleGenerateReport = async () => {
    try {
      await generateDailyReport(reportDate, effectiveTemplate)
    } catch (err) {
      console.error('报告生成失败:', err)
    }
  }

  /* P1优化: 报告页面布局 - 使用层级化卡片系统 */
  return (
    <div className="report-print-root space-y-6">
      <nav className="report-no-print flex border-b border-gray-200" aria-label="报告类型">
        <button type="button" onClick={() => setActiveTab('daily')} className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === 'daily' ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>工作日报</button>
        <button type="button" onClick={() => setActiveTab('efficiency')} className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === 'efficiency' ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>效率分析</button>
      </nav>

      {activeTab === 'efficiency' ? (
        <section className="rounded-xl border border-gray-200/60 bg-white p-5 shadow-card">
          <AwAnalytics activities={activities} />
        </section>
      ) : (<>
      {/* 报告控制栏 - 层级2：标准卡片 */}
      <section className="report-no-print rounded-xl border border-gray-200/60 bg-white p-4 shadow-card">
        {isLocalMode && (
          <div className="mb-3 rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-2 text-xs text-teal-800">
            当前为无 LLM 模式，报告按固定格式在本地生成，不会调用 API。
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
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

          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="report-template" className="text-xs font-medium text-gray-500">{isLocalMode ? '报告格式' : '报告模板'}</label>
            <select
              id="report-template"
              value={effectiveTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
            >
              <optgroup label="内置模板">
                {BUILTIN_TEMPLATES.map(template => (
                  <option key={template.value} value={template.value}>{template.label}：{template.description}</option>
                ))}
              </optgroup>
              {!isLocalMode && customTemplates.length > 0 && (
                <optgroup label="自定义模板">
                  {customTemplates.map(template => (
                    <option key={template.id} value={`custom:${template.id}`}>{template.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
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
            {isGeneratingReport ? '生成中...' : isLocalMode ? '生成本地报告' : 'AI 生成报告'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <span className="text-xs text-gray-500">当前：{templateLabel(effectiveTemplate)}</span>
          {!isLocalMode && <button
            type="button"
            onClick={openNewTemplateEditor}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700"
          >
            新建自定义模板
          </button>}
          {!isLocalMode && selectedTemplate.startsWith('custom:') && (
            <>
              <button
                type="button"
                onClick={openEditTemplateEditor}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700"
              >
                编辑模板
              </button>
              <button
                type="button"
                onClick={handleDeleteSelectedTemplate}
                className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                删除模板
              </button>
            </>
          )}
        </div>

        {templateEditorOpen && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="template-name" className="text-xs font-medium text-gray-500">模板名称</label>
                <input
                  id="template-name"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="例如：周会复盘"
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="template-prompt" className="text-xs font-medium text-gray-500">生成要求</label>
                <textarea
                  id="template-prompt"
                  value={templatePrompt}
                  onChange={(e) => setTemplatePrompt(e.target.value)}
                  placeholder="描述报告重点、结构和语气"
                  rows={3}
                  className="resize-y rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
                />
              </div>
            </div>
            {templateError && <p className="mt-2 text-xs text-red-600">{templateError}</p>}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={handleSaveTemplate}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700"
              >
                保存模板
              </button>
              <button
                type="button"
                onClick={closeTemplateEditor}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 报告内容展示：生成后或从历史打开 */}
      {lastReport && (
        <section ref={reportContentRef} className="overflow-hidden rounded-xl border border-gray-200/60 bg-white shadow-card">
          <div className="border-b border-gray-100 bg-gray-50/60 px-5 py-4">
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
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                {templateLabel(lastReport.template)}
              </span>
              <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                当前为 {isLocalMode ? '固定格式模式' : 'AI 模式'}
              </span>
            </div>
            <div className="report-no-print flex items-center gap-2">
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
              <button
                type="button"
                onClick={handlePrintReport}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700"
              >
                打印 / PDF
              </button>
            </div>
          </div>
          {currentPresentation && <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-4">
            {[
              ['报告章节', `${currentPresentation.sections} 个`, '按标题组织'],
              ['行动项', `${currentPresentation.actionItems} 条`, '下一步与待办'],
              ['风险项', `${currentPresentation.riskItems} 条`, '问题与阻塞'],
              ['正文长度', `${currentPresentation.characters} 字`, '已保存至本机'],
            ].map(([label, value, note]) => (
              <div key={label} className="bg-surface px-3 py-2.5">
                <p className="text-[11px] text-gray-500">{label}</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-gray-900">{value}</p>
                <p className="mt-0.5 text-[10px] text-gray-400">{note}</p>
              </div>
            ))}
          </div>}
          </div>
          <div className="report-content max-h-[36rem] overflow-y-auto p-5">
            <MarkdownReport content={lastReport.content} />
          </div>
        </section>
      )}

      {/* 报告历史：最近生成的报告可随时回看 */}
      {reportHistory.length > 0 && (
        <section className="report-no-print rounded-xl border border-gray-200/60 bg-white p-4 shadow-card">
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
                    {' · '}{templateLabel(item.template)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteReport(item.id)}
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
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

            <div className="rounded-xl border border-gray-200/60 bg-white p-4 shadow-card">
              <p className="text-xs font-medium text-gray-500">报告质量</p>
              <div className="mt-1.5 flex items-baseline gap-1">
                <p className="text-lg font-semibold tabular-nums text-gray-900">{reportData.quality.score}</p>
                <span className="text-xs text-gray-400">/ 100</span>
              </div>
              <p className="mt-1 text-xs text-gray-500" title={reportData.quality.detail}>{reportData.quality.label}</p>
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
      </>)}
    </div>
  )
}
