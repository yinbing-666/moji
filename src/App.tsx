import { useEffect, useMemo, useState } from 'react'
import { ActivityProvider, useActivityStore, type Activity, type BackgroundPreset } from './stores/activityStore'
import { Settings } from './components/Settings'
import { ActivityTimeline } from './components/ActivityTimeline'
import { ReportView } from './components/ReportView'
import { useAutoCapture } from './hooks/useAutoCapture'

const CATEGORY_LABEL: Record<Activity['category'], string> = {
  dev: '开发',
  meeting: '会议',
  doc: '文档',
  communication: '沟通',
  other: '其他',
}

function isToday(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString()
}

function Dashboard() {
  const { activities, isAnalyzing, settings, syncFromAw } = useActivityStore()
  const { isRunning, isCapturing, latestScreenshot, error, start, stop, captureNow } = useAutoCapture()
  const [tab, setTab] = useState<'timeline' | 'report'>('timeline')
  const isConfigured = Boolean(settings.apiKey.trim() && settings.baseUrl.trim())
  const isAwMode = settings.dataSource === 'aw'

  // AW 模式：按配置间隔自动同步（无需 API Key）
  useEffect(() => {
    if (!isAwMode) return
    void syncFromAw().catch(() => {})
    const minutes = Math.max(1, settings.awSyncMinutes || 5)
    const timer = window.setInterval(() => {
      void syncFromAw().catch(() => {})
    }, minutes * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [isAwMode, settings.awSyncMinutes, syncFromAw])

  const todaySummary = useMemo(() => {
    const todayActivities = activities.filter(activity => isToday(activity.timestamp))
    const appCount = new Map<string, number>()
    const categoryCount = new Map<Activity['category'], number>()

    for (const activity of todayActivities) {
      appCount.set(activity.app, (appCount.get(activity.app) ?? 0) + 1)
      categoryCount.set(activity.category, (categoryCount.get(activity.category) ?? 0) + 1)
    }

    const topApp = [...appCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '暂无'
    const topCategory = [...categoryCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

    return {
      count: todayActivities.length,
      topApp,
      topCategory: topCategory ? CATEGORY_LABEL[topCategory] : '暂无',
      latest: todayActivities[0],
    }
  }, [activities])

  const handleCaptureToggle = () => {
    if (isRunning) {
      stop()
      return
    }
    if (isAwMode) {
      // AW 模式：无需截图，手动触发一次同步
      void syncFromAw().catch(() => {})
      return
    }
    if (isConfigured) {
      start()
    }
  }

  return (
    <div
      className="min-h-screen pb-20"
      style={{ background: 'var(--app-bg, #f9fafb)' }}
    >
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between max-w-4xl mx-auto gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center text-white text-sm font-bold">
              墨
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">墨记</h1>
              <p className="text-xs text-gray-500">本地工作复盘助手</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              {isAwMode ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-gray-600">AW 同步中</span>
                </>
              ) : isRunning ? (
                <>
                  <span className={`w-2 h-2 rounded-full ${isAnalyzing ? 'bg-yellow-400 animate-pulse' : 'bg-green-500'}`} />
                  <span className="text-gray-600">
                    {isAnalyzing ? 'AI 分析中' : isCapturing ? '截图中' : '运行中'}
                  </span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-gray-300" />
                  <span className="text-gray-500">已停止</span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={handleCaptureToggle}
              disabled={!isRunning && !isAwMode && !isConfigured}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isRunning
                  ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isAwMode ? '立即同步' : isRunning ? '停止' : '开始截图'}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-4xl mx-auto mt-4 px-6">
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        </div>
      )}

      {!isConfigured && !isAwMode && (
        <div className="max-w-4xl mx-auto mt-4 px-6">
          <div role="status" className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            开始截图前，请先在设置里配置 API Key 和 Base URL。
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-6 py-6">
        <section className="grid gap-3 sm:grid-cols-3 mb-6">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">今日记录</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{todaySummary.count}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">主要应用</p>
            <p className="mt-1 truncate text-lg font-semibold text-gray-900">{todaySummary.topApp}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">主要类型</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{todaySummary.topCategory}</p>
          </div>
        </section>

        <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-gray-500">最近活动</p>
              {todaySummary.latest ? (
                <>
                  <p className="mt-1 truncate text-sm font-medium text-gray-900">{todaySummary.latest.app}</p>
                  <p className="mt-0.5 truncate text-sm text-gray-600">{todaySummary.latest.description}</p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm font-medium text-gray-900">暂无最近活动</p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {isAwMode
                      ? '等待 ActivityWatch 数据同步，或点右上角「立即同步」。'
                      : '配置完成后，可以手动截一次图验证识别效果。'}
                  </p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => void captureNow()}
              disabled={isAwMode || !isConfigured || isCapturing || isAnalyzing}
              className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCapturing || isAnalyzing ? '处理中' : '立即截图'}
            </button>
          </div>
        </section>

        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setTab('timeline')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'timeline' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            活动
          </button>
          <button
            type="button"
            onClick={() => setTab('report')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'report' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            报告
          </button>
        </div>

        {tab === 'timeline' ? <ActivityTimeline /> : <ReportView />}
      </main>

      {latestScreenshot && (
        <div className="fixed bottom-4 right-4 w-48 rounded-lg overflow-hidden shadow-lg border border-gray-200 bg-white">
          <img
            src={`data:image/jpeg;base64,${latestScreenshot}`}
            alt="最近截图"
            className="w-full h-auto"
          />
          <div className="px-2 py-1 text-xs text-gray-500 text-center bg-white">
            最近截图
          </div>
        </div>
      )}
    </div>
  )
}

function SettingsPage() {
  return (
    <div
      className="min-h-screen pb-20"
      style={{ background: 'var(--app-bg, #f9fafb)' }}
    >
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-lg font-semibold text-gray-900">设置</h1>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-6">
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <Settings />
        </div>
      </main>
    </div>
  )
}

const BG_GRADIENTS: Record<BackgroundPreset, string> = {
  plain: '',
  mint: 'linear-gradient(135deg, #d4f5e9 0%, #e8f5e9 50%, #f0f7f4 100%)',
  sky: 'linear-gradient(135deg, #dceefb 0%, #e8f0fe 50%, #f0f4f8 100%)',
  graphite: 'linear-gradient(135deg, #e8eaed 0%, #f1f3f4 50%, #f8f9fa 100%)',
  custom: '',
}

function AppShell() {
  const { settings } = useActivityStore()
  const [page, setPage] = useState<'dashboard' | 'settings'>('dashboard')

  // 同步背景到 CSS 变量
  useEffect(() => {
    const preset = settings.appearance?.backgroundPreset ?? 'plain'
    const bg = preset === 'custom'
      ? settings.appearance?.customBackground
        ? `url(${settings.appearance.customBackground}) center / cover fixed`
        : ''
      : BG_GRADIENTS[preset]
    document.documentElement.style.setProperty('--app-bg', bg || 'none')
  }, [settings.appearance])

  return (
    <>
      <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white rounded-full shadow-lg border border-gray-200 px-2 py-1 flex gap-1">
        <button
          type="button"
          onClick={() => setPage('dashboard')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            page === 'dashboard' ? 'bg-green-600 text-white' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          首页
        </button>
        <button
          type="button"
          onClick={() => setPage('settings')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            page === 'settings' ? 'bg-green-600 text-white' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          设置
        </button>
      </nav>

      {page === 'dashboard' ? <Dashboard /> : <SettingsPage />}
    </>
  )
}

export default function App() {
  return (
    <ActivityProvider>
      <AppShell />
    </ActivityProvider>
  )
}
