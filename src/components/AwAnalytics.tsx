import { useCallback, useEffect, useState } from 'react'
import { runAwAnalytics, openAwReport, dbAwHealth, type AwAnalyticsResult } from '../utils/db'

const LEVEL_LABEL: Record<string, string> = {
  focus: '深度专注',
  other_work: '常规工作',
  neutral: '中性',
  personal: '个人休闲',
  distracting: '分心',
}

const LEVEL_COLOR: Record<string, string> = {
  focus: '#0d9488',
  other_work: '#6366f1',
  neutral: '#94a3b8',
  personal: '#f59e0b',
  distracting: '#ef4444',
}

const PERIOD_OPTIONS = [
  { value: 'today', label: '今天' },
  { value: 'this-week', label: '本周' },
  { value: 'last-week', label: '上周' },
]

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} 分钟`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`
}

/** AW 效率分析(基于 ActivityWatch Analytics Skill,任何数据源模式可用) */
export function AwAnalytics() {
  const [period, setPeriod] = useState('today')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AwAnalyticsResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [awOnline, setAwOnline] = useState<boolean | null>(null)

  // 检测 ActivityWatch 是否在运行
  useEffect(() => {
    let cancelled = false
    void dbAwHealth().then(info => {
      if (!cancelled) setAwOnline(Boolean(info))
    })
    return () => { cancelled = true }
  }, [])

  const generate = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await runAwAnalytics(period)
      if (!r) throw new Error('分析失败，请确认 Python 与 ActivityWatch 可用')
      setResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [period])

  return (
    <section className="rounded-xl border border-gray-200/60 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-h3 font-semibold text-gray-900">效率分析</h2>
          <p className="mt-0.5 text-xs text-gray-500">基于 ActivityWatch 数据离线计算（本地 Python，隐私聚合）</p>
        </div>
        <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 ring-1 ring-teal-200">
          Pulse 效率评分
        </span>
      </div>

      {awOnline === false && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
          未检测到 ActivityWatch（默认 127.0.0.1:5600）。请先启动 ActivityWatch 再生成效率报告。
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {PERIOD_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setPeriod(opt.value)}
            className={`rounded-md border px-3 py-1.5 text-sm transition-all ${
              period === opt.value
                ? 'border-brand-500 bg-brand-50/30 text-brand-700'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading}
          className="ml-auto rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? '分析中…' : '生成效率报告'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">{error}</p>
      )}

      {result && (
        <div className="mt-4 space-y-4">
          {/* Pulse 评分 + 核心指标 */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-xs text-gray-500">效率评分</p>
              <p className="mt-1 text-2xl font-semibold text-brand-600 tabular-nums">
                {result.pulse.toFixed(1)}
              </p>
              <p className="text-xs text-gray-400">
                {result.score_status === 'calibrated' ? '已校准' : '估算'}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-xs text-gray-500">活跃时长</p>
              <p className="mt-1 text-base font-semibold text-gray-900 tabular-nums">
                {fmtDuration(result.active_seconds)}
              </p>
              <p className="text-xs text-gray-400">专注 {result.productive_percent.toFixed(0)}%</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-xs text-gray-500">深度工作</p>
              <p className="mt-1 text-base font-semibold text-gray-900 tabular-nums">
                {fmtDuration(result.deep_work_seconds)}
              </p>
              <p className="text-xs text-gray-400">{result.deep_work_blocks} 个专注块</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-xs text-gray-500">AI 使用</p>
              <p className="mt-1 text-base font-semibold text-gray-900 tabular-nums">
                {fmtDuration(result.ai_seconds)}
              </p>
              <p className="text-xs text-gray-400">辅助时间</p>
            </div>
          </div>

          {/* 生产力等级分布 */}
          {result.levels.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-gray-500">生产力等级分布</p>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100">
                {result.levels.filter(l => l.seconds > 0).map(l => (
                  <div
                    key={l.level}
                    title={`${LEVEL_LABEL[l.level] ?? l.level} ${l.percent.toFixed(1)}%`}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                    style={{ width: `${l.percent}%`, backgroundColor: LEVEL_COLOR[l.level] ?? '#94a3b8' }}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {result.levels.filter(l => l.seconds > 0).map(l => (
                  <span key={l.level} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: LEVEL_COLOR[l.level] ?? '#94a3b8' }} />
                    <span className="text-gray-600">{LEVEL_LABEL[l.level] ?? l.level}</span>
                    <span className="tabular-nums text-gray-400">{l.percent.toFixed(1)}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 打开完整报告 */}
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50/50 p-3">
            <div>
              <p className="text-sm font-medium text-gray-900">完整报告（{result.period_id}）</p>
              <p className="text-xs text-gray-500">自包含 HTML · 隐私聚合 · 含 SVG 图表</p>
            </div>
            <button
              type="button"
              onClick={() => void openAwReport(result.report_html)}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700"
            >
              打开 HTML 报告
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
