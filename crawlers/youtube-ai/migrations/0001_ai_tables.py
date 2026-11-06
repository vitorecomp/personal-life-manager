"""The ai_batch and ai_note tables."""

import sqlite3


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS ai_batch (
            name          TEXT PRIMARY KEY,
            display_name  TEXT,
            model         TEXT NOT NULL,
            state         TEXT NOT NULL,
            request_count INTEGER NOT NULL,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL,
            finished_at   TEXT,
            error         TEXT
        );
        
        CREATE TABLE IF NOT EXISTS ai_note (
            video_id         TEXT NOT NULL,
            kind             TEXT NOT NULL,          -- knowledge | visual
            status           TEXT NOT NULL,          -- submitted | done | failed
            mode             TEXT NOT NULL,          -- batch | direct
            batch_name       TEXT,
            model            TEXT NOT NULL,
            media_resolution TEXT,
            prompt_hash      TEXT,
            output_text      TEXT,                   -- kept so a note can be (re)written without paying again
            output_file      TEXT,                   -- where the note was written, relative to the notes folder
            finish_reason    TEXT,
            prompt_tokens    INTEGER,
            cached_tokens    INTEGER,
            output_tokens    INTEGER,
            thinking_tokens  INTEGER,
            error            TEXT,
            attempts         INTEGER NOT NULL DEFAULT 0,
            requested_at     TEXT NOT NULL,
            completed_at     TEXT,
            PRIMARY KEY (video_id, kind)
        );
        """
    )
