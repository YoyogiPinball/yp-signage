/* yp-slideshow node_helper — 画像フォルダを再帰スキャンして静的配信する。
 * MM の本体(ブラウザ)はディスクを直接読めないため、express の静的ルート
 * /yp-slideshow/images 以下でフォルダを公開し、フロントには URL 一覧を返す。
 */
const NodeHelper = require("node_helper");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
// 並び順の比較はフロントと同じ実装を使う。ここだけ別の比較にすると、
// 「一覧の順」と画面の「ファイル名順」が食い違う。
const { naturalCompare } = require("./playback.js");

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
		// `curl localhost:8080/yp-slideshow/control/next` のように叩くと、その cmd を
		// フロント(yp-slideshow.js)へ内部通知し、pause/resume/next/prev を実行させる。
		// ipWhitelist(127.0.0.1) の内側なので外部からは届かない。
		const ALLOWED = new Set(["pause", "resume", "toggle", "next", "prev", "restart", "topbar"]);
		// 値を取る操作は URL を2段にする（/control/order/shuffle）。1段のまま
		// order-shuffle のような名前を並べると、増えるたびに一覧が伸びて綴りもゆれる。
		const VALUES = {
			order: new Set(["sequential", "shuffle"]),
			repeat: new Set(["none", "all", "one"]),
		};
		// ここで返す ok は「要求を受け取った」という意味で、画面に反映し終えたことまでは
		// 保証しない（実際に適用するのはフロント側）。反映の確認まで返すには、フロントから
		// 適用済みの通知を戻す仕組みが要る。いまは操作が届いたかどうかだけを見ている。
		this.expressApp.get("/yp-slideshow/control/:cmd", (req, res) => {
			const cmd = req.params.cmd;
			if (!ALLOWED.has(cmd)) {
				return res.status(400).json({ ok: false, error: `unknown cmd: ${cmd}` });
			}
			this.sendSocketNotification("YP_SLIDESHOW_CONTROL", { cmd });
			res.json({ ok: true, cmd });
		});
		this.expressApp.get("/yp-slideshow/control/:cmd/:value", (req, res) => {
			const { cmd, value } = req.params;
			const allowed = VALUES[cmd];
			if (!allowed) {
				return res.status(400).json({ ok: false, error: `unknown cmd: ${cmd}` });
			}
			if (!allowed.has(value)) {
				return res.status(400).json({ ok: false, error: `unknown value for ${cmd}: ${value}（使えるのは ${[...allowed].join(" / ")}）` });
			}
			this.sendSocketNotification("YP_SLIDESHOW_CONTROL", { cmd, value });
			res.json({ ok: true, cmd, value });
		});
	},

	// 指定フォルダを /yp-slideshow/images で静的配信する（初回のみ登録。express.static は
	// 後から張り替えられないため、最初に受け取った imageDir を採用する）。
	ensureRoute(imageDir) {
		if (this.routeDir !== null) return;
		this.expressApp.use("/yp-slideshow/images", express.static(imageDir));
		this.routeDir = imageDir;
	},

	// url は "/yp-slideshow/images/r5/foo.png" 形式で符号化済み。復号は "/" を壊さないので
	// 全体に掛けてよい（符号化と違いセグメント分割は不要）。
	toFile(url) {
		return decodeURIComponent(String(url).replace("/yp-slideshow/images/", ""));
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
			// 置き場所のフォルダごと作る。既定は ~/signage/ で、画像を置く前の環境には
			// まだ存在しない。無いまま書こうとすると画像が切り替わるたびに ENOENT が出る。
			fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
			fs.writeFileSync(this.logPath, body + "\n");
		} catch (e) {
			// 表示履歴は画面には関係しない補助機能なので、書けなくても止めない。
			// ただし毎回吐くとログが埋まるため、警告は最初の1回だけにする。
			if (!this.logWarned) {
				this.logWarned = true;
				console.error(`[yp-slideshow] 表示履歴を書けません（以後この警告は出しません）: ${this.logPath} (${e.message})`);
			}
		}
	},

	socketNotificationReceived(notification, payload) {
		if (notification === "YP_SLIDESHOW_QUIT") {
			// 右クリックメニューの「終了」。MagicMirror 本体は窓を閉じても作り直すため
			// （js/electron.js の window-all-closed）、プロセスごと終わらせるしかない。
			// process.exit で叩き落とさず SIGINT を送るのは、本体がこれを受けて
			// 各 node_helper の stop() を呼んでから終わる作りになっているため。
			console.log("[yp-slideshow] 画面から終了を要求されたので MagicMirror を停止します");
			process.kill(process.pid, "SIGINT");
			return;
		}
		if (notification === "YP_SLIDESHOW_NOW") {
			this.recordNow(payload.url, payload.reason);
			return;
		}
		if (notification === "YP_SLIDESHOW_BROKEN") {
			this.markBroken(payload.url);
			return;
		}
		if (notification !== "YP_SLIDESHOW_GET_IMAGES") return;
		// デモモードでは同梱のサンプル画像を見る。MagicMirror のルート直下に置く前提で、
		// global.root_path（MM 本体が入れている絶対パス）から解決する。
		// 手元の環境の絶対パスを config へ書かせないための逃げ道でもある。
		const demoDir = payload.demo && global.root_path ? path.join(global.root_path, "samples") : null;
		const imageDir = payload.imageDir || demoDir || DEFAULT_DIR;
		// デモでは表示履歴を一時ディレクトリへ逃がす。試しに動かしただけの人の
		// ホームに ~/signage/ を勝手に作らないため。
		const demoLog = payload.demo ? path.join(os.tmpdir(), "yp-slideshow-demo.log") : null;
		this.logPath = payload.logPath || demoLog || DEFAULT_LOG;
		this.ensureRoute(imageDir);

		let images = [];
		try {
			// recursive: true でサブフォルダ（slides/r5, slides/tate …）まで降りる。
			// 返る値は "r5/foo.png" のような相対パス。フォルダ自体も混ざるが拡張子で落ちる。
			images = fs
				.readdirSync(imageDir, { recursive: true })
				.filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
				.filter((f) => !f.split("/").some((seg) => seg.startsWith(".")))
				// 素の .sort() は文字コード順なので "10.jpg" が "2.jpg" より前に来る。
				// 数字を数値として比べる自然順に並べ、同値になる組も順序を確定させる。
				.sort(naturalCompare)
				// encodeURIComponent はセパレータの "/" まで %2F にしてしまい URL が壊れるので、
				// セグメントごとに符号化してから "/" で繋ぎ直す。
				.map((f) => "/yp-slideshow/images/" + f.split("/").map(encodeURIComponent).join("/"));
			this.scanWarned = false; // 読めたので、次に失敗したらまた知らせる
		} catch (e) {
			// 画像を置く前は毎回ここに来る。一覧は10分ごとに取り直すので、都度出すと
			// ログが同じ行で埋まる。フォルダが読めるようになるまで1回だけ知らせる。
			if (!this.scanWarned) {
				this.scanWarned = true;
				console.error(`[yp-slideshow] 画像フォルダを読めません: ${imageDir} (${e.message})`);
			}
		}
		this.sendSocketNotification("YP_SLIDESHOW_IMAGES", { images });
	},
});
