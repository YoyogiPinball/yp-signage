#!/bin/bash
# サイネージ操作。母艦から `ssh x13 'bash ~/run/mm-ctl.sh next'` で叩く。
# 内部では MagicMirror の各モジュールの制御エンドポイントを叩くだけ（curl/wget）。
# 使い方: mm-ctl.sh {pause|resume|toggle|next|prev|topbar|blink [1-5] [秒]}
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
case "$cmd" in
	pause) msg="❙❙ 一時停止しました（画面右下にバッジ表示）" ;;
	resume) msg="▶ 自動再生を再開しました" ;;
	toggle) msg="⏯ 一時停止／再開を切り替えました" ;;
	next) msg="⏭ 次の画像へ送りました" ;;
	prev) msg="⏮ 前の画像へ戻しました" ;;
	topbar) msg="⬛ 上バーの板 表示／非表示を切り替えました" ;;
	# 配信開始時の点滅の確認用。開始時刻を待たずに、配信予定バーの先頭（左上の
	# 時刻付きの枠）を光らせる。本番の発火予定は消さない。
	# 第2引数で光り方の案（1=控えめ 2=濃い 3=全周 4=明滅 5=反転）、第3引数で秒数。
	blink) msg="" ;;
	*)
		echo "usage: $(basename "$0") {pause|resume|toggle|next|prev|topbar|blink [1-5] [秒]}" >&2
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
	url="${BASE}/MMM-OshiCal/test-blink${q}"
	names=("" "控えめ" "濃い" "全周を囲む" "はっきり明滅" "反転（最強）")
	label=""
	[ -n "$style" ] && label="案${style}（${names[$style]}）で "
	msg="✨ ${label}先頭の枠を${sec:-60}秒間 光らせました"
else
	url="${BASE}/MMM-R5/control/${cmd}"
fi
# X13 には curl が無い環境があるため wget にフォールバックする。
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
