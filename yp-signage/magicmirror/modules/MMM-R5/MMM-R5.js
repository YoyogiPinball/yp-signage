/* MMM-R5 — ~/signage/slides 以下の画像を巡回表示する自作スライドショー。
 * MMM-ImageSlideshow を参考にした最小実装。画像の実体は node_helper が
 * /MMM-R5/images で静的配信し、ここではその URL を順に差し替えて表示する。
 * フェードは MM 標準の updateDom(speed) に任せる（モジュール領域ごと淡く切替）。
 * 配布先: ~/MagicMirror/modules/MMM-R5/
 */
Module.register("MMM-R5", {
	defaults: {
		imageDir: null, // null なら node_helper 側の既定 ~/signage/slides（サブフォルダも再帰で拾う）
		slideInterval: 8000, // 1枚の表示時間(ms)
		fadeSpeed: 1200, // 切替時のフェード時間(ms)
		shuffle: true, // 表示順をシャッフルするか
		refreshInterval: 10 * 60 * 1000, // 画像一覧を取り直す間隔(ms)
	},

	getStyles() {
		return ["MMM-R5.css"];
	},

	start() {
		this.images = [];
		this.index = 0;
		this.loaded = false;
		this.paused = false; // 一時停止中はオート巡回タイマーを止める（手動送りは可）
		this.timer = null;
		this.lastLogged = null; // 直近で r5-now.log に記録した画像URL（同じ画像の二重記録を防ぐ）
		this.reason = ""; // 次に記録する行の種別（"" = 自動送り / next / prev / alt）
		this.requestImages();
		setInterval(() => this.requestImages(), this.config.refreshInterval);
		// ←/→ で手動送り（1枚戻る/進む）。手動操作後もオート巡回は継続する。
		document.addEventListener("keydown", (e) => {
			if (e.key === "ArrowRight") this.step(1);
			else if (e.key === "ArrowLeft") this.step(-1);
		});
	},

	// 手動で dir 枚ぶん送る（+1=次 / -1=前）。オートのタイマーもリセットして継続。
	// 一時停止中は送るだけで、オート巡回は再開しない（次の resume まで止めたまま）。
	step(dir) {
		if (this.images.length === 0) return;
		this.reason = dir > 0 ? "next" : "prev";
		this.index = (this.index + dir + this.images.length) % this.images.length;
		this.updateDom(this.config.fadeSpeed);
		if (!this.paused) this.scheduleNext();
	},

	// node_helper の /MMM-R5/control/<cmd> から届く外部操作を捌く。
	control(cmd) {
		switch (cmd) {
			case "pause":
				this.paused = true;
				clearTimeout(this.timer); // オート送りを止める
				this.updateDom(0); // 一時停止バッジを出す
				break;
			case "resume":
				this.paused = false;
				this.updateDom(0); // バッジを消す
				this.scheduleNext(); // オート巡回を再開
				break;
			case "toggle":
				this.control(this.paused ? "resume" : "pause");
				break;
			case "next":
				this.step(1);
				break;
			case "prev":
				this.step(-1);
				break;
			case "topbar":
				// 上バーの板を一時的に出す/消すトグル。既定は透明で、CSS の
				// body.topbar-on ルールが付いている間だけ板が出る。
				document.body.classList.toggle("topbar-on");
				break;
		}
	},

	// node_helper に最新の画像一覧を要求する。
	requestImages() {
		this.sendSocketNotification("MMM_R5_GET_IMAGES", { imageDir: this.config.imageDir });
	},

	socketNotificationReceived(notification, payload) {
		if (notification === "MMM_R5_CONTROL") {
			this.control(payload.cmd);
			return;
		}
		if (notification !== "MMM_R5_IMAGES") return;
		// 差し替える前に「今画面に出している画像」を控えておく。
		const current = this.images[this.index] || null;
		this.images = this.mergeImages(payload.images || []);
		// 並びを保っていても、手前の画像が消えれば位置はずれる。表示中の画像を
		// 探し直して index を貼り直す。見つからない（消された）ときだけ先頭に戻す。
		const found = current ? this.images.indexOf(current) : -1;
		this.index = found >= 0 ? found : 0;

		// 初回に画像が届いたら即表示して巡回を開始する。
		if (!this.loaded && this.images.length > 0) {
			this.loaded = true;
			this.index = 0;
			this.updateDom(0);
			this.scheduleNext();
		}
	},

	scheduleNext() {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.reason = ""; // 自動送り（ログではラベル無し）
			this.index = (this.index + 1) % this.images.length;
			this.updateDom(this.config.fadeSpeed);
			this.scheduleNext();
		}, this.config.slideInterval);
	},

	// 再取得した一覧を、今の並びを保ったまま取り込む。
	// 毎回シャッフルし直すと 10分ごとに順序が総入れ替えになり、「1つ前」が
	// さっき見た画像を指さなくなる（prev が無関係な画像を出す原因だった）。
	// 並びを据え置けば prev は常に直前の1枚に戻り、全部を一巡してから折り返す。
	// 消えた画像は落とし、増えた画像だけを既存の並びのランダムな位置へ散らす
	// （末尾に足すと一巡するまで新着が出てこないため）。
	mergeImages(next) {
		if (this.images.length === 0) {
			return this.config.shuffle ? this.shuffleArray(next) : next;
		}
		const alive = new Set(next);
		const kept = this.images.filter((url) => alive.has(url));
		const keptSet = new Set(kept);
		const added = next.filter((url) => !keptSet.has(url));
		if (added.length === 0) return kept;
		if (!this.config.shuffle) return kept.concat(added);

		const merged = kept.slice();
		for (const url of this.shuffleArray(added)) {
			merged.splice(Math.floor(Math.random() * (merged.length + 1)), 0, url);
		}
		return merged;
	},

	shuffleArray(arr) {
		const a = arr.slice();
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	},

	getDom() {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-r5";
		if (this.images.length === 0) {
			wrapper.className += " dimmed small";
			wrapper.textContent = "画像なし (~/signage/slides)";
			return wrapper;
		}
		// 画面に出す画像を ~/signage/r5-now.log に記録する。目視で「これ壊れてる」と
		// 気づいたときに、その場でファイル名を引けるようにするため。ブラウザ側は
		// ディスクに書けないので node_helper に投げる。
		// getDom は一時停止バッジの出し入れでも走るため、画像が実際に変わったときだけ送る。
		if (this.images[this.index] !== this.lastLogged) {
			this.lastLogged = this.images[this.index];
			// reason を添えて「なぜこの画像に変わったか」も残す。手動送りと自動送りが
			// ログ上で区別できないと、prev/next の不具合を後から追えない。
			this.sendSocketNotification("MMM_R5_NOW", { url: this.lastLogged, reason: this.reason });
		}

		// この getDom が出す1枚。以降 index を読み直さず shown を使う（onerror が
		// 遅れて発火したときに、どの画像に対する失敗かを見分けるため）。
		const shown = this.images[this.index];

		// ぼかし拡大背景: 同じ画像を cover＋ぼかしで背面に敷き、レターボックスの帯を
		// 写真の延長（ぼかし）で埋める。前面の contain 画像は切れずに全体表示のまま。
		const bg = document.createElement("img");
		bg.className = "mmm-r5-bg";
		bg.src = shown;
		wrapper.appendChild(bg);

		const img = document.createElement("img");
		img.className = "mmm-r5-img";
		// 読み込み失敗（0バイト・壊れ画像・非対応形式）は 60秒待たず即次へ送る。白画面で止めない。
		img.onerror = () => {
			// フェード中(fadeSpeed)は1つ前の <img> もまだ DOM に残っている。そちらの
			// 失敗通知が遅れて届いたときに index を余計に進めないよう、今出している
			// 画像ぶんだけを拾う（連打すると2枚飛ぶのを防ぐ）。
			if (this.images[this.index] !== shown) return;
			this.sendSocketNotification("MMM_R5_BROKEN", { url: shown }); // ログ上の該当行に印を付ける
			if (this.images.length > 1) {
				this.reason = "alt"; // 壊れた画像の代わりに出した1枚
				this.index = (this.index + 1) % this.images.length;
				this.updateDom(0);
				this.scheduleNext();
			}
		};
		img.src = shown;
		wrapper.appendChild(img);

		// 一時停止中は画面隅に控えめなバッジを出す（止まっているか一目でわかる）。
		if (this.paused) {
			const badge = document.createElement("div");
			badge.className = "mmm-r5-paused";
			badge.textContent = "❙❙ 一時停止中";
			wrapper.appendChild(badge);
		}
		return wrapper;
	},
});
