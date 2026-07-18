#!/bin/bash
# Sway用サイネージ: mpv全画面。出力割当(DP-2)と全画面化は sway config の for_window が担当。
DELAY="${1:-60}"; BG="${2:-blur}"
command -v mpv >/dev/null 2>&1 || { echo "mpv未導入"; exit 1; }
pkill -x mpv 2>/dev/null
CANVAS=$(swaymsg -t get_outputs 2>/dev/null | python3 "$HOME/run/ext-canvas.py")
CANVAS=${CANVAS:-1080x1920}
W=${CANVAS%x*}; H=${CANVAS#*x}
COMMON=(--fullscreen --image-display-duration="$DELAY" --loop-playlist=inf --shuffle
        --no-osc --no-audio --keepaspect=yes)
if [ "$BG" = "grey" ]; then
  mpv "${COMMON[@]}" --background-color='#DDDDDD' "$HOME"/signage/r5/* >/tmp/signage.log 2>&1 &
else
  GRAPH="split[o][b];[b]scale=$W:$H:force_original_aspect_ratio=increase,crop=$W:$H,gblur=sigma=30[bg];[o]scale=$W:$H:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2"
  mpv "${COMMON[@]}" --vf="lavfi=[$GRAPH]" "$HOME"/signage/r5/* >/tmp/signage.log 2>&1 &
fi
disown
