/* yp-slideshow — ~/signage/slides 以下の画像を巡回表示する自作スライドショー。
 * MMM-ImageSlideshow を参考にした最小実装。画像の実体は node_helper が
 * /yp-slideshow/images で静的配信し、ここではその URL を順に差し替えて表示する。
 * フェードは MM 標準の updateDom(speed) に任せる（モジュール領域ごと淡く切替）。
 *
 * 「どの画像を出すか」は持たない。並び・現在位置・再生状態は playback.js（同じフォルダ）
 * に分けてあり、ここは返ってきた指示（画像が変わったか・タイマーを張り直すか）を
 * DOM とタイマーへ落とすだけ。分けてあるのは、モードの組み合わせが増えても
 * 画面を起動せずにテストできるようにするため（tests/playback.test.js）。
 * 配布先: ~/MagicMirror/modules/yp-slideshow/
 */

// 右クリックメニューに出す現在値の表示名。設定値そのもの（shuffle / all）を出しても、
// 画面の前に立った人には何が起きるか分からない。
const YP_ORDER_LABELS = { sequential: "ファイル名順", shuffle: "シャッフル" };
const YP_REPEAT_LABELS = { none: "最後で止まる", all: "全部くり返す", one: "1枚のまま" };
// 押すたびに次の値へ回す。選択肢が2〜3個しかないので、階層メニューにするより速い。
const YP_ORDER_CYCLE = { sequential: "shuffle", shuffle: "sequential" };
const YP_REPEAT_CYCLE = { all: "none", none: "one", one: "all" };

Module.register("yp-slideshow", {
	defaults: {
		demo: false, // デモモード。imageDir 未指定なら同梱の samples/ を表示する
		imageDir: null, // null なら node_helper 側の既定 ~/signage/slides（サブフォルダも再帰で拾う）
		logPath: null, // 表示履歴の書き出し先。null なら node_helper 側の既定 ~/signage/r5-now.log
		slideInterval: 8000, // 1枚の表示時間(ms)
		fadeSpeed: 1200, // 切替時のフェード時間(ms)
		orderMode: "shuffle", // sequential = ファイル名の自然順 / shuffle = 一巡内で重複しない順
		repeatMode: "all", // none = 末尾で自動送りを終える / all = 先頭へ戻る / one = 1枚に留まる
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

	// 再生の状態機械。node_helper（Node 側）とテストも同じファイルを読むので、
	// 並び順や末尾の扱いが画面とテストで食い違わない。
	getScripts() {
		return [this.file("playback.js")];
	},

	start() {
		this.pb = createPlayback({
			orderMode: this.config.orderMode,
			repeatMode: this.config.repeatMode,
		});
		this.loaded = false;
		this.timer = null;
		this.lastLogged = null; // 直近で r5-now.log に記録した画像URL（同じ画像の二重記録を防ぐ）
		this.lastShot = null; // 直近で縮小画像を送った画像URL（バッジ描画のたびに作り直さない）
		this.reason = ""; // 次に記録する行の種別（"" = 自動送り / next / prev / alt）
		this.allBroken = false; // 並びの全画像が読めない状態か（バッジの文言に使う）
		this.badge = null;
		this.requestImages();
		setInterval(() => this.requestImages(), this.config.refreshInterval);
		// ←/→ で手動送り（1枚戻る/進む）。手動操作後もオート巡回は継続する。
		document.addEventListener("keydown", (e) => {
			if (e.key === "ArrowRight") this.control("next");
			else if (e.key === "ArrowLeft") this.control("prev");
			else if (e.key === "Escape") this.closeMenu();
		});
		if (this.config.contextMenu) this.setupMenu();
	},

	// playback の戻り値を画面へ落とす唯一の場所。入口（キー・メニュー・HTTP）ごとに
	// 書くと、バッジの出し忘れやタイマーの二重張りが入口ごとにずれて出る。
	apply(res, speed) {
		this.allBroken = res.allBroken;
		if (res.changed) {
			this.reason = res.reason;
			this.updateDom(speed);
		}
		this.renderStatusBadge();
		if (res.schedule) {
			this.scheduleNext();
		} else if (res.status !== "playing" || res.allBroken) {
			clearTimeout(this.timer); // 止まった状態でタイマーだけ生き残らせない
		}
		// 再生中のまま schedule が false のときは、動いているタイマーに触らない。
		// ここへ来るのは「中身が変わらなかった10分ごとの再取得」で、止めてしまうと
		// 自動送りが黙って死ぬ（画面は正常に見えるので気づきにくい）。
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
		const status = this.pb.status();
		const items = [
			["次へ", () => this.control("next")],
			["前へ", () => this.control("prev")],
		];
		if (status === "ended") {
			// 一巡を終えた後に「再開」を押しても、そこが末尾なのですぐまた終わる。
			// 押しても何も起きない項目を出す代わりに、最初から流し直す項目に差し替える。
			items.push(["最初から再生", () => this.control("restart")]);
		} else {
			items.push([status === "paused" ? "再開" : "一時停止", () => this.control("toggle")]);
		}
		// 並び順とくり返しは、いまの値をラベルに出して押すたび切り替える。
		items.push([`並び順: ${YP_ORDER_LABELS[this.pb.orderMode()]}`, () => this.control("order", YP_ORDER_CYCLE[this.pb.orderMode()])]);
		items.push([`くり返し: ${YP_REPEAT_LABELS[this.pb.repeatMode()]}`, () => this.control("repeat", YP_REPEAT_CYCLE[this.pb.repeatMode()])]);

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

	// 状態バッジ（一時停止中・再生終了・画像を読めない）。メニューと同じく body 直下に置く。
	// このモジュールは fullscreen_below（他のモジュールの下に敷く領域）にいるため、
	// wrapper の中に入れると背景と一緒に最背面へ回り、下バーやぼかしの裏に隠れる。
	renderStatusBadge() {
		if (this.badge) {
			this.badge.remove();
			this.badge = null;
		}
		const text = this.badgeText();
		if (!text) return;
		const badge = document.createElement("div");
		badge.className = "yp-badge";
		badge.textContent = text;
		document.body.appendChild(badge);

		// 下バー（配信予定）に重ならない高さへ逃がす。バーの高さは列数と行数で変わるので、
		// 決め打ちにせずその場で測る。バーが無い・畳まれている構成では画面の下端に置く。
		const bar = document.querySelector(".region.bottom.bar");
		const rect = bar ? bar.getBoundingClientRect() : null;
		if (rect && rect.height > 0) {
			badge.style.bottom = Math.round(window.innerHeight - rect.top + 12) + "px";
		}
		this.badge = badge;
	},

	// 「止まっている」だけでは、利用者が止めたのか一巡を終えたのか区別できない。
	// 何が起きて止まっているのかを文言で分ける。
	badgeText() {
		if (this.allBroken) return "⚠ 画像を読み込めません";
		if (this.pb.status() === "paused") return "❙❙ 一時停止中";
		if (this.pb.status() === "ended") return "■ 再生終了";
		return "";
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

	// 外部操作の入口。キー・右クリックメニュー・node_helper の
	// /yp-slideshow/control/<cmd>[/<値>] がすべてここを通る。
	control(cmd, value) {
		switch (cmd) {
			case "pause":
				this.apply(this.pb.pause());
				break;
			case "resume":
				// 一巡を終えた後（ended）は何も起きない。最初から見たいときは restart。
				this.apply(this.pb.resume());
				break;
			case "toggle":
				this.control(this.pb.status() === "playing" ? "pause" : "resume");
				break;
			case "next":
				this.apply(this.pb.step(1), this.config.fadeSpeed);
				break;
			case "prev":
				this.apply(this.pb.step(-1), this.config.fadeSpeed);
				break;
			case "restart":
				this.apply(this.pb.restart(), this.config.fadeSpeed);
				break;
			case "order":
				this.apply(this.pb.setOrderMode(value));
				break;
			case "repeat":
				this.apply(this.pb.setRepeatMode(value));
				break;
			case "topbar":
				// 上バーの板を一時的に出す/消すトグル。既定は透明で、CSS の
				// body.topbar-on ルールが付いている間だけ板が出る。
				document.body.classList.toggle("topbar-on");
				break;
			case "plate":
				// 時計の板の濃さ（%）を実行中に差し替える。custom.css の :root に置いた
				// --clock-plate-alpha を上書きするだけなので、再起動もフェードも起きない。
				// 値の検証は node_helper 側で済ませてある（0〜100 の整数か "reset"）。
				// reset で上書きを外し、custom.css の既定値へ戻す。
				// ここでの上書きはメモリ上だけなので、MagicMirror を再起動すると既定に戻る。
				if (value === "reset") {
					document.documentElement.style.removeProperty("--clock-plate-alpha");
				} else {
					document.documentElement.style.setProperty("--clock-plate-alpha", String(Number(value) / 100));
				}
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
			this.control(payload.cmd, payload.value);
			return;
		}
		if (notification !== "YP_SLIDESHOW_IMAGES") return;
		// 並びの作り直し・現在位置の貼り直しは playback 側の仕事。ここでは結果を画面へ流す。
		const res = this.pb.setImages(payload.images || []);
		// 初回だけはフェードなしで出す（起動直後に1枚目がふわっと現れるのを避ける）。
		const first = !this.loaded && this.pb.size() > 0;
		if (first) this.loaded = true;
		this.apply(res, first ? 0 : this.config.fadeSpeed);
	},

	scheduleNext() {
		clearTimeout(this.timer);
		// タイマーを張った時点の revision を覚えておく。手動送り・モード変更などで状態が
		// 先に進んでいたら、この予約はもう古い。そのまま実行すると画像が二枚飛ぶ。
		const rev = this.pb.revision();
		this.timer = setTimeout(() => {
			if (rev !== this.pb.revision()) return;
			this.apply(this.pb.advance(), this.config.fadeSpeed);
		}, this.config.slideInterval);
	},

	// --- リモコン用の縮小画像 -------------------------------------------
	// 画面に出した1枚を小さく作り直して node_helper へ渡す。ここでしか作れない。
	// node_helper（Node 側）は画像を読み込む手段を持たず、リモコン（8081番）からは
	// 画像を配信している 8080番が見えないため、表示した瞬間のブラウザが唯一の入口になる。
	scaleToJpeg(img, maxSide, quality) {
		const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
		const scale = Math.min(1, maxSide / longest);
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
		canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
		const context = canvas.getContext("2d");
		// 透過 PNG をそのまま JPEG にすると透明部分が真っ黒に沈む。画面と同じ黒で埋める。
		context.fillStyle = "#000";
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(img, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL("image/jpeg", quality);
	},

	// フェードが終わってから作る。4K の画像だと縮小に数百ミリ秒かかることがあり、
	// 切り替えの最中に走らせると画面の動きが引っかかる。
	captureShots(img, url) {
		if (this.lastShot === url) return;
		clearTimeout(this.shotTimer);
		this.shotTimer = setTimeout(() => {
			if (this.pb.current() !== url) return; // 待っている間に次の画像へ進んでいた
			let shots;
			try {
				shots = {
					thumb: this.scaleToJpeg(img, 160, 0.6), // 一覧に並べる小さい版
					preview: this.scaleToJpeg(img, 1080, 0.8), // タップで開く拡大版
				};
			} catch (e) {
				// 縮小に失敗しても表示は続ける。リモコンはその1枚だけ名前表示になる。
				console.warn(`[yp-slideshow] 縮小画像を作れません: ${e.message}`);
				return;
			}
			this.lastShot = url;
			this.sendSocketNotification("YP_SLIDESHOW_SHOTS", { url, ...shots });
		}, this.config.fadeSpeed);
	},

	getDom() {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-r5";
		// この getDom が出す1枚。以降 playback を読み直さず shown を使う（onerror が
		// 遅れて発火したときに、どの画像に対する失敗かを見分けるため）。
		const shown = this.pb.current();
		if (!shown) {
			wrapper.className += " dimmed small";
			wrapper.textContent = "画像なし (~/signage/slides)";
			return wrapper;
		}
		// 画面に出す画像を ~/signage/r5-now.log に記録する。目視で「これ壊れてる」と
		// 気づいたときに、その場でファイル名を引けるようにするため。ブラウザ側は
		// ディスクに書けないので node_helper に投げる。
		// getDom は状態バッジの出し入れでも走るため、画像が実際に変わったときだけ送る。
		if (shown !== this.lastLogged) {
			this.lastLogged = shown;
			// reason を添えて「なぜこの画像に変わったか」も残す。手動送りと自動送りが
			// ログ上で区別できないと、prev/next の不具合を後から追えない。
			// 何枚目かも添える。リモコン側に「1180 / 2442」と出すためで、ログの書式は変えない。
			this.sendSocketNotification("YP_SLIDESHOW_NOW", {
				url: this.lastLogged,
				reason: this.reason,
				position: this.pb.position(),
				total: this.pb.size(),
			});
		}

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
			// 失敗通知が遅れて届いたときに位置を余計に進めないよう、今出している
			// 画像ぶんだけを拾う（連打すると2枚飛ぶのを防ぐ）。
			if (this.pb.current() !== shown) return;
			this.sendSocketNotification("YP_SLIDESHOW_BROKEN", { url: shown }); // ログ上の該当行に印を付ける
			// ここで即座に描き直してはいけない。ブラウザは <img> を画面に挿す前から
			// 読み込みを始めるため、onerror は「1つ前の画像のフェードがまだ動いている
			// 最中」に飛んでくる。その場で描き直すと、フェードが終わった時点で
			// MagicMirror 本体が用意済みの古い DOM（＝読めなかった画像）で上書きし、
			// 画面が真っ黒のまま止まる。自動送りが続いていれば次の更新で直るが、
			// repeatMode: none の末尾だと二度と描き直されない。
			// フェードが終わるのを待ってから退避する。
			clearTimeout(this.brokenTimer);
			this.brokenTimer = setTimeout(() => {
				if (this.pb.current() !== shown) return;
				// 次にどの画像へ逃がすか、全部だめなら止めるかは playback 側が決める。
				this.apply(this.pb.markBroken(shown), 0);
			}, this.config.fadeSpeed);
		};
		// 読み込めた画像だけを縮小の材料にする（onerror 側とは排他）。
		img.onload = () => {
			if (this.pb.current() !== shown) return;
			this.captureShots(img, shown);
		};
		img.src = shown;
		wrapper.appendChild(img);

		// 状態バッジはここでは作らない（renderStatusBadge が body 直下に置く）。
		// この wrapper は fullscreen_below にいるので、中に入れると最背面へ回ってしまう。
		return wrapper;
	},
});
