/* MMM-OshiCal — 推しスケの「今から先の配信予定」を2段カードで表示する自作モジュール。
 * データは node_helper が ICS を取得・整形して渡す（日ごとの配列）。
 * 描画は grid 1本で「時刻バッジ｜名前(太字)＋予定(下段)」を組み、時刻列を縦に揃える。
 * 列は上→下に埋めて右へ流れる（列優先）。今日ぶんに続けて翌日以降を流し込み、
 * 日の変わり目に日付セル（例「07/28（火）」）を1枠挟む。今日は青緑、以降は空色。
 * 枠は件数に関わらず常に cols × rows ぶん引く（少ない日に形が変わらないように）。
 * 配布先: ~/MagicMirror/modules/MMM-OshiCal/
 */
Module.register("MMM-OshiCal", {
	defaults: {
		icsUrl: "", // 推しスケ iCal（secrets 由来を config で渡す）
		maxEntries: 20, // 表示上限。列数で割った値が行数になる
		updateInterval: 5 * 60 * 1000, // 5分ごとに取り直す
	},

	getStyles() {
		return ["MMM-OshiCal.css"];
	},

	start() {
		this.days = [];
		this.loaded = false;
		// 予定の列数を body class に反映（CSS 切替用）。X13_COLS 由来（既定4）。
		document.body.classList.add("x13-cols-" + (this.config.columns || 4));
		this.requestEvents();
		setInterval(() => this.requestEvents(), this.config.updateInterval);
	},

	requestEvents() {
		this.sendSocketNotification("OSHICAL_FETCH", {
			icsUrl: this.config.icsUrl,
			maxEntries: this.config.maxEntries, // これを超えた日は helper 側で収集を打ち切る
			debugNow: this.config.debugNow || "", // デバッグ現在時刻（空なら実時刻）
		});
	},

	socketNotificationReceived(notification, payload) {
		if (notification !== "OSHICAL_EVENTS") return;
		this.days = payload.days || [];
		this.loaded = true;
		this.updateDom(500);
	},

	getDom() {
		const wrapper = document.createElement("div");
		wrapper.className = "oc";

		// 上から下へ rows 行まで埋めて右の列へ流れる（列優先）。日の変わり目には
		// 日付セルを1枠だけ挟む（列は送らない＝そのまま流れの中に入る）。
		// 枠は件数に関わらず常に cols × rows で引く。予定が少ない夜にバーの高さや
		// 列幅が変わると、同じ場所の表示が日によって別物に見えてしまうため。
		// 列は明示トラック（必要数だけ作る自動列にしない）、行は最小高さ付き（auto だと潰れる）。
		const cols = this.config.columns || 4;
		const rows = Math.max(1, Math.floor((this.config.maxEntries || cols * 5) / cols));
		const total = cols * rows;

		const list = document.createElement("div");
		list.className = "oc-list";
		list.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
		list.style.gridTemplateRows = `repeat(${rows}, minmax(var(--oc-row), auto))`;

		if (!this.loaded || this.days.length === 0) {
			// 予定が無い・まだ取れていないときも枠はそのまま引き、1枠だけ知らせに使う。
			list.appendChild(this.makeNotice(this.loaded ? "この先の予定なし" : "読み込み中…"));
		} else {
			this.appendDays(list, total);
		}

		// 余った枠を空セルで埋める。区切り線と左バーだけが並び、枠の形が常に見える。
		for (let i = list.children.length; i < total; i++) {
			const blank = document.createElement("div");
			blank.className = "oc-item oc-blank";
			list.appendChild(blank);
		}

		wrapper.appendChild(list);
		return wrapper;
	},

	// 日付順に「日付セル（今日以外）＋その日の予定」を、枠が尽きるまで詰める。
	// 何日先まで出るかは決めない。予定が多い日は今日だけで埋まり、少ない夜は数日先まで届く。
	appendDays(list, total) {
		let left = total;
		for (let i = 0; i < this.days.length && left > 0; i++) {
			const day = this.days[i];
			// 今日は日付セルを置かず、左バーも今日の色のまま。判定は helper が付けた
			// day.today で行う（先頭＝今日とは限らない。今日の予定がゼロなら先頭は未来の日）。
			if (day.today) {
				left = this.appendGroup(list, day.events, day.total, left, false);
				continue;
			}
			// 今日以外は日付セルが1枠使う。残り1枠なら予定を1件も置けないので、
			// 日付セルに件数を載せて締める（日付だけ置いて中身ゼロ、を避ける）。
			if (left === 1) {
				list.appendChild(this.makeDayHead(`${day.label} ＋他 ${day.total} 件`));
				break;
			}
			list.appendChild(this.makeDayHead(day.label));
			left = this.appendGroup(list, day.events, day.total, left - 1, true);
		}
	},

	// items を cap 枠に収めて list に足し、残った枠数を返す。
	// total はその日の実件数（items は helper 側で切られていることがある）。
	// 収まらないときは cap-1 件＋「＋他 N 件」を置いて 0 を返す。
	appendGroup(list, items, total, cap, next) {
		if (cap <= 0) return 0;
		const fits = total <= cap;
		const shown = fits ? items : items.slice(0, cap - 1);
		shown.forEach((ev) => list.appendChild(this.makeItem(ev.time, ev.name, ev.title, ev.live, next)));
		if (fits) return cap - shown.length;
		const more = this.makeItem("＋", `他 ${total - shown.length} 件`, "", false, next);
		more.classList.add("oc-more");
		list.appendChild(more);
		return 0;
	},

	// 日の始まりを示す日付セル（例「07/28（火）」）。予定と同じ1枠を使う。
	makeDayHead(label) {
		const head = document.createElement("div");
		head.className = "oc-item oc-dayhead";
		head.textContent = label;
		return head;
	},

	// 「予定なし」「読み込み中」を1枠で知らせるセル。日付セルと同じ1段組み。
	makeNotice(text) {
		const cell = document.createElement("div");
		cell.className = "oc-item oc-dayhead oc-notice";
		cell.textContent = text;
		return cell;
	},

	// 1件分のセル（時刻バッジ｜名前＋予定）を作る。next なら左バー・時刻を翌日以降の色に。
	makeItem(time, name, title, live, next) {
		const item = document.createElement("div");
		item.className = live ? "oc-item oc-live" : "oc-item";
		if (next) item.classList.add("oc-next");

		const badge = document.createElement("div");
		badge.className = live ? "oc-badge oc-live" : "oc-badge";
		badge.textContent = time;

		const body = document.createElement("div");
		body.className = live ? "oc-body oc-live" : "oc-body";
		const who = document.createElement("div");
		who.className = "oc-who";
		who.textContent = name || "";
		body.appendChild(who);
		if (title) {
			const sub = document.createElement("div");
			sub.className = "oc-sub";
			sub.textContent = title;
			body.appendChild(sub);
		}

		item.appendChild(badge);
		item.appendChild(body);
		return item;
	},
});
