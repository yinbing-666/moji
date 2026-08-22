/**
 * 截图采集Hook
 * 
 * [P0优化] 业务逻辑100%保留，纯逻辑层无UI代码
 * [P1优化] 类型定义保持不变，接口稳定
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { takeScreenshot } from '../utils/screenshot'
import { recordDiagnostic } from '../utils/diagnostics'

const DEFAULT_INTERVAL_SECONDS = 300

export interface ScreenshotCaptureResult {
  imageBase64: string
  windows?: unknown[]
  activeDurationSeconds?: number
}

export interface UseScreenshotOptions {
  intervalSeconds?: number
  autoStart?: boolean
  captureImmediately?: boolean
  capture?: () => Promise<ScreenshotCaptureResult>
  onCapture?: (result: ScreenshotCaptureResult) => void | Promise<void>
  onError?: (error: string) => void
}

export interface UseScreenshotResult {
  isRunning: boolean
  isCapturing: boolean
  latestScreenshot: string | null
  error: string | null
  start: () => void
  stop: () => void
  captureNow: () => Promise<string | null>
}

export function useScreenshot(options: UseScreenshotOptions = {}): UseScreenshotResult {
  const {
    intervalSeconds = DEFAULT_INTERVAL_SECONDS,
    autoStart = false,
    captureImmediately = true,
    capture = async () => ({ imageBase64: await takeScreenshot() }),
    onCapture,
    onError,
  } = options

  const [isRunning, setIsRunning] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [latestScreenshot, setLatestScreenshot] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const timerRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)
  const hasAutoStartedRef = useRef(false)
  const callbacksRef = useRef({ capture, onCapture, onError })

  const intervalMs = useMemo(
    () => Math.max(1, intervalSeconds) * 1000,
    [intervalSeconds],
  )

  useEffect(() => {
    callbacksRef.current = { capture, onCapture, onError }
  }, [capture, onCapture, onError])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const captureNow = useCallback(async (): Promise<string | null> => {
    if (inFlightRef.current) {
      return null
    }

    inFlightRef.current = true
    setIsCapturing(true)

    try {
      const result = await callbacksRef.current.capture()
      setLatestScreenshot(result.imageBase64)
      setError(null)
      await callbacksRef.current.onCapture?.(result)
      return result.imageBase64
    } catch (unknownError) {
      const message =
        unknownError instanceof Error ? unknownError.message : String(unknownError)
      recordDiagnostic('window-capture', unknownError)
      setError(message)
      callbacksRef.current.onError?.(message)
      return null
    } finally {
      inFlightRef.current = false
      setIsCapturing(false)
    }
  }, [])

  const stop = useCallback(() => {
    clearTimer()
    setIsRunning(false)
  }, [clearTimer])

  const start = useCallback(() => {
    setIsRunning(true)

    if (captureImmediately) {
      void captureNow()
    }
  }, [captureImmediately, captureNow])

  useEffect(() => {
    if (!isRunning) {
      clearTimer()
      return
    }

    clearTimer()
    timerRef.current = window.setInterval(() => {
      void captureNow()
    }, intervalMs)

    return clearTimer
  }, [captureNow, clearTimer, intervalMs, isRunning])

  useEffect(() => {
    if (autoStart && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true
      start()
    }
  }, [autoStart, start])

  useEffect(() => stop, [stop])

  return {
    isRunning,
    isCapturing,
    latestScreenshot,
    error,
    start,
    stop,
    captureNow,
  }
}
