# 技术选型 Spec

> 墨记的当前技术栈和下一阶段技术目标。

## 技术栈

| 层级 | 技术 | 版本/说明 | 当前状态 |
|------|------|-----------|----------|
| 桌面框架 | Tauri | 2.x | 已接入 |
| 前端框架 | React | 19 | 已接入 |
| 语言 | TypeScript | 5.x | 已接入 |
| 样式 | Tailwind CSS | 4.x | 已接入，当前主要使用工具类 |
| 构建 | Vite | 6.x | 已接入 |
| 截屏 | Rust `screenshots` | 0.8.x | 已接入 |
| 窗口枚举 | Windows API | `windows-sys` | 已接入 |
| 本地数据库 | SQLite | Tauri SQL Plugin | 依赖已接入，业务数据层未实现 |
| AI 接口 | OpenAI 兼容 | `/chat/completions` | 已接入 |
| 托盘 | Tauri `tray-icon` feature | 原生能力 | feature 已开，托盘逻辑未实现 |

## 桌面框架选择

选择 Tauri 的原因：

- 需要系统截图和 Windows 窗口枚举能力。
- 个人桌面工具不需要 Electron 的完整 Node 运行时。
- Rust 端更适合处理原生 API 和截图能力。

## 截图与窗口采集

### Tauri 命令

```rust
#[tauri::command]
fn take_screenshot() -> Result<String, String>

#[tauri::command]
fn capture_visible_windows(excluded_keywords: Option<Vec<String>>) -> Result<Vec<CapturedWindow>, String>
```

### CapturedWindow

```rust
pub struct CapturedWindow {
    hwnd: String,
    pid: u32,
    title: String,
    process_name: String,
    process_path: String,
    is_foreground: bool,
    z_index: usize,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    image_base64: String,
}
```

### 排序策略

1. 前台窗口优先。
2. 其次按 Windows 枚举得到的 Z 顺序。
3. 最后按窗口面积兜底。

这个策略替代旧的“面积最大优先”，减少系统大窗口或后台大窗口盖过用户实际工作窗口的问题。

### 已知限制

- 当前截图通过屏幕区域裁剪得到，不是真正的离屏窗口内容。
- 如果窗口被遮挡，截图内容可能与窗口标题/进程不一致。
- 部分 UWP、WebView 或系统宿主窗口仍可能需要额外解析真实应用。

## 数据存储

### 当前方案：localStorage

- 活动记录 key：`xiaohei-activities`。
- 设置 key：`xiaohei-settings`。
- 报告历史 key：`moji-report-history`，最多 20 条。
- API Key 只保存在本机 localStorage。
- 缩略图默认不保存，用户开启后才写入活动记录。

### 下一阶段：SQLite

`tauri-plugin-sql` 和 `rusqlite` 已在依赖中，但当前前端业务数据层没有接入。下一阶段应新增统一数据访问层，再迁移旧 localStorage 数据。

## AI 接口

### 窗口文本分析

```typescript
POST {baseUrl}/chat/completions
{
  model: '<用户在设置中填写的模型>',
  messages: [
    { role: 'system', content: '你是工作活动分析器...' },
    { role: 'user', content: '进程名 + 窗口标题 + 页面地址 + UIA 窗口文本 + 输出 JSON 要求' }
  ],
  max_tokens: 600,
  temperature: 0.1
}
```

返回值会归一化为：

```typescript
interface ActivityAnalysis {
  category: 'dev' | 'meeting' | 'doc' | 'communication' | 'other'
  app: string
  title: string
  description: string
}
```

### 报告生成

```typescript
POST {baseUrl}/chat/completions
{
  model: '<用户在设置中填写的模型>',
  messages: [{ role: 'user', content: prompt }],
  max_tokens: 2000,
  temperature: 0.3
}
```

当前报告 prompt 固定生成中文 Markdown，结构为：

- 主要完成
- 沟通协作
- 问题阻塞
- 明日/后续计划

## 前端结构

- `src/App.tsx`：首页、设置页切换、今日概览。
- `src/hooks/useScreenshot.ts`：截图计时器和截图结果分发。
- `src/hooks/useAutoCapture.ts`：多窗口采集、压缩、AI 分析、活动写入。
- `src/stores/activityStore.tsx`：活动和设置状态，localStorage 持久化。
- `src/components/ActivityTimeline.tsx`：搜索、筛选、编辑、删除、导出。
- `src/components/ReportView.tsx`：报告生成、复制、下载。
- `src/components/Settings.tsx`：AI、采集、隐私设置。
- `src/utils/reportHistory.ts`：报告历史 localStorage 读写。

## 安全考虑

1. API Key 仅保存在本机设置中，不进入代码仓库。
2. 默认不保存截图缩略图。
3. 排除关键词命中后不发送截图给 AI。
4. AI 分析上下文不发送完整本机进程路径，只发送可执行文件名。
5. 当前未启用 shell 权限。
6. 除 AI API 外没有云端同步。
7. 报告生成要求不编造活动记录之外的信息。
