#!/bin/bash
# MagicMirror の現在表示を1枚 PNG に撮る。稼働中の signage には触れない。
# 保存先: ~/signage/shots/<yyyymmddhhmmss>.png
# 使い方: bash ~/run/mm-shot.sh   （母艦からは ssh x13 'bash ~/run/mm-shot.sh'）
#
# 撮影の仕組み: 別プロセスの Electron で localhost:8080（MM 本体）を隠しウィンドウで開き、
# XWayland 実描画で JS を完走させてから capturePage する。実機と同じフォント・同じ絵が撮れる。
# GNOME(Wayland) の D-Bus スクショや X11 root grab は塞がれ/真っ黒になるため使わない。
set -e

export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="$(ls /run/user/"$(id -u)"/.mutter-Xwaylandauth.* 2>/dev/null | head -1)"

MM="$HOME/MagicMirror"
SHOT_DIR="$HOME/signage/shots"
mkdir -p "$SHOT_DIR"
OUT="$SHOT_DIR/$(date +%Y%m%d%H%M%S).png"

if ! ss -ltn 2>/dev/null | grep -q '127.0.0.1:8080'; then
	echo "エラー: MagicMirror (localhost:8080) が起動していない。先に bash ~/run/mm-start.sh" >&2
	exit 1
fi

SHOT_OUT="$OUT" SHOT_WAIT="${SHOT_WAIT:-12000}" \
	timeout 60 "$MM/node_modules/.bin/electron" "$HOME/run/mm-shot.js" --no-sandbox \
	2>&1 | grep -Ev '^\[|arning|GPU|Vulkan|gbm|DevTools' || true

if [ -s "$OUT" ]; then
	echo "撮影: $OUT ($(stat -c%s "$OUT") bytes)"
else
	echo "失敗: $OUT が空。MM の描画待ち(SHOT_WAIT)を伸ばして再試行を" >&2
	rm -f "$OUT"
	exit 1
fi
