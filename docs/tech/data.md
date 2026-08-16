# 数据结构设计

> 墨记当前使用 localStorage 保存活动和设置；SQLite 是下一阶段目标，不是当前已完成实现。

## 当前核心类型

### Activity

```typescript
interface Activity {
  id: string
  timestamp: string
  category: 'dev' | 'meeting' | 'doc' | 'communication' | 'other'
  app: string
  title: string
  description: string
  screenshotBase64?: string
}
```

| 字段 | 说明 |
|------|------|
| `id` | 唯一 ID，由时间戳和随机片段生成 |
| `timestamp` | ISO 8601 时间戳 |
| `category` | 活动分类 |
| `app` | 应用名称或进程名 |
| `title` | 窗口标题 |
| `description` | AI 识别或用户修正后的活动说明 |
| `screenshotBase64` | 可选缩略图；默认不保存 |

### Settings

```typescript
interface Settings {
  apiKey: string
  intervalSeconds: number
  maxWindowsPerCapture: number
  autoStart: boolean
  baseUrl: string
  excludedKeywords: string[]
  saveScreenshotThumbnails: boolean
}
```

| 字段 | 说明 |
|------|------|
| `apiKey` | OpenAI 兼容接口密钥，仅保存在本机 |
| `intervalSeconds` | 截图间隔，最小 10 秒 |
| `maxWindowsPerCapture` | 每轮最多进入 AI 分析的窗口数，默认 3，范围 1-8 |
| `autoStart` | 应用打开后是否自动开始截图 |
| `baseUrl` | OpenAI 兼容接口地址 |
| `excludedKeywords` | 命中后跳过的应用、窗口或进程关键词 |
| `saveScreenshotThumbnails` | 是否保存压缩截图缩略图，默认关闭 |

### ReportHistoryItem

```typescript
type ReportType = 'daily' | 'weekly' | 'monthly'

interface ReportHistoryItem {
  id: string
  createdAt: string
  type: ReportType
  content: string
}
```

最多保留最近 20 条报告历史，只保存报告正文，不保存 API Key 或截图。

### CapturedWindow

```typescript
interface CapturedWindow {
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
```

窗口采集结果由 Rust 返回。排序规则是前台窗口优先，其次按 Z 顺序，再按窗口面积兜底。

## 当前 localStorage

### `xiaohei-activities`

保存活动记录数组。

### `xiaohei-settings`

保存用户设置，包括 API Key、Base URL、截图间隔、每轮分析窗口数、自动启动、隐私排除关键词、缩略图开关。

### `moji-report-history`

保存最近 20 条报告历史。

## 当前数据流

### 写入活动

```text
窗口截图
  -> 前台窗口优先
  -> 按进程名和窗口标题去重
  -> 根据 maxWindowsPerCapture 截断窗口列表
  -> 图片压缩
  -> AI 分析
  -> 根据设置决定是否附带缩略图
  -> 生成 Activity
  -> 写入 localStorage
```

### 读取活动

```text
应用启动
  -> 从 localStorage 读取活动
  -> 归一化旧数据和异常字段
  -> React Context 提供给首页、活动记录、报告页
```

读取活动记录时会校验数组结构、分类、时间戳和文本字段。无法识别的单条记录会被丢弃或补默认值，避免旧版本数据或手动修改 localStorage 导致页面崩溃。

### 报告生成

```text
读取活动
  -> 按报告范围筛选：今天 / 全部记录，默认今天
  -> 取有描述的记录
  -> 调用文本模型生成 Markdown
  -> 写入 moji-report-history
  -> 支持复制或下载
```

## 目标 SQLite 设计

SQLite 是下一阶段目标。目标数据库为 `sqlite:moji.db`。

### activities 表

```sql
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  category TEXT NOT NULL,
  app TEXT NOT NULL,
  title TEXT,
  description TEXT NOT NULL,
  screenshot_base64 TEXT
);
```

### 索引

```sql
CREATE INDEX IF NOT EXISTS idx_activities_timestamp
ON activities(timestamp DESC);
```

### 目标读写策略

- 新增活动：`INSERT OR REPLACE`。
- 编辑活动：按 `id` 覆盖保存。
- 删除活动：`DELETE FROM activities WHERE id = $1`。
- 清空活动：`DELETE FROM activities`。
- 读取活动：按 `timestamp DESC` 排序。
- 首次启用 SQLite 时迁移旧 `xiaohei-activities` 数据。

## 隐私约束

- 默认不保存截图缩略图。
- 排除关键词命中时不进入截图分析流程。
- API Key 不写入代码、不写入导出文件。
- AI 分析上下文不发送完整本机进程路径，只发送可执行文件名。
- 活动记录只保存在本机。
