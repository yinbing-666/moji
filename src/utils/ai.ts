/**
 * AI 分析模块 - 接入通义千问 VL
 */

export interface ActivityAnalysis {
  category: 'dev' | 'meeting' | 'doc' | 'communication' | 'other'
  app: string
  title: string
  description: string
}

const SYSTEM_PROMPT = `你是一个工作活动分析助手。用户会发送屏幕截图，你需要：
1. 识别当前正在使用的应用和工作内容
2. 将活动分类为：dev(编程开发)、meeting(会议)、doc(文档)、communication(沟通)、other(其他)
3. 用简洁的中文描述用户在做什么
输出JSON格式：{"category":"dev","app":"VS Code","title":"文件名","description":"描述"}。只输出JSON。`

export async function analyzeScreenshot(
  base64: string,
  apiKey: string,
  baseUrl: string = 'https://dashscope.aliyuncs.com/compatible-mode/v1',
): Promise<ActivityAnalysis> {
  const response = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen-vl-max',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + base64 } },
          { type: 'text', text: '分析这个屏幕截图。只输出JSON。' },
        ] },
      ],
      max_tokens: 200,
      temperature: 0.1,
    }),
  })

  if (!response.ok) throw new Error('AI 请求失败: ' + response.status)
  const data = await response.json()
  const content = data.choices?.[0]?.message?.content || ''
  const match = content.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('AI 返回格式错误')
  const result = JSON.parse(match[0]) as ActivityAnalysis
  if (!['dev', 'meeting', 'doc', 'communication', 'other'].includes(result.category)) result.category = 'other'
  return result
}

export async function generateReport(
  activities: Array<{ timestamp: string; description: string; category: string; app_name: string }>,
  type: 'daily' | 'weekly' | 'monthly',
  _template: string = 'standard',
  apiKey: string,
  baseUrl: string = 'https://dashscope.aliyuncs.com/compatible-mode/v1',
): Promise<string> {
  const text = activities.map(a => '[' + a.timestamp + '] ' + a.category + ' | ' + a.app_name + ' | ' + a.description).join('\n')
  const typeName = type === 'daily' ? '日报' : type === 'weekly' ? '周报' : '月报'

  const response = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen-max',
      messages: [{ role: 'user', content: '请根据以下活动记录生成' + typeName + '，按时间整理，突出重点，输出Markdown。\n\n' + text }],
      max_tokens: 2000,
      temperature: 0.3,
    }),
  })

  if (!response.ok) throw new Error('AI 请求失败')
  const data = await response.json()
  return data.choices?.[0]?.message?.content || '生成失败'
}
