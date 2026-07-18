#!/bin/bash
# MagicMirror 起動（XWayland経由でX13画面に表示・バックグラウンド）
# 使い方: bash ~/run/mm-start.sh
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$(ls /run/user/$(id -u)/.mutter-Xwaylandauth.* 2>/dev/null | head -1)}"
# Electron を X11(XWayland) に強制固定（既定だと Wayland を掴んで失敗するため）。
# ヒントでは効かないので switch --ozone-platform=x11 を electron へ直接渡す。
unset WAYLAND_DISPLAY
cd "$HOME/MagicMirror" || { echo "MagicMirror未導入"; exit 1; }
pkill -f "js/electron.js" 2>/dev/null
sleep 2
nohup ./node_modules/.bin/electron js/electron.js --ozone-platform=x11 >/tmp/mm.log 2>&1 &
disown
echo "MagicMirror起動: ログ cat /tmp/mm.log / 止める bash ~/run/mm-stop.sh"
