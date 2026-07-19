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
};
