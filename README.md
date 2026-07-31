# 墨记

墨记是一款本地运行的桌面工作复盘工具。它通过定时截屏识别当前工作活动，把零散的窗口、文档、沟通和开发记录整理成可编辑的时间线，并按需生成日报、周报或月报。

## 核心工作流

```text
启动墨记
  -> 定时截屏
  -> 压缩截图并调用视觉模型识别活动
  -> 保存活动记录到本地 localStorage
  -> 人工筛选、修正、导出或生成报告
```

## 技术栈

- 前端：React 19 + TypeScript + Tailwind CSS 4 + 自定义 CSS 设计系统
- 设计系统：Tailwind 工具类，紧凑型桌面工具布局
- 桌面：Tauri 2.x + Rust
- 存储：当前使用 localStorage；SQLite 依赖已接入但业务数据层尚未落地
- 截屏：Rust `screenshots` + Windows 窗口枚举
- AI：OpenAI 兼容接口
  - 截图分析：`qwen3-vl-plus`
  - 报告生成：`qwen3.7-max`
- 默认中转站：`https://tokendance.space/gateway/v1`

## 已实现功能

- 定时截屏：支持 1/2/5/10 分钟间隔，可手动启停。
- 多窗口采集：枚举 Windows 可见窗口，前台窗口优先，并返回 PID、进程名、进程路径、Z 顺序等元数据。
- 采集节流：可设置每轮最多分析 1/2/3/5/8 个窗口，默认 3 个，并会跳过重复窗口。
- 隐私排除：可按应用名、窗口标题或进程名关键词跳过截图分析。
- AI 活动识别：按开发、会议、文档、沟通、其他分类生成中文活动描述。
- 本地持久化：当前使用 localStorage 保存活动记录和设置；读取时会归一化旧数据和异常字段。
- 缩略图控制：默认不保存截图缩略图，可在设置中手动开启。
- 活动记录管理：支持搜索、按分类筛选、仅看今天、编辑、删除、清空。
- 活动导出：支持导出筛选后的 Markdown 和 JSON。
- 报告生成：支持日报、周报、月报；默认使用今天的活动，也可切换全部记录；成功报告支持复制和下载 Markdown。
- 报告提示分离：配置缺失、空记录、生成失败只显示为提示，不会被当作报告复制、下载或保存历史。
- 报告历史：本地保存最近 20 条报告，支持恢复、复制、下载和删除单条。
- 仪表盘：展示今日记录数、主要应用、主要类型、最近活动和常驻手动截图入口。
- 中文界面：主流程和设置项已中文化，应用名为“墨记”。

## 快速开始

```bash
# 安装依赖
npm install

# 启动前端开发服务
npm run dev

# 启动 Tauri 桌面开发模式
npm run tauri dev

# 前端构建检查
npm run build

# Rust/Tauri 编译检查
cd src-tauri
cargo check

# 构建桌面应用
npm run tauri build
```

开发服务默认地址为 `http://127.0.0.1:1420/`。

## API Key 配置

1. 打开应用，进入“设置”。
2. 填入兼容 OpenAI `/chat/completions` 的 API Key。
3. 确认 Base URL，默认值为 `https://tokendance.space/gateway/v1`。
4. 点击“保存设置”。
5. 回到仪表盘点击“开始截图”。

API Key 只保存在本机设置中，不应写入代码仓库、日志或截图。

## 隐私说明

- 截图只用于 AI 分析，默认不保存截图缩略图。
- 开启“保存截图缩略图”后，才会在活动记录里保存压缩后的缩略图。
- 排除应用会根据窗口标题或进程名关键词跳过截图。
- AI 分析只附带进程名、可执行文件名、窗口标题等上下文，不发送完整本机进程路径。
- 活动记录和设置当前保存在本机 localStorage。
- API Key 以明文形式保存在本机 localStorage 的 `xiaohei-settings` 键中，未做加密。这是本地信任模型下的权衡，同一用户下的其他进程理论上可读取；在共享或不可信设备上使用时请注意。
- 除 AI API 调用外，应用没有云同步或服务端存储。

## 项目结构

```text
├── src/
│   ├── App.tsx                    # 主界面：仪表盘、活动记录、报告、设置
│   ├── index.css                  # Tailwind CSS 入口
│   ├── components/
│   │   ├── ActivityTimeline.tsx    # 活动记录筛选、编辑、删除、导出
│   │   ├── ReportView.tsx          # 报告生成、复制、下载
│   │   ├── Settings.tsx            # AI、采集、隐私设置
│   │   ├── ScreenshotModal.tsx     # 截图预览
│   │   └── ErrorBoundary.tsx       # 错误边界
│   ├── hooks/
│   │   ├── useAutoCapture.ts       # 定时截屏、AI 分析、记录写入
│   │   └── useScreenshot.ts        # 截屏计时器
│   ├── stores/
│   │   └── activityStore.tsx       # 活动与设置状态
│   └── utils/
│       ├── ai.ts                   # AI 截图分析与报告生成
│       ├── export.ts               # Markdown/JSON 下载
│       └── screenshot.ts           # Tauri 截屏封装
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                  # Tauri 入口
│   │   └── screenshot.rs           # 截屏实现
│   ├── capabilities/               # Tauri 权限配置
│   └── tauri.conf.json             # Tauri 应用配置
├── docs/
│   ├── plan.md
│   ├── specs/
│   │   ├── product.md
│   │   ├── boundary.md
│   │   └── tech.md
│   └── tech/
│       ├── ai-pipeline.md
│       ├── data.md
│       └── screenshot.md
└── README.md
```

## 当前限制

- 当前主要面向 Windows 10/11。
- SQLite 持久化、旧数据迁移尚未落地到业务数据层；报告历史当前保存在 localStorage。
- 还没有系统托盘、开机自启、全局快捷键、通知推送。
- 还没有云同步和多用户协作。
- PDF 导出尚未实现，当前导出以 Markdown 和 JSON 为主。
- 自定义背景、报告模板、报告质量评分、数据导入尚未实现。
