#!/bin/bash
# サイネージの窓が、出すはずのモニターに載っているかを1語で返す。mm-placement.js が
# モニター構成の変化のあとに呼び、結果に応じて mm-start.sh / mm-stop.sh を走らせる。
#   ok        載っている
#   misplaced 別のモニターに載っている
#   absent    動いているが、出すモニターが無い
#   stopped   止まっていて、出すモニターはある
#   skip ...  判定しない（画面に接続できない・窓がまだ無い・止まっていて出すモニターも無い）
# 手で確かめるとき: bash ~/run/mm-placement.sh

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
DISPLAY_ID="${DISPLAY:-:0}"
# shellcheck source=mm-display.sh
. "$(dirname "$0")/mm-display.sh"

RUNNING=false
if systemctl --user is-active --quiet magicmirror.service; then
	RUNNING=true
fi
if ! XAUTH="$(signage_xauth "$DISPLAY_ID")"; then
	echo "skip: 画面 $DISPLAY_ID に接続できません"
	exit 0
fi

# 出すモニターの決め方は mm-start.sh と同じにする。
MONITOR="${SIGNAGE_MONITOR:-}"
if [ -z "$MONITOR" ] && [ -f "$HOME/MagicMirror/.env" ]; then
	MONITOR="$(sed -n 's/^[[:space:]]*SIGNAGE_MONITOR[[:space:]]*=[[:space:]]*\([A-Za-z0-9_-]*\)[[:space:]]*\(#.*\)\?$/\1/p' "$HOME/MagicMirror/.env" | tail -1)"
fi
if ! TARGET="$(DISPLAY="$DISPLAY_ID" XAUTHORITY="$XAUTH" signage_monitor "${MONITOR:-auto}" 2>/dev/null)"; then
	if $RUNNING; then
		echo "absent"
	else
		echo "skip: サイネージは動いておらず、出すモニターも見つかりません"
	fi
	exit 0
fi
if ! $RUNNING; then
	echo "stopped"
	exit 0
fi

# 行の例: 0x1800004 "MagicMirror²": ("electron" "electron")  2160x3840+6912+0  +6912+0
# 末尾の +X+Y が画面全体での位置。
WINDOW="$(DISPLAY="$DISPLAY_ID" XAUTHORITY="$XAUTH" xwininfo -root -tree 2>/dev/null \
	| sed -n 's/.*"MagicMirror²": .* \([0-9]*\)x\([0-9]*\)[+-][-0-9]*[+-][-0-9]* *+\(-\{0,1\}[0-9]*\)+\(-\{0,1\}[0-9]*\)$/\1 \2 \3 \4/p' | head -1)"
if [ -z "$WINDOW" ]; then
	echo "skip: サイネージの窓がまだありません"
	exit 0
fi

# 窓の中心が出すモニターの中にあれば ok とする。
read -r _ TX TY TW TH <<<"$TARGET"
read -r WW WH WX WY <<<"$WINDOW"
CX=$((WX + WW / 2))
CY=$((WY + WH / 2))
if [ "$CX" -ge "$TX" ] && [ "$CX" -lt $((TX + TW)) ] && [ "$CY" -ge "$TY" ] && [ "$CY" -lt $((TY + TH)) ]; then
	echo "ok"
else
	echo "misplaced"
fi
