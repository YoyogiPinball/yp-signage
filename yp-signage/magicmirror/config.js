/* MagicMirror² config — X13 サイネージ構成
 * 正本: ~/Batches/x13/magicmirror/config.js → 配布先 ~/MagicMirror/config/config.js
 */

// 秘密情報(ICS URL等)は secrets.js から読む。無ければ空扱いにして起動は止めない。
// 注意: MM は config.js を require せず fs.readFileSync+eval で読む。その中の
// require("./secrets.js") は config ディレクトリ基準では解決されない（MM の js/ 基準に
// なって失敗する）。そのため MM が用意する global.root_path から絶対パスで読む。
// ローカルの `node -e require("./config.js")` テスト時は root_path が無いので相対にフォールバック。
const secrets = (() => {
	try {
		if (typeof global !== "undefined" && global.root_path) {
			return require(`${global.root_path}/config/secrets.js`);
		}
		return require("./secrets.js");
	} catch (e) {
		return {};
	}
})();

// --- 環境変数（一時テスト用） ---
// X13_COLS: 下部「配信予定」の列数。3 か 4（既定4）。
// X13_OSHI_NOW: OshiCal のデバッグ現在時刻（例 "2026-07-19T06:00"）。空なら実時刻。
//   起動例: X13_COLS=3 X13_OSHI_NOW=2026-07-19T06:00 bash ~/run/mm-start.sh
const oshiNow = process.env.X13_OSHI_NOW || "";
const oshiCols = process.env.X13_COLS === "3" ? 3 : 4; // 予定の列数（3 か 4）。既定4。
const oshiMax = oshiCols * 5; // 列数×5行を表示上限に（front は maxEntries÷列数 を行数の上限に使う）

let config = {
	address: "localhost",
	port: 8080,
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
		width: 1080,
		height: 1920,
		fullscreen: true,
		autoHideMenuBar: true,
	},

	modules: [
		// 背景の全画面スライドショー（~/signage/r5 の画像を巡回）。他モジュールはこの上に重なる。
		{
			module: "MMM-R5",
			position: "fullscreen_below",
			config: {
				slideInterval: 60000, // 1枚60秒（feedback 2026-07-18）
				fadeSpeed: 1200,
				shuffle: true,
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
		...(secrets.calendarIcs
			? [
					{
						// 自作の日間カレンダー（案C=2段カード）。組み込み calendar では2段・縦揃えが
						// 作れないため、同じ ICS を node_helper で取得・整形して描画する。
						module: "MMM-OshiCal",
						position: "bottom_bar",
						classes: "r5-plate", // 背景画像の上で読みやすくする半透明プレート（custom.css）
						config: {
							icsUrl: secrets.calendarIcs,
							maxEntries: oshiMax,
							updateInterval: 5 * 60 * 1000, // 5分ごとに取り直す
							columns: oshiCols, // 予定の列数（front が body class x13-cols-N に反映）
							debugNow: oshiNow, // デバッグ現在時刻（空なら実時刻）
							// 配信の開始時刻ちょうどに、その予定の枠を60秒だけ光らせる。
							// firingStyle は光り方（CSS の f1〜f5）。4 = 0.9秒周期のはっきりした明滅。
							// ゆっくり変化する案（1〜3・5）は視界の端だと目が慣れて気づけないため、
							// 「点いて消える」動きのある 4 を選んでいる。見比べは `mm-ctl.sh blink 3` 等で。
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
		...(secrets.owmApiKey
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
							lat: secrets.weatherLat ?? 35.681,
							lon: secrets.weatherLon ?? 139.767,
							apiKey: secrets.owmApiKey,
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
