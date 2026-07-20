#!/bin/bash
# ~/Batches/x13/ を X13 へ配布する（master → X13）
#
# 使い方: ./deploy.sh [ターゲット]
#   signage : yp-signage/（MagicMirror 設定・自作モジュール・起動スクリプト）※既定
#
# 配布単位をターゲットで分けているのは、無関係な変更で MagicMirror の
# config.js を上書きして再起動を強いられるのを避けるため。
# 定期ジョブ等を足すときは deploy_<名前>() を書いて case に1行足す。
set -e
HOST=x13
ROOT="$(cd "$(dirname "$0")" && pwd)"

deploy_signage() {
	local D="$ROOT/yp-signage/scripts"
	local MM="$ROOT/yp-signage/magicmirror"

	# --- 起動・停止スクリプト ---
	ssh "$HOST" 'mkdir -p ~/run'
	scp -q "$D/mm-start.sh" "$D/mm-stop.sh" "$D/mm-fix-sandbox.sh" "$D/README.md" "$HOST":'~/run/'
	ssh "$HOST" 'chmod +x ~/run/*.sh'

	# --- MagicMirror 設定・モジュール ---
	ssh "$HOST" 'mkdir -p ~/MagicMirror/config ~/MagicMirror/modules/MMM-R5 ~/MagicMirror/modules/MMM-OshiCal ~/MagicMirror/modules/MMM-MonthCal ~/MagicMirror/css'
	scp -q "$MM/config.js" "$HOST":'~/MagicMirror/config/config.js'
	scp -q "$MM/css/custom.css" "$HOST":'~/MagicMirror/css/custom.css'
	if [ -f "$MM/secrets.js" ]; then
		scp -q "$MM/secrets.js" "$HOST":'~/MagicMirror/config/secrets.js'
	else
		echo "警告: $MM/secrets.js が無い（カレンダーは空表示になる）。secrets.example.js を参照して作成を"
	fi
	scp -q "$MM/modules/MMM-R5/MMM-R5.js" "$MM/modules/MMM-R5/node_helper.js" "$MM/modules/MMM-R5/MMM-R5.css" "$HOST":'~/MagicMirror/modules/MMM-R5/'
	scp -q "$MM/modules/MMM-OshiCal/MMM-OshiCal.js" "$MM/modules/MMM-OshiCal/node_helper.js" "$MM/modules/MMM-OshiCal/MMM-OshiCal.css" "$HOST":'~/MagicMirror/modules/MMM-OshiCal/'
	scp -q "$MM/modules/MMM-MonthCal/MMM-MonthCal.js" "$MM/modules/MMM-MonthCal/MMM-MonthCal.css" "$MM/modules/MMM-MonthCal/holidays.js" "$HOST":'~/MagicMirror/modules/MMM-MonthCal/'

	echo "yp-signage を X13 へ配布完了"
}

case "${1:-signage}" in
	signage) deploy_signage ;;
	*) echo "不明なターゲット: $1（使えるのは signage）" >&2; exit 1 ;;
esac
