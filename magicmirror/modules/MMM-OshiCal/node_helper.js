/* MMM-OshiCal node_helper — 推しスケ ICS を取得し「今日・これからの予定」を整形して front へ返す。
 * MM の組み込み calendar では2段カード（名前/予定を別部品・時刻列を縦揃え）が作れないため自作。
 * ICS は行がシンプル（VEVENT ごとに SUMMARY / DTSTART / DTEND）なので依存無しで手解析する。
 * 時刻付きは DTSTART:...Z（UTC）運用のため JST(+9h) に変換。終日は VALUE=DATE。
 */
const NodeHelper = require("node_helper");

const JST_OFFSET = 9 * 60 * 60 * 1000;

module.exports = NodeHelper.create({
	socketNotificationReceived(notification, payload) {
		if (notification !== "OSHICAL_FETCH") return;
		this.fetchAndParse(payload.icsUrl, payload.maxEntries || 12);
	},

	async fetchAndParse(url, maxEntries) {
		let events = [];
		try {
			const res = await fetch(url);
			const text = await res.text();
			events = this.parseIcs(text, maxEntries);
		} catch (e) {
			console.error(`[MMM-OshiCal] 取得/解析エラー: ${e.message}`);
		}
		this.sendSocketNotification("OSHICAL_EVENTS", { events });
	},

	parseIcs(text, maxEntries) {
		// iCal の折り返し（行頭スペース/タブは前行の続き）を戻してから行分割。
		const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);

		const now = Date.now();
		const nowJst = new Date(now + JST_OFFSET);
		const todayKey = `${nowJst.getUTCFullYear()}-${nowJst.getUTCMonth() + 1}-${nowJst.getUTCDate()}`;

		const timed = [];
		const allday = [];
		let cur = null;

		for (const line of lines) {
			if (line === "BEGIN:VEVENT") { cur = {}; continue; }
			if (line === "END:VEVENT") {
				if (cur) this.classify(cur, todayKey, now, timed, allday);
				cur = null;
				continue;
			}
			if (!cur) continue;
			const idx = line.indexOf(":");
			if (idx < 0) continue;
			const keyPart = line.slice(0, idx); // 例: DTSTART;VALUE=DATE
			const val = line.slice(idx + 1);
			const key = keyPart.split(";")[0];
			if (key === "SUMMARY") cur.summary = this.unescapeText(val);
			else if (key === "DTSTART") { cur.dtstart = val; cur.startParams = keyPart; }
			else if (key === "DTEND") cur.dtend = val;
		}

		timed.sort((a, b) => a.ms - b.ms);
		// 終日は時刻付きの後ろに置く（モックアップの並びに合わせる）。
		return timed.concat(allday).slice(0, maxEntries).map((e) => ({ time: e.time, name: e.name, title: e.title }));
	},

	classify(ev, todayKey, now, timed, allday) {
		if (!ev.dtstart) return;
		const { name, title } = this.splitSummary(ev.summary || "");

		// 終日イベント（VALUE=DATE）。
		if (/VALUE=DATE/.test(ev.startParams || "")) {
			const m = ev.dtstart.match(/(\d{4})(\d{2})(\d{2})/);
			if (!m) return;
			const key = `${+m[1]}-${+m[2]}-${+m[3]}`;
			if (key === todayKey) allday.push({ time: "終日", name, title, ms: 0 });
			return;
		}

		// 時刻付きイベント。
		const startMs = this.toMs(ev.dtstart);
		if (startMs === null) return;
		const endMs = this.toMs(ev.dtend) ?? startMs + 60 * 60 * 1000; // DTEND 無しは +1h

		const startJst = new Date(startMs + JST_OFFSET);
		const key = `${startJst.getUTCFullYear()}-${startJst.getUTCMonth() + 1}-${startJst.getUTCDate()}`;

		// 今日 かつ まだ終わっていない（進行中/これから）だけ拾う。
		if (key === todayKey && endMs > now) {
			const hh = String(startJst.getUTCHours()).padStart(2, "0");
			const mm = String(startJst.getUTCMinutes()).padStart(2, "0");
			timed.push({ time: `${hh}:${mm}`, name, title, ms: startMs });
		}
	},

	// YYYYMMDDTHHMMSS(Z?) を UTC ミリ秒に。Z 無し（TZID等）は JST 壁時計として扱う。
	toMs(value) {
		if (!value) return null;
		const m = value.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/);
		if (!m) return null;
		const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
		return m[7] === "Z" ? base : base - JST_OFFSET;
	},

	splitSummary(summary) {
		const m = summary.match(/^【(.+?)】(.*)$/);
		if (m) return { name: m[1].trim(), title: m[2].trim() };
		return { name: summary.trim(), title: "" };
	},

	unescapeText(s) {
		return s.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
	},
});
