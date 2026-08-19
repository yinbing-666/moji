import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { ActivityProvider, useActivityStore, type ThemeMode } from './stores/activityStore'
import { Settings } from './components/Settings'
import { ActivityTimeline } from './components/ActivityTimeline'
import { ReportView } from './components/ReportView'
import { TodayOverview } from './components/TodayOverview'
import { useAutoCapture } from './hooks/useAutoCapture'
import mojiMark from './assets/moji-mark-v2.png'
import { getAppearanceSkin } from './utils/appearance'
import { categoryVisual } from './utils/categoryStyles'
import { localDateKey } from './utils/date'

function isToday(iso: string) {
  return localDateKey(iso) === localDateKey(new Date())
}

type Page = 'dashboard' | 'timeline' | 'report' | 'settings'

const NAV_ITEMS: Array<{ page: Page; label: string; iconPath: string }> = [
  {
    page: 'dashboard',
    label: '仪表盘',
    iconPath: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  },
  {
    page: 'timeline',
    label: '时间轴',
    iconPath: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    page: 'report',
    label: '报告',
    iconPath: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  },
  {
    page: 'settings',
    label: '设置',
    iconPath: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z|M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  },
]

/* 内容区页面头：标题 + 描述 + 右侧操作 */
function PageHeader({ title, desc, children }: { title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-h1 font-bold text-gray-900">{title}</h1>
        {desc && <p className="mt-1 text-sm text-gray-500">{desc}</p>}
      </div>
      {children}
    </div>
  )
}

function Dashboard({ onGoSettings }: { onGoSettings: () => void }) {
  const { activities } = useActivityStore()

  const todaySummary = useMemo(() => {
    const todayActivities = activities.filter(activity => isToday(activity.timestamp))
    return { latest: todayActivities[0], count: todayActivities.length }
  }, [activities])

  const latestVisual = todaySummary.latest ? categoryVisual(todaySummary.latest.category) : null

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader
        title="仪表盘"
        desc={new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
      />

      <TodayOverview activities={activities} />

      {/* 最近活动卡片 - 左侧色条强调 */}
      <section className="rounded-r-xl border-l-4 border-l-brand-500 bg-surface p-4 shadow-card">
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
                <p className="mt-0.5 text-sm text-gray-500">开始采集后，工作痕迹会实时出现在这里。</p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onGoSettings}
            className="shrink-0 rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700"
          >
            采集设置
          </button>
        </div>
      </section>
    </div>
  )
}

function TimelinePage({ activities }: { activities: import('./stores/activityStore').Activity[] }) {
  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader title="时间轴" desc="按时间倒序的完整活动记录，支持搜索与筛选" />
      <ActivityTimeline activities={activities} />
    </div>
  )
}

function ReportPage({ activities }: { activities: import('./stores/activityStore').Activity[] }) {
  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader title="报告" desc="固定格式日报、AI 报告与可选效率分析" />
      <ReportView activities={activities} />
    </div>
  )
}

function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <PageHeader title="设置" desc="数据源、采集行为、隐私与外观" />
      <Settings />
    </div>
  )
}

function AppShell() {
  const { settings, activities, updateSettings, isAnalyzing } = useActivityStore()
  const { isRunning, isCapturing, latestScreenshot, error, start, stop, captureNow } = useAutoCapture()
  const [page, setPage] = useState<Page>('dashboard')
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  const themeMode = settings.appearance?.themeMode ?? 'system'
  const resolvedTheme: Exclude<ThemeMode, 'system'> = themeMode === 'system'
    ? systemDark ? 'dark' : 'light'
    : themeMode

  const isConfigured = Boolean(settings.apiKey.trim() && settings.baseUrl.trim() && settings.textModel.trim())
  const localMode = settings.dataSource === 'local'
  const captureConfigured = localMode || isConfigured

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    setSystemDark(media.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolvedTheme === 'dark')
    root.style.colorScheme = resolvedTheme
    root.dataset.theme = resolvedTheme
    root.dataset.themeMode = themeMode
  }, [resolvedTheme, themeMode])

  // 皮肤同时作用于应用画布与侧栏，避免左右区域割裂。
  useEffect(() => {
    const preset = settings.appearance?.backgroundPreset ?? 'plain'
    const skin = getAppearanceSkin(resolvedTheme, preset, settings.appearance?.customBackground)
    const root = document.documentElement
    root.style.setProperty('--app-bg', skin.canvas)
    root.style.setProperty('--sidebar-bg', skin.sidebar)
  }, [resolvedTheme, settings.appearance])

  const handleCaptureToggle = () => {
    if (isRunning) {
      stop()
      return
    }
    if (captureConfigured) {
      start()
    }
  }

  const statusLabel = localMode
    ? (isCapturing ? '本地采集中' : isRunning ? '本地运行中' : '已停止')
    : (isAnalyzing ? 'LLM 分析中' : isCapturing ? '采集中' : isRunning ? '运行中' : '已停止')
  const statusActive = isRunning || isAnalyzing

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--app-bg)' }}>
      {/* 侧边栏：主题表面色与内容区分隔，导航 + 采集控制常驻 */}
      <aside
        className="flex w-16 shrink-0 flex-col border-r border-gray-200/80 backdrop-blur-md sm:w-60"
        style={{ background: 'var(--sidebar-bg)' }}
      >
        {/* Logo 区 */}
        <div className="flex items-center justify-center gap-3 px-2 pb-5 pt-6 sm:justify-start sm:px-5">
          <img src={mojiMark} alt="墨记" className="h-9 w-9 shrink-0" />
          <div className="hidden sm:block">
            <p className="text-sm font-bold text-gray-900">墨记</p>
            <p className="text-2xs text-gray-400">记录工作痕迹</p>
          </div>
        </div>

        {/* 导航：表面色凸起表示选中 */}
        <nav className="flex-1 space-y-1 px-2 sm:px-3">
          {NAV_ITEMS.map(item => (
            <button
              key={item.page}
              type="button"
              onClick={() => setPage(item.page)}
              aria-current={page === item.page ? 'page' : undefined}
              aria-label={item.label}
              className={`flex w-full items-center justify-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition-colors sm:justify-start sm:px-3 ${
                page === item.page
                  ? 'bg-surface text-gray-900 shadow-sm ring-1 ring-gray-200/80'
                  : 'text-gray-500 hover:bg-gray-200/60 hover:text-gray-700'
              }`}
            >
              <svg className={`h-4 w-4 shrink-0 ${page === item.page ? 'text-brand-600' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                {item.iconPath.split('|').map((d, i) => (
                  <path key={i} strokeLinecap="round" strokeLinejoin="round" d={d} />
                ))}
              </svg>
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* 底部：采集状态 + 主控开关 */}
        <div className="space-y-3 border-t border-gray-200 px-2 pb-5 pt-4 sm:px-4">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${statusActive ? 'bg-brand-500 animate-pulse-dot' : 'bg-gray-300'}`} />
              <span className={`hidden sm:inline ${statusActive ? 'text-gray-700' : 'text-gray-400'}`}>{statusLabel}</span>
            </span>
            <span className="hidden rounded bg-gray-200/80 px-1.5 py-0.5 text-2xs text-gray-500 sm:inline">
              {localMode ? '无 LLM' : '有 LLM'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleCaptureToggle}
            disabled={!isRunning && !captureConfigured}
            aria-label={isRunning ? '停止采集' : '开始采集'}
            className={`w-full rounded-lg px-1.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:px-4 ${
              isRunning
                ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                : 'bg-brand-600 text-white hover:bg-brand-700'
            }`}
          >
            <span className="sm:hidden">{isRunning ? '停止' : '开始'}</span>
            <span className="hidden sm:inline">{isRunning ? '停止采集' : '开始采集'}</span>
          </button>

          <button
            type="button"
            onClick={() => void captureNow()}
            disabled={!captureConfigured || isCapturing || isAnalyzing}
            aria-label="立即采集一次"
            className="w-full rounded-lg px-1 py-1.5 text-xs text-gray-400 transition-colors hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4"
          >
            <span className="sm:hidden">{isCapturing || isAnalyzing ? '处理中' : '采集'}</span>
            <span className="hidden sm:inline">{isCapturing || isAnalyzing ? '处理中…' : '立即采集一次'}</span>
          </button>
        </div>
      </aside>

      {/* 内容区 */}
      <main className="relative flex-1 overflow-y-auto">
        {/* 错误提示 */}
        {error && (
          <div className="mx-auto max-w-5xl px-8 pt-6">
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* 配置引导：未配置 AI 时给出两条明确路径 */}
        {page === 'dashboard' && !isConfigured && !localMode && (
          <div className="mx-auto max-w-5xl px-8 pt-6">
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200/80 bg-surface p-4 shadow-card">
              <div className="flex items-start gap-2.5 min-w-0">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-gray-900">开始记录你的工作痕迹</p>
                  <p className="mt-0.5 text-xs text-gray-600">配置 AI 识别，或切换到无 LLM 模式，使用本地固定规则记录活动。</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setPage('settings')}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700"
                >
                  去配置 AI
                </button>
                <button
                  type="button"
                  onClick={() => updateSettings({ dataSource: 'local' })}
                  className="rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-brand-400 hover:text-brand-700"
                >
                  使用无 LLM 模式
                </button>
              </div>
            </div>
          </div>
        )}

        {page === 'dashboard' && <Dashboard onGoSettings={() => setPage('settings')} />}
        {page === 'timeline' && <TimelinePage activities={activities} />}
        {page === 'report' && <ReportPage activities={activities} />}
        {page === 'settings' && <SettingsPage />}

        {/* 截图预览浮窗 */}
        {latestScreenshot && (
          <div className="fixed bottom-4 right-4 w-48 overflow-hidden rounded-xl border border-gray-200 bg-surface shadow-elevated">
            <img
              src={`data:image/jpeg;base64,${latestScreenshot}`}
              alt="最近活动预览"
              className="h-auto w-full"
            />
            <div className="bg-surface px-2 py-1 text-center text-xs text-gray-500">
              最近活动预览
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <ActivityProvider>
      <AppShell />
    </ActivityProvider>
  )
}
