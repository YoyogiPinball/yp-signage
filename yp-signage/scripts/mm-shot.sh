#!/bin/bash
# MagicMirror の現在表示（実画面）を1枚 PNG に撮る。稼働中の signage には触れない。
# 保存先: ~/signage/shots/<yyyymmddhhmmss>.png
# 使い方: bash ~/run/mm-shot.sh   （母艦からは ssh x13 'bash ~/run/mm-shot.sh'）
#
# 撮影の仕組み: org.gnome.Mutter.ScreenCast D-Bus を使い、サイネージ出力先モニタ (HDMI-2 / DP-2) の
# PipeWire ストリームから 1 フレームを直接キャプチャする。
# 別プロセスの Electron 再読み込みではなく実ディスプレイ出力をそのまま撮影するため、
# 背景スライド等の表示ズレが起きない。

set -e

export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"

SHOT_DIR="$HOME/signage/shots"
mkdir -p "$SHOT_DIR"
OUT="${SHOT_OUT:-$SHOT_DIR/$(date +%Y%m%d%H%M%S).png}"

if ! ss -ltn 2>/dev/null | grep -q '127.0.0.1:8080'; then
	echo "エラー: MagicMirror (localhost:8080) が起動していない。先に bash ~/run/mm-start.sh" >&2
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SHOT_OUT="$OUT" timeout 30 python3 "$SCRIPT_DIR/mm-shot.py" >/dev/null

if [ -s "$OUT" ]; then
	echo "撮影: $OUT ($(stat -c%s "$OUT") bytes)"
else
	echo "失敗: $OUT が空または作成されませんでした。" >&2
	rm -f "$OUT"
	exit 1
fi

