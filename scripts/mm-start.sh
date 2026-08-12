#!/bin/bash
# MagicMirror 起動（表示機の GNOME/XWayland 画面に表示）。
# ssh 越しに起動しても死なないよう、user の transient service として起動する。
#   従来の nohup 起動は、ssh セッション終了時に logind(KillUserProcesses=yes) が
#   セッションごと SIGTERM するため、起動直後に殺されていた。systemd-run --user で
#   ssh セッションの scope から切り離し、user manager 配下で常駐させる。
# 使い方: bash ~/run/mm-start.sh   （手元からは ssh <表示機> 'bash ~/run/mm-start.sh'）
# 一時上書き（任意）: 呼び出し側の環境変数を MM へ引き渡す。下の OVERRIDABLE に
# 載っている変数だけが対象で、それ以外は ~/MagicMirror/.env を書き換えて変える。
#   例: SIGNAGE_DEMO=true bash ~/run/mm-start.sh
#       SIGNAGE_OSHI_COLS=3 bash ~/run/mm-start.sh
# 指定された変数だけを渡すのが要点。空文字で渡すと「変数が存在する」扱いになり、
# 既存の環境変数を上書きしない process.loadEnvFile() の仕様で .env 側の値が読まれなくなる。
set -e

export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
DISPLAY_ID="${DISPLAY:-:0}"
XAUTH="$(ls /run/user/"$(id -u)"/.mutter-Xwaylandauth.* 2>/dev/null | head -1)"

# 既存を停止（サービス版・旧nohup版どちらも）
systemctl --user stop magicmirror.service 2>/dev/null || true
systemctl --user reset-failed magicmirror.service 2>/dev/null || true
pkill -f "js/electron.js" 2>/dev/null || true
sleep 1

# コマンド行で一時的に上書きできる変数。ここに足せば引き渡す対象が増える。
# 値が入っているものだけを渡す（空文字で渡さない。冒頭のコメント参照）。
# SIGNAGE_IMAGE_DIR と SIGNAGE_SLIDE_INTERVAL も渡せるようにしてある。少数の画像を入れた
# フォルダを短い間隔で回せば、末尾の挙動（最後で止まる・壊れ画像を飛ばす）を数十秒で確かめられる。
# 本番のフォルダ（数千枚・1枚60秒）では末尾まで送れないため、確認のたびにここが要る。
OVERRIDABLE=(SIGNAGE_DEMO SIGNAGE_OSHI_COLS SIGNAGE_OSHI_NOW SIGNAGE_ORDER_MODE SIGNAGE_REPEAT_MODE SIGNAGE_IMAGE_DIR SIGNAGE_SLIDE_INTERVAL SIGNAGE_LOG_PATH)
EXTRA_ENV=()
for v in "${OVERRIDABLE[@]}"; do
	if [ -n "${!v:-}" ]; then
		EXTRA_ENV+=(--setenv="$v=${!v}")
	fi
done

# Electron を X11(XWayland) 固定で常駐起動。WAYLAND_DISPLAY を空にして Wayland を掴ませない。
systemd-run --user \
	--unit=magicmirror \
	--description="MagicMirror signage" \
	--working-directory="$HOME/MagicMirror" \
	--setenv=DISPLAY="$DISPLAY_ID" \
	--setenv=XAUTHORITY="$XAUTH" \
	--setenv=WAYLAND_DISPLAY= \
	"${EXTRA_ENV[@]}" \
	"$HOME/MagicMirror/node_modules/.bin/electron" js/electron.js --ozone-platform=x11 --disable-http-cache

echo "MagicMirror起動（user service: magicmirror）"
echo "  ログ:   journalctl --user -u magicmirror -f"
echo "  状態:   systemctl --user status magicmirror"
echo "  止める: bash ~/run/mm-stop.sh"
