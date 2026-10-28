/* server.js（WebリモコンAPI）の境界テスト。
 *
 * 何を保証するか:
 *   - 画面の点灯・消灯と点灯予定の API が無く、どの要求でも画面を消せないこと
 *   - 状態取得が本人限定の設定と開かれ方だけを返し、画面の電源状態を読まないこと
 *   - Webリモコンの配布物に、画面の電源状態（PowerSaveMode）へ書き込むコードが無いこと
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("画面の点灯・消灯と点灯予定の API は 404 を返す", async (t) => {
	await withoutAuth(t, async () => {
		const { handle } = require("../scripts/signage-timer/server.js");
		for (const [method, url] of [
			["POST", "/api/display/on"],
			["POST", "/api/display/off"],
			["POST", "/api/display/off-until-morning"],
			["POST", "/api/display/off-until-on"],
			["DELETE", "/api/override"],
			["PUT", "/api/schedule"],
		]) {
			const response = captureResponse();
			await handle({ method, url, headers: {}, socket: {} }, response);
			assert.equal(response.statusCode, 404, url);
		}
	});
});

test("状態取得は画面の電源状態を返さない", async (t) => {
	await withoutAuth(t, async () => {
		const { handle } = require("../scripts/signage-timer/server.js");
		const response = captureResponse();
		await handle({ method: "GET", url: "/api/status", headers: { host: "127.0.0.1:8081" }, socket: {} }, response);
		assert.equal(response.statusCode, 200);
		assert.deepEqual(JSON.parse(response.body), { authRequired: false, viaRemote: false });
	});
});

test("Webリモコンの配布物は PowerSaveMode に触れない", () => {
	// サイネージ用途をやめた PC で画面を消し続けた事故（2026-10-28）の再発防止。
	// 点灯・消灯の機能を戻すときは、このテストを消す判断を明示的にすることになる。
	const directory = path.join(__dirname, "..", "scripts", "signage-timer");
	for (const name of fs.readdirSync(directory)) {
		const body = fs.readFileSync(path.join(directory, name), "utf8");
		assert.doesNotMatch(body, /PowerSaveMode/, name);
	}
	const displayOn = path.join(__dirname, "..", "scripts", "signage-display-on.sh");
	assert.equal(fs.existsSync(displayOn), false);
});

/* 表示履歴API（/api/slideshow/now）。
 *
 * 何を保証するか:
 *   - MagicMirror から受け取った表示履歴をそのままリモコンへ渡すこと
 *   - MagicMirror が動いていないとき、502 とエラー文言を返して黙って詰まらないこと
 * ここで言えないこと: 画面に本当にその画像が出ているか（記録した側の正しさは別）
 */
function captureResponse() {
	const captured = { headersSent: false };
	captured.writeHead = (code) => {
		captured.statusCode = code;
		captured.headersSent = true;
	};
	captured.end = (body) => { captured.body = body; };
	return captured;
}

test("本人限定が未設定のとき、外から開かれた場合だけ状態に viaRemote を立てる", async (t) => {
	await withoutAuth(t, async () => {
		const { handle } = require("../scripts/signage-timer/server.js");
		const cases = [
			[{ host: "127.0.0.1:8081" }, false],
			[{ host: "localhost:8081" }, false],
			[{ host: "[::1]:8081" }, false],
			[{ host: "signage.example.ts.net" }, true],
			[{ host: "127.0.0.1:8081", "tailscale-user-login": "someone@example.com" }, true],
			[{}, true],
		];
		for (const [headers, expected] of cases) {
			const response = captureResponse();
			await handle({ method: "GET", url: "/api/status", headers, socket: {} }, response);
			assert.equal(JSON.parse(response.body).viaRemote, expected, JSON.stringify(headers));
		}
	});
});

async function withoutAuth(t, run) {
	const previousUser = process.env.SIGNAGE_TIMER_USER;
	const previousPort = process.env.SIGNAGE_PORT;
	delete process.env.SIGNAGE_TIMER_USER;
	t.after(() => {
		if (previousUser === undefined) delete process.env.SIGNAGE_TIMER_USER;
		else process.env.SIGNAGE_TIMER_USER = previousUser;
		if (previousPort === undefined) delete process.env.SIGNAGE_PORT;
		else process.env.SIGNAGE_PORT = previousPort;
	});
	await run();
}

test("表示履歴APIは MagicMirror の応答をそのままリモコンへ渡す", async (t) => {
	await withoutAuth(t, async () => {
		const http = require("node:http");
		const recent = [
			{ time: "14:03:12", file: "r5/first.jpg", reason: "", position: 1, total: 2 },
			{ time: "14:04:12", file: "r5/second.jpg", reason: "next", position: 2, total: 2 },
		];
		const mirror = http.createServer((request, response) => {
			assert.equal(request.url, "/yp-slideshow/now");
			response.writeHead(200, { "Content-Type": "application/json" });
			response.end(JSON.stringify({ ok: true, current: recent[1], recent }));
		});
		await new Promise((resolve) => mirror.listen(0, "127.0.0.1", resolve));
		t.after(() => new Promise((resolve) => mirror.close(resolve)));
		process.env.SIGNAGE_PORT = String(mirror.address().port);

		const { handle } = require("../scripts/signage-timer/server.js");
		const response = captureResponse();
		await handle({
			method: "GET",
			url: "/api/slideshow/now",
			headers: {},
			socket: { encrypted: false },
		}, response);

		assert.equal(response.statusCode, 200);
		const body = JSON.parse(response.body);
		assert.equal(body.current.file, "r5/second.jpg");
		assert.equal(body.current.reason, "next");
		assert.equal(body.current.total, 2);
		assert.deepEqual(body.recent, recent);
	});
});

test("MagicMirror が応答しないとき表示履歴APIは502を返す", async (t) => {
	await withoutAuth(t, async () => {
		const http = require("node:http");
		// 一度立てて即座に閉じ、誰も待っていないポート番号を確実に得る。
		const idle = http.createServer();
		await new Promise((resolve) => idle.listen(0, "127.0.0.1", resolve));
		const port = idle.address().port;
		await new Promise((resolve) => idle.close(resolve));
		process.env.SIGNAGE_PORT = String(port);

		const { handle } = require("../scripts/signage-timer/server.js");
		const response = captureResponse();
		await handle({
			method: "GET",
			url: "/api/slideshow/now",
			headers: {},
			socket: { encrypted: false },
		}, response);

		assert.equal(response.statusCode, 502);
		assert.equal(typeof JSON.parse(response.body).error, "string");
	});
});

/* 縮小画像の中継（/api/slideshow/shot）。
 *
 * 何を保証するか:
 *   - size と file をそのまま MagicMirror へ渡し、返ってきた画像を素通しすること
 *   - file が無いリクエストを 400 で断り、MagicMirror へ問い合わせないこと
 *   - まだ縮小できていない1枚（MagicMirror が 404）を 404 として返すこと
 * ここで言えないこと: 画像の中身が本当にその写真か（作っているのはブラウザ側）
 */
function captureStreamResponse() {
	const { PassThrough } = require("node:stream");
	const stream = new PassThrough();
	const chunks = [];
	stream.on("data", (chunk) => chunks.push(chunk));
	stream.headersSent = false;
	stream.writeHead = (code, headers) => {
		stream.statusCode = code;
		stream.sentHeaders = headers;
		stream.headersSent = true;
	};
	stream.collected = () => Buffer.concat(chunks);
	return stream;
}

test("縮小画像の中継は MagicMirror の応答をそのまま流す", async (t) => {
	await withoutAuth(t, async () => {
		const http = require("node:http");
		const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x01, 0x02, 0xff, 0xd9]);
		let receivedUrl = null;
		const mirror = http.createServer((request, response) => {
			receivedUrl = request.url;
			response.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": jpeg.length });
			response.end(jpeg);
		});
		await new Promise((resolve) => mirror.listen(0, "127.0.0.1", resolve));
		t.after(() => new Promise((resolve) => mirror.close(resolve)));
		process.env.SIGNAGE_PORT = String(mirror.address().port);

		const { handle } = require("../scripts/signage-timer/server.js");
		const response = captureStreamResponse();
		const finished = new Promise((resolve) => response.on("finish", resolve));
		await handle({
			method: "GET",
			url: "/api/slideshow/shot?size=preview&file=" + encodeURIComponent("r5/あ とb.jpg"),
			headers: {},
			socket: { encrypted: false },
		}, response);
		await finished;

		assert.equal(response.statusCode, 200);
		assert.equal(response.sentHeaders["Content-Type"], "image/jpeg");
		assert.deepEqual(response.collected(), jpeg);
		// 空白や日本語を含む名前でも、符号化したまま1つの値として渡ること。
		assert.equal(receivedUrl, "/yp-slideshow/shot?size=preview&file=" + encodeURIComponent("r5/あ とb.jpg"));
	});
});

test("file の無い縮小画像の要求は400で断る", async (t) => {
	await withoutAuth(t, async () => {
		// 問い合わせ先を用意しないまま呼び、MagicMirror へ行かずに断ることを確かめる。
		process.env.SIGNAGE_PORT = "1";
		const { handle } = require("../scripts/signage-timer/server.js");
		const response = captureResponse();
		await handle({
			method: "GET",
			url: "/api/slideshow/shot?size=thumb",
			headers: {},
			socket: { encrypted: false },
		}, response);
		assert.equal(response.statusCode, 400);
	});
});

test("まだ縮小できていない画像の要求は404を返す", async (t) => {
	await withoutAuth(t, async () => {
		const http = require("node:http");
		const mirror = http.createServer((request, response) => {
			response.writeHead(404, { "Content-Type": "application/json" });
			response.end(JSON.stringify({ ok: false }));
		});
		await new Promise((resolve) => mirror.listen(0, "127.0.0.1", resolve));
		t.after(() => new Promise((resolve) => mirror.close(resolve)));
		process.env.SIGNAGE_PORT = String(mirror.address().port);

		const { handle } = require("../scripts/signage-timer/server.js");
		const response = captureResponse();
		await handle({
			method: "GET",
			url: "/api/slideshow/shot?file=r5/none.jpg",
			headers: {},
			socket: { encrypted: false },
		}, response);
		assert.equal(response.statusCode, 404);
	});
});
