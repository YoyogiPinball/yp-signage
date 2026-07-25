#!/usr/bin/env python3
"""
MagicMirror の現在表示（実画面）をキャプチャするヘルパースクリプト。
Mutter.ScreenCast D-Bus インターフェースを使用し、サイネージ出力先ディスプレイの
PipeWire ストリームから 1 フレームを抽出して PNG 保存する。

出力先のコネクタ名は決め打ちにせず、Mutter.DisplayConfig に毎回問い合わせて決める
(detect_connector を参照)。ケーブルを挿し替えるとコネクタ名は変わるため
(実績: DP-2 想定だったが実機は HDMI-2 だった)、固定で持つと挿し替えのたびに撮れなくなる。
SHOT_CONNECTOR 環境変数を与えた場合はその名前を優先する。
"""

import sys
import os
import glob
import shutil
import tempfile
import subprocess
from gi.repository import GLib, Gio

def detect_connector(bus):
    """サイネージ出力先のコネクタ名を Mutter に問い合わせて決める。

    GetCurrentState は「今 Mutter が有効にしているモニタ」を返すので、抜けている
    コネクタや無効化された内蔵パネルは最初から候補に入らない。そこから
    1) 内蔵パネル (is-builtin) を除いた外部モニタ
    2) 論理原点 (0,0) に置かれているもの
    の順に優先して1つ選ぶ。サイネージ側は monitors.xml で原点固定しているため、
    外部モニタが複数あってもサイネージ用が選ばれる。
    """
    forced = os.environ.get("SHOT_CONNECTOR")
    if forced:
        return forced

    display_config = Gio.DBusProxy.new_sync(
        bus, Gio.DBusProxyFlags.NONE, None,
        "org.gnome.Mutter.DisplayConfig", "/org/gnome/Mutter/DisplayConfig",
        "org.gnome.Mutter.DisplayConfig", None
    )
    _serial, monitors, logical_monitors, _props = display_config.call_sync(
        "GetCurrentState", None, Gio.DBusCallFlags.NONE, -1, None
    ).unpack()

    # monitors: ((connector, vendor, product, serial), modes, properties)
    builtin = {m[0][0] for m in monitors if m[2].get("is-builtin", False)}

    # logical_monitors: (x, y, scale, transform, primary, [(connector, ...)], properties)
    candidates = [
        (conn[0], x, y)
        for x, y, _scale, _transform, _primary, conns, _p in logical_monitors
        for conn in conns
    ]
    if not candidates:
        print("Error: Mutter が有効なモニタを返しませんでした", file=sys.stderr)
        sys.exit(1)

    external = [c for c in candidates if c[0] not in builtin]
    pool = external or candidates
    # 原点(0,0)にあるものを先頭へ
    pool.sort(key=lambda c: (c[1], c[2]) != (0, 0))
    return pool[0][0]


def capture_screen():
    out_png = os.environ.get("SHOT_OUT", "/tmp/mm-shot.png")
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)

    # 1. ScreenCast Proxy
    screencast = Gio.DBusProxy.new_sync(
        bus, Gio.DBusProxyFlags.NONE, None,
        "org.gnome.Mutter.ScreenCast", "/org/gnome/Mutter/ScreenCast",
        "org.gnome.Mutter.ScreenCast", None
    )

    # 2. CreateSession
    session_path = screencast.call_sync(
        "CreateSession", GLib.Variant("(a{sv})", ({},)),
        Gio.DBusCallFlags.NONE, -1, None
    ).unpack()[0]

    session = Gio.DBusProxy.new_sync(
        bus, Gio.DBusProxyFlags.NONE, None,
        "org.gnome.Mutter.ScreenCast", session_path,
        "org.gnome.Mutter.ScreenCast.Session", None
    )

    # 3. RecordMonitor (対象コネクタは Mutter への問い合わせで決める)
    connector = detect_connector(bus)
    try:
        stream_path = session.call_sync(
            "RecordMonitor", GLib.Variant("(sa{sv})", (connector, {})),
            Gio.DBusCallFlags.NONE, -1, None
        ).unpack()[0]
    except Exception as e:
        session.call_sync("Stop", None, Gio.DBusCallFlags.NONE, -1, None)
        print(f"Error: モニタ {connector} の録画を開始できません: {e}", file=sys.stderr)
        sys.exit(1)

    stream = Gio.DBusProxy.new_sync(
        bus, Gio.DBusProxyFlags.NONE, None,
        "org.gnome.Mutter.ScreenCast", stream_path,
        "org.gnome.Mutter.ScreenCast.Stream", None
    )

    node_id = None
    loop = GLib.MainLoop()

    def on_stream_signal(proxy, sender_name, signal_name, parameters):
        nonlocal node_id
        if signal_name == "PipeWireStreamAdded":
            node_id = parameters.unpack()[0]
            loop.quit()

    stream.connect("g-signal", on_stream_signal)

    # 4. Start Session
    session.call_sync("Start", None, Gio.DBusCallFlags.NONE, -1, None)

    def on_timeout():
        loop.quit()
        return False

    GLib.timeout_add_seconds(10, on_timeout)
    loop.run()

    if not node_id:
        session.call_sync("Stop", None, Gio.DBusCallFlags.NONE, -1, None)
        print("Error: Could not obtain PipeWire node_id for ScreenCast", file=sys.stderr)
        sys.exit(1)

    # 5. GStreamer パイプライン実行
    # 初回フレームは未描画（真っ白）になり得るため num-buffers=5 で数枚流し、
    # ウォームアップ後の最後の1枚だけを採用する。単一 filesink だと全フレームが
    # 1ファイルに連結され肥大するため、multifilesink で連番出力して末尾を選ぶ。
    tmpdir = tempfile.mkdtemp(prefix="mm-shot-")
    frame_pattern = os.path.join(tmpdir, "frame_%02d.png")
    gst_cmd = [
        "gst-launch-1.0",
        "-q",
        "pipewiresrc", f"path={node_id}", "num-buffers=5",
        "!", "videoconvert",
        "!", "pngenc",
        "!", "multifilesink", f"location={frame_pattern}"
    ]

    try:
        res = subprocess.run(gst_cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"GStreamer capture failed: {res.stderr}", file=sys.stderr)
            sys.exit(1)
        frames = sorted(glob.glob(os.path.join(tmpdir, "frame_*.png")))
        if not frames:
            print("Error: No frame captured from ScreenCast", file=sys.stderr)
            sys.exit(1)
        shutil.move(frames[-1], out_png)  # 最後の1枚だけ採用
    finally:
        session.call_sync("Stop", None, Gio.DBusCallFlags.NONE, -1, None)
        shutil.rmtree(tmpdir, ignore_errors=True)

    if not os.path.exists(out_png) or os.path.getsize(out_png) == 0:
        print(f"Error: Generated image {out_png} is empty or missing", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    capture_screen()
