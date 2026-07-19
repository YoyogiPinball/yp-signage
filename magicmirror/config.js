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

	// Electron 表示オプション：外部モニタ DP-2（縦1080x1920）へ全画面表示。
	// DP-2 は monitors.xml で論理原点(0,0)固定にしたので x:0。蓋の開閉で位置がぶれない。
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
		{
			module: "clock",
			position: "top_right",
			classes: "r5-plate", // 背景画像の上で読みやすくする半透明プレート（custom.css）
			config: {
				timezone: "Asia/Tokyo",
				displaySeconds: true,
				// 日付は「2026/07/18（土）」形式。dd はja locale で1文字曜日（漢字1字）。
				dateFormat: "YYYY/MM/DD（dd）",
			},
		},
		// カレンダー：secrets.calendarIcs があるときだけ有効化（URL未設定なら丸ごと出さない）
		...(secrets.calendarIcs
			? [
					{
						// 自作の日間カレンダー（案C=2段カード）。組み込み calendar では2段・縦揃えが
						// 作れないため、同じ ICS を node_helper で取得・整形して描画する。
						module: "MMM-OshiCal",
						position: "bottom_left",
						classes: "r5-plate", // 背景画像の上で読みやすくする半透明プレート（custom.css）
						config: {
							icsUrl: secrets.calendarIcs,
							maxEntries: 12,
							updateInterval: 5 * 60 * 1000, // 5分ごとに取り直す
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
