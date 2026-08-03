/* 日本の祝日判定（依存ゼロ）。ブラウザ(front)と node(テスト)の両方で使える UMD 風。
 * 固定祝日 ＋ ハッピーマンデー ＋ 春分/秋分 ＋ 振替休日 ＋ 国民の休日 に対応。
 * 使い方: OshiHolidays.isHoliday(year, month[1-12], day) → true/false
 * 正本: ~/Batches/yp-signage/magicmirror/modules/MMM-MonthCal/holidays.js
 */
(function (root) {
	// 曜日（0=日 .. 6=土）。X13(JST)のローカル時刻で判定する。
	function dow(y, m, d) { return new Date(y, m - 1, d).getDay(); }

	// 春分・秋分の日（近似式・20〜21世紀で有効）。
	function springEquinox(y) { return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)); }
	function autumnEquinox(y) { return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)); }

	// その月の第 nth 曜日(weekday:0-6)の日にち。
	function nthWeekday(y, m, weekday, nth) {
		const first = dow(y, m, 1);
		return 1 + ((7 + weekday - first) % 7) + (nth - 1) * 7;
	}

	// 基本の祝日（振替・国民の休日は含まない）。
	function isBaseHoliday(y, m, d) {
		const fixed = {
			"1-1": 1, "2-11": 1, "2-23": 1, "4-29": 1,
			"5-3": 1, "5-4": 1, "5-5": 1, "8-11": 1, "11-3": 1, "11-23": 1,
		};
		if (fixed[m + "-" + d]) return true;
		if (m === 1 && d === nthWeekday(y, 1, 1, 2)) return true;   // 成人の日   1月第2月曜
		if (m === 7 && d === nthWeekday(y, 7, 1, 3)) return true;   // 海の日     7月第3月曜
		if (m === 9 && d === nthWeekday(y, 9, 1, 3)) return true;   // 敬老の日   9月第3月曜
		if (m === 10 && d === nthWeekday(y, 10, 1, 2)) return true; // スポーツの日 10月第2月曜
		if (m === 3 && d === springEquinox(y)) return true;        // 春分の日
		if (m === 9 && d === autumnEquinox(y)) return true;        // 秋分の日
		return false;
	}

	// y-m-d に delta 日足した [y,m,d]。
	function shift(y, m, d, delta) {
		const dt = new Date(y, m - 1, d + delta);
		return [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];
	}

	// 振替休日: 日曜が祝日のとき、その後の最初の非祝日を休みにする。
	function isSubstitute(y, m, d) {
		if (isBaseHoliday(y, m, d)) return false;
		let p = shift(y, m, d, -1);
		while (isBaseHoliday(p[0], p[1], p[2])) {
			if (dow(p[0], p[1], p[2]) === 0) return true; // 遡った連続祝日に日曜が含まれれば振替
			p = shift(p[0], p[1], p[2], -1);
		}
		return false;
	}

	// 国民の休日: 前後を祝日に挟まれた平日（日曜以外）を休みにする。
	function isSandwiched(y, m, d) {
		if (isBaseHoliday(y, m, d) || dow(y, m, d) === 0) return false;
		const prev = shift(y, m, d, -1);
		const next = shift(y, m, d, 1);
		return isBaseHoliday(prev[0], prev[1], prev[2]) && isBaseHoliday(next[0], next[1], next[2]);
	}

	function isHoliday(y, m, d) {
		return isBaseHoliday(y, m, d) || isSubstitute(y, m, d) || isSandwiched(y, m, d);
	}

	const api = { isHoliday, isBaseHoliday };
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	else root.OshiHolidays = api;
})(typeof window !== "undefined" ? window : this);
