#!/usr/bin/env bash
set -euo pipefail

# Generates Gemini AI notes for videos synced by crawlers/youtube-lists, in its own virtualenv.
#
# Settings come from the project root .env (see .env.example):
#   GEMINI_API_KEY           required
#   YOUTUBE_LISTS_DB         the youtube-lists database (shared)
#   YOUTUBE_LISTS_NOTES_DIR  the youtube-lists notes folder (shared)
#   YOUTUBE_AI_MODEL         optional (default gemini-3.8-flash)
#   YOUTUBE_AI_MAX_VIDEOS    optional, videos analysed per run (default: no limit)
#   YOUTUBE_AI_MODE          optional, flex (default), standard, priority or batch
#   YOUTUBE_AI_WORKERS       optional, calls at the same time (default 4)
#   YOUTUBE_AI_BATCH_SIZE    optional, batch mode: videos per job (default 50)
#
# Usage: ./run.sh [youtube-ai.py args]   e.g. ./run.sh --max-videos 3 --dry-run

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
youtube-ai: Gemini notes for the videos synced by crawlers/youtube-lists

  For every video worth it, writes next to its note (in the video's folder):
    <title>-ai-knowledge.md            everything the video teaches
    <title>-ai-visual-description.md   everything the video shows

  Each run: classifies the videos it hasn't seen (cheap, text only; music, gaming... are skipped),
  then analyses the best-scoring ones (views, comments, age). Classified videos flow straight into
  analysis; nothing waits for the whole classification to finish.

USAGE
  ./crawlers/youtube-ai/run.sh [options]

  ./crawlers/youtube-ai/run.sh --dry-run                 what would happen + cost estimate, no calls
  ./crawlers/youtube-ai/run.sh                           classify and analyse everything eligible (Flex)
  ./crawlers/youtube-ai/run.sh --max-videos 50           analyse at most 50 videos this run
  ./crawlers/youtube-ai/run.sh --classify-only           only classify (review with --dry-run)
  ./crawlers/youtube-ai/run.sh --playlist Build          only videos in that playlist
  ./crawlers/youtube-ai/run.sh --mode standard           answers in seconds, full price
  ./crawlers/youtube-ai/run.sh --mode priority           fastest, 1.8x standard price

MODES
  flex      (default) half price; each call can take minutes; busy answers are retried
  standard  full price; answers in seconds (alias: direct)
  priority  1.8x standard; fastest, most reliable (falls back to standard, billed as standard)
  batch     half price; asynchronous jobs of --batch-size videos (up to 24h)

STOPPING
  Ctrl+C once: no new calls start, running ones finish and are saved. Twice: quit now.

SETTINGS (project root .env)
  GEMINI_API_KEY (required), YOUTUBE_LISTS_DB, YOUTUBE_LISTS_NOTES_DIR,
  YOUTUBE_AI_MODEL, YOUTUBE_AI_MODE, YOUTUBE_AI_MAX_VIDEOS, YOUTUBE_AI_WORKERS, YOUTUBE_AI_BATCH_SIZE

FILES
  prompts/              the prompts and the categories table (editable)
  README.md             the full documentation
MANUAL
    if [[ -x "$VENV_DIR/bin/python" ]]; then
        echo
        echo "ALL OPTIONS"
        "$VENV_DIR/bin/python" "$SCRIPT_DIR/youtube-ai.py" --help | sed -n '/^options:/,$p' | tail -n +2
    else
        echo
        echo "(run once without -h to install; then -h also lists every option)"
    fi
    exit 0
fi

DB_FILE="$(env_value YOUTUBE_LISTS_DB)"
NOTES_DIR="$(env_value YOUTUBE_LISTS_NOTES_DIR)"
if [[ -z "$DB_FILE" || -z "$NOTES_DIR" ]]; then
    echo "Error: YOUTUBE_LISTS_DB and YOUTUBE_LISTS_NOTES_DIR must be set in $ENV_FILE" >&2
    exit 1
fi

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
    echo "==> Creating virtualenv at $VENV_DIR"
    python3 -m venv "$VENV_DIR"
fi
echo "==> Installing dependencies"
"$VENV_DIR/bin/python" -m pip install --quiet --upgrade pip
"$VENV_DIR/bin/python" -m pip install --quiet --upgrade -r "$SCRIPT_DIR/requirements.txt"

echo "==> Applying database migrations"
"$VENV_DIR/bin/python" "$SCRIPT_DIR/migrate.py" --db "$(absolute "$DB_FILE")"

# The key goes to the Python process through its environment only (never on the command line).
GEMINI_API_KEY="$(env_value GEMINI_API_KEY)" \
YOUTUBE_AI_MODEL="$(env_value YOUTUBE_AI_MODEL)" \
YOUTUBE_AI_MAX_VIDEOS="$(env_value YOUTUBE_AI_MAX_VIDEOS)" \
YOUTUBE_AI_MODE="$(env_value YOUTUBE_AI_MODE)" \
YOUTUBE_AI_WORKERS="$(env_value YOUTUBE_AI_WORKERS)" \
YOUTUBE_AI_BATCH_SIZE="$(env_value YOUTUBE_AI_BATCH_SIZE)" \
    "$VENV_DIR/bin/python" "$SCRIPT_DIR/youtube-ai.py" \
    --db "$(absolute "$DB_FILE")" --notes-dir "$(absolute "$NOTES_DIR")" "$@"
