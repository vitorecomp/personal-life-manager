"""Keep note files in line with the database after videos leave (or return to) playlists.

The database decides everything:
  * video.removed_at says whether a video is still in a playlist,
  * video_detail.note_playlist_id says which playlist owns the video's full note,
  * video_detail.note_path says where that full note currently is on disk.

Each video's notes live in a folder of their own (see notes/paths.py); moving a note moves its whole
folder, so AI notes and your own files travel with it.

Rules (nothing is ever deleted except a redundant "-ref" stub inside the playlist that owns the note):
  * A full note that was renamed or moved by hand is found again (by its file name, or by the video_id
    in its front matter) and put back where the database says it belongs.
  * A playlist flagged as removed has its own note and "-ref" notes parked under removed/ as well.
  * Owner still has the video: nothing moves.
  * Owner dropped it but another playlist still has it: the full note moves to that playlist (the one
    that saw the video first) and becomes its owner; the other playlists' "-ref" notes are rewritten
    to point there by write_video_notes().
  * No playlist has it any more: the full note moves to removed/<playlist it left>/.
  * It comes back to a playlist: the note moves out of removed/ into that playlist.
  * A "-ref" note of a playlist that dropped the video moves to removed/<that playlist>/.
"""

import os
import re
import sqlite3
from typing import Dict, List, Optional

from notes.keep import append_blocks, extract_blocks
from notes.paths import (
    is_removed_path,
    move_note,
    move_video,
    note_rel_path,
    prune_empty_dirs,
    ref_file_name,
    removed_playlist_note_rel,
    removed_rel_path,
)


FRONT_MATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


def index_notes(output_dir: str) -> List[tuple]:
    """(file name, relative path) of every Markdown file under output_dir."""
    return [
        (name, os.path.relpath(os.path.join(root, name), output_dir).replace(os.sep, "/"))
        for root, _dirs, files in os.walk(output_dir) for name in files if name.endswith(".md")
    ]


def front_matter_video_id(path: str) -> Optional[str]:
    """The video_id in a full video note's front matter (None for AI notes, -ref notes and others)."""
    if path.endswith("-ref.md"):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            head = fh.read(2048)
    except OSError:
        return None
    match = FRONT_MATTER_RE.match(head)
    if not match or "\nai_kind:" in f"\n{match.group(1)}":
        return None
    found = re.search(r'^video_id:\s*"?([^"\n]+)"?\s*$', match.group(1), re.MULTILINE)
    return found.group(1).strip() if found else None


def find_note(index: List[tuple], output_dir: str, video_id: str, note_file: str) -> List[str]:
    """Full notes of a video that is no longer where the database says: same file name elsewhere, the
    older id-in-name patterns, or any note whose front matter carries the video's id."""
    by_name = [rel for name, rel in index
               if name == note_file or name.endswith(f"-{video_id}.md") or name.endswith(f"[{video_id}].md")]
    if by_name:
        return by_name
    return [rel for _name, rel in index if front_matter_video_id(os.path.join(output_dir, rel)) == video_id]


def reconcile_notes(conn: sqlite3.Connection, output_dir: str) -> Dict[str, int]:
    conn.row_factory = sqlite3.Row
    stats = {"promoted": 0, "removed": 0, "restored": 0, "refs_removed": 0, "stubs_dropped": 0,
             "adopted": 0, "playlists_parked": 0, "visibility": 0}
    index: Optional[List[tuple]] = None
    folders = {
        row["id"]: row["folder"] for row in conn.execute("SELECT id, folder FROM playlist WHERE folder IS NOT NULL")
    }

    def exists(rel_path: str) -> bool:
        return os.path.exists(os.path.join(output_dir, rel_path))

    rows = conn.execute(
        "SELECT video_id, note_file, note_playlist_id, note_path, unavailable_reason FROM video_detail"
    ).fetchall()
    for detail in rows:
        hidden = detail["unavailable_reason"] is not None  # unavailable on YouTube: hidden folder
        owner = detail["note_playlist_id"]
        active = [
            row[0]
            for row in conn.execute(
                "SELECT playlist_id FROM video WHERE video_id = ? AND removed_at IS NULL "
                "ORDER BY first_seen_at, playlist_id",
                (detail["video_id"],),
            )
            if row[0] in folders
        ]
        if active:
            new_owner = owner if owner in active else active[0]
            target = note_rel_path(folders[new_owner], detail["note_file"], hidden=hidden)
        elif owner in folders:
            new_owner = owner
            target = removed_rel_path(folders[owner], detail["note_file"], hidden=hidden)
        else:
            continue

        current = detail["note_path"]
        adopted = False
        if current is None and owner in folders:
            guesses = [note_rel_path(folders[owner], detail["note_file"], hidden=h) for h in (hidden, not hidden)]
            current = next((g for g in guesses if exists(g)), None)
        if current is not None and not exists(current):
            if index is None:
                index = index_notes(output_dir)
            found = sorted(find_note(index, output_dir, detail["video_id"], detail["note_file"]), key=is_removed_path)
            current = found[0] if found else None
            if current:
                stats["adopted"] += 1
                adopted = True

        if current is not None:
            parked = is_removed_path(current)
            if current != target and os.path.dirname(os.path.dirname(current)) == os.path.dirname(os.path.dirname(target)):
                target = move_video(output_dir, current, target)  # only visibility changed (hidden <-> shown)
                stats["visibility"] += 1
            elif active and current != target:
                target = move_video(output_dir, current, target)
                if not adopted:
                    stats["restored" if parked else "promoted"] += 1
            elif not active and not parked:
                target = move_video(output_dir, current, target)
                stats["removed"] += 1
            else:
                target = current

        final_path = target if exists(target) else None
        if new_owner != owner or final_path != detail["note_path"]:
            with conn:
                conn.execute(
                    "UPDATE video_detail SET note_playlist_id = ?, note_path = ? WHERE video_id = ?",
                    (new_owner, final_path, detail["video_id"]),
                )

    # "-ref" notes: park the ones whose playlist dropped the video; drop stubs made pointless by a promotion.
    memberships = conn.execute(
        """
        SELECT v.playlist_id, v.removed_at, d.note_file, d.note_playlist_id, d.unavailable_reason
        FROM video v JOIN video_detail d ON d.video_id = v.video_id
        """
    ).fetchall()
    for row in memberships:
        folder = folders.get(row["playlist_id"])
        if not folder:
            continue
        hidden = row["unavailable_reason"] is not None
        stub = note_rel_path(folder, row["note_file"], ref_file_name(row["note_file"]), hidden)
        other = note_rel_path(folder, row["note_file"], ref_file_name(row["note_file"]), not hidden)
        if not exists(stub) and exists(other):
            move_video(output_dir, other, stub)  # the video became (un)available: follow the visibility
            stats["visibility"] += 1
        if not exists(stub):
            continue
        if row["removed_at"] is not None:
            move_video(output_dir, stub, removed_rel_path(folder, row["note_file"], ref_file_name(row["note_file"]), hidden))
            stats["refs_removed"] += 1
        elif row["playlist_id"] == row["note_playlist_id"]:
            # This playlist now holds the full note, so its "-ref" note is redundant. Keep blocks written
            # in it move into the full note first; if there is no full note to take them, park the stub.
            with open(os.path.join(output_dir, stub), encoding="utf-8") as fh:
                kept = extract_blocks(fh.read())
            full = note_rel_path(folder, row["note_file"], hidden=hidden)
            if kept and not exists(full):
                move_video(output_dir, stub, removed_rel_path(folder, row["note_file"], ref_file_name(row["note_file"]), hidden))
                stats["refs_removed"] += 1
                continue
            if kept:
                full_path = os.path.join(output_dir, full)
                with open(full_path, encoding="utf-8") as fh:
                    text = fh.read()
                with open(full_path, "w", encoding="utf-8") as fh:
                    fh.write(append_blocks(text, kept))
            os.remove(os.path.join(output_dir, stub))
            prune_empty_dirs(output_dir, os.path.dirname(os.path.join(output_dir, stub)))
            stats["stubs_dropped"] += 1

    # Playlists that no longer exist: park their own note and tidy up the folders they leave empty.
    for playlist in conn.execute("SELECT folder FROM playlist WHERE removed_at IS NOT NULL AND folder IS NOT NULL"):
        folder = playlist["folder"]
        own_note = f"{folder}/{folder}.md"
        if exists(own_note):
            move_note(output_dir, own_note, removed_playlist_note_rel(folder))
            stats["playlists_parked"] += 1
        playlist_dir = os.path.join(output_dir, folder)
        for root, dirs, _files in os.walk(playlist_dir, topdown=False):
            for name in dirs:
                prune_empty_dirs(output_dir, os.path.join(root, name))
        prune_empty_dirs(output_dir, playlist_dir)
    return stats
