#!/usr/bin/env bash
# 从墨记仓库 Release 下载内置 ActivityWatch 二进制
set -e
URL="https://github.com/yinbing-666/moji/releases/latest/download/aw-server-rust.exe"
DEST="$(dirname "$0")/../src-tauri/vendor/activitywatch/aw-server-rust.exe"
mkdir -p "$(dirname "$DEST")"
echo "下载 aw-server-rust.exe → $DEST"
curl -fL "$URL" -o "$DEST"
echo "完成: $(du -h "$DEST" | cut -f1)"
