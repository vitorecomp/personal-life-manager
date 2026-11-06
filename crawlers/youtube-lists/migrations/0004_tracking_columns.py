"""Columns for note tracking, re-check scheduling and removal confirmation."""

import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _helpers import add_missing_columns  # noqa: E402


def migrate(conn: sqlite3.Connection, notes_dir: str) -> None:
    add_missing_columns(conn, "video_detail", {
        "note_path": "TEXT",                                 # where the full note is on disk now
        "note_hash": "TEXT",                                 # hash of the note as last written (hand-edit check)
        "last_checked_at": "TEXT",                           # last time YouTube answered for this video
        "transcript_attempts": "INTEGER NOT NULL DEFAULT 0", # checks so far that found no transcript
    })
    add_missing_columns(conn, "playlist", {"missing_runs": "INTEGER NOT NULL DEFAULT 0"})
    add_missing_columns(conn, "video", {"missing_runs": "INTEGER NOT NULL DEFAULT 0"})
    conn.execute("UPDATE video_detail SET last_checked_at = fetched_at WHERE last_checked_at IS NULL")
