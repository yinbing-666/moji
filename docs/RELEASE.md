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

`cargo test` 中依赖真实桌面的采集用例默认忽略。发布前仍需人工检查首次引导、采集健康、全局快捷键、系统通知、加密同步、MCP 和 PDF 导出。

当前版本只发布 Windows 10／11 x64 安装包，构建配置为 `src-tauri/tauri.windows.conf.json`。不创建 macOS 或 Linux 安装包。

## 3. 安装包校验

对最终 NSIS 安装包计算 SHA-256：

```powershell
./scripts/check-release.ps1 -Installer ./src-tauri/target/release/bundle/nsis/Moji_0.2.0_x64-setup.exe
```

把输出的 SHA-256 与安装包一起写入 GitHub Release，下载者可以用 `Get-FileHash` 复核。

## 4. 发布边界

- 提交、推送、打标签和创建 GitHub Release 分别确认。
- Release 只上传本轮构建出的安装包，不复用旧版本产物。
- 发布说明必须列出隐私边界、升级影响、验证结果和已知限制。
- 不上传 API Key、数据库、活动导出、诊断文件或真实窗口截图。
