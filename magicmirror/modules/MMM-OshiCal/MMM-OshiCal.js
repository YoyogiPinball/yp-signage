/* MMM-OshiCal — 推しスケの「今から先の配信予定」を2段カードで表示する自作モジュール。
 * データは node_helper が ICS を取得・整形して渡す（日ごとの配列）。
 * 描画は grid 1本で「時刻バッジ｜名前(太字)＋予定(下段)」を組み、時刻列を縦に揃える。
 * 列は上→下に埋めて右へ流れる（列優先）。今日ぶんに続けて翌日以降を流し込み、
 * 日の変わり目に日付セル（例「07/28（火）」）を1枠挟む。今日は青緑、以降は空色。
 * 枠は件数に関わらず常に cols × rows ぶん引く（少ない日に形が変わらないように）。
 * 開始時刻ちょうどに、その予定の枠だけを firingDurationMs の間ふわっと点滅させる
 * （ポップアップは出さない。画面を覆わずに「今これが始まった」を知らせるため）。
 * 配布先: ~/MagicMirror/modules/MMM-OshiCal/
 */
Module.register("MMM-OshiCal", {
	defaults: {
		icsUrl: "", // 推しスケ iCal（secrets 由来を config で渡す）
		maxEntries: 20, // 表示上限。列数で割った値が行数になる
		updateInterval: 5 * 60 * 1000, // 5分ごとに取り直す
		// 開始時刻ちょうどに、その予定の枠を点滅させる長さ。0 にすると点滅しない。
		firingDurationMs: 60 * 1000,
		// 光り方の案。1=控えめ 2=濃い 3=全周を囲む 4=はっきり明滅 5=反転（いちばん強い）。
		// 見比べは実機で `bash ~/run/mm-ctl.sh blink 3` のように行う（CSS 側の f1〜f5）。
		firingStyle: 1,
	},

	getStyles() {
		return ["MMM-OshiCal.css"];
	},

	start() {
		this.days = [];
		this.loaded = false;
		this.firing = new Map(); // 点滅中の予定 key → { endsAt, style }。描画時に参照する
		this.fired = new Set(); // 一度点滅させた key。5分ごとの再取得で二度光らせないため
		this.startTimers = []; // 「開始時刻に光らせる」タイマー。再取得のたびに張り直す
		this.stopTimers = new Map(); // 「光り終わり」タイマー。張り直しの巻き添えで消さない
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
		// 確認用: 開始時刻を待たずに点滅を起こす（`bash ~/run/mm-ctl.sh blink`）。
		// 本番の発火と違い fired には入れない。入れると、その予定が本来の開始時刻に光らなくなる。
		if (notification === "OSHICAL_TEST_BLINK") {
			const ev = this.days.flatMap((d) => d.events).find((e) => e.ms);
			if (!ev) return;
			const ms = (payload && payload.sec ? payload.sec * 1000 : 0) || this.config.firingDurationMs || 60000;
			const style = (payload && payload.style) || this.config.firingStyle || 1;
			this.beginFiring(this.eventKey(ev), Date.now() + ms, false, style);
			return;
		}
		if (notification !== "OSHICAL_EVENTS") return;
		this.days = payload.days || [];
		this.loaded = true;
		this.scheduleFiring();
		this.updateDom(500);
	},

	// 予定の開始時刻ちょうどに枠を光らせるタイマーを張り直す。
	// 5分ごとの再取得のたびに全部捨てて張り直すのは、推しスケ側で時刻がずれた予定を
	// サイネージだけが古い時刻で覚えている状態を作らないため（消えた予定の時刻に光ると嘘になる）。
	// 光り終わり側のタイマー(stopTimers)は巻き添えで消さない。消すと点滅が止まらなくなる。
	scheduleFiring() {
		this.startTimers.forEach(clearTimeout);
		this.startTimers = [];
		const dur = this.config.firingDurationMs || 0;
		// デバッグ現在時刻を入れている間は光らせない。helper 側の「今」がずれているので、
		// 実時刻で見ると過ぎた予定が並び、全枠がいっせいに光ってしまう。
		if (dur <= 0 || this.config.debugNow) return;

		const now = Date.now();
		for (const day of this.days) {
			for (const ev of day.events) {
				if (!ev.ms) continue; // 終日イベント（ms:0）は時刻が無いので対象外
				const key = this.eventKey(ev);
				if (this.fired.has(key)) continue;
				const endsAt = ev.ms + dur;
				if (endsAt <= now) continue; // 光り終わっている時刻の予定は捨てる
				// helper は今日ぶんを「現在の時間帯の頭」まで残すので、19:30 の時点でも
				// 19:00 開始の予定がここに来る。上の endsAt 判定でそれを落としている。
				// 逆に再起動が開始直後だった場合は、残りぶんだけ光らせる（0 以下は即時）。
				if (ev.ms - now > 24 * 3600 * 1000) continue; // setTimeout の上限(約24.8日)を超える前に打ち切る
				this.startTimers.push(setTimeout(() => this.beginFiring(key, endsAt, true, this.config.firingStyle || 1), Math.max(0, ev.ms - now)));
			}
		}
	},

	// remember=true なら「もう光らせた」印を付ける。5分ごとの再取得で二度光らせないため。
	// 確認用の手動発火だけが false（本来の開始時刻に改めて光ってほしいので印を残さない）。
	beginFiring(key, endsAt, remember, style) {
		if (remember) this.fired.add(key);
		this.firing.set(key, { endsAt, style: style || 1 });
		this.updateDom();
		clearTimeout(this.stopTimers.get(key));
		this.stopTimers.set(
			key,
			setTimeout(() => {
				this.firing.delete(key);
				this.stopTimers.delete(key);
				this.updateDom();
			}, Math.max(0, endsAt - Date.now()))
		);
	},

	// 点滅対象を見分けるキー。時刻がずれた予定は別物として扱われ、新しい時刻で改めて光る。
	eventKey(ev) {
		return `${ev.ms}|${ev.name}|${ev.title}`;
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
		shown.forEach((ev) => list.appendChild(this.makeItem(ev, next)));
		if (fits) return cap - shown.length;
		const more = this.makeItem({ time: "＋", name: `他 ${total - shown.length} 件`, title: "" }, next);
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
	// 点滅中かどうかは描画のたびに firing から引き直す。5分ごとの再取得で DOM が作り直されても
	// 点滅が消えないようにするため、状態はクラスではなくモジュール側に持たせている。
	makeItem(ev, next) {
		const item = document.createElement("div");
		item.className = ev.live ? "oc-item oc-live" : "oc-item";
		if (next) item.classList.add("oc-next");
		const fire = ev.ms ? this.firing.get(this.eventKey(ev)) : null;
		if (fire && fire.endsAt > Date.now()) item.classList.add("oc-firing", "f" + fire.style);

		const badge = document.createElement("div");
		badge.className = ev.live ? "oc-badge oc-live" : "oc-badge";
		badge.textContent = ev.time;

		const body = document.createElement("div");
		body.className = ev.live ? "oc-body oc-live" : "oc-body";
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

		item.appendChild(badge);
		item.appendChild(body);
		return item;
	},
});
