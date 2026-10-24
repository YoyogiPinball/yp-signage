const scheduleLogic = require("./schedule.js");
const display = require("./display.js");
const stateStore = require("./state.js");

const RECONCILE_INTERVAL_MS = 30 * 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const timeZone = process.env.SIGNAGE_TIMER_TZ || "Asia/Tokyo";
const displayControlSetting = process.env.SIGNAGE_DISPLAY_CONTROL ?? "true";
if (!["true", "false"].includes(displayControlSetting)) {
	throw new Error("SIGNAGE_DISPLAY_CONTROL は true または false にしてください");
}
const displayControlEnabled = displayControlSetting === "true";

let currentState = null;
let intervalTimer = null;
let evaluationTimer = null;
let stopping = false;

function isManualOff(override) {
	return Boolean(override && override.kind === "off-until-on");
}

function getState() {
	if (currentState === null) currentState = stateStore.loadState();
	return currentState;
}

function scheduleEvaluation(nextEvaluationAt, now) {
	if (evaluationTimer !== null) clearTimeout(evaluationTimer);
	evaluationTimer = null;
	if (nextEvaluationAt === null) return;

	// 長いタイマー一本に任せると時計が飛んだ際に取り残されるため、必ず現在時刻から
	// 計算し直し、30分以内に一度は予定を評価し直す。
	const delay = Math.max(0, Math.min(nextEvaluationAt - now, MAX_TIMEOUT_MS));
	evaluationTimer = setTimeout(reconcile, delay);
}

function reconcile() {
	if (!displayControlEnabled) return getDecision();
	const now = Date.now();
	const state = getState();
	const decision = scheduleLogic.decide({
		now,
		timeZone,
		schedule: state.schedule,
		override: state.override,
	});
	const desiredMode = decision.display === "on" ? 0 : 1;
	const actualMode = display.readPowerSaveMode();

	// 入力や GNOME が値を戻しても放置しない。実値を毎回読み、予定との差だけを直す。
	if (actualMode !== null && actualMode !== desiredMode && display.setPowerSaveMode(desiredMode)) {
		console.log(`[signage-timer] 画面を ${decision.display} にしました（${decision.reason}）`);
	}

	scheduleEvaluation(decision.nextEvaluationAt, now);
	return decision;
}

function getDecision() {
	if (!displayControlEnabled) return { display: null, reason: "disabled", nextEvaluationAt: null };
	const state = getState();
	return scheduleLogic.decide({
		now: Date.now(),
		timeZone,
		schedule: state.schedule,
		override: state.override,
	});
}

function setOverride(override) {
	if (!displayControlEnabled) throw new Error("画面制御は無効です");
	const state = getState();
	const nextState = { schedule: state.schedule, override };
	// 保存に失敗したときメモリだけ先行しないよう、永続化してから正本を差し替える。
	stateStore.saveState(nextState);
	currentState = nextState;
	return reconcile();
}

function setSchedule(schedule) {
	if (!displayControlEnabled) throw new Error("画面制御は無効です");
	const state = getState();
	const override = isManualOff(state.override)
		|| (state.override && state.override.until > Date.now())
		? state.override
		: null;
	const nextState = { schedule, override };
	// 予定と上書きを一緒に保存し、部分的な書き換えを作らない。
	stateStore.saveState(nextState);
	currentState = nextState;
	return reconcile();
}

function stop() {
	if (stopping) return;
	stopping = true;
	if (intervalTimer !== null) clearInterval(intervalTimer);
	if (evaluationTimer !== null) clearTimeout(evaluationTimer);
	// サービスを止めた結果だけで永久に黒画面が残らないよう、終了前は必ず点灯を要求する。
	if (displayControlEnabled) display.setPowerSaveMode(0);
	process.exit(0);
}

function start() {
	if (displayControlEnabled) {
		currentState = stateStore.loadState();
		reconcile();
		intervalTimer = setInterval(reconcile, RECONCILE_INTERVAL_MS);
	}
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
}

module.exports = { displayControlEnabled, start, stop, reconcile, getState, getDecision, setOverride, setSchedule };

if (require.main === module) {
	start();
	require("./server.js").startServer(module.exports);
}
