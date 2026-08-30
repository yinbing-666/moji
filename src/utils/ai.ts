/**
 * AI调用工具模块
 * 
 * [P0优化] 业务逻辑100%保留，AI分析/报告生成/连接测试核心功能不变
 * [P1优化] 本地确定性分类规则完整保留，作为AI失败的降级方案
 */
import { invoke } from '@tauri-apps/api/core'
import type { AiReportStats } from './awReport'

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
    await chatCompletions(key, url, testModel, [{ role: 'user', content: 'ping' }], 32, 0)
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

export type AwReportStats = AiReportStats
type ReportPeriod = 'daily' | 'weekly' | 'monthly'

/** 把统计汇总预计算为只读数据块注入 prompt，模型只负责叙述、不自行估算 */
function formatStatsBlock(s: AwReportStats, period: ReportPeriod): string {
  const h = (sec: number) => (sec / 3600).toFixed(1) + 'h'
  const lines = [
    `活跃时长：${h(s.summary.active_seconds)}；生产力占比：${s.summary.productive_percent}%`,
    `分类分布：${s.categories.map(c => `${c.name} ${h(c.seconds)}(${c.percent}%)`).join('、') || '无数据'}`,
    `主要应用：${s.apps.slice(0, 5).map(a => `${a.name} ${a.percent}%`).join('、') || '无数据'}`,
  ]
  if (s.focus_analysis) {
    const f = s.focus_analysis
    lines.push(
      `专注情况：最长专注 ${h(f.longest_focus_seconds)}；专注段均值 ${h(f.avg_focus_seconds)}；` +
      `打断 ${f.interruptions} 次；碎片化指数 ${f.fragmentation}（0-1，越高越碎）`
    )
  }
  if (s.comparison) {
    const c = s.comparison
    const label = period === 'monthly' ? '较上月' : period === 'weekly' ? '较上周' : '较昨日'
    lines.push(
      `${label}：活跃时长 ${c.active_seconds_delta_percent >= 0 ? '+' : ''}${c.active_seconds_delta_percent}%；` +
      `生产力占比 ${c.productive_delta_pp >= 0 ? '+' : ''}${c.productive_delta_pp}pp；` +
      `打断次数 ${c.interruptions_delta >= 0 ? '+' : ''}${c.interruptions_delta} 次`
    )
  }
  if (period !== 'daily' && s.daily_breakdown) {
    lines.push(
      `每日活跃：${s.daily_breakdown.map(d => `${d.date.slice(5)} ${h(d.active_seconds)}`).join('、')}`
    )
  }
  if (s.insights?.length) {
    lines.push(`系统洞察（可引用，不可扩写）：${s.insights.join('；')}`)
  }
  return lines.join('\n')
}

const REPORT_SYSTEM = `你是资深工程效能分析师，为工程师生成"重点提炼式"工作汇报。
你的输出会被直接粘贴到工作汇报或同步工具，因此必须结论先行、可扫读、无寒暄。

硬性规则：
1. 只使用【活动记录】和【统计数据】中出现的信息，禁止推测、补全或编造任何事实、指标、人名、项目名。
2. 每个重点必须附证据，证据只能引用记录中真实出现的 app 名、description 片段或时间段。
3. 合并同类活动，禁止逐条复述时间线，禁止输出按时间排序的节点列表。
4. 统计数据只能引用【统计数据】块中的字段；该块未提供的指标写"无数据"，不得自行计算或估算。
5. 记录条数过少或信息不足以支撑判断时，在开头写一行"⚠️ 本次记录有限（共 N 条活动），结论仅供参考"，并如实减少重点数量。
6. 输出纯 Markdown，不加代码块包裹，不加解释性前后缀。`;

const DAILY_STRUCT = `请严格按以下结构输出：

## 今日 3 个重点
按重要性排序，最多 3 条、最少按实际可支撑的数量输出（不足 3 条时直接少写，并在末尾补一句说明原因）。每条格式：

### 1. <一句话结论式标题，含具体对象>
- **做了什么**：1-2 句，动词开头，落到具体模块/文件/议题
- **为什么重要**：对项目推进、阻塞解除或决策的实际影响
- **证据**：引用记录中的 app / description 片段 / 时段，如 \`VSCode · auth 模块重构 · 09:20-11:40\`

## 产出
交付物与结果清单，3-6 条，按主题合并同类活动。每条写"做成了什么"而非"花了多久"。无明确产出时写"本日无明确交付物，主要为 <主导类别> 类投入"。

## 阻塞
未完成项、遇到的问题、待外部输入的事项，每条注明卡点与下一步动作。确无阻塞时只写一行："无明显阻塞。"，不要凑数。

## 数据依据
基于【统计数据】的客观陈述，不加主观评价：
- 时间分布：各分类时长与占比
- 专注情况：最长专注时长、打断次数、碎片化程度
- 与上期对比：变化方向与幅度
`;

const WEEKLY_STRUCT = `请严格按以下结构输出：

## 本周 3-5 个重点
按重要性排序，跨天合并为主题级重点（同一主线的多日工作合成一条）。每条格式：

### 1. <一句话结论式标题>
- **做了什么**：跨天推进过程，1-2 句
- **为什么重要**：对本周目标的贡献
- **证据**：引用涉及的天数、主要 app 与 description 片段，如 \`周一至周三 · VSCode · 支付回调重构\`

## 产出
本周交付物清单，按主题聚合，标注完成/进行中。

## 阻塞
本周未解决问题与遗留项，注明已持续天数与下一步。确无阻塞写"无明显阻塞。"

## 本周趋势
- 累计活跃时长与高产出时段分布
- 分类结构变化（哪类占比上升/下降）
- 专注质量变化（专注时长、打断频次趋势）
- 与上周对比的关键差异，仅陈述【统计数据】中 comparison 字段支持的结论

## 数据依据
逐项列出统计口径与数值，含累计值与环比。
`;

const MONTHLY_STRUCT = `请严格按以下结构输出：

## 本月 3-5 个重点
按重要性排序，将跨周的同一主线合并为主题级重点。每条格式：

### 1. <一句话结论式标题>
- **做了什么**：概括本月推进过程与当前状态，1-2 句
- **为什么重要**：说明对月度目标或项目阶段的实际贡献
- **证据**：引用涉及的日期、主要 app 与 description 片段

## 产出
本月交付物清单，按主题聚合，标注完成/进行中。

## 阻塞
本月仍未解决的问题与遗留项，注明下一步。确无阻塞写“无明显阻塞。”

## 本月趋势
- 累计活跃时长与每日投入分布
- 分类结构与主要应用分布
- 专注质量与打断情况
- 与上月对比的关键差异，仅陈述【统计数据】中 comparison 字段支持的结论；没有 comparison 时明确写“暂无上月对比数据”

## 数据依据
逐项列出统计口径与数值，含月度累计值与环比。
`;

export function buildReportPrompt(opts: {
  period: ReportPeriod
  activities: string
  statsBlock: string
  templateDesc?: string
}) {
  const struct = opts.period === 'monthly'
    ? MONTHLY_STRUCT
    : opts.period === 'weekly'
      ? WEEKLY_STRUCT
      : DAILY_STRUCT
  return [
    struct,
    opts.templateDesc ? `\n补充风格要求（不得覆盖上述结构与硬性规则）：\n${opts.templateDesc}` : '',
    `\n【统计数据】\n${opts.statsBlock || '（未提供统计数据，"数据依据"章节请写：本次未接入统计数据。）'}`,
    `\n【活动记录】（共 ${opts.activities.split('\n').length} 条）\n${opts.activities}`,
  ].join('\n')
}

export async function generateReport(
  activities: Array<{ timestamp: string; description: string; category: string; app_name: string }>,
  type: 'daily' | 'weekly' | 'monthly',
  apiKey?: string,
  baseUrl?: string,
  model?: string,
  templateDesc?: string,
  stats?: AwReportStats,
): Promise<string> {
  const { key, url } = requireAiConfig(apiKey, baseUrl)
  const reportModel = model?.trim()
  if (!reportModel) {
    throw new Error('未配置报告生成模型')
  }
  // 记录为空时不调用模型，直接返回本地兜底文案
  if (activities.length === 0) {
    return '本时段无活动记录'
  }
  const lines = activities.map(a => '[' + a.timestamp + '] ' + a.category + ' | ' + a.app_name + ' | ' + a.description)
  const text = lines.join('\n')
  const period: ReportPeriod = type
  const statsBlock = stats ? formatStatsBlock(stats, period) : ''

  const content = buildReportPrompt({
    period,
    activities: text,
    statsBlock,
    templateDesc: templateDesc?.trim(),
  })

  const result = await chatCompletions(
    key,
    url,
    reportModel,
    [
      { role: 'system', content: REPORT_SYSTEM },
      { role: 'user', content },
    ],
    period === 'daily' ? 1600 : period === 'weekly' ? 2600 : 3000,
    0.2,
  )
  return result
}
