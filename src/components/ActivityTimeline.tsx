import { useMemo, useState } from 'react'
import { useActivityStore, type Activity } from '../stores/activityStore'
import { categoryVisual } from '../utils/categoryStyles'
import { formatDuration } from '../utils/format'
import { ScreenshotModal } from './ScreenshotModal'

interface ActivityTimelineProps {
  activities: Activity[]
}

type CategoryFilter = 'all' | Activity['category']

const CATEGORY_OPTIONS: CategoryFilter[] = ['all', 'dev', 'meeting', 'doc', 'communication', 'other']

function isToday(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString()
}

/** 分组标题：今天 / 昨天 / M月d日（带星期） */
function dateGroupLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  const md = `${d.getMonth() + 1}月${d.getDate()}日 · 周${weekdays[d.getDay()]}`
  if (d.toDateString() === now.toDateString()) return `今天 · ${md}`
  if (d.toDateString() === yesterday.toDateString()) return `昨天 · ${md}`
  return md
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  const { updateActivity, removeActivity } = useActivityStore()
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
      {/* 筛选工具栏 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索应用、标题或描述…"
            aria-label="搜索活动记录"
            className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
          aria-label="按分类筛选"
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
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
              ? 'border-brand-500 bg-brand-50/30 text-brand-700'
              : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
          }`}
        >
          仅看今天
        </button>
      </div>

      {activities.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="mt-3 text-sm text-gray-500">暂无活动记录</p>
          <p className="mt-1 text-xs text-gray-400">开始采集后，这里会显示你的工作活动时间轴</p>
        </div>
      ) : filteredActivities.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">没有匹配的活动记录</p>
          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('')
                setCategoryFilter('all')
                setTodayOnly(false)
              }}
              className="mt-2 text-xs font-medium text-brand-600 hover:text-brand-700"
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
                <h3 className="text-xs font-semibold text-gray-500">{dateGroupLabel(group[0].timestamp)}</h3>
                <span className="text-2xs tabular-nums text-gray-400">{group.length} 条</span>
                <div className="h-px flex-1 bg-gray-200/70" />
              </div>
              <div className="space-y-2">
                {group.map((activity) => {
                  const visual = categoryVisual(activity.category)
                  const isEditing = editingId === activity.id
                  const durationText = formatDuration(activity.durationSeconds)

                  return (
                    <article
                      key={activity.id}
                      className={`group relative rounded-xl border bg-white transition-shadow hover:shadow-elevated ${
                        isEditing
                          ? 'border-brand-300 ring-1 ring-brand-100'
                          : 'border-gray-200/60 shadow-card'
                      }`}
                    >
                      {/* 左侧色条强调分类 */}
                      <div className="flex">
                        <div className="w-1 shrink-0 rounded-l-xl" style={{ backgroundColor: visual.hex }} />

                        <div className="min-w-0 flex-1 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              {/* 时间戳 - 使用标准字号 */}
                              <time className="text-2xs text-gray-400">
                                {new Date(activity.timestamp).toLocaleString('zh-CN', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </time>
                              {durationText && (
                                <span
                                  className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] tabular-nums text-gray-500"
                                  title="活动持续时长"
                                >
                                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  {durationText}
                                </span>
                              )}

                              {/* 应用名 + 分类标签 */}
                              <div className="mt-1.5 flex items-center gap-2">
                                <h4 className="truncate text-sm font-semibold text-gray-900">{activity.app}</h4>
                                <span
                                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                                  style={{
                                    backgroundColor: `${visual.hex}15`,
                                    color: visual.hex,
                                  }}
                                >
                                  {visual.label}
                                </span>
                              </div>

                              {/* 描述内容（可编辑） */}
                              {isEditing ? (
                                <div className="mt-2">
                                  <textarea
                                    value={editText}
                                    onChange={(e) => setEditText(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') setEditingId(null)
                                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSaveEdit(activity.id)
                                    }}
                                    rows={3}
                                    className="w-full rounded-md border border-brand-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
                                    placeholder="编辑活动描述..."
                                    autoFocus
                                  />
                                  <div className="mt-2 flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleSaveEdit(activity.id)}
                                      disabled={!editText.trim()}
                                      className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      保存
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingId(null)}
                                      className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                    >
                                      取消
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className="mt-1.5 text-sm leading-relaxed text-gray-700">
                                  {activity.description || '无描述'}
                                </p>
                              )}
                            </div>

                            {/* 操作按钮组 */}
                            <div className="flex shrink-0 items-start gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              {activity.screenshotBase64 && (
                                <button
                                  type="button"
                                  onClick={() => setPreviewBase64(activity.screenshotBase64 ?? null)}
                                  className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                  title="查看截图"
                                >
                                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(activity.id)
                                  setEditText(activity.description)
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                title="编辑描述"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleRemove(activity.id)}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
                                title="删除记录"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>

                          {/* 截图缩略图 */}
                          {activity.screenshotBase64 && !isEditing && (
                            <div className="mt-3 overflow-hidden rounded-md border border-gray-100 bg-gray-50">
                              <img
                                src={`data:image/jpeg;base64,${activity.screenshotBase64}`}
                                alt={`${activity.app} 活动截图`}
                                className="h-auto max-h-32 w-full cursor-pointer object-cover transition-opacity hover:opacity-90"
                                onClick={() => setPreviewBase64(activity.screenshotBase64 ?? null)}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <ScreenshotModal base64={previewBase64} onClose={() => setPreviewBase64(null)} />
    </div>
  )
}
