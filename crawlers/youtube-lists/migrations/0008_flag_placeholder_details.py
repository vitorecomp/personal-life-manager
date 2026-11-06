"""Repair video details saved from yt-dlp placeholders.

With --ignore-no-formats-error, yt-dlp printed a stub instead of failing for private or removed videos
(title "youtube video #<id>", no channel, no duration), and it was stored as if it were real data. Those
rows are flagged as unavailable and marked for an immediate re-check, so the next sync records the real
reason (the app now recognises placeholders as failures).
"""

import sqlite3


def migrate(conn: sqlite3.Connection, notes_dir: str) -> None:
    conn.execute(
        """
        UPDATE video_detail
        SET unavailable_reason = 'No data from YouTube (placeholder from a failed fetch); checking again',
            last_checked_at = '2000-01-01T00:00:00+00:00'
        WHERE title = 'youtube video #' || video_id
          AND channel IS NULL AND duration_seconds IS NULL AND unavailable_reason IS NULL
        """
    )
