import type { AwAnalyticsResult } from '../utils/db'
import type { AwReportData, AwReportRank } from '../utils/awReport'

const LEVEL_LABEL: Record<string, string> = {
  focus: '深度专注',
  other_work: '常规工作',
  neutral: '中性',
  personal: '个人休闲',
  distracting: '分心',
}

const LEVEL_COLOR: Record<string, string> = {
  focus: 'var(--color-ok)',
  other_work: 'var(--color-info)',
  neutral: 'var(--color-ink-muted)',
  personal: 'var(--color-warn)',
  distracting: 'var(--color-danger)',
}

const PRIVACY_LABEL: Record<string, string> = {
  window_titles: '窗口标题',
  full_urls: '完整网址',
  domains: '网站域名',
  raw_events: '原始事件',
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function fmtDuration(seconds = 0): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

function fmtPercent(value = 0): string {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`
}

function fmtSigned(value: number, digits: number, suffix: string): string {
  const normalized = Math.abs(value) < 0.05 ? 0 : value
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(digits)}${suffix}`
}

function fmtDate(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

function rankLabel(item: AwReportRank): string {
  return (item.app ?? item.domain ?? '未命名').replace(/\.exe$/i, '')
}

function categoryLabel(value: string): string {
  if (/^uncategorized$/i.test(value)) return '其他'
  return value
}

function privacyValue(value: string): string {
  const labels: Record<string, string> = {
    stored_locally: '仅本地保存',
    not_collected: '未采集',
    aggregated: '仅聚合',
    excluded: '已排除',
  }
  return labels[value] ?? value
}

function trendPoints(values: number[]): string {
  if (values.length === 0) return ''
  const max = Math.max(...values, 100)
  return values.map((value, index) => {
    const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100
    const y = 94 - (clamp(value, 0, max) / max) * 76
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}

function rankList(items: AwReportRank[], emptyLabel: string, hasDuration: boolean) {
  const top = items.slice(0, 6)
  const max = Math.max(...top.map(item => hasDuration ? item.seconds : (item.count ?? 0)), 1)
  if (top.length === 0) return <p className="py-4 text-center text-xs text-ink-faint">{emptyLabel}</p>

  return (
    <div className="space-y-3">
      {top.map((item, index) => (
        <div key={`${rankLabel(item)}-${index}`}>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-medium text-ink-muted">{rankLabel(item)}</span>
            <span className="shrink-0 tabular-nums text-ink-faint">
              {hasDuration ? fmtDuration(item.seconds) : `${item.count ?? 0} 条记录`}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.max(4, ((hasDuration ? item.seconds : (item.count ?? 0)) / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

interface AwReportDashboardProps {
  report: AwReportData
  result?: AwAnalyticsResult | null
  onOpenHtml?: () => void
}

export function AwReportDashboard({ report, result, onOpenHtml }: AwReportDashboardProps) {
  const summary = report.summary
  const hasDuration = summary.has_duration_data !== false
  const score = clamp(summary.pulse ?? result?.pulse ?? 0, 0, 100)
  const trend = (report.trend ?? []).slice(-14)
  const coverageTrend = trend.filter(item => item.active_seconds > 0).slice(-7)
  const hourly = summary.hourly ?? []
  const maxHour = Math.max(...hourly, 1)
  const levels = (summary.levels ?? []).filter(level => level.seconds > 0)
  const categories = (summary.categories ?? []).slice(0, 6)
  const categoryMax = Math.max(...categories.map(category => hasDuration ? category.seconds : (category.count ?? 0)), 1)
  const insights = report.insights ?? []
  const rules = report.rule_health
  const focus = summary.focus_analysis
  const sourceLabel = '墨记本地采集'
  const periodLabel = report.period?.label ?? result?.period_id ?? '当前周期'
  const statusLabel = summary.score_status === 'calibrated' ? '已校准' : '待校准'
  const pulseChange = report.comparison?.previous_available ? report.comparison.pulse_change : null
  const activeChange = report.comparison?.previous_available ? report.comparison.active_percent_change : null
  const productiveChange = report.comparison?.previous_available ? report.comparison.productive_percent_change : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-accent-ink">墨记效率</p>
          <h3 className="mt-1 text-lg font-semibold text-ink">效率分析概览</h3>
          <p className="mt-1 text-xs text-ink-muted">{periodLabel}{report.period?.start && report.period?.end ? ` · ${fmtDate(report.period.start)}—${fmtDate(report.period.end)}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent-ink">{sourceLabel}</span>
          <span className="rounded-full border border-line px-2.5 py-1 text-ink-muted">{statusLabel}</span>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center gap-4">
            <div
              className="relative h-28 w-28 shrink-0 rounded-full p-2"
              style={{ background: `conic-gradient(var(--color-brand-500) ${score}%, var(--color-line-soft) 0)` }}
              aria-label={`效率评分 ${score.toFixed(0)} 分`}
            >
              <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-surface">
                <span className="text-2xl font-semibold tabular-nums text-ink">{summary.score_status === 'calibrated' ? score.toFixed(0) : '待校准'}</span>
                <span className="text-[11px] text-ink-faint">/ 100</span>
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-ink-muted">本周期效率评分</p>
              <p className="mt-1 text-sm font-medium text-ink">{statusLabel}</p>
              <p className="mt-2 text-xs leading-5 text-ink-muted">
                {summary.score_status !== 'calibrated'
                  ? '本地数据可用于观察结构，积累足够历史后再校准评分。'
                  : pulseChange === null || pulseChange === undefined
                    ? '当前还没有可比较的历史基线。'
                  : `较上一周期 ${pulseChange >= 0 ? '提升' : '下降'} ${Math.abs(pulseChange).toFixed(1)} 分。`}
              </p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [hasDuration ? '活跃时长' : '活动记录', hasDuration ? fmtDuration(summary.active_seconds ?? result?.active_seconds ?? 0) : `${summary.activity_count ?? 0} 条`, hasDuration ? '记录到的活动时间' : '当前周期采集数量'],
            ['专注占比', fmtPercent(summary.productive_percent ?? result?.productive_percent ?? 0), '被标记为生产力活动'],
            ['深度工作', hasDuration ? fmtDuration(summary.deep_work?.seconds ?? result?.deep_work_seconds ?? 0) : `${summary.deep_work?.block_count ?? 0} 条`, hasDuration ? `${summary.deep_work?.block_count ?? result?.deep_work_blocks ?? 0} 个专注块` : '开发类活动记录'],
            ['AI 工具使用时长', hasDuration ? fmtDuration(summary.ai_seconds ?? result?.ai_seconds ?? 0) : `${summary.ai_count ?? 0} 条`, hasDuration ? '识别到的辅助工具时间' : '识别到的辅助工具记录'],
          ].map(([label, value, note]) => (
            <section key={label} className="rounded-lg border border-line bg-surface p-3">
              <p className="text-xs text-ink-muted">{label}</p>
              <p className="mt-2 text-lg font-semibold tabular-nums text-ink">{value}</p>
              <p className="mt-1 text-[11px] text-ink-faint">{note}</p>
            </section>
          ))}
        </div>
      </div>

      {report.comparison?.previous_available && (
        <section className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
          {[
            ['投入变化', activeChange === null || activeChange === undefined ? '基线不足' : fmtSigned(activeChange, 0, '%'), '较上周同期活跃时长'],
            ['专注变化', productiveChange === null || productiveChange === undefined ? '基线不足' : fmtSigned(productiveChange, 1, ' 个百分点'), '开发与文档活动占比'],
            ['效率变化', pulseChange === null || pulseChange === undefined ? '基线不足' : fmtSigned(pulseChange, 1, ' 分'), '同一套本地评分口径'],
          ].map(([label, value, note]) => (
            <div key={label} className="bg-surface px-4 py-3">
              <p className="text-[11px] text-ink-muted">{label}</p>
              <p className="mt-1 text-base font-semibold tabular-nums text-ink">{value}</p>
              <p className="mt-0.5 text-[11px] text-ink-faint">{note}</p>
            </div>
          ))}
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-ink">分类分布</h4>
            <span className="text-xs text-ink-faint">{fmtPercent(summary.category_coverage_percent)} 已分类</span>
          </div>
          {categories.length === 0 ? <p className="py-6 text-center text-xs text-ink-faint">暂无分类数据</p> : (
            <div className="space-y-3">
              {categories.map(category => (
                <div key={category.path}>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate font-medium text-ink-muted">{categoryLabel(category.path)}</span>
                    <span className="shrink-0 tabular-nums text-ink-faint">{hasDuration ? fmtDuration(category.seconds) : `${category.count ?? 0} 条`} · {fmtPercent(category.percent)}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(3, ((hasDuration ? category.seconds : (category.count ?? 0)) / categoryMax) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-ink">生产力趋势</h4>
              <p className="mt-0.5 text-xs text-ink-faint">最近 {trend.length || 0} 个周期</p>
            </div>
            <span className="text-xs text-ink-faint">0—100</span>
          </div>
          {trend.length === 0 ? <p className="py-6 text-center text-xs text-ink-faint">暂无趋势数据</p> : (
            <div>
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-40 w-full overflow-visible" role="img" aria-label="生产力趋势图">
                {[20, 45, 70, 95].map(y => <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="var(--color-line-soft)" strokeWidth="0.7" />)}
                <polyline points={trendPoints(trend.map(item => item.pulse))} fill="none" stroke="var(--color-brand-500)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
                <span>{trend[0]?.date?.slice(5) ?? ''}</span>
                <span>{trend[trend.length - 1]?.date?.slice(5) ?? ''}</span>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-ink">小时活动</h4>
            <span className="text-xs text-ink-faint">按小时聚合</span>
          </div>
          {hourly.length === 0 ? <p className="py-6 text-center text-xs text-ink-faint">暂无小时数据</p> : (
            <div className="flex h-36 items-end gap-1.5 sm:gap-2">
              {hourly.map((seconds, hour) => (
                <div key={hour} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <div className="group relative flex h-28 w-full items-end">
                    <div
                      className="w-full rounded-t-sm bg-accent/75 transition-colors group-hover:bg-accent"
                      style={{ height: `${seconds > 0 ? Math.max(7, (seconds / maxHour) * 100) : 3}%` }}
                        title={`${String(hour).padStart(2, '0')}:00 · ${hasDuration ? fmtDuration(seconds) : `${seconds} 条记录`}`}
                    />
                  </div>
                  {hour % 3 === 0 ? <span className="text-[10px] tabular-nums text-ink-faint">{String(hour).padStart(2, '0')}</span> : <span className="h-3" />}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-line bg-surface p-4">
          <h4 className="mb-3 text-sm font-semibold text-ink">生产力等级</h4>
          {levels.length === 0 ? <p className="py-6 text-center text-xs text-ink-faint">暂无等级数据</p> : (
            <div className="space-y-2.5">
              {levels.map(level => (
                <div key={level.level} className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-2 text-ink-muted">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: LEVEL_COLOR[level.level] ?? 'var(--color-ink-muted)' }} />
                    <span className="truncate">{LEVEL_LABEL[level.level] ?? level.level}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-faint">{fmtPercent(level.percent)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-ink">专注与打断</h4>
            <p className="mt-0.5 text-xs text-ink-faint">连续开发／文档活动合并为专注段，25 分钟以上计为深度工作。</p>
          </div>
          <span className="text-xs text-ink-faint">应用切换 {focus?.switch_count ?? 0} 次</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['专注总时长', hasDuration ? fmtDuration(focus?.focus_seconds ?? 0) : `${focus?.focus_block_count ?? 0} 段`, `${focus?.focus_block_count ?? 0} 个连续专注段`],
            ['最长专注', hasDuration ? fmtDuration(focus?.longest_focus_seconds ?? 0) : '时长不足', `${focus?.deep_block_count ?? 0} 个深度工作块`],
            ['打断', `${focus?.interruption_count ?? 0} 次`, hasDuration ? `共 ${fmtDuration(focus?.interruption_seconds ?? 0)}` : '夹在专注活动之间'],
            ['短碎片', `${focus?.fragment_count ?? 0} 段`, hasDuration ? `共 ${fmtDuration(focus?.fragment_seconds ?? 0)}` : '少于 5 分钟的活动'],
          ].map(([label, value, note]) => (
            <div key={label} className="border-l-2 border-accent bg-sunken px-3 py-2">
              <p className="text-xs text-ink-muted">{label}</p>
              <p className="mt-1 text-base font-semibold tabular-nums text-ink">{value}</p>
              <p className="mt-0.5 text-[11px] text-ink-faint">{note}</p>
            </div>
          ))}
        </div>
        {(focus?.top_interruptions?.length ?? 0) > 0 && (
          <div className="mt-3 border-t border-line-soft pt-3">
            <p className="mb-2 text-xs font-medium text-ink-muted">主要打断来源</p>
            <div className="flex flex-wrap gap-2">
              {focus?.top_interruptions?.map(item => (
                <span key={item.app} className="rounded-full bg-warn-soft px-2.5 py-1 text-xs text-warn-ink">
                  {item.app} · {item.count} 次{hasDuration ? ` · ${fmtDuration(item.seconds)}` : ''}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-ink">应用排行</h4>
            <span className="text-xs text-ink-faint">{hasDuration ? '按活跃时长' : '按记录条数'}</span>
          </div>
            {rankList(summary.apps ?? [], '暂无应用数据', hasDuration)}
        </section>
        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-ink">网站排行</h4>
            <span className="text-xs text-ink-faint">仅保留聚合域名</span>
          </div>
            {rankList(summary.domains ?? [], '暂无网站数据', hasDuration)}
        </section>
      </div>

      <section className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-ink">洞察与建议</h4>
          <span className="text-xs text-ink-faint">基于规则和数据证据</span>
        </div>
        {insights.length === 0 ? <p className="py-4 text-center text-xs text-ink-faint">暂无新的洞察</p> : (
          <div className="grid gap-3 md:grid-cols-2">
            {insights.map((insight, index) => (
              <article key={`${insight.title ?? 'insight'}-${index}`} className="rounded-md border-l-3 border-l-accent bg-sunken p-3">
                <div className="flex items-start justify-between gap-3">
                  <h5 className="text-sm font-medium text-ink">{insight.title ?? '活动洞察'}</h5>
                  <span className="shrink-0 text-[11px] text-ink-faint">{insight.severity === 'warning' ? '需关注' : '提示'}</span>
                </div>
                {insight.evidence && <p className="mt-2 text-xs leading-5 text-ink-muted">{insight.evidence}</p>}
                {insight.action && <p className="mt-2 text-xs leading-5 text-ink-muted">建议：{insight.action}</p>}
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface p-4">
          <h4 className="mb-3 text-sm font-semibold text-ink">规则健康度</h4>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-sunken p-2"><p className="text-lg font-semibold tabular-nums text-ink">{rules?.rule_count ?? 0}</p><p className="text-[11px] text-ink-faint">规则</p></div>
            <div className="rounded-md bg-sunken p-2"><p className="text-lg font-semibold tabular-nums text-ink">{rules?.issue_count ?? 0}</p><p className="text-[11px] text-ink-faint">问题</p></div>
            <div className="rounded-md bg-sunken p-2"><p className="text-lg font-semibold tabular-nums text-ink">{fmtPercent(rules?.coverage_percent)}</p><p className="text-[11px] text-ink-faint">覆盖率</p></div>
          </div>
          {(rules?.suggestions?.length ?? 0) > 0 && (
            <div className="mt-3 border-t border-line-soft pt-3">
              <p className="text-xs font-medium text-ink-muted">优先处理的未分类项目</p>
              <div className="mt-2 space-y-1.5">
                {rules?.suggestions?.slice(0, 3).map((suggestion, index) => (
                  <p key={`${suggestion.source}-${suggestion.value}-${index}`} className="truncate text-xs text-ink-muted" title={suggestion.value}>
                    {suggestion.source}{suggestion.expected_seconds ? ` · ${fmtDuration(suggestion.expected_seconds)}` : ''}：{suggestion.value}
                  </p>
                ))}
              </div>
            </div>
          )}
          {coverageTrend.length > 0 && (
            <div className="mt-3 border-t border-line-soft pt-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-ink-muted">最近 7 个活跃日覆盖率</p>
                <span className="text-[11px] text-ink-faint">越高表示待整理活动越少</span>
              </div>
              <div className="flex h-16 items-end gap-2">
                {coverageTrend.map(item => (
                  <div key={item.date} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${item.date} · ${fmtPercent(item.coverage_percent)}`}>
                    <div className="w-full rounded-t-sm bg-accent group-hover:bg-accent" style={{ height: `${Math.max(4, item.coverage_percent ?? 0)}%` }} />
                    <span className="text-[9px] text-ink-faint">{item.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
        <section className="rounded-lg border border-line bg-surface p-4">
          <h4 className="mb-3 text-sm font-semibold text-ink">数据与隐私</h4>
            <p className="text-xs leading-5 text-ink-muted">报告只使用当前数据源的聚合结果，原始事件不会写入效率报告。</p>
          {report.privacy && <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            {Object.entries(report.privacy).map(([key, value]) => <div key={key} className="flex min-w-0 justify-between gap-2"><span className="text-ink-muted">{PRIVACY_LABEL[key] ?? key}</span><span className="truncate text-right text-ink-faint">{privacyValue(value)}</span></div>)}
          </div>}
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-sunken p-3">
        <div>
          <p className="text-sm font-medium text-ink">{sourceLabel}（{periodLabel}）</p>
          <p className="mt-0.5 text-xs text-ink-muted">APP 内可直接阅读{onOpenHtml ? '，也可导出原始 HTML 分享。' : '。'}</p>
        </div>
        {onOpenHtml && <button type="button" onClick={onOpenHtml} className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink">打开 HTML 报告</button>}
      </div>
    </div>
  )
}
