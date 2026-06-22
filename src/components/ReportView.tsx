import { useState } from 'react'
import { useActivityStore, type Activity } from '../stores/activityStore'
import { generateReport } from '../utils/ai'

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
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleGenerate = async (type: 'daily' | 'weekly' | 'monthly') => {
    if (!settings.apiKey.trim()) {
      setReport('Please configure an API Key in Settings first.')
      return
    }

    const reportableActivities = activities.filter(a => a.description.trim())
    if (reportableActivities.length === 0) {
      setReport('No activity records yet. Start capture first.')
      return
    }

    setLoading(true)
    try {
      const result = await generateReport(
        reportableActivities.map(activityToRaw),
        type,
        'standard',
        settings.apiKey,
        settings.baseUrl,
      )
      setReport(result)
    } catch (err) {
      setReport('Report generation failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(report)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleGenerate('daily')}
          disabled={loading}
          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {loading ? '生成中...' : '日报'}
        </button>
        <button
          type="button"
          onClick={() => handleGenerate('weekly')}
          disabled={loading}
          className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300 disabled:opacity-50 transition-colors"
        >
          周报
        </button>
        <button
          type="button"
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
              type="button"
              onClick={handleCopy}
              className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-600 transition-colors"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="p-4 pr-16 bg-gray-50 rounded-lg text-sm text-gray-800 whitespace-pre-wrap overflow-x-auto max-h-[50vh] overflow-y-auto border border-gray-200">
            {report}
          </pre>
        </div>
      )}
    </div>
  )
}
