/* state.js（画面タイマーの週間予定と一時上書きの保存）のテスト。
 *
 * 何を保証するか:
 *   - 状態ファイルが無い、JSON が壊れている、予定が不正、上書きが期限切れの各場合に、
 *     永久消灯へ倒れず、既定の週間予定を使えること
 *   - 壊れたファイルを .broken へ退避し、既定値で書き直すこと
 *   - 正常な予定と期限内の上書きを原子的な保存後も読み直せること
 *
 * 何は保証しないか（実機で見るしかないもの）:
 *   - Mutter の PowerSaveMode とカーネルの DPMS が実際に切り替わること
 *   - systemd ユーザーサービスから見た D-Bus セッションとの接続
 *
 * 走らせ方: リポジトリのルートで `node --test tests/`
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadState, saveState, defaultSchedule } = require("../scripts/signage-timer/state.js");

function useTemporaryState(t) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yp-signage-timer-"));
	const file = path.join(directory, "timer.json");
	const previous = process.env.SIGNAGE_TIMER_STATE;
	process.env.SIGNAGE_TIMER_STATE = file;
	t.after(() => {
		if (previous === undefined) delete process.env.SIGNAGE_TIMER_STATE;
		else process.env.SIGNAGE_TIMER_STATE = previous;
		fs.rmSync(directory, { recursive: true, force: true });
	});
	return file;
}

test("ファイルが無いときは既定の予定を返す", (t) => {
	useTemporaryState(t);
	assert.deepEqual(loadState(), { schedule: defaultSchedule(), override: null });
});

test("壊れた JSON は既定へ戻し broken へ退避する", (t) => {
	const file = useTemporaryState(t);
	fs.writeFileSync(file, "{not-json");

	assert.deepEqual(loadState(), { schedule: defaultSchedule(), override: null });
	assert.equal(fs.readFileSync(`${file}.broken`, "utf8"), "{not-json");
	assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
		schedule: defaultSchedule(),
		override: null,
	});
});

test("予定として不正な内容も既定へ戻す", (t) => {
	const file = useTemporaryState(t);
	fs.writeFileSync(file, JSON.stringify({ schedule: { 0: [] }, override: null }));

	assert.deepEqual(loadState(), { schedule: defaultSchedule(), override: null });
	assert.equal(fs.existsSync(`${file}.broken`), true);
});

test("期限切れの上書きは捨てる", (t) => {
	const file = useTemporaryState(t);
	fs.writeFileSync(file, JSON.stringify({
		schedule: defaultSchedule(),
		override: { kind: "off", until: Date.now() - 1 },
	}));

	assert.deepEqual(loadState(), { schedule: defaultSchedule(), override: null });
});

test("期限内の上書きは保たれる", (t) => {
	const file = useTemporaryState(t);
	const override = { kind: "off", until: Date.now() + 60_000 };
	fs.writeFileSync(file, JSON.stringify({ schedule: defaultSchedule(), override }));

	assert.deepEqual(loadState(), { schedule: defaultSchedule(), override });
});

test("保存して読み直すと同じ内容になる", (t) => {
	useTemporaryState(t);
	const state = {
		schedule: defaultSchedule(),
		override: { kind: "on", until: Date.now() + 60_000 },
	};

	saveState(state);
	assert.deepEqual(loadState(), state);
});
