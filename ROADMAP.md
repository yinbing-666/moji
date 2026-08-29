# 墨记 ROADMAP

## 当前阶段

- **Phase**：v0.2.0 平台与集成能力
- **状态**：第一、第二、第三阶段的 Windows 本地实现与验收完成；v0.2.0 已发布。

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

## 待办：发布

- [x] 本地提交：整理 v0.2.0 改动并提交到 `master`（`8c0d516`）。
- [x] Windows 安装包：已构建并通过发布校验，SHA-256 为 `e6d830726a6fc5ae9f95bb7cdd566ab12001ec394827316ae0e77efdbb982191`。
- [x] 远端推送：`master` 已快进推送到 `origin`（`8c0d516`）。
- [x] 标签：`v0.2.0` annotated tag 已创建并推送，指向 `8c0d516`。
- [x] GitHub Release：已发布 `v0.2.0` 并上传 Windows x64 安装包，见 https://github.com/yinbing-666/moji/releases/tag/v0.2.0 。

第三阶段设计见 `docs/specs/2026-08-22-v0.2.0-platform-and-integration-design.md`。

## 不在当前范围

- 连续录屏、录音和 OCR。
- 完整 Todo、客户计费、多人协作和云端账号系统。
- 大型 AI Agent 平台和复杂自定义分类树。

## 阻塞

- 无。

## 最近验证

- **功能测试**：`npm run test:features` 结果 11 passed，0 failed；新增覆盖报告原始统计周期和同步设备 ID 迁移。
- **前端检查**：`npm run typecheck` 与 `npm run build` 通过；Vite 仅保留既有的模块分块提示。
- **Rust 测试**：`cargo test --locked` 结果 15 passed，0 failed，6 ignored；覆盖 FTS、本地 API、MCP、加密同步、汇总、PDF 文本处理、数据清理和周计划持久化。
- **测试数据库**：内存 SQLite 验证清理只删除截止时间之前的活动，边界记录保留，FTS 索引同步更新，无效截止时间不删除数据；周计划可覆盖保存并读取。
- **CI 配置**：前端任务运行功能测试，Windows 后端任务运行 `cargo test --locked`；当前版本不构建 macOS 或 Linux 安装包。
- **发布校验**：`scripts/check-release.ps1` 通过，六处版本均为 `0.2.0`；NSIS 安装包 `墨记_0.2.0_x64-setup.exe` 构建完成，SHA-256 为 `e6d830726a6fc5ae9f95bb7cdd566ab12001ec394827316ae0e77efdbb982191`。
- **服务检查**：真实 debug 进程运行中，内置 ActivityWatch `127.0.0.1:5601` 返回 v0.13.2。
- **界面验收**：新增桌面集成、加密同步、数据源、MCP 和本地 API 设置通过 1440×1000 与 390×844 可见验收；无横向溢出或控件截断。
- **PDF 验收**：独立 A4 渲染器生成两页 QA 报告；中文、图表、ASCII 列表、英文换行、分页和页脚可读，无 Markdown 标记、重叠或截断。
- **真实迁移**：`moji.db.pre-v012.backup` 完整性检查为 `ok`；新列、`weekly_plans`、FTS 表和同步触发器均存在，1334 条活动与 1334 条索引一致。
- **真实本地 API**：启动前端口 `5610` 未监听；开启后仅绑定 `127.0.0.1`，健康、活动、汇总端点正常，错误令牌返回 `401`，汇总覆盖 1337 条活动。
- **真实 MCP**：debug 可执行文件以 `--mcp` 进入 `stdio` 模式，`tools/list` 返回 3 个只读工具。
- **真实回溯**：桌面 APP 使用 SQLite 返回 6 条本周活动，搜索 `ChatGPT` 返回 26 条匹配记录。
- **Git 状态**：v0.2.0 已完成本地提交、远端推送、标签和 GitHub Release。
