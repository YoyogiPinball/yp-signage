#!/bin/bash
# MagicMirror 起動（X13 の GNOME/XWayland 画面に表示）。
# ssh 越しに起動しても死なないよう、user の transient service として起動する。
#   従来の nohup 起動は、ssh セッション終了時に logind(KillUserProcesses=yes) が
#   セッションごと SIGTERM するため、起動直後に殺されていた。systemd-run --user で
#   ssh セッションの scope から切り離し、user manager 配下で常駐させる。
# 使い方: bash ~/run/mm-start.sh   （母艦からは ssh x13 'bash ~/run/mm-start.sh'）
# 表示切替（任意）: 呼び出し側の環境変数を MM へ引き渡す。
#   X13_COLS=3|4（予定の列数）   X13_OSHI_NOW=2026-07-19T06:00（デバッグ現在時刻）
#   例: X13_COLS=3 X13_OSHI_NOW=2026-07-19T06:00 bash ~/run/mm-start.sh
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

# Electron を X11(XWayland) 固定で常駐起動。WAYLAND_DISPLAY を空にして Wayland を掴ませない。
systemd-run --user \
	--unit=magicmirror \
	--description="MagicMirror signage (X13)" \
	--working-directory="$HOME/MagicMirror" \
	--setenv=DISPLAY="$DISPLAY_ID" \
	--setenv=XAUTHORITY="$XAUTH" \
	--setenv=WAYLAND_DISPLAY= \
	--setenv=X13_COLS="${X13_COLS:-}" \
	--setenv=X13_OSHI_NOW="${X13_OSHI_NOW:-}" \
	"$HOME/MagicMirror/node_modules/.bin/electron" js/electron.js --ozone-platform=x11 --disable-http-cache

echo "MagicMirror起動（user service: magicmirror）"
echo "  ログ:   journalctl --user -u magicmirror -f"
echo "  状態:   systemctl --user status magicmirror"
echo "  止める: bash ~/run/mm-stop.sh"
