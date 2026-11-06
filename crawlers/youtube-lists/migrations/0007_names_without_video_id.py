"""Video folder and file names without the video id; the id moves into the note's front matter.

    build/videos/how-to-rgb-8x8x8-led-cube-the-build-zS5oZPJVh_o/how-to-...-zS5oZPJVh_o.md
 -> build/videos/how-to-rgb-8x8x8-led-cube-the-build/how-to-rgb-8x8x8-led-cube-the-build.md
    (with front matter:  video_id: "zS5oZPJVh_o")

Names must stay unique, so videos sharing a title get -2, -3... in playlist order (the first keeps the
plain title). Files in a video folder keep their suffix (-ref, -ai-knowledge, ...). Stored paths and
every relative link in the notes are updated.
"""

import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _helpers import (  # noqa: E402
    kebab,
    legacy_note_hash,
    move_tree,
    note_hash,
    remap_db_paths,
    rewrite_links,
)


def migrate(conn: sqlite3.Connection, notes_dir: str) -> None:
    have_notes = bool(notes_dir) and os.path.isdir(notes_dir)
    rows = conn.execute(
        """
        SELECT d.video_id, d.title, d.note_file FROM video_detail d
        LEFT JOIN playlist op ON op.id = d.note_playlist_id
        LEFT JOIN video ov ON ov.playlist_id = d.note_playlist_id AND ov.video_id = d.video_id
        ORDER BY op.first_seen_at, ov.position, d.fetched_at, d.video_id
        """
    ).fetchall()

    taken, plan = set(), []
    for video_id, title, note_file in rows:
        base = kebab(title) or "video"
        name, counter = base, 2
        while name in taken:
            name, counter = f"{base}-{counter}", counter + 1
        taken.add(name)
        plan.append((video_id, note_file[: -len(".md")], name))

    videos_dirs = []
    if have_notes:
        for base in (notes_dir, os.path.join(notes_dir, "removed")):
            if os.path.isdir(base):
                for entry in sorted(os.listdir(base)):
                    if os.path.isdir(os.path.join(base, entry, "videos")):
                        videos_dirs.append(os.path.join(base, entry, "videos"))

    moves = {}
    for video_id, old_stem, new_stem in plan:
        if old_stem == new_stem:
            continue
        for videos_dir in videos_dirs:
            if os.path.isdir(os.path.join(videos_dir, old_stem)):
                move_tree(os.path.join(videos_dir, old_stem), os.path.join(videos_dir, new_stem), moves,
                          rename=lambda name, o=old_stem, n=new_stem: n + name[len(o):] if name.startswith(o) else name)
        conn.execute("UPDATE video_detail SET note_file = ? WHERE video_id = ?", (f"{new_stem}.md", video_id))

    if not have_notes:
        return
    remap_db_paths(conn, notes_dir, moves)
    rewrite_links(notes_dir, moves)

    # the id now lives in the full note's front matter
    for video_id, path, stored in conn.execute(
        "SELECT video_id, note_path, note_hash FROM video_detail WHERE note_path IS NOT NULL"
    ).fetchall():
        full = os.path.join(notes_dir, path)
        if not os.path.isfile(full):
            continue
        with open(full, encoding="utf-8") as fh:
            text = fh.read()
        if text.startswith("---\n"):
            continue
        updated = f'---\nvideo_id: "{video_id}"\n---\n\n{text}'
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(updated)
        if stored in (note_hash(text), legacy_note_hash(text)):  # unedited: keep it refreshable
            conn.execute("UPDATE video_detail SET note_hash = ? WHERE video_id = ?", (note_hash(updated), video_id))
