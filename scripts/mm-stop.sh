#!/bin/bash
# MagicMirror 停止（systemd-run 版・旧nohup版どちらも止める）
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
systemctl --user stop magicmirror.service 2>/dev/null || true
systemctl --user reset-failed magicmirror.service 2>/dev/null || true
pkill -f "js/electron.js" 2>/dev/null || true
echo "MagicMirror停止"
