#!/usr/bin/env bash
set -euo pipefail

# Removes deleted and private videos from your YouTube playlists (dry run unless --apply).
# Settings from the project root .env: YOUTUBE_COOKIES_BROWSER, YOUTUBE_LISTS_DB.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
VENV_DIR="$SCRIPT_DIR/.venv"

env_value() {
    local key="$1" value=""
    if [[ -n "${!key:-}" ]]; then printf '%s' "${!key}"; return; fi
    if [[ -f "$ENV_FILE" ]]; then
        value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d '=' -f2- \
            | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["\x27]//' -e 's/["\x27]$//' || true)"
    fi
    printf '%s' "$value"
}
absolute() { if [[ "$1" == /* ]]; then printf '%s' "$1"; else printf '%s' "$ROOT_DIR/$1"; fi; }

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    cat <<'MANUAL'
youtube-clean: remove deleted and private videos from your YouTube playlists

  YouTube keeps deleted and private videos in playlists as "[Deleted video]" / "[Private video]".
  This finds them in every playlist you own (Watch later included) and removes them.

  DRY RUN BY DEFAULT: without --apply nothing is changed, it only lists what would be removed.

USAGE
  ./crawlers/youtube-clean/run.sh                          list what would be removed (no changes)
  ./crawlers/youtube-clean/run.sh --apply                  remove them
  ./crawlers/youtube-clean/run.sh --playlist Build --apply only one playlist
  ./crawlers/youtube-clean/run.sh --only deleted --apply   only deleted videos (keep private ones)
  ./crawlers/youtube-clean/run.sh --limit 20 --apply       at most 20 removals this run

NOTES
  - Every removal is logged first in database/database_files/youtube-clean-log.csv.
  - Liked videos are skipped unless --include-liked (removing from it means un-liking).
  - Playlists you saved from other people can't be edited and are skipped.
  - Afterwards run ./crawlers/youtube-lists/run.sh so your notes follow.

SETTINGS (project root .env)
  YOUTUBE_COOKIES_BROWSER, YOUTUBE_LISTS_DB
MANUAL
    if [[ -x "$VENV_DIR/bin/python" ]]; then
        echo; echo "ALL OPTIONS (--db and --browser are passed by run.sh)"
        "$VENV_DIR/bin/python" "$SCRIPT_DIR/youtube-clean.py" --help | sed -n '/^options:/,$p' | tail -n +2
    fi
    exit 0
fi

BROWSER="$(env_value YOUTUBE_COOKIES_BROWSER)"
DB_FILE="$(env_value YOUTUBE_LISTS_DB)"
if [[ -z "$BROWSER" || -z "$DB_FILE" ]]; then
    echo "Error: YOUTUBE_COOKIES_BROWSER and YOUTUBE_LISTS_DB must be set in $ENV_FILE" >&2
    exit 1
fi
case "$BROWSER" in
    chrome|chromium|brave|edge|opera|vivaldi) BROWSER="$BROWSER+gnomekeyring" ;;
esac

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
    echo "==> Creating virtualenv at $VENV_DIR"
    python3 -m venv "$VENV_DIR"
fi
echo "==> Installing dependencies"
"$VENV_DIR/bin/python" -m pip install --quiet --upgrade pip
"$VENV_DIR/bin/python" -m pip install --quiet --upgrade -r "$SCRIPT_DIR/requirements.txt"

"$VENV_DIR/bin/python" "$SCRIPT_DIR/youtube-clean.py" --db "$(absolute "$DB_FILE")" --browser "$BROWSER" "$@"
