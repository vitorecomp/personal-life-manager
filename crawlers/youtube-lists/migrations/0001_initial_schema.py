"""The original playlist, video and video_detail tables."""

import sqlite3


def migrate(conn: sqlite3.Connection, notes_dir: str) -> None:
    conn.executescript(
        """
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
            fetched_at         TEXT NOT NULL
        );
        """
    )
