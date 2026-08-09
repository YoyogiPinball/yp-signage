#!/bin/bash
# 手元の画像フォルダを表示機へ片方向同期する（手元で実行 → 表示機へ push）。
#
# 使い方: ./sync-images.sh [--dry-run]
#   --dry-run : 転送も削除もせず、何が起きるかだけを表示する
#
# 正本は手元側。表示機の ~/signage/slides/ をその鏡にする。
# 元で消えたファイルは表示機でも消すが、実体は ~/signage/.trash/<日付>/ へ退避する。
# 退避先を slides/ の外に置いているのは、yp-slideshow が slides/ 以下を再帰スキャンするため。
# 中に置くと「消したはずの画像」がスライドショーに出続ける。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SUBDIR=slides             # 表示機側 ~/signage/<SUBDIR>/
TRASH=.trash              # 表示機側 ~/signage/<TRASH>/<日付>/
TRASH_KEEP_DAYS=30
STATE="$HOME/.local/state/yp-signage"
LOG="$STATE/sync-images.log"
LOCK="$STATE/sync-images.lock"

# 同期ペア「手元の元パス|表示機側のフォルダ名」。表示機では ~/signage/slides/<フォルダ名>/ になる。
# 下は例で、実際の値は signage.conf に書く（gitignore 済み。ひな形は signage.conf.example）。
PAIRS=(
	"$HOME/Pictures/signage|main"
)
SIGNAGE_HOST_DEFAULT=""

# 設定の優先順位は「コマンド行の環境変数 > signage.conf > このファイルの既定値」。
# conf を先に読み、そのあとで環境変数を最終適用する。逆順にすると
# `SIGNAGE_HOST=... ./sync-images.sh` が conf に上書きされて効かなくなる。
CONF="$ROOT/signage.conf"
# shellcheck source=/dev/null
[ -f "$CONF" ] && . "$CONF"

HOST="${SIGNAGE_HOST:-$SIGNAGE_HOST_DEFAULT}"
if [ -z "$HOST" ]; then
	echo "配布先が決まっていません。次のどちらかで指定してください:" >&2
	echo "  1) $ROOT/signage.conf に SIGNAGE_HOST_DEFAULT=\"<ssh の設定名>\" を書く" >&2
	echo "  2) SIGNAGE_HOST=<ssh の設定名> ./sync-images.sh のように渡す" >&2
	exit 1
fi

DRY=()
[ "${1:-}" = "--dry-run" ] && DRY=(--dry-run)

mkdir -p "$STATE"
# 記録の正本は $LOG。標準出力へは端末から手で叩いたときだけ出す。
# systemd 経由で stdout を journald へ流すと、この環境では短命サービスの出力が
# 取りこぼされ「一部の行だけ残る」中途半端な記録になり、誤読を招くため。
# 異常時だけは stderr に出し、journal と systemctl status から気づけるようにする。
log() {
	local m="$(date '+%F %T') $*"
	printf '%s\n' "$m" >>"$LOG"
	if [ -t 1 ]; then printf '%s\n' "$m"; fi
}
log_err() {
	local m="$(date '+%F %T') $*"
	printf '%s\n' "$m" >>"$LOG"
	printf '%s\n' "$m" >&2
}

# 多重起動の防止。前回が長引いている間に次の起動が重なると、同じファイルを
# 二重に転送したりゴミ箱の日付が混ざったりするため、後発は黙って降りる。
exec 9>"$LOCK"
if ! flock -n 9; then
	log "skip: 前回の同期がまだ実行中"
	exit 0
fi

# rsync の判定条件。詳細は README「画像同期」参照。
#   -rt         再帰 + 更新時刻の保持。-a は使わない（Windows 側の権限は偽の値で、
#               持ち込むと毎回「権限が違う」と判定され全ファイルが再転送になる）
#   --size-only サイズが同じなら同一とみなす。過去の手動コピーで時刻が壊れており、
#               時刻比較だと中身が同じ 1,800 枚を毎回送り直すことになるため
#   -f '- .*/'  .stfolder / .stversions など Syncthing・Drive の管理フォルダを除外
#   最後の '- *' で、上で通した画像拡張子以外をすべて落とす
RSYNC_OPTS=(
	-rt --size-only --delete
	--protect-args
	--timeout=600
	-e "ssh -o BatchMode=yes -o ConnectTimeout=15"
	-f '- .*/'
	-f '+ */'
	-f '+ *.[jJ][pP][gG]' -f '+ *.[jJ][pP][eE][gG]' -f '+ *.[pP][nN][gG]'
	-f '+ *.[gG][iI][fF]' -f '+ *.[wW][eE][bB][pP]' -f '+ *.[bB][mM][pP]'
	-f '- *'
)

# 表示機のホームは環境によって変わるので決め打ちしない。ここで疎通確認も兼ねる。
if ! REMOTE_HOME=$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" 'echo "$HOME"' 2>/dev/null); then
	log_err "abort: $HOST へ接続できない（電源断・ネットワーク断）。次回に持ち越す"
	exit 0
fi

STAMP=$(date +%F)
FAILED=0
log "=== 同期開始 ${DRY[*]:-} ==="

for pair in "${PAIRS[@]}"; do
	SRC="${pair%%|*}"
	NAME="${pair##*|}"

	if [ ! -d "$SRC" ]; then
		log_err "  [$NAME] skip: 同期元が見つからない ($SRC)"
		FAILED=1
		continue
	fi

	OUT=$(mktemp)
	if rsync "${RSYNC_OPTS[@]}" "${DRY[@]}" --itemize-changes \
		--backup --backup-dir="$REMOTE_HOME/signage/$TRASH/$STAMP/$NAME" \
		"$SRC/" "$HOST:$REMOTE_HOME/signage/$SUBDIR/$NAME/" >"$OUT" 2>&1
	then
		SENT=$(grep -c '^<f' "$OUT" || true)
		GONE=$(grep -c '^\*deleting' "$OUT" || true)
		TOUCH=$(grep -c '^\.f' "$OUT" || true)
		log "  [$NAME] 転送 $SENT / 削除 $GONE / 時刻のみ修正 $TOUCH"
		if [ "$GONE" -gt 0 ]; then
			grep '^\*deleting' "$OUT" | sed 's/^/      退避: /' >>"$LOG"
		fi
	else
		log_err "  [$NAME] 失敗 (rsync 終了コード $?)"
		sed 's/^/      /' "$OUT" | tail -20 >>"$LOG"
		FAILED=1
	fi
	rm -f "$OUT"
done

# 古い退避世代の掃除。日付フォルダだけを対象にし、掃除後の空ディレクトリも畳む。
if [ ${#DRY[@]} -eq 0 ]; then
	ssh -o BatchMode=yes "$HOST" \
		"find '$REMOTE_HOME/signage/$TRASH' -mindepth 1 -maxdepth 1 -type d -name '20*-*-*' -mtime +$TRASH_KEEP_DAYS -exec rm -rf {} + 2>/dev/null;
		 find '$REMOTE_HOME/signage/$TRASH' -mindepth 1 -type d -empty -delete 2>/dev/null" || true
fi

log "=== 同期完了 ==="
exit "$FAILED"
