# 墨记

墨记是一款本地运行的桌面工作复盘工具。它通过定时采集窗口内的 UI 文本（进程名、窗口标题、控件文本），用纯文本模型识别当前工作活动，把零散的窗口、文档、沟通和开发记录整理成可编辑的时间线，并按需生成日报、周报或月报。

## 核心工作流

```text
启动墨记
  -> 定时枚举可见窗口（元数据 + 可选截屏）
  -> 经 UI Automation 只读采集窗口内文本（本地，不上云）
  -> 纯文本模型归纳活动（无需多模态视觉模型）
  -> 保存活动记录到本地 localStorage + SQLite
  -> 人工筛选、修正、导出或生成报告
```

## 技术栈

- 前端：React 19 + TypeScript + Tailwind CSS 4 + 自定义 CSS 设计系统
- 设计系统：Tailwind 工具类，紧凑型桌面工具布局
- 桌面：Tauri 2.x + Rust
- 存储：localStorage + SQLite（Rust rusqlite）
- 窗口采集：Rust `windows-sys` 窗口枚举 + `windows` crate UI Automation 文本读取
- AI：OpenAI 兼容接口
  - 活动分析 / 报告生成共用纯文本模型（无需多模态视觉模型）
  - 请求经 Rust 后端 `chat_completions` 代理（reqwest），绕过浏览器 CORS 限制，API Key 不暴露在 WebView JS 上下文
- UI：React 19 + Tailwind CSS 4 + 自定义设计系统
  - 桌面级布局：深墨色侧边栏（仪表盘 / 时间轴 / 报告 / 设置）+ 浅色内容区，采集状态与主控开关常驻侧边栏
  - 仪表盘：深色「今日投入」时长英雄卡、主要应用 / 类型卡、24 小时彩色活动时间轴（对数缩放）、分类占比堆叠条
  - 卡片层次阴影、分类彩色徽章（开发靛蓝 / 会议橙 / 文档青 / 沟通玫红 / 其他灰）
  - 系统字体栈（Segoe UI / 微软雅黑 / PingFang），细滚动条、状态呼吸点
- AI 接口：任何 OpenAI 兼容服务均可（Base URL、模型名在设置中填写，默认留空）

## 已实现功能

- 定时采集：支持 1/2/5/10 分钟间隔，可手动启停。
- 多窗口采集：枚举 Windows 可见窗口，前台窗口优先，并返回 PID、进程名、进程路径、Z 顺序等元数据。
- 窗口文本识别：通过 UI Automation 只读采集窗口内控件文本（标签页、文件路径、编辑框内容等），纯文本模型归纳活动，不截图、不上云图像。
- 采集节流：可设置每轮最多分析 1/2/3/5/8 个窗口，默认 3 个，并会跳过重复窗口。
- 隐私排除：可按应用名、窗口标题或进程名关键词跳过采集与分析；密码框等敏感控件自动跳过。
- AI 活动识别：按开发、会议、文档、沟通、其他分类生成中文活动描述。
- 本地持久化：localStorage + SQLite 双写保存活动记录和设置；读取时会归一化旧数据和异常字段。
- 缩略图控制：默认关闭截屏（识别不依赖图像）；开启后才会截屏并在活动记录里保存压缩缩略图。
- 活动记录管理：支持关键词搜索、按分类筛选、仅看今天，时间轴按日期分组展示；编辑描述（Ctrl+Enter 保存）、删除单条、清空全部。
- 活动时长统计：ActivityWatch 源透传事件时长，窗口文本采集按连续采集周期累计停留时间；仪表盘和报告页展示总时长 / 单活动时长 / 应用时长排行（SQLite 已加列并自动迁移旧库）。
- 活动导出：设置页支持导入 / 导出全部活动的 JSON，并支持 SQLite 本地备份与恢复。
- 报告生成：选择日期后用 AI 生成日报，生成后直接在应用内展示，支持复制和下载 Markdown；生成失败、配置缺失只显示为提示，不会污染报告内容。
- 报告历史：本地保存最近 20 条报告，可随时回看、复制、下载、删除。
- 系统托盘：关闭窗口最小化到托盘保持后台采集，左键单击托盘或菜单「显示墨记」唤起窗口，托盘菜单「退出」真正退出。
- 仪表盘：展示今日记录数、主要应用、主要类型、最近活动和手动采集入口。
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
3. 填写 Base URL（任何 OpenAI 兼容服务，如 OpenAI / DeepSeek / 各类网关）。
4. 填写模型名称（该服务下可用的纯文本对话模型）。
5. 点击“保存设置”。
6. 回到仪表盘点击“开始采集”。

API Key 只保存在本机设置中，不应写入代码仓库、日志。

## 隐私说明

- 活动识别基于窗口内 UI 文本（进程名、窗口标题、控件文本），默认不截屏。
- 开启“保存截图缩略图”后才会截屏，并在活动记录里保存压缩后的缩略图。
- 排除应用会根据窗口标题或进程名关键词跳过采集；UIA 采集自动跳过密码框。
- AI 分析只附带进程名、可执行文件名、窗口标题和窗口内文本，不发送完整本机进程路径。
- 活动记录和设置保存在本机 localStorage 与 SQLite。
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
│   │   ├── useAutoCapture.ts       # 定时采集、UIA 文本读取、AI 分析、记录写入
│   │   └── useScreenshot.ts        # 采集计时器
│   ├── stores/
│   │   └── activityStore.tsx       # 活动与设置状态
│   └── utils/
│       ├── ai.ts                   # AI 窗口文本分析与报告生成（纯文本模型）
│       ├── export.ts               # Markdown/JSON 下载
│       └── screenshot.ts           # Tauri 窗口采集封装
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                  # Tauri 入口
│   │   ├── screenshot.rs           # 窗口枚举 + 可选截屏实现
│   │   ├── uia.rs                  # UI Automation 窗口文本采集（替代视觉识别）
│   │   ├── system.rs               # 前台窗口、空闲、锁屏检测
│   │   ├── aw.rs                   # ActivityWatch 数据源
│   │   └── db.rs                   # SQLite 持久化
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
- 窗口文本采集依赖应用支持 UI Automation（现代浏览器、Electron、Office、IDE 等基本都支持；个别自绘控件可能读不到文本，此时降级为按进程名+标题判断）。
- 还没有开机自启、全局快捷键、通知推送（系统托盘与关窗最小化已实现）。
- 还没有云同步和多用户协作。
- PDF 导出尚未实现，当前导出以 Markdown 和 JSON 为主。
- 周报 / 月报的后端生成逻辑已就绪（`src/utils/ai.ts` 支持 weekly / monthly），界面入口尚未提供。
