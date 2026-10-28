const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const HOST = "127.0.0.1";
const DEFAULT_PORT = 8081;
const DEFAULT_MAGICMIRROR_PORT = 8080;
const MAX_BODY_BYTES = 64 * 1024;
// 縮小画像の受け入れ上限とファイル名の長さ上限。MagicMirror が作るのは長辺1080pxの
// JPEG なので通常は数百KBに収まる。桁違いの値が来たら、相手が壊れているとみなす。
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_FILE_NAME_LENGTH = 512;
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

// この PC の中（127.0.0.1 / localhost）以外から開かれたか。リモコンが本人限定の注意を
// 出すかどうかに使う。Serve は Host を保ったまま渡すので、Tailnet から開けば Tailscale 側の名前になる。
// 本人ヘッダーが付いていれば Host に関係なく外からとみなし、判断できないときも外からに寄せる。
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
function isViaRemote(request) {
	if (request.headers["tailscale-user-login"]) return true;
	const host = request.headers.host;
	if (!host) return true;
	return !LOOPBACK_HOSTS.has(String(host).replace(/:\d+$/, ""));
}

function status(request) {
	return {
		authRequired: Boolean(process.env.SIGNAGE_TIMER_USER),
		viaRemote: isViaRemote(request),
	};
}

function magicMirrorPort() {
	// 環境変数を .env より優先する。MagicMirror の起動スクリプトと同じ順序にそろえてあり、
	// テストではここでダミーの相手へ向ける。
	const fromEnv = Number(process.env.SIGNAGE_PORT);
	if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv <= 65535) return fromEnv;
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

// MagicMirror（既定 8080）へ問い合わせる。操作（次へ・一時停止）は届いたかどうかだけを
// 見るので本文を捨て、表示履歴は本文が要るので読む。wantBody でその差だけを切り替える。
function requestMagicMirror(pathname, { wantBody = false } = {}) {
	return new Promise((resolve, reject) => {
		const request = http.get({
			host: HOST,
			port: magicMirrorPort(),
			path: pathname,
		}, (response) => {
			const ok = response.statusCode >= 200 && response.statusCode < 300;
			if (!ok || !wantBody) {
				response.resume();
				response.on("end", () => {
					if (ok) resolve(null);
					else reject(new Error(`MagicMirror が HTTP ${response.statusCode} を返しました`));
				});
				return;
			}
			let size = 0;
			const chunks = [];
			response.on("data", (chunk) => {
				size += chunk.length;
				// 画像が増えても返るのは直近10件だけ。上限を超えるのは相手が壊れたときなので、
				// 読み続けずその場で切る。
				if (size > MAX_BODY_BYTES) {
					request.destroy(new Error("MagicMirror の応答が大きすぎます"));
					return;
				}
				chunks.push(chunk);
			});
			response.on("end", () => {
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
				} catch {
					reject(new Error("MagicMirror の応答を JSON として読めません"));
				}
			});
		});
		request.setTimeout(5000, () => request.destroy(new Error("MagicMirror への接続がタイムアウトしました")));
		request.on("error", reject);
	});
}

// MagicMirror が持っている縮小画像を、そのままリモコンへ流す。本文を組み立てず
// 受け取ったバイト列を素通しする（リモコン側は <img src> で読むだけ）。
function pipeMagicMirror(pathname, response) {
	return new Promise((resolve, reject) => {
		const request = http.get({
			host: HOST,
			port: magicMirrorPort(),
			path: pathname,
		}, (upstream) => {
			if (upstream.statusCode !== 200) {
				upstream.resume();
				// まだ縮小できていない1枚は 404。相手の不調（502）と区別して返す。
				reject(Object.assign(
					new Error(upstream.statusCode === 404 ? "縮小画像がありません" : `MagicMirror が HTTP ${upstream.statusCode} を返しました`),
					{ statusCode: upstream.statusCode === 404 ? 404 : 502 },
				));
				return;
			}
			const length = Number(upstream.headers["content-length"]);
			if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) {
				upstream.destroy();
				reject(new Error("縮小画像が想定より大きすぎます"));
				return;
			}
			response.writeHead(200, {
				"Content-Type": "image/jpeg",
				"Cache-Control": "private, max-age=300",
				...(Number.isFinite(length) ? { "Content-Length": length } : {}),
			});
			upstream.pipe(response);
			upstream.on("end", resolve);
			upstream.on("error", reject);
		});
		request.setTimeout(5000, () => request.destroy(new Error("MagicMirror への接続がタイムアウトしました")));
		request.on("error", reject);
	});
}

function controlSlideshow(command) {
	return requestMagicMirror(`/yp-slideshow/control/${command}`);
}

async function handle(request, response) {
	if (!isRequestAllowed(request)) {
		sendJson(response, 403, { error: "このリクエストは許可されていません" });
		return;
	}

	const requestUrl = new URL(request.url, "http://localhost");
	const pathname = requestUrl.pathname;
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
		sendJson(response, 200, status(request));
		return;
	}
	// 表示履歴は /api/status に混ぜない。MagicMirror が止まっていると問い合わせが
	// タイムアウト（5秒）まで待つため、混ぜると5秒ごとの状態更新まで巻き込んで詰まる。
	if (request.method === "GET" && pathname === "/api/slideshow/now") {
		try {
			sendJson(response, 200, await requestMagicMirror("/yp-slideshow/now", { wantBody: true }));
		} catch (error) {
			sendJson(response, 502, { error: error.message });
		}
		return;
	}

	if (request.method === "GET" && pathname === "/api/slideshow/shot") {
		const file = requestUrl.searchParams.get("file") || "";
		const size = requestUrl.searchParams.get("size") === "preview" ? "preview" : "thumb";
		if (file.length === 0 || file.length > MAX_FILE_NAME_LENGTH) {
			sendJson(response, 400, { error: "file を指定してください" });
			return;
		}
		try {
			await pipeMagicMirror(`/yp-slideshow/shot?size=${size}&file=${encodeURIComponent(file)}`, response);
		} catch (error) {
			// 画像の送出が始まった後で切れた場合は、途中まで送った本文へ JSON を混ぜられない。
			if (response.headersSent) response.destroy();
			else sendJson(response, error.statusCode || 502, { error: error.message });
		}
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

function startServer() {
	const configuredPort = Number(process.env.SIGNAGE_TIMER_PORT || DEFAULT_PORT);
	if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
		throw new Error("SIGNAGE_TIMER_PORT は 1〜65535 の整数にしてください");
	}
	if (!process.env.SIGNAGE_TIMER_USER) {
		console.warn("[signage-timer] 警告: SIGNAGE_TIMER_USER が未設定のため、リモコンは本人限定になっていません");
	}

	const server = http.createServer((request, response) => {
		handle(request, response).catch((error) => {
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

module.exports = { startServer, handle };
