import { invoke } from '@tauri-apps/api/core'

const TAURI_SCREENSHOT_TIMEOUT_MS = 15000

export interface CapturedWindow {
  hwnd: string
  pid: number
  title: string
  process_name: string
  process_path: string
  is_foreground: boolean
  z_index: number
  x: number
  y: number
  width: number
  height: number
  image_base64: string
}

async function takeScreenshotWithTimeout(): Promise<string> {
  if (!('__TAURI_INTERNALS__' in window)) {
    throw new Error('当前在浏览器预览中，无法调用系统截图。请在桌面应用窗口中使用截图功能。')
  }

  return Promise.race([
    invoke<string>('take_screenshot'),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('截图命令超时（' + TAURI_SCREENSHOT_TIMEOUT_MS / 1000 + '秒未响应），请检查系统权限或重启应用。')),
        TAURI_SCREENSHOT_TIMEOUT_MS,
      ),
    ),
  ])
}

// 整屏截图能力，当前业务路径已由 captureVisibleWindows（按窗口采集）取代，此处作为备用接口保留
export async function takeScreenshot(): Promise<string> {
  return takeScreenshotWithTimeout()
}

export async function captureVisibleWindows(excludedKeywords: string[] = []): Promise<CapturedWindow[]> {
  if (!('__TAURI_INTERNALS__' in window)) {
    throw new Error('当前在浏览器预览中，无法调用系统截图。请在桌面应用窗口中使用截图功能。')
  }

  return Promise.race([
    invoke<CapturedWindow[]>('capture_visible_windows', { excludedKeywords }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('窗口截图命令超时（' + TAURI_SCREENSHOT_TIMEOUT_MS / 1000 + '秒未响应），请检查系统权限或重启应用。')),
        TAURI_SCREENSHOT_TIMEOUT_MS,
      ),
    ),
  ])
}
