#!/bin/sh
# Installs the SilverBullet libraries and plugs listed below into the space (the vault, mounted at
# $SPACE) when they are missing. Run by the silverbullet-libs service in podman-compose.yml before
# SilverBullet starts. Libraries already present are left alone, so updates done through
# SilverBullet's Library Manager are kept; delete a library's page to have it reinstalled.
#
# Every source is pinned to a release tag or commit: to update one, change its URL here.
set -eu

SPACE="${SPACE:-/data}"

# Library pages. The page is saved at the path in its `name:` frontmatter, and each file in its
# `files:` list is fetched from next to the page's URL into the folder next to the saved page,
# the same layout SilverBullet's Library Manager produces.
LIBRARIES="
https://raw.githubusercontent.com/silverbulletmd/silverbullet-diagram/a17284e6caeb5dc9453107b8aa7419e4df323e2e/Mermaid.md
https://raw.githubusercontent.com/MrMugame/silverbullet-math/93081967565150160587321187cccdbff92143bd/Math.md
https://github.com/MrMugame/silversearch/releases/download/1.2.6/PLUG.md
https://github.com/MrMugame/silverbullet-pdf/releases/download/1.1.6/PLUG.md
https://github.com/silverbulletmd/silverbullet-markdown-prettify/releases/download/0.1.3/Prettify.md
https://raw.githubusercontent.com/LogeshG5/silverbullet-excalidraw/2efa8c635ffb51709c52ed8913b0071f1c848a31/PLUG.md
https://raw.githubusercontent.com/silverbulletmd/basic-search/2692f2fcb0a64ab636f66ea4a2aa0dbd85a3ffd3/PLUG.md
"

# Plain plugs (a single .plug.js without a library page): "<url> <path in the space>" per line.
PLUGS="
https://raw.githubusercontent.com/joekrill/silverbullet-treeview/c67dec213e8c31086fb0dc391965ae36aaefffba/treeview.plug.js Library/joekrill/silverbullet-treeview/treeview.plug.js
"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }

frontmatter() { awk 'NR==1 && /^---/ {f=1; next} f && /^---/ {exit} f' "$1"; }

for url in $LIBRARIES; do
    fetch "$url" "$TMP/page.md"
    fm="$(frontmatter "$TMP/page.md")"
    name="$(printf '%s\n' "$fm" | sed -n 's/^name:[[:space:]]*//p' | head -n 1 | tr -d "\"'")"
    if [ -z "$name" ]; then
        echo "error: no name in the frontmatter of $url" >&2
        exit 1
    fi
    page="$SPACE/$name.md"
    if [ -e "$page" ]; then
        echo "present:   $name"
        continue
    fi
    dir="$(dirname "$page")"
    base="${url%/*}"
    mkdir -p "$dir"
    printf '%s\n' "$fm" | awk '/^files:/ {f=1; next} f && /^[[:space:]]*-/ {sub(/^[[:space:]]*-[[:space:]]*/, ""); print; next} f {exit}' |
        while read -r file; do
            mkdir -p "$dir/$(dirname "$file")"
            if ! fetch "$base/$file" "$dir/$file"; then
                # Some libraries list data files they create at runtime (e.g. Excalidraw's
                # libraries.json); only a missing plug is fatal.
                case "$file" in
                    *.plug.js) echo "error: $base/$file not found" >&2; exit 1 ;;
                    *) echo "warning: $name: $file not published, skipped" >&2 ;;
                esac
            fi
        done
    # The page goes in last, so an interrupted install is retried on the next start.
    mv "$TMP/page.md" "$page"
    echo "installed: $name"
done

printf '%s\n' "$PLUGS" | while read -r url path; do
    [ -n "$url" ] || continue
    if [ -e "$SPACE/$path" ]; then
        echo "present:   $path"
        continue
    fi
    mkdir -p "$(dirname "$SPACE/$path")"
    fetch "$url" "$TMP/plug.js"
    mv "$TMP/plug.js" "$SPACE/$path"
    echo "installed: $path"
done
