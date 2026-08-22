/**
 * 报告历史记录管理模块
 * 
 * [P0优化] 业务逻辑100%保留，历史记录CRUD+SQLite同步完整保留
 * [P1优化] 数据规范化、去重、容量限制逻辑不变
 */
import { localDateKey } from './date'

export type ReportType = 'daily' | 'weekly' | 'monthly'

export interface ReportHistoryItem {
  id: string
  createdAt: string
  type: ReportType
  template: string
  content: string
}

const REPORT_HISTORY_KEY = 'moji-report-history'
const MAX_REPORT_HISTORY = 20

function validDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function createReportHistoryId(sourceDate: string): string {
  const date = validDateKey(sourceDate) ? sourceDate : localDateKey(new Date())
  return `${date}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function reportSourceDate(item: Pick<ReportHistoryItem, 'id' | 'createdAt'>): string {
  const encoded = item.id.slice(0, 10)
  return validDateKey(encoded) ? encoded : localDateKey(item.createdAt)
}

export function filterActivitiesForReportPeriod<T extends { timestamp: string }>(
  activities: T[],
  type: ReportType,
  sourceDate: string,
): T[] {
  if (type === 'daily') {
    return activities.filter(item => localDateKey(item.timestamp) === sourceDate)
  }

  const [year, month, day] = sourceDate.split('-').map(Number)
  if (!year || !month || !day) return []

  if (type === 'monthly') {
    return activities.filter(item => {
      const date = new Date(item.timestamp)
      return date.getFullYear() === year && date.getMonth() + 1 === month
    })
  }

  const target = new Date(year, month - 1, day, 12)
  const weekday = target.getDay() || 7
  const monday = new Date(target)
  monday.setDate(target.getDate() - weekday + 1)
  monday.setHours(0, 0, 0, 0)
  const nextMonday = new Date(monday)
  nextMonday.setDate(monday.getDate() + 7)

  return activities.filter(item => {
    const timestamp = new Date(item.timestamp).getTime()
    return timestamp >= monday.getTime() && timestamp < nextMonday.getTime()
  })
}

export function hasStoredReportHistory(): boolean {
  return localStorage.getItem(REPORT_HISTORY_KEY) !== null
}

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
    template: typeof item.template === 'string' && item.template.trim()
      ? item.template
      : 'standard',
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

export function saveReportHistory(items: ReportHistoryItem[]) {
  localStorage.setItem(REPORT_HISTORY_KEY, JSON.stringify(items.slice(0, MAX_REPORT_HISTORY)))
}

function syncToSqlite(item: ReportHistoryItem) {
  void import('./db').then(({ dbSaveReportHistory }) =>
    dbSaveReportHistory({
      id: item.id,
      createdAt: item.createdAt,
      type: item.type,
      template: item.template,
      content: item.content,
    }).catch(() => {}),
  ).catch(() => {})
}

function deleteFromSqlite(id: string) {
  void import('./db').then(({ dbDeleteReportHistory }) =>
    dbDeleteReportHistory(id).catch(() => {}),
  ).catch(() => {})
}

export function addReportHistoryItem(
  history: ReportHistoryItem[],
  type: ReportType,
  content: string,
  template = 'standard',
  sourceDate = localDateKey(new Date()),
): ReportHistoryItem[] {
  const nextItem: ReportHistoryItem = {
    id: createReportHistoryId(sourceDate),
    createdAt: new Date().toISOString(),
    type,
    template,
    content,
  }
  const nextHistory = [nextItem, ...history].slice(0, MAX_REPORT_HISTORY)
  saveReportHistory(nextHistory)
  syncToSqlite(nextItem)
  return nextHistory
}

export function removeReportHistoryItem(history: ReportHistoryItem[], id: string): ReportHistoryItem[] {
  const nextHistory = history.filter(item => item.id !== id)
  saveReportHistory(nextHistory)
  deleteFromSqlite(id)
  return nextHistory
}
