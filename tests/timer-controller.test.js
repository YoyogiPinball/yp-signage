/* index.js（画面タイマーの実画面との突き合わせ）のテスト。
 *
 * 何を保証するか:
 *   - 明示点灯待ちは予定や実画面の変化では解除されないこと
 *   - 外部要因で点灯しても再消灯し、保存した期限なし状態を保つこと
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("明示点灯待ちは外部要因で点灯しても消灯へ戻す", (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yp-signage-controller-"));
	const stateFile = path.join(directory, "timer.json");
	const previousState = process.env.SIGNAGE_TIMER_STATE;
	process.env.SIGNAGE_TIMER_STATE = stateFile;

	const display = require("../scripts/signage-timer/display.js");
	const originalRead = display.readPowerSaveMode;
	const originalSet = display.setPowerSaveMode;
	let actualMode = 0;
	const writes = [];
	display.readPowerSaveMode = () => actualMode;
	display.setPowerSaveMode = (mode) => {
		writes.push(mode);
		actualMode = mode;
		return true;
	};

	const controller = require("../scripts/signage-timer/index.js");
	t.after(() => {
		// 期限なし状態へ戻すと、テスト中に作った長い評価タイマーも解除される。
		controller.setOverride({ kind: "off-until-on" });
		display.readPowerSaveMode = originalRead;
		display.setPowerSaveMode = originalSet;
		if (previousState === undefined) delete process.env.SIGNAGE_TIMER_STATE;
		else process.env.SIGNAGE_TIMER_STATE = previousState;
		fs.rmSync(directory, { recursive: true, force: true });
	});

	controller.setOverride({ kind: "off-until-on" });
	assert.deepEqual(writes, [1]);
	assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")).override, { kind: "off-until-on" });

	// 実値が消灯のままなら、同じ命令は繰り返さない。
	controller.reconcile();
	controller.reconcile();
	assert.deepEqual(writes, [1]);

	// 外部要因で点灯しても上書きを解除せず、次の突き合わせで消灯へ戻す。
	actualMode = 0;
	const decision = controller.reconcile();
	const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
	assert.equal(decision.display, "off");
	assert.deepEqual(saved.override, { kind: "off-until-on" });
	assert.deepEqual(writes, [1, 1]);
});
