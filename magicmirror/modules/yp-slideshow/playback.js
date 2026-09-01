/* yp-slideshow の画像順・現在位置・再生状態だけを扱う。
 * DOM・タイマー・通信は呼び出し側に残し、ここでは次に必要な操作を戻り値で返す。
 */

const naturalCollator = new Intl.Collator("en", { numeric: true });

function naturalCompare(a, b) {
	const left = String(a);
	const right = String(b);
	const compared = naturalCollator.compare(left, right);
	if (compared !== 0) return compared;
	// Collator は 01 と 1 のような組を同値にする。ここで決着を付けないと、
	// ファイルシステムの返却順によって同じカタログの並びが揺れる。
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function createPlayback(options = {}) {
	let selectedOrderMode = options.orderMode === "sequential" || options.orderMode === "shuffle"
		? options.orderMode
		: "shuffle";
	let selectedRepeatMode = options.repeatMode === "none" || options.repeatMode === "all" || options.repeatMode === "one"
		? options.repeatMode
		: "all";
	const random = typeof options.random === "function" ? options.random : Math.random;
	let catalog = [];
	let order = [];
	let index = 0;
	let playbackStatus = "playing";
	let revisionNumber = 0;
	const broken = new Set();

	function current() {
		return order[index] || null;
	}

	function allBroken() {
		return order.length > 0 && order.every((url) => broken.has(url));
	}

	function canSchedule() {
		return playbackStatus === "playing"
			&& order.length > 0
			&& selectedRepeatMode !== "one"
			&& !allBroken();
	}

	function result(changed = false, reason = "", schedule = false) {
		return {
			changed,
			url: current(),
			status: playbackStatus,
			reason,
			schedule,
			allBroken: allBroken(),
		};
	}

	function shuffle(list) {
		const shuffled = list.slice();
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return shuffled;
	}

	function sameList(left, right) {
		return left.length === right.length && left.every((url, i) => url === right[i]);
	}

	function setImages(list) {
		// 受け取った順をそのまま使う。並べ替えるのは呼び出し側（node_helper）の仕事で、
		// あちらは符号化前の実ファイル名で naturalCompare を掛けている。ここへ届くのは
		// "/yp-slideshow/images/%E3%81%82.jpg" のような符号化済み URL なので、
		// 掛け直すと "%E3..." を文字として比べることになり、日本語名や記号を含む画像の
		// 並びが画面とファイル名でずれる。
		const nextCatalog = (Array.isArray(list) ? list : []).slice();
		if (sameList(catalog, nextCatalog)) return result();

		const oldCatalog = catalog;
		const oldOrder = order;
		const oldIndex = index;
		const oldCurrent = current();
		const alive = new Set(nextCatalog);
		catalog = nextCatalog;

		if (oldOrder.length === 0) {
			order = selectedOrderMode === "shuffle" ? shuffle(catalog) : catalog.slice();
		} else if (selectedOrderMode === "sequential") {
			order = catalog.slice();
		} else {
			// 再取得のたびにシャッフルし直すと、同じ位置が別画像を指して prev が壊れる。
			// 消えた画像だけを落とし、新着だけを既存の並びへ散らして一巡の順序を守る。
			order = oldOrder.filter((url) => alive.has(url));
			const oldCatalogSet = new Set(oldCatalog);
			const added = catalog.filter((url) => !oldCatalogSet.has(url));
			for (const url of added) {
				const insertion = Math.floor(random() * (order.length + 1));
				order.splice(insertion, 0, url);
			}
		}

		if (oldCurrent && alive.has(oldCurrent)) {
			index = order.indexOf(oldCurrent);
		} else {
			// 表示中の画像が消えたとき先頭へ飛ぶと、直前・直後の関係まで失われる。
			// 古い並びで後ろにいた最初の生存画像へ貼り直し、無ければ先頭へ戻す。
			let successor = null;
			for (let i = oldIndex + 1; i < oldOrder.length; i++) {
				if (alive.has(oldOrder[i])) {
					successor = oldOrder[i];
					break;
				}
			}
			index = successor ? order.indexOf(successor) : 0;
		}
		if (index < 0 || index >= order.length) index = 0;

		// 画像の増減後まで古い失敗記録を持つと、戻ってきた画像を試さず除外してしまう。
		const hadBroken = broken.size > 0;
		broken.clear();
		revisionNumber++;
		// 失敗記録を捨てたときは、表示中の画像が同じでも描き直す。読み込みに失敗した
		// ままの <img> が画面に残っていることがあり、描き直さないと再試行が起きない
		// （全画像が壊れていた後に正常な画像を足しても、真っ黒のままになる）。
		const changed = oldCurrent !== current() || hadBroken;
		// 空から復帰した最初の1枚は one でも一度タイマーへ渡す。advance() が同じ画像に
		// 留まって張り直しを止めるため、以後は無意味な更新を繰り返さない。
		const restored = oldOrder.length === 0 && order.length > 0;
		const schedule = playbackStatus === "playing" && order.length > 0
			&& (restored || selectedRepeatMode !== "one");
		return result(changed, "", schedule);
	}

	function advance() {
		if (playbackStatus !== "playing" || order.length === 0 || allBroken()) return result();
		if (selectedRepeatMode === "one") return result();
		if (selectedRepeatMode === "none" && index === order.length - 1) {
			playbackStatus = "ended";
			revisionNumber++;
			return result();
		}

		const before = current();
		index = (index + 1) % order.length;
		if (before !== current()) revisionNumber++;
		return result(before !== current(), "", true);
	}

	function step(dir) {
		if (order.length === 0) return result();
		const direction = dir > 0 ? 1 : -1;
		const reason = direction > 0 ? "next" : "prev";

		if (playbackStatus === "ended") {
			if (direction > 0) return result();
			const before = current();
			index = Math.max(0, index - 1);
			playbackStatus = "paused";
			revisionNumber++;
			return result(before !== current(), "prev", false);
		}

		const nextIndex = index + direction;
		if (nextIndex < 0 || nextIndex >= order.length) {
			if (selectedRepeatMode !== "all") return result(false, "", canSchedule());
			const before = current();
			index = nextIndex < 0 ? order.length - 1 : 0;
			if (before !== current()) revisionNumber++;
			return result(before !== current(), reason, canSchedule());
		}

		const before = current();
		index = nextIndex;
		revisionNumber++;
		return result(before !== current(), reason, canSchedule());
	}

	function setOrderMode(mode) {
		const nextMode = mode === "sequential" || mode === "shuffle" ? mode : "shuffle";
		if (nextMode === selectedOrderMode) return result();

		const shown = current();
		selectedOrderMode = nextMode;
		order = selectedOrderMode === "shuffle" ? shuffle(catalog) : catalog.slice();
		const found = shown ? order.indexOf(shown) : -1;
		index = found >= 0 ? found : 0;
		if (playbackStatus === "ended") playbackStatus = "paused";
		revisionNumber++;
		return result(false, "", canSchedule());
	}

	function setRepeatMode(mode) {
		const nextMode = mode === "none" || mode === "all" || mode === "one" ? mode : "all";
		if (nextMode === selectedRepeatMode) return result();
		selectedRepeatMode = nextMode;
		if (playbackStatus === "ended") playbackStatus = "paused";
		revisionNumber++;
		return result(false, "", canSchedule());
	}

	function pause() {
		if (playbackStatus !== "playing") return result();
		playbackStatus = "paused";
		revisionNumber++;
		return result();
	}

	function resume() {
		if (playbackStatus !== "paused") return result();
		playbackStatus = "playing";
		revisionNumber++;
		return result(false, "", canSchedule());
	}

	function restart() {
		const hadFailures = broken.size > 0;
		const statusChanged = playbackStatus !== "playing";
		index = 0;
		playbackStatus = "playing";
		broken.clear();
		if (order.length > 0 || hadFailures || statusChanged) revisionNumber++;
		// restart は同じ先頭画像でも描画し直す契約にする。壊れ画像の DOM を捨て、
		// one のときも一度だけ読み込みを試せるようタイマーも明示的に張り直す。
		return result(order.length > 0, "", order.length > 0);
	}

	function markBroken(url) {
		const wasBroken = broken.has(url);
		broken.add(url);
		if (allBroken()) {
			if (!wasBroken) revisionNumber++;
			return result(false, "", false);
		}
		if (order.length === 0) {
			if (!wasBroken) revisionNumber++;
			return result();
		}

		const before = current();
		for (let offset = 1; offset <= order.length; offset++) {
			const candidate = (index + offset) % order.length;
			if (!broken.has(order[candidate])) {
				index = candidate;
				break;
			}
		}
		if (!wasBroken || before !== current()) revisionNumber++;
		return result(before !== current(), "alt", canSchedule());
	}

	return {
		current,
		status: () => playbackStatus,
		size: () => order.length,
		// いま何枚目か（1始まり。画像が無いときは 0）。リモコンに「1180 / 2442」と
		// 出すためだけの値で、再生の判断には使わない。シャッフル中はこの巡での位置。
		position: () => (order.length === 0 ? 0 : index + 1),
		orderMode: () => selectedOrderMode,
		repeatMode: () => selectedRepeatMode,
		revision: () => revisionNumber,
		setImages,
		advance,
		step,
		setOrderMode,
		setRepeatMode,
		pause,
		resume,
		restart,
		markBroken,
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { createPlayback, naturalCompare };
}
