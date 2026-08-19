# 从墨记仓库 Release 下载内置 ActivityWatch 二进制到构建位置
# 用法: powershell -ExecutionPolicy Bypass -File scripts/fetch-aw-server.ps1
$ErrorActionPreference = "Stop"
$url = "https://github.com/yinbing-666/moji/releases/latest/download/aw-server-rust.exe"
$dest = Join-Path $PSScriptRoot "..\src-tauri\vendor\activitywatch\aw-server-rust.exe"
New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
Write-Host "下载 aw-server-rust.exe → $dest"
Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
$size = (Get-Item $dest).Length
Write-Host ("完成: {0:N1} MB" -f ($size / 1MB))
