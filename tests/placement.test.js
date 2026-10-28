/* mm-placement.js（モニター構成が変わったあとの出し直し）のテスト。
 *
 * 何を保証するか:
 *   - 構成の変化が続けて届いても、落ち着いてから1回だけ判定すること
 *   - 別のモニターに載っているときだけ出し直し、ok / skip では触らないこと
 *   - 出し直しが続けて走らないよう、間隔を空けること
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const placement = require("../scripts/mm-placement.js");

function fakeClock() {
	let now = 0;
	let pending = [];
	return {
		now: () => now,
		setTimer(callback, delay) {
			const entry = { at: now + delay, callback };
			pending.push(entry);
			return entry;
		},
		clearTimer(entry) {
			pending = pending.filter((item) => item !== entry);
		},
		async advance(ms) {
			now += ms;
			const due = pending.filter((item) => item.at <= now);
			pending = pending.filter((item) => item.at > now);
			for (const item of due) await item.callback();
		},
	};
}

function setup(results) {
	const clock = fakeClock();
	const calls = { check: 0, restart: 0 };
	const watcher = placement.createPlacementWatcher({
		check: async () => {
			calls.check += 1;
			return results.shift() ?? "ok";
		},
		restart: async () => {
			calls.restart += 1;
		},
		now: clock.now,
		setTimer: clock.setTimer,
		clearTimer: clock.clearTimer,
	});
	return { clock, calls, watcher };
}

test("構成の変化が続けて届いたら、最後の変化から落ち着いたあとに1回だけ判定する", async () => {
	const { clock, calls, watcher } = setup(["misplaced"]);
	watcher.onMonitorsChanged();
	await clock.advance(placement.SETTLE_MS - 1);
	watcher.onMonitorsChanged();
	await clock.advance(placement.SETTLE_MS - 1);
	assert.equal(calls.check, 0);
	await clock.advance(1);
	assert.equal(calls.check, 1);
	assert.equal(calls.restart, 1);
});

test("ok と skip では出し直さない", async () => {
	const { clock, calls, watcher } = setup(["ok", "skip"]);
	watcher.onMonitorsChanged();
	await clock.advance(placement.SETTLE_MS);
	watcher.onMonitorsChanged();
	await clock.advance(placement.SETTLE_MS);
	assert.equal(calls.check, 2);
	assert.equal(calls.restart, 0);
});

test("出し直したあとは間隔が空くまで次の出し直しをしない", async () => {
	const { clock, calls, watcher } = setup(["misplaced", "misplaced", "misplaced"]);
	watcher.onMonitorsChanged();
	await clock.advance(placement.SETTLE_MS);
	assert.equal(calls.restart, 1);
	watcher.onMonitorsChanged();
	await clock.advance(placement.SETTLE_MS);
	assert.equal(calls.restart, 1);
	await clock.advance(placement.RESTART_COOLDOWN_MS);
	watcher.onMonitorsChanged();
	await clock.advance(placement.SETTLE_MS);
	assert.equal(calls.restart, 2);
});

test("止めたあとに届いた変化では判定しない", async () => {
	const { clock, calls, watcher } = setup(["misplaced"]);
	watcher.onMonitorsChanged();
	watcher.cancel();
	await clock.advance(placement.SETTLE_MS);
	assert.equal(calls.check, 0);
});
