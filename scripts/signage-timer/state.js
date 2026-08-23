const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateSchedule } = require("./schedule.js");

function defaultSchedule() {
	const weekdays = [
		{ from: "07:00", to: "10:00" },
		{ from: "12:00", to: "13:00" },
		{ from: "18:00", to: "25:00" },
	];
	const weekends = [{ from: "07:00", to: "25:00" }];
	return {
		0: weekends.map((range) => ({ ...range })),
		1: weekdays.map((range) => ({ ...range })),
		2: weekdays.map((range) => ({ ...range })),
		3: weekdays.map((range) => ({ ...range })),
		4: weekdays.map((range) => ({ ...range })),
		5: weekdays.map((range) => ({ ...range })),
		6: weekends.map((range) => ({ ...range })),
	};
}

function statePath() {
	return process.env.SIGNAGE_TIMER_STATE
		|| path.join(os.homedir(), ".local", "state", "yp-signage", "timer.json");
}

function normalizeSchedule(schedule) {
	const normalized = {};
	for (let day = 0; day < 7; day++) {
		normalized[day] = schedule[day].map(({ from, to }) => ({ from, to }));
	}
	return normalized;
}

function normalizeOverride(override, now) {
	if (!override || (override.kind !== "on" && override.kind !== "off")) return null;
	if (!Number.isFinite(override.until) || override.until <= now) return null;
	return { kind: override.kind, until: override.until };
}

function saveState({ schedule, override }) {
	const file = statePath();
	const dir = path.dirname(file);
	const temporary = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
	const errors = validateSchedule(schedule);
	if (errors.length > 0) throw new TypeError(errors.join("\n"));

	const body = `${JSON.stringify({
		schedule: normalizeSchedule(schedule),
		override: normalizeOverride(override, Date.now()),
	}, null, 2)}\n`;
	fs.mkdirSync(dir, { recursive: true });
	try {
		fs.writeFileSync(temporary, body);
		fs.renameSync(temporary, file);
	} finally {
		// rename 前に失敗しても、次回の読み出し対象ではない一時ファイルを残さない。
		try {
			fs.unlinkSync(temporary);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
}

function restoreBrokenFile(file, reason) {
	const fallback = { schedule: defaultSchedule(), override: null };
	console.warn(`[signage-timer] 状態ファイルが壊れています。既定の予定へ戻します: ${reason}`);
	try {
		// 壊れた上書きを残すと永久消灯になりうるため、予定と上書きを部分的に拾わず
		// 既定の予定へ戻す。ただし元の内容は黙って消さず、調査できる形で残す。
		fs.renameSync(file, `${file}.broken`);
		saveState(fallback);
	} catch (error) {
		console.warn(`[signage-timer] 壊れた状態ファイルの退避または書き直しに失敗しました: ${error.message}`);
	}
	return fallback;
}

function loadState() {
	const file = statePath();
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return { schedule: defaultSchedule(), override: null };
		return restoreBrokenFile(file, error.message);
	}

	const errors = validateSchedule(parsed && parsed.schedule);
	if (errors.length > 0) return restoreBrokenFile(file, errors.join("; "));

	return {
		schedule: normalizeSchedule(parsed.schedule),
		override: normalizeOverride(parsed.override, Date.now()),
	};
}

module.exports = { loadState, saveState, defaultSchedule };
