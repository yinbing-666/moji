# 墨记开发交接笔记（Dev Handoff）

> 本文件是「跨会话记忆」：新会话先读这个 + `git log`，即可接上全部上下文。
> 记录周期：2026-08 中旬的整轮开发（K3 方案、模式 B、AW Skill 集成等）。

## 一、项目一句话

墨记 = 本地 Tauri 2 桌面工作复盘工具（React 19 + TypeScript + Tailwind 4 + Rust）。跟踪用户工作活动并生成日报。

## 二、当前架构（两种数据模式）

`dataSource` 两态：`llm | local`

| 模式 | 行为 |
|---|---|
| `llm` | Rust UIA 读窗口文本 → 用户配置的纯文本模型分析 → 活动记录与 AI 报告 |
| `local` | 墨记枚举窗口 → 本地进程/标题规则分类 → 固定格式 Markdown 报告，不调用网络 |

关键链路：
- **识别**：`screenshot.rs` 窗口枚举（captureImages=false 不截图）→ `uia.rs read_window_text`（UIA 文本，噪声 denylist）→ `ai.ts analyzeWindowText`（URL 提取 + 本地预判 + 强 prompt）→ Rust `ai.rs chat_completions`（reqwest 代理，绕过 CORS，`enable_thinking:false`）
- **模型**：`textModel` 默认留空（用户在设置中填写；活动分析 max_tokens=600）
- **效率分析**：`aw_analytics.rs` 调 Python 脚本 `tools/activitywatch-analytics/`（ActivityWatch Analytics Skill，用户私有 Gitea）→ report.json → 前端 `AwAnalytics.tsx` 展示 Pulse 评分/深度工作/等级分布，`launch_activitywatch` 可一键启动 AW

## 三、关键文件职责

```
src/App.tsx                  首页/导航/两种数据模式 + 窄屏图标侧栏
src/components/TodayOverview 今日统计 + 30/15 分钟时间轴（对数缩放）+ 分类分布
src/components/AwAnalytics   效率分析卡片（AW Skill 集成，任何数据源可用）
src/components/Settings      P1 表单版；两种数据模式、采集行为、隐私排除、数据库备份
src/components/ReportView    报告页（模板、质量评分、打印/PDF、历史）
src/stores/activityStore     状态 + addActivity 去重 + SQLite 双写
src/utils/ai.ts              文本模型调用（invoke Rust 代理）+ classifyLocally 降级
src/utils/db.ts              Tauri 命令封装（含 runAwAnalytics/openAwReport/launchActivitywatch）
src/utils/reportQuality.ts   报告质量评分（记录数、时间跨度、分类多样性）
src/utils/localReport.ts     无 LLM 固定格式日报生成
src/utils/templates.ts       内置模板和自定义模板本地 CRUD
src-tauri/src/aw_analytics.rs Python 脚本集成 + launch_activitywatch
src-tauri/src/ai.rs          chat_completions 代理（enable_thinking:false）
src-tauri/src/uia.rs         UIA 窗口文本采集（噪声过滤 + 并发锁）
tools/activitywatch-analytics/  vendored Python 分析脚本（来自用户 Gitea）
```

## 四、这轮踩过的坑（务必先读，别重蹈）

1. **K3 的"优化代码"是压缩版且带语法错误**（`model:messages:msgs` 缺逗号等），**不能直接采用**。只提取了它的视觉方向（teal 色、纯色按钮、无 emoji、圆角/阴影/字号层级 index.css）。K3 给代码必须先 tsc 验证。
2. **P1 版 Settings 重写时丢过功能**（采集行为/隐私排除/备份分区），已从 git `0ba65ba` 找回补全。**git 是安全网，改动前先 commit 或建分支**。
3. **`src-tauri/target/` 曾有 5938 个编译产物被误跟踪**，已 `git rm --cached` 清理（commit `90fc35d`）。之后 `git add -A src-tauri` 小心别又把 target 加进去（gitignore 对已跟踪文件无效）。
4. **PowerShell 写源码会破坏中文编码**（`Set-Content` 默认编码问题，曾把 Settings.tsx 写乱）。**改源码一律用 edit/write 工具，别用 PowerShell 写回**。
5. **Tauri 嵌套 struct 参数不自动 camelCase→snake_case**：`req` 包装的 struct 字段要 `#[serde(rename_all="camelCase")]`（见 `ai.rs`、`db.rs PaginatedParams`）。
6. **今日时间轴柱状图**：线性归一化会溢出（超高柱）或太矮（小柱不可见）。当前 30/15 分钟模式均用**对数缩放** `log(count+1)/log(max+1)` + `overflow-hidden`；15 分钟模式保持 96 格并在窄屏横向滚动。
7. **视觉桥**：会话是纯文本模型，图片经 modlens 转述文字传入；要看图需支持图片的模型。

## 五、验证手段（新会话直接复用）

```bash
npm run build          # 前端 tsc + vite
cd src-tauri && cargo check --locked
cd src-tauri && cargo test --locked
cd src-tauri && cargo test --locked -- --ignored  # 真实桌面测试
# 真实 Tauri 运行验证（关键）：带 CDP 启动后，用 playwright-core connectOverCDP 操作
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'; npm run tauri dev
```
- 保留的验证脚本：`_verify_e2e.cjs`（端到端识别）、`_verify_ipc.cjs`（IPC 链路）、`_verify_ui.cjs`（UI 渲染）
- 临时验证脚本用完即删（避免带密钥/污染）。

## 六、待办 / 可继续方向

- [ ] AW Skill SVG 图表标题是英文（Category distribution 等），zh-CN 下可本地化（在 Python 脚本里）
- [ ] 开机自启 / 全局快捷键（系统托盘与关闭隐藏已实现）
- [x] 报告页接入内置 / 自定义模板选择、创建、编辑和删除；模板标识写入报告历史
- [x] 报告质量评分、系统打印 / PDF
- [x] 15 分钟 96 格时间轴、具体活动悬停提示和窄屏图标侧栏
- [x] 默认跟随系统的深浅色主题，可强制浅色/深色，背景预设与打印样式已适配
- [x] 无 LLM 模式本地采集与固定格式日报；报告页按模式隐藏 AI 或自定义 Prompt 操作
- [ ] K3 后续方案若再来，基于当前 src（git 干净）评审，先 tsc 验证

## 七、git 最近提交（上下文锚点）

```
3e9ed7e fix: 时间轴柱状图对数缩放
0a78401 fix: 时间轴柱高归一化防溢出
b7afe12 fix: 时间轴刻度 9→5
5a85b78 feat: 双源并行(both)+启动ActivityWatch+去重
90fc35d chore: 清理 target 误跟踪
61d6b2b feat: 效率分析独立化
2ce7271 feat: 集成 AW Analytics Skill
c48209d feat: P1 梳理对齐（补回 Settings 分区等）
```
