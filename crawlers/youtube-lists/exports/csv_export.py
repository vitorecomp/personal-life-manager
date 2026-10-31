"""CSV export of the active playlists and videos."""

import csv
import sqlite3

from config import CSV_FIELDS


def write_csv(conn: sqlite3.Connection, path: str) -> None:
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT p.id AS playlist_id, p.title AS playlist_title, p.url AS playlist_url,
               v.position, v.video_id, v.title AS video_title, v.url AS video_url,
               v.channel, v.duration_seconds
        FROM playlist p
        JOIN video v ON v.playlist_id = p.id AND v.removed_at IS NULL
        WHERE p.removed_at IS NULL
        ORDER BY p.title COLLATE NOCASE, p.id, v.position
        """
    ).fetchall()
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: ("" if row[k] is None else row[k]) for k in CSV_FIELDS})
