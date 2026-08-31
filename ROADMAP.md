# 墨记 ROADMAP

## 当前阶段

- **Phase**：v0.2.1 稳定性修复
- **状态**：第一、第二、第三阶段的 Windows 本地实现与验收完成，v0.2.0 已发布；v0.2.1 安装测试阻塞已修复，Windows x64 安装包已重新构建并通过验证，尚未推送或发布。

## 已完成

- [x] 内置 ActivityWatch，安装后无需单独下载和启动服务。
- [x] 有 LLM／无 LLM 两种模式，共用本地采集和活动存储。
- [x] 可编辑分类规则与未分类收件箱。
- [x] 专注／打断分析与应用内日／周／月报告。
- [x] localStorage＋SQLite 持久化、导入导出、备份恢复和系统托盘。

## 已完成：第一阶段

- [x] 演示数据模式：一键加载带上周基线的虚构示例周，不覆盖真实记录，并可独立移除。
- [x] 首次启动向导：完成隐私边界确认、模式选择和开始采集／配置／演示分流。
- [x] 采集健康中心：展示 ActivityWatch、窗口采集、SQLite、最近事件与错误原因；浏览器模式明确降级状态。
- [x] 周复盘闭环：展示投入、专注、打断、未分类、规则覆盖趋势、周同比和可执行建议。
- [x] 规则可解释性：展示命中规则、分类依据、覆盖冲突、人工修正差异和覆盖趋势。
- [x] GitHub 展示：README 增加真实截图、一分钟演示、产品闭环架构和隐私数据表。
- [x] 工程补齐：新增脱敏诊断导出、功能回归测试、版本一致性检查、安装包 SHA-256 脚本和发布清单。
- [x] CI 测试增强：在现有工作流中运行功能测试和 `cargo test --locked`。

## 已完成：第二阶段

- [x] AFK／锁屏精确剔除：支持可配置空闲阈值，并按实际活跃秒数写入活动和 ActivityWatch。
- [x] 可选上下文：浏览器域名和 IDE 项目名默认关闭，开启后结构化保存并明确隐私边界。
- [x] 本地全文检索：基于 SQLite 搜索应用、标题、描述和上下文，支持自然日期范围。
- [x] 数据保留与清理：展示数据库占用和待清理数量，清理前二次确认且不自动删除。
- [x] 计划投入对照：按周设置分类投入目标，在周复盘中展示计划与实际差异。
- [x] 本地只读 API：默认关闭，只监听 `127.0.0.1`，令牌鉴权后提供健康、活动和汇总查询。

### 第二阶段验收标准

- 旧数据库升级前自动备份；迁移只新增可选字段、表和索引，不删除或重写现有活动。
- 有 LLM／无 LLM 模式共用相同的 AFK、上下文、检索、保留和计划数据结构。
- 浏览器／IDE 上下文和本地 API 均默认关闭；未开启时不扩大采集或暴露范围。
- 清理命令在测试数据库验证，不对用户真实数据库执行自动清理。
- 前端功能测试、类型检查、生产构建、Rust 测试和桌面／窄窗口可见验收全部通过。

## 已完成：第三阶段（本地与 Windows）

- [x] 抽取 HTTP API 与 MCP 共用的 SQLite 只读查询层，提供独立 `stdio` MCP。
- [x] 增加用户指定目录的加密快照同步，支持重复合并和冲突报告。
- [x] 建立内置数据源接口与注册表，接入窗口、ActivityWatch 和 JSON 文件数据源。
- [x] 完成 Windows 平台入口适配和真实桌面验收。
- [x] 增加默认关闭的开机自启、全局快捷键和系统通知。
- [x] 增加应用内专属 A4 PDF 导出，不依赖浏览器打印。
- [x] 更新 README、API／MCP 配置说明、发布清单和平台能力表。
- [x] 完成前后端测试和 Windows 真实桌面验收。

## 已完成：竞品分析与 P0 方案（2026-08-29）

- [x] 小黑日报助手竞品差距分析（opus-5 review），报告见 `docs/review-xiaohei-gap-20260829.md`。结论：墨记差距在首日价值感与表达力，不在采集能力；不学截图/OCR，守住 UIA 可解释路线。
- [x] P0 五项实现方案文档（5 个 subagent 并行调 opus-5 生成，已逐个验收）：`docs/plans/p0-1-heatmap-spec.md`（时段热力图）、`p0-2-report-prompt-spec.md`（报告重点提炼 prompt）、`p0-3-narrative-card-spec.md`（今日叙事卡）、`p0-4-report-edit-spec.md`（报告可编辑再导出）、`p0-5-privacy-copy-spec.md`（隐私三层叙事文案）。均为设计文档，代码未动。
- [x] **窄窗口侧边栏溢出修复**（P0-2/3/4/5 subagent 实现期间插队修复）：窗口变矮时侧边栏底部控制区（停止采集/立即采集一次）被推出视口外截断。根因：`App.tsx` 侧边栏 `nav` 有 `flex-1` 无 `min-h-0`，高度不足时不收缩、把底部按钮区顶出 `h-screen` 容器。修复：nav 加 `min-h-0 overflow-y-auto`（高度不足时导航自身滚动），底部控制区加 `shrink-0`（常驻可见）。浏览器 874→380px 高度实测按钮始终完整可见，回溯页 400~900px 宽度带长数据零横向溢出；typecheck + test:features 11/11 通过。

## 已完成：P0 四项落地（2026-08-29，多模型协作实现）

> 实现过程：opus-5 池枯竭后经 gpt-5.6-sol 迭代至 glm-5.3 收尾；本站大请求（>20KB）会 502/503，采用「小 prompt（≤10KB）分块输出 + 本地拼装 patch」模式完成。

- [x] **P0-2 报告 prompt 重点提炼**：`ai.ts` 重构 generateReport——新增 REPORT_SYSTEM/DAILY_STRUCT/WEEKLY_STRUCT/buildReportPrompt/AwReportStats，日报强制「今日3个重点+产出+阻塞+数据依据」结构，temperature 0.2，空活动直接返回不调模型。
- [x] **P0-3 今日叙事卡**：新增 `narrative.ts`（activeRange/longestFocus/mainThread 计算，AW 并集+UIA 差值重建≤5min）、`useNarrativeCard.ts`（本地模板即时+可选 LLM 增强≤40字/3s 超时降级/同日缓存，走 Rust `chat_completions` 代理）、`NarrativeCard.tsx`（语义 token 卡片），集成于仪表盘统计卡前。
- [x] **P0-4 报告可编辑再导出**：`reportHistory.ts` 新增 edited/editedAt/originContent 字段与 updateReportHistoryItem/revertReportHistoryItem（兼容旧数据）；`activityStore.tsx` 新增 updateReport/revertReport 动作；`ReportView.tsx` 工具栏编辑/保存/取消按钮组+textarea 编辑态+历史「已编辑」badge+一键还原。
- [x] **P0-5 隐私三层叙事**：`OnboardingDialog.tsx` 首启隐私确认改三层卡片（采集层·只读文字不看画面/处理层·本地规则或你的LLM/存储层·SQLite本地+脱敏导出）；`Settings.tsx` 隐私区加三层说明；新增 `docs/privacy-narrative.md`（FAQ 5 条）。
- [x] **验证**：npm run typecheck ✅ / test:features 11/11 ✅ / npm run build ✅（2.93s）；浏览器实机验收：叙事卡三行信息渲染正确、报告编辑→保存→已编辑 badge→还原全链路通过、控制台无错误。

## 已完成：工程名称与升级兼容（2026-08-29 至 2026-08-30）

- [x] **统一对外工程名称**：crate、库名、包名、可执行文件引用和截图自排除关键字统一使用 `moji`。
- [x] **保留已发布持久化标识**：Tauri identifier 继续使用 `com.xiaohei.daily`，活动、设置、API Key 和同步密码继续使用已发布的 `xiaohei-*` localStorage key。这些值属于升级兼容协议，不作为界面品牌展示。
- [x] **保持升级兼容**：v0.2.1 继续读取原数据目录和原 localStorage 数据，不需要复制数据库；报告历史仅新增可空列，升级前另存 `moji.db.pre-v021.backup`，不覆盖已有 `pre-v012` 备份。
- [x] **版本校验**：`package.json`、`package-lock.json`、`Cargo.toml`、`Cargo.lock` 和 `tauri.conf.json` 已统一为 `0.2.1`，发布版本检查通过。

## 已完成：v0.2.1 Review 修复（2026-08-30）

- [x] 报告编辑绑定开始编辑时的报告 ID；编辑期间禁用历史切换、还原、删除和重新生成，并拒绝保存空白内容。
- [x] 叙事卡按重叠时间片分配分类和应用时长，分类与应用占比不再超过全局有效时长。
- [x] AI 日报、周报和月报接入活动统计、专注数据与上期对比；月报使用独立的月度结构和“较上月”口径。
- [x] 有 LLM 模式默认启用叙事摘要；缓存增加活动摘要、模型和接口地址签名，数据变化后重新生成。
- [x] 新增报告编辑、重叠占比、AI 统计和月报提示词回归测试。
- [x] 无 LLM 日报、周报和月报按所选周期生成对应标题与记录，周报和月报时间线包含日期。
- [x] 报告原始内容、编辑时间和生成模式写入 SQLite，并通过加密快照同步；旧数据库和旧快照保持兼容。
- [x] 叙事缓存签名与实际发送给模型的 payload 共用同一数据对象；报告工具栏在窄窗口下自动换行。

## 已完成：v0.2.1 安装测试阻塞修复（2026-08-31）

- [x] 设置页 MCP 配置优先使用安装目录内的独立 `moji-mcp.exe` 和空参数，避免 release GUI 主程序的 Windows subsystem 吞掉 `stdio` 响应；开发环境缺少独立程序时保留 `--mcp` 回退。
- [x] 内置 ActivityWatch 增加轻量守护：升级时可先复用旧实例，旧实例退出或自有子进程异常退出后自动接管；应用退出时停止守护并只终止自己持有的子进程。
- [x] 新增 MCP 路径选择和 ActivityWatch 接管决策回归测试，README 与 MCP 配置文档同步改用独立程序。
- [x] release `moji-mcp.exe` 使用隔离测试库通过初始化、工具列表、健康检查、活动搜索和 600 秒汇总验证。
- [x] 使用最终 NSIS 安装包静默覆盖 `D:\Desktop\墨记`；已安装主程序版本为 `0.2.1`，独立 MCP 和 ActivityWatch 资源与构建产物哈希一致。
- [x] 已安装主程序成功启动内置 ActivityWatch；终止其自有 AW 子进程后，守护线程约 2 秒内自动启动替代进程并恢复 `5601` 监听。
- [x] Windows 下启动 ActivityWatch 时使用无窗口标志并关闭三个标准流；打包前将已校验的 AW 二进制改为 GUI 子系统，避免 Windows Terminal 和 `conhost.exe` 被自动创建。
- [x] 覆盖安装后验证首次启动与守护重启：两次 AW 进程均正常返回 `moji / v0.13.2`，且没有 AW 自属的 `conhost.exe`。

## 已完成：v0.2.0 发布

- [x] 本地提交：整理 v0.2.0 改动并提交到 `master`（`8c0d516`）。
- [x] Windows 安装包：已构建并通过发布校验，SHA-256 为 `e6d830726a6fc5ae9f95bb7cdd566ab12001ec394827316ae0e77efdbb982191`。
- [x] 远端推送：`master` 已快进推送到 `origin`（`8c0d516`）。
- [x] 标签：`v0.2.0` annotated tag 已创建并推送，指向 `8c0d516`。
- [x] GitHub Release：已发布 `v0.2.0` 并上传 Windows x64 安装包，见 https://github.com/yinbing-666/moji/releases/tag/v0.2.0 。

## 待办：v0.2.1 发布

- [x] 提交 v0.2.1 修复：`c511d15`；安装测试阻塞修复：`5752869`；ActivityWatch 终端窗口修复：`536e854`。
- [x] 构建并验收 Windows x64 安装包：`墨记_0.2.1_x64-setup.exe`。
- [ ] 推送、打标签并创建 GitHub Release；远端写入和公开发布需单独确认。

第三阶段设计见 `docs/specs/2026-08-22-v0.2.0-platform-and-integration-design.md`。

## 不在当前范围

- 连续录屏、录音和 OCR。
- 完整 Todo、客户计费、多人协作和云端账号系统。
- 大型 AI Agent 平台和复杂自定义分类树。

## 阻塞

- 无。

## 最近验证

- **功能测试**：`npm run test:features` 结果 17 passed，0 failed；覆盖本地日／周／月报告周期、报告编辑元数据与生成模式、叙事缓存签名、重叠占比、AI 报告统计、月报提示词和同步设备 ID 迁移。
- **前端检查**：`npm run typecheck` 与 `npm run build` 通过；Vite 仅保留既有的模块分块提示。
- **Rust 测试**：`cargo test --locked` 结果 22 passed，0 failed，6 ignored；覆盖报告历史增量迁移、报告元数据加密同步、旧快照兼容、FTS、本地 API、MCP 路径选择、ActivityWatch 接管决策与 Windows 无窗口启动标志、汇总、PDF 文本处理、数据清理和周计划持久化。
- **测试数据库**：内存 SQLite 验证清理只删除截止时间之前的活动，边界记录保留，FTS 索引同步更新，无效截止时间不删除数据；周计划可覆盖保存并读取。
- **CI 配置**：前端任务运行功能测试，Windows 后端任务运行 `cargo test --locked`；当前版本不构建 macOS 或 Linux 安装包。
- **发布校验**：`scripts/check-release.ps1` 通过，六处版本均为 `0.2.1`；NSIS 安装包 `墨记_0.2.1_x64-setup.exe` 为 12,278,225 字节，版本元数据为 `0.2.1`，SHA-256 为 `e1eeb9ad01835a03fd3b03f05e1ef2ab0b8a086eba2cd0935078c9963327a4cf`，当前未签名。
- **服务检查**：覆盖安装后的主程序从 `D:\Desktop\墨记\activitywatch\aw-server-rust.exe` 启动内置服务，`127.0.0.1:5601` 返回 `moji / v0.13.2`；首次进程和守护重启进程均没有 AW 自属的 `conhost.exe`，关闭终端后反复拉起的问题已消除。
- **界面验收**：报告页通过 1440×1000 与 390×844 浏览器验收；历史报告显示自身生成模式，本地周报和月报可点击生成，页面无横向溢出或控件截断，控制台 0 error、0 warning。
- **迁移验证范围**：报告历史增量迁移使用内存 SQLite 验证，未启动 Tauri 或触碰真实用户数据库。
- **PDF 验收**：独立 A4 渲染器生成两页 QA 报告；中文、图表、ASCII 列表、英文换行、分页和页脚可读，无 Markdown 标记、重叠或截断。
- **真实迁移**：`moji.db.pre-v012.backup` 完整性检查为 `ok`；新列、`weekly_plans`、FTS 表和同步触发器均存在，1334 条活动与 1334 条索引一致。
- **真实本地 API**：启动前端口 `5610` 未监听；开启后仅绑定 `127.0.0.1`，健康、活动、汇总端点正常，错误令牌返回 `401`，汇总覆盖 1337 条活动。
- **已安装 MCP**：`D:\Desktop\墨记\moji-mcp.exe` 与 release 构建产物哈希一致；使用隔离测试库返回 MCP 协议 `2025-06-18`、版本 `0.2.1` 和 3 个只读工具，健康检查、搜索与 600 秒汇总均成功。
- **真实回溯**：桌面 APP 使用 SQLite 返回 6 条本周活动，搜索 `ChatGPT` 返回 26 条匹配记录。
- **Git 状态**：v0.2.1 修复基线为 `c511d15`，安装测试阻塞修复为 `5752869`，ActivityWatch 终端窗口修复为 `536e854`；尚未推送、打标签或创建 GitHub Release。
