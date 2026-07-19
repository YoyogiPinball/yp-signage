#!/bin/bash
# ~/Batches/x13/ を X13 へ配布する（master → X13）
set -e
HOST=x13
ROOT="$(cd "$(dirname "$0")" && pwd)"
D="$ROOT/scripts"
MM="$ROOT/magicmirror"

# --- scripts（サイネージ再生系） ---
scp -q "$D/r5.sh" "$HOST":'~/r5.sh'
ssh "$HOST" 'mkdir -p ~/run'
scp -q "$D/canvas.sh" "$D/signage-start.sh" "$D/signage-stop.sh" "$D/signage-window.sh" \
	"$D/mm-start.sh" "$D/mm-stop.sh" "$D/mm-fix-sandbox.sh" "$D/README.md" "$HOST":'~/run/'
ssh "$HOST" 'chmod +x ~/r5.sh ~/run/*.sh'

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

echo "X13へ配布完了"
