#!/bin/bash
# ~/Batches/x13/scripts/ を X13 へ配布する（master → X13）
set -e
HOST=x13
D="$(cd "$(dirname "$0")" && pwd)/scripts"
scp -q "$D/r5.sh" "$HOST":'~/r5.sh'
ssh "$HOST" 'mkdir -p ~/run'
scp -q "$D/canvas.sh" "$D/signage-start.sh" "$D/signage-stop.sh" "$D/signage-window.sh" "$D/README.md" "$HOST":'~/run/'
ssh "$HOST" 'chmod +x ~/r5.sh ~/run/*.sh'
echo "X13へ配布完了"
