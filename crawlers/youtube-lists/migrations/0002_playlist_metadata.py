"""Playlist metadata, owner, notes folder and 'created by me'."""

import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _helpers import add_missing_columns  # noqa: E402


def migrate(conn: sqlite3.Connection, notes_dir: str) -> None:
    add_missing_columns(conn, "playlist", {
        "folder": "TEXT",
        "created_by_me": "INTEGER",
        "owner_name": "TEXT",
        "owner_channel_id": "TEXT",
        "owner_url": "TEXT",
        "description": "TEXT",
        "availability": "TEXT",
        "youtube_video_count": "INTEGER",
        "modified_date": "TEXT",
        "view_count": "INTEGER",
    })
