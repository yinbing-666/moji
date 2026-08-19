# ROADMAP

> 墨记（Moji）真实进度源。记录当前阶段、已完成、进行中、待办、阻塞、最近验证。
> `README.md` 写项目介绍与用法；本文写会变化的进度。

## 当前阶段（2026-08-19）

视觉（多模态）模型已彻底移除，识别链路改为「UIA 窗口文本 → 纯文本模型」；同时增加本地采集与固定格式报告。当前进行内置 ActivityWatch 整合：服务随 APP 启停，用户不需要单独安装或配置端口。

## 已完成

### 阶段 0 — 纯前端（恢复 7月4 功能）

- [x] 报告模板系统（4 个内置模板 + 自定义模板本地 CRUD + 报告页选择/编辑入口）
- [x] 自定义背景
- [x] 数据导入（JSON / Markdown）
- [x] 导出 Markdown 格式增强
- [x] 排除应用 / 标题过滤
- [x] 报告历史加 `template` 字段

### 阶段 1 — Rust 后端

- [x] SQLite 存储层：`db_*` 命令 + 建表 + `rusqlite` + localStorage→SQLite 迁移
- [x] 系统检测：`get_foreground_window` / `get_idle_seconds` / `is_screen_locked` / `diagnose_db`
- [x] 备份 / 恢复：`save_backup` / `load_backup` / `restore_backup_to_db`
- [x] 内置 ActivityWatch 效率分析：`aw_fetch_events` / `aw_health`（零 API 费用、秒级窗口时间线）
- [x] 系统托盘：关闭主窗口时隐藏到托盘，支持重新显示和退出

### 阶段 2 — 报告与可视化收尾

- [x] 今日时间轴支持 30 分钟（48 格）与 15 分钟（96 格）切换，悬停可查看具体活动
- [x] 报告质量评分：按记录数、时间跨度和分类多样性计算 0–100 分及质量等级
- [x] 报告打印 / PDF：调用系统打印对话框，打印样式隐藏控制区并完整展开正文
- [x] ActivityWatch 效率报告可在 APP 内直接阅读：渲染评分、趋势、分类、小时活动、排行、洞察、规则健康和隐私信息，HTML 保留为导出入口
- [x] 窄屏布局：小于 640px 时侧栏缩为 64px 图标栏，报告控件和模板编辑器不再被裁切
- [x] 三档主题：默认跟随 Windows 系统主题，也可强制浅色或深色；背景预设和打印样式同步适配
- [x] 视觉系统收敛：背景皮肤同时作用于应用画布和侧栏，统一中性色板与语义色，并接入墨滴时间轨迹 Logo 和空状态标识
- [x] 两种数据模式：有 LLM 使用窗口文本分析；无 LLM 使用本地窗口采集与固定格式 Markdown 报告
- [x] 报告页拆分为「工作日报／效率分析」标签；效率分析统一读取墨记活动，内置 ActivityWatch 在后台记录时间线
- [x] 日报正文在 APP 内安全渲染 Markdown，生成后自动定位，历史删除增加确认，并标识 AI 生成与固定格式来源
- [x] 内置 ActivityWatch Rust server：墨记启动时自动运行、退出时清理；窗口采集直接写入内置服务，界面统一为有 LLM／无 LLM 两种模式

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
- 新增 `TodayOverview.tsx`：支持 30 分钟（48 格）/ 15 分钟（96 格）时间轴切换，悬停显示时间、分类、条数和具体活动；同时提供分类占比堆叠条与大数字指标卡（含较昨日增量箭头）。
- 报告页生成前显示当前范围的分类分布预览。
- 分类彩色徽章（开发紫/会议橙/文档绿/沟通蓝/其他灰），列表项左侧色条，设置页分区卡片化。

### 5. SQLite 持久化修复（schema 迁移）

- 旧库 `activities.app` / `report_history.type` 与代码期望的 `app_name` / `report_type` 不一致，`CREATE TABLE IF NOT EXISTS` 不迁移已存在的表，导致 SQLite 保存/读取静默失败（错误被吞）。
- `db.rs` 新增 `migrate_schema`：启动时幂等 `ALTER TABLE ... RENAME COLUMN`。
- `DbActivity` 加 serde alias（`app`/`screenshotBase64`）兼容旧 localStorage 导入；`PaginatedParams` 加 `rename_all = "camelCase"`。
- 验证：存量 18 条数据从 localStorage 成功迁移进 SQLite。

### 6. 其他

- `vite.config.ts` 固定 `host: '127.0.0.1'`，修复 Vite 只监听 IPv6 `::1` 导致 `tauri dev` 一直等待前端的问题。

### 7. 稳定性与数据一致性修复（2026-08-19）

- 日期筛选统一使用本地时区日期键，修复 UTC 跨日导致的今日统计和日报错日。
- UIA 连续活动按采集间隔和活动结束时间去重、累计时长；切换两种数据模式时按当前模式控制采集生命周期。
- 应用、标题和关键词排除项在 Rust 枚举窗口阶段统一过滤，开启缩略图时也不会先截取排除窗口。
- localStorage 有明确状态时不再被 SQLite 旧数据覆盖；localStorage 缺失时可从 SQLite 恢复活动和报告历史，备份恢复后同步刷新两类数据。
- SQLite 备份和恢复改用 online backup API，诊断增加 `PRAGMA quick_check`；SQLite 写入失败会保留 localStorage 数据并输出错误。
- ActivityWatch 分析脚本加入 Tauri bundle 资源，运行时优先读取安装资源目录；分析输出不再清空 `profile.json` 和历史报告，并使用设置中的 host / port。
- Windows 运行 ActivityWatch 分析时优先调用 `python`，找不到时自动回退 `py -3`，兼容 Python Launcher-only 环境。
- AI 连接测试和 AW 立即同步直接使用设置页当前表单值，不要求先保存配置。
- AI 配置缺少 Key、Base URL 或模型名时不再启动或继续窗口采集，避免周期性写入失败降级记录。
- JSON 导出取消重复下载，导入保留有效 `durationSeconds`；ActivityWatch `fetched_at` 按真实 UTC 输出。
- 有效 localStorage 活动快照启动时通过事务完整同步 SQLite，失败自动回滚；备份替换前后执行完整性检查并保留失败回滚路径。

## 重要调研：7月4 功能丢失与 exe 恢复（2026-08-01，历史记录）

**结论：2026-07-04 曾编译出一版功能远超当时基座的墨记，但那批源码从未进 git，现已从编译产物中恢复出前端。**

- 2026-06-22/23：git 集中提交到 `1c4b596`（localStorage 版）。
- 2026-06-24 ~ 07-初：git 空白期，新增大量功能（SQLite、报告模板、导入导出等）。
- 2026-07-04 09:04：编译出含完整功能的 exe，源码未进 git。
- 2026-07-07：`docs/` 被改为"保守版"，功能被误标为"未完成"。
- 2026-08-01：重新 build，`dist/` 被覆盖，7月4 前端明文消失。

恢复：已用 brotli 从 exe 解出 7月4 版前端（`_recover/`），Rust 后端（15 命令）编译成机器码需重写。详细记录见 `docs/recovery.md`。上述功能已通过阶段 0/1 全部重建完成。

### 从未实现（规划项，非丢失项）

恢复产物中未发现报告质量评分、系统开机自启和全局快捷键。报告质量评分已于 2026-08-19 重新实现；系统开机自启和全局快捷键仍未实现。设置中的 `autoStart` 仅表示应用启动后自动开始采集。

## 待办 / 下一步

- [ ] 开机自启 / 全局快捷键
- [ ] 清理 `_recover/`（功能已全部移植完成）
- [ ] 云同步 / 多用户协作（低优先级）
- [ ] CI 增加 Windows 构建覆盖（涉及 CI/CD 配置，待单独确认）

## 最近验证

- 2026-08-19 内置 ActivityWatch 验证：release 可执行文件启动后，从打包资源目录自动运行 `aw-server-rust.exe` 并在 `127.0.0.1:5601` 返回 v0.13.2；真实 API smoke test 已完成 bucket 创建、窗口事件写入与读取。`npm run build`、`cargo check --locked`、`cargo test --locked` 与 `npm run tauri build` 均通过，NSIS 安装包已重建。
- 2026-08-19 APP 内效率报告验证：修复 `report_json` 路径被误当作内容解析的问题，Tauri IPC 同时返回原路径与 JSON 内容；使用 Computer Use 在真实桌面 APP 生成当天报告，评分、指标、分类、趋势、小时活动、应用/网站排行、洞察、规则健康、隐私信息和 HTML 导出入口均正常显示。另完成 1280×800 浅色/深色与 390×844 响应式验证；`npm run build`、`cargo check --locked`、`git diff --check` 通过。
- 2026-08-19 报告体验验证：浏览器验证双标签、本地无时长数据按记录数展示、`.exe` 应用名清洗、ActivityWatch 可选切换提示和安全 Markdown 标题/列表/强调渲染；`npm run build`、`git diff --check` 通过。当前 PowerShell 环境未找到 `cargo`，Rust 检查待在含 Rust 工具链的环境复验。
- 2026-08-19 桌面复核：使用 Computer Use 精确选择开发版 Tauri 窗口，验证报告页双标签、墨记本地效率报告、待校准评分和「AI 工具使用时长」均可在 APP 内直接阅读。
- 2026-08-19 主题验证：默认 `system` 可随系统颜色偏好实时切换，强制浅色/深色不受系统偏好影响并可刷新恢复；Edge 在 1280×800 和 390×844 下验证四个页面无横向溢出，深色打印为白底黑字；`npm run build`、`cargo check --locked`、`cargo test --locked` 和 5 个真实桌面忽略测试全部通过，NSIS 安装包已重新构建。
- 2026-08-19 视觉系统验证：浅色/深色下 plain、mint、sky、graphite 四套皮肤均同步改变应用画布与侧栏；设置页预览与实际皮肤一致；桌面和 390×844 四页面无横向溢出，Logo 与空状态正常渲染，控制台无新增错误；`npm run build`、`git diff --check` 通过。
- 2026-08-19 Logo 资源复核：采用用户提供的第 3 张墨滴时间环图，去白底并保留透明边距后接入侧栏、时间轴空状态和 favicon；浅色/深色桌面与 390×844 页面均正常渲染，`npm run build`、`git diff --check` 通过。
- 2026-08-19 桌面打包验证：补充透明 PNG Logo 后，`npm run tauri build` 成功生成 release 可执行文件与 NSIS 安装包；`cargo test --locked` 通过（4 passed，5 ignored），安装包内含 ActivityWatch 分析资源。
- 2026-08-19 无 LLM 验证：无 API 配置时本地模式采集按钮可用并可刷新保持；标准/简洁/技术/OKR 四种固定格式均生成成功并写入历史；ActivityWatch 效率分析默认收起且明确为可选；有 LLM 模式仍保留 AI 报告入口。390×844 下设置页无横向溢出，`npm run build`、`cargo check --locked`、`cargo test --locked`、5 个真实桌面忽略测试和 `git diff --check` 均通过。
- 2026-08-19：`tsc --noEmit --pretty false`、`npm run build`、`cargo check --locked`、`cargo test --locked`、Markdown 导入与时长归一化断言、`git diff --check` 均通过。
- 2026-08-19 补充：活动状态 ref 在单条写入、AW 批量同步和 SQLite 恢复路径同步更新；启动同步对变化快照重试并合并新记录；AW 同步增加互斥保护；Markdown 紧凑/详细格式导入均有断言；`npm run build`、`cargo check --locked`、`cargo test --locked`、`git diff --check` 复验通过。
- 2026-08-19 模板与桌面验证：报告页模板选择/自定义 CRUD/生成注入已接通；5 个真实桌面 Rust 忽略测试全部通过；Tauri NSIS 包构建成功（`target/release/bundle/nsis/墨记_0.1.0_x64-setup.exe`），release 资源目录含 ActivityWatch 分析脚本；打包脚本离线 demo 生成 JSON/Markdown/HTML 全部成功。
- 2026-08-19 ActivityWatch 实时验证：启动本机 `aw-qt.exe` 后，`127.0.0.1:5600/api/0/info` 返回 v0.13.2；使用真实 AW API 生成 today 报告 JSON/Markdown/HTML 成功；NSIS 包未安装运行，避免未经确认改变系统状态。
- 2026-08-19 报告与响应式验证：`npm run build`、`cargo check --locked`、`cargo test --locked` 和 5 个真实桌面忽略测试全部通过；Edge 验证 15 分钟时间轴为 96 格、质量评分为 66「基本完整」、自定义模板 CRUD 可持久化、打印样式可生成 177284 字节 PDF；390×844 下侧栏为 64px、报告控件无裁切，1280×800 下侧栏保持 240px。
- 2026-08-14：`npm run build` 通过；`cargo check` 通过。
- 端到端识别（真实 Tauri 环境，自定义网关 + 所配模型）：
  - `[dev] Hermes | 部署 ai-news-site 到 Cloudflare Pages`
  - `[dev] Chrome | 在 DeepSeek Harness 调试代码方案`
  - `[other] Tabbit | 在Tabbit查看会员升级套餐`
  - 分类准确、描述具体，无 CORS 报错。
- UIA 文本采集：真实 Chrome 窗口读到 91 个控件（过滤前）、63 个（过滤后），含地址栏 URL、标签页标题、扩展名。
- SQLite：`db_save_activity` 往返正确，存量 18 条数据成功迁移。
- 回归工具：`_verify_e2e.cjs`（端到端识别）、`_verify_ipc.cjs`（IPC 链路）、`_verify_ui.cjs`（UI 渲染）。
