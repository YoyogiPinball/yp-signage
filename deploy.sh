#!/bin/bash
# yp-signage を表示機へ配布する（手元の作業コピー → 表示機）
#
# 使い方: ./deploy.sh [ターゲット]
#   signage : MagicMirror 設定・自作モジュール・起動スクリプト一式 ※既定
#
# 配布先は ssh の設定名（~/.ssh/config の Host 名）で指定する。鍵認証を通しておくこと。
# 毎回書かずに済ませたいときは signage.conf に置く（gitignore 済み。ひな形は signage.conf.example）。
#   SIGNAGE_HOST=mysignage ./deploy.sh
#
# ターゲット式を残しているのは、配布単位を分けたくなったときに
# deploy_<名前>() を書いて case に1行足すだけで済むようにするため。
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

# 優先順位は「コマンド行の環境変数 > signage.conf」。conf を先に読み、環境変数を最後に当てる。
SIGNAGE_HOST_DEFAULT=""
# shellcheck source=/dev/null
[ -f "$ROOT/signage.conf" ] && . "$ROOT/signage.conf"
HOST="${SIGNAGE_HOST:-$SIGNAGE_HOST_DEFAULT}"
if [ -z "$HOST" ]; then
	echo "配布先が決まっていません。次のどちらかで指定してください:" >&2
	echo "  1) $ROOT/signage.conf に SIGNAGE_HOST_DEFAULT=\"<ssh の設定名>\" を書く" >&2
	echo "     （$ROOT/signage.conf.example をコピーして使う）" >&2
	echo "  2) SIGNAGE_HOST=<ssh の設定名> ./deploy.sh のように渡す" >&2
	exit 1
fi

deploy_signage() {
	local D="$ROOT/scripts"
	local MM="$ROOT/magicmirror"

	# --- 起動・停止スクリプト ---
	ssh "$HOST" 'mkdir -p ~/run'
	scp -q "$D/mm-start.sh" "$D/mm-stop.sh" "$D/mm-ctl.sh" "$D/mm-fix-sandbox.sh" "$D/mm-shot.sh" "$D/mm-shot.py" "$D/mm-shot.js" "$D/README.md" "$HOST":'~/run/'
	ssh "$HOST" 'chmod +x ~/run/*.sh ~/run/*.py'

	# --- MagicMirror 設定・モジュール ---
	ssh "$HOST" 'mkdir -p ~/MagicMirror/config ~/MagicMirror/modules/yp-slideshow ~/MagicMirror/modules/yp-oshical ~/MagicMirror/modules/yp-monthcal ~/MagicMirror/modules/yp-demoweather ~/MagicMirror/css ~/MagicMirror/samples'
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
	# playback.js は再生モードの状態機械。front と node_helper の両方が読むので必ず一緒に配る
	# （これだけ古いと、モード変更や末尾の挙動が画面とテストで食い違う）。
	scp -q "$MM/modules/yp-slideshow/yp-slideshow.js" "$MM/modules/yp-slideshow/node_helper.js" "$MM/modules/yp-slideshow/playback.js" "$MM/modules/yp-slideshow/yp-slideshow.css" "$HOST":'~/MagicMirror/modules/yp-slideshow/'
	scp -q "$MM/modules/yp-oshical/yp-oshical.js" "$MM/modules/yp-oshical/node_helper.js" "$MM/modules/yp-oshical/yp-oshical.css" "$HOST":'~/MagicMirror/modules/yp-oshical/'
	scp -q "$MM/modules/yp-monthcal/yp-monthcal.js" "$MM/modules/yp-monthcal/yp-monthcal.css" "$MM/modules/yp-monthcal/holidays.js" "$HOST":'~/MagicMirror/modules/yp-monthcal/'
	scp -q "$MM/modules/yp-demoweather/yp-demoweather.js" "$MM/modules/yp-demoweather/yp-demoweather.css" "$HOST":'~/MagicMirror/modules/yp-demoweather/'

	# デモモード（SIGNAGE_DEMO=true）が見る背景画像。MagicMirror のルート直下に置く。
	# モジュール側は global.root_path から samples/ を解決するので、この場所が前提になる。
	scp -q "$ROOT/samples/"*.jpg "$ROOT/samples/README.md" "$HOST":'~/MagicMirror/samples/'

	echo "yp-signage を $HOST へ配布完了"
}

case "${1:-signage}" in
	signage) deploy_signage ;;
	*) echo "不明なターゲット: $1（使えるのは signage）" >&2; exit 1 ;;
esac
