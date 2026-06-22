import { useState } from 'react'
import { useActivityStore, type Activity } from '../stores/activityStore'
import { ScreenshotModal } from './ScreenshotModal'

const CATEGORY_LABEL: Record<Activity['category'], string> = {
  dev: '开发',
  meeting: '会议',
  doc: '文档',
  communication: '沟通',
  other: '其他',
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function ActivityItem({ activity }: { activity: Activity }) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors group">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">{activity.app}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
              {CATEGORY_LABEL[activity.category] || activity.category}
            </span>
            <span className="text-xs text-gray-400 ml-auto shrink-0">{formatTime(activity.timestamp)}</span>
          </div>
          <p className="text-sm text-gray-600 mt-0.5 truncate">{activity.description}</p>
          {activity.title && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{activity.title}</p>
          )}
        </div>
        {activity.screenshotBase64 && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="flex-shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
            aria-label="Open screenshot preview"
          >
            <img
              src={`data:image/jpeg;base64,${activity.screenshotBase64}`}
              alt="Screenshot thumbnail"
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

  const handleClear = () => {
    if (window.confirm('确定清空所有活动记录？此操作不可撤销。')) {
      clearActivities()
    }
  }

  if (activities.length === 0) {
    return (
      <div role="status" className="text-center py-16 text-gray-500">
        <p className="text-sm font-medium text-gray-700">No activity records yet</p>
        <p className="text-xs mt-1">Start capture after configuring your API key.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-gray-700">Activity records ({activities.length})</h2>
        <button
          type="button"
          onClick={handleClear}
          className="text-xs text-gray-500 hover:text-red-600 transition-colors"
        >
          Clear
        </button>
      </div>
      <div className="space-y-1 max-h-[60vh] overflow-y-auto">
        {activities.map(a => <ActivityItem key={a.id} activity={a} />)}
      </div>
    </div>
  )
}
