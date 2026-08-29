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
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {summary.activeRange && (
          <span>
            活跃区间 {formatClock(summary.activeRange.start)}–{formatClock(summary.activeRange.end)}
            （约 {formatDuration(summary.activeRange.totalSeconds)}）
          </span>
        )}
        {summary.longestFocus && (
          <span>
            最长专注 {summary.longestFocus.app} {formatDuration(summary.longestFocus.seconds)}
          </span>
        )}
        {summary.mainThread && (
          <span>
            今日主线 {categoryVisual(summary.mainThread.category).label}（{summary.mainThread.app}，
            占比 {Math.round(summary.mainThread.share * 100)}%）
          </span>
        )}
      </div>
    </section>
  )
}
