#!/bin/bash
# MagicMirror の現在表示（実画面）を1枚 PNG に撮る。稼働中の signage には触れない。
# 保存先: ~/signage/shots/<yyyymmddhhmmss>.png
# 使い方: bash ~/run/mm-shot.sh   （手元からは ssh <表示機> 'bash ~/run/mm-shot.sh'）
#
# 撮影の仕組み: org.gnome.Mutter.ScreenCast D-Bus を使い、サイネージ出力先モニタの
# PipeWire ストリームから 1 フレームを直接キャプチャする。
# 出力先のコネクタ名は mm-shot.py が Mutter.DisplayConfig に問い合わせて毎回決めるので、
# ケーブルを挿し替えても直す必要はない。特定のモニタを狙うときだけ SHOT_CONNECTOR=HDMI-2 のように指定する。
# 別プロセスの Electron 再読み込みではなく実ディスプレイ出力をそのまま撮影するため、
# 背景スライド等の表示ズレが起きない。

set -e

export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"

SHOT_DIR="$HOME/signage/shots"
mkdir -p "$SHOT_DIR"
OUT="${SHOT_OUT:-$SHOT_DIR/$(date +%Y%m%d%H%M%S).png}"

# 起動確認のポートも ~/MagicMirror/.env の SIGNAGE_PORT に従う（mm-ctl.sh と同じ理由）。
# 直書きのままだと、ポートを変えたときに動いている MM を「起動していない」と誤判定する。
ENV_FILE="$HOME/MagicMirror/.env"
PORT=""
if [ -f "$ENV_FILE" ]; then
	PORT=$(sed -n 's/^[[:space:]]*SIGNAGE_PORT[[:space:]]*=[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$ENV_FILE" | tail -1)
fi
PORT="${PORT:-8080}"

if ! ss -ltn 2>/dev/null | grep -q "127.0.0.1:${PORT}"; then
	echo "エラー: MagicMirror (localhost:${PORT}) が起動していない。先に bash ~/run/mm-start.sh" >&2
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

