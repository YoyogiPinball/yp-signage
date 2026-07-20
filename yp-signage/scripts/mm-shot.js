/* MagicMirror の現在表示を1枚キャプチャする（オフスクリーンではなく隠しウィンドウ）。
 * 稼働中の signage には触れず、別プロセスの Electron で localhost:8080 を開いて撮る。
 * XWayland 実描画で JS を完走させるのが要点。offscreen:true は SIGSEGV するため使わない。
 * 呼び出しは mm-shot.sh 経由（DISPLAY / XAUTHORITY などの環境変数を整えてから起動する）。
 */
const { app, BrowserWindow } = require("electron");
const fs = require("fs");

const OUT = process.env.SHOT_OUT || "/tmp/mm-shot.png";
const W = parseInt(process.env.SHOT_W || "1080", 10);
const H = parseInt(process.env.SHOT_H || "1920", 10);
const WAIT = parseInt(process.env.SHOT_WAIT || "12000", 10); // モジュール描画を待つ(ms)
const URL = process.env.SHOT_URL || "http://localhost:8080";

app.commandLine.appendSwitch("ozone-platform", "x11");

app.on("ready", async () => {
	const win = new BrowserWindow({ width: W, height: H, show: false, frame: false });
	try {
		await win.loadURL(URL);
		await new Promise((r) => setTimeout(r, WAIT));
		const img = await win.capturePage();
		fs.writeFileSync(OUT, img.toPNG());
		console.log(`saved ${OUT} ${img.getSize().width}x${img.getSize().height}`);
		app.exit(0);
	} catch (e) {
		console.error(`capture failed: ${e.message}`);
		app.exit(1);
	}
});
