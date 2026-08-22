#!/usr/bin/env bash
# 从 ActivityWatch 官方 v0.13.2 发行包提取当前平台的 aw-server-rust。
set -euo pipefail

PLATFORM="$(uname -s)"
ARCH="$(uname -m)"
if [[ "$ARCH" != "x86_64" ]]; then
  echo "ActivityWatch v0.13.2 没有 $PLATFORM/$ARCH 的官方服务二进制。" >&2
  exit 2
fi

case "$PLATFORM" in
  Darwin)
    ARCHIVE="activitywatch-v0.13.2-macos-x86_64.zip"
    ;;
  Linux)
    ARCHIVE="activitywatch-v0.13.2-linux-x86_64.zip"
    ;;
  *)
    echo "当前脚本只支持 macOS 和 Linux；Windows 请运行 fetch-aw-server.ps1。" >&2
    exit 2
    ;;
esac

URL="https://github.com/ActivityWatch/activitywatch/releases/download/v0.13.2/$ARCHIVE"
DEST="$(dirname "$0")/../src-tauri/vendor/activitywatch/aw-server-rust"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "下载 ActivityWatch 官方发行包：$ARCHIVE"
curl -fL "$URL" -o "$TEMP_DIR/$ARCHIVE"
unzip -p "$TEMP_DIR/$ARCHIVE" 'activitywatch/aw-server-rust/aw-server-rust' > "$DEST"
chmod 755 "$DEST"
echo "完成：$(du -h "$DEST" | cut -f1) → $DEST"
