#!/bin/bash
# サイネージ再生（r5フォルダをシャッフル全画面）
# 使い方:
#   bash ~/r5.sh          # 60秒ごと・既定モニタ
#   bash ~/r5.sh 5        # 5秒ごと・既定モニタ（確認用）
#   bash ~/r5.sh 60 1     # 60秒ごと・2番目のモニタ(HDMI)に表示
#   bash ~/r5.sh 60 0     # 60秒ごと・1番目のモニタ(ノート画面)に表示
# 終了: q または Esc
DELAY="${1:-60}"
SCREEN="${2:-}"
ARGS=(--fullscreen --randomize --slideshow-delay "$DELAY" --auto-zoom --hide-pointer)
[ -n "$SCREEN" ] && ARGS+=(--xinerama-index "$SCREEN")
exec feh "${ARGS[@]}" "$HOME/signage/r5"
