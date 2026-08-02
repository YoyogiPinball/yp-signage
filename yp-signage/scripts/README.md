> 最終更新: 2026-08-02（Sun）22:05

# ~/run — Claude が置く実行スクリプト置き場

母艦の Claude Code が「X13本体で実行してほしい」コマンドは、手打ちさせず
ここにスクリプトとして配置する運用（タイポ防止）。

- GUI や sudo が要るものは Claude が直接SSH実行できないため、
  ここに xxx.sh を置き、あなたは `bash ~/run/xxx.sh` の1行だけ打つ。
- サイネージの起動・停止は `mm-start.sh` / `mm-stop.sh`。
- スライドショー操作は `mm-ctl.sh {pause|resume|toggle|next|prev|topbar}`（一時停止・再開・前後送り・上バーの板 表示切替）。
- `mm-ctl.sh blink` は配信開始時の点滅を手で起こす確認用。配信予定バーの先頭（左上の時刻付きの枠）を本番と同じ60秒だけ光らせる。本番の発火予定は消さないので、その予定は開始時刻にもう一度光る。
- 正本は WSL 側の `~/Batches/x13/yp-signage/scripts/`。ここを直接編集しても次の
  `deploy.sh signage` で上書きされる。
