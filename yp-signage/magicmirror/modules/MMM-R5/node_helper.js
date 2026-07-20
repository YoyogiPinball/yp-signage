/* MMM-R5 node_helper — 画像フォルダを再帰スキャンして静的配信する。
 * MM の本体(ブラウザ)はディスクを直接読めないため、express の静的ルート
 * /MMM-R5/images 以下でフォルダを公開し、フロントには URL 一覧を返す。
 */
const NodeHelper = require("node_helper");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);
const DEFAULT_DIR = path.join(os.homedir(), "signage", "slides");

module.exports = NodeHelper.create({
	start() {
		this.routeDir = null;
	},

	// 指定フォルダを /MMM-R5/images で静的配信する（初回のみ登録。express.static は
	// 後から張り替えられないため、最初に受け取った imageDir を採用する）。
	ensureRoute(imageDir) {
		if (this.routeDir !== null) return;
		this.expressApp.use("/MMM-R5/images", express.static(imageDir));
		this.routeDir = imageDir;
	},

	socketNotificationReceived(notification, payload) {
		if (notification !== "MMM_R5_GET_IMAGES") return;
		const imageDir = payload.imageDir || DEFAULT_DIR;
		this.ensureRoute(imageDir);

		let images = [];
		try {
			// recursive: true でサブフォルダ（slides/r5, slides/tate …）まで降りる。
			// 返る値は "r5/foo.png" のような相対パス。フォルダ自体も混ざるが拡張子で落ちる。
			images = fs
				.readdirSync(imageDir, { recursive: true })
				.filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
				.filter((f) => !f.split("/").some((seg) => seg.startsWith(".")))
				.sort()
				// encodeURIComponent はセパレータの "/" まで %2F にしてしまい URL が壊れるので、
				// セグメントごとに符号化してから "/" で繋ぎ直す。
				.map((f) => "/MMM-R5/images/" + f.split("/").map(encodeURIComponent).join("/"));
		} catch (e) {
			console.error(`[MMM-R5] 画像フォルダを読めません: ${imageDir} (${e.message})`);
		}
		this.sendSocketNotification("MMM_R5_IMAGES", { images });
	},
});
