import { useEffect, useMemo, useState } from 'react'
import { ActivityProvider, useActivityStore, type BackgroundPreset } from './stores/activityStore'
import { Settings } from './components/Settings'
import { ActivityTimeline } from './components/ActivityTimeline'
import { ReportView } from './components/ReportView'
import { TodayOverview } from './components/TodayOverview'
import { useAutoCapture } from './hooks/useAutoCapture'
import { categoryVisual } from './utils/categoryStyles'

function isToday(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString()
}

function Dashboard({ onGoSettings }: { onGoSettings: () => void }) {
  const { activities, isAnalyzing, settings, syncFromAw, updateSettings } = useActivityStore()
  const { isRunning, isCapturing, latestScreenshot, error, start, stop, captureNow } = useAutoCapture()
  const [tab, setTab] = useState<'timeline' | 'report'>('timeline')
  const isConfigured = Boolean(settings.apiKey.trim() && settings.baseUrl.trim() && settings.textModel.trim())
  // 双源并行:window_text / both 启用窗口文本采集,aw / both 启用 AW 同步
  const windowTextEnabled = settings.dataSource !== 'aw'
  const awEnabled = settings.dataSource !== 'window_text'

  // AW 模式：按配置间隔自动同步（无需 API Key）
  useEffect(() => {
    if (!awEnabled) return
    void syncFromAw().catch(() => {})
    const minutes = Math.max(1, settings.awSyncMinutes || 5)
    const timer = window.setInterval(() => {
      void syncFromAw().catch(() => {})
    }, minutes * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [awEnabled, settings.awSyncMinutes, syncFromAw])

  const todaySummary = useMemo(() => {
    const todayActivities = activities.filter(activity => isToday(activity.timestamp))
    return { latest: todayActivities[0] }
  }, [activities])

  const handleCaptureToggle = () => {
    if (isRunning) {
      stop()
      return
    }
    if (!windowTextEnabled) {
      // 未启用窗口文本采集（纯 AW 模式）：手动触发一次同步
      void syncFromAw().catch(() => {})
      return
    }
    if (isConfigured) {
      start()
    }
  }

  const latestVisual = todaySummary.latest ? categoryVisual(todaySummary.latest.category) : null

  return (
    <div
      className="min-h-screen pb-24"
      style={{ background: 'var(--app-bg, #f8fafc)' }}
    >
      {/* P0优化: Header - 简化Logo + 删除渐变 */}
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            {/* P2优化: Logo - 纯色方块替代渐变 */}
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-900 text-lg font-bold text-white">
              墨
            </div>
            <div>
              {/* P1优化: 字号层级调整 */}
              <h1 className="text-h1 font-bold text-gray-900 tracking-tight">墨记</h1>
              {/* P1优化: Slogan情感化 */}
              <p className="text-2xs text-gray-400">记录每一天的工作痕迹</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {awEnabled && (
              <span className="inline-flex items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs text-teal-700">
                <span className="h-2 w-2 rounded-full bg-teal-500 animate-pulse-dot" />
                AW
              </span>
            )}
            {windowTextEnabled && (
              <span className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors ${
                isAnalyzing
                  ? 'border-orange-200 bg-orange-50 text-orange-700'
                  : isRunning
                    ? 'border-teal-200 bg-teal-50 text-teal-700'
                    : 'border-gray-200 bg-gray-50 text-gray-400'
              }`}>
                <span className={`h-2 w-2 rounded-full ${isAnalyzing ? 'bg-orange-500 animate-pulse-dot' : isRunning ? 'bg-teal-500' : 'bg-gray-300'}`} />
                {isAnalyzing ? '分析中' : isCapturing ? '采集中' : isRunning ? '运行中' : '已停止'}
              </span>
            )}

            {/* P0优化: 主CTA按钮 - 纯色替代渐变 */}
            <button
              type="button"
              onClick={handleCaptureToggle}
              disabled={!windowTextEnabled ? false : !isRunning && !isConfigured}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isRunning
                  ? 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                  : 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800'
              }`}
            >
              {windowTextEnabled ? (isRunning ? '停止' : '开始采集') : '立即同步'}
            </button>
          </div>
        </div>
      </header>

      {/* P1优化: 错误提示 - 删除动画 */}
      {error && (
        <div className="mx-auto mt-4 max-w-4xl px-6">
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* 配置引导：未配置 AI 时给出两条明确路径，而不是让用户对着禁用按钮发呆 */}
      {!isConfigured && windowTextEnabled && (
        <div className="mx-auto mt-4 max-w-4xl px-6">
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-2.5 min-w-0">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-amber-900">开始记录你的工作痕迹</p>
                <p className="mt-0.5 text-xs text-amber-800">配置 AI 识别（窗口文本分析），或先用 ActivityWatch 同步桌面活动（无需 API Key）。</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={onGoSettings}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700"
              >
                去配置 AI
              </button>
              <button
                type="button"
                onClick={() => updateSettings({ dataSource: 'aw' })}
                className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
              >
                先试试 ActivityWatch
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-4xl px-6 py-6">
        <TodayOverview activities={activities} />

        {/* P1优化: 最近活动卡片 - 左侧色条强调 */}
        <section className="mb-6 border-l-4 border-l-brand-500 bg-white rounded-r-xl p-4 shadow-card">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-gray-500">最近活动</p>
              {todaySummary.latest ? (
                <div className="mt-2 flex items-start gap-3">
                  {latestVisual && (
                    <span className="mt-1 h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: latestVisual.hex }} />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{todaySummary.latest.app}</p>
                    <p className="mt-0.5 truncate text-sm text-gray-600">{todaySummary.latest.description}</p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mt-2 text-sm font-medium text-gray-900">暂无最近活动</p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {!windowTextEnabled
                      ? '等待 ActivityWatch 数据同步，或点右上角「立即同步」。'
                      : '配置完成后，可以手动采集一次验证识别效果。'}
                  </p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => void captureNow()}
              disabled={!windowTextEnabled || !isConfigured || isCapturing || isAnalyzing}
              className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCapturing || isAnalyzing ? '处理中' : '立即采集'}
            </button>
          </div>
        </section>

        {/* P1优化: Tab切换器 - 下划线指示器（伪元素实现，切换时有平滑过渡） */}
        <div className="mb-6 flex border-b border-gray-200">
          <button
            type="button"
            onClick={() => setTab('timeline')}
            className={`relative px-4 py-2 text-sm font-medium transition-colors after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:origin-left after:bg-brand-500 after:transition-transform after:duration-200 ${
              tab === 'timeline'
                ? 'text-brand-700 after:scale-x-100'
                : 'text-gray-500 after:scale-x-0 hover:text-gray-700'
            }`}
          >
            活动
          </button>
          <button
            type="button"
            onClick={() => setTab('report')}
            className={`relative px-4 py-2 text-sm font-medium transition-colors after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:origin-left after:bg-brand-500 after:transition-transform after:duration-200 ${
              tab === 'report'
                ? 'text-brand-700 after:scale-x-100'
                : 'text-gray-500 after:scale-x-0 hover:text-gray-700'
            }`}
          >
            报告
          </button>
        </div>

        {/* P1优化: 内容区 - 删除入场动画 */}
        <div>
          {tab === 'timeline' ? <ActivityTimeline activities={activities} /> : <ReportView activities={activities} />}
        </div>
      </main>

      {/* 截图预览浮窗 - 删除动画 */}
      {latestScreenshot && (
        <div className="fixed bottom-20 right-4 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-md">
          <img
            src={`data:image/jpeg;base64,${latestScreenshot}`}
            alt="最近活动预览"
            className="h-auto w-full"
          />
          <div className="bg-white px-2 py-1 text-center text-xs text-gray-500">
            最近活动预览
          </div>
        </div>
      )}
    </div>
  )
}

function SettingsPage() {
  return (
    <div
      className="min-h-screen pb-24"
      style={{ background: 'var(--app-bg, #f8fafc)' }}
    >
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-3">
          {/* P2优化: 设置页Logo - 与首页统一风格 */}
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-900 text-lg font-bold text-white">
            墨
          </div>
          <h1 className="text-h1 font-bold text-gray-900 tracking-tight">设置</h1>
        </div>
      </header>
      {/* P1优化: 设置页容器 - 删除动画 + 使用左侧色条风格 */}
      <main className="mx-auto max-w-4xl px-6 py-6">
        <Settings />
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
      {/* P0优化: 底部导航栏 - 改为固定底栏 + 下划线指示器 + 删除emoji */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl">
          <button
            type="button"
            onClick={() => setPage('dashboard')}
            className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
              page === 'dashboard'
                ? 'text-brand-700 border-b-2 border-brand-500 -mb-px'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {/* P0优化: 用SVG图标替代emoji 🏠 */}
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            首页
          </button>
          
          <button
            type="button"
            onClick={() => setPage('settings')}
            className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
              page === 'settings'
                ? 'text-brand-700 border-b-2 border-brand-500 -mb-px'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {/* P0优化: 用SVG图标替代emoji ⚙️ */}
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </button>
        </div>
      </nav>

      {page === 'dashboard' ? <Dashboard onGoSettings={() => setPage('settings')} /> : <SettingsPage />}
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
