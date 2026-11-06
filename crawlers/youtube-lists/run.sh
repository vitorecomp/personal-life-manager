#!/usr/bin/env bash
set -euo pipefail

# Incrementally syncs your YouTube playlists into a SQLite database and renders Markdown notes
# for every playlist and video, running youtube-lists.py inside its own virtualenv.
#
# Settings come from the project root .env (see .env.example):
#   YOUTUBE_COOKIES_BROWSER  browser to read YouTube login cookies from
#   YOUTUBE_COOKIES_FILE     or a cookies.txt file instead (takes precedence)
#   YOUTUBE_LISTS_DB         SQLite database path
#   YOUTUBE_LISTS_NOTES_DIR  folder for the playlist and video notes
#   YOUTUBE_MY_CHANNEL_ID    optional, for "Created by me"
#   YOUTUBE_LISTS_WORKERS    optional, videos fetched at the same time (default 4)
# Relative paths are relative to the project root.
#
# Usage: ./run.sh [browser] [extra youtube-lists.py args]
#   e.g. ./run.sh
#        ./run.sh firefox --no-special      (a browser argument overrides the .env value)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
VENV_DIR="$SCRIPT_DIR/.venv"

# Read KEY=value from .env without executing it; the environment wins over the file.
env_value() {
    local key="$1" value=""
    if [[ -n "${!key:-}" ]]; then
        printf '%s' "${!key}"
        return
    fi
    if [[ -f "$ENV_FILE" ]]; then
        value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d '=' -f2- \
            | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["\x27]//' -e 's/["\x27]$//' || true)"
    fi
    printf '%s' "$value"
}

absolute() {
    if [[ "$1" == /* ]]; then printf '%s' "$1"; else printf '%s' "$ROOT_DIR/$1"; fi
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    cat <<'MANUAL'
youtube-lists: sync your YouTube playlists into SQLite and Markdown notes

  Every playlist gets <notes>/<playlist>/<playlist>.md, every video its own folder
  <notes>/<playlist>/videos/<title>/<title>.md with metadata, description, chapters, latest comments
  and the transcript in the video's original language. Runs are incremental; nothing is deleted
  (videos that leave every playlist move to removed/, unavailable ones get a hidden .folder).

USAGE
  ./crawlers/youtube-lists/run.sh [browser] [options]

  ./crawlers/youtube-lists/run.sh                        browser and paths from .env
  ./crawlers/youtube-lists/run.sh firefox                use another browser's login cookies
  ./crawlers/youtube-lists/run.sh --details-limit 200    fetch at most 200 video details this run
  ./crawlers/youtube-lists/run.sh --workers 8            8 videos at a time (default 4)
  ./crawlers/youtube-lists/run.sh --listing-workers 5    list 5 playlists at a time (default 3)
  ./crawlers/youtube-lists/unavailable-report.py         table of deleted/private videos per playlist

SETTINGS (project root .env)
  YOUTUBE_COOKIES_BROWSER (or YOUTUBE_COOKIES_FILE), YOUTUBE_LISTS_DB, YOUTUBE_LISTS_NOTES_DIR,
  YOUTUBE_MY_CHANNEL_ID, YOUTUBE_LISTS_WORKERS

FILES
  md-templates/   the note templates (editable)
  README.md       the full documentation
MANUAL
    if [[ -x "$VENV_DIR/bin/python" ]]; then
        echo
        echo "ALL OPTIONS (the browser and paths are passed by run.sh)"
        "$VENV_DIR/bin/python" "$SCRIPT_DIR/youtube-lists.py" --help | sed -n '/^options:/,$p' | tail -n +2
    fi
    exit 0
fi

BROWSER="$(env_value YOUTUBE_COOKIES_BROWSER)"
if [[ $# -gt 0 && "$1" != -* ]]; then
    BROWSER="$1"
    shift
fi
COOKIES_FILE="$(env_value YOUTUBE_COOKIES_FILE)"
DB_FILE="$(env_value YOUTUBE_LISTS_DB)"
NOTES_DIR="$(env_value YOUTUBE_LISTS_NOTES_DIR)"
MY_CHANNEL_ID="$(env_value YOUTUBE_MY_CHANNEL_ID)"
WORKERS="$(env_value YOUTUBE_LISTS_WORKERS)"

missing=()
[[ -z "$BROWSER" && -z "$COOKIES_FILE" ]] && missing+=("YOUTUBE_COOKIES_BROWSER (or YOUTUBE_COOKIES_FILE)")
[[ -z "$DB_FILE" ]] && missing+=("YOUTUBE_LISTS_DB")
[[ -z "$NOTES_DIR" ]] && missing+=("YOUTUBE_LISTS_NOTES_DIR")
if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Error: missing settings in $ENV_FILE:" >&2
    printf '  %s\n' "${missing[@]}" >&2
    echo "See .env.example in the project root." >&2
    exit 1
fi
DB_FILE="$(absolute "$DB_FILE")"
NOTES_DIR="$(absolute "$NOTES_DIR")"

AUTH_ARGS=()
if [[ -n "$COOKIES_FILE" ]]; then
    AUTH_ARGS=(--cookies "$(absolute "$COOKIES_FILE")")
    AUTH_LABEL="cookies file $COOKIES_FILE"
else
    # On desktops yt-dlp doesn't recognise (e.g. Hyprland) it can't find the key that
    # decrypts Chromium-family cookies, so point it at gnome-keyring unless the caller
    # already chose a keyring (e.g. "chrome+basictext").
    case "$BROWSER" in
        chrome|chromium|brave|edge|opera|vivaldi) BROWSER="$BROWSER+gnomekeyring" ;;
    esac
    AUTH_ARGS=(--browser "$BROWSER")
    AUTH_LABEL="$BROWSER cookies"
fi
EXTRA_ARGS=()
[[ -n "$MY_CHANNEL_ID" ]] && EXTRA_ARGS+=(--my-channel-id "$MY_CHANNEL_ID")
[[ -n "$WORKERS" ]] && EXTRA_ARGS+=(--workers "$WORKERS")

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
    echo "==> Creating virtualenv at $VENV_DIR"
    python3 -m venv "$VENV_DIR"
fi

echo "==> Installing dependencies"
"$VENV_DIR/bin/python" -m pip install --quiet --upgrade pip
"$VENV_DIR/bin/python" -m pip install --quiet --upgrade -r "$SCRIPT_DIR/requirements.txt"

mkdir -p "$(dirname "$DB_FILE")" "$NOTES_DIR"

echo "==> Applying database migrations"
"$VENV_DIR/bin/python" "$SCRIPT_DIR/migrate.py" --db "$DB_FILE" --notes-dir "$NOTES_DIR"

echo "==> Syncing playlists using $AUTH_LABEL"
# Clear the variables the Python CLI reads as defaults, so only the arguments above decide.
env -u YOUTUBE_COOKIES_BROWSER -u YOUTUBE_COOKIES_FILE -u YOUTUBE_MY_CHANNEL_ID \
    PATH="$VENV_DIR/bin:$PATH" "$VENV_DIR/bin/python" "$SCRIPT_DIR/youtube-lists.py" \
    "${AUTH_ARGS[@]}" --db "$DB_FILE" --output-dir "$NOTES_DIR" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} "$@"

echo "==> Database: $DB_FILE"
echo "==> Notes:    $NOTES_DIR"
