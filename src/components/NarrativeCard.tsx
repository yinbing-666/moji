import { useNarrativeCard } from '../hooks/useNarrativeCard'
import { categoryVisual } from '../utils/categoryStyles'
import type { Activity } from '../stores/activityStore'

interface NarrativeCardProps {
  activities: Activity[]
}

function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

export function NarrativeCard({ activities }: NarrativeCardProps) {
  const { text, isLLM, summary } = useNarrativeCard({ activities })
  const hasData = summary.totalSeconds > 0

  if (!hasData) return null

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-h3 font-semibold text-ink">今日概览</h2>
        {isLLM && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent-ink">
            AI 摘要
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-6 text-ink">{text}</p>
      <div className="mt-3 space-y-1.5 text-xs">
        {summary.activeRange && (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 font-medium text-ink-muted">活跃区间</span>
            <span className="font-medium tabular-nums text-ink">
              {formatClock(summary.activeRange.start)}–{formatClock(summary.activeRange.end)}
            </span>
            <span className="text-ink-faint">约 {formatDuration(summary.activeRange.totalSeconds)}</span>
          </div>
        )}
        {summary.longestFocus && (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 font-medium text-ink-muted">最长专注</span>
            <span className="font-medium text-ink">{summary.longestFocus.app}</span>
            <span className="text-ink-faint">{formatDuration(summary.longestFocus.seconds)}</span>
          </div>
        )}
        {summary.mainThread && (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className="shrink-0 rounded px-1.5 py-0.5 font-medium"
              style={{ backgroundColor: categoryVisual(summary.mainThread.category).soft, color: categoryVisual(summary.mainThread.category).color }}
            >
              今日主线
            </span>
            <span className="font-medium text-ink">{categoryVisual(summary.mainThread.category).label}</span>
            <span className="text-ink-faint">
              {summary.mainThread.app} · 占比 {Math.round(summary.mainThread.share * 100)}%
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
