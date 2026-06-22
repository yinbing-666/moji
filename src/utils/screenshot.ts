import { invoke } from '@tauri-apps/api/core'

export async function takeScreenshot(): Promise<string> {
  return invoke<string>('take_screenshot')
}
