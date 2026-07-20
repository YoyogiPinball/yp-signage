/* magicmirror/secrets.js のテンプレート。
 * このファイル(.example)はコミットする。実体の secrets.js は .gitignore 済みでコミットしない。
 * 使い方: このファイルを secrets.js にコピーし、値を実物に差し替える。
 *   cp secrets.example.js secrets.js
 * 配布先(X13)では ~/MagicMirror/config/secrets.js に置く（config.js と同じディレクトリ）。
 */
module.exports = {
	// oshi-sche の iCal フィード、または Google カレンダーの「限定公開URL(iCal形式)」。
	// URL を知っていれば予定を読めるトークン付きURLのため、ここ(secrets)に置く。
	calendarIcs: "https://oshi-sche-webapp.vercel.app/api/ical/YOUR-CALENDAR-ID",

	// 天気（OpenWeatherMap 無料API）。空の間は天気パネルを出さない（起動は止めない）。
	// 取得: https://openweathermap.org/ で登録 → API keys の Default キーをコピー。
	owmApiKey: "",
	// 地域（緯度経度）。未設定なら東京(35.681, 139.767)。設置場所に合わせて上書き可。
	// weatherLat: 35.681,
	// weatherLon: 139.767,
};
