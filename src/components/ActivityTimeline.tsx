import { useState } from 'react'
import { useActivityStore, type Activity } from '../stores/activityStore'
import { ScreenshotModal } from './ScreenshotModal'

const CATEGORY_EMOJI: Record<string, string> = {
  dev: '💻', meeting: '📅', doc: '📝', communication: '💬', other: '📌',
}

const CATEGORY_LABEL: Record<string, string> = {
  dev: '开发', meeting: '会议', doc: '文档', communication: '沟通', other: '其他',
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function ActivityItem({ activity }: { activity: Activity }) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors group">
        <span className="text-lg mt-0.5">{CATEGORY_EMOJI[activity.category] || '📌'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">{activity.app}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
              {CATEGORY_LABEL[activity.category] || activity.category}
            </span>
            <span className="text-xs text-gray-400 ml-auto">{formatTime(activity.timestamp)}</span>
          </div>
          <p className="text-sm text-gray-600 mt-0.5 truncate">{activity.description}</p>
          {activity.title && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{activity.title}</p>
          )}
        </div>
        {activity.screenshotBase64 && (
          <button
            onClick={() => setModalOpen(true)}
            className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <img
              src={`data:image/png;base64,${activity.screenshotBase64}`}
              alt="缩略图"
              className="w-16 h-10 object-cover rounded border border-gray-200 hover:border-green-400 transition-colors"
            />
          </button>
        )}
      </div>
      {modalOpen && activity.screenshotBase64 && (
        <ScreenshotModal base64={activity.screenshotBase64} onClose={() => setModalOpen(false)} />
      )}
    </>
  )
}

export function ActivityTimeline() {
  const { activities, clearActivities } = useActivityStore()

  if (activities.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-4xl mb-3">📭</p>
        <p className="text-sm">暂无活动记录</p>
        <p className="text-xs mt-1">开启自动截图后，AI 会分析你的工作内容</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700">活动记录 ({activities.length})</h3>
        <button
          onClick={clearActivities}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          清空
        </button>
      </div>
      <div className="space-y-1 max-h-[60vh] overflow-y-auto">
        {activities.map(a => <ActivityItem key={a.id} activity={a} />)}
      </div>
    </div>
  )
}
