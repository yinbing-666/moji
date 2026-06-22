import { useCallback, useRef } from 'react'
import { useScreenshot } from './useScreenshot'
import { useActivityStore } from '../stores/activityStore'
import { analyzeScreenshot } from '../utils/ai'

function compressBase64(pngBase64: string, maxWidth = 1280): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ratio = Math.min(1, maxWidth / img.width)
      canvas.width = Math.round(img.width * ratio)
      canvas.height = Math.round(img.height * ratio)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(pngBase64)
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.6).split(',')[1] || pngBase64)
    }
    img.onerror = () => resolve(pngBase64)
    img.src = 'data:image/png;base64,' + pngBase64
  })
}

export function useAutoCapture() {
  const { settings, addActivity, setIsAnalyzing } = useActivityStore()
  const analyzingRef = useRef(false)

  const handleCapture = useCallback(async (pngBase64: string) => {
    if (analyzingRef.current) return

    if (!settings.apiKey.trim()) {
      addActivity({
        category: 'other',
        app: 'Xiaohei Daily',
        title: 'Configuration missing',
        description: 'Capture skipped because API Key is not configured.',
      })
      return
    }

    analyzingRef.current = true
    setIsAnalyzing(true)

    try {
      const compressed = await compressBase64(pngBase64, 1280)
      const analysis = await analyzeScreenshot(compressed, settings.apiKey, settings.baseUrl)
      const thumbBase64 = await compressBase64(pngBase64, 320)

      addActivity({
        category: analysis.category,
        app: analysis.app,
        title: analysis.title,
        description: analysis.description,
        screenshotBase64: thumbBase64,
      })
    } catch (err) {
      console.error('AI analysis failed:', err)
      addActivity({
        category: 'other',
        app: 'Unknown',
        title: 'Screenshot analysis failed',
        description: 'AI analysis failed: ' + (err instanceof Error ? err.message : String(err)),
      })
    } finally {
      analyzingRef.current = false
      setIsAnalyzing(false)
    }
  }, [settings.apiKey, settings.baseUrl, addActivity, setIsAnalyzing])

  return useScreenshot({
    intervalSeconds: settings.intervalSeconds,
    autoStart: Boolean(settings.autoStart && settings.apiKey.trim()),
    onCapture: handleCapture,
  })
}
