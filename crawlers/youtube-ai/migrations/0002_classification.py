"""Video classification before analysis (ai_classification), and the purpose of each batch job."""

import sqlite3


def migrate(conn: sqlite3.Connection) -> None:
    columns = {row[1] for row in conn.execute("PRAGMA table_info(ai_batch)")}
    if "purpose" not in columns:
        conn.execute("ALTER TABLE ai_batch ADD COLUMN purpose TEXT NOT NULL DEFAULT 'notes'")  # notes | classify
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS ai_classification (
            video_id      TEXT PRIMARY KEY,
            status        TEXT NOT NULL,          -- submitted | done | failed
            category      TEXT,
            confidence    REAL,
            source        TEXT,                   -- model | rule (no metadata to classify)
            model         TEXT,
            prompt_hash   TEXT,
            batch_name    TEXT,
            chunk_key     TEXT,
            error         TEXT,
            attempts      INTEGER NOT NULL DEFAULT 0,
            requested_at  TEXT,
            classified_at TEXT
        );
        """
    )
