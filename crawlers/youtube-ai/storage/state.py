"""AI bookkeeping, stored in ai_* tables of the youtube-lists database (whose tables are only read)."""

import os
import sqlite3
from typing import Dict, List, Optional

from config import MAX_ATTEMPTS
from migrations.runner import pending



def open_state(db_path: str) -> sqlite3.Connection:
    """Open the shared database; the ai_* tables come from migrations/ (run.sh applies them first)."""
    if not os.path.exists(db_path):
        raise RuntimeError(f"{db_path} does not exist; run the youtube-lists crawler first")
    conn = sqlite3.connect(db_path, timeout=60)
    conn.row_factory = sqlite3.Row
    for table in ("video_detail", "video", "playlist"):
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            raise RuntimeError(f"{db_path} has no {table} table; run the youtube-lists crawler first")
    todo = pending(conn)
    if todo:
        conn.close()
        names = ", ".join(f"{version}_{name}" for version, name, _path in todo)
        raise RuntimeError(f"{db_path} needs youtube-ai migrations ({names}); run: python migrate.py --db ...")
    return conn


def note_states(conn: sqlite3.Connection) -> Dict[tuple, sqlite3.Row]:
    return {(r["video_id"], r["kind"]): r for r in conn.execute("SELECT * FROM ai_note")}


def mark_submitted(conn: sqlite3.Connection, video_id: str, kind: str, mode: str, batch_name: Optional[str],
                   model: str, resolution: str, prompt_hash: str, now: str, paraphrased: bool = False) -> None:
    conn.execute(
        """
        INSERT INTO ai_note (video_id, kind, status, mode, batch_name, model, media_resolution, prompt_hash,
                             attempts, requested_at, paraphrased)
        VALUES (?, ?, 'submitted', ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(video_id, kind) DO UPDATE SET
            status = 'submitted', mode = excluded.mode, batch_name = excluded.batch_name,
            model = excluded.model, media_resolution = excluded.media_resolution,
            prompt_hash = excluded.prompt_hash, error = NULL, attempts = ai_note.attempts + 1,
            requested_at = excluded.requested_at, completed_at = NULL, paraphrased = excluded.paraphrased
        """,
        (video_id, kind, mode, batch_name, model, resolution, prompt_hash, now, int(paraphrased)),
    )


def record_result(conn: sqlite3.Connection, video_id: str, kind: str, result: Dict[str, object], now: str) -> None:
    with conn:
        conn.execute(
            """
            UPDATE ai_note SET status = 'done', output_text = :text, output_file = NULL,
                finish_reason = :finish_reason, prompt_tokens = :prompt_tokens, cached_tokens = :cached_tokens,
                output_tokens = :output_tokens, thinking_tokens = :thinking_tokens, error = NULL,
                completed_at = :now, paraphrased = COALESCE(:paraphrased, paraphrased)
            WHERE video_id = :video_id AND kind = :kind
            """,
            {"paraphrased": None, **result, "video_id": video_id, "kind": kind, "now": now},
        )


def record_failure(conn: sqlite3.Connection, video_id: str, kind: str, error: str, now: str) -> None:
    with conn:
        conn.execute(
            "UPDATE ai_note SET status = 'failed', error = ?, completed_at = ? WHERE video_id = ? AND kind = ?",
            (error[:2000], now, video_id, kind),
        )


def set_output_file(conn: sqlite3.Connection, video_id: str, kind: str, rel_path: str) -> None:
    with conn:
        conn.execute("UPDATE ai_note SET output_file = ? WHERE video_id = ? AND kind = ?", (rel_path, video_id, kind))


def unwritten_notes(conn: sqlite3.Connection) -> List[sqlite3.Row]:
    return conn.execute("SELECT * FROM ai_note WHERE status = 'done' AND output_file IS NULL").fetchall()


def save_batch(conn: sqlite3.Connection, name: str, display_name: str, model: str, state: str, count: int,
               now: str, purpose: str = "notes") -> None:
    conn.execute(
        "INSERT INTO ai_batch (name, display_name, model, state, request_count, created_at, updated_at, purpose) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (name, display_name, model, state, count, now, now, purpose),
    )


def update_batch(conn: sqlite3.Connection, name: str, state: str, now: str, error: Optional[str] = None,
                 finished: bool = False) -> None:
    with conn:
        conn.execute(
            "UPDATE ai_batch SET state = ?, updated_at = ?, error = COALESCE(?, error), "
            "finished_at = CASE WHEN ? THEN ? ELSE finished_at END WHERE name = ?",
            (state, now, error, int(finished), now, name),
        )


def open_batches(conn: sqlite3.Connection, purpose: str = "notes") -> List[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM ai_batch WHERE finished_at IS NULL AND purpose = ? ORDER BY created_at", (purpose,)
    ).fetchall()


# ------------------------------------------------------------------------------------ classification


def classifications(conn: sqlite3.Connection) -> Dict[str, sqlite3.Row]:
    return {r["video_id"]: r for r in conn.execute("SELECT * FROM ai_classification")}


def mark_classify_submitted(conn: sqlite3.Connection, video_ids: List[str], batch_name: Optional[str],
                            chunk_key: str, model: str, prompt_hash: str, now: str) -> None:
    conn.executemany(
        """
        INSERT INTO ai_classification (video_id, status, model, prompt_hash, batch_name, chunk_key, attempts, requested_at)
        VALUES (?, 'submitted', ?, ?, ?, ?, 1, ?)
        ON CONFLICT(video_id) DO UPDATE SET
            status = 'submitted', model = excluded.model, prompt_hash = excluded.prompt_hash,
            batch_name = excluded.batch_name, chunk_key = excluded.chunk_key, error = NULL,
            attempts = ai_classification.attempts + 1, requested_at = excluded.requested_at
        """,
        [(video_id, model, prompt_hash, batch_name, chunk_key, now) for video_id in video_ids],
    )


def record_classification(conn: sqlite3.Connection, video_id: str, category: str, confidence: float,
                          source: str, model: Optional[str], prompt_hash: Optional[str], now: str) -> None:
    with conn:
        conn.execute(
            """
            INSERT INTO ai_classification (video_id, status, category, confidence, source, model, prompt_hash,
                                           attempts, requested_at, classified_at)
            VALUES (?, 'done', ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(video_id) DO UPDATE SET
                status = 'done', category = excluded.category, confidence = excluded.confidence,
                source = excluded.source, model = COALESCE(excluded.model, ai_classification.model),
                prompt_hash = COALESCE(excluded.prompt_hash, ai_classification.prompt_hash),
                error = NULL, classified_at = excluded.classified_at
            """,
            (video_id, category, confidence, source, model, prompt_hash, now, now),
        )


def record_classify_failure(conn: sqlite3.Connection, video_ids: List[str], error: str, now: str) -> None:
    with conn:
        conn.executemany(
            "UPDATE ai_classification SET status = 'failed', error = ?, classified_at = ? WHERE video_id = ?",
            [(error[:2000], now, video_id) for video_id in video_ids],
        )


def submitted_in_chunk(conn: sqlite3.Connection, batch_name: str, chunk_key: str) -> List[str]:
    return [r[0] for r in conn.execute(
        "SELECT video_id FROM ai_classification WHERE batch_name = ? AND chunk_key = ? AND status = 'submitted'",
        (batch_name, chunk_key),
    )]


def fail_classify_leftovers(conn: sqlite3.Connection, batch_name: str, error: str, now: str) -> int:
    with conn:
        return conn.execute(
            "UPDATE ai_classification SET status = 'failed', error = ?, classified_at = ? "
            "WHERE batch_name = ? AND status = 'submitted'",
            (error, now, batch_name),
        ).rowcount


def fail_leftovers(conn: sqlite3.Connection, batch_name: str, error: str, now: str) -> int:
    """Requests of a finished batch that got no result are marked failed (retried on a later run)."""
    with conn:
        return conn.execute(
            "UPDATE ai_note SET status = 'failed', error = ?, completed_at = ? "
            "WHERE batch_name = ? AND status = 'submitted'",
            (error, now, batch_name),
        ).rowcount


def snapshot(conn: sqlite3.Connection, video_id: str, kind: str) -> Optional[Dict[str, object]]:
    row = conn.execute("SELECT * FROM ai_note WHERE video_id = ? AND kind = ?", (video_id, kind)).fetchone()
    return dict(row) if row else None


def restore(conn: sqlite3.Connection, video_id: str, kind: str, previous: Optional[Dict[str, object]]) -> None:
    """Undo mark_submitted for a call that never started (run stopped): back to exactly how it was."""
    with conn:
        conn.execute("DELETE FROM ai_note WHERE video_id = ? AND kind = ?", (video_id, kind))
        if previous:
            columns = ", ".join(previous)
            conn.execute(f"INSERT INTO ai_note ({columns}) VALUES ({', '.join('?' * len(previous))})",
                         list(previous.values()))


def can_retry(row: Optional[sqlite3.Row], force: bool) -> bool:
    """Whether a (video, kind) should be requested now."""
    if row is None:
        return True
    if row["status"] == "submitted":
        return False
    if force:
        return True
    return row["status"] == "failed" and row["attempts"] < MAX_ATTEMPTS
