#!/usr/bin/env bash
set -euo pipefail

# Syncs with Dropbox what git does not keep: everything in data/ except the second brain's Markdown
# notes. That is data/database/ (SQLite databases, logs, the Hermes Agent state in hermes-mds/), all
# of data/knowledge-data/ (crawler output, notes included) and any non-Markdown file of
# data/second-brain/. The second brain's notes are versioned in git and pushed to GitHub (see its
# .gitignore), so the two never overlap.
#
# Usage:
#   ./scripts/sync_dropbox.sh                 push: make Dropbox match data/ (default)
#   ./scripts/sync_dropbox.sh pull            bring files that are newer on Dropbox into data/
#   ./scripts/sync_dropbox.sh check           compare both sides without changing anything
#   add --dry-run to see what would happen, --force to sync even while a crawler or Hermes is running
#
# Settings (project root .env): DROPBOX_REMOTE (rclone remote name, default "dropbox"),
#                               DROPBOX_PATH (folder inside Dropbox, default "second-brain")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"
LOCAL_DIR="$ROOT_DIR/data"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

env_value() {
    local key="$1" default="$2" value=""
    if [[ -n "${!key:-}" ]]; then printf '%s' "${!key}"; return; fi
    if [[ -f "$ENV_FILE" ]]; then
        value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d '=' -f2- \
            | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["\x27]//' -e 's/["\x27]$//' || true)"
    fi
    printf '%s' "${value:-$default}"
}

usage() { sed -n '4,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

ACTION="push"
DRY_RUN=()
FORCE=0
for arg in "$@"; do
    case "$arg" in
        push|pull|check) ACTION="$arg" ;;
        --dry-run|-n) DRY_RUN=(--dry-run) ;;
        --force) FORCE=1 ;;
        -h|--help) usage; exit 0 ;;
        *) echo -e "${RED}Unknown argument: $arg${NC}" >&2; usage >&2; exit 1 ;;
    esac
done

REMOTE="$(env_value DROPBOX_REMOTE dropbox)"
REMOTE_PATH="$(env_value DROPBOX_PATH second-brain)"
DEST="$REMOTE:$REMOTE_PATH"

# ---------------------------------------------------------------- checks
if ! command -v rclone >/dev/null 2>&1; then
    echo -e "${RED}rclone is not installed.${NC}"
    echo "Install it, then connect your Dropbox once:"
    echo "  sudo pacman -S rclone"
    echo "  rclone config     # n (new remote) -> name: $REMOTE -> storage: dropbox -> defaults -> log in in the browser"
    exit 1
fi
if ! rclone listremotes 2>/dev/null | grep -qx "$REMOTE:"; then
    echo -e "${RED}rclone has no remote called \"$REMOTE\".${NC}"
    echo "Create it once (it opens Dropbox in the browser to log in):"
    echo "  rclone config     # n (new remote) -> name: $REMOTE -> storage: dropbox -> defaults"
    echo "Or set DROPBOX_REMOTE in $ENV_FILE to the name of an existing remote."
    exit 1
fi
if [[ ! -d "$LOCAL_DIR" ]]; then
    echo -e "${RED}$LOCAL_DIR does not exist.${NC} Run ./scripts/download_brain.sh first." >&2
    exit 1
fi
if [[ "$ACTION" == "push" ]] && [[ -z "$(find "$LOCAL_DIR" -type f -not -path "*/.git/*" \
        -not -path "$LOCAL_DIR/second-brain/*.md" -not -name ".gitignore" -not -name ".gitkeep" -print -quit)" ]]; then
    echo -e "${RED}$LOCAL_DIR has no files for Dropbox; refusing to push (it would empty the Dropbox copy).${NC}" >&2
    exit 1
fi

# A crawler writing the SQLite database right now would give Dropbox a half-written copy.
if [[ "$ACTION" != "check" && $FORCE -eq 0 ]]; then
    for lock in "$LOCAL_DIR"/database/*.lock; do
        [[ -e "$lock" ]] || continue
        if ! flock -n "$lock" true 2>/dev/null; then
            echo -e "${RED}A crawler is running (lock held: $(basename "$lock")).${NC}" >&2
            echo "Wait for it to finish, or pass --force to sync anyway." >&2
            exit 1
        fi
    done
    # Hermes keeps its SQLite session and memory stores open while it runs.
    if command -v podman >/dev/null 2>&1 && [[ -n "$(podman ps -q --filter name='^hermes$' 2>/dev/null)" ]]; then
        echo -e "${RED}Hermes is running.${NC}" >&2
        echo "Stop it first (podman-compose stop hermes), or pass --force to sync anyway." >&2
        exit 1
    fi
fi

FILTERS=(
    # What git keeps (the second brain's .gitignore lets only Markdown in) stays out of Dropbox:
    --exclude "/second-brain/**.md" --exclude ".gitignore"
    --exclude ".git/**"           # GitHub keeps the history of the notes
    --exclude ".gitkeep"          # keeps the data/ folders in this repository
    --exclude "*.lock"            # crawler run locks
    --exclude "*-journal" --exclude "*-wal" --exclude "*-shm"   # SQLite temporary files
    --exclude "/database/hermes-mds/.env"   # secrets stay out, even if Hermes ever writes one
)
COMMON=(--transfers 8 --checkers 16 --stats-one-line --stats 10s -v)
[[ -t 1 ]] && COMMON+=(--progress)
STAMP="$(date +%Y%m%d-%H%M%S)"

case "$ACTION" in
    push)
        echo -e "${YELLOW}==> Pushing $LOCAL_DIR to $DEST (everything except the second brain notes, which go to GitHub)${NC}"
        echo "    files changed or deleted on Dropbox are kept in $REMOTE:$REMOTE_PATH-versions/$STAMP"
        rclone sync "$LOCAL_DIR" "$DEST" "${FILTERS[@]}" "${COMMON[@]}" "${DRY_RUN[@]}" \
            --backup-dir "$REMOTE:$REMOTE_PATH-versions/$STAMP"
        ;;
    pull)
        echo -e "${YELLOW}==> Pulling newer files from $DEST into $LOCAL_DIR (nothing is deleted locally)${NC}"
        rclone copy "$DEST" "$LOCAL_DIR" --update "${FILTERS[@]}" "${COMMON[@]}" "${DRY_RUN[@]}"
        ;;
    check)
        echo -e "${YELLOW}==> Comparing $LOCAL_DIR with $DEST (no changes)${NC}"
        rclone check "$LOCAL_DIR" "$DEST" "${FILTERS[@]}" --one-way=false 2>&1 | tail -n 20 || true
        exit 0
        ;;
esac
echo -e "${GREEN}==> Done${NC}"
