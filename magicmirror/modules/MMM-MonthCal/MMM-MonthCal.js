/* MMM-MonthCal — よくある月グリッドのカレンダー（自作）。
 * 予定は出さず、当月のグリッドだけを描く。土曜=青・日祝=赤。今日は丸ハイライト。
 * 祝日判定は holidays.js（依存ゼロ・振替/国民の休日対応）を getScripts で読み込む。
 * 外部データ不要なので node_helper は持たない（ローカル日付だけで完結）。
 * 配布先: ~/MagicMirror/modules/MMM-MonthCal/
 */
Module.register("MMM-MonthCal", {
	defaults: {
		updateInterval: 30 * 60 * 1000, // 30分ごとに再描画（日付跨ぎ・今日ハイライトの更新）
	},

	getStyles() { return ["MMM-MonthCal.css"]; },
	getScripts() { return [this.file("holidays.js")]; },

	start() {
		this.updateDom();
		setInterval(() => this.updateDom(), this.config.updateInterval);
	},

	getDom() {
		const H = window.OshiHolidays;
		const wrap = document.createElement("div");
		wrap.className = "mc";

		const now = new Date();
		const y = now.getFullYear();
		const m = now.getMonth() + 1; // 1-12
		const today = now.getDate();

		// 見出し「2026年7月」。
		const cap = document.createElement("div");
		cap.className = "mc-cap";
		cap.textContent = `${y}年${m}月`;
		wrap.appendChild(cap);

		const table = document.createElement("table");
		table.className = "mc-table";

		// 曜日ヘッダ（日〜土）。日=赤、土=青。
		const head = document.createElement("tr");
		["日", "月", "火", "水", "木", "金", "土"].forEach((w, i) => {
			const th = document.createElement("th");
			th.textContent = w;
			if (i === 0) th.className = "mc-red";
			else if (i === 6) th.className = "mc-sat";
			head.appendChild(th);
		});
		table.appendChild(head);

		const firstDow = new Date(y, m - 1, 1).getDay(); // 1日の曜日(0-6)
		const daysInMonth = new Date(y, m, 0).getDate(); // 当月の日数
		let day = 1 - firstDow; // 先頭の空白セル分だけ手前から始める
		for (let wk = 0; wk < 6 && day <= daysInMonth; wk++) {
			const tr = document.createElement("tr");
			for (let c = 0; c < 7; c++, day++) {
				const td = document.createElement("td");
				if (day >= 1 && day <= daysInMonth) {
					td.textContent = day;
					// 色の優先: 日曜/祝日=赤 が 土曜=青 に勝つ（土曜が祝日なら赤）。
					if (c === 0 || H.isHoliday(y, m, day)) td.classList.add("mc-red");
					else if (c === 6) td.classList.add("mc-sat");
					if (day === today) td.classList.add("mc-today");
				}
				tr.appendChild(td);
			}
			table.appendChild(tr);
		}
		wrap.appendChild(table);
		return wrap;
	},
});
