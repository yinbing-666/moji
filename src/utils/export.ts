import type { Activity } from '../stores/activityStore'

const CATEGORY_LABEL: Record<Activity['category'], string> = {
  dev: '开发',
  meeting: '会议',
  doc: '文档',
  communication: '沟通',
  other: '其他',
}

function dateStamp() {
  // 用本地时区拼接 YYYY-MM-DD，避免 toISOString 的 UTC 偏差导致文件名日期错误
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function exportReportAsMarkdown(content: string, label = '报告') {
  downloadText(
    `墨记-${label}-${dateStamp()}.md`,
    content,
    'text/markdown;charset=utf-8',
  )
}

export function exportActivitiesAsJson(activities: Activity[]) {
  downloadText(
    `墨记-活动记录-${dateStamp()}.json`,
    JSON.stringify(activities, null, 2),
    'application/json;charset=utf-8',
  )
}

export function exportActivitiesAsMarkdown(activities: Activity[]) {
  const lines = [
    '# 墨记活动记录',
    '',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    `记录数量：${activities.length}`,
    '',
    ...activities.map(activity => [
      `## ${new Date(activity.timestamp).toLocaleString('zh-CN')} · ${CATEGORY_LABEL[activity.category]}`,
      '',
      `- 应用：${activity.app || '未知应用'}`,
      `- 窗口：${activity.title || '未知窗口'}`,
      `- 内容：${activity.description || '无描述'}`,
      '',
    ].join('\n')),
  ]

  downloadText(
    `墨记-活动记录-${dateStamp()}.md`,
    lines.join('\n'),
    'text/markdown;charset=utf-8',
  )
}
