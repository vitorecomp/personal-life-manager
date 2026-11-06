"""Notes folder: one folder per video.

    <playlist>/videos/<Title> [id].md  ->  <playlist>/videos/<Title> [id]/<Title> [id].md
    removed/<playlist>/<Title> [id].md ->  removed/<playlist>/videos/<Title> [id]/<Title> [id].md
"""

import os
import re
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _helpers import move_file, remap_db_paths, rewrite_links  # noqa: E402

FLAT_NOTE_RE = re.compile(r"^(?P<stem>.*\[[^\]]+\])(-ref)?\.md$")


def migrate(conn: sqlite3.Connection, notes_dir: str) -> None:
    if not notes_dir or not os.path.isdir(notes_dir):
        return
    places = []  # (folder holding flat notes, folder their video folders go to)
    for entry in sorted(os.listdir(notes_dir)):
        path = os.path.join(notes_dir, entry)
        if entry == "removed" and os.path.isdir(path):
            places += [(os.path.join(path, p), os.path.join(path, p, "videos"))
                       for p in sorted(os.listdir(path)) if os.path.isdir(os.path.join(path, p))]
        elif os.path.isdir(os.path.join(path, "videos")):
            places.append((os.path.join(path, "videos"), os.path.join(path, "videos")))
    moves = {}
    for place, target in places:
        for name in sorted(os.listdir(place)):
            match = FLAT_NOTE_RE.match(name)
            if match and os.path.isfile(os.path.join(place, name)):
                move_file(os.path.join(place, name), os.path.join(target, match.group("stem"), name), moves)
    remap_db_paths(conn, notes_dir, moves)
    rewrite_links(notes_dir, moves)
