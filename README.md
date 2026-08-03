> 最終更新: 2026-08-04（Tue）00:52

# yp-signage — ThinkPad X13 の縦置きサイネージ

中古の ThinkPad X13 Gen1 (Ubuntu 26.04) を常時稼働のサイネージに転用するプロジェクト。
外部モニターを縦置きし、MagicMirror² v2.37 で時計、背景スライドショー、カレンダーを全画面表示する。

WSL 側ソース（正本）。サイネージのドキュメントは Obsidian `40-Projects/YP-Signage/`、
機械（X13）そのもののスペック・セットアップは `40-Projects/X13/`。

## ディレクトリ構成

```
yp-signage/
├── deploy.sh              # WSL → X13 へ scp/ssh で配布
├── sync-images.sh         # WSL → X13 へ画像を同期。1日1回 systemd timer が起動
├── magicmirror/
│   ├── config.js          # MM 設定（モジュール構成、Electron 窓位置）
│   ├── .env.example       # .env のテンプレート
│   ├── .env               # .gitignore 済み。iCal URL 等の秘密情報と環境ごとの設定値
│   ├── css/
│   │   └── custom.css     # 白文字、ソフト黒フチ、半透明プレート (.r5-plate)
│   └── modules/
│       ├── MMM-R5/        # 自作: 背景全画面スライドショー
│       ├── MMM-OshiCal/   # 自作: 推しスケの配信予定バー（今日→先の日へ）
│       └── MMM-MonthCal/  # 自作: 月間カレンダー（祝日対応）
├── scripts/               # X13 の ~/run/ へ配布する実行スクリプト
│   ├── mm-start.sh        # MM を systemd user service で起動
│   ├── mm-stop.sh         # MM を停止
│   ├── mm-ctl.sh          # スライド送り・一時停止・点滅テスト
│   ├── mm-fix-sandbox.sh  # Electron chrome-sandbox の権限修正 (初回のみ)
│   ├── mm-shot.sh         # 現在表示を1枚 PNG に撮る（~/signage/shots/ へ）
│   ├── mm-shot.py         # mm-shot.sh が使う Mutter ScreenCast キャプチャ本体
│   ├── mm-shot.js         # 旧方式（Electron で開き直す）。現在は未使用だが配布はされる
│   └── README.md          # ~/run/ の説明（X13 側に置かれる）
├── legacy/                # 旧構成。配布対象外。MM が起動しない時の退避手段として保管
│   ├── r5.sh              # feh によるスライドショー
│   ├── signage-*.sh       # mpv によるスライドショー / Sway 版
│   ├── canvas.sh          # GNOME(Mutter) から外部モニタ解像度を取得
│   └── ext-canvas.py      # 同上の Sway 版（swaymsg の JSON を読む）
└── host/
    └── monitors.xml       # 外部モニタ縦固定のディスプレイ構成（実機の写し。配布しない）
```

## 配布

```bash
./deploy.sh            # 既定は signage
./deploy.sh signage    # 一式を X13 へ
```

配布先は `~/MagicMirror/` と `~/run/` で、リポジトリ側の再配置による影響は受けない。

> **Note:** ターゲット式を残しているのは、配布単位を分けたくなったときに `deploy_<名前>()` を1つ足すだけで済むようにするため。
> MagicMirror は設定を書き換えると再起動が必要になるので、一括配布のままだと別用途の1行修正でサイネージが巻き込まれて画面が落ちる。
> 用途を増やすときは `deploy.sh` に `deploy_<名前>()` を追加し、末尾の `case` に1行足す。

## 画面構成

2画面のマルチディスプレイ構成。

- **eDP-1** (内蔵): 作業用。横置き。蓋オープン時は縦モニタの下 (117, 1920) に置かれる。
- **外部 LG 22MP56**: サイネージ用。縦置き (rotation: right = 270°)。1080×1920。

`host/monitors.xml` に「蓋オープン (2画面)」と「蓋クローズ (外部単独)」の両構成を書き、外部モニタを論理原点 (0,0) に固定している。
蓋の開閉で回転や座標がぶれないようにするため。

> **Warning:** 外部モニタのコネクタ名を決め打ちにしないこと。ケーブルを挿し替えると変わる。
> 2026-07-25 の実測では `HDMI-A-2` (mutter 上の表記は `HDMI-2`) で、`DP-1` / `DP-2` はどちらも未接続だった。
> それ以前の資料は `DP-2` と書いており、実機と食い違ったまま残っていた。現在の接続はこう確認する。
>
> ```bash
> ssh x13 'for c in /sys/class/drm/card*-*/status; do printf "%s: %s\n" "$(basename $(dirname $c))" "$(cat $c)"; done'
> ```
>
> スクリーンショット取得 (`mm-shot.py`) は Mutter に問い合わせて出力先を自動判定するため、挿し替えても修正は要らない。

## セットアップ

### X13 側の前提

- Ubuntu 26.04、GNOME (Wayland)、Node.js 24、npm
- MagicMirror² v2.37 が `~/MagicMirror/` にインストール済み
- `loginctl enable-linger <user>` 済み（ssh 切断後もユーザーサービスを維持）
- サイネージ用画像を `~/signage/slides/` 以下に配置（`sync-images.sh` が自動で置く。後述）

### .env の準備

秘密情報（iCal URL・API キー）と、環境ごとに変わる設定値（モニターの解像度・表示秒数など）は
`.env` にまとめてある。`config.js` を開かずにこのファイルだけで設定を変えられる。

```bash
cd magicmirror
cp .env.example .env
# .env を編集し、SIGNAGE_CALENDAR_ICS に実際の iCal URL を書く
```

書式は `KEY=値` だけで、引用符もカンマも要らない。1行書き損じてもその項目が既定値に落ちるだけで、
他の設定は生き残る。項目の一覧と意味は `.env.example` のコメントを参照。

配布先では `~/MagicMirror/.env`（`config/` ではなく MagicMirror のルート）に置く。
`config.js` が `process.loadEnvFile()` で「カレントディレクトリの `.env`」を読むためで、
置き場所を間違えると全項目が既定値に落ちる。

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

### 画面のスクショを撮る

母艦から X13 のサイネージ表示を1枚 PNG に撮れる。実際に映っている画面をそのまま取るので、
実機で見えているとおりの絵が得られる。

```bash
ssh x13 'bash ~/run/mm-shot.sh'   # ~/signage/shots/<yyyymmddhhmmss>.png に保存

# 出力先を指定する
ssh x13 'SHOT_OUT=~/signage/shots/x.png bash ~/run/mm-shot.sh'
# 特定のモニタを狙う（既定は Mutter に問い合わせて自動判定）
ssh x13 'SHOT_CONNECTOR=HDMI-2 bash ~/run/mm-shot.sh'
```

> **Note:** GNOME (Wayland) の D-Bus スクショは新しめの GNOME で拒否され、XWayland の X11 root grab は
> 合成後の画面が入らず真っ黒になる。どちらも使えないため、`mm-shot.sh` は `mm-shot.py` を呼び、
> Mutter の ScreenCast を D-Bus 経由で開始して、実画面の PipeWire ストリームから1フレームだけ取る。
> どのモニタを撮るかは毎回 `Mutter.DisplayConfig` に問い合わせるので、ケーブルを挿し替えても直す必要がない。

> **Note:** `scripts/mm-shot.js` は Electron で `localhost:8080` を隠しウィンドウで開き直す**旧方式**。
> 現在の `mm-shot.sh` からは呼ばれていないが、配布対象には残っている（`SHOT_WAIT` はこちらの環境変数）。

## 画像同期 (sync-images.sh)

サイネージに映す画像の正本は Windows の `D:` にあり、X13 側はその鏡でしかない。
`sync-images.sh` は WSL 上で動き、差分だけを X13 へ送る。元で消えた画像は X13 からも取り除く。

```
D:\photos\_SYNC\r5\                 →  X13: ~/signage/slides/r5/
D:\...\tate\portrait\             →  X13: ~/signage/slides/tate/
消えた画像                            →  X13: ~/signage/.trash/<日付>/<フォルダ名>/
```

同期ペアを増やすときは、スクリプト冒頭の `PAIRS` に「元パス|X13 側のフォルダ名」を1行足すだけでよい。

```bash
./sync-images.sh --dry-run   # 何が転送・削除されるかだけ表示する
./sync-images.sh             # 実行
```

### 自動実行

WSL の systemd user timer が毎日 4:00 に起動する。ユニットは WSL 側の `~/.config/systemd/user/` にあり、
リポジトリには含まれない（X13 ではなく母艦の設定のため）。

> **Warning:** ユニットの `ExecStart` はこのリポジトリのパスを**絶対パスで直書き**している。
> リポジトリを移動・改称すると、タイマーは今までどおり発火するのにスクリプトが見つからず失敗する。
> 画面は正常に動き続けるので、写真が増えないことに気づくまで数日かかる。
> 移動したら `~/.config/systemd/user/x13-sync-images.service` の `ExecStart` と `Documentation` を
> 直し、`systemctl --user daemon-reload` してから手動で1回走らせて確認する。
> （2026-08-03 の `x13` → `yp-signage` 改称で実際に踏みかけた）

```bash
systemctl --user list-timers x13-sync-images   # 次回実行時刻
systemctl --user start x13-sync-images.service # 手動起動
tail ~/.local/state/x13/sync-images.log        # 実行記録
```

`Persistent=true` を付けてあるので、4:00 に PC が落ちていても、次に WSL が起動した直後に取り戻す。
cron だとその日の分は実行されずに飛ぶ。

> **Note:** 実行記録の正本は `~/.local/state/x13/sync-images.log`。journal には開始と終了しか残らない。
> この環境の journald は短命サービスの標準出力を取りこぼし、「一部の行だけ残る」記録になって
> 誤読を招くため、意図的に stdout へ流していない（異常時のみ stderr に出す）。

### rsync の判定条件

意図して選んだオプションが2つある。どちらも外すと毎回 3GB を再転送する羽目になる。

- **`-rt`（`-a` ではなく）** — `-a` に含まれる権限・所有者のコピーは、Windows のドライブ相手には意味がない。
  WSL から見た `D:` のファイルは全部が同じ偽の権限値で、それを Linux 側へ持ち込むと毎回「権限が違う」と判定される。
- **`--size-only`** — サイズが同じなら同一とみなす。過去に手動コピーした約1,800枚は更新時刻が壊れており、
  時刻で比較すると中身が同じファイルを毎晩送り直すことになる。
  引き換えに「バイト数が同一の別画像への差し替え」は検知できないが、画像は追加・削除されるもので
  中身が書き換わるものではないため実害はない。

初回に `--size-only` で流した時点で 1,806 枚の時刻が**データ転送なしで**修復され、以降の実行は3秒・転送ゼロで終わる。

> **Warning:** 退避先の `.trash/` は必ず `slides/` の**外**に置くこと。
> 中に置くと MMM-R5 の再帰スキャンがゴミ箱の画像まで拾い、消したはずの画像がスライドショーに出続ける。
> 30日を超えた退避世代はスクリプト末尾で自動削除する。

## MagicMirror モジュール

config.js で3つのモジュールを配置している。

### clock (組み込み)

右上に時計を表示。日付は `YYYY/MM/DD（dd）` 形式（dd は ja locale で漢字1文字の曜日）。
`classes: "r5-plate"` で半透明ぼかしプレートを敷く。

### MMM-R5 (自作: 背景スライドショー)

`position: "fullscreen_below"` で画面全体に画像を敷く。
node_helper が `~/signage/slides` を**再帰スキャン**し、Express の静的ルート `/MMM-R5/images` で配信する。
`slides/r5/`・`slides/tate/` のようにフォルダを分けて置けば、すべてが1本の再生リストにまとまる。
フォルダを増やしても設定変更は要らない。
フロント側は URL 一覧を受け取り、60秒ごとにフェード切替（1200ms）でシャッフル巡回する。

対応拡張子: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`

`.` で始まるフォルダはスキャン対象から外す。同期元に紛れている Syncthing の管理フォルダ（`.stversions` 等）を拾わないため。

> **Note:** 再帰スキャンでは画像名が `r5/foo.png` のようにスラッシュを含む。
> URL 化するときは `encodeURIComponent()` を丸ごと掛けてはいけない。区切りの `/` まで `%2F` に変換され、
> パスが壊れて画像が1枚も表示されなくなる。セグメントごとに符号化してから `/` で繋ぎ直すこと。

### MMM-OshiCal (自作: 配信予定バー)

推しスケ (oshi-sche-webapp) の iCal フィードを 5分ごとに取得し、今から先の配信予定を2段カードで並べる。
下バー全幅に配置。`classes: "r5-plate"` で半透明プレート付き。

**枠は 4列 × 5行 = 20 で固定。何日先まで出すかは決めていない。** 今日ぶんを上から詰めて、
余ったら明日、それでも余ったら明後日と、20 枠が埋まるまで先へ進む。予定が立て込む日は今日だけで
埋まり、週末の夜など少ない日は数日先まで届く。列数は `config.js` の `oshiCols`（既定4）、
行数は `maxEntries ÷ 列数` で決まる。

表示の決まりごと:

- **日付セル** — 今日以外の日は頭に「07/28（火）」を1枠置く。列は送らず、時刻の流れの中にそのまま挟む
- **色は2色** — 今日は青緑 `#7fd4cc`、翌日以降はすべて空色 `#8fb4e8`。日ごとに色を変えない
  （日の区切りは日付セルが担っており、色数を増やすと配信中のオレンジ `#ff9a3d` が埋もれるため）
- **＋他 N 件** — 入り切らない日は最後の1枠を「＋ 他 N 件」に使う。件数はその日の実数
- **枠は常に引く** — 予定が少なくても 20 枠ぶんの区切り線と左バーを薄く出す。件数で帯の高さや
  列幅が変わると、同じ場所の表示が日によって別物に見えてしまうため

データ処理の流れ:

1. node_helper が iCal URL を fetch し、テキストを手動パース（外部ライブラリなし）
2. iCal の折り返し行（行頭スペース/タブ）を結合してから VEVENT を走査
3. DTSTART が UTC (`...Z`) なら JST (+9h) に変換、`VALUE=DATE` なら終日判定
4. 日付 (YYYYMMDD) ごとに仕分ける。今日は「現在の時間帯の頭」以降だけ、明日以降は時刻の足切り無し
5. 日付の昇順に、20 枠が埋まるまでの日だけ front へ返す（`{ num, today, label, total, events }`）
6. SUMMARY の `【推し名】予定タイトル` を正規表現で name と title に分解
7. フロントは CSS Grid (`grid-auto-flow: column`) で上→下に詰めて右の列へ流す。1件は
   `grid-template-columns: auto 1fr` の2カラムで、auto 列が全行の最大幅に揃うため時刻が縦一列に揃う

> **Note:** front は「配列の先頭＝今日」と決め打ちしてはいけない。node_helper は予定がある日しか
> 返さないので、今日の予定がゼロだと先頭が未来の日になる。日付セルが付かず今日の色で描かれ、
> 数週間先の予定が今日のものに見える。判定には helper が付ける `day.today` を使うこと。

> **Note:** ICS には差分取得も期間指定も無く、購読側は毎回ファイル全体（約 88KB / 504 件）を受け取る。
> そのため先読みを何日に伸ばしても取得・解析の負荷は変わらない（解析は元から全件1周・実測 3〜7ms）。
> 増えるのは front へ渡す配列の長さだけで、それも 20 枠ぶん（実測 0.7〜2.1KB）で頭打ちになる。

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
| `scripts/`（`*.sh` と `mm-shot.py` / `mm-shot.js` / `README.md`） | `~/run/` |
| `magicmirror/config.js` | `~/MagicMirror/config/config.js` |
| `magicmirror/.env` | `~/MagicMirror/.env`（config/ ではなくルート） |
| `magicmirror/css/custom.css` | `~/MagicMirror/css/custom.css` |
| `magicmirror/modules/MMM-R5/*` | `~/MagicMirror/modules/MMM-R5/` |
| `magicmirror/modules/MMM-OshiCal/*` | `~/MagicMirror/modules/MMM-OshiCal/` |
| `magicmirror/modules/MMM-MonthCal/*` | `~/MagicMirror/modules/MMM-MonthCal/` |

`legacy/` は配布対象外。X13 側に残っている旧 `~/r5.sh` や `~/run/signage-*.sh` は今後更新されない。

`host/monitors.xml` は GNOME が随時上書きするファイルなので、deploy.sh では配布しない。

> **Warning:** このファイルは**実機側が正本**で、リポジトリのものは写し（バックアップ）。
> 変更するときは X13 の［設定］→［ディスプレイ］で操作し、結果をこちらへ吸い上げる。
>
> ```bash
> scp x13:~/.config/monitors.xml ~/Batches/yp-signage/host/monitors.xml
> ```
>
> **逆向きに上書きしないこと。** 実機にしか無い構成が消え、画面の向きを見失う。

## 経緯メモ

旧構成では mpv や feh でスライドショーを流していた（`legacy/signage-start.sh`, `同 r5.sh`）。
MagicMirror² に移行して時計やカレンダーを重ねられるようにした。
Sway への移行も検討したが、2026-07-18 に却下し、GNOME (Wayland) + XWayland 構成で安定稼働中。
検証用の Sway 設定は 2026-08-03 のリポジトリ再編で削除した（履歴は vault `40-Projects/X13/core/sway-migration.md`）。

## 接続情報

X13: 固定IP 192.168.x.x / user youruser / `ssh x13` 鍵認証済み。
