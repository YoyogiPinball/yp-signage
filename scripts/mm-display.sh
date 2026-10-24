#!/bin/bash
# mm-start.sh と mm-shot.sh が source する、表示先の判定。単体では実行しない。
#
# 座標は xrandr（XWayland から見た画面）で取る。Electron は X11 として動くので、
# Mutter の論理座標ではなくこちらと同じ空間に窓を置く。GNOME の分数倍率を使うと
# XWayland の座標は論理座標の倍数になるため、Mutter の値をそのまま渡すと別の画面に出る。

# 今の XWayland に通る認証ファイルを返す。Mutter は XWayland を起動し直すたびに
# .mutter-Xwaylandauth.* を作り、古いものも残すので、新しい順に試して通ったものを使う。
signage_xauth() {
	local display="$1" f
	for f in $(ls -t /run/user/"$(id -u)"/.mutter-Xwaylandauth.* 2>/dev/null); do
		if DISPLAY="$display" XAUTHORITY="$f" xrandr --listmonitors >/dev/null 2>&1; then
			echo "$f"
			return 0
		fi
	done
	return 1
}

# サイネージを出すモニターを「名前 x y 幅 高さ」（XWayland の画素）で1行返す。
# 第1引数は SIGNAGE_MONITOR の値。auto（または空）なら次の順で1つに決める。
#   1) 外部モニターのうち縦置きのもの
#   2) 外部モニターのうち原点 (0,0) にあるもの
# 決まらないときは、作業用の画面を覆わないように失敗させる。
# DISPLAY と XAUTHORITY は呼び出し側で設定しておく。
signage_monitor() {
	local wanted="${1:-auto}" list
	if ! list="$(xrandr --listmonitors 2>/dev/null)"; then
		echo "エラー: xrandr で画面の一覧を取得できません（DISPLAY=$DISPLAY）" >&2
		return 1
	fi
	# 行の例: " 2: +DP-1 2160/1390x3840/780+6912+0  DP-1"
	local rows
	rows="$(echo "$list" | sed -n 's|^ *[0-9]*: [+*]*\([^ ]*\) \([0-9]*\)/[0-9]*x\([0-9]*\)/[0-9]*+\([0-9]*\)+\([0-9]*\).*|\1 \4 \5 \2 \3|p')"
	local names
	names="$(echo "$rows" | cut -d' ' -f1 | paste -sd' ')"

	local picked
	if [ "$wanted" != "auto" ]; then
		picked="$(echo "$rows" | awk -v n="$wanted" '$1 == n')"
		if [ -z "$picked" ]; then
			echo "エラー: SIGNAGE_MONITOR=$wanted のモニターが見つかりません（いま有効なもの: $names）" >&2
			return 1
		fi
	else
		# 内蔵パネルの名前は Linux DRM の慣習（eDP / LVDS / DSI）で見分ける。
		local external
		external="$(echo "$rows" | grep -Ev '^(eDP|LVDS|DSI)')"
		picked="$(echo "$external" | awk 'NF && $5 > $4')"
		if [ -z "$picked" ]; then
			picked="$(echo "$external" | awk 'NF && $2 == 0 && $3 == 0')"
		fi
		if [ -z "$picked" ] || [ "$(echo "$picked" | wc -l)" -ne 1 ]; then
			echo "エラー: 出すモニターを自動では決められません（いま有効なもの: $names）。" >&2
			echo "  ~/MagicMirror/.env の SIGNAGE_MONITOR に、上の名前のどれかを書いてください" >&2
			return 1
		fi
	fi
	echo "$picked"
}
