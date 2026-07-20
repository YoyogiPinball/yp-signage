#!/bin/bash
# サイネージ起動（mpv/XWayland経由・外部モニタ自動指定・回転対応・バックグラウンド）
# 使い方: bash ~/run/signage-start.sh [秒] [背景: blur|grey]
DELAY="${1:-60}"; BG="${2:-blur}"
command -v mpv >/dev/null 2>&1 || { echo "mpv未導入: sudo apt install -y mpv"; exit 1; }
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$(ls /run/user/$(id -u)/.mutter-Xwaylandauth.* 2>/dev/null | head -1)}"
pkill -x mpv 2>/dev/null; pkill -x feh 2>/dev/null

# 外部モニタ(eDP以外)の X11 ジオメトリと番号を取得（回転・位置を反映済み）
LINE=$(xrandr --listmonitors 2>/dev/null | grep -vi edp | grep -E '^[[:space:]]*[0-9]+:' | head -1)
GEO=$(echo "$LINE" | awk '{print $3}' | sed -E 's#/[0-9]+##g')      # WxH+X+Y
IDX=$(echo "$LINE" | grep -oE '^[[:space:]]*[0-9]+' | tr -dc '0-9')
[ -z "$GEO" ] && { GEO="1920x1080+0+0"; IDX=0; }
WH=${GEO%%+*}; W=${WH%x*}; H=${WH#*x}

COMMON=(--gpu-context=x11egl --geometry="$GEO" --fs-screen="$IDX" --fullscreen
        --image-display-duration="$DELAY" --loop-playlist=inf --shuffle
        --no-osc --no-audio --keepaspect=yes)

if [ "$BG" = "grey" ]; then
  nohup mpv "${COMMON[@]}" --background-color='#DDDDDD' "$HOME"/signage/r5/* >/tmp/signage.log 2>&1 &
else
  GRAPH="split[o][b];[b]scale=$W:$H:force_original_aspect_ratio=increase,crop=$W:$H,gblur=sigma=30[bg];[o]scale=$W:$H:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2"
  nohup mpv "${COMMON[@]}" --vf="lavfi=[$GRAPH]" "$HOME"/signage/r5/* >/tmp/signage.log 2>&1 &
fi
disown
echo "開始: 外部モニタ geo=$GEO (番号$IDX) canvas=${W}x${H} bg=$BG"
echo "止める: bash ~/run/signage-stop.sh   ログ: cat /tmp/signage.log"
