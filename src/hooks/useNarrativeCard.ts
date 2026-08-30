import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useState } from 'react'
import {
  buildLocalTemplate,
  buildNarrativeCacheSignature,
  buildNarrativeLlmPayload,
  computeNarrativeSummary,
  type NarrativeSummary,
} from '../utils/narrative'
import type { Activity } from '../stores/activityStore'
import { useActivityStore } from '../stores/activityStore'

interface NarrativeCardOptions {
  activities: Activity[]
  enableLLM?: boolean
}

function getCacheDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function removeOuterQuotes(value: string): string {
  return value
    .trim()
    .replace(/^(["“”「」『』])+/, '')
    .replace(/(["“”「」『』])+$/, '')
    .trim()
}

export function useNarrativeCard({
  activities,
  enableLLM,
}: NarrativeCardOptions): {
  text: string
  isLLM: boolean
  summary: NarrativeSummary
} {
  const { settings } = useActivityStore()
  const llmEnabled = enableLLM ?? settings.dataSource === 'llm'

  const { summary, localText } = useMemo(() => {
    const computedSummary = computeNarrativeSummary(activities, new Date())
    return {
      summary: computedSummary,
      localText: buildLocalTemplate(computedSummary),
    }
  }, [activities])

  const [text, setText] = useState(localText)
  const [isLLM, setIsLLM] = useState(false)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()

    setText(localText)
    setIsLLM(false)

    if (!llmEnabled || summary.totalSeconds <= 0) {
      return () => {
        active = false
        if (timer) clearTimeout(timer)
        controller.abort()
      }
    }

    const apiKey = settings.apiKey
    const baseUrl = settings.baseUrl
    const textModel = settings.textModel

    if (!apiKey || !baseUrl || !textModel) {
      return () => {
        active = false
        if (timer) clearTimeout(timer)
        controller.abort()
      }
    }

    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return () => {
        active = false
        if (timer) clearTimeout(timer)
        controller.abort()
      }
    }

    const cacheDate = getCacheDate()
    const cacheKey = `moji-narrative-llm-${cacheDate}`
    const llmPayload = buildNarrativeLlmPayload(summary)
    const cacheSignature = buildNarrativeCacheSignature(llmPayload, textModel, baseUrl)

    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as unknown
          if (
            parsed
            && typeof parsed === 'object'
            && 'signature' in parsed
            && 'text' in parsed
            && parsed.signature === cacheSignature
            && typeof parsed.text === 'string'
            && parsed.text.trim()
            && parsed.text.length <= 40
          ) {
            setText(parsed.text)
            setIsLLM(true)

            return () => {
              active = false
              if (timer) clearTimeout(timer)
              controller.abort()
            }
          }
        } catch {
          // 旧版纯字符串缓存没有数据签名，忽略后重新生成。
        }
      }
    } catch {
      console.warn('读取今日叙事卡缓存失败，将使用本地模板。')
    }

    const request = async (): Promise<void> => {
      try {
        timer = setTimeout(() => controller.abort(), 3000)

        const content = await new Promise<string>((resolve, reject) => {
          const onAbort = () => reject(new Error('Request timed out'))
          controller.signal.addEventListener('abort', onAbort, { once: true })

          invoke<string>('chat_completions', {
            req: {
              baseUrl: baseUrl.replace(/\/+$/, ''),
              apiKey,
              model: textModel,
              messages: [
                {
                  role: 'system',
                  content:
                    '用中文写一句不超过40字的今日活动陈述，只依据给出的聚合摘要事实，不臆测、不评价、不编造，直接输出句子本身，不要引号或前缀。',
                },
                {
                  role: 'user',
                  content: JSON.stringify(llmPayload),
                },
              ],
              maxTokens: 60,
              temperature: 0.3,
            },
          })
            .then((result) => {
              controller.signal.removeEventListener('abort', onAbort)
              resolve(result)
            })
            .catch((error) => {
              controller.signal.removeEventListener('abort', onAbort)
              reject(error)
            })
        })

        const cleaned = removeOuterQuotes(content)
        if (!cleaned || cleaned.length > 40) {
          throw new Error('响应内容不符合长度要求')
        }

        if (!active) {
          return
        }

        setText(cleaned)
        setIsLLM(true)

        try {
          localStorage.setItem(cacheKey, JSON.stringify({ signature: cacheSignature, text: cleaned }))
        } catch {
          console.warn('保存今日叙事卡缓存失败。')
        }
      } catch {
        if (active) {
          console.warn('今日叙事卡生成失败，将使用本地模板。')
        }
      } finally {
        if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
      }
    }

    void request()

    return () => {
      active = false
      if (timer) clearTimeout(timer)
      controller.abort()
    }
  }, [localText, llmEnabled, settings.apiKey, settings.baseUrl, settings.textModel, summary])

  return { text, isLLM, summary }
}
