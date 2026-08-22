# 墨记项目规范

## 产品边界

- 墨记是本地、可解释、低打扰的工作复盘助手，不扩展为任务管理、连续录屏、录音或云端协作平台。
- 核心链路是：本地采集、规则或 LLM 分类、人工修正、日周月复盘。
- 有 LLM 和无 LLM 模式应共享同一套数据结构与报告信息架构，LLM 只增强归纳和建议。

## 技术约定

- 前端沿用 React、TypeScript、Tailwind CSS 和现有自定义设计系统。
- 桌面端沿用 Tauri 2、Rust、SQLite 和内置 ActivityWatch。
- 优先复用现有依赖，不为局部功能增加新的运行时依赖。
- 修改必须保持已有 localStorage 与 SQLite 数据兼容；数据库 schema 变更需单独确认。
- 不记录或提交 API Key、窗口原文、截图、真实活动数据和本地数据库。

## 工作规则

- 开发前先检查 `ROADMAP.md` 和 `git status`，保留工作区已有改动。
- 只修改当前目标直接涉及的文件，不顺手重构或清理无关代码。
- 功能完成后同步更新 `ROADMAP.md`；只有已实现且验证通过的事项才能标为完成。
- 提交、推送、打标签和发布安装包分别确认，不把本地实现授权扩大为远端写入授权。

## 验证基线

- 前端逻辑变更至少运行 `npm run test:features`、`npm run typecheck` 和 `npm run build`。
- Rust 变更至少在 `src-tauri` 运行 `cargo test --locked`。
- 用户可见界面变更需在桌面和窄窗口下检查无重叠、无截断，并验证关键交互。
