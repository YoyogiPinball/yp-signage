/* MagicMirror² config — X13 最小構成（起動確認用・clockのみ）
 * 正本: ~/Batches/x13/magicmirror/config.js → 配布先 ~/MagicMirror/config/config.js
 */
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

	// Electron 表示オプション：外部モニタ DP-2（縦1080x1920・原点+1920+0）へ全画面表示
	electronOptions: {
		x: 1920,
		y: 0,
		width: 1080,
		height: 1920,
		fullscreen: true,
		autoHideMenuBar: true,
	},

	modules: [
		{
			module: "clock",
			position: "top_left",
			config: {
				timezone: "Asia/Tokyo",
				displaySeconds: true,
			},
		},
		{
			module: "compliments",
			position: "lower_third",
		},
	],
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") {
	module.exports = config;
}
