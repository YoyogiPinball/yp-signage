#!/bin/bash
# Electron chrome-sandbox を root所有＋4755 に直す（初回・Electron再導入時のみ）
# 使い方: sudo bash ~/run/mm-fix-sandbox.sh
# sudo 実行でも実ユーザーの home を解決する（$HOME は root になるため使わない）
USER_HOME=$(getent passwd "${SUDO_USER:-$USER}" | cut -d: -f6)
SB="$USER_HOME/MagicMirror/node_modules/electron/dist/chrome-sandbox"
[ -f "$SB" ] || { echo "chrome-sandbox が見つからない: $SB"; exit 1; }
chown root:root "$SB"
chmod 4755 "$SB"
echo "修正完了: $(ls -l "$SB")"
