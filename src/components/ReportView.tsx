import { useState } from 'react'
import { useActivityStore, type Activity } from '../stores/activityStore'
import { generateReport } from '../utils/ai'
import { exportReportAsMarkdown } from '../utils/export'
import {
  addReportHistoryItem,
  loadReportHistory,
  removeReportHistoryItem,
  type ReportHistoryItem,
  type ReportType,
} from '../utils/reportHistory'

const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  daily: '日报',
  weekly: '周报',
  monthly: '月报',
}

type ReportRange = 'today' | 'all'
type ReportNotice = { tone: 'info' | 'error'; text: string } | null

const REPORT_RANGE_LABEL: Record<ReportRange, string> = {
  today: '今天',
  all: '全部记录',
}

function isToday(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString()
}

// 归一化后 description 永远非空，缺失时为占位符「无描述」；
// 只有有实质内容的记录才应进入报告。
function hasReportableContent(a: Activity) {
  const description = a.description.trim()
  return description !== '' && description !== '无描述'
}

function activityToRaw(a: Activity) {
  return {
    timestamp: a.timestamp,
    description: a.description,
    category: a.category,
    app_name: a.app,
  }
}

export function ReportView() {
  const { activities, settings } = useActivityStore()
  const [report, setReport] = useState('')
  const [notice, setNotice] = useState<ReportNotice>(null)
  const [reportType, setReportType] = useState<ReportType>('daily')
  const [reportRange, setReportRange] = useState<ReportRange>('today')
  const [history, setHistory] = useState<ReportHistoryItem[]>(loadReportHistory)
  const [loadingType, setLoadingType] = useState<ReportType | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedHistoryId, setCopiedHistoryId] = useState<string | null>(null)

  const handleGenerate = async (type: ReportType) => {
    setReportType(type)

    if (!settings.apiKey.trim()) {
      setReport('')
      setNotice({ tone: 'error', text: '请先在设置里配置 API Key。' })
      return
    }

    const reportableActivities = activities.filter(a => (
      hasReportableContent(a)
      && (reportRange === 'all' || isToday(a.timestamp))
    ))
    if (reportableActivities.length === 0) {
      setReport('')
      setNotice({
        tone: 'info',
        text: reportRange === 'today'
          ? '今天还没有可用于生成报告的活动记录。可以先开始截图，或切换到“全部记录”。'
          : '还没有活动记录，请先开始截图。',
      })
      return
    }

    setNotice(null)
    setLoadingType(type)
    try {
      const result = await generateReport(
        reportableActivities.map(activityToRaw),
        type,
        settings.apiKey,
        settings.baseUrl,
        settings.reportModel,
      )
      setReport(result)
      setNotice(null)
      setHistory(prev => addReportHistoryItem(prev, type, result))
    } catch (err) {
      setReport('')
      setNotice({
        tone: 'error',
        text: '报告生成失败：' + (err instanceof Error ? err.message : String(err)),
      })
    } finally {
      setLoadingType(null)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(report)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const copyHistoryItem = async (item: ReportHistoryItem) => {
    await navigator.clipboard.writeText(item.content)
    setCopiedHistoryId(item.id)
    window.setTimeout(() => {
      setCopiedHistoryId(current => (current === item.id ? null : current))
    }, 2000)
  }

  const restoreHistoryItem = (item: ReportHistoryItem) => {
    setReport(item.content)
    setNotice(null)
    setReportType(item.type)
  }

  const removeHistoryItem = (id: string) => {
    if (!window.confirm('确定删除这条历史报告？此操作不可撤销。')) {
      return
    }
    setHistory(prev => removeReportHistoryItem(prev, id))
  }

  const reportLabel = REPORT_TYPE_LABEL[reportType]
  const reportableCount = activities.filter(activity => (
    hasReportableContent(activity)
    && (reportRange === 'all' || isToday(activity.timestamp))
  )).length

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-gray-900">生成报告</h2>
        <p className="mt-1 text-xs text-gray-500">
          当前范围：{REPORT_RANGE_LABEL[reportRange]}，可用活动 {reportableCount} 条。
        </p>
      </div>
      <div className="flex w-fit gap-1 rounded-lg bg-gray-100 p-1">
        {(['today', 'all'] as ReportRange[]).map(range => (
          <button
            key={range}
            type="button"
            onClick={() => setReportRange(range)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              reportRange === range
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {REPORT_RANGE_LABEL[range]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleGenerate('daily')}
          disabled={loadingType !== null}
          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {loadingType === 'daily' ? '生成中...' : '日报'}
        </button>
        <button
          type="button"
          onClick={() => handleGenerate('weekly')}
          disabled={loadingType !== null}
          className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50 transition-colors"
        >
          {loadingType === 'weekly' ? '生成中...' : '周报'}
        </button>
        <button
          type="button"
          onClick={() => handleGenerate('monthly')}
          disabled={loadingType !== null}
          className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50 transition-colors"
        >
          {loadingType === 'monthly' ? '生成中...' : '月报'}
        </button>
      </div>

      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border px-3 py-2 text-sm ${
            notice.tone === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          {notice.text}
        </div>
      )}

      {report && (
        <div className="relative">
          <div className="absolute top-2 right-2 flex gap-2">
            <button
              type="button"
              onClick={() => exportReportAsMarkdown(report, reportLabel)}
              className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-600 transition-colors"
            >
              下载
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-600 transition-colors"
            >
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <pre className="p-4 pr-24 bg-gray-50 rounded-lg text-sm text-gray-800 whitespace-pre-wrap overflow-x-auto max-h-[50vh] overflow-y-auto border border-gray-200">
            {report}
          </pre>
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-gray-900">历史报告</h2>
            <p className="mt-0.5 text-xs text-gray-500">最多保留最近 20 条，保存在本机。</p>
          </div>
          <span className="shrink-0 text-xs text-gray-400">{history.length} 条</span>
        </div>

        {history.length === 0 ? (
          <div role="status" className="mt-3 rounded-lg border border-dashed border-gray-300 py-8 text-center">
            <p className="text-sm font-medium text-gray-700">还没有历史报告</p>
            <p className="mt-1 text-xs text-gray-500">生成报告后会自动出现在这里。</p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {history.map(item => (
              <div key={item.id} className="rounded-lg border border-gray-200 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                        {REPORT_TYPE_LABEL[item.type]}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(item.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-gray-600">
                      {item.content.replace(/\s+/g, ' ').slice(0, 120)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 text-xs">
                    <button type="button" onClick={() => restoreHistoryItem(item)} className="rounded bg-gray-100 px-2 py-1 text-gray-600 hover:bg-gray-200">
                      恢复
                    </button>
                    <button type="button" onClick={() => void copyHistoryItem(item)} className="rounded bg-gray-100 px-2 py-1 text-gray-600 hover:bg-gray-200">
                      {copiedHistoryId === item.id ? '已复制' : '复制'}
                    </button>
                    <button type="button" onClick={() => exportReportAsMarkdown(item.content, REPORT_TYPE_LABEL[item.type])} className="rounded bg-gray-100 px-2 py-1 text-gray-600 hover:bg-gray-200">
                      下载
                    </button>
                    <button type="button" onClick={() => removeHistoryItem(item.id)} className="rounded px-2 py-1 text-gray-500 hover:bg-red-50 hover:text-red-600">
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
