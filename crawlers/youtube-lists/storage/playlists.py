"""Playlist and playlist-membership writes: upserts, removal flags and confirmation."""

import sqlite3
from typing import Dict, List, Optional

from utils.text import kebab
from youtube.client import playlist_url
from config import CONFIRM_RUNS, PLACEHOLDER_TITLES, REMOVED_DIR, SPECIAL_PLAYLISTS


PLACEHOLDERS_SQL = ", ".join("'" + t.replace("'", "''") + "'" for t in PLACEHOLDER_TITLES)


def allocate_folder(conn: sqlite3.Connection, playlist_id: str, title: str) -> str:
    """Pick a folder name once and keep it, so renaming a playlist never orphans its folder."""
    row = conn.execute("SELECT folder FROM playlist WHERE id = ?", (playlist_id,)).fetchone()
    if row and row[0]:
        return row[0]
    folder = kebab(title) or f"playlist-{playlist_id.lower()}"
    if folder == REMOVED_DIR:
        folder = f"{folder}-{playlist_id[-6:].lower()}"
    taken = conn.execute(
        "SELECT 1 FROM playlist WHERE folder = ? COLLATE NOCASE AND id <> ?", (folder, playlist_id)
    ).fetchone()
    if taken:
        folder = f"{folder}-{playlist_id[-6:].lower()}"
    return folder


def sync_playlist(
    conn: sqlite3.Connection,
    playlist_id: str,
    title: str,
    meta: Dict[str, object],
    created_by_me: Optional[bool],
    videos: List[Dict[str, object]],
    now: str,
    complete: bool = True,
) -> Dict[str, int]:
    """Upsert one playlist and its videos; flag videos that are no longer in it. Returns counts.

    `complete` says the fetch looks like the whole playlist. When it does not (YouTube reported more videos
    than came back, or nothing came back), missing videos are only flagged removed once they have been
    missing in CONFIRM_RUNS consecutive runs, so a flaky fetch cannot make a playlist's notes move around.
    """
    with conn:  # one transaction per playlist
        conn.execute(
            """
            INSERT INTO playlist (id, title, url, folder, created_by_me, owner_name, owner_channel_id,
                                  owner_url, description, availability, youtube_video_count,
                                  modified_date, view_count, first_seen_at, last_seen_at)
            VALUES (:id, :title, :url, :folder, :created_by_me, :owner_name, :owner_channel_id,
                    :owner_url, :description, :availability, :youtube_video_count,
                    :modified_date, :view_count, :now, :now)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                url = excluded.url,
                folder = excluded.folder,
                created_by_me = excluded.created_by_me,
                owner_name = excluded.owner_name,
                owner_channel_id = excluded.owner_channel_id,
                owner_url = excluded.owner_url,
                description = excluded.description,
                availability = excluded.availability,
                youtube_video_count = excluded.youtube_video_count,
                modified_date = excluded.modified_date,
                view_count = excluded.view_count,
                last_seen_at = excluded.last_seen_at,
                missing_runs = 0,
                removed_at = NULL
            """,
            {
                **meta,
                "id": playlist_id,
                "title": title,
                "url": playlist_url(playlist_id),
                "folder": allocate_folder(conn, playlist_id, title),
                "created_by_me": None if created_by_me is None else int(created_by_me),
                "now": now,
            },
        )

        known = {
            row[0]: row[1]
            for row in conn.execute("SELECT video_id, removed_at FROM video WHERE playlist_id = ?", (playlist_id,))
        }
        current_ids = {v["video_id"] for v in videos}
        added = sum(1 for vid in current_ids if vid not in known)
        restored = sum(1 for vid in current_ids if known.get(vid) is not None)

        conn.executemany(
            """
            INSERT INTO video (playlist_id, video_id, position, title, url, channel,
                               duration_seconds, first_seen_at, last_seen_at)
            VALUES (:playlist_id, :video_id, :position, :title, :url, :channel,
                    :duration_seconds, :now, :now)
            ON CONFLICT(playlist_id, video_id) DO UPDATE SET
                position = excluded.position,
                title = CASE WHEN excluded.title IN (%(ph)s) AND video.title NOT IN (%(ph)s)
                             THEN video.title ELSE excluded.title END,
                url = excluded.url,
                channel = CASE WHEN excluded.channel = '' THEN video.channel ELSE excluded.channel END,
                duration_seconds = COALESCE(excluded.duration_seconds, video.duration_seconds),
                last_seen_at = excluded.last_seen_at,
                missing_runs = 0,
                removed_at = NULL
            """ % {"ph": PLACEHOLDERS_SQL},
            [{**v, "playlist_id": playlist_id, "now": now} for v in videos],
        )

        conn.execute(
            "UPDATE video SET missing_runs = missing_runs + 1 "
            "WHERE playlist_id = ? AND last_seen_at <> ? AND removed_at IS NULL",
            (playlist_id, now),
        )
        removed = conn.execute(
            "UPDATE video SET removed_at = ? WHERE playlist_id = ? AND last_seen_at <> ? AND removed_at IS NULL "
            "AND (? OR missing_runs >= ?)",
            (now, playlist_id, now, int(complete), CONFIRM_RUNS),
        ).rowcount
        unconfirmed = conn.execute(
            "SELECT COUNT(*) FROM video WHERE playlist_id = ? AND last_seen_at <> ? AND removed_at IS NULL",
            (playlist_id, now),
        ).fetchone()[0]
    return {"added": added, "restored": restored, "removed": removed, "unconfirmed": unconfirmed}


def mark_missing_playlists(conn: sqlite3.Connection, seen_ids: List[str], now: str) -> Dict[str, int]:
    """Flag playlists that no longer appear on the account (Watch Later / Liked are never flagged).

    A playlist must be missing from CONFIRM_RUNS consecutive runs first, so one incomplete account feed
    cannot flag everything. Flagging a playlist also flags all its videos as removed from it, which lets
    the file reconciliation hand shared notes to other playlists and park the rest under removed/.
    """
    keep = list(seen_ids) + list(SPECIAL_PLAYLISTS)
    marks = ",".join("?" * len(keep))
    with conn:
        conn.execute(
            f"UPDATE playlist SET missing_runs = missing_runs + 1 WHERE removed_at IS NULL AND id NOT IN ({marks})",
            keep,
        )
        flagged = [
            row[0]
            for row in conn.execute(
                f"SELECT id FROM playlist WHERE removed_at IS NULL AND id NOT IN ({marks}) AND missing_runs >= ?",
                [*keep, CONFIRM_RUNS],
            )
        ]
        videos_removed = 0
        for playlist_id in flagged:
            conn.execute("UPDATE playlist SET removed_at = ? WHERE id = ?", (now, playlist_id))
            videos_removed += conn.execute(
                "UPDATE video SET removed_at = ? WHERE playlist_id = ? AND removed_at IS NULL", (now, playlist_id)
            ).rowcount
        unconfirmed = conn.execute(
            f"SELECT COUNT(*) FROM playlist WHERE removed_at IS NULL AND id NOT IN ({marks})", keep
        ).fetchone()[0]
    return {"playlists_removed": len(flagged), "videos_removed": videos_removed, "playlists_unconfirmed": unconfirmed}
