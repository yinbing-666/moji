import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { takeScreenshot } from '../utils/screenshot'

const DEFAULT_INTERVAL_SECONDS = 300

export interface UseScreenshotOptions {
  intervalSeconds?: number
  autoStart?: boolean
  captureImmediately?: boolean
  onCapture?: (pngBase64: string) => void
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
  const callbacksRef = useRef({ onCapture, onError })

  const intervalMs = useMemo(
    () => Math.max(1, intervalSeconds) * 1000,
    [intervalSeconds],
  )

  useEffect(() => {
    callbacksRef.current = { onCapture, onError }
  }, [onCapture, onError])

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
      const pngBase64 = await takeScreenshot()
      setLatestScreenshot(pngBase64)
      setError(null)
      callbacksRef.current.onCapture?.(pngBase64)
      return pngBase64
    } catch (unknownError) {
      const message =
        unknownError instanceof Error ? unknownError.message : String(unknownError)
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
