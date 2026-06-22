import { useCallback, useRef } from 'react'
import { useScreenshot } from './useScreenshot'
import { useActivityStore } from '../stores/activityStore'
import { analyzeScreenshot } from '../utils/ai'

export function useAutoCapture() {
  const { settings, addActivity, setIsAnalyzing } = useActivityStore()
  const analyzingRef = useRef(false)

  const handleCapture = useCallback(async (pngBase64: string) => {
    if (!settings.apiKey || analyzingRef.current) return

    analyzingRef.current = true
    setIsAnalyzing(true)

    try {
      const analysis = await analyzeScreenshot(pngBase64, settings.apiKey, settings.baseUrl)
      addActivity({
        category: analysis.category,
        app: analysis.app,
        title: analysis.title,
        description: analysis.description,
        screenshotBase64: pngBase64,
      })
    } catch (err) {
      console.error('AI 分析失败:', err)
      addActivity({
        category: 'other',
        app: '未知',
        title: '截图',
        description: 'AI 分析失败: ' + (err instanceof Error ? err.message : String(err)),
        screenshotBase64: pngBase64,
      })
    } finally {
      analyzingRef.current = false
      setIsAnalyzing(false)
    }
  }, [settings.apiKey, settings.baseUrl, addActivity, setIsAnalyzing])

  const screenshot = useScreenshot({
    intervalSeconds: settings.intervalSeconds,
    autoStart: settings.autoStart,
    onCapture: handleCapture,
  })

  return screenshot
}
