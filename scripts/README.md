> 最終更新: 2026-08-07（Fri）00:30

# ~/run — 表示機側に置く実行スクリプト

このフォルダの中身は `deploy.sh` が表示機の `~/run/` へ配布する。表示機で操作するときは、
長いコマンドを手で打たずに `bash ~/run/xxx.sh` の1行で済ませるための置き場である。

| スクリプト | 何をするか |
|---|---|
| `mm-start.sh` | MagicMirror を起動する。ssh 越しに起動しても死なないよう `systemd-run --user` で常駐させる |
| `mm-stop.sh` | 停止する |
| `mm-ctl.sh` | スライドショーを操作する（下記） |
| `mm-shot.sh` | 実際に映っている画面を1枚 PNG に撮る（`mm-shot.py` が実体） |
| `mm-fix-sandbox.sh` | Electron の sandbox 権限を直す。初回のみ・sudo が要る |

## スライドショーの操作

```bash
bash ~/run/mm-ctl.sh {pause|resume|toggle|next|prev|topbar}
bash ~/run/mm-ctl.sh plate {0-100|reset}
```

`pause` / `resume` / `toggle` は自動送りの一時停止と再開、`next` / `prev` は手動の前後送り、
`topbar` は上バーの半透明プレートの表示切替。手元からは
`ssh <表示機> 'bash ~/run/mm-ctl.sh next'` のように叩ける。

`mm-ctl.sh plate` は時計の背景プレートの濃さを、画面を見ながら変えるためのもの。

```bash
bash ~/run/mm-ctl.sh plate 45     # 45% の濃さにする
bash ~/run/mm-ctl.sh plate reset  # custom.css の既定へ戻す
```

MagicMirror を再起動せずその場で反映される代わりに、再起動すると既定へ戻る。
気に入った濃さが決まったら、配布元の `magicmirror/css/custom.css` にある
`--clock-plate-alpha`（`:root` に置いた 0〜1 の値）へ書き戻して `./deploy.sh` する。
`plate 45` を実行したときに、書き戻す値がメッセージに出る。

`mm-ctl.sh blink` は、配信開始時の点滅を待たずに手で起こす確認用。配信予定バーの先頭
（左上の時刻付きの枠）を本番と同じ60秒だけ光らせる。本番の発火予定は消さないので、
その予定は開始時刻にもう一度光る。`blink 3` のように光り方（1〜5）を指定できる。

> **Note:** ここを直接編集しても、次の `deploy.sh signage` で上書きされる。
> 変更は配布元のリポジトリ側（`scripts/`）で行う。
