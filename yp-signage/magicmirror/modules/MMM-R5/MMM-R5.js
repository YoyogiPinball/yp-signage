/* MMM-R5 — ~/signage/r5 の画像を巡回表示する自作スライドショー。
 * MMM-ImageSlideshow を参考にした最小実装。画像の実体は node_helper が
 * /MMM-R5/images で静的配信し、ここではその URL を順に差し替えて表示する。
 * フェードは MM 標準の updateDom(speed) に任せる（モジュール領域ごと淡く切替）。
 * 配布先: ~/MagicMirror/modules/MMM-R5/
 */
Module.register("MMM-R5", {
	defaults: {
		imageDir: null, // null なら node_helper 側の既定 ~/signage/r5
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
		this.timer = null;
		this.requestImages();
		setInterval(() => this.requestImages(), this.config.refreshInterval);
		// ←/→ で手動送り（1枚戻る/進む）。手動操作後もオート巡回は継続する。
		document.addEventListener("keydown", (e) => {
			if (e.key === "ArrowRight") this.step(1);
			else if (e.key === "ArrowLeft") this.step(-1);
		});
	},

	// 手動で dir 枚ぶん送る（+1=次 / -1=前）。オートのタイマーもリセットして継続。
	step(dir) {
		if (this.images.length === 0) return;
		this.index = (this.index + dir + this.images.length) % this.images.length;
		this.updateDom(this.config.fadeSpeed);
		this.scheduleNext();
	},

	// node_helper に最新の画像一覧を要求する。
	requestImages() {
		this.sendSocketNotification("MMM_R5_GET_IMAGES", { imageDir: this.config.imageDir });
	},

	socketNotificationReceived(notification, payload) {
		if (notification !== "MMM_R5_IMAGES") return;
		let images = payload.images || [];
		if (this.config.shuffle) images = this.shuffleArray(images);
		this.images = images;
		if (this.index >= this.images.length) this.index = 0;

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
			this.index = (this.index + 1) % this.images.length;
			this.updateDom(this.config.fadeSpeed);
			this.scheduleNext();
		}, this.config.slideInterval);
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
			wrapper.textContent = "画像なし (~/signage/r5)";
			return wrapper;
		}
		// ぼかし拡大背景: 同じ画像を cover＋ぼかしで背面に敷き、レターボックスの帯を
		// 写真の延長（ぼかし）で埋める。前面の contain 画像は切れずに全体表示のまま。
		const bg = document.createElement("img");
		bg.className = "mmm-r5-bg";
		bg.src = this.images[this.index];
		wrapper.appendChild(bg);

		const img = document.createElement("img");
		img.className = "mmm-r5-img";
		// 読み込み失敗（0バイト・壊れ画像・非対応形式）は 60秒待たず即次へ送る。白画面で止めない。
		img.onerror = () => {
			if (this.images.length > 1) {
				this.index = (this.index + 1) % this.images.length;
				this.updateDom(0);
				this.scheduleNext();
			}
		};
		img.src = this.images[this.index];
		wrapper.appendChild(img);
		return wrapper;
	},
});
