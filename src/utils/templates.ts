/**
 * 报告模板管理模块
 * 
 * [P0优化] 业务逻辑100%保留，内置模板+自定义模板CRUD完整保留
 * [P1优化] 模板数据结构、localStorage持久化逻辑不变
 */
export interface ReportTemplate {
  value: string
  label: string
  description: string
}

export interface CustomTemplate {
  id: string
  name: string
  prompt: string
}

export const BUILTIN_TEMPLATES: ReportTemplate[] = [
  { value: 'standard', label: '标准', description: '完整结构，适合日常同步' },
  { value: 'brief', label: '简洁', description: '只保留重点和结论' },
  { value: 'technical', label: '技术', description: '突出开发、调试和风险' },
  { value: 'okr', label: 'OKR', description: '围绕目标和关键结果复盘' },
]

const BUILTIN_PROMPTS: Record<string, string> = {
  standard: '标准日报：结构完整，适合日常同步。',
  brief: '简洁日报：只保留最重要的结论，每段控制在 1-3 条。',
  technical: '技术日报：突出开发任务、技术决策、调试过程、风险和后续技术动作。',
  okr: 'OKR 复盘：围绕目标、关键结果、进展、阻塞和下一步行动组织内容。',
}

const CUSTOM_TEMPLATES_KEY = 'moji-custom-templates'
const MAX_CUSTOM_TEMPLATES = 20

export function loadCustomTemplates(): CustomTemplate[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((t: unknown): t is CustomTemplate =>
        typeof t === 'object' && t !== null
        && typeof (t as CustomTemplate).id === 'string'
        && typeof (t as CustomTemplate).name === 'string'
        && typeof (t as CustomTemplate).prompt === 'string'
      )
      .slice(0, MAX_CUSTOM_TEMPLATES)
  } catch {
    return []
  }
}

function saveCustomTemplates(templates: CustomTemplate[]) {
  localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(templates.slice(0, MAX_CUSTOM_TEMPLATES)))
}

export function addCustomTemplate(name: string, prompt: string): CustomTemplate[] {
  const templates = loadCustomTemplates()
  const item: CustomTemplate = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    prompt: prompt.trim(),
  }
  const next = [item, ...templates]
  saveCustomTemplates(next)
  return next
}

export function updateCustomTemplate(id: string, name: string, prompt: string): CustomTemplate[] {
  const templates = loadCustomTemplates().map(t =>
    t.id === id ? { ...t, name: name.trim(), prompt: prompt.trim() } : t,
  )
  saveCustomTemplates(templates)
  return templates
}

export function removeCustomTemplate(id: string): CustomTemplate[] {
  const templates = loadCustomTemplates().filter(t => t.id !== id)
  saveCustomTemplates(templates)
  return templates
}

/** 根据模板 key 或自定义模板 ID 取 prompt 描述文本 */
export function getTemplateDescription(
  templateKey: string,
  customTemplates?: CustomTemplate[],
): string {
  // 内置模板
  if (BUILTIN_PROMPTS[templateKey]) {
    return BUILTIN_PROMPTS[templateKey]
  }
  // 自定义模板（按 id 匹配，前端下拉 value 用 `custom:${id}`）
  const customId = templateKey.startsWith('custom:') ? templateKey.slice(7) : templateKey
  const custom = customTemplates?.find(t => t.id === customId)
  if (custom) return custom.prompt
  // 兜底
  return BUILTIN_PROMPTS.standard
}
