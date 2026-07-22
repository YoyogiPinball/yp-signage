#!/bin/bash
# MMM-R5 スライドショー操作。母艦から `ssh x13 'bash ~/run/mm-ctl.sh next'` で叩く。
# 内部では MagicMirror(localhost:8080) の MMM-R5 制御エンドポイントを叩くだけ（curl/wget）。
# 使い方: mm-ctl.sh {pause|resume|toggle|next|prev}
set -euo pipefail

cmd="${1:-}"
case "$cmd" in
	pause) msg="❙❙ 一時停止しました（画面右下にバッジ表示）" ;;
	resume) msg="▶ 自動再生を再開しました" ;;
	toggle) msg="⏯ 一時停止／再開を切り替えました" ;;
	next) msg="⏭ 次の画像へ送りました" ;;
	prev) msg="⏮ 前の画像へ戻しました" ;;
	topbar) msg="⬛ 上バーの板 表示／非表示を切り替えました" ;;
	*)
		echo "usage: $(basename "$0") {pause|resume|toggle|next|prev|topbar}" >&2
		exit 1
		;;
esac

url="localhost:8080/MMM-R5/control/${cmd}"
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
