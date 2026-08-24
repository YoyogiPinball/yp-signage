const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { nextEffectiveChange, validateSchedule } = require("./schedule.js");
const display = require("./display.js");

const HOST = "127.0.0.1";
const DEFAULT_PORT = 8081;
const DEFAULT_MAGICMIRROR_PORT = 8080;
const TIME_ZONE = process.env.SIGNAGE_TIMER_TZ || "Asia/Tokyo";
const MAX_BODY_BYTES = 64 * 1024;
const remoteHtml = fs.readFileSync(path.join(__dirname, "remote.html"));

function sendJson(response, statusCode, value) {
	const body = Buffer.from(`${JSON.stringify(value)}\n`);
	response.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": body.length,
		"Cache-Control": "no-store",
	});
	response.end(body);
}

function requestOrigin(request) {
	const forwarded = request.headers["x-forwarded-proto"];
	const protocol = forwarded
		? String(forwarded).split(",", 1)[0].trim()
		// Serve の公開側は HTTPS。プロトコル転送ヘッダーが無い構成でも、Serve が
		// 付けた本人ヘッダーがあればブラウザから見たオリジンを HTTPS と判断できる。
		: (request.headers["tailscale-user-login"] || request.socket.encrypted ? "https" : "http");
	return request.headers.host ? `${protocol}://${request.headers.host}` : null;
}

// 待受は localhost だけで、外からは Tailscale Serve を通った本人だけを入れる。
// Serve は受信した Tailscale-User-Login を削除して認証済みユーザーの値を付け直すため、
// SIGNAGE_TIMER_USER と一致した要求だけを信用できる。未設定時だけ導入前の手元確認を許す。
function isRequestAllowed(request) {
	const allowedUser = process.env.SIGNAGE_TIMER_USER;
	if (allowedUser) {
		const login = request.headers["tailscale-user-login"];
		if (typeof login !== "string" || login !== allowedUser) return false;
	}

	if (request.method !== "GET" && request.headers.origin) {
		if (request.headers.origin !== requestOrigin(request)) return false;
	}
	return true;
}

function readJson(request) {
	return new Promise((resolve, reject) => {
		let size = 0;
		let tooLarge = false;
		const chunks = [];
		request.on("data", (chunk) => {
			size += chunk.length;
			if (!tooLarge && size > MAX_BODY_BYTES) {
				tooLarge = true;
				reject(Object.assign(new Error("本文が大きすぎます"), { statusCode: 413 }));
				return;
			}
			if (!tooLarge) chunks.push(chunk);
		});
		request.on("end", () => {
			if (tooLarge) return;
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(Object.assign(new Error("本文を JSON として読めません"), { statusCode: 400 }));
			}
		});
		request.on("error", reject);
	});
}

function status(controller) {
	const state = controller.getState();
	const decision = controller.getDecision();
	return {
		display: decision.display,
		reason: decision.reason,
		nextEvaluationAt: decision.nextEvaluationAt,
		override: decision.reason === "override" ? state.override : null,
		powerSaveMode: display.readPowerSaveMode(),
		dpms: display.readDpms(),
		schedule: state.schedule,
		timeZone: TIME_ZONE,
		authRequired: Boolean(process.env.SIGNAGE_TIMER_USER),
	};
}

function overrideUntilNextChange(controller) {
	const now = Date.now();
	const next = nextEffectiveChange({
		now,
		timeZone: TIME_ZONE,
		schedule: controller.getState().schedule,
	});
	// 変化しない週でも期限なしにせず、手動状態が残り続ける事故を避ける。
	return next === null ? now + 24 * 60 * 60 * 1000 : next;
}

function zonedParts(epoch, formatter) {
	const result = {};
	for (const part of formatter.formatToParts(new Date(epoch))) {
		if (part.type !== "literal") result[part.type] = Number(part.value);
	}
	return result;
}

function nextMorning(now) {
	const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
		timeZone: TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
	const today = zonedParts(now, formatter);
	// 未明に押したときは同日の朝、それ以降は翌日の朝を期限にする。
	// 07:00 ちょうどはすでに到来済みなので、次に来る翌日の 07:00 を選ぶ。
	const targetDay = new Date(Date.UTC(
		today.year,
		today.month - 1,
		today.day + (today.hour < 7 ? 0 : 1),
	));
	const wallEpoch = Date.UTC(
		targetDay.getUTCFullYear(),
		targetDay.getUTCMonth(),
		targetDay.getUTCDate(),
		7,
	);
	const offsetAt = (epoch) => {
		const parts = zonedParts(epoch, formatter);
		return Date.UTC(
			parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second,
		) - epoch;
	};
	// 対象日のオフセットが今日と違う場合も扱えるよう、候補地点でもう一度引き直す。
	const first = wallEpoch - offsetAt(wallEpoch);
	return wallEpoch - offsetAt(first);
}

function magicMirrorPort() {
	try {
		const env = fs.readFileSync(path.join(os.homedir(), "MagicMirror", ".env"), "utf8");
		const matched = /^\s*SIGNAGE_PORT\s*=\s*([0-9]+).*$/m.exec(env);
		if (matched) {
			const port = Number(matched[1]);
			if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
		}
	} catch (error) {
		if (error.code !== "ENOENT") {
			console.warn(`[signage-timer] MagicMirror のポートを読めません: ${error.message}`);
		}
	}
	return DEFAULT_MAGICMIRROR_PORT;
}

function controlSlideshow(command) {
	return new Promise((resolve, reject) => {
		const request = http.get({
			host: HOST,
			port: magicMirrorPort(),
			path: `/yp-slideshow/control/${command}`,
		}, (response) => {
			response.resume();
			response.on("end", () => {
				if (response.statusCode >= 200 && response.statusCode < 300) resolve();
				else reject(new Error(`MagicMirror が HTTP ${response.statusCode} を返しました`));
			});
		});
		request.setTimeout(5000, () => request.destroy(new Error("MagicMirror への接続がタイムアウトしました")));
		request.on("error", reject);
	});
}

async function handle(request, response, controller) {
	if (!isRequestAllowed(request)) {
		sendJson(response, 403, { error: "このリクエストは許可されていません" });
		return;
	}

	const pathname = new URL(request.url, "http://localhost").pathname;
	if (request.method === "GET" && pathname === "/") {
		response.writeHead(200, {
			"Content-Type": "text/html; charset=utf-8",
			"Content-Length": remoteHtml.length,
			"Cache-Control": "no-store",
		});
		response.end(remoteHtml);
		return;
	}
	if (request.method === "GET" && pathname === "/api/status") {
		sendJson(response, 200, status(controller));
		return;
	}

	if (request.method === "POST" && (pathname === "/api/display/on" || pathname === "/api/display/off")) {
		const kind = pathname.endsWith("/on") ? "on" : "off";
		controller.setOverride({ kind, until: overrideUntilNextChange(controller) });
		sendJson(response, 200, status(controller));
		return;
	}
	if (request.method === "POST" && pathname === "/api/display/off-until-morning") {
		controller.setOverride({ kind: "off", until: nextMorning(Date.now()) });
		sendJson(response, 200, status(controller));
		return;
	}
	if (request.method === "POST" && pathname === "/api/display/off-until-on") {
		controller.setOverride({ kind: "off-until-on" });
		sendJson(response, 200, status(controller));
		return;
	}
	if (request.method === "DELETE" && pathname === "/api/override") {
		controller.setOverride(null);
		sendJson(response, 200, status(controller));
		return;
	}
	if (request.method === "PUT" && pathname === "/api/schedule") {
		const schedule = await readJson(request);
		const errors = validateSchedule(schedule);
		if (errors.length > 0) {
			sendJson(response, 400, { errors });
			return;
		}
		controller.setSchedule(schedule);
		sendJson(response, 200, status(controller));
		return;
	}

	const slideshow = /^\/api\/slideshow\/(pause|resume|next|prev)$/.exec(pathname);
	if (request.method === "POST" && slideshow) {
		try {
			await controlSlideshow(slideshow[1]);
			sendJson(response, 200, { ok: true, cmd: slideshow[1] });
		} catch (error) {
			sendJson(response, 502, { error: error.message });
		}
		return;
	}

	sendJson(response, 404, { error: "見つかりません" });
}

function startServer(controller) {
	const configuredPort = Number(process.env.SIGNAGE_TIMER_PORT || DEFAULT_PORT);
	if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
		throw new Error("SIGNAGE_TIMER_PORT は 1〜65535 の整数にしてください");
	}
	if (!process.env.SIGNAGE_TIMER_USER) {
		console.warn("[signage-timer] 警告: SIGNAGE_TIMER_USER が未設定のため、リモコンは本人限定になっていません");
	}

	const server = http.createServer((request, response) => {
		handle(request, response, controller).catch((error) => {
			if (response.headersSent) {
				response.destroy();
				return;
			}
			sendJson(response, error.statusCode || 500, { error: error.message || "サーバー内部エラー" });
		});
	});
	server.listen(configuredPort, HOST, () => {
		console.log(`[signage-timer] リモコンを http://${HOST}:${configuredPort} で待ち受けます`);
	});
	return server;
}

module.exports = { startServer, handle, nextMorning };
