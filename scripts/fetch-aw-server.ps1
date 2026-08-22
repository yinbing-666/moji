# 从墨记仓库 Release 下载内置 ActivityWatch 二进制到构建位置
# 用法: powershell -ExecutionPolicy Bypass -File scripts/fetch-aw-server.ps1
$ErrorActionPreference = "Stop"
$version = "v0.2.0"
$expectedSha256 = "eaf7a265ab05d0ffbca6fefced047a95116a9fb8b3d439ea4cc23c5b25e95232"
$url = "https://github.com/yinbing-666/moji/releases/download/$version/aw-server-rust.exe"
$dest = Join-Path $PSScriptRoot "..\src-tauri\vendor\activitywatch\aw-server-rust.exe"
$temp = "$dest.download"
New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
Write-Host "下载 aw-server-rust.exe → $dest"
try {
  Invoke-WebRequest -Uri $url -OutFile $temp -UseBasicParsing
  $actualSha256 = (Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256) {
    throw "SHA-256 校验失败：期望 $expectedSha256，实际 $actualSha256"
  }
  Move-Item -Force -LiteralPath $temp -Destination $dest
} finally {
  if (Test-Path -LiteralPath $temp) { Remove-Item -Force -LiteralPath $temp }
}
$size = (Get-Item $dest).Length
Write-Host ("完成: {0:N1} MB" -f ($size / 1MB))
