# AI 管道设计

> 窗口文本分析 + 报告生成的当前实现。已移除视觉（多模态）模型，改用 UI Automation 文本 + 纯文本模型。

## 架构

```text
Rust 枚举可见窗口
  -> 前台窗口优先排序
  -> 隐私关键词排除
  -> 按进程名和窗口标题去重
  -> 根据 maxWindowsPerCapture 截断窗口列表
  -> （可选）截屏，仅在用户开启“保存截图缩略图”时
  -> Rust UI Automation 只读采集窗口内控件文本（Name + Value，跳过密码框）
  -> 纯文本 LLM 分析（与报告生成共用同一模型；请求经 Rust `chat_completions` 代理，绕过浏览器 CORS）
  -> JSON { category, app, title, description }
  -> 写入 localStorage + SQLite
  -> UI 展示活动时间线
  -> 用户触发报告生成（同一纯文本模型）
  -> 按指定本地日期筛选活动
  -> 选择内置或自定义模板；自定义模板可在报告页本地 CRUD
  -> 将模板描述注入报告 prompt
  -> Markdown
  -> 仅成功生成的报告进入正文和历史；配置、空记录、失败只显示为提示
  -> 保存到 moji-report-history（localStorage + SQLite）
  -> 复制或下载
```

## 窗口文本采集（UIA）

新增 `src-tauri/src/uia.rs`，暴露命令 `read_window_text(hwnd, max_chars)`：

- 通过 `windows` crate 的 `Win32_UI_Accessibility` 完整 COM 绑定调用 UIA。
- `CoCreateInstance(CUIAutomation)` → `ElementFromHandle(hwnd)` → `ControlViewWalker` 深度优先遍历。
- 每个控件采集 `CurrentName`；编辑框/文档/文本控件额外经 `ValuePattern` 采集 `CurrentValue`（截断 500 字符）。
- 跳过 `CurrentIsPassword` 的密码框；文本按行去重，总长度受 `max_chars`（默认 2000，上限 12000）约束。
- 全局 `Mutex` 串行化 UIA 访问：UIA 客户端库并发初始化存在竞态（实测并发调用 E_FAIL），串行化后稳定。
- HWND 字符串解析兼容 `HWND(0x...)`（Debug 格式）、`0x...` 十六进制和十进制。

已用 `cargo test -- --ignored` 在真实桌面验证：前台 Chrome 窗口可读到地址栏、标签页标题、按钮、列表项等 54 个控件、851 字符文本；3 线程并发串行化后全部成功。

## AI 分析

### System Prompt

```text
你是工作活动分析器。请根据单个窗口的文本信息（进程名、窗口标题、窗口内控件文本）判断用户正在做什么，只输出 JSON：
{"category":"dev|meeting|doc|communication|other","app":"应用名","title":"窗口标题","description":"用简体中文概括用户正在做的事"}。
不要输出 Markdown。
```

### User Context

每个窗口会附带：

- 进程名。
- 可执行文件名；不会把完整本机进程路径发送给 AI。
- 窗口标题。
- 是否前台窗口。
- 窗口内 UIA 文本；采集为空时提示模型主要依据进程名与标题判断。

### 分类定义

| 分类 | 说明 | 典型场景 |
|------|------|----------|
| `dev` | 开发 | IDE、终端、代码编辑器 |
| `meeting` | 会议 | 视频会议、日历 |
| `doc` | 文档 | Word、Notion、飞书文档 |
| `communication` | 沟通 | 微信、Slack、邮件 |
| `other` | 其他 | 浏览器、设计工具等 |

### 错误处理

- API Key 或 Base URL 缺失：不启动采集；若触发分析则写入一条中文提示记录。
- 请求超时：抛出中文错误信息。
- HTTP 错误映射为可行动的中文提示：401 = Key 无效或已过期、403 = 无权限、404 = 模型/接口不存在、429 = 限流或额度不足、5xx = 服务端异常。
- AI 返回非 JSON：先尝试解析完整 JSON，再尝试提取第一个平衡的 `{...}`；提取失败则报错。
- 分类无效：降级为 `other`。
- UIA 读取失败（如应用不支持）：降级为仅凭进程名 + 窗口标题分析。
- 分析失败：降级为本地确定性分类（进程名/标题 → 分类 + 模板描述），描述中附失败原因，不再写入无意义的“分析失败”记录。

### 本地降级分类

不依赖 AI 的确定性分类，用于 AI 失败时兜底（也作为给模型的预判提示）：

- 已知进程名/标题 → 分类：VS Code/IDE/终端 → `dev`；微信/飞书/钉钉/Slack/邮件 → `communication`；腾讯会议/Zoom/Teams → `meeting`；Word/Notion/Excel → `doc`。
- 未知进程 → `other`，描述为「进程名 · 分类」模板。

## 报告生成

### Prompt

```text
请根据以下活动记录生成一份简洁的中文 Markdown 日报。
结构固定为：主要完成、沟通协作、问题阻塞、明日/后续计划。
不要编造记录中不存在的成果。

[timestamp] category | app_name | description
...
```

### 输出

当前不强制解析 Markdown 结构，直接展示模型返回内容。用户可以：

- 选择报告日期。
- 复制报告。
- 下载 Markdown。
- 从历史报告中恢复查看。

配置缺失、当前范围无活动、生成失败和 AI 空返回会显示为页面提示，不写入报告正文，不进入历史，也不会触发复制或下载。

### 历史保存

- localStorage key：`moji-report-history`（同时写入 SQLite `report_history` 表）。
- 最多保留最近 20 条。
- 字段：`id`、`createdAt`、`type`、`template`、`content`。
- 不保存 API Key。
- 仅保存成功生成且非空的报告正文。

## 设置结构

```typescript
interface Settings {
  apiKey: string
  intervalSeconds: number
  maxWindowsPerCapture: number
  autoStart: boolean
  baseUrl: string
  textModel: string          // 活动分析与报告生成共用的纯文本模型
  excludedKeywords: string[]
  excludedApps: string[]
  excludedTitlePatterns: string[]
  saveScreenshotThumbnails: boolean
  appearance: Appearance
  dataSource: 'window_text' | 'aw'
  awHost: string
  awPort: number
  awSyncMinutes: number
}
```

## 默认值

```typescript
const DEFAULT_SETTINGS = {
  apiKey: '',
  intervalSeconds: 300,
  maxWindowsPerCapture: 3,
  autoStart: false,
  baseUrl: '<用户在设置中填写的 OpenAI 兼容端点>',
  textModel: '<模型名>',
  excludedKeywords: ['Password', 'Token', 'Bank', '钱包', '验证码', '密钥'],
  saveScreenshotThumbnails: false,
  dataSource: 'window_text',
}
```

## 旧配置迁移

- `analysisModel` / `reportModel` 已合并为 `textModel`；加载旧设置时优先取 `textModel`，否则回退 `reportModel`。
- 旧 `dataSource: 'screenshot'` 自动迁移为 `'window_text'`。

## 存储

- 设置 localStorage key：`xiaohei-settings`。
- 活动记录 localStorage key：`xiaohei-activities`，同步写入 SQLite `activities` 表。
- 报告历史 localStorage key：`moji-report-history`，同步写入 SQLite `report_history` 表。

## 性能限制

- Rust 端最多返回 8 个窗口。
- 前端默认只选 3 个窗口进入 AI，可在设置中调整为 1/2/3/5/8。
- 各窗口分析并发执行（UIA 读取由 Rust 全局锁串行化，毫秒级开销可忽略）。
- 截图仅在开启缩略图时发生，识别路径完全不产生图像数据。
