# 报告编辑再导出设计（P0-4）

## 1. 编辑态交互

**状态**：`ReportView` 新增 `editing: boolean`、`draft: string`、`editTab: 'edit' | 'preview'`、`dirty: boolean`（`draft !== lastReport.content`）。

**进入**：工具栏在导出按钮左侧加「编辑」按钮，条件 `lastReport && !isGeneratingReport`。点击后 `setDraft(lastReport.content); setEditing(true); setEditTab('edit')`。

**编辑/预览**：复用 `div.report-content.max-h-[36rem].overflow-y-auto` 容器高度（避免切换跳动），内部按 Tab 切换：
- 编辑页：`<textarea class="report-editor w-full h-[36rem] font-mono">`，受控绑定 `draft`。
- 预览页：`<MarkdownReport content={draft} />`，与查看态完全一致的渲染路径。

**工具栏**（沿用 `templateEditorOpen` 弹层的按钮风格）：撤销 / 重做 / 保存 / 取消 / 还原 AI 原版（仅 `edited` 时显示）。撤销重做用自建 `useUndoStack(draft)`：`past/future` 数组，输入 500ms 防抖入栈，深度上限 50；快捷键 `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+S` 保存 / `Esc` 取消。

**编辑态禁用**：生成报告按钮、历史列表 `viewReport` / `deleteReport`（点击拦截并触发确认弹层）。保留：Markdown 导出（见第 4 节）。

**未保存确认**：`dirty` 时，取消 / 切换历史 / 关闭面板均走 `confirmLeaveEdit()` 弹层，三按钮「保存并离开 / 放弃修改 / 继续编辑」；另注册 `beforeunload` 兜底。

## 2. reportHistory 存储改动

```ts
interface ReportHistoryItem {
  id: string; createdAt: number;
  type: 'daily' | 'weekly' | 'monthly';
  template: string; content: string;
  originContent?: string;  // 首次编辑时快照 AI 原文
  edited?: boolean;        // 默认 false
  editedAt?: number;
}
```

`normalizeHistoryItem` 补默认值：`edited: item.edited === true`、`editedAt`/`originContent` 非法则置 `undefined`——旧数据读出即为「未编辑」，天然兼容。

**新函数**（`reportHistory.ts`）：
- `updateReportHistoryItem(id, content)`：定位条目 → 若 `!edited` 先 `originContent = item.content` → 写入新 `content`、`edited = true`、`editedAt = Date.now()` → `saveReportHistory` → `dbSaveReportHistory(item)`（按 id upsert）。**不新增条目、不改 id 与排序**，故上限仍为 20，编辑不占额外槽位。
- `revertReportHistoryItem(id)`：`content = originContent`，清空 `edited/editedAt/originContent`，同样落库。

**SQLite**：`report_history` 表迁移加列 `origin_content TEXT`、`edited INTEGER DEFAULT 0`、`edited_at INTEGER`（`ALTER TABLE ... ADD COLUMN` 幂等）。db 写失败仅 warn，localStorage 为准（本地优先）。

**Store**：`activityStore` 新增 `updateReport(id, content)` / `revertReport(id)`，同步刷新 `reportHistory`，且当 `lastReport.id === id` 时同步更新 `lastReport`。

## 3. 编辑版与 AI 原版区分

- **视觉**：历史列表项与报告标题右侧渲染 `<span class="report-edited-badge">已编辑</span>`，样式 `text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200`（暗色 `bg-amber-500/10 text-amber-400 border-amber-500/30`），紧贴日期/类型标签右侧，不换行、不参与点击热区。列表项 hover 时 `title="AI 原版已保留，可一键还原"`。
- **还原**：编辑态工具栏「还原 AI 原版」与查看态 badge 上的小图标按钮均调用 `revertReport(id)`，前置 `confirm` 弹层「将丢弃全部手动修改，恢复到 AI 生成的原文，是否继续？」。还原后 badge 消失、`draft` 同步回 `originContent`、撤销栈清空。`originContent` 缺失（异常数据）时按钮置灰。
- **导出体现**：文件名在原有 `墨记-{type}报告-{YYYYMMDD}` 基础上，`edited` 时追加后缀 `-已编辑`；导出内容尾部追加一行脚注 `> 本报告由 AI 生成，并于 {editedAt 格式化} 经人工编辑。`，未编辑则不追加，保持现有输出字节级不变。

## 4. 导出联动

**取值来源**：导出统一读 `editing ? draft : lastReport.content`，即编辑态下「所见即所导」，无需先保存。`exportMarkdown` / `exportPdf` / `copyToClipboard` 共用同一个 `getExportContent()`，避免三处分叉。

**编辑态可用性**：Markdown 导出与复制始终可用；PDF 导出因走 `MarkdownReport` 渲染节点，编辑态下先强制 `setEditTab('preview')` 等一帧再截图，防止对着 `textarea` 出图。

**脏态提示**：`dirty` 时导出弹一次轻提示「正在导出未保存的修改」，不阻断流程；导出成功后不自动保存，保存与否仍由用户决定。

**历史项导出**：历史列表的导出入口按条目自身的 `content` / `edited` / `editedAt` 生成，与当前编辑态互不影响。

## 5. 验收标准

- **进入编辑**：有报告且未在生成中时「编辑」按钮可见；点击后进入编辑态，`textarea` 内容与查看态正文一致，生成按钮置灰。
- **切换预览**：编辑页改动后切到预览页，渲染结果与改动一致；容器高度不变、无跳动；切回编辑页内容不丢。
- **保存持久化**：保存后退出编辑态，正文与历史列表项均显示新内容；`localStorage.reportHistory` 中该条目 `content` 已更新、`edited === true`、`originContent` 为 AI 原文、条目 id 与排序不变、总数仍 ≤ 20。
- **刷新仍在**：刷新页面后编辑版内容、badge、`editedAt` 全部保留。
- **区分标记**：编辑过的报告在标题与历史列表均显示「已编辑」badge；未编辑的不显示；还原后 badge 消失且内容等于 `originContent`。
- **导出为编辑版**：编辑态下未保存即导出，Markdown 文件内容等于 `draft`；文件名含 `-已编辑`；文末含人工编辑脚注；未编辑报告导出结果与改动前完全一致。
- **未保存离开**：`dirty` 时点取消 / 切历史 / 关面板 / 刷新页面，均出现确认；「保存并离开」落盘后跳转，「放弃修改」丢弃改动，「继续编辑」停留原地。
- **旧数据兼容**：读取无 `edited` 字段的历史记录不报错、不显示 badge、可正常编辑并在首次编辑时补齐 `originContent`。
- **SQLite 同步**：保存与还原后 `report_history` 对应行的 `content` / `origin_content` / `edited` / `edited_at` 均已更新且不新增行；库不可用时仅控制台 warn，前台功能与 localStorage 数据不受影响。
