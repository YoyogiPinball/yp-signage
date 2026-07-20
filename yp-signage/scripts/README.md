> 最終更新: 2026-07-20（Mon）14:40

# ~/run — Claude が置く実行スクリプト置き場

母艦の Claude Code が「X13本体で実行してほしい」コマンドは、手打ちさせず
ここにスクリプトとして配置する運用（タイポ防止）。

- GUI や sudo が要るものは Claude が直接SSH実行できないため、
  ここに xxx.sh を置き、あなたは `bash ~/run/xxx.sh` の1行だけ打つ。
- サイネージの起動・停止は `mm-start.sh` / `mm-stop.sh`。
- 正本は WSL 側の `~/Batches/x13/yp-signage/scripts/`。ここを直接編集しても次の
  `deploy.sh signage` で上書きされる。
