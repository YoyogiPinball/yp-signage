const scheduleLogic = require("./schedule.js");
const display = require("./display.js");
const stateStore = require("./state.js");

const RECONCILE_INTERVAL_MS = 30 * 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const timeZone = process.env.SIGNAGE_TIMER_TZ || "Asia/Tokyo";

let currentState = null;
let intervalTimer = null;
let evaluationTimer = null;
let stopping = false;

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
	const state = getState();
	return scheduleLogic.decide({
		now: Date.now(),
		timeZone,
		schedule: state.schedule,
		override: state.override,
	});
}

function setOverride(override) {
	const state = getState();
	const nextState = { schedule: state.schedule, override };
	// 保存に失敗したときメモリだけ先行しないよう、永続化してから正本を差し替える。
	stateStore.saveState(nextState);
	currentState = nextState;
	return reconcile();
}

function setSchedule(schedule) {
	const state = getState();
	const override = state.override && state.override.until > Date.now() ? state.override : null;
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
	display.setPowerSaveMode(0);
	process.exit(0);
}

function start() {
	currentState = stateStore.loadState();
	reconcile();
	intervalTimer = setInterval(reconcile, RECONCILE_INTERVAL_MS);
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
}

module.exports = { reconcile, getState, getDecision, setOverride, setSchedule };

if (require.main === module) {
	start();
	require("./server.js").startServer(module.exports);
}
