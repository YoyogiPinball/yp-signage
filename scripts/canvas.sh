#!/bin/bash
# 外部モニタ(eDP以外)の「現在の向きを反映した解像度」を WxH で出す。無ければ内蔵→既定。
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus
python3 - <<'PY'
import gi
gi.require_version('Gio','2.0')
from gi.repository import Gio
bus=Gio.bus_get_sync(Gio.BusType.SESSION,None)
res=bus.call_sync('org.gnome.Mutter.DisplayConfig','/org/gnome/Mutter/DisplayConfig',
  'org.gnome.Mutter.DisplayConfig','GetCurrentState',None,None,Gio.DBusCallFlags.NONE,-1,None)
serial,monitors,logical,props=res.unpack()
cur={}
for spec,modes,mp in monitors:
    conn=spec[0]
    for m in modes:
        mid,w,h,rate,ps,scales,mprops=m
        if mprops.get('is-current'): cur[conn]=(w,h)
ext=internal=None
for lm in logical:
    x,y,scale,transform,primary,mons,lp=lm
    for mon in mons:
        conn=mon[0]
        w,h=cur.get(conn,(1920,1080))
        rot = transform in (1,3)
        if rot: w,h=h,w
        tag=f"{conn} transform={transform} {'縦' if rot else '横'} -> {w}x{h} (primary={primary})"
        if conn.startswith('eDP'): internal=(w,h); ei=tag
        else: ext=(w,h); et=tag
import sys
if ext: print("EXT:", et, file=sys.stderr)
if internal: print("INT:", ei, file=sys.stderr)
w,h = ext or internal or (1920,1080)
print(f"{w}x{h}")
PY
