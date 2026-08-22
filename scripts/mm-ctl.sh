#!/bin/bash
# サイネージ操作。手元から `ssh <表示機> 'bash ~/run/mm-ctl.sh next'` で叩く。
# 内部では MagicMirror の各モジュールの制御エンドポイントを叩くだけ（curl/wget）。
# 使い方: mm-ctl.sh {pause|resume|toggle|next|prev|restart|topbar|blink [1-5] [秒]}
#         mm-ctl.sh order {sequential|shuffle}
#         mm-ctl.sh repeat {none|all|one}
#         mm-ctl.sh plate {0-100|reset}   時計の板の濃さ(%)。再起動不要で即反映
set -euo pipefail

# 接続先ポートは ~/MagicMirror/.env の SIGNAGE_PORT に従う（config.js と同じ正本を読む）。
# ここに 8080 を直書きすると、.env でポートを変えたときに表示は正常なのに操作だけが
# 届かなくなる。原因が分かりにくい壊れ方なので、設定は1箇所から読む。
# .env を source すると中身がシェルとして実行されてしまうため、数字だけを抜き出す。
ENV_FILE="$HOME/MagicMirror/.env"
PORT=""
if [ -f "$ENV_FILE" ]; then
	PORT=$(sed -n 's/^[[:space:]]*SIGNAGE_PORT[[:space:]]*=[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$ENV_FILE" | tail -1)
fi
PORT="${PORT:-8080}" # .env が無い・SIGNAGE_PORT を書いていない場合は config.js の既定と同じ
BASE="localhost:${PORT}"

cmd="${1:-}"
# 値を取る操作（order / repeat）は URL を2段にする。1段のまま `order-shuffle` のような
# 名前で並べると、増えるたびに受け側の一覧を書き換えることになり、綴りのゆれも起きる。
arg=""
case "$cmd" in
	pause) msg="❙❙ 一時停止しました（画面右下にバッジ表示）" ;;
	resume) msg="▶ 自動再生を再開しました" ;;
	toggle) msg="⏯ 一時停止／再開を切り替えました" ;;
	next) msg="⏭ 次の画像へ送りました" ;;
	prev) msg="⏮ 前の画像へ戻しました" ;;
	restart) msg="⟲ 最初の画像から再生し直しました" ;;
	topbar) msg="⬛ 上バーの板 表示／非表示を切り替えました" ;;
	order)
		arg="${2:-}"
		case "$arg" in
			sequential) msg="🔢 表示順を「ファイル名の自然順」にしました" ;;
			shuffle) msg="🔀 表示順を「シャッフル」にしました（順番を引き直します）" ;;
			*)
				echo "usage: $(basename "$0") order {sequential|shuffle}" >&2
				exit 1
				;;
		esac
		;;
	repeat)
		arg="${2:-}"
		case "$arg" in
			none) msg="⏹ 最後の画像まで来たら止まるようにしました" ;;
			all) msg="🔁 最後まで来たら先頭へ戻るようにしました" ;;
			one) msg="🔂 自動送りを止め、いまの1枚を出しっぱなしにしました" ;;
			*)
				echo "usage: $(basename "$0") repeat {none|all|one}" >&2
				exit 1
				;;
		esac
		;;
	# 時計の背景プレートの濃さ。画面を見ながら詰めるための一時変更で、MagicMirror を
	# 再起動すると custom.css の既定（:root の --clock-plate-alpha）へ戻る。
	# 気に入った値は custom.css へ書き戻して ./deploy.sh すること。
	plate)
		arg="${2:-}"
		if [ "$arg" = "reset" ]; then
			msg="⬜ 時計の板の濃さを custom.css の既定に戻しました"
		else
			# 数字以外・空・3桁超はここで弾く。受け側でも同じ検証をしているが、
			# 手元で弾いたほうが「何が悪いか」を出せる。
			case "$arg" in
				'' | *[!0-9]*)
					echo "usage: $(basename "$0") plate {0-100|reset}" >&2
					exit 1
					;;
			esac
			if [ "$arg" -gt 100 ]; then
				echo "usage: $(basename "$0") plate {0-100|reset}（0〜100 で指定してください）" >&2
				exit 1
			fi
			# custom.css に書き戻すときの値は 0〜1 なので、%を割って見せる。
			# "0.${arg}" と組み立てると 5% が 0.5、100% が 0.100 になるため計算させる。
			css_value=$(awk -v n="$arg" 'BEGIN { printf "%.2f", n / 100 }')
			msg="⬛ 時計の板の濃さを ${arg}% にしました（再起動すると既定に戻ります。残すなら custom.css の --clock-plate-alpha を ${css_value} にして ./deploy.sh）"
		fi
		;;
	# 配信開始時の点滅の確認用。開始時刻を待たずに、配信予定バーの先頭（左上の
	# 時刻付きの枠）を光らせる。本番の発火予定は消さない。
	# 第2引数で光り方の案（1=控えめ 2=濃い 3=全周 4=明滅 5=反転）、第3引数で秒数。
	blink) msg="" ;;
	*)
		echo "usage: $(basename "$0") {pause|resume|toggle|next|prev|restart|topbar|blink [1-5] [秒]}" >&2
		echo "       $(basename "$0") order {sequential|shuffle}" >&2
		echo "       $(basename "$0") repeat {none|all|one}" >&2
		echo "       $(basename "$0") plate {0-100|reset}" >&2
		exit 1
		;;
esac

if [ "$cmd" = "blink" ]; then
	style="${2:-}"
	sec="${3:-}"
	q=""
	[ -n "$style" ] && q="?style=${style}"
	if [ -n "$sec" ]; then
		if [ -n "$q" ]; then q="${q}&sec=${sec}"; else q="?sec=${sec}"; fi
	fi
	url="${BASE}/yp-oshical/test-blink${q}"
	names=("" "控えめ" "濃い" "全周を囲む" "はっきり明滅" "反転（最強）")
	label=""
	[ -n "$style" ] && label="案${style}（${names[$style]}）で "
	msg="✨ ${label}先頭の枠を${sec:-60}秒間 光らせました"
elif [ -n "$arg" ]; then
	url="${BASE}/yp-slideshow/control/${cmd}/${arg}"
else
	url="${BASE}/yp-slideshow/control/${cmd}"
fi
# curl が入っていない環境があるため wget にフォールバックする。
if command -v curl >/dev/null 2>&1; then
	http() { curl -fsS "$1" >/dev/null; }
else
	http() { wget -qO- "$1" >/dev/null; }
fi

if http "$url"; then
	echo "$msg"
else
	echo "⚠ 失敗: MagicMirror に届きませんでした（起動しているか確認してください）" >&2
	exit 1
fi
