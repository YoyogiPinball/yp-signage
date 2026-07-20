> 最終更新: 2026-07-20（Mon）14:39

# x13 — ThinkPad X13 常時稼働サイネージ/サーバー

中古の ThinkPad X13 Gen1 (Ubuntu 26.04) を常時稼働のサイネージに転用するプロジェクト。
外部モニター (DP-2) を縦置きし、MagicMirror² v2.37 で時計、背景スライドショー、カレンダーを全画面表示する。

WSL 側ソース（正本）。ドキュメントは Obsidian `40-Projects/X13/`。

## ディレクトリ構成

このリポジトリの単位は「アプリ」ではなく「X13 という機械」。
X13 上で動くものは用途ごとにトップレベルのディレクトリを持ち、`deploy.sh` はその単位で配布する。

```
x13/
├── deploy.sh                  # WSL → X13 へ scp/ssh で配布。引数で用途を選ぶ
├── yp-signage/                # 用途: サイネージ表示 (yoyogipinball signage)
│   ├── magicmirror/
│   │   ├── config.js          # MM 設定（モジュール構成、Electron 窓位置）
│   │   ├── secrets.example.js # secrets.js のテンプレート
│   │   ├── secrets.js         # .gitignore 済み。iCal URL 等の秘密情報
│   │   ├── css/
│   │   │   └── custom.css     # 白文字、ソフト黒フチ、半透明プレート (.r5-plate)
│   │   └── modules/
│   │       ├── MMM-R5/        # 自作: 背景全画面スライドショー
│   │       ├── MMM-OshiCal/   # 自作: 推しスケの「今日の予定」2段カード
│   │       └── MMM-MonthCal/  # 自作: 月間カレンダー（祝日対応）
│   ├── scripts/               # X13 の ~/run/ へ配布する実行スクリプト
│   │   ├── mm-start.sh        # MM を systemd user service で起動
│   │   ├── mm-stop.sh         # MM を停止
│   │   └── mm-fix-sandbox.sh  # Electron chrome-sandbox の権限修正 (初回のみ)
│   └── legacy/                # 旧構成。配布対象外。MM が起動しない時の退避手段として保管
│       ├── r5.sh              # feh によるスライドショー
│       ├── signage-*.sh       # mpv によるスライドショー / Sway 版
│       ├── canvas.sh          # GNOME(Mutter) から外部モニタ解像度を取得
│       └── ext-canvas.py      # 同上の Sway 版（swaymsg の JSON を読む）
└── host/                      # X13 という機械そのものの設定（用途に依らない）
    ├── gnome/
    │   └── monitors.xml       # DP-2 縦固定のディスプレイ構成（手動適用）
    └── sway/
        └── config             # Sway 設定（GNOME からの移行検証用）
```

## 配布

```bash
./deploy.sh            # 既定は signage
./deploy.sh signage    # yp-signage/ 一式を X13 へ
```

配布先は `~/MagicMirror/` と `~/run/` で、リポジトリ側の再配置による影響は受けない。

> **Note:** 用途ごとに配布を分けているのは、無関係な変更で `config.js` を上書きしてしまうのを防ぐため。
> MagicMirror は設定を書き換えると再起動が必要になるので、一括配布のままだと別用途の1行修正でサイネージが巻き込まれて画面が落ちる。
> 用途を増やすときは `deploy.sh` に `deploy_<名前>()` を追加し、末尾の `case` に1行足す。

## 画面構成

2画面のマルチディスプレイ構成。

- **eDP-1** (内蔵): 作業用。横置き。GNOME primary。
- **DP-2** (外部 LG 22MP56): サイネージ用。縦置き (rotation: right = 270°)。1080×1920。

`host/gnome/monitors.xml` に「蓋オープン (2画面)」と「蓋クローズ (DP-2 単独)」の両構成を書き、DP-2 を論理原点 (0,0) に固定している。
蓋の開閉で回転や座標がぶれないようにするため。

## セットアップ

### X13 側の前提

- Ubuntu 26.04、GNOME (Wayland)、Node.js 24、npm
- MagicMirror² v2.37 が `~/MagicMirror/` にインストール済み
- `loginctl enable-linger <user>` 済み（ssh 切断後もユーザーサービスを維持）
- サイネージ用画像を `~/signage/r5/` に配置

### secrets の準備

```bash
cd magicmirror
cp secrets.example.js secrets.js
# secrets.js を編集し、calendarIcs に実際の iCal URL を書く
```

### 初回デプロイ

```bash
# WSL 側から
bash deploy.sh

# X13 側で Electron sandbox の権限修正（初回のみ・sudo）
ssh x13 'sudo bash ~/run/mm-fix-sandbox.sh'
```

### 起動と停止

```bash
# 起動（ssh 越しでも安全）
ssh x13 'bash ~/run/mm-start.sh'

# 停止
ssh x13 'bash ~/run/mm-stop.sh'

# ログ確認
ssh x13 'journalctl --user -u magicmirror -f'
```

`mm-start.sh` は `systemd-run --user` で transient service として起動する。
ssh セッションの scope から切り離されるため、ssh を切っても MM は生き続ける。

## MagicMirror モジュール

config.js で3つのモジュールを配置している。

### clock (組み込み)

右上に時計を表示。日付は `YYYY/MM/DD（dd）` 形式（dd は ja locale で漢字1文字の曜日）。
`classes: "r5-plate"` で半透明ぼかしプレートを敷く。

### MMM-R5 (自作: 背景スライドショー)

`position: "fullscreen_below"` で画面全体に画像を敷く。
node_helper が `~/signage/r5` の画像ファイルをスキャンし、Express の静的ルート `/MMM-R5/images` で配信する。
フロント側は URL 一覧を受け取り、60秒ごとにフェード切替（1200ms）でシャッフル巡回する。

対応拡張子: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`

### MMM-OshiCal (自作: 今日の予定カード)

推しスケ (oshi-sche-webapp) の iCal フィードを 5分ごとに取得し、今日の予定だけを抽出して2段カードで表示する。
左下に配置。`classes: "r5-plate"` で半透明プレート付き。

データ処理の流れ:

1. node_helper が iCal URL を fetch し、テキストを手動パース（外部ライブラリなし）
2. iCal の折り返し行（行頭スペース/タブ）を結合してから VEVENT を走査
3. DTSTART が UTC (`...Z`) なら JST (+9h) に変換、`VALUE=DATE` なら終日判定
4. 今日かつ未終了のイベントだけを抽出し、時刻順にソート（終日は末尾）
5. SUMMARY の `【推し名】予定タイトル` を正規表現で name と title に分解
6. フロントは CSS Grid (`grid-template-columns: auto 1fr`) で時刻バッジと本文を2カラムに並べる。auto 列が全行の最大幅に揃うため、時刻が縦一列にきれいに揃う。

## custom.css の設計

背景がスライドショー画像なので、その上に載る文字の可読性を確保する必要がある。

- `:root` の `--gap-body-*` を 20px に詰めて、パネルを画面の角に寄せる
- `.module` に `text-shadow` でソフトな黒フチ
- `.r5-plate` クラスで `backdrop-filter: blur(3px)` + 薄い黒背景の半透明プレート
- `.r5-plate` 内の全要素を `color: #fff` + `opacity: 1` に統一（MM 既定の灰色階調を上書き）
- `.MMM-R5` 自体は `text-shadow: none` で画像に影を載せない

## 配布 (deploy.sh)

`deploy.sh` は WSL 側のファイルを X13 の所定パスへ scp で転送する。

配布先の対応:

| ソース (WSL) | 配布先 (X13) |
|---|---|
| `yp-signage/scripts/*.sh` | `~/run/` |
| `yp-signage/magicmirror/config.js` | `~/MagicMirror/config/config.js` |
| `yp-signage/magicmirror/secrets.js` | `~/MagicMirror/config/secrets.js` |
| `yp-signage/magicmirror/css/custom.css` | `~/MagicMirror/css/custom.css` |
| `yp-signage/magicmirror/modules/MMM-R5/*` | `~/MagicMirror/modules/MMM-R5/` |
| `yp-signage/magicmirror/modules/MMM-OshiCal/*` | `~/MagicMirror/modules/MMM-OshiCal/` |
| `yp-signage/magicmirror/modules/MMM-MonthCal/*` | `~/MagicMirror/modules/MMM-MonthCal/` |

`yp-signage/legacy/` は配布対象外。X13 側に残っている旧 `~/r5.sh` や `~/run/signage-*.sh` は今後更新されない。

`host/gnome/monitors.xml` は GNOME が随時上書きするファイルなので、deploy.sh では配布しない。
変更したいときは手動で `~/.config/monitors.xml` にコピーする。

## 経緯メモ

旧構成では mpv や feh でスライドショーを流していた（`yp-signage/legacy/signage-start.sh`, `同 r5.sh`）。
MagicMirror² に移行して時計やカレンダーを重ねられるようにした。
Sway への移行も検討したが (`host/sway/config`)、現状は GNOME (Wayland) + XWayland 構成で安定稼働中。

## 接続情報

X13: 固定IP 192.168.x.x / user youruser / `ssh x13` 鍵認証済み。
