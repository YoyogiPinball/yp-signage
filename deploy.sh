#!/bin/bash
# yp-signage を表示機へ配布する（手元の作業コピー → 表示機）
#
# 使い方: ./deploy.sh [ターゲット]
#   signage : MagicMirror 設定・自作モジュール・起動スクリプト一式 ※既定
#
# 配布先は ssh の設定名（~/.ssh/config の Host 名）で指定する。鍵認証を通しておくこと。
# 毎回書かずに済ませたいときは signage.conf に置く（gitignore 済み。ひな形は signage.conf.example）。
#   SIGNAGE_HOST=mysignage ./deploy.sh
# 表示機と操作元が同じ PC なら local を指定する（ssh を使わずにコピーする）。
#   SIGNAGE_HOST=local ./deploy.sh
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
	echo "  表示機と操作元が同じ PC なら、ssh の設定名の代わりに local と書く" >&2
	exit 1
fi

# 表示機で実行する・表示機へ置く。local は表示機と操作元が同じ PC の場合で、ssh を使わずに済ませる。
# 置き先は表示機のホームから見たパスを '~/...' のまま受け取る（ssh 先で展開させるのと同じ扱い）。
if [ "$HOST" = "local" ]; then
	on_host() { bash -c "$1"; }
	put() {
		local dst="${*: -1}"
		cp "${@:1:$#-1}" "${dst/#\~/$HOME}"
	}
else
	on_host() { ssh "$HOST" "$1"; }
	put() {
		local dst="${*: -1}"
		scp -q "${@:1:$#-1}" "$HOST:$dst"
	}
fi

deploy_signage() {
	local D="$ROOT/scripts"
	local MM="$ROOT/magicmirror"

	# --- 起動・停止スクリプト ---
	on_host 'mkdir -p ~/run'
	put "$D/mm-start.sh" "$D/mm-display.sh" "$D/mm-placement.sh" "$D/mm-placement.js" "$D/mm-stop.sh" "$D/mm-ctl.sh" "$D/mm-fix-sandbox.sh" "$D/mm-shot.sh" "$D/mm-shot.py" "$D/mm-shot.js" "$D/signage-display-on.sh" "$D/README.md" '~/run/'
	on_host 'chmod +x ~/run/*.sh ~/run/*.py'

	# --- MagicMirror 設定・モジュール ---
	on_host 'mkdir -p ~/MagicMirror/config ~/MagicMirror/modules/yp-slideshow ~/MagicMirror/modules/yp-oshical ~/MagicMirror/modules/yp-monthcal ~/MagicMirror/modules/yp-demoweather ~/MagicMirror/modules/yp-quit-on-close ~/MagicMirror/css ~/MagicMirror/samples'
	put "$MM/config.js" '~/MagicMirror/config/config.js'
	put "$MM/css/custom.css" '~/MagicMirror/css/custom.css'
	# 設定値と秘密情報の .env は表示機側だけに置き、配布では上書きしない。
	# 倍率や出力先のように表示機ごとに決まる値を持つため、手元の写しで消さない。
	# 無いときだけひな形を置く。config.js は process.loadEnvFile() で「カレントディレクトリの .env」を
	# 読むため、config/ ではなく MagicMirror のルートへ置く（MM は自身のルートを cwd にして起動する）。
	# 有無の確認と書き込みを表示機側の1回の実行で済ませ、接続の失敗を「.env が無い」と取り違えない。
	on_host 'if [ -e ~/MagicMirror/.env ]; then
			echo "  ~/MagicMirror/.env は表示機側の内容を残しました"
		else
			cat > ~/MagicMirror/.env
			echo "  ~/MagicMirror/.env が無かったのでひな形を置きました。表示機で中身を書いてください"
		fi' < "$MM/.env.example"
	# playback.js は再生モードの状態機械。front と node_helper の両方が読むので必ず一緒に配る
	# （これだけ古いと、モード変更や末尾の挙動が画面とテストで食い違う）。
	put "$MM/modules/yp-slideshow/yp-slideshow.js" "$MM/modules/yp-slideshow/node_helper.js" "$MM/modules/yp-slideshow/playback.js" "$MM/modules/yp-slideshow/yp-slideshow.css" '~/MagicMirror/modules/yp-slideshow/'
	put "$MM/modules/yp-oshical/yp-oshical.js" "$MM/modules/yp-oshical/node_helper.js" "$MM/modules/yp-oshical/yp-oshical.css" '~/MagicMirror/modules/yp-oshical/'
	put "$MM/modules/yp-monthcal/yp-monthcal.js" "$MM/modules/yp-monthcal/yp-monthcal.css" "$MM/modules/yp-monthcal/holidays.js" '~/MagicMirror/modules/yp-monthcal/'
	put "$MM/modules/yp-demoweather/yp-demoweather.js" "$MM/modules/yp-demoweather/yp-demoweather.css" '~/MagicMirror/modules/yp-demoweather/'
	put "$MM/modules/yp-quit-on-close/yp-quit-on-close.js" "$MM/modules/yp-quit-on-close/node_helper.js" '~/MagicMirror/modules/yp-quit-on-close/'

	# デモモード（SIGNAGE_DEMO=true）が見る背景画像。MagicMirror のルート直下に置く。
	# モジュール側は global.root_path から samples/ を解決するので、この場所が前提になる。
	put "$ROOT/samples/"*.jpg "$ROOT/samples/README.md" '~/MagicMirror/samples/'

	# --- 画面タイマー・リモコン（常駐サービス） ---
	# フォルダ単位で送る。ファイルを1つ足すたびにここを直すと、配り忘れで
	# 「配布したのに動きが変わらない」という分かりにくい壊れ方になる。
	on_host 'mkdir -p ~/run/signage-timer ~/.config/systemd/user'
	put "$D/signage-timer/"* '~/run/signage-timer/'
	put "$ROOT/host/systemd/signage-timer.service" '~/.config/systemd/user/signage-timer.service'
	# 同じ PC で使うときは画面の点灯・消灯を既定で切る。Mutter の PowerSaveMode は全画面に効き、
	# 作業中のモニターまで消えるため。timer.env に書いた値はこれより優先される（EnvironmentFile= が勝つ）。
	if [ "$HOST" = "local" ]; then
		on_host 'mkdir -p ~/.config/systemd/user/signage-timer.service.d
			printf "[Service]\nEnvironment=SIGNAGE_DISPLAY_CONTROL=false\n" > ~/.config/systemd/user/signage-timer.service.d/local.conf'
	else
		on_host 'rm -f ~/.config/systemd/user/signage-timer.service.d/local.conf'
	fi
	# ユニットを置き換えたら読み直させる。動いている最中なら入れ替える。
	# 同じ PC で使うときは画面を消さないので、リモコンとして常駐を有効にする。
	# 別の表示機では予定どおり画面を消し始めるため、有効化していなければ触らない。
	on_host 'systemctl --user daemon-reload'
	if [ "$HOST" = "local" ]; then
		on_host 'systemctl --user enable --quiet signage-timer.service'
	fi
	on_host 'if systemctl --user is-enabled --quiet signage-timer.service 2>/dev/null; then
			systemctl --user restart signage-timer.service
			echo "  画面タイマーを入れ替えました"
		else
			echo "  画面タイマーは未設定です。使うなら表示機で: systemctl --user enable --now signage-timer"
		fi'

	# --- 窓の位置の監視（常駐サービス） ---
	# 窓が外れたときに出し直すだけで画面の点灯は変えないので、配布先を問わず有効にする。
	on_host 'mkdir -p ~/.config/systemd/user'
	put "$ROOT/host/systemd/signage-placement.service" '~/.config/systemd/user/signage-placement.service'
	on_host 'systemctl --user daemon-reload
		systemctl --user enable --quiet signage-placement.service
		systemctl --user restart signage-placement.service'
	echo "  窓の位置の監視を入れ替えました"

	# --- アプリ一覧のアイコン（同じ PC で使うときだけ） ---
	# 押すと起動、右クリックで停止と操作盤。表示機を別に置くときは、そこで操作する人がいないので置かない。
	if [ "$HOST" = "local" ]; then
		on_host 'mkdir -p ~/.local/share/applications ~/.local/share/icons/hicolor/256x256/apps'
		put "$ROOT/host/desktop/yp-signage.desktop" '~/.local/share/applications/yp-signage.desktop'
		put "$ROOT/host/desktop/yp-signage.png" '~/.local/share/icons/hicolor/256x256/apps/yp-signage.png'
		# 索引ファイル icon-theme.cache が既にあると、GNOME はそれだけを見て足したアイコンを見つけない。
		on_host 'if [ -e ~/.local/share/icons/hicolor/icon-theme.cache ]; then
				gtk-update-icon-cache -q -f -t ~/.local/share/icons/hicolor || true
			fi'
		echo "  アプリ一覧に yp-signage を置きました"
	fi

	echo "yp-signage を $HOST へ配布完了"
}

case "${1:-signage}" in
	signage) deploy_signage ;;
	*) echo "不明なターゲット: $1（使えるのは signage）" >&2; exit 1 ;;
esac
