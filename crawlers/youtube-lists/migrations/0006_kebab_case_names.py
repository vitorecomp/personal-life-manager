"""Kebab-case folder and file names.

    Build/Build.md                              -> build/build.md
    Build/videos/How To ... [zS5oZPJVh_o]/...   -> build/videos/how-to-...-zS5oZPJVh_o/...

Files inside a video folder keep their suffix (-ref, -ai-knowledge, ...). The YouTube id is kept as is
(ids are case-sensitive). Stored paths and every relative link in the notes are updated.
"""

import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _helpers import kebab, move_file, move_tree, remap_db_paths, rewrite_links, video_slug  # noqa: E402

REMOVED = "removed"


def migrate(conn: sqlite3.Connection, notes_dir: str) -> None:
    moves = {}
    have_notes = bool(notes_dir) and os.path.isdir(notes_dir)

    # playlists: folder names (stored once, never derived again from the title)
    rows = conn.execute("SELECT id, folder FROM playlist WHERE folder IS NOT NULL").fetchall()
    taken = {folder.lower() for _id, folder in rows}
    for playlist_id, old in rows:
        new = kebab(old) or f"playlist-{playlist_id.lower()}"
        if new == REMOVED:
            new = f"{new}-{playlist_id[-6:].lower()}"
        if new == old:
            continue
        taken.discard(old.lower())
        if new.lower() in taken:
            new = f"{new}-{playlist_id[-6:].lower()}"
        taken.add(new.lower())
        if have_notes:
            for base in (notes_dir, os.path.join(notes_dir, REMOVED)):
                if os.path.isdir(os.path.join(base, old)):
                    move_tree(os.path.join(base, old), os.path.join(base, new), moves)
                    note = os.path.join(base, new, f"{old}.md")
                    if os.path.isfile(note):
                        move_file(note, os.path.join(base, new, f"{new}.md"), moves)
        conn.execute("UPDATE playlist SET folder = ? WHERE id = ?", (new, playlist_id))

    # videos: folder and file names (everything in a video folder starting with the old name)
    videos_dirs = []
    if have_notes:
        for base in (notes_dir, os.path.join(notes_dir, REMOVED)):
            if os.path.isdir(base):
                for entry in sorted(os.listdir(base)):
                    if os.path.isdir(os.path.join(base, entry, "videos")):
                        videos_dirs.append(os.path.join(base, entry, "videos"))
    for video_id, title, note_file in conn.execute("SELECT video_id, title, note_file FROM video_detail").fetchall():
        old_stem, new_stem = note_file[: -len(".md")], video_slug(title, video_id)
        if old_stem == new_stem:
            continue
        for videos_dir in videos_dirs:
            if os.path.isdir(os.path.join(videos_dir, old_stem)):
                move_tree(os.path.join(videos_dir, old_stem), os.path.join(videos_dir, new_stem), moves,
                          rename=lambda name, o=old_stem, n=new_stem: n + name[len(o):] if name.startswith(o) else name)
        conn.execute("UPDATE video_detail SET note_file = ? WHERE video_id = ?", (f"{new_stem}.md", video_id))

    if have_notes:
        remap_db_paths(conn, notes_dir, moves)
        rewrite_links(notes_dir, moves)
