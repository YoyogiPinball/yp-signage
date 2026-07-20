/* MMM-OshiCal — 推しスケの「今日の予定」を2段カードで表示する自作モジュール。
 * データは node_helper が ICS を取得・整形して渡す（{time, name, title} の配列）。
 * 描画は grid 1本で「時刻バッジ｜名前(太字)＋予定(下段)」を組み、時刻列を縦に揃える。
 * 配布先: ~/MagicMirror/modules/MMM-OshiCal/
 */
Module.register("MMM-OshiCal", {
	defaults: {
		icsUrl: "", // 推しスケ iCal（secrets 由来を config で渡す）
		maxEntries: 12,
		updateInterval: 5 * 60 * 1000, // 5分ごとに取り直す
	},

	getStyles() {
		return ["MMM-OshiCal.css"];
	},

	start() {
		this.events = [];
		this.hiddenCount = 0;
		this.loaded = false;
		// 予定の列数を body class に反映（CSS 切替用）。X13_COLS 由来（既定4）。
		document.body.classList.add("x13-cols-" + (this.config.columns || 4));
		this.requestEvents();
		setInterval(() => this.requestEvents(), this.config.updateInterval);
	},

	requestEvents() {
		this.sendSocketNotification("OSHICAL_FETCH", {
			icsUrl: this.config.icsUrl,
			maxEntries: this.config.maxEntries,
			debugNow: this.config.debugNow || "", // デバッグ現在時刻（空なら実時刻）
		});
	},

	socketNotificationReceived(notification, payload) {
		if (notification !== "OSHICAL_EVENTS") return;
		this.events = payload.events || [];
		this.hiddenCount = payload.hiddenCount || 0;
		this.loaded = true;
		this.updateDom(500);
	},

	getDom() {
		const wrapper = document.createElement("div");
		wrapper.className = "oc";

		if (!this.loaded) {
			wrapper.classList.add("oc-empty");
			wrapper.textContent = "読み込み中…";
			return wrapper;
		}
		if (this.events.length === 0) {
			wrapper.classList.add("oc-empty");
			wrapper.textContent = "今日はこの先の予定なし";
			return wrapper;
		}

		// 1件=1セル(.oc-item)。列優先（上→下に埋めて次の列へ）にするため、件数から
		// 行数を出して grid-template-rows を inline 指定する。＝左の列ほど早い時刻。
		const cols = this.config.columns || 4;
		const list = document.createElement("div");
		list.className = "oc-list";

		const items = this.events.map((ev) => this.makeItem(ev.time, ev.name, ev.title, ev.live));
		// 打ち切った残り件数を「＋他 N 件」で示す（maxEntries を超えたとき）。
		if (this.hiddenCount > 0) {
			const more = this.makeItem("＋", `他 ${this.hiddenCount} 件`, "", false);
			more.classList.add("oc-more");
			items.push(more);
		}
		const rows = Math.max(1, Math.ceil(items.length / cols));
		list.style.gridTemplateRows = `repeat(${rows}, auto)`;
		items.forEach((it) => list.appendChild(it));

		wrapper.appendChild(list);
		return wrapper;
	},

	// 1件分のセル（時刻バッジ｜名前＋予定）を作る。
	makeItem(time, name, title, live) {
		const item = document.createElement("div");
		item.className = live ? "oc-item oc-live" : "oc-item";

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
