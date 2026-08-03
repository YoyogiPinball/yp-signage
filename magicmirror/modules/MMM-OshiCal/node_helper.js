/* MMM-OshiCal node_helper — 推しスケ ICS を取得し「今から先の予定」を日ごとに整形して front へ返す。
 * MM の組み込み calendar では2段カード（名前/予定を別部品・時刻列を縦揃え）が作れないため自作。
 * ICS は行がシンプル（VEVENT ごとに SUMMARY / DTSTART / DTEND）なので依存無しで手解析する。
 * 時刻付きは DTSTART:...Z（UTC）運用のため JST(+9h) に変換。終日は VALUE=DATE。
 *
 * 何日先まで出すかは決め打ちしない。front の枠数（maxEntries）が埋まった時点で収集を止める。
 * ICS には差分取得も期間指定も無く毎回全件が届くので、走査は元から全件1回。日数を伸ばしても
 * 取得・解析のコストは変わらず、増えるのは返す配列の長さだけ（それも maxEntries で頭打ち）。
 */
const NodeHelper = require("node_helper");

const JST_OFFSET = 9 * 60 * 60 * 1000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

module.exports = NodeHelper.create({
	start() {
		// 点滅を手で起こすための確認用エンドポイント。
		// 本番の点滅は配信の開始時刻ちょうどにしか起きず、待たないと目視確認ができない。
		// `curl localhost:8080/MMM-OshiCal/test-blink` で front に合図を送り、いま表示中の
		// 予定のうち先頭（左上の時刻付きの枠）を firingDurationMs のあいだ光らせる。
		// MMM-R5 の制御エンドポイントと同じく ipWhitelist(127.0.0.1) の内側なので外部からは届かない。
		// `?style=1〜5` で光り方の案を、`?sec=6` で秒数を指定できる（既定は本番と同じ設定値）。
		this.expressApp.get("/MMM-OshiCal/test-blink", (req, res) => {
			const style = Number(req.query.style) || 0;
			const sec = Number(req.query.sec) || 0;
			this.sendSocketNotification("OSHICAL_TEST_BLINK", { style, sec });
			res.json({ ok: true, style, sec });
		});
	},

	socketNotificationReceived(notification, payload) {
		if (notification !== "OSHICAL_FETCH") return;
		this.fetchAndParse(payload.icsUrl, payload.maxEntries || 20, payload.debugNow || "");
	},

	async fetchAndParse(url, maxEntries, debugNow) {
		let days = [];
		try {
			const res = await fetch(url);
			const text = await res.text();
			days = this.parseIcs(text, maxEntries, debugNow);
		} catch (e) {
			console.error(`[MMM-OshiCal] 取得/解析エラー: ${e.message}`);
		}
		this.sendSocketNotification("OSHICAL_EVENTS", { days });
	},

	// 返り値: [{ num, today, label, events:[{time,name,title,live,ms}], total }] を日付の昇順で。
	// num は YYYYMMDD（数値。並べ替え用）、total はその日の実件数（events は maxEntries で切る）。
	// today は「その日が今日か」。今日の予定がゼロだと先頭が未来の日になるので、
	// front が「配列の先頭＝今日」と決め打ちできない（日付セル無し・今日の色で描いてしまう）。
	parseIcs(text, maxEntries, debugNow) {
		// iCal の折り返し（行頭スペース/タブは前行の続き）を戻してから行分割。
		const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);

		// デバッグ用に現在時刻を差し替え可能（X13_OSHI_NOW 由来）。空/不正なら実時刻。
		// X13 は JST 稼働なので "2026-07-19T06:00" はそのまま JST 壁時計として解釈される。
		let now = Date.now();
		if (debugNow) {
			const t = new Date(debugNow).getTime();
			if (!Number.isNaN(t)) now = t;
		}
		const nowJst = new Date(now + JST_OFFSET);
		const todayNum = this.dayNum(nowJst);
		const nowHour = nowJst.getUTCHours(); // 現在の「時」(JST)。同じ時間帯の予定を配信中とみなす判定に使う。
		// 現在の「時」の頭(HH:00:00)を UTC ミリ秒で。分秒ミリ秒を落とすだけ（時の頭は JST/UTC で同一瞬間）。
		const hourStartMs = now - ((nowJst.getUTCMinutes() * 60 + nowJst.getUTCSeconds()) * 1000 + nowJst.getUTCMilliseconds());

		// 日付(YYYYMMDD) ごとに「時刻付き」「終日」を別々に溜める。終日は時刻で並べられないため。
		const bins = new Map();
		let cur = null;

		for (const line of lines) {
			if (line === "BEGIN:VEVENT") { cur = {}; continue; }
			if (line === "END:VEVENT") {
				if (cur) this.classify(cur, bins, todayNum, now, hourStartMs, nowHour);
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
		}

		// 日付の昇順に、枠が埋まるまでの日だけ返す。埋まった日を含めて打ち切るので、
		// front は「その日の何件目まで入るか」を自分で決められる。
		const days = [];
		let acc = 0;
		for (const num of [...bins.keys()].sort((a, b) => a - b)) {
			const bin = bins.get(num);
			// 時刻付きを昇順に並べ、終日をその後ろに置く（モックアップの並びに合わせる）。
			bin.timed.sort((a, b) => a.ms - b.ms);
			const all = bin.timed.concat(bin.allday);
			days.push({
				num,
				today: num === todayNum,
				label: this.dayLabel(num),
				total: all.length,
				// ms（開始時刻のエポックミリ秒）は front が「開始ちょうどに枠を点滅させる」タイマーを
				// 張るのに使う。"19:30" という文字列からは日付をまたいだ瞬間に復元できない
				// （今日の 19:30 か明日の 19:30 か区別が付かない）ため、生値をそのまま渡す。終日は 0。
				events: all.slice(0, maxEntries).map((e) => ({ time: e.time, name: e.name, title: e.title, live: !!e.live, ms: e.ms })),
			});
			acc += all.length + (num === todayNum ? 0 : 1); // 今日以外は日付セルが1枠使う
			if (acc >= maxEntries) break;
		}
		return days;
	},

	classify(ev, bins, todayNum, now, hourStartMs, nowHour) {
		if (!ev.dtstart) return;
		const { name, title } = this.splitSummary(ev.summary || "");
		const put = (num, item) => {
			if (!bins.has(num)) bins.set(num, { timed: [], allday: [] });
			const bin = bins.get(num);
			(item.time === "終日" ? bin.allday : bin.timed).push(item);
		};

		// 終日イベント（VALUE=DATE）。今日ぶんは時刻が無いので落とさない。
		if (/VALUE=DATE/.test(ev.startParams || "")) {
			const m = ev.dtstart.match(/(\d{4})(\d{2})(\d{2})/);
			if (!m) return;
			const num = +`${m[1]}${m[2]}${m[3]}`;
			if (num >= todayNum) put(num, { time: "終日", name, title, ms: 0 });
			return;
		}

		// 時刻付きイベント。
		const startMs = this.toMs(ev.dtstart);
		if (startMs === null) return;

		const startJst = new Date(startMs + JST_OFFSET);
		const num = this.dayNum(startJst);
		if (num < todayNum) return;
		// 今日は「現在の時間帯の頭」以降だけ（例: 19:30 なら 19:00 以降。18時台は 19:00 で落ちる）。
		// 明日以降は時刻での足切り無し（全部これから）。終了時刻は見ない（DTEND の有無に振り回されないため）。
		if (num === todayNum && startMs < hourStartMs) return;

		const hh = String(startJst.getUTCHours()).padStart(2, "0");
		const mm = String(startJst.getUTCMinutes()).padStart(2, "0");
		// 配信中と思われる: すでに始まっていて（開始 ≤ 今）、今と同じ時間帯（同じ"時"）。
		const live = num === todayNum && startMs <= now && startJst.getUTCHours() === nowHour;
		put(num, { time: `${hh}:${mm}`, name, title, ms: startMs, live });
	},

	// JST 壁時計の Date（UTC ゲッタで読む前提）から YYYYMMDD の数値を作る。日付順の並べ替えに使う。
	dayNum(jst) {
		return jst.getUTCFullYear() * 10000 + (jst.getUTCMonth() + 1) * 100 + jst.getUTCDate();
	},

	// YYYYMMDD → 「07/28（火）」。曜日は UTC 上の同じ暦日から引く。
	dayLabel(num) {
		const y = Math.floor(num / 10000);
		const m = Math.floor(num / 100) % 100;
		const d = num % 100;
		const w = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
		return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}（${w}）`;
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
