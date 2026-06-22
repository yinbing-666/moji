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
  'You are a work activity analyzer. For each screenshot, output JSON only: {"category":"dev|meeting|doc|communication|other","app":"AppName","title":"WindowTitle","description":"What user is doing"}.'

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

function normalizeAnalysis(value: Partial<ActivityAnalysis>): ActivityAnalysis {
  const category = VALID_CATEGORIES.includes(value.category as ActivityAnalysis['category'])
    ? value.category as ActivityAnalysis['category']
    : 'other'

  return {
    category,
    app: value.app?.trim() || 'Unknown app',
    title: value.title?.trim() || 'Unknown window',
    description: value.description?.trim() || 'No clear activity detected',
  }
}

export async function analyzeScreenshot(
  base64: string,
  apiKey?: string,
  baseUrl?: string,
): Promise<ActivityAnalysis> {
  const { key, url } = requireAiConfig(apiKey, baseUrl)
  const response = await fetch(url + '/chat/completions', {
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
            { type: 'text', text: 'Analyze this screenshot. Output JSON only.' },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0.1,
    }),
  })

  if (!response.ok) {
    throw new Error('AI request failed: HTTP ' + response.status)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content || ''
  const match = content.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error('AI returned invalid format')
  }

  return normalizeAnalysis(JSON.parse(match[0]))
}

export async function generateReport(
  activities: Array<{ timestamp: string; description: string; category: string; app_name: string }>,
  type: 'daily' | 'weekly' | 'monthly',
  _template: string = 'standard',
  apiKey?: string,
  baseUrl?: string,
): Promise<string> {
  const { key, url } = requireAiConfig(apiKey, baseUrl)
  const lines = activities.map(a => '[' + a.timestamp + '] ' + a.category + ' | ' + a.app_name + ' | ' + a.description)
  const text = lines.join('\n')
  const typeName = type === 'daily' ? 'daily report' : type === 'weekly' ? 'weekly report' : 'monthly report'

  const response = await fetch(url + '/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: REPORT_MODEL,
      messages: [{
        role: 'user',
        content: 'Generate a concise Chinese Markdown ' + typeName + ' from these activities. Highlight main work, communication, blockers, and measurable progress:\n\n' + text,
      }],
      max_tokens: 2000,
      temperature: 0.3,
    }),
  })

  if (!response.ok) {
    throw new Error('AI request failed: HTTP ' + response.status)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || 'Generation failed: AI returned empty content'
}
