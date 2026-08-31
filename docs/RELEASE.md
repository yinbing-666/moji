# 墨记发布检查

发布前按以下顺序执行，确保源码版本、测试结果、安装包和 GitHub Release 能互相对应。

## 1. 统一版本号

同时更新：

- `package.json`
- `package-lock.json` 顶层版本与根包版本
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock` 中的墨记包版本
- `src-tauri/tauri.conf.json`

运行只读校验：

```powershell
./scripts/check-release.ps1
```

## 2. 本地验证

```powershell
npm ci
npm run test:features
npm run typecheck
npm run build
C:\Users\86152\.cargo\bin\cargo.exe test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

`cargo test` 中依赖真实桌面的采集用例默认忽略。发布前仍需人工检查首次引导、采集健康、全局快捷键、系统通知、加密同步、独立 MCP、ActivityWatch 自动接管和 PDF 导出。

当前版本只发布 Windows 10／11 x64 安装包，构建配置为 `src-tauri/tauri.windows.conf.json`。不创建 macOS 或 Linux 安装包。

Windows 构建会先运行 `scripts/patch-aw-server.ps1`。脚本只接受已知的原始哈希或补丁哈希，并将 ActivityWatch 的 PE 子系统改为 Windows GUI，避免启动服务时打开终端窗口。哈希或 PE 结构不符合预期时，构建必须失败。

## 3. 安装包校验

对最终 NSIS 安装包计算 SHA-256：

```powershell
./scripts/check-release.ps1 -Installer ".\src-tauri\target\release\bundle\nsis\墨记_0.2.1_x64-setup.exe"
```

把输出的 SHA-256 与安装包一起写入 GitHub Release，下载者可以用 `Get-FileHash` 复核。

## 4. 覆盖安装验收

1. 退出正在运行的旧版墨记。确认旧版墨记的 ActivityWatch 子进程已经结束。
2. 使用最终 NSIS 产物覆盖原安装目录，确认安装器退出码为 `0`。
3. 核对已安装 `moji-daily.exe` 的产品版本，并确认同目录存在 `moji-mcp.exe` 与 `activitywatch/aw-server-rust.exe`。
4. 使用隔离测试数据库启动已安装的 `moji-mcp.exe --db <测试数据库>`，验证初始化、`tools/list`、健康检查、搜索和汇总；不要用真实活动数据库做 MCP 发布测试。
5. 启动已安装主程序，确认 `127.0.0.1:5601/api/0/info` 的 `device_id` 为 `moji`。
6. 记录 ActivityWatch 子进程的 PID、父进程 PID 和文件路径。确认父进程是本轮启动的墨记后，终止此 ActivityWatch 子进程。
7. 确认守护线程启动了新的 ActivityWatch 子进程，并恢复 `5601` 监听和健康响应。首次进程和替代进程都不应创建自属的 `conhost.exe` 或 Windows Terminal 窗口。
8. 将安装目录、版本、安装包 SHA-256、MCP 结果和 ActivityWatch 接管结果记录到 `ROADMAP.md`。

## 5. 发布边界

- 提交、推送、打标签和创建 GitHub Release 分别确认。
- Release 只上传本轮构建出的安装包，不复用旧版本产物。
- 发布说明必须列出隐私边界、升级影响、验证结果和已知限制。
- 不上传 API Key、数据库、活动导出、诊断文件或真实窗口截图。
