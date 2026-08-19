/**
 * 自动采集Hook - 组合截图 + AI分析
 * 
 * [P0优化] 业务逻辑100%保留，核心采集流程不变
 * [P1优化] 锁屏检测、空闲跳过、本地降级分类等策略完整保留
 */
import { useCallback, useEffect, useRef } from 'react'
import { useScreenshot, type ScreenshotCaptureResult } from './useScreenshot'
import { useActivityStore, type Activity } from '../stores/activityStore'
import { analyzeWindowText, classifyLocally } from '../utils/ai'
import { captureVisibleWindows, type CapturedWindow } from '../utils/screenshot'
import { dbGetIdleSeconds, dbIsScreenLocked, dbReadWindowText, dbWriteAwWindowEvent } from '../utils/db'

/** 空闲超过该秒数则跳过本轮采集（约 10 分钟） */
const IDLE_SKIP_SECONDS = 600

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
  const hasAiConfig = Boolean(
    settings.apiKey.trim()
    && settings.baseUrl.trim()
    && settings.textModel.trim(),
  )
  const localMode = settings.dataSource === 'local'

  const captureAllowedWindows = useCallback(async (): Promise<ScreenshotCaptureResult> => {
    // 锁屏或长时间空闲时跳过，避免浪费 API 与产生无意义记录
    try {
      const locked = await dbIsScreenLocked()
      if (locked) {
        return { imageBase64: '', windows: [] }
      }
      const idle = await dbGetIdleSeconds()
      if (idle !== null && idle >= IDLE_SKIP_SECONDS) {
        return { imageBase64: '', windows: [] }
      }
    } catch {
      // 系统检测不可用时继续正常采集
    }

    // 截图仅在用户开启"保存截图缩略图"时才采集；活动识别本身只依赖窗口文本
    // 在 Rust 端先过滤，确保开启缩略图时排除窗口也不会先被截屏。
    const captureExclusions = [
      ...settings.excludedKeywords,
      ...settings.excludedApps,
      ...settings.excludedTitlePatterns,
    ]
    const windows = await captureVisibleWindows(captureExclusions, settings.saveScreenshotThumbnails)

    // 前端二次过滤：排除指定应用名 + 标题关键词
    const excludedApps = settings.excludedApps ?? []
    const excludedTitlePatterns = settings.excludedTitlePatterns ?? []
    const filteredWindows = (excludedApps.length > 0 || excludedTitlePatterns.length > 0)
      ? windows.filter(w => {
          const appLower = w.process_name.toLowerCase()
          const titleLower = w.title.toLowerCase()
          if (excludedApps.some(a => appLower.includes(a.toLowerCase()))) return false
          if (excludedTitlePatterns.some(p => titleLower.includes(p.toLowerCase()))) return false
          return true
        })
      : windows

    const selectedWindows = selectWindowsForAnalysis(filteredWindows, settings.maxWindowsPerCapture)

    // 预览图仅在用户开启缩略图功能时有内容；识别本身不需要图像
    if (selectedWindows.length > 0 && selectedWindows[0].image_base64) {
      const preview = await compressBase64(selectedWindows[0].image_base64, 320)
      return {
        imageBase64: preview,
        windows: selectedWindows,
      }
    }

    return {
      imageBase64: '',
      windows: selectedWindows,
    }
  }, [settings.excludedKeywords, settings.excludedApps, settings.excludedTitlePatterns, settings.maxWindowsPerCapture, settings.saveScreenshotThumbnails])

  const handleCapture = useCallback(async (result: ScreenshotCaptureResult) => {
    if (analyzingRef.current) return

    if (!localMode && !hasAiConfig) {
      // 有 LLM 模式配置缺失时不写入活动数据流，避免污染时间轴和统计。
      console.warn('墨记：AI 配置不完整，本轮采集已跳过分析')
      return
    }

    analyzingRef.current = true
    setIsAnalyzing(true)

    try {
      const capturedWindows = (result.windows ?? []) as CapturedWindow[]

      if (capturedWindows.length === 0) {
        return
      }

      // 各窗口并发采集 UIA 文本 + 分析；单个失败降级为本地分类，不拖垮其他
      const results = await Promise.all(
        capturedWindows.map(async (capturedWindow): Promise<
          { ok: true; capturedWindow: CapturedWindow; category: Activity['category']; app: string; title: string; description: string; screenshotBase64?: string }
          | { ok: false; capturedWindow: CapturedWindow; error: string }
        > => {
          try {
            if (localMode) {
              const local = classifyLocally(capturedWindow.process_name, capturedWindow.title)
              const thumbnail = settings.saveScreenshotThumbnails && capturedWindow.image_base64
                ? await compressBase64(capturedWindow.image_base64, 320)
                : undefined
              return {
                ok: true,
                capturedWindow,
                category: local.category,
                app: local.app || capturedWindow.process_name,
                title: local.title || capturedWindow.title,
                description: local.description,
                screenshotBase64: thumbnail,
              }
            }

            // 读取窗口内 UIA 文本（本地、只读，替代截图）
            const windowText = await dbReadWindowText(capturedWindow.hwnd, 2000)

            const analysis = await analyzeWindowText(
              windowText?.text ?? '',
              settings.apiKey,
              settings.baseUrl,
              settings.textModel,
              {
                app: capturedWindow.process_name,
                title: capturedWindow.title || windowText?.title || '',
                processPath: capturedWindow.process_path,
                isForeground: capturedWindow.is_foreground,
              },
            )

            // 可选缩略图：用户开启时才压缩保存（与识别无关，仅用于回顾展示）
            const thumbnail = settings.saveScreenshotThumbnails && capturedWindow.image_base64
              ? await compressBase64(capturedWindow.image_base64, 320)
              : undefined

            return {
              ok: true,
              capturedWindow,
              category: analysis.category,
              app: analysis.app || capturedWindow.process_name,
              title: analysis.title || capturedWindow.title,
              description: analysis.description,
              screenshotBase64: thumbnail,
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return { ok: false, capturedWindow, error: message }
          }
        }),
      )

      for (const item of results) {
        if (item.ok) {
          addActivity({
            category: item.category,
            app: item.app,
            title: item.title,
            description: item.description,
            screenshotBase64: item.screenshotBase64,
          })
        } else {
          console.error('AI analysis failed:', item.error)
          // 降级：用进程名本地确定性分类，避免"分析失败"噪音，同时保留失败原因便于排查
          const local = classifyLocally(item.capturedWindow.process_name, item.capturedWindow.title)
          addActivity({
            category: local.category,
            app: local.app || item.capturedWindow.process_name,
            title: item.capturedWindow.title,
            description: `AI 分析失败（${item.error}）· 本地判断：${local.description}`,
          })
        }
      }

      // ActivityWatch 的时间线仅应写入前台窗口，避免多窗口预览重复累计时长。
      const foreground = capturedWindows.find(window => window.is_foreground) ?? capturedWindows[0]
      if (foreground) {
        void dbWriteAwWindowEvent({
          app: foreground.process_name,
          title: foreground.title,
          duration: settings.intervalSeconds,
          timestamp: new Date().toISOString(),
        })
      }
    } finally {
      analyzingRef.current = false
      setIsAnalyzing(false)
    }
  }, [hasAiConfig, localMode, settings.apiKey, settings.baseUrl, settings.textModel, settings.saveScreenshotThumbnails, settings.intervalSeconds, addActivity, setIsAnalyzing])

  const screenshot = useScreenshot({
    intervalSeconds: settings.intervalSeconds,
    // 有 LLM 和无 LLM 模式都使用墨记自己的窗口采集；无 LLM 只跳过 UIA/网络分析。
    autoStart: Boolean(settings.autoStart && (localMode || hasAiConfig)),
    capture: captureAllowedWindows,
    onCapture: handleCapture,
  })

  // 切换到有 LLM 且配置失效时，停止已经运行中的窗口采集计时器。
  useEffect(() => {
    if (!localMode && !hasAiConfig) screenshot.stop()
  }, [hasAiConfig, localMode, screenshot.stop])

  return screenshot
}
