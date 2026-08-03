#!/bin/bash
# yp-signage を X13 へ配布する（master → X13）
#
# 使い方: ./deploy.sh [ターゲット]
#   signage : MagicMirror 設定・自作モジュール・起動スクリプト一式 ※既定
#
# ターゲット式を残しているのは、配布単位を分けたくなったときに
# deploy_<名前>() を書いて case に1行足すだけで済むようにするため。
set -e
HOST=x13
ROOT="$(cd "$(dirname "$0")" && pwd)"

deploy_signage() {
	local D="$ROOT/scripts"
	local MM="$ROOT/magicmirror"

	# --- 起動・停止スクリプト ---
	ssh "$HOST" 'mkdir -p ~/run'
	scp -q "$D/mm-start.sh" "$D/mm-stop.sh" "$D/mm-ctl.sh" "$D/mm-fix-sandbox.sh" "$D/mm-shot.sh" "$D/mm-shot.py" "$D/mm-shot.js" "$D/README.md" "$HOST":'~/run/'
	ssh "$HOST" 'chmod +x ~/run/*.sh ~/run/*.py'

	# --- MagicMirror 設定・モジュール ---
	ssh "$HOST" 'mkdir -p ~/MagicMirror/config ~/MagicMirror/modules/yp-slideshow ~/MagicMirror/modules/yp-oshical ~/MagicMirror/modules/yp-monthcal ~/MagicMirror/css'
	scp -q "$MM/config.js" "$HOST":'~/MagicMirror/config/config.js'
	scp -q "$MM/css/custom.css" "$HOST":'~/MagicMirror/css/custom.css'
	# 設定値と秘密情報は .env にまとめてある。config.js は process.loadEnvFile() で
	# 「カレントディレクトリの .env」を読むため、config/ ではなく MagicMirror のルートへ置く
	# （MM は自身のルートを cwd にして起動する）。置き場所を間違えると全項目が既定値に落ちる。
	if [ -f "$MM/.env" ]; then
		scp -q "$MM/.env" "$HOST":'~/MagicMirror/.env'
	else
		echo "警告: $MM/.env が無い（カレンダーと天気が出なくなる）。.env.example を参照して作成を"
	fi
	scp -q "$MM/modules/yp-slideshow/yp-slideshow.js" "$MM/modules/yp-slideshow/node_helper.js" "$MM/modules/yp-slideshow/yp-slideshow.css" "$HOST":'~/MagicMirror/modules/yp-slideshow/'
	scp -q "$MM/modules/yp-oshical/yp-oshical.js" "$MM/modules/yp-oshical/node_helper.js" "$MM/modules/yp-oshical/yp-oshical.css" "$HOST":'~/MagicMirror/modules/yp-oshical/'
	scp -q "$MM/modules/yp-monthcal/yp-monthcal.js" "$MM/modules/yp-monthcal/yp-monthcal.css" "$MM/modules/yp-monthcal/holidays.js" "$HOST":'~/MagicMirror/modules/yp-monthcal/'

	echo "yp-signage を X13 へ配布完了"
}

case "${1:-signage}" in
	signage) deploy_signage ;;
	*) echo "不明なターゲット: $1（使えるのは signage）" >&2; exit 1 ;;
esac
