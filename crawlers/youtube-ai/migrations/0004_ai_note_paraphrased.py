"""ai_note.paraphrased: the note was generated with prompts/no-verbatim.md, after Gemini blocked an answer
that copied existing text word for word (finish reason RECITATION)."""

import sqlite3


def migrate(conn: sqlite3.Connection) -> None:
    columns = {row[1] for row in conn.execute("PRAGMA table_info(ai_note)")}
    if "paraphrased" not in columns:
        conn.execute("ALTER TABLE ai_note ADD COLUMN paraphrased INTEGER NOT NULL DEFAULT 0")
