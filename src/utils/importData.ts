/**
 * 数据导入模块
 * 
 * [P0优化] 业务逻辑100%保留，JSON/Markdown双格式解析完整保留
 * [P1优化] 数据规范化、合并去重逻辑不变
 */
import type { Activity } from '../stores/activityStore'

interface RawActivity {
  id?: unknown
  timestamp?: unknown
  category?: unknown
  app?: unknown
  title?: unknown
  description?: unknown
  screenshotBase64?: unknown
}

const VALID_CATEGORIES = ['dev', 'meeting', 'doc', 'communication', 'other'] as const

export function normalizeImportItem(raw: RawActivity): Activity {
  const id = typeof raw.id === 'string' && raw.id.trim()
    ? raw.id
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const timestamp = typeof raw.timestamp === 'string' && !Number.isNaN(Date.parse(raw.timestamp))
    ? raw.timestamp
    : new Date().toISOString()
  const category = (VALID_CATEGORIES as readonly string[]).includes(raw.category as string)
    ? raw.category as Activity['category']
    : 'other'
  const app = typeof raw.app === 'string' && raw.app.trim() ? raw.app.trim() : '未知应用'
  const title = typeof raw.title === 'string' ? raw.title : ''
  const description = typeof raw.description === 'string' && raw.description.trim()
    ? raw.description.trim()
    : '未填写说明'
  const screenshotBase64 = typeof raw.screenshotBase64 === 'string' && raw.screenshotBase64.trim()
    ? raw.screenshotBase64
    : undefined

  return {
    id,
    timestamp,
    category,
    app,
    title,
    description,
    ...(screenshotBase64 ? { screenshotBase64 } : {}),
  }
}

/** 解析 JSON 数组导入 */
function parseJsonImport(text: string): Activity[] {
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed)) {
    throw new Error('JSON 顶层必须是数组')
  }
  return parsed.map(normalizeImportItem)
}

/** 解析墨记导出的 Markdown */
function parseMarkdownImport(text: string): Activity[] {
  const items: Activity[] = []

  // 格式：`- [timestamp] category | app | description` 或 `- **category** | app | description`
  const recordLine = /-\s*(?:\[([^\]]*)\]\s*)?\*?\*?(\w+)\*?\*?\s*\|\s*([^|]+?)\s*\|\s*(.+)/g

  let match: RegExpExecArray | null
  while ((match = recordLine.exec(text)) !== null) {
    const [, rawTimestamp, rawCategory, rawApp, rawDesc] = match
    const timestamp = rawTimestamp?.trim() || new Date().toISOString()
    const category = rawCategory.trim()
    const app = rawApp.trim()
    const description = rawDesc.trim()

    items.push(normalizeImportItem({
      timestamp,
      category,
      app,
      title: app,
      description,
    }))
  }

  return items
}

/** 合并导入项到现有活动，按 ID 去重，返回新增数量与待写入列表 */
export function mergeImport(
  incoming: Activity[],
  existing: Activity[],
): { toImport: Activity[]; imported: number; skipped: number } {
  const existingIds = new Set(existing.map(a => a.id))
  const toImport: Activity[] = []
  let skipped = 0

  for (const item of incoming) {
    if (existingIds.has(item.id)) {
      skipped++
      continue
    }
    existingIds.add(item.id)
    toImport.push(item)
  }

  return { toImport, imported: toImport.length, skipped }
}

/** 解析导入文本（自动判断 JSON / Markdown），返回 Activity 列表 */
export function parseImport(text: string): Activity[] {
  const trimmed = text.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseJsonImport(trimmed)
  }
  if (trimmed.startsWith('#') || trimmed.includes('墨记活动记录')) {
    return parseMarkdownImport(trimmed)
  }
  throw new Error('无法识别文件格式，请提供 JSON 数组或墨记导出的 Markdown')
}
