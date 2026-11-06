"""Where notes live on disk, and moving them without ever overwriting or deleting content.

Every video has its own folder, named after its note file without ".md":

    <playlist>/videos/<title>/<title>.md                    full note (plus AI notes and your own files)
    <playlist>/videos/<title>/<title>-ref.md                pointer, in playlists that don't own the note
    removed/<playlist>/videos/<title>/...                   the same folder, parked after leaving a playlist
    removed/<playlist>/<playlist>.md                        a deleted playlist's note (its links still work)
    .../videos/.<title>/...                                 a video unavailable on YouTube (hidden folder)

Notes move together with their folder, so anything stored next to a note travels with it.
"""

import os
import re
import shutil
from urllib.parse import quote, unquote

from config import REF_SUFFIX, REMOVED_DIR, VIDEOS_DIR

LINK_RE = re.compile(r"(\]\()([^)\s]+\.md)(\))")


HIDDEN_PREFIX = "."  # folders of videos unavailable on YouTube start with this (hidden in Obsidian)


def video_dir_name(note_file: str, hidden: bool = False) -> str:
    """'title.md' -> 'title' (or '.title' for a video that is unavailable on YouTube)."""
    return (HIDDEN_PREFIX if hidden else "") + note_file[: -len(".md")]


def ref_file_name(note_file: str) -> str:
    """'title.md' -> 'title-ref.md'."""
    return f"{video_dir_name(note_file)}{REF_SUFFIX}.md"


def note_rel_path(playlist_folder: str, note_file: str, name: str = "", hidden: bool = False) -> str:
    """Path of a file in a video's folder inside a playlist (the full note unless `name` is given)."""
    return f"{playlist_folder}/{VIDEOS_DIR}/{video_dir_name(note_file, hidden)}/{name or note_file}"


def removed_rel_path(playlist_folder: str, note_file: str, name: str = "", hidden: bool = False) -> str:
    """Same as note_rel_path, for the parked copy of the folder under removed/<playlist>/."""
    return f"{REMOVED_DIR}/{playlist_folder}/{VIDEOS_DIR}/{video_dir_name(note_file, hidden)}/{name or note_file}"


def removed_playlist_note_rel(playlist_folder: str) -> str:
    return f"{REMOVED_DIR}/{playlist_folder}/{playlist_folder}.md"


def is_removed_path(rel_path: str) -> bool:
    return rel_path.startswith(f"{REMOVED_DIR}/")


def _rel(output_dir: str, path: str) -> str:
    return os.path.relpath(path, output_dir).replace(os.sep, "/")


def _unique(path: str) -> str:
    stem, ext = os.path.splitext(path)
    counter = 2
    while os.path.exists(path):
        path = f"{stem} ({counter}){ext}"
        counter += 1
    return path


def relink(path: str, old_dir: str) -> None:
    """After a note moved out of `old_dir`, fix its relative .md links that still point at existing files.

    Links whose old target no longer exists (it moved along with the note, or is gone) are left alone.
    """
    if not path.endswith(".md"):
        return
    new_dir = os.path.dirname(path)
    with open(path, encoding="utf-8") as fh:
        text = fh.read()

    def fix(match: "re.Match[str]") -> str:
        target = match.group(2)
        if "://" in target or target.startswith(("/", "#")):
            return match.group(0)
        old_target = os.path.normpath(os.path.join(old_dir, unquote(target)))
        if not os.path.isfile(old_target):
            return match.group(0)
        return match.group(1) + quote(os.path.relpath(old_target, new_dir).replace(os.sep, "/")) + match.group(3)

    updated = LINK_RE.sub(fix, text)
    if updated != text:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(updated)


def move_note(output_dir: str, src_rel: str, dst_rel: str) -> str:
    """Move a single file inside output_dir; never overwrites (adds ' (2)' etc.). Returns the final path."""
    src = os.path.join(output_dir, src_rel)
    dst = _unique(os.path.join(output_dir, dst_rel))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.move(src, dst)
    relink(dst, os.path.dirname(src))
    return _rel(output_dir, dst)


def move_dir(src: str, dst: str) -> None:
    """Move a folder; if dst exists, merge into it (renaming clashes, never overwriting)."""
    if os.path.exists(dst):
        _merge_dir(src, dst)
    else:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(src, dst)


def unique_path(path: str) -> str:
    return _unique(path)


def _merge_dir(src: str, dst: str) -> None:
    """Move everything in src into dst (which exists), renaming on clashes; then remove src."""
    for entry in os.listdir(src):
        source = os.path.join(src, entry)
        target = os.path.join(dst, entry)
        if os.path.isdir(source) and os.path.isdir(target):
            _merge_dir(source, target)
        else:
            shutil.move(source, _unique(target))
    os.rmdir(src)


def move_video(output_dir: str, src_rel: str, dst_rel: str) -> str:
    """Move a note together with its video folder; returns the note's final relative path.

    If the note is not inside a video folder (e.g. it was moved by hand), only the file moves. When the
    destination folder already exists the two are merged; no file is ever overwritten.
    """
    src = os.path.join(output_dir, src_rel)
    src_dir = os.path.dirname(src)
    if os.path.basename(os.path.dirname(src_dir)) != VIDEOS_DIR:  # not in a video folder (moved by hand)
        return move_note(output_dir, src_rel, dst_rel)
    dst_dir = os.path.dirname(os.path.join(output_dir, dst_rel))
    if os.path.abspath(src_dir) == os.path.abspath(dst_dir):
        return src_rel
    os.makedirs(os.path.dirname(dst_dir), exist_ok=True)
    if os.path.exists(dst_dir):
        before = set(os.listdir(dst_dir))
        _merge_dir(src_dir, dst_dir)
        name = os.path.basename(src)
        if name in before:  # renamed by _unique during the merge
            stem, ext = os.path.splitext(name)
            candidates = sorted(e for e in os.listdir(dst_dir) if e.startswith(f"{stem} (") and e.endswith(ext))
            name = candidates[-1] if candidates else name
        final = os.path.join(dst_dir, name)
    else:
        shutil.move(src_dir, dst_dir)
        final = os.path.join(dst_dir, os.path.basename(src))
    for root, _dirs, files in os.walk(dst_dir):
        for name in files:
            moved = os.path.join(root, name)
            relink(moved, os.path.join(src_dir, os.path.relpath(root, dst_dir)))
    prune_empty_dirs(output_dir, os.path.dirname(src_dir))
    return _rel(output_dir, final)


def prune_empty_dirs(output_dir: str, start: str) -> None:
    """Remove `start` and its parents while they are empty, never going above output_dir."""
    root = os.path.abspath(output_dir)
    current = os.path.abspath(start)
    while current.startswith(root + os.sep):
        try:
            os.rmdir(current)
        except OSError:
            return
        current = os.path.dirname(current)
