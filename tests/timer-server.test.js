/* server.js（WebリモコンAPI）の境界テスト。
 *
 * 何を保証するか:
 *   - 明示点灯待ちのAPIが期限なしoverrideをコントローラーへ渡すこと
 *   - 応答にも同じ状態が返ること
 *   - 既存の点灯APIで期限なしoverrideを解除できること
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultSchedule } = require("../scripts/signage-timer/state.js");
const scheduleLogic = require("../scripts/signage-timer/schedule.js");

test("翌朝の期限は未明なら同日、それ以降なら翌日の07:00になる", () => {
	const { nextMorning } = require("../scripts/signage-timer/server.js");
	assert.equal(
		new Date(nextMorning(Date.parse("2026-08-23T16:35:00Z"))).toISOString(),
		"2026-08-23T22:00:00.000Z",
	);
	assert.equal(
		new Date(nextMorning(Date.parse("2026-08-23T21:59:59Z"))).toISOString(),
		"2026-08-23T22:00:00.000Z",
	);
	assert.equal(
		new Date(nextMorning(Date.parse("2026-08-23T22:00:00Z"))).toISOString(),
		"2026-08-24T22:00:00.000Z",
	);
});

test("明示点灯待ちAPIは期限なしoverrideを保存し、点灯APIで解除できる", async (t) => {
	const previousUser = process.env.SIGNAGE_TIMER_USER;
	delete process.env.SIGNAGE_TIMER_USER;

	const display = require("../scripts/signage-timer/display.js");
	const originalPower = display.readPowerSaveMode;
	const originalDpms = display.readDpms;
	display.readPowerSaveMode = () => 1;
	display.readDpms = () => "Off";

	const state = { schedule: defaultSchedule(), override: null };
	const controller = {
		getState: () => state,
		getDecision: () => scheduleLogic.decide({
			now: Date.now(),
			timeZone: "Asia/Tokyo",
			schedule: state.schedule,
			override: state.override,
		}),
		setOverride: (override) => { state.override = override; },
	};
	const { handle } = require("../scripts/signage-timer/server.js");
	let statusCode;
	let responseBody;
	const response = {
		headersSent: false,
		writeHead: (code) => {
			statusCode = code;
			response.headersSent = true;
		},
		end: (body) => { responseBody = body; },
	};

	t.after(() => {
		display.readPowerSaveMode = originalPower;
		display.readDpms = originalDpms;
		if (previousUser === undefined) delete process.env.SIGNAGE_TIMER_USER;
		else process.env.SIGNAGE_TIMER_USER = previousUser;
	});

	await handle({
		method: "POST",
		url: "/api/display/off-until-on",
		headers: {},
		socket: { encrypted: false },
	}, response, controller);
	assert.equal(statusCode, 200);
	const body = JSON.parse(responseBody);
	assert.deepEqual(state.override, { kind: "off-until-on" });
	assert.equal(body.display, "off");
	assert.deepEqual(body.override, { kind: "off-until-on" });

	response.headersSent = false;
	await handle({
		method: "POST",
		url: "/api/display/on",
		headers: {},
		socket: { encrypted: false },
	}, response, controller);
	assert.equal(statusCode, 200);
	assert.equal(state.override.kind, "on");
	assert.equal(Number.isFinite(state.override.until), true);
	assert.equal(JSON.parse(responseBody).display, "on");
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
		}, response, {});

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
		}, response, {});

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
		}, response, {});
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
		}, response, {});
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
		}, response, {});
		assert.equal(response.statusCode, 404);
	});
});
