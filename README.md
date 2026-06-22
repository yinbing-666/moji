# 小黑日报助手

AI 驱动的桌面工作日报生成工具。定时截屏 → 视觉模型识别活动 → 自动生成日报/周报/月报。

## 技术栈

- **前端**: React 19 + TypeScript + Tailwind CSS 4
- **桌面**: Tauri 2.x (Rust)
- **AI**: 通义千问 VL (qwen3-vl-plus) 截图分析 + 通义千问 (qwen3.7-max) 报告生成
- **中转站**: tokendance.space (OpenAI 兼容接口)

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式 (Vite HMR)
npm run dev

# 构建 Tauri 桌面应用
npm run tauri build
```

## API Key 配置

1. 打开应用 → 点击底部「设置」
2. 填入 API Key (从 [阿里云 DashScope](https://dashscope.console.aliyun.com/) 或兼容的中转站获取)
3. Base URL 默认为 `https://tokendance.space/gateway/v1`，可修改
4. 点击「保存设置」

**注意**: API Key 仅存储在本地 localStorage，不会上传到任何服务器。请勿将真实 Key 提交到代码仓库。

## 功能

- **定时截屏**: 可配置间隔 (1/2/5/10 分钟)，支持启动时自动开始
- **AI 活动识别**: 每次截屏自动调用视觉模型，识别当前活动类型 (开发/会议/文档/沟通/其他)
- **活动时间线**: 按时间排列的活动记录，可点击查看截屏缩略图
- **报告生成**: 一键生成日报/周报/月报，支持复制到剪贴板
- **数据本地化**: 所有数据存储在 localStorage，不联网

## 数据隐私

- 截屏原图仅在内存中用于压缩和 AI 分析，**不会持久化存储**
- 只保存小尺寸缩略图 (320px) 用于 UI 展示
- AI 分析失败时，记录失败信息但不保存截图
- 活动记录和设置存储在浏览器 localStorage 中

## 已知限制 (MVP)

- 仅支持 Windows 桌面 (Tauri)
- 无多用户支持
- 无云同步
- 无后台服务 / 开机自启
- 无安装包发布 (需本地构建)
- 数据存在 localStorage，清空浏览器数据会丢失记录

## 项目结构

```
src/
├── App.tsx                 # 主应用 (仪表盘 + 设置页)
├── components/
│   ├── Settings.tsx        # 设置面板 (API Key / 间隔 / 自动启动)
│   ├── ActivityTimeline.tsx # 活动记录列表
│   ├── ReportView.tsx      # 报告生成与展示
│   └── ScreenshotModal.tsx # 截屏放大查看
├── hooks/
│   ├── useAutoCapture.ts   # 自动截屏 + AI 分析管道
│   ├── useScreenshot.ts    # 截屏计时器 Hook
├── stores/
│   └── activityStore.tsx   # 活动记录状态管理 (Context)
├── utils/
│   ├── ai.ts               # AI 接口 (截图分析 + 报告生成)
│   └── screenshot.ts       # Tauri 截屏 API 封装
└── types/                  # TypeScript 类型定义
```
