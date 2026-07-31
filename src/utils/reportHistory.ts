export type ReportType = 'daily' | 'weekly' | 'monthly'

export interface ReportHistoryItem {
  id: string
  createdAt: string
  type: ReportType
  content: string
}

const REPORT_HISTORY_KEY = 'moji-report-history'
const MAX_REPORT_HISTORY = 20

function isReportType(value: unknown): value is ReportType {
  return value === 'daily' || value === 'weekly' || value === 'monthly'
}

function normalizeHistoryItem(value: unknown): ReportHistoryItem | null {
  if (!value || typeof value !== 'object') return null

  const item = value as Partial<ReportHistoryItem>
  if (
    typeof item.id !== 'string'
    || typeof item.createdAt !== 'string'
    || !isReportType(item.type)
    || typeof item.content !== 'string'
    || !item.content.trim()
  ) {
    return null
  }

  return {
    id: item.id,
    createdAt: item.createdAt,
    type: item.type,
    content: item.content,
  }
}

export function loadReportHistory(): ReportHistoryItem[] {
  try {
    const raw = localStorage.getItem(REPORT_HISTORY_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed
      .map(normalizeHistoryItem)
      .filter((item): item is ReportHistoryItem => item !== null)
      .slice(0, MAX_REPORT_HISTORY)
  } catch {
    return []
  }
}

function saveReportHistory(items: ReportHistoryItem[]) {
  localStorage.setItem(REPORT_HISTORY_KEY, JSON.stringify(items.slice(0, MAX_REPORT_HISTORY)))
}

export function addReportHistoryItem(
  history: ReportHistoryItem[],
  type: ReportType,
  content: string,
): ReportHistoryItem[] {
  const nextItem: ReportHistoryItem = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: new Date().toISOString(),
    type,
    content,
  }
  const nextHistory = [nextItem, ...history].slice(0, MAX_REPORT_HISTORY)
  saveReportHistory(nextHistory)
  return nextHistory
}

export function removeReportHistoryItem(history: ReportHistoryItem[], id: string): ReportHistoryItem[] {
  const nextHistory = history.filter(item => item.id !== id)
  saveReportHistory(nextHistory)
  return nextHistory
}
