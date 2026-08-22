export type ActivityCategory = 'dev' | 'meeting' | 'doc' | 'communication' | 'other' | 'unclassified'
export type RuleCategory = Exclude<ActivityCategory, 'unclassified'>

export interface ClassificationRule {
  id: string
  name: string
  category: RuleCategory
  appKeywords: string[]
  titleKeywords: string[]
  enabled: boolean
}

export interface ClassificationRuleMatch {
  rule: ClassificationRule
  source: 'app' | 'title'
  keyword: string
}

export interface ClassificationRuleConflict {
  ruleIds: [string, string]
  source: 'app' | 'title'
  keywords: [string, string]
}

export const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  'dev',
  'meeting',
  'doc',
  'communication',
  'other',
  'unclassified',
]

export const RULE_CATEGORIES: RuleCategory[] = ['dev', 'meeting', 'doc', 'communication', 'other']

export const DEFAULT_CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    id: 'default-dev',
    name: '开发工具',
    category: 'dev',
    appKeywords: ['vscode', 'code.exe', 'visual studio', 'terminal', 'cmd', 'powershell', 'git', 'jetbrains', 'pycharm', 'webstorm', 'idea', 'docker', 'python', 'node'],
    titleKeywords: ['github', 'claude', 'codex', 'devtools', 'localhost', '127.0.0.1', ':3000', ':1420'],
    enabled: true,
  },
  {
    id: 'default-doc',
    name: '文档与写作',
    category: 'doc',
    appKeywords: ['word', 'wps', 'notion', 'obsidian', 'typora', 'excel', 'powerpoint', 'acrobat'],
    titleKeywords: ['markdown', '.md', 'pdf', 'readme', '笔记', '文档', '写作', '墨记'],
    enabled: true,
  },
  {
    id: 'default-communication',
    name: '沟通工具',
    category: 'communication',
    appKeywords: ['wechat', '微信', 'qq', 'dingtalk', '钉钉', 'feishu', 'lark', 'slack', 'telegram', 'discord', 'whatsapp', 'outlook'],
    titleKeywords: ['企业微信', '邮箱', 'mail', 'gmail'],
    enabled: true,
  },
  {
    id: 'default-meeting',
    name: '会议与视频',
    category: 'meeting',
    appKeywords: ['zoom', '腾讯会议', 'teams', 'webex', 'obs64.exe', 'obs32.exe'],
    titleKeywords: ['meeting', 'meet', '会议', '语音', '直播', 'bilibili', '抖音', '虎牙', 'youtube', '视频'],
    enabled: true,
  },
]

function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean),
  )).slice(0, 100)
}

export function cloneDefaultClassificationRules(): ClassificationRule[] {
  return DEFAULT_CLASSIFICATION_RULES.map(rule => ({
    ...rule,
    appKeywords: [...rule.appKeywords],
    titleKeywords: [...rule.titleKeywords],
  }))
}

export function normalizeClassificationRules(value: unknown): ClassificationRule[] {
  if (!Array.isArray(value)) return cloneDefaultClassificationRules()

  const seen = new Set<string>()
  const normalized: ClassificationRule[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<ClassificationRule>
    if (!RULE_CATEGORIES.includes(candidate.category as RuleCategory)) continue
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    const appKeywords = normalizeKeywords(candidate.appKeywords)
    const migratedAppKeywords = id === 'default-meeting' && appKeywords.includes('obs')
      ? [...appKeywords.filter(keyword => keyword !== 'obs'), 'obs64.exe', 'obs32.exe']
      : appKeywords
    normalized.push({
      id,
      name,
      category: candidate.category as RuleCategory,
      appKeywords: migratedAppKeywords,
      titleKeywords: normalizeKeywords(candidate.titleKeywords),
      enabled: candidate.enabled !== false,
    })
  }
  return normalized
}

function matchRule(app: string, title: string, rule: ClassificationRule): ClassificationRuleMatch | null {
  if (!rule.enabled) return null
  const normalizedApp = app.toLocaleLowerCase()
  const appKeyword = rule.appKeywords.find(keyword => normalizedApp.includes(keyword.toLocaleLowerCase()))
  if (appKeyword) return { rule, source: 'app', keyword: appKeyword }
  const normalizedTitle = title.toLocaleLowerCase()
  const titleKeyword = rule.titleKeywords.find(keyword => normalizedTitle.includes(keyword.toLocaleLowerCase()))
  return titleKeyword ? { rule, source: 'title', keyword: titleKeyword } : null
}

export function matchClassificationRules(
  app: string,
  title: string,
  rules: ClassificationRule[],
): ClassificationRuleMatch[] {
  return rules.map(rule => matchRule(app, title, rule)).filter((match): match is ClassificationRuleMatch => match !== null)
}

export function findClassificationRuleConflicts(rules: ClassificationRule[]): ClassificationRuleConflict[] {
  const entries = rules
    .filter(rule => rule.enabled)
    .flatMap(rule => [
      ...rule.appKeywords.map(keyword => ({ ruleId: rule.id, source: 'app' as const, keyword })),
      ...rule.titleKeywords.map(keyword => ({ ruleId: rule.id, source: 'title' as const, keyword })),
    ])
  const conflicts: ClassificationRuleConflict[] = []
  const seen = new Set<string>()

  for (let leftIndex = 0; leftIndex < entries.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex++) {
      const left = entries[leftIndex]
      const right = entries[rightIndex]
      if (left.ruleId === right.ruleId || left.source !== right.source) continue
      const leftKeyword = left.keyword.toLocaleLowerCase()
      const rightKeyword = right.keyword.toLocaleLowerCase()
      if (!leftKeyword.includes(rightKeyword) && !rightKeyword.includes(leftKeyword)) continue
      const key = [left.ruleId, right.ruleId].sort().join('|') + `|${left.source}|${[leftKeyword, rightKeyword].sort().join('|')}`
      if (seen.has(key)) continue
      seen.add(key)
      conflicts.push({ ruleIds: [left.ruleId, right.ruleId], source: left.source, keywords: [left.keyword, right.keyword] })
    }
  }
  return conflicts
}

export function matchClassificationRule(
  app: string,
  title: string,
  rules: ClassificationRule[],
): ClassificationRule | null {
  return matchClassificationRules(app, title, rules)[0]?.rule ?? null
}

export function classifyWindow(
  app: string,
  title: string,
  rules: ClassificationRule[],
): ActivityCategory {
  return matchClassificationRule(app, title, rules)?.category ?? 'unclassified'
}

export function createClassificationRule(
  category: RuleCategory,
  appKeyword: string,
  titleKeyword = '',
): ClassificationRule {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const source = appKeyword.trim() || titleKeyword.trim() || '新规则'
  return {
    id: `custom-${suffix}`,
    name: `${source} → ${category}`,
    category,
    appKeywords: appKeyword.trim() ? [appKeyword.trim()] : [],
    titleKeywords: titleKeyword.trim() ? [titleKeyword.trim()] : [],
    enabled: true,
  }
}
