/* schedule.js（画面タイマーの週次判定）のテスト。
 *
 * 何を保証するか:
 *   - 曜日・半開区間・翌日越境・重複・隣接を週全体で均したうえで、現在の点灯状態を返すこと
 *   - nextEvaluationAt は次に再判定すべき時刻。状態が変わるとは限らない。
 *   - nextEffectiveChange は次に実際の状態が変わる時刻を返すこと
 *   - 当日に端点が無い場合も探索を打ち切らず、次の曜日の実効変化を見つけること
 *   - 有効期限付きの手動上書きが、スケジュールより優先されること
 *   - プロセスのタイムゾーンではなく、引数の IANA タイムゾーンを使うこと
 *
 * 何は保証しないか（上位層の責務）:
 *   - 画面の電源操作、タイマーの予約、設定ファイルの読み書き
 *   - 祝日、systemd、Web リモコンとの連携
 *
 * 走らせ方: リポジトリのルートで `node --test tests/`
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
	decide,
	validateSchedule,
	nextEffectiveChange,
} = require("../scripts/signage-timer/schedule.js");

function weekly(days = {}) {
	return Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, days[day] || []]));
}

function epoch(value) {
	return Date.parse(value);
}

test("7曜日がそろった空スケジュールは妥当とする", () => {
	assert.deepEqual(validateSchedule(weekly()), []);
});

test("欠けた曜日キーと範囲外の曜日キーを報告する", () => {
	const schedule = weekly();
	delete schedule[3];
	schedule[7] = [];
	const errors = validateSchedule(schedule);
	assert.ok(errors.some((message) => message.includes("曜日キー 3 がありません")));
	assert.ok(errors.some((message) => message.includes("範囲外")));
});

test("時刻は分単位の HH:MM だけを受け付ける", () => {
	const schedule = weekly({ 1: [
		{ from: "7:00", to: "08:00" },
		{ from: "09:00:00", to: "10:00" },
		{ from: "11:60", to: "12:00" },
	] });
	assert.equal(validateSchedule(schedule).length, 3);
});

test("from と to の範囲および前後関係を検査する", () => {
	const schedule = weekly({ 1: [
		{ from: "24:00", to: "25:00" },
		{ from: "23:00", to: "48:01" },
		{ from: "10:00", to: "10:00" },
		{ from: "12:00", to: "11:00" },
	] });
	const errors = validateSchedule(schedule);
	assert.ok(errors.some((message) => message.includes("24:00 未満")));
	assert.ok(errors.some((message) => message.includes("48:00 以下")));
	assert.equal(errors.filter((message) => message.includes("from より後")).length, 2);
});

test("重なりと隣接はバリデーションエラーにしない", () => {
	const schedule = weekly({ 1: [
		{ from: "07:00", to: "10:00" },
		{ from: "09:00", to: "12:00" },
		{ from: "12:00", to: "13:00" },
	] });
	assert.deepEqual(validateSchedule(schedule), []);
});

test("from ちょうどを点灯、to ちょうどを消灯とする", () => {
	const schedule = weekly({ 1: [{ from: "07:00", to: "10:00" }] });
	assert.equal(decide({ now: epoch("2025-01-05T22:00:00Z"), timeZone: "Asia/Tokyo", schedule, override: null }).display, "on");
	assert.equal(decide({ now: epoch("2025-01-06T01:00:00Z"), timeZone: "Asia/Tokyo", schedule, override: null }).display, "off");
});

test("境界ちょうどの now では次の境界を再判定時刻として返す", () => {
	const schedule = weekly({ 1: [{ from: "07:00", to: "10:00" }] });
	const result = decide({
		now: epoch("2025-01-05T22:00:00Z"), // 月曜 07:00（日本時間）
		timeZone: "Asia/Tokyo",
		schedule,
		override: null,
	});
	assert.equal(result.nextEvaluationAt, epoch("2025-01-06T01:00:00Z"));
});

test("翌日越境した時間帯は開始曜日の続きとして点灯する", () => {
	const schedule = weekly({ 1: [{ from: "23:00", to: "25:00" }] });
	const result = decide({
		now: epoch("2025-01-06T15:30:00Z"), // 火曜 00:30（日本時間）
		timeZone: "Asia/Tokyo",
		schedule,
		override: null,
	});
	assert.deepEqual(result, {
		display: "on",
		reason: "schedule",
		nextEvaluationAt: epoch("2025-01-06T16:00:00Z"),
	});
});

test("to の上限 48:00 まで開始曜日の時間帯として扱う", () => {
	const schedule = weekly({ 1: [{ from: "00:00", to: "48:00" }] });
	const result = decide({
		now: epoch("2025-01-07T03:00:00Z"), // 火曜 12:00（日本時間）
		timeZone: "Asia/Tokyo",
		schedule,
		override: null,
	});
	assert.equal(result.display, "on");
	assert.equal(result.nextEvaluationAt, epoch("2025-01-07T15:00:00Z"));
});

test("土曜始まりの to 48:00 は週をまたいで月曜 00:00 まで点灯する", () => {
	const schedule = weekly({ 6: [{ from: "00:00", to: "48:00" }] });
	const result = decide({
		now: epoch("2025-01-05T03:00:00Z"), // 日曜 12:00（日本時間）
		timeZone: "Asia/Tokyo",
		schedule,
		override: null,
	});
	assert.equal(result.display, "on");
	assert.equal(result.nextEvaluationAt, epoch("2025-01-05T15:00:00Z"));
});

test("越境と翌日の重複の途中では早期に消灯しない", () => {
	const schedule = weekly({
		1: [{ from: "18:00", to: "25:00" }],
		2: [{ from: "00:30", to: "02:00" }],
	});
	const result = decide({
		now: epoch("2025-01-06T15:45:00Z"), // 火曜 00:45（日本時間）
		timeZone: "Asia/Tokyo",
		schedule,
		override: null,
	});
	assert.equal(result.display, "on");
	assert.equal(result.nextEvaluationAt, epoch("2025-01-06T17:00:00Z"));
});

test("重なりを均した内側の端点を実効変化に数えない", () => {
	const schedule = weekly({ 1: [
		{ from: "07:00", to: "10:00" },
		{ from: "09:00", to: "12:00" },
	] });
	assert.equal(nextEffectiveChange({
		now: epoch("2025-01-05T23:00:00Z"), // 月曜 08:00（日本時間）
		timeZone: "Asia/Tokyo",
		schedule,
	}), epoch("2025-01-06T03:00:00Z"));
});

test("隣接を均した内側の端点を実効変化に数えない", () => {
	const schedule = weekly({ 1: [
		{ from: "07:00", to: "10:00" },
		{ from: "10:00", to: "12:00" },
	] });
	assert.equal(nextEffectiveChange({
		now: epoch("2025-01-05T23:00:00Z"),
		timeZone: "Asia/Tokyo",
		schedule,
	}), epoch("2025-01-06T03:00:00Z"));
});

test("今日に変更が無い日の夜も次の曜日まで探索する", () => {
	const schedule = weekly({ 3: [{ from: "07:00", to: "08:00" }] });
	assert.equal(nextEffectiveChange({
		now: epoch("2025-01-06T14:00:00Z"), // 月曜 23:00（日本時間）
		timeZone: "Asia/Tokyo",
		schedule,
	}), epoch("2025-01-07T22:00:00Z"));
});

test("週末と週頭にまたがる重複も一つの点灯区間に均す", () => {
	const schedule = weekly({
		6: [{ from: "23:00", to: "25:00" }],
		0: [{ from: "00:30", to: "02:00" }],
	});
	assert.equal(nextEffectiveChange({
		now: epoch("2025-01-04T15:45:00Z"), // 日曜 00:45（日本時間）
		timeZone: "Asia/Tokyo",
		schedule,
	}), epoch("2025-01-04T17:00:00Z"));
});

test("nextEffectiveChange が返す境界では表示状態が実際に変わる", () => {
	const schedule = weekly({ 0: [{ from: "02:30", to: "04:00" }] });
	const timeZone = "America/New_York";
	const boundary = nextEffectiveChange({
		now: epoch("2025-03-09T06:00:00Z"),
		timeZone,
		schedule,
	});

	// 夏時間開始で存在しない 02:30 は偽の境界になるため捨て、実際に消灯する 04:00 を返す。
	assert.equal(boundary, epoch("2025-03-09T08:00:00Z"));
	const before = decide({ now: boundary - 1, timeZone, schedule, override: null });
	const atBoundary = decide({ now: boundary, timeZone, schedule, override: null });
	assert.notEqual(before.display, atBoundary.display);
});

test("空スケジュールは常時消灯で次の変化を返さない", () => {
	assert.deepEqual(decide({
		now: epoch("2025-01-06T00:00:00Z"),
		timeZone: "Asia/Tokyo",
		schedule: weekly(),
		override: null,
	}), { display: "off", reason: "schedule", nextEvaluationAt: null });
});

test("全曜日の終日点灯は次の変化を返さない", () => {
	const schedule = weekly(Object.fromEntries(
		Array.from({ length: 7 }, (_, day) => [day, [{ from: "00:00", to: "24:00" }]]),
	));
	assert.deepEqual(decide({
		now: epoch("2025-01-06T00:00:00Z"),
		timeZone: "Asia/Tokyo",
		schedule,
		override: null,
	}), { display: "on", reason: "schedule", nextEvaluationAt: null });
});

test("有効な上書きは表示と理由を置き換える", () => {
	const now = epoch("2025-01-05T23:00:00Z"); // 月曜 08:00（日本時間）
	const schedule = weekly({ 1: [{ from: "07:00", to: "10:00" }] });
	assert.deepEqual(decide({
		now,
		timeZone: "Asia/Tokyo",
		schedule,
		override: { kind: "off", until: epoch("2025-01-06T00:00:00Z") },
	}), {
		display: "off",
		reason: "override",
		nextEvaluationAt: epoch("2025-01-06T00:00:00Z"),
	});
});

test("上書き中も先に来るスケジュール境界を次の再判定時刻として返す", () => {
	const schedule = weekly({ 1: [{ from: "07:00", to: "10:00" }] });
	const result = decide({
		now: epoch("2025-01-05T23:00:00Z"),
		timeZone: "Asia/Tokyo",
		schedule,
		override: { kind: "off", until: epoch("2025-01-06T02:00:00Z") },
	});
	assert.equal(result.nextEvaluationAt, epoch("2025-01-06T01:00:00Z"));
});

test("上書き中は再判定時刻を過ぎても期限まで表示が変わらない", () => {
	const schedule = weekly({ 1: [{ from: "07:00", to: "10:00" }] });
	const override = { kind: "off", until: epoch("2025-01-06T03:00:00Z") };
	const first = decide({
		now: epoch("2025-01-05T23:00:00Z"),
		timeZone: "Asia/Tokyo",
		schedule,
		override,
	});
	const afterEvaluation = decide({
		now: first.nextEvaluationAt + 1,
		timeZone: "Asia/Tokyo",
		schedule,
		override,
	});

	assert.equal(first.display, "off");
	assert.equal(afterEvaluation.display, first.display);
	assert.equal(afterEvaluation.nextEvaluationAt, override.until);
});

test("期限切れの上書きは無かったものとして扱う", () => {
	const now = epoch("2025-01-05T23:00:00Z");
	const schedule = weekly({ 1: [{ from: "07:00", to: "10:00" }] });
	assert.equal(decide({
		now,
		timeZone: "Asia/Tokyo",
		schedule,
		override: { kind: "off", until: now },
	}).reason, "schedule");
});

test("同じ epoch でも引数のタイムゾーンごとに曜日と時刻を判定する", () => {
	const now = epoch("2025-01-06T22:30:00Z");
	const schedule = weekly({ 2: [{ from: "07:00", to: "08:00" }] });
	assert.equal(decide({ now, timeZone: "Asia/Tokyo", schedule, override: null }).display, "on");
	assert.equal(decide({ now, timeZone: "UTC", schedule, override: null }).display, "off");
});

test("now と timeZone は暗黙の既定値へ落とさない", () => {
	assert.throws(() => nextEffectiveChange({ timeZone: "UTC", schedule: weekly() }), /now/);
	assert.throws(() => nextEffectiveChange({ now: 0, schedule: weekly() }), /timeZone/);
});

test("now は小数の epoch ミリ秒を拒否する", () => {
	assert.throws(() => decide({
		now: -0.5,
		timeZone: "UTC",
		schedule: weekly(),
		override: null,
	}), /now/);
	assert.throws(() => nextEffectiveChange({
		now: 0.5,
		timeZone: "UTC",
		schedule: weekly(),
	}), /now/);
});
