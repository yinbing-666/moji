import { useState } from 'react'
import { useActivityStore, type Activity } from '../stores/activityStore'
import { categoryVisual } from '../utils/categoryStyles'
import { ScreenshotModal } from './ScreenshotModal'

interface ActivityTimelineProps {
  activities: Activity[]
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  const { updateActivity, removeActivity } = useActivityStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [previewBase64, setPreviewBase64] = useState<string | null>(null)

  const handleSaveEdit = (id: string) => {
    updateActivity(id, { description: editText.trim() })
    setEditingId(null)
  }

  const handleRemove = (id: string) => {
    if (window.confirm('确定删除这条活动记录？')) {
      removeActivity(id)
    }
  }

  /* P1优化: 时间轴容器 - 删除入场动画 */
  return (
    <div className="space-y-2">
      {activities.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          {/* P1优化: 空状态 - emoji替换为SVG图标 */}
          <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="mt-3 text-sm text-gray-500">暂无活动记录</p>
          <p className="mt-1 text-xs text-gray-400">开始采集后，这里会显示你的工作活动时间轴</p>
        </div>
      )}

      {activities.map((activity) => {
        const visual = categoryVisual(activity.category)
        const isEditing = editingId === activity.id

        return (
          <article
            key={activity.id}
            className={`group relative rounded-xl border bg-white transition-shadow hover:shadow-elevated ${
              isEditing 
                ? 'border-brand-300 ring-1 ring-brand-100' 
                : 'border-gray-200/60 shadow-card'
            }`}
          >
            {/* P1优化: 左侧色条强调分类 */}
            <div className="flex">
              <div className="w-1 shrink-0 rounded-l-lg" style={{ backgroundColor: visual.hex }} />
              
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

                    {/* 应用名 + 分类标签 */}
                    <div className="mt-1.5 flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-gray-900">{activity.app}</h3>
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
                      /* P1优化: 编辑框 - 简化样式 */
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

                  {/* 操作按钮组 - P1优化: 使用图标按钮替代文字 */}
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

                {/* P1优化: 截图缩略图 - 删除hover放大动画 */}
                {activity.screenshotBase64 && !isEditing && (
                  <div className="mt-3 overflow-hidden rounded-md border border-gray-100 bg-gray-50">
                    <img
                      src={`data:image/jpeg;base64,${activity.screenshotBase64}`}
                      alt={`${activity.app} 活动截图`}
                      className="h-auto max-h-32 w-full object-cover cursor-pointer transition-opacity hover:opacity-90"
                      onClick={() => setPreviewBase64(activity.screenshotBase64 ?? null)}
                    />
                  </div>
                )}
              </div>
            </div>
          </article>
        )
      })}

      {/* P1优化: 截图预览Modal - 已在ScreenshotModal中优化 */}
      <ScreenshotModal base64={previewBase64} onClose={() => setPreviewBase64(null)} />
    </div>
  )
}
