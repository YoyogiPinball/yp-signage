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
