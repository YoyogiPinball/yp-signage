const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DISPLAY_CONFIG_DEST = "org.gnome.Mutter.DisplayConfig";
const DISPLAY_CONFIG_PATH = "/org/gnome/Mutter/DisplayConfig";
const DISPLAY_CONFIG_INTERFACE = "org.gnome.Mutter.DisplayConfig";
const PROPERTIES_INTERFACE = "org.freedesktop.DBus.Properties";
const COMMAND_TIMEOUT_MS = 5000;

function sessionEnvironment() {
	const env = { ...process.env };
	const runtimeDir = env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
	env.XDG_RUNTIME_DIR = runtimeDir;
	env.DBUS_SESSION_BUS_ADDRESS = env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${runtimeDir}/bus`;
	return env;
}

function runGdbus(method, extraArguments) {
	return execFileSync("gdbus", [
		"call",
		"--session",
		"--dest", DISPLAY_CONFIG_DEST,
		"--object-path", DISPLAY_CONFIG_PATH,
		"--method", `${PROPERTIES_INTERFACE}.${method}`,
		...extraArguments,
	], {
		encoding: "utf8",
		timeout: COMMAND_TIMEOUT_MS,
		env: sessionEnvironment(),
	});
}

function warn(action, error) {
	const reason = error instanceof Error ? error.message : String(error);
	console.warn(`[signage-timer] ${action}に失敗しました: ${reason.replaceAll("\n", " ")}`);
}

function readPowerSaveMode() {
	try {
		const output = runGdbus("Get", [DISPLAY_CONFIG_INTERFACE, "PowerSaveMode"]);
		const matched = /^\(\s*<([0-3])>\s*,\s*\)\s*$/.exec(output);
		if (!matched) {
			warn("PowerSaveMode の読み取り", `想定外の応答 ${JSON.stringify(output.trim())}`);
			return null;
		}
		return Number(matched[1]);
	} catch (error) {
		warn("PowerSaveMode の読み取り", error);
		return null;
	}
}

function setPowerSaveMode(value) {
	if (!Number.isInteger(value) || value < 0 || value > 3) {
		warn("PowerSaveMode の書き込み", `値 ${JSON.stringify(value)} は 0〜3 の整数ではありません`);
		return false;
	}

	try {
		runGdbus("Set", [DISPLAY_CONFIG_INTERFACE, "PowerSaveMode", `<int32 ${value}>`]);
		return true;
	} catch (error) {
		warn("PowerSaveMode の書き込み", error);
		return false;
	}
}

function readDpms() {
	const drmDir = "/sys/class/drm";
	try {
		for (const entry of fs.readdirSync(drmDir, { withFileTypes: true })) {
			// 無効化していても connected のままになる内蔵パネルは常に Off を返しうるため、
			// 外部画面の実状態として採用しない。名前は Linux DRM の慣習だけを見る。
			if (/(?:eDP|LVDS|DSI)/i.test(entry.name)) continue;
			const connectorDir = path.join(drmDir, entry.name);
			try {
				if (fs.readFileSync(path.join(connectorDir, "status"), "utf8").trim() !== "connected") continue;
				const dpms = fs.readFileSync(path.join(connectorDir, "dpms"), "utf8").trim();
				if (dpms === "On" || dpms === "Off") return dpms;
			} catch {
				// status を持たない項目や、走査中に抜かれたコネクタは次を探せばよい。
			}
		}
		warn("DPMS の読み取り", "connected かつ On/Off を返すコネクタがありません");
		return null;
	} catch (error) {
		warn("DPMS の読み取り", error);
		return null;
	}
}

module.exports = { readPowerSaveMode, setPowerSaveMode, readDpms };
