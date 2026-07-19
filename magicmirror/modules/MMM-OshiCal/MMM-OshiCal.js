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
		this.loaded = false;
		this.requestEvents();
		setInterval(() => this.requestEvents(), this.config.updateInterval);
	},

	requestEvents() {
		this.sendSocketNotification("OSHICAL_FETCH", {
			icsUrl: this.config.icsUrl,
			maxEntries: this.config.maxEntries,
		});
	},

	socketNotificationReceived(notification, payload) {
		if (notification !== "OSHICAL_EVENTS") return;
		this.events = payload.events || [];
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

		// grid 1本に badge / body を交互に流し込む → 時刻列(col1)が全行で縦に揃う。
		const list = document.createElement("div");
		list.className = "oc-list";
		this.events.forEach((ev) => {
			const badge = document.createElement("div");
			badge.className = "oc-badge";
			badge.textContent = ev.time;

			const body = document.createElement("div");
			body.className = "oc-body";
			const who = document.createElement("div");
			who.className = "oc-who";
			who.textContent = ev.name || "";
			body.appendChild(who);
			if (ev.title) {
				const sub = document.createElement("div");
				sub.className = "oc-sub";
				sub.textContent = ev.title;
				body.appendChild(sub);
			}

			list.appendChild(badge);
			list.appendChild(body);
		});
		wrapper.appendChild(list);
		return wrapper;
	},
});
