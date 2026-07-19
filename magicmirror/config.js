/* MagicMirror² config — X13 サイネージ構成
 * 正本: ~/Batches/x13/magicmirror/config.js → 配布先 ~/MagicMirror/config/config.js
 */

// 秘密情報(ICS URL等)は secrets.js から読む。無ければ空扱いにして起動は止めない。
const secrets = (() => {
	try {
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
			position: "top_left",
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
						module: "calendar",
						position: "top_left",
						header: "今日の予定",
						classes: "r5-plate", // 背景画像の上で読みやすくする半透明プレート（custom.css）
						config: {
							// 今日の、これからの分だけ（feedback 2026-07-18）。
							// calendar は既定で過去イベントを出さないので、対象日数を1日に絞れば「今日の残り」になる。
							maximumNumberOfDays: 1,
							maximumEntries: 10,
							fetchInterval: 5 * 60 * 1000, // 5分ごとに更新
							timeFormat: "absolute", // 「15:00」のような絶対時刻表示
							calendars: [
								{
									url: secrets.calendarIcs,
									symbol: "calendar",
								},
							],
						},
					},
			  ]
			: []),
		{
			module: "compliments",
			position: "lower_third",
			classes: "r5-plate", // 背景画像の上で読みやすくする半透明プレート（custom.css）
		},
	],
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") {
	module.exports = config;
}
