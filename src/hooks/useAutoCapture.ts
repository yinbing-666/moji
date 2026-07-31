import { useCallback, useRef } from 'react'
import { useScreenshot, type ScreenshotCaptureResult } from './useScreenshot'
import { useActivityStore } from '../stores/activityStore'
import { analyzeScreenshot } from '../utils/ai'
import { captureVisibleWindows, type CapturedWindow } from '../utils/screenshot'

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

function windowIdentity(window: CapturedWindow): string {
  return [
    window.process_name.trim().toLowerCase(),
    window.title.trim().toLowerCase(),
  ].join('::')
}

function selectWindowsForAnalysis(windows: CapturedWindow[], maxWindows: number): CapturedWindow[] {
  const selected: CapturedWindow[] = []
  const seen = new Set<string>()
  const limit = Math.min(8, Math.max(1, Math.round(maxWindows)))

  for (const window of windows) {
    const key = windowIdentity(window)
    if (seen.has(key)) continue
    seen.add(key)
    selected.push(window)
    if (selected.length >= limit) break
  }

  return selected
}

export function useAutoCapture() {
  const { settings, addActivity, setIsAnalyzing } = useActivityStore()
  const analyzingRef = useRef(false)

  const captureAllowedWindows = useCallback(async (): Promise<ScreenshotCaptureResult> => {
    const windows = await captureVisibleWindows(settings.excludedKeywords)
    const selectedWindows = selectWindowsForAnalysis(windows, settings.maxWindowsPerCapture)

    if (selectedWindows.length > 0) {
      // 预览图只用于右下角小窗展示，压成小尺寸 JPEG，避免原始未压缩 PNG（可能几 MB）常驻 React state
      const preview = await compressBase64(selectedWindows[0].image_base64, 320)
      return {
        imageBase64: preview,
        windows: selectedWindows,
      }
    }

    // 无窗口时不返回占位图，preview 为空字符串，右下角预览不渲染
    return {
      imageBase64: '',
      windows: [],
    }
  }, [settings.excludedKeywords, settings.maxWindowsPerCapture])

  const handleCapture = useCallback(async (result: ScreenshotCaptureResult) => {
    if (analyzingRef.current) return

    if (!settings.apiKey.trim()) {
      addActivity({
        category: 'other',
        app: '墨记',
        title: '配置缺失',
        description: '未配置 API Key，本次截图已跳过分析。',
      })
      return
    }

    analyzingRef.current = true
    setIsAnalyzing(true)

    try {
      const capturedWindows = (result.windows ?? []) as CapturedWindow[]

      if (capturedWindows.length === 0) {
        return
      }

      // 各窗口并发压缩+分析，单个失败不拖垮其他；失败的窗口仍落一条"截图分析失败"记录
      const results = await Promise.allSettled(
        capturedWindows.map(async (capturedWindow) => {
          const compressed = await compressBase64(capturedWindow.image_base64, 1280)
          const analysis = await analyzeScreenshot(
            compressed,
            settings.apiKey,
            settings.baseUrl,
            {
              app: capturedWindow.process_name,
              title: capturedWindow.title,
              processPath: capturedWindow.process_path,
              isForeground: capturedWindow.is_foreground,
            },
          )

          return {
            category: analysis.category,
            app: analysis.app || capturedWindow.process_name,
            title: analysis.title || capturedWindow.title,
            description: analysis.description,
            screenshotBase64: settings.saveScreenshotThumbnails ? compressed : undefined,
          }
        }),
      )

      for (const item of results) {
        if (item.status === 'fulfilled') {
          addActivity(item.value)
        } else {
          const err = item.reason
          console.error('AI analysis failed:', err)
          addActivity({
            category: 'other',
            app: '未知应用',
            title: '截图分析失败',
            description: 'AI 分析失败：' + (err instanceof Error ? err.message : String(err)),
          })
        }
      }
    } finally {
      analyzingRef.current = false
      setIsAnalyzing(false)
    }
  }, [settings.apiKey, settings.baseUrl, settings.saveScreenshotThumbnails, addActivity, setIsAnalyzing])

  return useScreenshot({
    intervalSeconds: settings.intervalSeconds,
    autoStart: Boolean(settings.autoStart && settings.apiKey.trim()),
    capture: captureAllowedWindows,
    onCapture: handleCapture,
  })
}
