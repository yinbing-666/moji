import { useCallback, useEffect, useMemo, useState } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { dbAwHealth, dbDiagnoseDb, dbListActivitySources, type ActivitySourceDescriptor } from '../utils/db'

interface CaptureHealthProps {
  isRunning: boolean
  isCapturing: boolean
  captureError: string | null
  onCaptureNow: () => void
}

type HealthTone = 'ok' | 'active' | 'warning' | 'error' | 'info'

const TONE_STYLE: Record<HealthTone, string> = {
  ok: 'bg-emerald-500',
  active: 'bg-brand-500 animate-pulse-dot',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  info: 'bg-gray-400',
}

function relativeTime(timestamp?: string): string {
  if (!timestamp) return '暂无活动记录'
  const elapsed = Math.max(0, Date.now() - Date.parse(timestamp))
  if (elapsed < 60_000) return '刚刚写入'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`
  return new Date(timestamp).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function CaptureHealth({ isRunning, isCapturing, captureError, onCaptureNow }: CaptureHealthProps) {
  const { activities, settings, sqliteReady } = useActivityStore()
  const [awInfo, setAwInfo] = useState<{ version?: string } | null>(null)
  const [dbInfo, setDbInfo] = useState<string | null>(null)
  const [windowSource, setWindowSource] = useState<ActivitySourceDescriptor | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

  const refresh = useCallback(async () => {
    setChecking(true)
    const [aw, db, sources] = await Promise.all([
      dbAwHealth({ host: settings.awHost, port: settings.awPort }),
      dbDiagnoseDb(),
      dbListActivitySources(),
    ])
    setAwInfo(aw)
    setDbInfo(db)
    setWindowSource(sources?.find(source => source.id === 'window') ?? null)
    setCheckedAt(new Date())
    setChecking(false)
  }, [settings.awHost, settings.awPort])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const latest = activities[0]
  const checks = useMemo(() => [
    {
      label: '窗口采集',
      tone: captureError || windowSource?.available === false ? 'error' as const : isCapturing ? 'active' as const : isRunning ? 'ok' as const : 'warning' as const,
      value: captureError ? '采集出现错误' : windowSource?.available === false ? '当前平台采集受限' : isCapturing ? '正在读取窗口' : isRunning ? '定时采集运行中' : '采集已暂停',
      detail: captureError ?? windowSource?.detail ?? `间隔 ${Math.round(settings.intervalSeconds / 60)} 分钟，每轮最多 ${settings.maxWindowsPerCapture} 个窗口`,
    },
    {
      label: '内置 ActivityWatch',
      tone: awInfo ? 'ok' as const : isDesktop ? 'error' as const : 'info' as const,
      value: awInfo ? `服务正常 · v${awInfo.version ?? '未知'}` : isDesktop ? '服务未响应' : '需在桌面端检测',
      detail: `${settings.awHost}:${settings.awPort}，随墨记启动并写入窗口心跳`,
    },
    {
      label: '本地数据库',
      tone: sqliteReady ? 'ok' as const : isDesktop ? 'warning' as const : 'info' as const,
      value: sqliteReady ? 'SQLite 已连接' : isDesktop ? 'SQLite 尚未就绪' : '浏览器模式使用 localStorage',
      detail: dbInfo ?? '活动先写入本地快照，桌面端就绪后同步到 SQLite',
    },
    {
      label: '最近事件',
      tone: latest ? 'ok' as const : 'warning' as const,
      value: relativeTime(latest?.timestamp),
      detail: latest ? `${latest.app} · ${latest.description}` : '开始采集或加载示例数据后，这里会显示最近写入状态',
    },
  ], [activities.length, awInfo, captureError, dbInfo, isCapturing, isDesktop, isRunning, latest, settings.intervalSeconds, settings.maxWindowsPerCapture, settings.awHost, settings.awPort, sqliteReady, windowSource])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-h3 font-semibold text-gray-900">采集链路</h2>
          <p className="mt-1 text-xs text-gray-500">从窗口读取到本地落盘的实时状态，不包含任何云端服务。</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCaptureNow} disabled={isCapturing} className="rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-brand-400 disabled:opacity-50">立即采集</button>
          <button type="button" onClick={() => void refresh()} disabled={checking} className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">{checking ? '检测中…' : '重新检测'}</button>
        </div>
      </div>

      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-surface px-5">
        {checks.map(check => (
          <div key={check.label} className="grid gap-1 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TONE_STYLE[check.tone]}`} />
              <span className="text-sm font-medium text-gray-800">{check.label}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-700">{check.value}</p>
              <p className="mt-0.5 truncate text-xs text-gray-400" title={check.detail}>{check.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <section className="border-l-3 border-brand-400 bg-brand-50/40 px-4 py-3">
        <p className="text-sm font-medium text-gray-900">当前隐私模式：{settings.dataSource === 'local' ? '无 LLM' : '有 LLM'}</p>
        <p className="mt-1 text-xs leading-5 text-gray-600">{settings.dataSource === 'local' ? '窗口信息只在本机经过分类规则处理，不调用外部模型。' : '仅在模型配置完整且采集开启后，将允许的窗口文本发送到用户配置的接口。'}</p>
      </section>

      <p className="text-right text-[11px] text-gray-400">{checkedAt ? `最后检测：${checkedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '尚未检测'}</p>
    </div>
  )
}
