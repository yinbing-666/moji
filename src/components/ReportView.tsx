import { useState } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { generateReport } from '../utils/ai'

function activityToRaw(a: { timestamp: string; description: string; category: string; app: string; title: string }) {
  return { timestamp: a.timestamp, description: a.description, category: a.category, app_name: a.app }
}

export function ReportView() {
  const { activities, settings } = useActivityStore()
  const [report, setReport] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleGenerate = async (type: 'daily' | 'weekly' | 'monthly') => {
    if (!settings.apiKey) {
      setReport('⚠️ 请先在设置中配置 API Key')
      return
    }
    if (activities.length === 0) {
      setReport('⚠️ 暂无活动记录，请先开始截图')
      return
    }

    setLoading(true)
    try {
      const result = await generateReport(activities.map(activityToRaw), type, 'standard', settings.apiKey, settings.baseUrl)
      setReport(result)
    } catch (err) {
      setReport('❌ 生成失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(report)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => handleGenerate('daily')}
          disabled={loading}
          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {loading ? '生成中...' : '生成日报'}
        </button>
        <button
          onClick={() => handleGenerate('weekly')}
          disabled={loading}
          className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50 transition-colors"
        >
          周报
        </button>
        <button
          onClick={() => handleGenerate('monthly')}
          disabled={loading}
          className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50 transition-colors"
        >
          月报
        </button>
      </div>

      {report && (
        <div className="relative">
          <div className="absolute top-2 right-2">
            <button
              onClick={handleCopy}
              className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-600 transition-colors"
            >
              {copied ? '✓ 已复制' : '复制'}
            </button>
          </div>
          <pre className="p-4 bg-gray-50 rounded-lg text-sm text-gray-800 whitespace-pre-wrap overflow-x-auto max-h-[50vh] overflow-y-auto border border-gray-200">
            {report}
          </pre>
        </div>
      )}
    </div>
  )
}
