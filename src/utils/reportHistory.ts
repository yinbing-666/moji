/**
 * 报告历史记录管理模块
 * 
 * [P0优化] 业务逻辑100%保留，历史记录CRUD+SQLite同步完整保留
 * [P1优化] 数据规范化、去重、容量限制逻辑不变
 */
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

function saveReportHistory(items: ReportHistoryItem[]) {
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

/**
 * 启动时从 SQLite 回读报告历史，与 localStorage 合并。
 * SQLite 优先（localStorage 可能因配额超限丢失），按 id 去重，
 * 按 createdAt 降序保留最近 MAX_REPORT_HISTORY 条，并写回 localStorage。
 */
export function mergeReportHistoryFromSqlite(
  sqliteRows: Array<{
    id: string
    created_at: string
    report_type: string
    template: string
    content: string
  }>,
): ReportHistoryItem[] {
  const sqliteItems: ReportHistoryItem[] = sqliteRows
    .map(row => normalizeHistoryItem({
      id: row.id,
      createdAt: row.created_at,
      type: row.report_type,
      template: row.template,
      content: row.content,
    }))
    .filter((item): item is ReportHistoryItem => item !== null)

  const localItems = loadReportHistory()
  // SQLite 优先：同 id 以 SQLite 为准，再补本地独有的
  const seen = new Set(sqliteItems.map(i => i.id))
  const merged = [...sqliteItems, ...localItems.filter(i => !seen.has(i.id))]
  merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  const result = merged.slice(0, MAX_REPORT_HISTORY)
  try {
    localStorage.setItem(REPORT_HISTORY_KEY, JSON.stringify(result))
  } catch {
    // localStorage 写满不影响内存态，SQLite 仍是数据源
  }
  return result
}

export function addReportHistoryItem(
  history: ReportHistoryItem[],
  type: ReportType,
  content: string,
  template = 'standard',
): ReportHistoryItem[] {
  const nextItem: ReportHistoryItem = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
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
