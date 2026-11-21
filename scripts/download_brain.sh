#!/usr/bin/env bash
set -euo pipefail

# Script location and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"
TARGET_DIR="$ROOT_DIR/data/second-brain"

# Output colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}==> Checking environment configuration...${NC}"

if [[ ! -f "$ENV_FILE" ]]; then
    echo -e "${RED}Error: .env file not found at $ENV_FILE${NC}"
    echo "Please copy .env.example to .env and configure OBSIDIAN_BRAIN_REPO_URL:"
    echo "  cp .env.example .env"
    exit 1
fi

# Load OBSIDIAN_BRAIN_REPO_URL from .env without executing arbitrary code
REPO_URL="$(grep -E '^OBSIDIAN_BRAIN_REPO_URL=' "$ENV_FILE" | cut -d '=' -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["\x27]//' -e 's/["\x27]$//' || true)"

# Fallback check for alternate variable name
if [[ -z "$REPO_URL" ]]; then
    REPO_URL="$(grep -E '^OBSIDIAN_REPO_URL=' "$ENV_FILE" | cut -d '=' -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["\x27]//' -e 's/["\x27]$//' || true)"
fi

if [[ -z "$REPO_URL" ]]; then
    echo -e "${RED}Error: OBSIDIAN_BRAIN_REPO_URL is not set or empty in $ENV_FILE${NC}"
    echo "Please specify your GitHub repository URL in .env:"
    echo "  OBSIDIAN_BRAIN_REPO_URL=git@github.com:your-user/your-obsidian-repo.git"
    exit 1
fi

echo -e "${GREEN}==> Repository URL detected:${NC} $REPO_URL"
echo -e "${GREEN}==> Target second brain directory:${NC} $TARGET_DIR"

if [[ -d "$TARGET_DIR/.git" ]]; then
    echo -e "${YELLOW}==> Existing git repository found in $TARGET_DIR. Pulling latest updates...${NC}"
    git -C "$TARGET_DIR" pull --ff-only
    echo -e "${GREEN}==> Second brain successfully updated!${NC}"
elif [[ -d "$TARGET_DIR" ]]; then
    # The folder already exists (e.g. it holds a .gitkeep or notes created before the clone), so git clone
    # can't target it: clone the history aside, move it in and check the files out in place.
    echo -e "${YELLOW}==> Directory $TARGET_DIR already exists but is not a git repository.${NC}"
    echo -e "${YELLOW}==> Initializing and pulling into second-brain...${NC}"
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    git clone --no-checkout "$REPO_URL" "$TMP_DIR/repo"
    mv "$TMP_DIR/repo/.git" "$TARGET_DIR/.git"
    git -C "$TARGET_DIR" checkout -- .
    echo ".gitkeep" >> "$TARGET_DIR/.git/info/exclude"
    echo -e "${GREEN}==> Second brain successfully cloned!${NC}"
else
    echo -e "${YELLOW}==> Cloning Obsidian Second Brain repository...${NC}"
    git clone "$REPO_URL" "$TARGET_DIR"
    echo -e "${GREEN}==> Second brain successfully cloned to $TARGET_DIR!${NC}"
fi
