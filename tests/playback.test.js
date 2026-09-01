/* playback.js（スライドショーの並び・現在位置・再生状態）のテスト。
 *
 * 何を保証するか:
 *   - 2種類の並び順 × 3種類のくり返し × 3つの再生状態の組み合わせで、
 *     次に出す画像と「自動送りタイマーを張り直すか」が仕様どおりに決まること
 *   - 10分ごとの画像一覧の再取得で並びを作り直さないこと（作り直すと「前へ」が
 *     さっき見た画像に戻らなくなる。実際に起きた不具合の再発防止）
 *   - 画像0枚・1枚・全部壊れている・表示中の画像が消えた、の各場合で止まらないこと
 *
 * 何は保証しないか（実機で見るしかないもの）:
 *   - 画面の見た目、フェード、右クリックメニュー、バッジの位置
 *   - MagicMirror 本体との噛み合わせ（updateDom の挙動）
 *   手順と確認用の素材は vault の core/playback-manual-check.md にある。
 *
 * 走らせ方: リポジトリのルートで `node --test tests/`
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlayback, naturalCompare } = require("../magicmirror/modules/yp-slideshow/playback.js");

function sequential(repeatMode = "all") {
	return createPlayback({ orderMode: "sequential", repeatMode });
}

test("sequential × all は末尾から先頭へ戻る", () => {
	const playback = sequential("all");
	playback.setImages(["1.jpg", "2.jpg"]);
	playback.advance();
	const result = playback.advance();
	assert.equal(result.url, "1.jpg");
	assert.equal(result.changed, true);
	assert.equal(result.schedule, true);
});

test("sequential × none は末尾で ended になる", () => {
	const playback = sequential("none");
	playback.setImages(["1.jpg", "2.jpg"]);
	playback.advance();
	const result = playback.advance();
	assert.equal(result.status, "ended");
	assert.equal(result.changed, false);
	assert.equal(result.schedule, false);
});

test("sequential × one は自動送りを張り直さない", () => {
	const playback = sequential("one");
	playback.setImages(["1.jpg", "2.jpg"]);
	const result = playback.advance();
	assert.equal(result.url, "1.jpg");
	assert.equal(result.changed, false);
	assert.equal(result.schedule, false);
});

test("shuffle の一巡では同じ画像を二度表示しない", () => {
	const playback = createPlayback({ orderMode: "shuffle", repeatMode: "all", random: () => 0.5 });
	playback.setImages(["1.jpg", "2.jpg", "3.jpg", "4.jpg"]);
	const shown = [playback.current()];
	for (let i = 1; i < playback.size(); i++) shown.push(playback.advance().url);
	assert.equal(new Set(shown).size, playback.size());
});

test("none の末尾で手動の次へを押しても ended にならない", () => {
	const playback = sequential("none");
	playback.setImages(["1.jpg", "2.jpg"]);
	playback.step(1);
	const result = playback.step(1);
	assert.equal(result.changed, false);
	assert.equal(result.status, "playing");
});

test("ended から前へ戻ると paused になる", () => {
	const playback = sequential("none");
	playback.setImages(["1.jpg", "2.jpg"]);
	playback.advance();
	playback.advance();
	const result = playback.step(-1);
	assert.equal(result.url, "1.jpg");
	assert.equal(result.status, "paused");
	assert.equal(result.reason, "prev");
});

test("ended では resume は無効で restart は先頭から再生する", () => {
	const playback = sequential("none");
	playback.setImages(["1.jpg", "2.jpg"]);
	playback.advance();
	playback.advance();
	assert.equal(playback.resume().status, "ended");
	const result = playback.restart();
	assert.equal(result.url, "1.jpg");
	assert.equal(result.status, "playing");
	assert.equal(result.schedule, true);
});

test("ended で repeatMode を変えても自動再生は始めない", () => {
	const playback = sequential("none");
	playback.setImages(["1.jpg"]);
	playback.advance();
	const result = playback.setRepeatMode("all");
	assert.equal(result.status, "paused");
	assert.equal(result.schedule, false);
});

test("all の手動送りは両端を回り込む", () => {
	const playback = sequential("all");
	playback.setImages(["1.jpg", "2.jpg"]);
	assert.equal(playback.step(-1).url, "2.jpg");
	assert.equal(playback.step(1).url, "1.jpg");
});

test("none と one の手動送りは端で止まる", () => {
	for (const mode of ["none", "one"]) {
		const playback = sequential(mode);
		playback.setImages(["1.jpg", "2.jpg"]);
		assert.equal(playback.step(-1).changed, false);
		playback.step(1);
		assert.equal(playback.step(1).changed, false);
	}
});

test("再取得しても shuffle の既存画像の順序を保つ", () => {
	const playback = createPlayback({ orderMode: "shuffle", repeatMode: "all", random: () => 0 });
	playback.setImages(["a.jpg", "b.jpg", "c.jpg"]);
	playback.advance();
	playback.advance();
	assert.equal(playback.current(), "a.jpg");
	playback.setImages(["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
	const after = [playback.current()];
	for (let i = 1; i < playback.size(); i++) after.push(playback.advance().url);
	assert.deepEqual(after.filter((url) => url !== "d.jpg"), ["a.jpg", "b.jpg", "c.jpg"]);
});

test("shuffle へ切り替えるたびに並びを作り直して表示画像は保つ", () => {
	let randomValue = 0.999;
	const playback = createPlayback({ orderMode: "shuffle", repeatMode: "all", random: () => randomValue });
	playback.setImages(["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
	playback.setOrderMode("sequential");
	const shown = playback.current();
	randomValue = 0.5;
	const result = playback.setOrderMode("shuffle");
	assert.equal(result.url, shown);
	assert.equal(result.changed, false);
	assert.equal(playback.advance().url, "d.jpg");
});

test("表示中の画像が消えたら古い並びの直後の生存画像へ移る", () => {
	const playback = sequential();
	playback.setImages(["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
	playback.advance();
	const result = playback.setImages(["a.jpg", "c.jpg", "d.jpg"]);
	assert.equal(result.url, "c.jpg");
	assert.equal(result.changed, true);
});

test("空の並びでは advance が何もしない", () => {
	const playback = sequential();
	playback.setImages([]);
	assert.doesNotThrow(() => playback.advance());
	assert.deepEqual(playback.advance(), {
		changed: false, url: null, status: "playing", reason: "", schedule: false, allBroken: false,
	});
});

test("空から画像が戻ると playing なら自動再開する", () => {
	const playback = sequential();
	playback.setImages(["a.jpg"]);
	playback.setImages([]);
	const result = playback.setImages(["b.jpg"]);
	assert.equal(result.changed, true);
	assert.equal(result.schedule, true);
});

test("空から画像が戻っても paused なら自動再開しない", () => {
	const playback = sequential();
	playback.pause();
	const result = playback.setImages(["a.jpg"]);
	assert.equal(result.changed, true);
	assert.equal(result.status, "paused");
	assert.equal(result.schedule, false);
});

test("壊れた画像は未失敗の次画像へ退避する", () => {
	const playback = sequential();
	playback.setImages(["a.jpg", "b.jpg", "c.jpg"]);
	const result = playback.markBroken("a.jpg");
	assert.equal(result.url, "b.jpg");
	assert.equal(result.reason, "alt");
	assert.equal(result.changed, true);
});

test("全画像が壊れたら allBroken で自動送りを止める", () => {
	const playback = sequential();
	playback.setImages(["a.jpg", "b.jpg"]);
	playback.markBroken("a.jpg");
	const result = playback.markBroken("b.jpg");
	assert.equal(result.allBroken, true);
	assert.equal(result.schedule, false);
	assert.equal(playback.advance().changed, false);
});

test("一時停止中の壊れ画像退避は自動再生を始めない", () => {
	const playback = sequential();
	playback.setImages(["a.jpg", "b.jpg"]);
	playback.pause();
	const result = playback.markBroken("a.jpg");
	assert.equal(result.url, "b.jpg");
	assert.equal(result.schedule, false);
});

test("失敗済み画像へ手動で戻っても次の未失敗画像へ退避する", () => {
	const playback = sequential();
	playback.setImages(["a.jpg", "b.jpg", "c.jpg"]);
	playback.markBroken("a.jpg");
	playback.step(-1);
	const result = playback.markBroken("a.jpg");
	assert.equal(result.url, "b.jpg");
	assert.equal(result.reason, "alt");
});

test("revision は状態変更ごとに増え、無操作では増えない", () => {
	const playback = sequential();
	assert.equal(playback.revision(), 0);
	playback.setImages(["a.jpg", "b.jpg"]);
	assert.equal(playback.revision(), 1);
	playback.advance();
	assert.equal(playback.revision(), 2);
	playback.pause();
	assert.equal(playback.revision(), 3);
	playback.pause();
	assert.equal(playback.revision(), 3);
});

test("naturalCompare は数値を自然順に並べる", () => {
	const sorted = ["10.jpg", "2.jpg", "1.jpg"].sort(naturalCompare);
	assert.deepEqual(sorted, ["1.jpg", "2.jpg", "10.jpg"]);
});

test("naturalCompare は Collator が同値にする組も順序を確定する", () => {
	const forward = naturalCompare("1.jpg", "01.jpg");
	const backward = naturalCompare("01.jpg", "1.jpg");
	assert.notEqual(forward, 0);
	assert.equal(forward, -backward);
});

test("不正なモードは既定値へ落ちる", () => {
	const playback = createPlayback({ orderMode: "unknown", repeatMode: "unknown" });
	assert.equal(playback.orderMode(), "shuffle");
	assert.equal(playback.repeatMode(), "all");
});

test("画像が1枚だけなら all の advance でも表示変更にならない", () => {
	const playback = sequential("all");
	playback.setImages(["only.jpg"]);
	const revision = playback.revision();
	const result = playback.advance();
	assert.equal(result.url, "only.jpg");
	assert.equal(result.changed, false);
	assert.equal(result.schedule, true);
	assert.equal(playback.revision(), revision);
});

// 並べ替えるのは node_helper（符号化前の実ファイル名で naturalCompare を掛ける側）の仕事。
// ここで掛け直すと "%E3%81%82.jpg" のような符号化済み URL を文字として比べることになり、
// 日本語名の画像が数字より前に来て、画面の並びがファイル名の並びと食い違う。
test("setImages は受け取った順をそのまま並びにする", () => {
	const playback = sequential();
	const helperOrder = ["/img/2.jpg", "/img/10.jpg", "/img/%E3%81%82.jpg"];
	playback.setImages(helperOrder);
	assert.equal(playback.current(), "/img/2.jpg");
	assert.equal(playback.advance().url, "/img/10.jpg");
	assert.equal(playback.advance().url, "/img/%E3%81%82.jpg");
});

test("全画像が壊れた後に正常な画像が増えたら、one でも描き直す", () => {
	const playback = createPlayback({ orderMode: "sequential", repeatMode: "one" });
	playback.setImages(["bad.jpg"]);
	assert.equal(playback.markBroken("bad.jpg").allBroken, true);
	// 描き直しを返さないと、読み込みに失敗した <img> が画面に残ったままになる。
	const result = playback.setImages(["bad.jpg", "good.jpg"]);
	assert.equal(result.changed, true);
	assert.equal(result.allBroken, false);
});

test("画像の増減と restart は失敗記録を消す", () => {
	const playback = sequential();
	playback.setImages(["a.jpg", "b.jpg"]);
	playback.markBroken("a.jpg");
	playback.setImages(["a.jpg", "b.jpg", "c.jpg"]);
	assert.equal(playback.markBroken("b.jpg").allBroken, false);
	playback.markBroken("c.jpg");
	playback.restart();
	assert.equal(playback.markBroken("a.jpg").allBroken, false);
});

test("position は1始まりで進み、画像が無いときは0を返す", () => {
	const playback = sequential();
	// リモコンに「1 / 3 枚目」と出すための値。0始まりのまま出すと最後の1枚で
	// 「2 / 3」と表示され、見ている人には1枚ずれて見える。
	assert.equal(playback.position(), 0);
	playback.setImages(["1.jpg", "2.jpg", "3.jpg"]);
	assert.equal(playback.position(), 1);
	playback.advance();
	assert.equal(playback.position(), 2);
	playback.step(-1);
	assert.equal(playback.position(), 1);
	playback.setImages([]);
	assert.equal(playback.position(), 0);
});
