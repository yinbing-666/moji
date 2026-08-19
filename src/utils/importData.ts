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

const CATEGORY_ALIASES: Record<string, Activity['category']> = {
  dev: 'dev',
  meeting: 'meeting',
  doc: 'doc',
  communication: 'communication',
  other: 'other',
  开发: 'dev',
  编程: 'dev',
  会议: 'meeting',
  文档: 'doc',
  沟通: 'communication',
  通讯: 'communication',
  其他: 'other',
}

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

/** 将导出 Markdown 中的分类名称转换为内部分类值 */
function normalizeMarkdownCategory(category: string): string {
  return CATEGORY_ALIASES[category.trim()] || category.trim()
}

/** 解析完整 Markdown 导出中的单条活动 */
function parseMarkdownSection(
  timestamp: string,
  rawCategory: string,
  body: string,
): Activity {
  const fields: Partial<Record<'app' | 'title' | 'description', string>> = {}
  let currentField: 'app' | 'title' | 'description' | undefined

  const fieldLine = /^\s*[-*]\s*(?:\*\*)?(应用|窗口|内容)(?:\*\*)?\s*[：:]\s*(.*)$/

  for (const line of body.split(/\r?\n/)) {
    const match = line.match(fieldLine)

    if (match) {
      const [, label, value] = match
      const field = label === '应用'
        ? 'app'
        : label === '窗口'
          ? 'title'
          : 'description'

      if (fields[field] !== undefined) {
        throw new Error(`Markdown 活动记录包含重复字段：${label}`)
      }

      fields[field] = value.trim()
      currentField = field
      continue
    }

    if (currentField && line.trim()) {
      fields[currentField] = `${fields[currentField] || ''}\n${line.trim()}`.trim()
    }
  }

  if (Number.isNaN(Date.parse(timestamp.trim()))) {
    throw new Error(`Markdown 活动记录包含无法解析的时间：${timestamp.trim()}`)
  }

  const category = normalizeMarkdownCategory(rawCategory)
  if (!category) {
    throw new Error('Markdown 活动记录缺少分类')
  }

  if (fields.app === undefined || fields.title === undefined || fields.description === undefined) {
    throw new Error('Markdown 活动记录缺少应用、窗口或内容字段')
  }

  return normalizeImportItem({
    timestamp: timestamp.trim(),
    category,
    app: fields.app,
    title: fields.title,
    description: fields.description,
  })
}

/** 解析墨记导出的 Markdown */
function parseMarkdownImport(text: string): Activity[] {
  const items: Activity[] = []

  // 完整导出格式：
  // ## timestamp · category
  // - 应用：...
  // - 窗口：...
  // - 内容：...
  const sectionPattern = /^##\s+(.+?)\s*·\s*(.+?)\s*$/gm
  const sectionMatches: Array<{ index: number; length: number; timestamp: string; category: string }> = []

  let sectionMatch: RegExpExecArray | null
  while ((sectionMatch = sectionPattern.exec(text)) !== null) {
    sectionMatches.push({
      index: sectionMatch.index,
      length: sectionMatch[0].length,
      timestamp: sectionMatch[1],
      category: sectionMatch[2],
    })
  }

  const levelTwoHeadings = text.match(/^##\s+.+$/gm) || []
  if (levelTwoHeadings.length > 0) {
    if (sectionMatches.length === 0 || levelTwoHeadings.length !== sectionMatches.length) {
      throw new Error('无法解析 Markdown 活动记录标题，期望格式为“## 时间 · 分类”')
    }

    sectionMatches.forEach((section, index) => {
      const bodyStart = section.index + section.length
      const bodyEnd = index + 1 < sectionMatches.length
        ? sectionMatches[index + 1].index
        : text.length
      items.push(parseMarkdownSection(
        section.timestamp,
        section.category,
        text.slice(bodyStart, bodyEnd),
      ))
    })

    if (items.length === 0) {
      throw new Error('Markdown 中未找到可导入的活动记录')
    }

    return items
  }

  // 兼容旧格式：
  // - [timestamp] category | app | description
  // - **category** | app | description
  const recordLine = /-\s*(?:\[([^\]]*)\]\s*)?\*?\*?([^|\s]+)\*?\*?\s*\|\s*([^|]+?)\s*\|\s*(.+)/g

  let match: RegExpExecArray | null
  while ((match = recordLine.exec(text)) !== null) {
    const [, rawTimestamp, rawCategory, rawApp, rawDesc] = match
    const timestamp = rawTimestamp?.trim() || new Date().toISOString()
    const category = normalizeMarkdownCategory(rawCategory)
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

  if (items.length === 0) {
    throw new Error('Markdown 中未找到可解析的活动记录')
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