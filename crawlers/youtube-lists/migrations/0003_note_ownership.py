"""video_detail.note_playlist_id: the playlist whose folder holds a video's full note
(every other playlist gets a '-ref' note). Existing videos go to the playlist that saw them first."""

import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _helpers import add_missing_columns  # noqa: E402


def migrate(conn: sqlite3.Connection, notes_dir: str) -> None:
    add_missing_columns(conn, "video_detail", {"note_playlist_id": "TEXT"})
    conn.execute(
        """
        UPDATE video_detail SET note_playlist_id = (
            SELECT v.playlist_id FROM video v WHERE v.video_id = video_detail.video_id
            ORDER BY v.first_seen_at, v.playlist_id LIMIT 1)
        WHERE note_playlist_id IS NULL
        """
    )
