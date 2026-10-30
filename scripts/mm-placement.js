// モニター構成が変わったあと、サイネージの窓が出すはずのモニターから外れていたら出し直す。
// signage-placement.service が常駐させる（配布先は ~/run/mm-placement.js）。
//
// スリープ復帰では画面がそろって戻らない（dGPU につながった画面は数秒遅れる）。その間に
// Mutter は消えた画面の窓を残った画面へ移し、画面が戻っても元へは返さない。窓の位置は
// mm-start.sh が起動時に決めるので、外れたときは mm-start.sh で起動し直す。
//
// 出すモニターそのものが画面配置から外れたときは、残った画面（作業用のメイン画面など）を
// 覆わないよう mm-stop.sh で止め、戻ったら起動し直す。起動し直すのはここで止めたときだけで、
// 利用者が手で止めたサイネージは起こさない。
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");

const SETTLE_MS = 5000;
const RESTART_COOLDOWN_MS = 2 * 60 * 1000;
const RESPAWN_MS = 10 * 1000;
const COMMAND_TIMEOUT_MS = 30 * 1000;
const SCRIPTS_DIR = __dirname;

function createPlacementWatcher({ check, restart, stop, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
	let timer = null;
	let lastRestartAt = -Infinity;
	let stoppedForAbsence = false;

	async function settle() {
		timer = null;
		const result = await check();
		if (result === "absent") {
			stoppedForAbsence = true;
			console.log("[signage-placement] 出すモニターが無くなったため、サイネージを止めます");
			await stop();
			return;
		}
		if (result === "stopped") {
			if (!stoppedForAbsence) return;
			stoppedForAbsence = false;
			lastRestartAt = now();
			console.log("[signage-placement] 出すモニターが戻ったため、サイネージを起動します");
			// 起動に失敗したら、次の構成の変化でもう一度起動できるよう止めた印を残す。
			if ((await restart()) === null) stoppedForAbsence = true;
			return;
		}
		// 動いている（ok / misplaced）なら、止めたあとに利用者が起動し直している。
		if (result === "ok" || result === "misplaced") stoppedForAbsence = false;
		if (result !== "misplaced") return;
		if (now() - lastRestartAt < RESTART_COOLDOWN_MS) {
			console.warn("[signage-placement] サイネージが別のモニターにありますが、直前に出し直したばかりなので見送ります");
			return;
		}
		lastRestartAt = now();
		console.log("[signage-placement] サイネージが別のモニターにあるため、出し直します");
		await restart();
	}

	return {
		onMonitorsChanged() {
			if (timer !== null) clearTimer(timer);
			timer = setTimer(settle, SETTLE_MS);
		},
		cancel() {
			if (timer !== null) clearTimer(timer);
			timer = null;
		},
	};
}

function runScript(name) {
	return new Promise((resolve) => {
		execFile("bash", [path.join(SCRIPTS_DIR, name)], { encoding: "utf8", timeout: COMMAND_TIMEOUT_MS }, (error, stdout, stderr) => {
			if (error) console.warn(`[signage-placement] ${name} に失敗しました: ${(stderr || error.message).trim().replaceAll("\n", " ")}`);
			resolve(error ? null : stdout.trim());
		});
	});
}

async function checkPlacement() {
	const output = await runScript("mm-placement.sh");
	if (output === null) return "skip";
	if (output.startsWith("skip")) return "skip";
	return output;
}

let monitor = null;
let respawnTimer = null;
let watcher = null;

function startMonitor() {
	monitor = spawn("gdbus", [
		"monitor",
		"--session",
		"--dest", "org.gnome.Mutter.DisplayConfig",
		"--object-path", "/org/gnome/Mutter/DisplayConfig",
	], { stdio: ["ignore", "pipe", "ignore"] });
	monitor.stdout.setEncoding("utf8");
	monitor.stdout.on("data", (chunk) => {
		if (/\.MonitorsChanged\b/.test(chunk)) watcher.onMonitorsChanged();
	});
	monitor.on("error", (error) => console.warn(`[signage-placement] モニター構成の監視を始められません: ${error.message}`));
	// GNOME の再起動などで監視が切れても、少し待って張り直す。
	monitor.on("exit", () => {
		monitor = null;
		if (watcher !== null) respawnTimer = setTimeout(startMonitor, RESPAWN_MS);
	});
}

function watch() {
	watcher = createPlacementWatcher({
		check: checkPlacement,
		restart: () => runScript("mm-start.sh"),
		stop: () => runScript("mm-stop.sh"),
	});
	startMonitor();
}

function stopWatching() {
	if (watcher !== null) watcher.cancel();
	watcher = null;
	if (respawnTimer !== null) clearTimeout(respawnTimer);
	respawnTimer = null;
	if (monitor !== null) monitor.kill();
}

module.exports = { SETTLE_MS, RESTART_COOLDOWN_MS, createPlacementWatcher, watch, stopWatching };

if (require.main === module) {
	watch();
	for (const signal of ["SIGTERM", "SIGINT"]) {
		process.on(signal, () => {
			stopWatching();
			process.exit(0);
		});
	}
}
