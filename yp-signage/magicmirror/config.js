/* MagicMirror² config — X13 サイネージ構成
 * 正本: ~/Batches/x13/yp-signage/magicmirror/config.js → 配布先 ~/MagicMirror/config/config.js
 *
 * 設定値は .env（配布先では ~/MagicMirror/.env）から読む。このファイルを開かずに
 * 解像度・表示秒数・iCal URL を変えられるようにするため。項目の一覧は .env.example。
 *
 * 引数なしの process.loadEnvFile() は「カレントディレクトリの .env」を読む。MM は
 * MagicMirror のルートを cwd にして起動する（mm-start.sh の --working-directory）ので、
 * パスを組み立てる必要がない。以前の secrets.js は require で読んでいたが、MM は
 * config.js を require せず eval 相当で読むため、相対 require が本体 js ディレクトリ基準に
 * なって失敗する罠があった。.env は require を通さないので、その罠ごと消えている。
 *
 * .env が無くても起動は止めない。全項目に既定値があり、秘密情報が空ならその機能を出さない。
 */
try {
	process.loadEnvFile();
} catch (e) {
	// .env が無い・読めない場合は既定値だけで起動する
}

const env = process.env;

// 環境変数の値は必ず文字列で届く。未設定と空文字は「書かなかった」とみなして既定値に落とす。
const str = (v, d) => (v === undefined || v === "" ? d : v);
const num = (v, d) => {
	if (v === undefined || v === "") return d;
	const n = Number(v);
	return Number.isNaN(n) ? d : n;
};
// "false" は文字列としては真になってしまうので、"true" と一致したときだけ真と見なす。
const bool = (v, d) => (v === undefined || v === "" ? d : v === "true");

// --- 一時上書き（.env を書き換えずにその場だけ変える） ---
// mm-start.sh が呼び出し側の環境変数をそのまま MM へ引き渡す。
//   X13_COLS=3 X13_OSHI_NOW=2026-07-19T06:00 bash ~/run/mm-start.sh
// 未指定でも空文字として渡ってくるため、空なら .env 側の値を使う。
const oshiCols = num(str(env.X13_COLS, env.SIGNAGE_OSHI_COLS), 4) === 3 ? 3 : 4;
const oshiNow = str(env.X13_OSHI_NOW, ""); // OshiCal のデバッグ現在時刻（空なら実時刻）
const oshiMax = oshiCols * 5; // 列数×5行を表示上限に（front は maxEntries÷列数 を行数の上限に使う）

const calendarIcs = str(env.SIGNAGE_CALENDAR_ICS, ""); // 空なら「配信予定」バーを出さない
const owmApiKey = str(env.SIGNAGE_OWM_API_KEY, ""); // 空なら天気パネルを出さない

let config = {
	address: "localhost",
	port: num(env.SIGNAGE_PORT, 8080),
	basePath: "/",
	ipWhitelist: ["127.0.0.1", "::ffff:127.0.0.1", "::1"],
	useHttps: false,

	// custom.css の読み込み先を明示する。既定は config/custom.css だが、正本は css/ に置くため上書き。
	customCss: "css/custom.css",

	language: "ja",
	locale: "ja-JP",
	logLevel: ["INFO", "LOG", "WARN", "ERROR"],
	timeFormat: 24,
	units: "metric",

	// Electron 表示オプション：外部モニタ（縦1080x1920）へ全画面表示。
	// 外部モニタは monitors.xml で論理原点(0,0)固定にしたので x:0。蓋の開閉で位置がぶれない。
	// 位置は論理座標で決まるため、コネクタ名（HDMI-2 / DP-2 等）には依存しない。
	electronOptions: {
		x: 0,
		y: 0,
		width: num(env.SIGNAGE_WIDTH, 1080),
		height: num(env.SIGNAGE_HEIGHT, 1920),
		fullscreen: true,
		autoHideMenuBar: true,
	},

	modules: [
		// 背景の全画面スライドショー（~/signage/slides の画像を巡回）。他モジュールはこの上に重なる。
		// imageDir / logPath は空ならモジュール側の既定（~/signage/... ）に落ちる。ホームの位置は
		// 環境で変わるため、決め打ちの絶対パスをここに書かない。
		{
			module: "MMM-R5",
			position: "fullscreen_below",
			config: {
				imageDir: str(env.SIGNAGE_IMAGE_DIR, null),
				logPath: str(env.SIGNAGE_LOG_PATH, null),
				slideInterval: num(env.SIGNAGE_SLIDE_INTERVAL, 60000), // 1枚60秒（feedback 2026-07-18）
				fadeSpeed: num(env.SIGNAGE_FADE_SPEED, 1200),
				shuffle: bool(env.SIGNAGE_SHUFFLE, true),
			},
		},
		// 上部バー(top_bar)に 時計・月カレ・天気 を横並び。下部バー(bottom_bar)は予定のみ。
		// バーの見た目は custom.css の .region.top.bar / .region.bottom.bar で作る。
		{
			module: "clock",
			position: "top_bar",
			classes: "r5-plate", // 背景画像の上で読みやすくする半透明プレート（custom.css）
			config: {
				timezone: "Asia/Tokyo",
				displaySeconds: true,
				// 日付は「2026/07/18（土）」形式。dd はja locale で1文字曜日（漢字1字）。
				dateFormat: "YYYY/MM/DD（dd）",
			},
		},
		// 配信予定（iCal購読）＝下部バー(bottom_bar)。今日のこれから＋明日。ここだけ下に置く。
		...(calendarIcs
			? [
					{
						// 自作の日間カレンダー（案C=2段カード）。組み込み calendar では2段・縦揃えが
						// 作れないため、同じ ICS を node_helper で取得・整形して描画する。
						module: "MMM-OshiCal",
						position: "bottom_bar",
						classes: "r5-plate", // 背景画像の上で読みやすくする半透明プレート（custom.css）
						config: {
							icsUrl: calendarIcs,
							maxEntries: oshiMax,
							updateInterval: 5 * 60 * 1000, // 5分ごとに取り直す
							columns: oshiCols, // 予定の列数（front が body class x13-cols-N に反映）
							debugNow: oshiNow, // デバッグ現在時刻（空なら実時刻）
							// 配信の開始時刻ちょうどに、その予定の枠を60秒だけ光らせる。
							// firingStyle は光り方（CSS の f1〜f5）。4 = 0.9秒周期のはっきりした明滅。
							// ゆっくり変化する案（1〜3・5）は視界の端だと目が慣れて気づけないため、
							// 「点いて消える」動きのある 4 を選んでいる。見比べは `mm-ctl.sh blink 3` 等で。
							// 環境ごとに変わる値ではなく全環境共通の設計判断なので、.env には出さない。
							firingDurationMs: 60 * 1000,
							firingStyle: 4,
						},
					},
			  ]
			: []),
		// 月カレンダー＝上バー中央：予定は出さず当月グリッドのみ。土=青／日祝=赤。
		{
			module: "MMM-MonthCal",
			position: "top_bar",
			classes: "r5-plate", // 背景の上で読みやすくする半透明プレート（custom.css）
		},
		// 天気＝上バー右：5日予報のみ（現在の気温 weather-current は 2026-07-21 に非表示化）。
		// OWM 無料キーがある時だけ。weather-forecast クラスで段を割り振る。
		...(owmApiKey
			? [
					{
						module: "weather",
						position: "top_bar",
						classes: "r5-plate weather-forecast",
						config: {
							weatherProvider: "openweathermap",
							apiVersion: "2.5", // 無料枠。既定 3.0(/onecall) を避ける
							weatherEndpoint: "/forecast", // 5day/3h(v2.5・無料)を日ごとに集約
							type: "forecast",
							lat: num(env.SIGNAGE_WEATHER_LAT, 35.681),
							lon: num(env.SIGNAGE_WEATHER_LON, 139.767),
							apiKey: owmApiKey,
							maxNumberOfDays: 5,
							fade: false,
							absoluteDates: true, // 「今日/明日」表記をやめ、常に日付書式で出す
							forecastDateFormat: "D（dd）", // 例: 19（日）。D=日にち, dd=1文字曜日(ja)
						},
					},
			  ]
			: []),
	],
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") {
	module.exports = config;
}
