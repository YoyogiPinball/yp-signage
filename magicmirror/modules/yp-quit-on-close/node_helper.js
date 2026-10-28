/* yp-quit-on-close node_helper — 窓を閉じたら MagicMirror ごと終わらせる。
 *
 * MagicMirror 本体の js/electron.js は、窓がすべて閉じられると作り直す（window-all-closed で
 * createWindow）。そのため GNOME の「終了」で窓を閉じても、すぐに窓が戻ってくる。本体は
 * 改変しないので、閉じる操作を受けたら窓を閉じさせずに app.quit() へ切り替える。
 * app.quit() は本体の before-quit で各 node_helper を止めてからプロセスを終える。
 *
 * node_helper は Electron の窓と同じプロセスで動くので、ここから electron の app を触れる。
 * ブラウザ表示だけで動かす（serveronly）ときは electron が無いので何もしない。
 */
const NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
	start() {
		let app;
		try {
			({ app } = require("electron"));
		} catch {
			return;
		}
		if (!app || typeof app.on !== "function") return;

		app.on("browser-window-created", (_event, window) => {
			window.on("close", (event) => {
				event.preventDefault();
				app.quit();
			});
		});
	},
});
