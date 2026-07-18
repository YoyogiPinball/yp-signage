#!/bin/bash
# feh をウィンドウ表示で起動（外部モニタへ動かして v キーで全画面化する用）
# 使い方: bash ~/run/signage-window.sh [秒]
feh --geometry 1280x720 --randomize --slideshow-delay "${1:-60}" --auto-zoom --hide-pointer "$HOME/signage/r5"
