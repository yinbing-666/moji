export interface ActivityAnalysis {
  category: 'dev' | 'meeting' | 'doc' | 'communication' | 'other'
  app: string
  title: string
  description: string
}

const ANALYSIS_MODEL = 'qwen3-vl-plus'
const REPORT_MODEL = 'qwen3.7-max'
const VALID_CATEGORIES = ['dev', 'meeting', 'doc', 'communication', 'other'] as const

const SYSTEM_PROMPT =
  '你是工作活动分析器。请根据单个窗口截图判断用户正在做什么，只输出 JSON：{"category":"dev|meeting|doc|communication|other","app":"应用名","title":"窗口标题","description":"用简体中文概括用户正在做的事"}。不要输出 Markdown。'

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

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  ms = 30000,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), ms)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('AI 请求超时（' + ms / 1000 + '秒未响应），请检查网络或 API 服务状态')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
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

function processFileName(processPath?: string): string {
  return processPath
    ?.split(/[\\/]/)
    .filter(Boolean)
    .pop()
    ?.trim() || ''
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

export async function analyzeScreenshot(
  base64: string,
  apiKey?: string,
  baseUrl?: string,
  context?: { app?: string; title?: string; processPath?: string; isForeground?: boolean },
): Promise<ActivityAnalysis> {
  const { key, url } = requireAiConfig(apiKey, baseUrl)
  const processFile = processFileName(context?.processPath)
  const contextText = [
    context?.app ? 'Process: ' + context.app : '',
    processFile ? 'Process executable: ' + processFile : '',
    context?.title ? 'Window title: ' + context.title : '',
    typeof context?.isForeground === 'boolean'
      ? 'Foreground window: ' + (context.isForeground ? 'yes' : 'no')
      : '',
    '分析这张单窗口截图。优先根据截图内容判断，不要只复述进程名。description 必须使用简体中文。只输出 JSON。',
  ].filter(Boolean).join('\n')

  const response = await fetchWithTimeout(url + '/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ANALYSIS_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + base64 } },
            { type: 'text', text: contextText },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0.1,
    }),
  })

  if (!response.ok) {
    throw new Error('AI 请求失败：HTTP ' + response.status)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content || ''
  return parseAnalysisContent(content)
}

export async function generateReport(
  activities: Array<{ timestamp: string; description: string; category: string; app_name: string }>,
  type: 'daily' | 'weekly' | 'monthly',
  apiKey?: string,
  baseUrl?: string,
): Promise<string> {
  const { key, url } = requireAiConfig(apiKey, baseUrl)
  const lines = activities.map(a => '[' + a.timestamp + '] ' + a.category + ' | ' + a.app_name + ' | ' + a.description)
  const text = lines.join('\n')
  const reportName = type === 'daily' ? '日报' : type === 'weekly' ? '周报' : '月报'

  const response = await fetchWithTimeout(url + '/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: REPORT_MODEL,
      messages: [{
        role: 'user',
        content: '请根据以下活动记录生成一份简洁的中文 Markdown ' + reportName + '。结构固定为：主要完成、沟通协作、问题阻塞、明日/后续计划。不要编造记录中不存在的成果。\n\n' + text,
      }],
      max_tokens: 2000,
      temperature: 0.3,
    }),
  })

  if (!response.ok) {
    throw new Error('AI 请求失败：HTTP ' + response.status)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) {
    throw new Error('AI 返回了空内容')
  }

  return content
}
