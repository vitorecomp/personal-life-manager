"""SQLite schema, opening the database and upgrading databases made by older versions."""

import os
import sqlite3
from typing import Dict


SCHEMA = """
CREATE TABLE IF NOT EXISTS playlist (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    url           TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    removed_at    TEXT
);

CREATE TABLE IF NOT EXISTS video (
    playlist_id      TEXT NOT NULL REFERENCES playlist(id),
    video_id         TEXT NOT NULL,
    position         INTEGER NOT NULL,
    title            TEXT NOT NULL,
    url              TEXT NOT NULL,
    channel          TEXT NOT NULL,
    duration_seconds INTEGER,
    first_seen_at    TEXT NOT NULL,
    last_seen_at     TEXT NOT NULL,
    removed_at       TEXT,
    PRIMARY KEY (playlist_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_video_video_id ON video(video_id);

CREATE TABLE IF NOT EXISTS video_detail (
    video_id           TEXT PRIMARY KEY,
    title              TEXT NOT NULL,
    description        TEXT,
    channel            TEXT,
    channel_id         TEXT,
    channel_url        TEXT,
    upload_date        TEXT,
    duration_seconds   INTEGER,
    view_count         INTEGER,
    like_count         INTEGER,
    comment_count      INTEGER,
    age_limit          INTEGER,
    categories         TEXT,
    tags               TEXT,
    chapters           TEXT,
    language           TEXT,
    live_status        TEXT,
    availability       TEXT,
    thumbnail          TEXT,
    comments           TEXT,
    subtitle_lang      TEXT,
    subtitle_kind      TEXT,
    transcript         TEXT,
    raw_json           TEXT,
    unavailable_reason TEXT,
    note_file          TEXT NOT NULL,
    note_playlist_id   TEXT,
    note_path          TEXT,
    fetched_at         TEXT NOT NULL
);
"""


# Columns added after the first release; applied to existing databases by open_db().
PLAYLIST_EXTRA_COLUMNS = {
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
    "missing_runs": "INTEGER NOT NULL DEFAULT 0",  # consecutive account-feed fetches without this playlist
}


VIDEO_EXTRA_COLUMNS = {
    "missing_runs": "INTEGER NOT NULL DEFAULT 0",  # consecutive fetches of the playlist without this video
}


# Same for video_detail. note_playlist_id is the playlist whose folder holds the video's full note;
# every other playlist containing the video only gets a "-ref" note pointing to it.
VIDEO_DETAIL_EXTRA_COLUMNS = {
    "note_playlist_id": "TEXT",
    "note_path": "TEXT",  # where the full note is on disk now (inside a playlist folder, or under removed/)
    "note_hash": "TEXT",  # hash of the note as we last wrote it, to tell hand edits from stale content
    "last_checked_at": "TEXT",  # last time YouTube gave an answer (details or "unavailable")
    "transcript_attempts": "INTEGER NOT NULL DEFAULT 0",  # checks so far that found no transcript
}


def add_missing_columns(conn: sqlite3.Connection, table: str, columns: Dict[str, str]) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    for column, ctype in columns.items():
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ctype}")


def open_db(path: str) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    with conn:
        add_missing_columns(conn, "playlist", PLAYLIST_EXTRA_COLUMNS)
        add_missing_columns(conn, "video", VIDEO_EXTRA_COLUMNS)
        add_missing_columns(conn, "video_detail", VIDEO_DETAIL_EXTRA_COLUMNS)
        conn.execute("UPDATE video_detail SET last_checked_at = fetched_at WHERE last_checked_at IS NULL")
        conn.execute(
            """
            UPDATE video_detail SET note_playlist_id = (
                SELECT v.playlist_id FROM video v WHERE v.video_id = video_detail.video_id
                ORDER BY v.first_seen_at, v.playlist_id LIMIT 1)
            WHERE note_playlist_id IS NULL
            """
        )
    return conn
