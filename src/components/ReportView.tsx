import { useEffect, useMemo, useRef, useState } from 'react'
import type { Activity } from '../stores/activityStore'
import { useActivityStore } from '../stores/activityStore'
import { categoryVisual } from '../utils/categoryStyles'
import { exportReportAsMarkdown } from '../utils/export'
import { dbExportReportPdf, dbSendSystemNotification } from '../utils/db'
import { formatDuration } from '../utils/format'
import { todayDateKey } from '../utils/date'
import { calculateReportQuality } from '../utils/reportQuality'
import { filterActivitiesForReportPeriod, reportSourceDate, type ReportType } from '../utils/reportHistory'
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

function reportModeLabel(mode: 'local' | 'llm' | undefined): string {
  return mode === 'local' ? '固定格式模式' : mode === 'llm' ? 'AI 模式' : '生成模式未记录'
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

function buildReportData(activities: Activity[], type: ReportType, sourceDate: string) {
  const periodActivities = filterActivitiesForReportPeriod(activities, type, sourceDate)
  if (periodActivities.length === 0) return null

  const appMap = new Map<string, { count: number; duration: number; categories: Set<Activity['category']> }>()
  const categoryMap = new Map<Activity['category'], number>()
  const hourlyBuckets = Array.from({ length: 24 }, () => 0)
  const hourlyCategories: Map<Activity['category'], number>[] = Array.from({ length: 24 }, () => new Map())

  for (const activity of periodActivities) {
    const app = appMap.get(activity.app) || { count: 0, duration: 0, categories: new Set() }
    app.count++
    app.duration += activity.durationSeconds ?? 0
    app.categories.add(activity.category)
    appMap.set(activity.app, app)
    categoryMap.set(activity.category, (categoryMap.get(activity.category) || 0) + 1)

    const hour = new Date(activity.timestamp).getHours()
    hourlyBuckets[hour]++
    hourlyCategories[hour].set(activity.category, (hourlyCategories[hour].get(activity.category) || 0) + 1)
  }

  const hourlyDominant = hourlyCategories.map(categories => {
    let best: Activity['category'] | null = null
    let bestCount = 0
    for (const [category, count] of categories) {
      if (count > bestCount) {
        best = category
        bestCount = count
      }
    }
    return best
  })

  return {
    total: periodActivities.length,
    date: sourceDate,
    quality: calculateReportQuality(periodActivities),
    apps: Array.from(appMap.entries())
      .map(([app, data]) => ({ app, ...data, categories: Array.from(data.categories) }))
      .sort((a, b) => b.count - a.count),
    categories: Array.from(categoryMap.entries()).sort((a, b) => b[1] - a[1]),
    hourly: hourlyBuckets,
    hourlyDominant,
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
    updateReport,
    revertReport,
  } = useActivityStore()
  const [copied, setCopied] = useState(false)
  const [editingReportId, setEditingReportId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [reportDate, setReportDate] = useState(todayDateKey)
  const [selectedTemplate, setSelectedTemplate] = useState('standard')
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(loadCustomTemplates)
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false)
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [templatePrompt, setTemplatePrompt] = useState('')
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [reportType, setReportType] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [activeTab, setActiveTab] = useState<'daily' | 'efficiency'>('daily')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfMsg, setPdfMsg] = useState<string | null>(null)
  const reportContentRef = useRef<HTMLElement | null>(null)
  const editing = editingReportId !== null
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
    const label = `${REPORT_TYPE_LABEL[lastReport.type] ?? '报告'}-${reportSourceDate(lastReport)}`
    exportReportAsMarkdown(lastReport.content, label)
  }

  const handlePrintReport = () => {
    if (!lastReport) return
    window.print()
  }

  const handleExportPdf = async () => {
    if (!lastReport) return
    setPdfBusy(true)
    setPdfMsg(null)
    try {
      const typeLabel = REPORT_TYPE_LABEL[lastReport.type] ?? '工作报告'
      const sourceDate = reportSourceDate(lastReport)
      const path = await dbExportReportPdf({
        title: `墨记${typeLabel}-${sourceDate}`,
        reportType: typeLabel,
        createdAt: new Date(lastReport.createdAt).toLocaleString('zh-CN'),
        mode: reportModeLabel(lastReport.generationMode),
        template: templateLabel(lastReport.template),
        content: lastReport.content,
        activityCount: exportReportData?.total ?? 0,
        categories: (exportReportData?.categories ?? []).map(([category, count]) => ({
          label: categoryVisual(category).label,
          value: count,
        })),
        topApps: (exportReportData?.apps ?? []).slice(0, 8).map(app => ({ label: app.app, value: app.count })),
      })
      if (path === null) {
        setPdfMsg('__TAURI_INTERNALS__' in window ? null : '请在桌面版中导出 PDF')
        return
      }
      setPdfMsg(`PDF 已保存：${path}`)
      if (settings.systemNotificationsEnabled) {
        void dbSendSystemNotification('墨记报告已导出', `${typeLabel} PDF 已保存到所选目录`).catch(() => {})
      }
    } catch (error) {
      setPdfMsg(error instanceof Error ? error.message : String(error))
    } finally {
      setPdfBusy(false)
    }
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

  const startEditReport = () => {
    if (!lastReport) return
    setDraft(lastReport.content)
    setEditingReportId(lastReport.id)
  }

  const handleCancelReportEdit = () => {
    const original = reportHistory.find(item => item.id === editingReportId)
    setDraft(original?.content ?? '')
    setEditingReportId(null)
  }

  const handleSaveReportEdit = () => {
    if (!editingReportId || !draft.trim()) return
    updateReport(reportHistory, editingReportId, draft)
    setDraft('')
    setEditingReportId(null)
  }

  const reportData = useMemo(() => {
    return buildReportData(activities, reportType, reportDate)
  }, [activities, reportDate, reportType])

  const exportReportData = useMemo(() => {
    if (!lastReport) return null
    return buildReportData(activities, lastReport.type, reportSourceDate(lastReport))
  }, [activities, lastReport])

  const currentPresentation = useMemo(
    () => lastReport ? reportPresentation(lastReport.content) : null,
    [lastReport],
  )

  /* P1优化: 报告生成处理 */
  const handleGenerateReport = async () => {
    try {
      await generateDailyReport(reportDate, effectiveTemplate, reportType)
      if (settings.systemNotificationsEnabled) {
        void dbSendSystemNotification('墨记报告已生成', `${REPORT_TYPE_LABEL[reportType]}已保存到报告历史`).catch(() => {})
      }
    } catch (err) {
      console.error('报告生成失败:', err)
    }
  }

  /* P1优化: 报告页面布局 - 使用层级化卡片系统 */
  return (
    <div className="report-print-root space-y-6">
      <nav className="report-no-print flex border-b border-line" aria-label="报告类型">
        <button type="button" onClick={() => setActiveTab('daily')} className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === 'daily' ? 'border-accent text-accent-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>工作日报</button>
        <button type="button" onClick={() => setActiveTab('efficiency')} className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === 'efficiency' ? 'border-accent text-accent-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>效率分析</button>
      </nav>

      {activeTab === 'efficiency' ? (
        <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <AwAnalytics activities={activities} />
        </section>
      ) : (<>
      {/* 报告控制栏 */}
      <section className="report-no-print rounded-xl border border-line bg-surface p-5 shadow-card">
        {isLocalMode && (
          <div className="mb-3 rounded-lg border border-accent bg-accent-soft px-3 py-2 text-xs text-accent-ink">
            当前为无 LLM 模式，报告按固定格式在本地生成，不会调用 API。
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-type" className="text-xs font-medium text-ink-muted">报告周期</label>
            <select
              id="report-type"
              value={reportType}
              onChange={(e) => setReportType(e.target.value as 'daily' | 'weekly' | 'monthly')}
              className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
            >
              <option value="daily">日报</option>
              <option value="weekly">周报</option>
              <option value="monthly">月报</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-date" className="text-xs font-medium text-ink-muted">选择日期</label>
            <input
              id="report-date"
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="report-template" className="text-xs font-medium text-ink-muted">{isLocalMode ? '报告格式' : '报告模板'}</label>
            <select
              id="report-template"
              value={effectiveTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="w-full rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
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
            disabled={isGeneratingReport || !reportData || editing}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isGeneratingReport
                ? 'border border-warn-line bg-warn-soft text-warn-ink'
                : 'bg-accent text-on-accent hover:bg-accent-hover'
            }`}
          >
            {isGeneratingReport ? '生成中...' : isLocalMode ? '生成本地报告' : 'AI 生成报告'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
          <span className="text-xs text-ink-muted">当前：{templateLabel(effectiveTemplate)}</span>
          {!isLocalMode && <button
            type="button"
            onClick={openNewTemplateEditor}
            className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink"
          >
            新建自定义模板
          </button>}
          {!isLocalMode && selectedTemplate.startsWith('custom:') && (
            <>
              <button
                type="button"
                onClick={openEditTemplateEditor}
                className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink"
              >
                编辑模板
              </button>
              <button
                type="button"
                onClick={handleDeleteSelectedTemplate}
                className="rounded-md border border-danger-line bg-surface px-2.5 py-1 text-xs font-medium text-danger-ink transition-colors hover:bg-danger-soft"
              >
                删除模板
              </button>
            </>
          )}
        </div>

        {templateEditorOpen && (
          <div className="mt-3 border-t border-line-soft pt-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="template-name" className="text-xs font-medium text-ink-muted">模板名称</label>
                <input
                  id="template-name"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="例如：周会复盘"
                  className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="template-prompt" className="text-xs font-medium text-ink-muted">生成要求</label>
                <textarea
                  id="template-prompt"
                  value={templatePrompt}
                  onChange={(e) => setTemplatePrompt(e.target.value)}
                  placeholder="描述报告重点、结构和语气"
                  rows={3}
                  className="resize-y rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
                />
              </div>
            </div>
            {templateError && <p className="mt-2 text-xs text-danger-ink">{templateError}</p>}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={handleSaveTemplate}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent transition-colors hover:bg-accent-hover"
              >
                保存模板
              </button>
              <button
                type="button"
                onClick={closeTemplateEditor}
                className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-sunken"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 报告内容展示：生成后或从历史打开 */}
      {lastReport && (
        <section ref={reportContentRef} className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <div className="border-b border-line-soft bg-sunken px-5 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-line-soft pb-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-ink ring-1 ring-accent-soft">
                {REPORT_TYPE_LABEL[lastReport.type] ?? lastReport.type}
              </span>
              <p className="text-sm font-semibold text-ink">
                生成于 {new Date(lastReport.createdAt).toLocaleString('zh-CN', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
              <span className="rounded-full bg-sunken px-2 py-0.5 text-[10px] font-medium text-ink-muted">
                {templateLabel(lastReport.template)}
              </span>
              <span className="rounded-full bg-sunken px-2 py-0.5 text-[10px] font-medium text-ink-muted">
                {reportModeLabel(lastReport.generationMode)}
              </span>
            </div>
            <div className="report-no-print flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void handleCopyReport()}
                className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink"
              >
                {copied ? '已复制' : '复制'}
              </button>
              <button
                type="button"
                onClick={handleDownloadReport}
                className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink"
              >
                下载 Markdown
              </button>
              <button
                type="button"
                onClick={() => void handleExportPdf()}
                disabled={pdfBusy}
                className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink"
              >
                {pdfBusy ? '导出中…' : '导出 PDF'}
              </button>
              <button
                type="button"
                onClick={handlePrintReport}
                className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink"
              >
                打印
              </button>
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={handleCancelReportEdit}
                    className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-danger hover:text-danger-ink"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveReportEdit}
                    disabled={!draft.trim()}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    保存
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={startEditReport}
                  className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink"
                >
                  编辑
                </button>
              )}
            </div>
          </div>
          {pdfMsg && <p className="mb-3 break-all text-xs text-ink-muted">{pdfMsg}</p>}
          {currentPresentation && <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
            {[
              ['报告章节', `${currentPresentation.sections} 个`, '按标题组织'],
              ['行动项', `${currentPresentation.actionItems} 条`, '下一步与待办'],
              ['风险项', `${currentPresentation.riskItems} 条`, '问题与阻塞'],
              ['正文长度', `${currentPresentation.characters} 字`, '已保存至本机'],
            ].map(([label, value, note]) => (
              <div key={label} className="bg-surface px-3 py-2.5">
                <p className="text-[11px] text-ink-muted">{label}</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-ink">{value}</p>
                <p className="mt-0.5 text-[10px] text-ink-faint">{note}</p>
              </div>
            ))}
          </div>}
          </div>
          <div className="report-content max-h-[36rem] overflow-y-auto p-5">
            {editing ? (
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                className="min-h-64 w-full resize-y rounded-md border border-line-strong bg-surface p-3 font-mono text-sm text-ink"
              />
            ) : (
              <MarkdownReport content={lastReport.content} />
            )}
          </div>
        </section>
      )}

      {/* 报告历史：最近生成的报告可随时回看 */}
      {reportHistory.length > 0 && (
        <section className="report-no-print rounded-xl border border-line bg-surface p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-h3 font-semibold text-ink">报告历史</h2>
            <span className="text-xs text-ink-faint">最近 {reportHistory.length} 条</span>
          </div>
          <ul className="divide-y divide-line-soft">
            {reportHistory.map(item => (
              <li
                key={item.id}
                className={`group flex items-center gap-3 py-2.5 transition-colors ${
                  lastReport?.id === item.id ? 'bg-accent-soft' : 'hover:bg-sunken'
                } -mx-2 rounded-md px-2`}
              >
                <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[10px] font-medium text-ink-muted">
                  {REPORT_TYPE_LABEL[item.type] ?? item.type}
                </span>
                {item.edited === true && (
                  <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent-ink">
                    已编辑
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => viewReport(item)}
                  disabled={editing}
                  className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
                  title={editing ? '请先保存或取消当前编辑' : '查看这份报告'}
                >
                  <p className="truncate text-sm text-ink">{item.content.split('\n')[0] || '（无内容）'}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {new Date(item.createdAt).toLocaleString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' · '}{templateLabel(item.template)}
                  </p>
                </button>
                {item.edited === true && (
                  <button
                    type="button"
                    onClick={() => revertReport(item.id)}
                    disabled={editing}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-accent-soft hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
                    title="还原到原始内容"
                  >
                    还原
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDeleteReport(item.id)}
                  disabled={editing}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger-ink disabled:cursor-not-allowed disabled:opacity-50"
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
        /* 无数据提示 - 与其余区块同一容器规范 */
        <section className="rounded-xl border border-line bg-surface p-6 text-center shadow-card">
          <svg className="mx-auto h-12 w-12 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="mt-3 text-sm font-medium text-ink">该日期暂无数据</p>
          <p className="mt-1 text-xs text-ink-faint">选择其他日期或开始采集活动数据</p>
        </section>
      ) : (
        <>
          {/* 统计概览：四张同一容器，层级只由数值字号与颜色承载 */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <p className="text-xs font-medium text-ink-muted">总活动数</p>
              <p className="mt-2 text-h2 font-bold tabular-nums text-accent-ink">{reportData.total}</p>
            </div>

            <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <p className="text-xs font-medium text-ink-muted">活跃应用</p>
              <p className="mt-2 text-h3 font-semibold tabular-nums text-ink">{reportData.apps.length}</p>
            </div>

            <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <p className="text-xs font-medium text-ink-muted">主要类型</p>
              <div className="mt-2 flex items-center gap-2">
                {reportData.categories[0] && (
                  <>
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: categoryVisual(reportData.categories[0][0]).color }}
                    />
                    <span className="truncate text-h3 font-semibold text-ink">
                      {categoryVisual(reportData.categories[0][0]).label}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <p className="text-xs font-medium text-ink-muted">报告质量</p>
              <div className="mt-2 flex items-baseline gap-1">
                <p className="text-h3 font-semibold tabular-nums text-ink">{reportData.quality.score}</p>
                <span className="text-xs text-ink-faint">/ 100</span>
              </div>
              <p className="mt-1 text-xs text-ink-muted" title={reportData.quality.detail}>{reportData.quality.label}</p>
            </div>
          </section>

          {/* 应用排行表 */}
          <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-h3 font-semibold text-ink mb-3">应用使用排行</h2>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="pb-2 text-left text-xs font-medium text-ink-muted">#</th>
                    <th className="pb-2 text-left text-xs font-medium text-ink-muted">应用</th>
                    <th className="pb-2 text-right text-xs font-medium text-ink-muted">次数</th>
                    <th className="pb-2 text-right text-xs font-medium text-ink-muted">时长</th>
                    <th className="pb-2 text-left text-xs font-medium text-ink-muted pl-4">分类</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {reportData.apps.slice(0, 10).map((app, i) => (
                    <tr key={app.app} className="group hover:bg-sunken transition-colors">
                      <td className="py-2.5 tabular-nums text-ink-faint">{i + 1}</td>
                      <td className="py-2.5 font-medium text-ink">{app.app}</td>
                      <td className="py-2.5 text-right tabular-nums text-ink-muted">{app.count}</td>
                      <td className="py-2.5 text-right tabular-nums text-ink-muted">{formatDuration(app.duration) ?? '-'}</td>
                      <td className="py-2.5 pl-4">
                        <div className="flex flex-wrap gap-1">
                          {app.categories.map(cat => {
                            const visual = categoryVisual(cat)
                            return (
                              <span
                                key={cat}
                                className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                style={{
                                  backgroundColor: visual.soft,
                                  color: visual.color,
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

          {/* 分类分布（条形图） */}
          <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-h3 font-semibold text-ink mb-3">分类分布</h2>
            
            {/* 分布条 */}
            <div className="mb-3 h-2.5 w-full overflow-hidden rounded-full bg-sunken flex">
              {reportData.categories.map(([cat, count]) => {
                const visual = categoryVisual(cat)
                const pct = Math.round((count / reportData.total) * 100)
                return (
                  <div
                    key={cat}
                    style={{ width: `${pct}%`, backgroundColor: visual.color }}
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
                  <div key={cat} className="flex items-center gap-2 rounded-md bg-sunken px-2 py-1.5">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: visual.color }} />
                    <span className="truncate text-xs text-ink-muted">{visual.label}</span>
                    <span className="ml-auto tabular-nums text-xs text-ink-faint">{pct}%</span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* 时间热力图 */}
          <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-h3 font-semibold text-ink mb-3">时间分布</h2>

            {/* 基线与仪表盘 24 小时图一致；取 ink-faint/70 而非 border-line：
                后者在两个主题下都只有 1.2–1.4:1，实测看不见，等于柱子仍然悬空 */}
            <div className="flex h-20 items-end gap-0.5 overflow-hidden border-b border-ink-faint/70">
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
                      hasActivity ? 'opacity-100 hover:opacity-75' : 'opacity-20 bg-sunken'
                    }`}
                    style={{
                      height: `${Math.max(ratio * 100, hasActivity ? 3 : 0)}%`,
                      backgroundColor: dominantCat ? categoryVisual(dominantCat).color : undefined,
                    }}
                  />
                )
              })}
            </div>

            <div className="mt-2 flex justify-between text-[10px] tabular-nums text-ink-faint">
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
