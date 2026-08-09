/* yp-demoweather — デモモード専用の天気パネル。通信せず、固定の5日予報を描くだけ。
 *
 * なぜ組み込みの weather モジュールを使わないのか:
 *   組み込み天気は provider（OpenWeatherMap 等）が実際にネットへ取りに行く作りで、
 *   偽のデータを流すには MagicMirror 本体の modules/default/weather/ に provider を
 *   足すことになる。「本体は改変しない」という配布の前提が崩れ、本体を更新するたびに
 *   その差分が消える。触らずに済ませるため、見た目だけ揃えた小さなモジュールを別に置く。
 *
 * DOM は組み込み天気の forecast テンプレートと同じ構造・同じクラス名にしてある
 * （table > tr > td.day / td.weather-icon / td.max-temp / td.min-temp）。
 * こうしておくと custom.css の .weather-forecast 向けの調整がそのまま効く。
 *
 * 配布先: ~/MagicMirror/modules/yp-demoweather/
 */
Module.register("yp-demoweather", {
	defaults: {
		days: 5, // 何日ぶん出すか
		// 表示する予報。実データではないので、季節感のある固定値を並べておく。
		// wi-* は weather-icons のクラス名（本体が vendor として持っている）。
		forecast: [
			{ icon: "wi-day-sunny", max: 31, min: 24 },
			{ icon: "wi-day-cloudy", max: 29, min: 24 },
			{ icon: "wi-rain", max: 26, min: 23 },
			{ icon: "wi-day-sunny-overcast", max: 28, min: 23 },
			{ icon: "wi-day-sunny", max: 32, min: 25 },
		],
	},

	// weather-icons は本体が vendor として持っているので、名前で要求すれば解決される。
	// 本体のファイルには触らない。
	getStyles() {
		return ["weather-icons.css", "yp-demoweather.css"];
	},

	start() {
		// 日付が変わったら見出しの日付もずらす。デモ画面を出しっぱなしにしても
		// 「昨日の日付が並んでいる」状態にならないように、1時間ごとに引き直す。
		setInterval(() => this.updateDom(0), 60 * 60 * 1000);
	},

	// 「19（日）」形式。組み込み天気を absoluteDates: true で使ったときと同じ見え方に揃える。
	formatDay(date) {
		const w = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
		return `${date.getDate()}（${w}）`;
	},

	getDom() {
		const wrapper = document.createElement("div");
		const table = document.createElement("table");
		table.className = "small";

		const today = new Date();
		const rows = this.config.forecast.slice(0, this.config.days);
		rows.forEach((f, i) => {
			const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
			const tr = document.createElement("tr");

			const day = document.createElement("td");
			day.className = "day";
			day.textContent = this.formatDay(date);
			tr.appendChild(day);

			const icon = document.createElement("td");
			icon.className = "bright weather-icon";
			const span = document.createElement("span");
			span.className = `wi weathericon ${f.icon}`;
			icon.appendChild(span);
			tr.appendChild(icon);

			const max = document.createElement("td");
			max.className = "align-right bright max-temp";
			max.textContent = `${f.max}°`;
			tr.appendChild(max);

			const min = document.createElement("td");
			min.className = "align-right min-temp";
			min.textContent = `${f.min}°`;
			tr.appendChild(min);

			table.appendChild(tr);
		});

		wrapper.appendChild(table);
		return wrapper;
	},
});
