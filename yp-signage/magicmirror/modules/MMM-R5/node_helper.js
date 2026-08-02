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

// 表示履歴の置き場。画面を見て「これ壊れてる」と思ったとき `cat` で犯人を引くためのもの。
// 直近 NOW_KEEP 件だけ持つ（1枚60秒なので 10件 ≒ 直近10分）。気づいてから見に行くまでの
// 猶予を作るのが目的で、最新1件だけだと次の画像に切り替わって犯人が消える。
const DEFAULT_LOG = path.join(os.homedir(), "signage", "r5-now.log");
const NOW_KEEP = 10;

// 表示履歴の行頭ラベル。「なぜこの画像に変わったか」を残す。ラベルが無い行は自動送り。
// 手動送りと自動送りが区別できないと、prev/next の挙動を後から追えない。
const LABELS = {
	next: "[次へ]", // mm-ctl.sh next / →キー
	prev: "[前へ]", // mm-ctl.sh prev / ←キー
	alt: "[代替]", // 直前の画像が読めず、代わりに出した1枚
	broken: "[壊れ]", // 読み込みに失敗した画像そのもの
};
const NO_LABEL = "      "; // ラベル無しの桁合わせ（日本語2文字＋括弧＝表示幅6）

module.exports = NodeHelper.create({
	start() {
		this.routeDir = null;
		this.logPath = DEFAULT_LOG; // config で上書きされるまでは既定の置き場所を使う
		this.recent = []; // 表示履歴（末尾が最新）。MM 再起動で空に戻る
		// 外部からスライドショーを操作する制御エンドポイント。
		// `curl localhost:8080/MMM-R5/control/next` のように叩くと、その cmd を
		// フロント(MMM-R5.js)へ内部通知し、pause/resume/next/prev を実行させる。
		// ipWhitelist(127.0.0.1) の内側なので外部からは届かない。
		const ALLOWED = new Set(["pause", "resume", "toggle", "next", "prev", "topbar"]);
		this.expressApp.get("/MMM-R5/control/:cmd", (req, res) => {
			const cmd = req.params.cmd;
			if (!ALLOWED.has(cmd)) {
				return res.status(400).json({ ok: false, error: `unknown cmd: ${cmd}` });
			}
			this.sendSocketNotification("MMM_R5_CONTROL", { cmd });
			res.json({ ok: true, cmd });
		});
	},

	// 指定フォルダを /MMM-R5/images で静的配信する（初回のみ登録。express.static は
	// 後から張り替えられないため、最初に受け取った imageDir を採用する）。
	ensureRoute(imageDir) {
		if (this.routeDir !== null) return;
		this.expressApp.use("/MMM-R5/images", express.static(imageDir));
		this.routeDir = imageDir;
	},

	// url は "/MMM-R5/images/r5/foo.png" 形式で符号化済み。復号は "/" を壊さないので
	// 全体に掛けてよい（符号化と違いセグメント分割は不要）。
	toFile(url) {
		return decodeURIComponent(String(url).replace("/MMM-R5/images/", ""));
	},

	// 表示中の画像を時刻付きで r5-now.log に書き出す。直近ぶんをメモリに持って毎回
	// 全部書き直す（追記して後から切り詰めるより単純で、ファイルが育たない）。
	recordNow(url, reason) {
		if (!url) return;
		const time = new Date().toTimeString().slice(0, 8);
		this.recent.push({ time, file: this.toFile(url), label: LABELS[reason] || "" });
		if (this.recent.length > NOW_KEEP) this.recent = this.recent.slice(-NOW_KEEP);
		this.writeNow();
	},

	// 読み込みに失敗した画像の行に [壊れ] を立てる。その画像は表示を試みた時点で
	// recordNow 済みなので、末尾から遡って同じファイルの行を書き換える。
	// これで「同じ秒に2行並ぶ」の上側が犯人だと一目で分かる。
	markBroken(url) {
		if (!url) return;
		const file = this.toFile(url);
		for (let i = this.recent.length - 1; i >= 0; i--) {
			if (this.recent[i].file === file) {
				this.recent[i].label = LABELS.broken;
				this.writeNow();
				return;
			}
		}
	},

	writeNow() {
		const body = this.recent.map((r) => `${r.time}  ${r.label || NO_LABEL}  ${r.file}`).join("\n");
		try {
			fs.writeFileSync(this.logPath, body + "\n");
		} catch (e) {
			console.error(`[MMM-R5] 表示履歴を書けません: ${this.logPath} (${e.message})`);
		}
	},

	socketNotificationReceived(notification, payload) {
		if (notification === "MMM_R5_NOW") {
			this.recordNow(payload.url, payload.reason);
			return;
		}
		if (notification === "MMM_R5_BROKEN") {
			this.markBroken(payload.url);
			return;
		}
		if (notification !== "MMM_R5_GET_IMAGES") return;
		const imageDir = payload.imageDir || DEFAULT_DIR;
		this.logPath = payload.logPath || DEFAULT_LOG;
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
