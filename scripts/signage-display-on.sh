#!/bin/bash
# 「つけるまで消す」を、表示機自身から明示的に解除する。
set -euo pipefail

ENV_FILE="${SIGNAGE_TIMER_ENV:-$HOME/.config/yp-signage/timer.env}"
if [ -r "$ENV_FILE" ]; then
	set -a
	# shellcheck source=/dev/null
	. "$ENV_FILE"
	set +a
fi

PORT="${SIGNAGE_TIMER_PORT:-8081}"
HEADERS=()
if [ -n "${SIGNAGE_TIMER_USER:-}" ]; then
	HEADERS=(-H "Tailscale-User-Login: $SIGNAGE_TIMER_USER")
fi

curl -fsS --max-time 5 -o /dev/null -X POST \
	"${HEADERS[@]}" \
	"http://127.0.0.1:${PORT}/api/display/on"
echo "画面の点灯を要求しました"
