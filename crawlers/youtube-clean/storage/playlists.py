"""Which playlists to clean, read from the youtube-lists database (read-only)."""

import os
import sqlite3
from typing import Dict, List, Sequence

from config import SPECIAL_PLAYLISTS


def target_playlists(db_path: str, names: Sequence[str], include_liked: bool) -> Dict[str, List[Dict]]:
    """{"clean": [...], "skipped": [{"title", "reason"}]} for the active playlists in the database."""
    if not os.path.isfile(db_path):
        raise RuntimeError(f"{db_path} not found; run the youtube-lists crawler first")
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, title, folder, created_by_me FROM playlist WHERE removed_at IS NULL ORDER BY title COLLATE NOCASE"
    ).fetchall()
    wanted = {n.lower() for n in names}
    clean, skipped = [], []
    for row in rows:
        if wanted and row["title"].lower() not in wanted and (row["folder"] or "").lower() not in wanted:
            continue
        title = SPECIAL_PLAYLISTS.get(row["id"], row["title"])
        if row["id"] == "LL" and not include_liked:
            skipped.append({"title": title, "reason": "Liked videos (use --include-liked to un-like them)"})
        elif row["id"] not in SPECIAL_PLAYLISTS and row["created_by_me"] == 0:
            skipped.append({"title": title, "reason": "not your playlist (YouTube doesn't allow editing it)"})
        else:
            clean.append({"id": row["id"], "title": title})
    return {"clean": clean, "skipped": skipped}
