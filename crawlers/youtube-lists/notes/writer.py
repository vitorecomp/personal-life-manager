"""Write notes to disk: playlist notes, full video notes, '-ref' notes, refreshed notes.

Every rewrite of an existing note goes through keep.merge(), so text inside keep blocks is never lost.
"""

import os
import sqlite3
import unicodedata
from typing import Dict, Optional

from notes.keep import merge
from notes.paths import move_note, move_video, note_rel_path, ref_file_name, removed_playlist_note_rel, removed_rel_path
from notes.render import content_hash, legacy_content_hash, previous_content_hash, read_ai_flags, render_playlist_note, render_ref_note, render_video_note


def write_video_notes(
    conn: sqlite3.Connection, output_dir: str, playlist_id: str, only_video_id: Optional[str] = None
) -> int:
    """Write this playlist's `videos/` notes and record where each full note is in the database.

    The playlist that owns a video's note gets the full note (written only if missing, so edits survive);
    every other playlist gets a `-ref` note, rewritten whenever its content changes. A `-ref` note that was
    parked under removed/ is moved back first. With `only_video_id`, only that video's note is handled.
    Returns how many files were written.
    """
    conn.row_factory = sqlite3.Row
    mine = conn.execute("SELECT folder FROM playlist WHERE id = ?", (playlist_id,)).fetchone()
    if not mine or not mine["folder"]:
        return 0
    rows = conn.execute(
        """
        SELECT d.*, op.folder AS owner_folder, op.title AS owner_title
        FROM video_detail d
        JOIN video v ON v.video_id = d.video_id
        LEFT JOIN playlist op ON op.id = d.note_playlist_id
        WHERE v.playlist_id = ? AND v.removed_at IS NULL AND (? IS NULL OR v.video_id = ?)
        """,
        (playlist_id, only_video_id, only_video_id),
    ).fetchall()
    written = 0
    for row in rows:
        is_owner = row["note_playlist_id"] in (None, playlist_id) or not row["owner_folder"]
        name = row["note_file"] if is_owner else ref_file_name(row["note_file"])
        hidden = row["unavailable_reason"] is not None
        rel = note_rel_path(mine["folder"], row["note_file"], name, hidden)
        path = os.path.join(output_dir, rel)

        if is_owner:
            existing = row["note_path"]
            if not os.path.exists(path) and existing and os.path.exists(os.path.join(output_dir, existing)):
                # the note exists elsewhere (e.g. the video just became unavailable and its folder is now
                # hidden): move it, with its whole folder, instead of writing a second copy
                rel = move_video(output_dir, existing, rel)
                path = os.path.join(output_dir, rel)
            if not os.path.exists(path):
                content = render_video_note(row)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(content)
                with conn:
                    conn.execute(
                        "UPDATE video_detail SET note_path = ?, note_hash = ? WHERE video_id = ?",
                        (rel, content_hash(content), row["video_id"]),
                    )
                written += 1
            elif row["note_path"] != rel:
                with conn:
                    conn.execute("UPDATE video_detail SET note_path = ? WHERE video_id = ?", (rel, row["video_id"]))
            continue

        content = render_ref_note(row)
        if not os.path.exists(path):
            other = note_rel_path(mine["folder"], row["note_file"], name, not hidden)  # visibility changed
            parked = removed_rel_path(mine["folder"], row["note_file"], name, hidden)
            for candidate in (other, parked):
                if os.path.exists(os.path.join(output_dir, candidate)):
                    move_video(output_dir, candidate, rel)
                    break
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                current = fh.read()
            content = merge(current, content)
            if current == content:
                continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
        written += 1
    return written


def refresh_video_note(conn: sqlite3.Connection, output_dir: str, video_id: str) -> str:
    """Rewrite a video's full note after its details were refreshed, unless you edited it by hand.

    Returns "updated", "unchanged", "edited" (left alone because it differs from what we last wrote) or
    "missing" (no file yet; write_video_notes will create it).
    """
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM video_detail WHERE video_id = ?", (video_id,)).fetchone()
    if not row or not row["note_path"]:
        return "missing"
    path = os.path.join(output_dir, row["note_path"])
    if not os.path.exists(path):
        return "missing"
    with open(path, encoding="utf-8") as fh:
        current = fh.read()
    new = merge(current, render_video_note(row))
    if current == new:
        return "unchanged"
    accepted = (content_hash(current), previous_content_hash(current), legacy_content_hash(current))
    if row["note_hash"] is not None and row["note_hash"] not in accepted:
        return "edited"
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(new)
    with conn:
        conn.execute("UPDATE video_detail SET note_hash = ? WHERE video_id = ?", (content_hash(new), video_id))
    return "updated"


def sort_key(title: str) -> str:
    """Alphabetical order that ignores case and accents ('Árvore' sorts with 'arvore')."""
    text = unicodedata.normalize("NFKD", title or "")
    return "".join(ch for ch in text if not unicodedata.combining(ch)).casefold().strip()


def write_playlist_notes(conn: sqlite3.Connection, output_dir: str, only_id: Optional[str] = None) -> Dict[str, int]:
    """Render the note of every active playlist (or just `only_id`); only touches changed files."""
    conn.row_factory = sqlite3.Row
    counts = {"written": 0, "unchanged": 0}
    query = "SELECT * FROM playlist WHERE removed_at IS NULL AND folder IS NOT NULL"
    params: tuple = ()
    if only_id:
        query, params = query + " AND id = ?", (only_id,)
    for playlist in conn.execute(query, params).fetchall():
        videos = conn.execute(
            """
            SELECT v.*, d.note_file, d.note_playlist_id, d.unavailable_reason FROM video v
            LEFT JOIN video_detail d ON d.video_id = v.video_id
            WHERE v.playlist_id = ? AND v.removed_at IS NULL ORDER BY v.position
            """,
            (playlist["id"],),
        ).fetchall()
        videos = sorted(videos, key=lambda v: (sort_key(v["title"]), v["position"]))  # alphabetical
        folder = os.path.join(output_dir, playlist["folder"])
        path = os.path.join(folder, f"{playlist['folder']}.md")
        if not os.path.exists(path):
            # A playlist that came back: take its parked note (with its ai-summary flags) instead of starting over.
            parked = removed_playlist_note_rel(playlist["folder"])
            if os.path.exists(os.path.join(output_dir, parked)):
                move_note(output_dir, parked, f"{playlist['folder']}/{playlist['folder']}.md")
        content = render_playlist_note(playlist, videos, read_ai_flags(path))
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                current = fh.read()
            content = merge(current, content)
            if current == content:
                counts["unchanged"] += 1
                continue
        os.makedirs(folder, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
        counts["written"] += 1
    return counts
