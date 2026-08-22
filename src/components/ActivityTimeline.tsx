import { useMemo, useState } from 'react'
import { useActivityStore, type Activity } from '../stores/activityStore'
import { categoryVisual } from '../utils/categoryStyles'
import { formatDuration, formatMonthDayWeekday } from '../utils/format'
import { ScreenshotModal } from './ScreenshotModal'
import { UnclassifiedInbox } from './UnclassifiedInbox'
import { matchClassificationRules } from '../utils/classificationRules'

interface ActivityTimelineProps {
  activities: Activity[]
}

type CategoryFilter = 'all' | Activity['category']

const CATEGORY_OPTIONS: CategoryFilter[] = ['all', 'unclassified', 'dev', 'meeting', 'doc', 'communication', 'other']

function isToday(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString()
}

/** 分组标题：今天 / 昨天 / M月d日（带星期） */
function dateGroupLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const md = formatMonthDayWeekday(d)
  if (d.toDateString() === now.toDateString()) return `今天 · ${md}`
  if (d.toDateString() === yesterday.toDateString()) return `昨天 · ${md}`
  return md
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  const { settings, updateActivity, removeActivity } = useActivityStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [previewBase64, setPreviewBase64] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [todayOnly, setTodayOnly] = useState(false)

  const handleSaveEdit = (id: string) => {
    updateActivity(id, { description: editText.trim() })
    setEditingId(null)
  }

  const handleRemove = (id: string) => {
    if (window.confirm('确定删除这条活动记录？')) {
      removeActivity(id)
    }
  }

  /* 搜索 / 分类 / 仅看今天 过滤 */
  const filteredActivities = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()
    return activities.filter(a => {
      if (todayOnly && !isToday(a.timestamp)) return false
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false
      if (keyword) {
        const haystack = `${a.app}\n${a.title}\n${a.description}`.toLowerCase()
        if (!haystack.includes(keyword)) return false
      }
      return true
    })
  }, [activities, searchQuery, categoryFilter, todayOnly])

  /* 按日期分组（activities 已按时间倒序，Map 保持插入顺序） */
  const groupedActivities = useMemo(() => {
    const groups = new Map<string, Activity[]>()
    for (const a of filteredActivities) {
      const key = new Date(a.timestamp).toDateString()
      const list = groups.get(key)
      if (list) {
        list.push(a)
      } else {
        groups.set(key, [a])
      }
    }
    return Array.from(groups.entries())
  }, [filteredActivities])

  const hasFilter = searchQuery.trim() !== '' || categoryFilter !== 'all' || todayOnly

  return (
    <div>
      <UnclassifiedInbox activities={activities} />
      {/* 筛选工具栏 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索应用、标题或描述…"
            aria-label="搜索活动记录"
            className="w-full rounded-md border border-line-strong bg-surface py-1.5 pl-8 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
          aria-label="按分类筛选"
          className="rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
        >
          {CATEGORY_OPTIONS.map(opt => (
            <option key={opt} value={opt}>
              {opt === 'all' ? '全部分类' : categoryVisual(opt).label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setTodayOnly(v => !v)}
          aria-pressed={todayOnly}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
            todayOnly
              ? 'border-accent bg-accent-soft text-accent-ink'
              : 'border-line-strong bg-surface text-ink-muted hover:border-line-strong'
          }`}
        >
          仅看今天
        </button>
      </div>

      {activities.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="mt-3 text-sm text-ink-muted">暂无活动记录</p>
          <p className="mt-1 text-xs text-ink-faint">开始采集后，这里会显示你的工作活动时间轴</p>
        </div>
      ) : filteredActivities.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface p-8 text-center">
          <p className="text-sm text-ink-muted">没有匹配的活动记录</p>
          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('')
                setCategoryFilter('all')
                setTodayOnly(false)
              }}
              className="mt-2 text-xs font-medium text-accent-ink hover:text-accent-ink"
            >
              清除筛选条件
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {groupedActivities.map(([dateKey, group]) => (
            <section key={dateKey}>
              <div className="mb-2 flex items-center gap-3">
                <h3 className="text-xs font-semibold text-ink-muted">{dateGroupLabel(group[0].timestamp)}</h3>
                <span className="text-2xs tabular-nums text-ink-faint">{group.length} 条</span>
                <div className="h-px flex-1 bg-line" />
              </div>

              {/* 时间轴：一条贯穿竖线，每条记录一行，节点圆点取分类色 */}
              <ol className="relative">
                {/* 竖线取 ink-faint/70：line-strong 在画布上对比仅 1.3:1 实测不可见，宽度补不回对比度 */}
                <span className="absolute bottom-2 left-[3px] top-2 w-px bg-ink-faint/70" aria-hidden />

                {group.map((activity) => {
                  const visual = categoryVisual(activity.category)
                  const isEditing = editingId === activity.id
                  const durationText = formatDuration(activity.durationSeconds)
                  const ruleMatches = matchClassificationRules(activity.app, activity.title, settings.classificationRules)
                  const ruleMatch = ruleMatches[0]
                  const ruleMatchesCategory = ruleMatch?.rule.category === activity.category
                  const timeText = new Date(activity.timestamp).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })

                  /* 分类来源说明：正常命中收进徽章 title，只有需要处理的情况才占一行 */
                  const ruleHint = ruleMatch
                    ? ruleMatchesCategory
                      ? `规则「${ruleMatch.rule.name}」· ${ruleMatch.source === 'app' ? '应用名' : '窗口标题'}包含“${ruleMatch.keyword}”`
                      : `当前分类已修正；规则「${ruleMatch.rule.name}」会归为${categoryVisual(ruleMatch.rule.category).label}`
                    : activity.category === 'unclassified'
                      ? '未命中任何启用的本地规则'
                      : '由 AI 或人工归类，未命中本地规则'
                  const ruleNotice = ruleMatch
                    ? ruleMatchesCategory
                      ? ruleMatches.length > 1 ? `另有 ${ruleMatches.length - 1} 条规则也会命中` : null
                      : ruleHint
                    : activity.category === 'unclassified' ? ruleHint : null

                  const metaText = [
                    activity.browserDomain && `域名 · ${activity.browserDomain}`,
                    activity.ideProject && `项目 · ${activity.ideProject}`,
                  ].filter(Boolean).join('　')

                  return (
                    <li
                      key={activity.id}
                      className={`group relative rounded-lg py-1.5 pl-7 pr-2 transition-colors ${
                        isEditing ? 'bg-sunken ring-1 ring-accent-soft' : 'hover:bg-sunken'
                      }`}
                    >
                      {/* 轴上节点：圆点宽度盖住竖线，形成节点感 */}
                      <span
                        className="absolute left-0 top-[0.6rem] h-[7px] w-[7px] rounded-full"
                        style={{ backgroundColor: visual.color }}
                        aria-hidden
                      />

                      {/* 主信息行：时间 / 应用 / 分类 / 时长 */}
                      <div className="flex items-center gap-2">
                        <time className="shrink-0 text-xs tabular-nums text-ink-faint" dateTime={activity.timestamp}>
                          {timeText}
                        </time>
                        <h4 className="truncate text-sm font-medium text-ink">{activity.app}</h4>
                        {activity.screenshotBase64 && (
                          <button
                            type="button"
                            onClick={() => setPreviewBase64(activity.screenshotBase64 ?? null)}
                            className="shrink-0 text-ink-faint hover:text-ink-muted"
                            title="查看截图"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </button>
                        )}

                        <span
                          className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: visual.soft, color: visual.color }}
                          title={ruleHint}
                        >
                          {visual.label}
                        </span>
                        {durationText && (
                          <span className="shrink-0 text-2xs tabular-nums text-ink-faint" title="活动持续时长">
                            {durationText}
                          </span>
                        )}
                      </div>

                      {/* 描述：可编辑 */}
                      {isEditing ? (
                        <div className="mt-1.5">
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setEditingId(null)
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSaveEdit(activity.id)
                            }}
                            rows={3}
                            className="w-full rounded-md border border-accent bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
                            placeholder="编辑活动描述..."
                            autoFocus
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(activity.id)}
                              disabled={!editText.trim()}
                              className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded-md border border-line-strong px-3 py-1 text-xs font-medium text-ink-muted hover:bg-sunken"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-ink-muted">
                          {activity.description || '无描述'}
                        </p>
                      )}

                      {/* 次级说明行：元数据与需要处理的分类问题，正常态不占高度 */}
                      {!isEditing && (metaText || ruleNotice) && (
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] leading-4 text-ink-faint">
                          {metaText && <span>{metaText}</span>}
                          {ruleNotice && <span className="text-warn-ink">{ruleNotice}</span>}
                        </p>
                      )}

                      {/* 操作按钮组：绝对定位，不占行宽，悬停显现 */}
                      {!isEditing && (
                        <div className="pointer-events-none absolute right-1 top-1 flex items-center gap-0.5 rounded-md border border-line bg-raised opacity-0 shadow-card transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(activity.id)
                              setEditText(activity.description)
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint hover:bg-sunken hover:text-ink-muted"
                            title="编辑描述"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRemove(activity.id)}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint hover:bg-danger-soft hover:text-danger-ink"
                            title="删除记录"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            </section>
          ))}
        </div>
      )}

      <ScreenshotModal base64={previewBase64} onClose={() => setPreviewBase64(null)} />
    </div>
  )
}
