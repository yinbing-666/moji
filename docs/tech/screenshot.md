# 截屏模块设计

> Rust 端截图 + TypeScript 封装 + React Hook

## 架构

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  React UI   │────▶│ useScreenshot│────▶│  screenshot │
│  (App.tsx)  │     │  (Hook)      │     │  (TS utils) │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │ invoke
                                         ┌──────▼──────┐
                                         │  Tauri IPC  │
                                         └──────┬──────┘
                                                │
                                         ┌──────▼──────┐
                                         │ Rust 截屏   │
                                         │ (screenshots│
                                         │  crate)     │
                                         └─────────────┘
```

## Rust 端 (src-tauri/src/screenshot.rs)

```rust
use screenshots::Screen;
use base64::Engine;

#[tauri::command]
pub fn take_screenshot() -> Result<String, String> {
    let screen = Screen::primary().map_err(|e| e.to_string())?;
    let image = screen.capture().map_err(|e| e.to_string())?;
    
    // PNG → base64
    let mut buffer = std::io::Cursor::new(Vec::new());
    image.write_to(&mut buffer, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    
    Ok(base64::engine::general_purpose::STANDARD
        .encode(buffer.into_inner()))
}
```

## TypeScript 封装 (src/utils/screenshot.ts)

```typescript
import { invoke } from '@tauri-apps/api/core'

export async function takeScreenshot(): Promise<string> {
  return invoke<string>('take_screenshot')
}
```

## React Hook (src/hooks/useScreenshot.ts)

```typescript
export function useScreenshot(options: {
  intervalSeconds: number
  autoStart: boolean
  onCapture: (base64: string) => void
}) {
  // - 定时器管理 (setInterval)
  // - start() / stop() 控制
  // - 组件卸载时自动清理
}
```

## 数据流

1. `useScreenshot` 每 N 秒调用 `takeScreenshot()`
2. Rust 端截图 → 返回 base64 PNG
3. 传给 `onCapture` 回调
4. `useAutoCapture` 接管：压缩 → AI 分析 → 存储

## 截图优化

- **压缩**: Canvas → JPEG (quality=0.6), max 1280px
- **缩略图**: Canvas → JPEG, max 320px (用于 UI 展示)
- **原图**: 仅在内存中，不持久化
