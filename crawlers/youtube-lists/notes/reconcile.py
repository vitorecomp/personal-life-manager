"""Keep note files in line with the database after videos leave (or return to) playlists.

The database decides everything:
  * video.removed_at says whether a video is still in a playlist,
  * video_detail.note_playlist_id says which playlist owns the video's full note,
  * video_detail.note_path says where that full note currently is on disk.

Rules (nothing is ever deleted except a redundant "-ref" stub inside the playlist that owns the note):
  * A full note that was renamed or moved by hand is found again by the " [video id].md" ending of its
    file name and put back where the database says it belongs.
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

from config import VIDEOS_DIR
from notes.keep import append_blocks, extract_blocks
from notes.paths import is_removed_path, move_note, note_rel_path, ref_file_name, removed_rel_path


def find_notes_by_id(output_dir: str) -> Dict[str, List[str]]:
    """Index every full video note under output_dir by the video id in its file name."""
    index: Dict[str, List[str]] = {}
    for root, _dirs, files in os.walk(output_dir):
        for name in files:
            match = re.search(r"\[([^\]]+)\]\.md$", name)  # "-ref" notes end in "]-ref.md" and never match
            if match:
                rel = os.path.relpath(os.path.join(root, name), output_dir).replace(os.sep, "/")
                index.setdefault(match.group(1), []).append(rel)
    return index


def reconcile_notes(conn: sqlite3.Connection, output_dir: str) -> Dict[str, int]:
    conn.row_factory = sqlite3.Row
    stats = {"promoted": 0, "removed": 0, "restored": 0, "refs_removed": 0, "stubs_dropped": 0,
             "adopted": 0, "playlists_parked": 0}
    index: Optional[Dict[str, List[str]]] = None
    folders = {
        row["id"]: row["folder"] for row in conn.execute("SELECT id, folder FROM playlist WHERE folder IS NOT NULL")
    }

    def exists(rel_path: str) -> bool:
        return os.path.exists(os.path.join(output_dir, rel_path))

    for detail in conn.execute("SELECT video_id, note_file, note_playlist_id, note_path FROM video_detail").fetchall():
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
            target = note_rel_path(folders[new_owner], detail["note_file"])
        elif owner in folders:
            new_owner = owner
            target = removed_rel_path(folders[owner], detail["note_file"])
        else:
            continue

        current = detail["note_path"]
        adopted = False
        if current is None and owner in folders:
            guess = note_rel_path(folders[owner], detail["note_file"])
            current = guess if exists(guess) else None
        if current is not None and not exists(current):
            if index is None:
                index = find_notes_by_id(output_dir)
            found = sorted(index.get(detail["video_id"], []), key=is_removed_path)
            current = found[0] if found else None
            if current:
                stats["adopted"] += 1
                adopted = True

        if current is not None:
            parked = is_removed_path(current)
            if active and current != target:
                target = move_note(output_dir, current, target)
                if not adopted:
                    stats["restored" if parked else "promoted"] += 1
            elif not active and not parked:
                target = move_note(output_dir, current, target)
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
        SELECT v.playlist_id, v.removed_at, d.note_file, d.note_playlist_id
        FROM video v JOIN video_detail d ON d.video_id = v.video_id
        """
    ).fetchall()
    for row in memberships:
        folder = folders.get(row["playlist_id"])
        if not folder:
            continue
        stub = note_rel_path(folder, ref_file_name(row["note_file"]))
        if not exists(stub):
            continue
        if row["removed_at"] is not None:
            move_note(output_dir, stub, removed_rel_path(folder, ref_file_name(row["note_file"])))
            stats["refs_removed"] += 1
        elif row["playlist_id"] == row["note_playlist_id"]:
            # This playlist now holds the full note, so its "-ref" note is redundant. Keep blocks written
            # in it move into the full note first; if there is no full note to take them, park the stub.
            with open(os.path.join(output_dir, stub), encoding="utf-8") as fh:
                kept = extract_blocks(fh.read())
            full = note_rel_path(folder, row["note_file"])
            if kept and not exists(full):
                move_note(output_dir, stub, removed_rel_path(folder, ref_file_name(row["note_file"])))
                stats["refs_removed"] += 1
                continue
            if kept:
                full_path = os.path.join(output_dir, full)
                with open(full_path, encoding="utf-8") as fh:
                    text = fh.read()
                with open(full_path, "w", encoding="utf-8") as fh:
                    fh.write(append_blocks(text, kept))
            os.remove(os.path.join(output_dir, stub))
            stats["stubs_dropped"] += 1

    # Playlists that no longer exist: park their own note and tidy up the folders they leave empty.
    for playlist in conn.execute("SELECT folder FROM playlist WHERE removed_at IS NOT NULL AND folder IS NOT NULL"):
        folder = playlist["folder"]
        own_note = f"{folder}/{folder}.md"
        if exists(own_note):
            move_note(output_dir, own_note, removed_rel_path(folder, f"{folder}.md"))
            stats["playlists_parked"] += 1
        for empty in (os.path.join(output_dir, folder, VIDEOS_DIR), os.path.join(output_dir, folder)):
            try:
                os.rmdir(empty)
            except OSError:
                pass
    return stats
