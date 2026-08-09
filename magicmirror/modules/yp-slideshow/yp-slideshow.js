/* yp-slideshow — ~/signage/slides 以下の画像を巡回表示する自作スライドショー。
 * MMM-ImageSlideshow を参考にした最小実装。画像の実体は node_helper が
 * /yp-slideshow/images で静的配信し、ここではその URL を順に差し替えて表示する。
 * フェードは MM 標準の updateDom(speed) に任せる（モジュール領域ごと淡く切替）。
 * 配布先: ~/MagicMirror/modules/yp-slideshow/
 */
Module.register("yp-slideshow", {
	defaults: {
		demo: false, // デモモード。imageDir 未指定なら同梱の samples/ を表示する
		imageDir: null, // null なら node_helper 側の既定 ~/signage/slides（サブフォルダも再帰で拾う）
		logPath: null, // 表示履歴の書き出し先。null なら node_helper 側の既定 ~/signage/r5-now.log
		slideInterval: 8000, // 1枚の表示時間(ms)
		fadeSpeed: 1200, // 切替時のフェード時間(ms)
		shuffle: true, // 表示順をシャッフルするか
		refreshInterval: 10 * 60 * 1000, // 画像一覧を取り直す間隔(ms)
		contextMenu: true, // 画面を右クリックで操作メニューを出す
		// メニューに「終了」を出すか。MagicMirror 本体は窓を閉じても作り直す作りなので
		// （js/electron.js の window-all-closed が createWindow を呼ぶ）、画面だけで
		// 終わらせる手段がこれしかない。誤操作が怖い設置なら false にする。
		allowQuit: true,
	},

	getStyles() {
		return ["yp-slideshow.css"];
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
			else if (e.key === "Escape") this.closeMenu();
		});
		if (this.config.contextMenu) this.setupMenu();
	},

	// --- 右クリックメニュー ---------------------------------------------
	// メニューは body 直下に置く。モジュールの DOM は updateDom のたびに作り直されるので、
	// wrapper の中に入れると画像が切り替わった瞬間にメニューごと消える。
	setupMenu() {
		this.menu = null;
		document.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			this.openMenu(e.clientX, e.clientY);
		});
		// メニュー外を左クリックしたら閉じる。メニュー自身のクリックは項目側で止める。
		document.addEventListener("click", () => this.closeMenu());
	},

	openMenu(x, y) {
		this.closeMenu();
		const menu = document.createElement("div");
		menu.className = "yp-menu";
		menu.addEventListener("click", (e) => e.stopPropagation());

		// 上バーの板の切り替えはメニューに出さない。日常的に触るものではなく、
		// 必要なときは `mm-ctl.sh topbar` から叩ける（control() 側には残してある）。
		const items = [
			["次へ", () => this.control("next")],
			["前へ", () => this.control("prev")],
			[this.paused ? "再開" : "一時停止", () => this.control("toggle")],
		];
		for (const [label, fn] of items) {
			menu.appendChild(this.makeMenuItem(label, () => { fn(); this.closeMenu(); }));
		}

		if (this.config.allowQuit) {
			const sep = document.createElement("div");
			sep.className = "yp-menu-sep";
			menu.appendChild(sep);
			// 1クリックで終了する。右クリックしてから項目を選ぶまでに2手あるので、
			// 触るつもりが無いのに押してしまう状況は考えにくい。
			const quit = this.makeMenuItem("終了", () => {
				this.sendSocketNotification("YP_SLIDESHOW_QUIT");
				this.closeMenu();
			});
			quit.classList.add("yp-menu-danger");
			menu.appendChild(quit);
		}

		document.body.appendChild(menu);
		// 画面の端で切れないよう、はみ出すぶんだけ内側へ寄せる。
		const r = menu.getBoundingClientRect();
		menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
		menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
		this.menu = menu;
	},

	// 一時停止バッジ。メニューと同じく body 直下に置く。
	// このモジュールは fullscreen_below（他のモジュールの下に敷く領域）にいるため、
	// wrapper の中に入れると背景と一緒に最背面へ回り、下バーやぼかしの裏に隠れる。
	renderPausedBadge() {
		if (this.pausedBadge) {
			this.pausedBadge.remove();
			this.pausedBadge = null;
		}
		if (!this.paused) return;
		const badge = document.createElement("div");
		badge.className = "yp-paused";
		badge.textContent = "❙❙ 一時停止中";
		document.body.appendChild(badge);

		// 下バー（配信予定）に重ならない高さへ逃がす。バーの高さは列数と行数で変わるので、
		// 決め打ちにせずその場で測る。バーが無い・畳まれている構成では画面の下端に置く。
		const bar = document.querySelector(".region.bottom.bar");
		const rect = bar ? bar.getBoundingClientRect() : null;
		if (rect && rect.height > 0) {
			badge.style.bottom = Math.round(window.innerHeight - rect.top + 12) + "px";
		}
		this.pausedBadge = badge;
	},

	makeMenuItem(label, onClick) {
		const item = document.createElement("div");
		item.className = "yp-menu-item";
		item.textContent = label;
		item.addEventListener("click", onClick);
		return item;
	},

	closeMenu() {
		if (this.menu) {
			this.menu.remove();
			this.menu = null;
		}
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

	// node_helper の /yp-slideshow/control/<cmd> から届く外部操作を捌く。
	control(cmd) {
		switch (cmd) {
			case "pause":
				this.paused = true;
				clearTimeout(this.timer); // オート送りを止める
				this.renderPausedBadge(); // 一時停止バッジを出す
				break;
			case "resume":
				this.paused = false;
				this.renderPausedBadge(); // バッジを消す
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
		// 置き場所の設定（imageDir / logPath）はここでまとめて helper へ渡す。helper は
		// ディスクを触る側なので、パスの既定値も helper 側が持つ（null なら既定に落ちる）。
		this.sendSocketNotification("YP_SLIDESHOW_GET_IMAGES", {
			demo: !!this.config.demo, // true かつ imageDir 未指定なら同梱の samples/ を見る
			imageDir: this.config.imageDir,
			logPath: this.config.logPath,
		});
	},

	socketNotificationReceived(notification, payload) {
		if (notification === "YP_SLIDESHOW_CONTROL") {
			this.control(payload.cmd);
			return;
		}
		if (notification !== "YP_SLIDESHOW_IMAGES") return;
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
			this.sendSocketNotification("YP_SLIDESHOW_NOW", { url: this.lastLogged, reason: this.reason });
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
			this.sendSocketNotification("YP_SLIDESHOW_BROKEN", { url: shown }); // ログ上の該当行に印を付ける
			if (this.images.length > 1) {
				this.reason = "alt"; // 壊れた画像の代わりに出した1枚
				this.index = (this.index + 1) % this.images.length;
				this.updateDom(0);
				this.scheduleNext();
			}
		};
		img.src = shown;
		wrapper.appendChild(img);

		// 一時停止バッジはここでは作らない（renderPausedBadge が body 直下に置く）。
		// この wrapper は fullscreen_below にいるので、中に入れると最背面へ回ってしまう。
		return wrapper;
	},
});
