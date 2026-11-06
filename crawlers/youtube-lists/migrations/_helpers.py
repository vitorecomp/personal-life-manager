"""Small helpers shared by migration files (kept here so migrations don't depend on the app code)."""

import sqlite3
from typing import Dict


def add_missing_columns(conn: sqlite3.Connection, table: str, columns: Dict[str, str]) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    for column, ctype in columns.items():
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ctype}")


# ----------------------------------------------------------------------------- notes folder helpers

import os  # noqa: E402
import re  # noqa: E402
import shutil  # noqa: E402
import unicodedata  # noqa: E402
from urllib.parse import quote, unquote  # noqa: E402

LINK_RE = re.compile(r"(\]\()([^)\s]+\.md)(\))")


def kebab(text: str, max_length: int = 60) -> str:
    """Frozen copy of utils.text.kebab as of migration 0006."""
    text = "".join(ch for ch in unicodedata.normalize("NFKD", text) if not unicodedata.combining(ch)).lower()
    slug = re.sub(r"[\W_]+", "-", text).strip("-")
    if len(slug) > max_length:
        slug = slug[:max_length].rsplit("-", 1)[0] or slug[:max_length]
    return slug


def video_slug(title: str, video_id: str) -> str:
    return f"{kebab(title) or 'video'}-{video_id}"


def unique(path: str) -> str:
    stem, ext = os.path.splitext(path)
    counter = 2
    while os.path.exists(path):
        path = f"{stem} ({counter}){ext}"
        counter += 1
    return path


def move_file(src: str, dst: str, moves: Dict[str, str]) -> str:
    """Move one file (never overwriting) and remember old -> new absolute paths."""
    src, dst = os.path.normpath(src), unique(os.path.normpath(dst))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.move(src, dst)
    original = next((old for old, new in moves.items() if new == src), src)
    moves[original] = dst
    return dst


def move_tree(src: str, dst: str, moves: Dict[str, str], rename=lambda name: name) -> None:
    """Move every file of src into dst (merging, never overwriting), renaming files with `rename`,
    then remove the emptied folders of src."""
    for root, _dirs, files in os.walk(src):
        target_root = os.path.join(dst, os.path.relpath(root, src))
        for name in files:
            move_file(os.path.join(root, name), os.path.join(target_root, rename(name)), moves)
    for root, dirs, _files in os.walk(src, topdown=False):
        for name in dirs:
            try:
                os.rmdir(os.path.join(root, name))
            except OSError:
                pass
    try:
        os.rmdir(src)
    except OSError:
        pass


def rewrite_links(notes_dir: str, moves: Dict[str, str]) -> int:
    """Fix relative .md links in every note after files moved (both the linking file and its targets
    may have moved). Returns how many files changed."""
    if not moves:
        return 0
    old_of = {new: old for old, new in moves.items()}
    changed = 0
    for root, _dirs, files in os.walk(notes_dir):
        for name in files:
            if not name.endswith(".md"):
                continue
            path = os.path.normpath(os.path.join(root, name))
            old_dir = os.path.dirname(old_of.get(path, path))
            with open(path, encoding="utf-8") as fh:
                text = fh.read()

            def fix(match: "re.Match[str]") -> str:
                target = match.group(2)
                if "://" in target or target.startswith(("/", "#")):
                    return match.group(0)
                old_target = os.path.normpath(os.path.join(old_dir, unquote(target)))
                new_target = moves.get(old_target, old_target)
                if not os.path.isfile(new_target):
                    return match.group(0)
                return match.group(1) + quote(os.path.relpath(new_target, root).replace(os.sep, "/")) + match.group(3)

            updated = LINK_RE.sub(fix, text)
            if updated != text:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(updated)
                changed += 1
    return changed


def remap_db_paths(conn: sqlite3.Connection, notes_dir: str, moves: Dict[str, str]) -> None:
    """Update stored relative paths (video_detail.note_path and, if present, ai_note.output_file)."""
    def relative(path: str) -> str:
        return os.path.relpath(path, notes_dir).replace(os.sep, "/")

    by_rel = {relative(old): relative(new) for old, new in moves.items()}
    targets = [("video_detail", "note_path", "video_id")]
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_note'").fetchone():
        targets.append(("ai_note", "output_file", "rowid"))
    for table, column, key in targets:
        for row_key, value in conn.execute(f"SELECT {key}, {column} FROM {table} WHERE {column} IS NOT NULL").fetchall():
            if value in by_rel:
                conn.execute(f"UPDATE {table} SET {column} = ? WHERE {key} = ?", (by_rel[value], row_key))


# --------------------------------------------------------------------------- note hashing (frozen copy)

import hashlib  # noqa: E402

KEEP_BLOCK_RE = re.compile(
    r"<!--\s*keep(?::\s*(?P<name>[\w.-]+))?\s*-->(?P<body>.*?)<!--\s*/keep(?::\s*(?P=name))?\s*-->",
    re.DOTALL,
)


def note_hash(text: str) -> str:
    """Same as notes.render.content_hash as of migration 0007 (keep blocks and whitespace ignored)."""
    return hashlib.sha256(" ".join(KEEP_BLOCK_RE.sub(" ", text).split()).encode("utf-8")).hexdigest()


def legacy_note_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
