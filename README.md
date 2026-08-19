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

## 功能特性

- **定时采集**：支持 1/2/5/10 分钟间隔，可手动启停；采集状态与主控开关常驻侧边栏。
- **多窗口采集**：枚举 Windows 可见窗口，前台窗口优先，返回 PID、进程名、进程路径、Z 顺序等元数据。
- **窗口文本识别**：UI Automation 只读采集窗口内控件文本（标签页、文件路径、编辑框内容等），纯文本模型归纳活动，不截图、不上云图像。
- **采集节流与隐私排除**：可设置每轮最多分析 1/2/3/5/8 个窗口并跳过重复窗口；可按应用名、窗口标题或进程名关键词跳过采集；密码框等敏感控件自动跳过。
- **AI 活动识别**：按开发、会议、文档、沟通、其他分类生成中文活动描述。
- **活动时长统计**：内置 ActivityWatch 服务随墨记自动启动，用于记录前台窗口时间线；窗口文本采集按连续采集周期累计停留时间，仪表盘与报告页展示总时长、单活动时长、应用时长排行。
- **仪表盘**：今日投入时长英雄卡、主要应用 / 类型卡、24 小时彩色活动时间轴（对数缩放）、分类占比堆叠条、最近活动与手动采集入口。
- **活动记录管理**：关键词搜索、分类筛选、仅看今天；时间轴按日期分组；编辑描述（Ctrl+Enter 保存）、删除单条、清空全部。
- **报告生成**：选择日期后用 AI 生成日报，内置模板 + 自定义模板（增删改、本地持久化）；生成后在应用内展示，支持复制与下载 Markdown；生成失败只显示提示，不污染报告内容。
- **报告历史**：本地保存最近 20 条报告，可回看、复制、下载、删除。
- **主题跟随系统**：默认 `system` 实时响应 Windows 深浅色变化，也可在设置中强制浅色或深色并持久化；全组件、背景预设、自定义图片遮罩与打印样式均已适配深色。
- **本地持久化**：localStorage + SQLite 双写保存活动记录与设置；读取时自动归一化旧数据和异常字段。
- **缩略图控制**：默认关闭截屏（识别不依赖图像）；开启后截屏并保存压缩缩略图。
- **活动导出**：导入 / 导出全部活动 JSON，支持 SQLite 本地备份与恢复。
- **系统托盘**：关闭窗口最小化到托盘保持后台采集；托盘菜单「退出」真正退出。
- **中文界面**：主流程与设置项已中文化。

## 技术栈

- 前端：React 19 + TypeScript + Tailwind CSS 4 + 自定义 CSS 设计系统
- 桌面：Tauri 2.x + Rust（`windows-sys` 窗口枚举 + `windows` crate UI Automation 文本读取）
- 存储：localStorage + SQLite（Rust rusqlite，自动迁移旧库）
- AI：任何兼容 OpenAI `/chat/completions` 的服务均可（OpenAI / DeepSeek / 各类网关），设置中填写 Base URL 与模型名
  - 活动分析 / 报告生成共用纯文本模型（无需多模态视觉模型）
  - 请求经 Rust 后端 `chat_completions` 代理（reqwest），绕过浏览器 CORS 限制，API Key 不暴露在 WebView JS 上下文

## 环境要求与依赖

### 必需

| 依赖 | 说明 |
|---|---|
| **Windows 10 / 11** | 窗口采集基于 Windows UI Automation，暂不支持其他系统 |
| **OpenAI 兼容 API Key** | 仅「有 LLM」模式的活动识别与报告生成需要；「无 LLM」模式可使用本地分类规则和固定格式报告 |
| **Node.js 20+** | 前端构建（`npm install` / `npm run build` / `npm run tauri dev`） |
| **Rust stable 工具链** | 后端 Tauri/Rust 编译（`cargo check` / `npm run tauri build`），含 MSVC 链接器（Visual Studio Build Tools） |

ActivityWatch 已随 Windows 安装包内置。无需单独下载、启动或配置端口。

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

# 构建桌面应用（NSIS 安装包）
npm run tauri build
```

开发服务默认地址为 `http://127.0.0.1:1420/`。

## API Key 配置

1. 打开应用，进入「设置」。
2. 填入兼容 OpenAI `/chat/completions` 的 API Key。
3. 填写 Base URL（任何 OpenAI 兼容服务，如 OpenAI / DeepSeek / 各类网关）。
4. 填写模型名称（该服务下可用的纯文本对话模型）。
5. 点击「保存设置」。
6. 回到仪表盘点击「开始采集」。

API Key 只保存在本机设置中，不应写入代码仓库、日志。

## 隐私说明

- 活动识别基于窗口内 UI 文本（进程名、窗口标题、控件文本），默认不截屏。
- 开启「保存截图缩略图」后才会截屏，并在活动记录里保存压缩后的缩略图。
- 排除应用会根据窗口标题或进程名关键词跳过采集；UIA 采集自动跳过密码框。
- AI 分析只附带进程名、可执行文件名、窗口标题和窗口内文本，不发送完整本机进程路径。
- 活动记录和设置保存在本机 localStorage 与 SQLite。
- API Key 以明文形式保存在本机 localStorage 的 `xiaohei-settings` 键中，未做加密。这是本地信任模型下的权衡，同一用户下的其他进程理论上可读取；在共享或不可信设备上使用时请注意。
- 除 AI API 调用外，应用没有云同步或服务端存储。

## 第三方组件声明

Windows 安装包包含未修改的 [ActivityWatch aw-server-rust](https://github.com/ActivityWatch/aw-server-rust) `0.13.2`，用于本机窗口时间线记录。该组件采用 Mozilla Public License 2.0（MPL-2.0）发布，源码获取方式、许可证及分发说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 项目结构

```text
├── src/
│   ├── App.tsx                    # 主界面：仪表盘、活动记录、报告、设置
│   ├── index.css                  # Tailwind 入口 + 设计系统（含深色适配）
│   ├── components/
│   │   ├── ActivityTimeline.tsx    # 活动记录筛选、编辑、删除、导出
│   │   ├── AwAnalytics.tsx         # 效率分析视图
│   │   ├── ReportView.tsx          # 报告生成（内置/自定义模板）、复制、下载
│   │   ├── Settings.tsx            # AI、采集、隐私、主题设置
│   │   ├── TodayOverview.tsx       # 今日概览（投入时长、主要应用/类型）
│   │   ├── ScreenshotModal.tsx     # 截图预览
│   │   └── ErrorBoundary.tsx       # 错误边界
│   ├── hooks/
│   │   ├── useAutoCapture.ts       # 定时采集、UIA 文本读取、AI 分析、记录写入
│   │   └── useScreenshot.ts        # 采集计时器
│   ├── stores/
│   │   └── activityStore.tsx       # 活动与设置状态（含主题模式持久化）
│   └── utils/
│       ├── ai.ts                   # AI 窗口文本分析与报告生成（纯文本模型）
│       ├── db.ts                   # 本地存储读写与归一化
│       ├── date.ts                 # 日期工具（今日键、本地日期键）
│       ├── importData.ts           # 活动导入/导出
│       ├── reportHistory.ts        # 报告历史持久化
│       ├── reportQuality.ts        # 报告质量评估
│       ├── screenshot.ts           # 截图处理
│       └── templates.ts            # 报告内置/自定义模板
├── src-tauri/                      # Tauri/Rust 后端
│   ├── src/
│   │   ├── lib.rs                  # 应用入口、窗口/托盘、chat_completions 代理
│   │   ├── aw.rs / aw_analytics.rs # 内置 ActivityWatch 数据接入与分析
│   │   ├── db.rs                   # SQLite 存储（含自动迁移）
│   │   └── system.rs               # 窗口枚举 / UI Automation 文本采集
│   └── tauri.conf.json             # 应用配置（窗口、打包）
└── docs/                           # 规格与开发文档
    ├── specs/                      # 产品/边界/技术规格
    └── tech/                       # AI 管线、数据设计
```
