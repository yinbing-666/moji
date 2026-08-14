/**
 * AI调用工具模块
 * 
 * [P0优化] 业务逻辑100%保留，AI分析/报告生成/连接测试核心功能不变
 * [P1优化] 本地确定性分类规则完整保留，作为AI失败的降级方案
 */
import { invoke } from '@tauri-apps/api/core'

export interface ActivityAnalysis {
  category: 'dev' | 'meeting' | 'doc' | 'communication' | 'other'
  app: string
  title: string
  description: string
}

const VALID_CATEGORIES = ['dev', 'meeting', 'doc', 'communication', 'other'] as const

const SYSTEM_PROMPT = [
  '你是工作活动分析器。根据单个窗口的进程名、窗口标题、页面地址、窗口内文本，判断用户正在做什么。',
  '只输出 JSON：{"category":"dev|meeting|doc|communication|other","app":"应用名","title":"窗口标题","description":"用简体中文概括正在做的事（≤20字，具体、不空泛）"}。',
  '',
  '分类规则：',
  '- dev（开发）：代码编辑器/IDE/终端，或浏览器打开代码托管与编程站点（github/gitlab/stackoverflow/掘金/CSDN/本地开发地址 localhost 等）。',
  '- doc（文档）：写作、笔记、Word/Notion/飞书文档/PDF/表格/Wiki/博客。',
  '- communication（沟通）：即时通讯（微信/飞书/钉钉/Slack/Telegram）、邮件、论坛。',
  '- meeting（会议）：视频会议（腾讯会议/Zoom/Teams/Meet）、直播、在线课程、日历。',
  '- other（其他）：购物、娱乐、新闻、设计等无法归类的活动。',
  '',
  '浏览器窗口尤其要依据「页面地址 + 页面标题」判断，不要因为进程是浏览器就一律归 other。',
  'description 必须具体（如"在 GitHub 查看 xxx 仓库""在飞书写周报"），禁止复述进程名。',
  'app 填应用真实名称（如 Chrome、VS Code、飞书），title 填窗口/页面标题。',
  '只输出 JSON，不要 Markdown，不要额外解释。',
].join('\n')

function requireAiConfig(apiKey?: string, baseUrl?: string) {
  const key = apiKey?.trim()
  const url = baseUrl?.trim().replace(/\/+$/, '')

  if (!key) {
    throw new Error('API Key is not configured')
  }
  if (!url) {
    throw new Error('Base URL is not configured')
  }

  return { key, url }
}

/**
 * 调用 OpenAI 兼容的 /chat/completions，走 Rust 后端代理（reqwest），绕过浏览器 CORS。
 * 返回助手消息的 content 字符串；失败时抛出带中文提示的错误。
 */
async function chatCompletions(
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  const content = await invoke<string>('chat_completions', {
    req: {
      baseUrl,
      apiKey,
      model,
      messages,
      maxTokens,
      temperature,
    },
  })
  return content
}

function normalizeAnalysis(value: Partial<ActivityAnalysis>): ActivityAnalysis {
  const category = (VALID_CATEGORIES as readonly string[]).includes(value.category as ActivityAnalysis['category'])
    ? value.category as ActivityAnalysis['category']
    : 'other'

  return {
    category,
    app: value.app?.trim() || '未知应用',
    title: value.title?.trim() || '未知窗口',
    description: value.description?.trim() || '未识别到明确活动',
  }
}

const CATEGORY_LABELS: Record<ActivityAnalysis['category'], string> = {
  dev: '开发',
  meeting: '会议',
  doc: '文档',
  communication: '沟通',
  other: '其他',
}

/** 本地确定性分类（不调 AI）：按进程名/标题给分类 + 模板描述，作为 AI 失败时的降级 */
export function classifyLocally(app?: string, title?: string): ActivityAnalysis {
  const category = guessCategory(app, title) ?? 'other'
  const appName = (app ?? '').replace(/\.exe$/i, '').trim() || '未知应用'
  return {
    category,
    app: appName,
    title: title?.trim() || '',
    description: `${appName} · ${CATEGORY_LABELS[category]}`,
  }
}

function processFileName(processPath?: string): string {
  return processPath
    ?.split(/[\\/]/)
    .filter(Boolean)
    .pop()
    ?.trim() || ''
}

/** 从窗口文本 + 标题中提取页面地址（http(s) URL 与本地开发地址），这是浏览器分类的最强信号 */
function extractUrls(text: string): string[] {
  const urls = new Set<string>()
  const http = text.match(/https?:\/\/[^\s\"'<>,。；、]+/g) ?? []
  for (const url of http) {
    urls.add(url.replace(/[),.;，。;、]+$/, ''))
  }
  const local = text.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{2,5})?(?:\/[^\s\"'<>,。；、]*)?/g) ?? []
  for (const url of local) {
    urls.add(url.replace(/[),.;，。;、]+$/, ''))
  }
  return [...urls].slice(0, 6)
}

/** 已知应用的进程名/标题 → 确定性分类预判，作为给模型的强提示 */
const PROCESS_CATEGORY_HINTS: Array<{ pattern: RegExp; category: ActivityAnalysis['category'] }> = [
  { pattern: /vscode|code\.exe|visual ?studio|pycharm|webstorm|intellij|idea|goland|clion|rider|cursor|windsurf|sublime|vim|neovim|terminal|cmd\.exe|powershell|git-?bash|postman|docker|devtools|localhost|127\.0\.0\.1/i, category: 'dev' },
  { pattern: /微信|wechat|qq|钉钉|dingtalk|飞书|feishu|lark|slack|telegram|discord|企业微信|whatsapp|outlook|thunderbird|foxmail|163mail|gmail|邮件|邮箱|mail/i, category: 'communication' },
  { pattern: /zoom|腾讯会议|wemeet|meeting|teams|skype|webex|meet\.google|直播|obs|bilibili|抖音|虎牙|youtube|视频/i, category: 'meeting' },
  { pattern: /word|wps|excel|ppt|powerpoint|notion|obsidian|typora|markdown|pdf|acrobat|飞书文档|腾讯文档|石墨|wiki|confluence|evernote|onenote|笔记|文档|写作/i, category: 'doc' },
]

function guessCategory(app?: string, title?: string): ActivityAnalysis['category'] | null {
  const haystack = `${app ?? ''} ${title ?? ''}`
  for (const hint of PROCESS_CATEGORY_HINTS) {
    if (hint.pattern.test(haystack)) return hint.category
  }
  return null
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1]?.trim() || trimmed
}

function firstJsonObject(content: string): string | null {
  const start = content.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < content.length; index += 1) {
    const char = content[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return content.slice(start, index + 1)
      }
    }
  }

  return null
}

function parseAnalysisContent(content: string): ActivityAnalysis {
  const normalizedContent = stripJsonFence(content)
  const candidates = [normalizedContent, firstJsonObject(normalizedContent)]
    .filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    try {
      return normalizeAnalysis(JSON.parse(candidate))
    } catch {
      // Try the next candidate before surfacing a user-facing error.
    }
  }

  throw new Error('AI 返回格式无效')
}

/** 测试 AI 连接是否可用（Key / Base URL / 模型名），返回清晰的结果 */
export async function testAiConnection(
  apiKey?: string,
  baseUrl?: string,
  model?: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const { key, url } = requireAiConfig(apiKey, baseUrl)
    const testModel = model?.trim()
    if (!testModel) {
      return { ok: false, message: '未配置模型名称' }
    }
    await chatCompletions(key, url, testModel, [{ role: 'user', content: 'ping' }], 5, 0)
    return { ok: true, message: '连接成功' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function analyzeWindowText(
  windowText: string,
  apiKey?: string,
  baseUrl?: string,
  model?: string,
  context?: { app?: string; title?: string; processPath?: string; isForeground?: boolean },
): Promise<ActivityAnalysis> {
  const { key, url } = requireAiConfig(apiKey, baseUrl)
  const analysisModel = model?.trim()
  if (!analysisModel) {
    throw new Error('未配置活动分析模型')
  }
  const processFile = processFileName(context?.processPath)
  const urls = extractUrls(windowText + ' ' + (context?.title ?? ''))
  const urlLines = urls.map(url => '页面地址: ' + url)
  const hintCategory = guessCategory(context?.app, context?.title)
  const contextText = [
    context?.app ? 'Process: ' + context.app : '',
    processFile ? 'Process executable: ' + processFile : '',
    context?.title ? 'Window title: ' + context.title : '',
    typeof context?.isForeground === 'boolean'
      ? 'Foreground window: ' + (context.isForeground ? 'yes' : 'no')
      : '',
    hintCategory ? `本地预判分类: ${hintCategory}（基于进程名/标题，仅供参考）` : '',
    ...urlLines,
    windowText.trim()
      ? '窗口内可读文本如下，请依据它判断具体活动：\n' + windowText
      : '（该窗口未采集到内部文本，请主要依据进程名与窗口标题判断）',
    'description 使用简体中文，具体且 ≤20 字。只输出 JSON。',
  ].filter(Boolean).join('\n')

  const content = await chatCompletions(
    key,
    url,
    analysisModel,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: contextText },
    ],
    600,
    0.1,
  )
  return parseAnalysisContent(content)
}

export async function generateReport(
  activities: Array<{ timestamp: string; description: string; category: string; app_name: string }>,
  type: 'daily' | 'weekly' | 'monthly',
  apiKey?: string,
  baseUrl?: string,
  model?: string,
  templateDesc?: string,
): Promise<string> {
  const { key, url } = requireAiConfig(apiKey, baseUrl)
  const reportModel = model?.trim()
  if (!reportModel) {
    throw new Error('未配置报告生成模型')
  }
  const lines = activities.map(a => '[' + a.timestamp + '] ' + a.category + ' | ' + a.app_name + ' | ' + a.description)
  const text = lines.join('\n')
  const reportName = type === 'daily' ? '日报' : type === 'weekly' ? '周报' : '月报'
  const templatePrompt = templateDesc?.trim()

  // 7月4 版完整 prompt 结构：助手角色 + 模板描述 + 固定要求 + 活动记录
  const content = [
    '你是一个严谨的工作复盘助手。请根据下面的活动记录生成中文 Markdown ' + reportName + '。',
    templatePrompt || '标准日报：结构完整，适合日常同步。',
    '要求：',
    '1. 不要编造活动记录里没有的信息。',
    '2. 合并重复或相近的活动，保留可执行结论。',
    '3. 如果记录不足，明确说明信息有限。',
    '4. 输出必须使用 Markdown。',
    '5. 固定包含这些部分：概览、主要工作、沟通协作、遇到的问题、明日建议、时间线摘要。',
    '6. 时间线摘要按时间顺序列出关键节点，不要逐条机械复述。',
    '',
    '活动记录：',
    text,
  ].join('\n')

  const result = await chatCompletions(
    key,
    url,
    reportModel,
    [{ role: 'user', content }],
    2000,
    0.3,
  )
  return result
}
