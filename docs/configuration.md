# 表示と機能の設定

表示機の `.env` はMagicMirror² の表示先・倍率・画像・予定・天気を決める設定ファイルです。
表示機の `~/MagicMirror/.env` を編集すれば、環境に合わせて表示を変えられます。

[導入の手順へ戻る](../README.md#導入)

## .env の置き場所と書き方

秘密情報（iCal URL・API キー）と、環境ごとに変わる値（解像度・表示秒数・緯度経度）は
`.env` にまとめてあります。`config.js`（MagicMirror² の設定を組み立てる JavaScript）を開かずに設定を変えるためです。

`.env` は表示機の `~/MagicMirror/.env` にだけ置き、表示機の上で直接編集します。
倍率や出力先のモニターのように表示機ごとに決まる値を持つため、リポジトリ直下の配布スクリプト `deploy.sh` は既にある `.env` を上書きしません。
表示機に `.env` が無いときだけ、配布時に `.env.example` をひな形として置きます。

```bash
scp magicmirror/.env.example signage:~/MagicMirror/.env   # 初回だけ
ssh -t signage 'nano ~/MagicMirror/.env'
```

表示機と操作元が同じ PC なら、`~/MagicMirror/.env` をそのまま編集してください。

書式は `KEY=値` だけで、引用符もカンマも要りません。1 行書き損じてもその項目が既定値になるだけで、
他の設定はそのまま使われます。項目の一覧と意味は、リポジトリの設定ひな形 [`.env.example`](../magicmirror/.env.example) のコメントにすべて書いてあります。

> **Warning:** 配布先での置き場所は `~/MagicMirror/.env` で、`config/` ではなく
> **MagicMirror のルート**です。`config.js` は引数なしの `process.loadEnvFile()` で
> 「カレントディレクトリの `.env`」を読み、MagicMirror は自身のルートをカレントディレクトリにして
> 起動します。`config/` に置くと、エラーも出さずに全項目が既定値になります。

## 表示倍率

`SIGNAGE_DEVICE_SCALE_FACTOR` は Electron の表示倍率です。既定値は `1` で、GNOME/XWayland が
外部モニターの倍率を誤って判定した場合も 1080×1920 の画面に収まります。HiDPI 画面で拡大する場合は
`1.25`、`1.5`、`2` などを指定してください。その回だけ試す場合は、次のように起動できます。

```bash
ssh signage 'SIGNAGE_DEVICE_SCALE_FACTOR=1.25 bash ~/run/mm-start.sh'
```

## 表示するモニター

`SIGNAGE_MONITOR` はサイネージを表示するモニターを指定する設定です。既定の `auto` は外部モニターのうち縦置きのもの、
無ければ原点 (0,0) にあるものを選びます。作業用のモニターと並べていて自動で決まらないときは、
起動時のエラーに出る名前（`DP-1`、`HDMI-1` など）を書いてください。決まらないときは、作業中の画面を
覆わないように起動を取りやめ、起動済みのサイネージもそのまま残します。

```bash
ssh signage 'SIGNAGE_MONITOR=HDMI-1 bash ~/run/mm-start.sh'   # その回だけ別のモニターに出す
```

自動選択では、外部モニターの候補が1台に決まる必要があります。
表示先を選ぶ共通スクリプト `scripts/mm-display.sh` のエラーメッセージは次のとおりです。
`$names` は有効なモニター名の一覧、`$wanted` は指定したモニター名に置き換わります。

| 条件 | エラーメッセージの文面 |
|---|---|
| 自動では1台に決められない | `エラー: 出すモニターを自動では決められません（いま有効なもの: $names）。` |
| 指定した名前が見つからない | `エラー: SIGNAGE_MONITOR=$wanted のモニターが見つかりません（いま有効なもの: $names）` |

自動で決められない場合は、続けて設定先も表示します。

```text
  ~/MagicMirror/.env の SIGNAGE_MONITOR に、上の名前のどれかを書いてください
```

## 機能のオン/オフ

使わない機能は `.env` で無効にできます。

| キー | 効果 |
|---|---|
| `SIGNAGE_OSHICAL_ENABLED=false` | 下バー（予定）を表示しない |
| `SIGNAGE_WEATHER_ENABLED=false` | 天気を表示しない |

iCal URL や API キーを消しても止まりますが、それでは何を設定していたかが `.env` に残りません。
あとで戻せるよう、値は残したまま無効にできるようにしてあります。

`.env` の項目が全部空のままでも起動します。その場合、下の予定バーと天気のパネルが出ない画面になります。月カレンダーは設定がなくても表示されるので、画面が空になることはありません。
