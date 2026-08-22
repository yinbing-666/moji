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
    ARCHIVE="activitywatch-v0.13.2-macos-x86_64.dmg"
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

case "$ARCHIVE" in
  activitywatch-v0.13.2-linux-x86_64.zip)
    EXPECTED_SHA256="8f62b10babf8a8f108cbdf7267c02fbc1ce2a970fa9535f230b3416b803e3360"
    ;;
  activitywatch-v0.13.2-macos-x86_64.dmg)
    EXPECTED_SHA256="22f3bce0e169457902b2c8d2967701cde887171f737d281dd414a210bd3090ed"
    ;;
esac

echo "下载 ActivityWatch 官方发行包：$ARCHIVE"
curl -fL "$URL" -o "$TEMP_DIR/$ARCHIVE"
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(sha256sum "$TEMP_DIR/$ARCHIVE" | awk '{print $1}')"
else
  ACTUAL_SHA256="$(shasum -a 256 "$TEMP_DIR/$ARCHIVE" | awk '{print $1}')"
fi
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
  echo "SHA-256 校验失败：期望 $EXPECTED_SHA256，实际 $ACTUAL_SHA256" >&2
  exit 1
fi
mkdir -p "$(dirname "$DEST")"
if [[ "$ARCHIVE" == *.dmg ]]; then
  MOUNT_POINT="$TEMP_DIR/mount"
  mkdir -p "$MOUNT_POINT"
  hdiutil attach "$TEMP_DIR/$ARCHIVE" -mountpoint "$MOUNT_POINT" -nobrowse -quiet
  trap 'hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true; rm -rf "$TEMP_DIR"' EXIT
  cp "$MOUNT_POINT"/ActivityWatch.app/Contents/MacOS/aw-server-rust "$DEST"
else
  unzip -p "$TEMP_DIR/$ARCHIVE" 'activitywatch/aw-server-rust/aw-server-rust' > "$DEST"
fi
chmod 755 "$DEST"
echo "完成：$(du -h "$DEST" | cut -f1) → $DEST"
