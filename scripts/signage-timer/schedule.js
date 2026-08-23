/* 画面タイマーの週次予定と一時上書きだけを扱う。
 * 時計・画面・タイマーは呼び出し側に残す。
 * nextEvaluationAt は次に再判定すべき時刻。状態が変わるとは限らない。
 *
 * 固定オフセットのタイムゾーンだけを完全に扱う。夏時間など時計移動のあるゾーンでは、
 * 予定上の境界を実時刻へ変換した前後で表示が変わる候補だけを返すため、偽の境界は返さない。
 * その代わり、時計移動そのものが起こす状態変化は取りこぼすことがある。
 */

const MINUTE_MS = 60 * 1000;
const DAY_MINUTES = 24 * 60;
const WEEK_MINUTES = 7 * DAY_MINUTES;

function parseTime(value) {
	const matched = typeof value === "string" ? /^(\d{2}):(\d{2})$/.exec(value) : null;
	if (!matched) return null;
	const hours = Number(matched[1]);
	const minutes = Number(matched[2]);
	if (minutes >= 60) return null;
	return hours * 60 + minutes;
}

function validateSchedule(schedule) {
	if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
		return ["schedule は曜日キー 0〜6 を持つオブジェクトにしてください"];
	}

	const errors = [];
	const keys = Object.keys(schedule);
	for (let day = 0; day < 7; day++) {
		if (!Object.hasOwn(schedule, day)) errors.push(`曜日キー ${day} がありません`);
	}
	for (const key of keys) {
		if (!/^[0-6]$/.test(key)) errors.push(`曜日キー ${JSON.stringify(key)} は 0〜6 の範囲外です`);
	}

	for (let day = 0; day < 7; day++) {
		if (!Object.hasOwn(schedule, day)) continue;
		const ranges = schedule[day];
		if (!Array.isArray(ranges)) {
			errors.push(`曜日キー ${day} の値は時間帯の配列にしてください`);
			continue;
		}

		for (let index = 0; index < ranges.length; index++) {
			const range = ranges[index];
			const label = `曜日キー ${day} の ${index + 1} 件目`;
			if (!range || typeof range !== "object" || Array.isArray(range)) {
				errors.push(`${label}は from と to を持つオブジェクトにしてください`);
				continue;
			}

			const from = parseTime(range.from);
			const to = parseTime(range.to);
			if (from === null) errors.push(`${label}の from は HH:MM 形式（分は 00〜59）にしてください`);
			if (to === null) errors.push(`${label}の to は HH:MM 形式（分は 00〜59）にしてください`);
			if (from !== null && (from < 0 || from >= DAY_MINUTES)) {
				errors.push(`${label}の from は 00:00 以上 24:00 未満にしてください`);
			}
			if (to !== null && (to < 0 || to > 2 * DAY_MINUTES)) {
				errors.push(`${label}の to は 48:00 以下にしてください`);
			}
			if (from !== null && to !== null
				&& from >= 0 && from < DAY_MINUTES && to >= 0 && to <= 2 * DAY_MINUTES
				&& to <= from) {
				errors.push(`${label}の to は from より後にしてください`);
			}
		}
	}

	return errors;
}

function assertInputs(now, timeZone, schedule) {
	if (!Number.isInteger(now)) throw new TypeError("now は整数の epoch ミリ秒で指定してください");
	if (typeof timeZone !== "string" || timeZone.length === 0) {
		throw new TypeError("timeZone は IANA タイムゾーン名で指定してください");
	}
	const errors = validateSchedule(schedule);
	if (errors.length > 0) throw new TypeError(errors.join("\n"));
}

function mergeWeeklyRanges(schedule) {
	const ranges = [];
	for (let day = 0; day < 7; day++) {
		for (const range of schedule[day]) {
			const start = day * DAY_MINUTES + parseTime(range.from);
			const end = day * DAY_MINUTES + parseTime(range.to);
			if (end <= WEEK_MINUTES) {
				ranges.push([start, end]);
			} else {
				// 土曜から翌週へ出た部分だけを週頭へ折り返す。開始曜日の予定を
				// 翌日の予定として複製すると、翌週にも余分な点灯区間が生まれる。
				ranges.push([start, WEEK_MINUTES], [0, end - WEEK_MINUTES]);
			}
		}
	}

	ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
	const merged = [];
	for (const range of ranges) {
		const last = merged[merged.length - 1];
		if (last && range[0] <= last[1]) {
			last[1] = Math.max(last[1], range[1]);
		} else {
			merged.push(range.slice());
		}
	}
	return merged;
}

function minuteInWeek(minute) {
	return ((minute % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;
}

function isOnAtMinute(ranges, minute) {
	const normalized = minuteInWeek(minute);
	return ranges.some(([start, end]) => normalized >= start && normalized < end);
}

function effectiveBoundaries(ranges) {
	const candidates = new Set();
	for (const [start, end] of ranges) {
		candidates.add(minuteInWeek(start));
		candidates.add(minuteInWeek(end));
	}
	// 週末と週頭が両方 on の場合、0:00 は配列上の端でも実際の状態は変わらない。
	// 各候補の直前と直後を比べれば、同じ考え方で重複・隣接の内側も除外できる。
	return [...candidates]
		.filter((minute) => isOnAtMinute(ranges, minute - 1 / MINUTE_MS) !== isOnAtMinute(ranges, minute))
		.sort((left, right) => left - right);
}

function createFormatter(timeZone) {
	return new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
}

function zonedParts(epoch, formatter) {
	const values = {};
	for (const part of formatter.formatToParts(new Date(epoch))) {
		if (part.type !== "literal") values[part.type] = Number(part.value);
	}
	return values;
}

function zoneOffsetAt(epoch, formatter) {
	const parts = zonedParts(epoch, formatter);
	const representedAsUtc = Date.UTC(
		parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second,
	);
	return representedAsUtc - epoch;
}

function wallTimeToEpoch(target, formatter) {
	const wallEpoch = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
	// 壁時計時刻をいったん UTC として置き、得た候補ではオフセットが変わりうるため
	// もう一度引き直す。時計移動の曖昧さはここで解かず、境界前後の表示検証で誤答を捨てる。
	const firstEpoch = wallEpoch - zoneOffsetAt(wallEpoch, formatter);
	return wallEpoch - zoneOffsetAt(firstEpoch, formatter);
}

function shiftDate(date, days) {
	const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
	};
}

function nextBoundaryEpoch(now, formatter, ranges, boundaries) {
	if (boundaries.length === 0) return null;
	const current = zonedParts(now, formatter);
	const today = { year: current.year, month: current.month, day: current.day };
	const weekday = new Date(Date.UTC(current.year, current.month - 1, current.day)).getUTCDay();
	const sunday = shiftDate(today, -weekday);
	let next = null;

	for (const boundary of boundaries) {
		const day = Math.floor(boundary / DAY_MINUTES);
		const minute = boundary % DAY_MINUTES;
		for (let week = 0; week <= 2; week++) {
			const date = shiftDate(sunday, day + week * 7);
			const epoch = wallTimeToEpoch({
				...date,
				hour: Math.floor(minute / 60),
				minute: minute % 60,
			}, formatter);
			if (epoch <= now) continue;
			// 時計飛びや日付消滅で壁時計上の端点が別の実時刻へずれても、再評価して
			// 表示が変わらない候補は偽の境界なので返さない。この検証で誤答を防ぐ代わりに、
			// 時計移動そのものが起こす表示変化は予定の端点に無いため取りこぼしうる。
			if (scheduleState(epoch - 1, formatter, ranges) === scheduleState(epoch, formatter, ranges)) {
				continue;
			}
			if (next === null || epoch < next) next = epoch;
		}
	}
	return next;
}

function scheduleState(now, formatter, ranges) {
	const parts = zonedParts(now, formatter);
	const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
	const milliseconds = ((now % 1000) + 1000) % 1000;
	const minute = weekday * DAY_MINUTES + parts.hour * 60 + parts.minute
		+ (parts.second * 1000 + milliseconds) / MINUTE_MS;
	return isOnAtMinute(ranges, minute) ? "on" : "off";
}

function nextEffectiveChange({ now, timeZone, schedule }) {
	assertInputs(now, timeZone, schedule);
	const formatter = createFormatter(timeZone);
	const ranges = mergeWeeklyRanges(schedule);
	return nextBoundaryEpoch(now, formatter, ranges, effectiveBoundaries(ranges));
}

// decide の nextEvaluationAt は次に再判定すべき時刻。状態が変わるとは限らない。
function decide({ now, timeZone, schedule, override }) {
	assertInputs(now, timeZone, schedule);
	const formatter = createFormatter(timeZone);
	const ranges = mergeWeeklyRanges(schedule);
	const scheduleNext = nextBoundaryEpoch(now, formatter, ranges, effectiveBoundaries(ranges));
	const validOverride = override
		&& (override.kind === "on" || override.kind === "off")
		&& Number.isFinite(override.until)
		&& override.until > now;

	if (validOverride) {
		return {
			display: override.kind,
			reason: "override",
			nextEvaluationAt: scheduleNext === null ? override.until : Math.min(override.until, scheduleNext),
		};
	}
	return {
		display: scheduleState(now, formatter, ranges),
		reason: "schedule",
		nextEvaluationAt: scheduleNext,
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { decide, validateSchedule, nextEffectiveChange };
}
