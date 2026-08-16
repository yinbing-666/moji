# 7月4 版功能恢复记录

> 记录 2026-07-04 丢失版本的调查与恢复过程，作为阶段 1 重写 Rust 后端的参照。

## 背景

2026-07-04 编译的 `D:\grok\墨记\xiaohei-daily.exe` 包含一版功能远超当前 git 基座的墨记。
该版本源码从未提交 git，8月1 重新 build 时 `dist/` 被覆盖，明文前端仅存于 exe 内嵌资源。

## 恢复方法

Tauri v2 将前端资源以 brotli 压缩内嵌进二进制。资源 key 为明文，紧随其后是压缩内容。

- JS：key `index-hktpk5Iq.js` 在偏移 `11008224`，内容始于 `+17`，止于下一个 key `index.html`（`11087390`）。
- CSS：key `index-aVxetp2J.css` 在 `11087636`，内容 `+18` 起，止于 `11170584`。
- 用 Node `zlib.brotliDecompressSync` 解压该区间 → 明文。

恢复脚本：`_recover/extract.mjs`。产物：`_recover/index-hktpk5Iq.js`（273528 字节）、`_recover/index-aVxetp2J.css`（41310 字节）。

## 7月4 版 Tauri command 全集（17 个）

前端通过 `invoke`（压缩后为 `Kt`）调用。当前基座只保留前 2 个截图命令，其余 15 个需在阶段 1 重写。

### 已有（截图）
- `take_screenshot`
- `capture_visible_windows`（注：7月4 前端调用名如上；当前基座命令名以 `src-tauri/src/screenshot.rs` 为准）

### SQLite 活动 CRUD（需重写）
- `db_save_activity`
- `db_load_activities`
- `db_load_activities_paginated`（参数：`offset`、`limit`、`category`、`todayOnly`、`keyword`）
- `db_delete_activity`
- `db_clear_activities`
- `db_import_activities`（参数：`data` = JSON 字符串；返回总记录数）

### 报告历史（需重写）
- `db_save_report_history`（参数：`id`、`createdAt`、`reportType`、`template`、`content`）
- `db_load_report_history`
- `db_delete_report_history`（参数：`id`）

### 备份 / 恢复（需重写）
- `save_backup`
- `load_backup`
- `restore_backup_to_db`

### 系统检测（需重写）
- `get_foreground_window`
- `get_idle_seconds`
- `is_screen_locked`
- `diagnose_db`

## 前端功能明文证据（摘自 `_recover`）

### 报告模板
```
U0=[{label:"标准",value:"standard",description:"完整结构，适合日常同步"},
    {label:"简洁",value:"brief",description:"只保留重点和结论"},
    {label:"技术",value:"technical",description:"突出开发、调试和风险"},
    {label:"OKR",value:"okr",description:"围绕目标和关键结果复盘"}]
```

模板注入报告 prompt 的方式：
```
你是一个严谨的工作复盘助手。请根据下面的活动记录生成中文 Markdown ${日报/周报/月报}。
${模板描述}
要求：1.不要编造… 2.合并重复… 3.记录不足则说明… 4.输出用 Markdown 5.固定包含：概览、主要工作、沟通协作、遇到的…
```

自定义模板：`localStorage` key `moji-custom-templates`，结构 `{id, name, prompt}`，支持增删改。

### 数据结构差异
- localStorage key：7月4 用 `xiaohei-activities-v5` / `xiaohei-settings-v5` / `xiaohei-seeded-v5`；当前基座用 `xiaohei-activities` / `xiaohei-settings`。
- 报告历史：7月4 结构 `{id, createdAt, type, template, content}`，比当前多 `template` 字段。
- Settings 新增：`excludedApps`、`excludedTitlePatterns`、`appearance`（背景配置）。

### 自定义背景
预设：森林绿（`forest`）、天空蓝（`sky`）、石墨灰等 + 自定义图片 + 重置背景。

## 可恢复性

- **前端**：可从 `_recover` 的 minified JS 逐功能反混淆重建为 TSX。
- **Rust 后端**：编译为机器码，无法还原源码，须按上方命令签名重写。
- **未实现项**：报告评分、托盘、开机自启、全局快捷键在恢复产物中为 0，非丢失。

