# ROADMAP

> 墨记（Moji）真实进度源。记录当前阶段、已完成、进行中、待办、阻塞、最近验证。
> `README.md` 写项目介绍与用法；本文写会变化的进度。

## 当前阶段（2026-08-14）

视觉（多模态）模型已彻底移除，识别链路改为「UIA 窗口文本 → 纯文本模型」；识别准确度、CORS、SQLite 持久化三项关键问题均已修复并验证。UI 从"朴素"重做为带数据可视化的现代 SaaS 仪表盘。

## 已完成

### 阶段 0 — 纯前端（恢复 7月4 功能）

- [x] 报告模板系统（4 内置模板注入 prompt）
- [x] 自定义模板编辑器
- [x] 自定义背景
- [x] 数据导入（JSON / Markdown）
- [x] 导出 Markdown 格式增强
- [x] 排除应用 / 标题过滤
- [x] 报告历史加 `template` 字段

### 阶段 1 — Rust 后端

- [x] SQLite 存储层：`db_*` 命令 + 建表 + `rusqlite` + localStorage→SQLite 迁移
- [x] 系统检测：`get_foreground_window` / `get_idle_seconds` / `is_screen_locked` / `diagnose_db`
- [x] 备份 / 恢复：`save_backup` / `load_backup` / `restore_backup_to_db`
- [x] ActivityWatch 数据源：`aw_fetch_events` / `aw_health`（零 API 费用、秒级窗口时间线）

## 近期重大变更（2026-08 中旬）

### 1. 移除视觉模型 → 窗口文本识别

- 新增 `src-tauri/src/uia.rs`：`read_window_text(hwnd)` 经 Windows UI Automation 只读采集窗口内控件文本（Name + Value），跳过密码框；全局 Mutex 串行化修复了 UIA 并发初始化竞态（实测 3 线程并发 E_FAIL）。
- `capture_visible_windows` 增加 `capture_images` 参数：识别链路默认零截图，仅在开启"保存缩略图"时才截屏。
- 前端 `analyzeScreenshot` → `analyzeWindowText`（纯文本输入）；`analysisModel`/`reportModel` 合并为单一 `textModel`。
- 引入 `windows` crate（完整 UIA COM 绑定，`windows-sys` 不含 UIA 接口）。

### 2. 识别准确度修复

- UIA 噪声过滤：40+ 浏览器/系统装饰控件 denylist，控件数 91→63，内容信号更干净。
- URL 提取：从窗口文本提取 http(s) 地址与 localhost 开发地址，作为浏览器分类最强信号。
- 强化 system prompt：五分类规则 + 浏览器按"地址+标题"判 + description 具体且 ≤20 字。
- 本地预判分类：进程名/标题 → 分类的确定性映射，作为给模型的强提示。
- 清晰错误映射：401/403/404/429/5xx → 可行动中文提示（如 401 = "API Key 无效或已过期"）。
- 失败降级：AI 失败时用本地确定性分类兜底，不再刷"分析失败"噪音记录。

### 3. CORS 修复（AI 请求走 Rust 代理）

- 前端 `fetch` 直连第三方 API 网关（如自建中转）会因缺 `Access-Control-Allow-Origin` 报 "fail to fetch"。
- 新增 `src-tauri/src/ai.rs`：`chat_completions` 命令，经 reqwest 代理请求，绕过 CORS，API Key 不再暴露在 WebView JS 上下文。
- 设置页新增「测试 AI 连接」按钮，即时验证 Key/BaseURL/模型是否可用。

### 4. UI 重做（数据可视化仪表盘）

- `index.css` 引入设计系统：`@theme` 品牌色/字体栈/层次阴影、细滚动条、入场动效、呼吸状态点。
- 新增 `TodayOverview.tsx`：30 分钟粒度时间轴（48 格，悬停显示时间·分类·条数）、分类占比堆叠条、大数字指标卡（含较昨日增量箭头）。
- 报告页生成前显示当前范围的分类分布预览。
- 分类彩色徽章（开发紫/会议橙/文档绿/沟通蓝/其他灰），列表项左侧色条，设置页分区卡片化。

### 5. SQLite 持久化修复（schema 迁移）

- 旧库 `activities.app` / `report_history.type` 与代码期望的 `app_name` / `report_type` 不一致，`CREATE TABLE IF NOT EXISTS` 不迁移已存在的表，导致 SQLite 保存/读取静默失败（错误被吞）。
- `db.rs` 新增 `migrate_schema`：启动时幂等 `ALTER TABLE ... RENAME COLUMN`。
- `DbActivity` 加 serde alias（`app`/`screenshotBase64`）兼容旧 localStorage 导入；`PaginatedParams` 加 `rename_all = "camelCase"`。
- 验证：存量 18 条数据从 localStorage 成功迁移进 SQLite。

### 6. 其他

- `vite.config.ts` 固定 `host: '127.0.0.1'`，修复 Vite 只监听 IPv6 `::1` 导致 `tauri dev` 一直等待前端的问题。

## 重要调研：7月4 功能丢失与 exe 恢复（2026-08-01，历史记录）

**结论：2026-07-04 曾编译出一版功能远超当时基座的墨记，但那批源码从未进 git，现已从编译产物中恢复出前端。**

- 2026-06-22/23：git 集中提交到 `1c4b596`（localStorage 版）。
- 2026-06-24 ~ 07-初：git 空白期，新增大量功能（SQLite、报告模板、导入导出等）。
- 2026-07-04 09:04：编译出含完整功能的 exe，源码未进 git。
- 2026-07-07：`docs/` 被改为"保守版"，功能被误标为"未完成"。
- 2026-08-01：重新 build，`dist/` 被覆盖，7月4 前端明文消失。

恢复：已用 brotli 从 exe 解出 7月4 版前端（`_recover/`），Rust 后端（15 命令）编译成机器码需重写。详细记录见 `docs/recovery.md`。上述功能已通过阶段 0/1 全部重建完成。

### 从未实现（规划项，非丢失项）

报告质量评分、系统托盘、开机自启、全局快捷键 —— 前端 JS 与 Rust 符号中均为 0。

## 待办 / 下一步

- [ ] 深浅色主题切换（当前仅浅色，深色需全组件适配 + `darkMode: 'class'` 机制）
- [ ] 时间轴进一步细化（可选 15 分钟 96 格）+ 悬停显示具体活动
- [ ] 报告质量评分
- [ ] 系统托盘 / 开机自启 / 全局快捷键
- [ ] PDF 导出（当前仅 Markdown / JSON）
- [ ] 清理 `_recover/`（功能已全部移植完成）
- [ ] 云同步 / 多用户协作（低优先级）

## 最近验证

- 2026-08-14：`npm run build` 通过；`cargo check` 通过。
- 端到端识别（真实 Tauri 环境，自定义网关 + 所配模型）：
  - `[dev] Hermes | 部署 ai-news-site 到 Cloudflare Pages`
  - `[dev] Chrome | 在 DeepSeek Harness 调试代码方案`
  - `[other] Tabbit | 在Tabbit查看会员升级套餐`
  - 分类准确、描述具体，无 CORS 报错。
- UIA 文本采集：真实 Chrome 窗口读到 91 个控件（过滤前）、63 个（过滤后），含地址栏 URL、标签页标题、扩展名。
- SQLite：`db_save_activity` 往返正确，存量 18 条数据成功迁移。
- 回归工具：`_verify_e2e.cjs`（端到端识别）、`_verify_ipc.cjs`（IPC 链路）、`_verify_ui.cjs`（UI 渲染）。
