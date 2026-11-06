"""ai_usage: the token usage of every Gemini call (for cost estimates). Earlier note calls are copied in
from ai_note; earlier classification calls didn't record usage."""

import sqlite3


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS ai_usage (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            at              TEXT NOT NULL,
            purpose         TEXT NOT NULL,       -- notes | classify
            mode            TEXT NOT NULL,       -- batch | direct
            model           TEXT NOT NULL,
            video_id        TEXT,
            kind            TEXT,
            prompt_tokens   INTEGER NOT NULL DEFAULT 0,
            cached_tokens   INTEGER NOT NULL DEFAULT 0,
            output_tokens   INTEGER NOT NULL DEFAULT 0,
            thinking_tokens INTEGER NOT NULL DEFAULT 0
        );
        """
    )
    if not conn.execute("SELECT 1 FROM ai_usage LIMIT 1").fetchone():
        conn.execute(
            """
            INSERT INTO ai_usage (at, purpose, mode, model, video_id, kind, prompt_tokens, cached_tokens,
                                  output_tokens, thinking_tokens)
            SELECT completed_at, 'notes', mode, model, video_id, kind, COALESCE(prompt_tokens, 0),
                   COALESCE(cached_tokens, 0), COALESCE(output_tokens, 0), COALESCE(thinking_tokens, 0)
            FROM ai_note WHERE status = 'done' AND completed_at IS NOT NULL
            """
        )
