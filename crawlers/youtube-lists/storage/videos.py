"""Per-video details: what still needs fetching, storing results and re-check scheduling."""

import json
import sqlite3
from datetime import datetime, timedelta
from typing import List, Optional, Tuple

from utils.text import video_slug
from config import (
    RAW_JSON_DROP,
    RETRY_OLD_INTERVAL_DAYS,
    RETRY_OLD_MAX_ATTEMPTS,
    RETRY_RECENT_DAYS,
    RETRY_RECENT_INTERVAL_DAYS,
    UNAVAILABLE_RECHECK_DAYS,
)


def pending_videos(conn: sqlite3.Connection, playlist_id: str) -> List[sqlite3.Row]:
    """Active videos of a playlist that have no video_detail row yet (new, or never fetched)."""
    conn.row_factory = sqlite3.Row
    return conn.execute(
        """
        SELECT v.video_id, v.title FROM video v
        LEFT JOIN video_detail d ON d.video_id = v.video_id
        WHERE v.playlist_id = ? AND v.removed_at IS NULL AND d.video_id IS NULL
        ORDER BY v.position
        """,
        (playlist_id,),
    ).fetchall()


def json_or_none(value: object) -> Optional[str]:
    return json.dumps(value, ensure_ascii=False, default=str) if value else None


def allocate_note_file(conn: sqlite3.Connection, video_id: str, title: str) -> str:
    """Note file name for a new video: its kebab-case title, with -2, -3... when another video already
    uses that name (names must be unique, because a video's folder can move to any playlist)."""
    base = video_slug(title)
    taken = {
        row[0] for row in conn.execute(
            "SELECT note_file FROM video_detail WHERE video_id <> ? AND (note_file = ? OR note_file LIKE ?)",
            (video_id, f"{base}.md", f"{base}-%.md"),
        )
    }
    name, counter = f"{base}.md", 2
    while name in taken:
        name, counter = f"{base}-{counter}.md", counter + 1
    return name


def store_video_detail(
    conn: sqlite3.Connection,
    playlist_id: str,
    video_id: str,
    fallback_title: str,
    info: Optional[dict],
    unavailable_reason: Optional[str],
    subtitle: Optional[Tuple[str, str, str]],
    max_comments: int,
    now: str,
) -> None:
    """Insert or refresh the video_detail row (one per distinct video).

    On first insert `playlist_id` becomes the owner of the video's note. Refreshing never touches the note
    bookkeeping columns, never replaces an existing transcript with an empty one, and when the video is now
    unavailable only records that fact, so earlier good data is kept.
    """
    exists = conn.execute("SELECT 1 FROM video_detail WHERE video_id = ?", (video_id,)).fetchone()
    if info is None and exists:
        with conn:
            conn.execute(
                "UPDATE video_detail SET unavailable_reason = ?, last_checked_at = ? WHERE video_id = ?",
                (unavailable_reason, now, video_id),
            )
        return

    info = info or {}
    title = info.get("title") or fallback_title or video_id
    comments = [
        {
            "author": c.get("author"),
            "text": c.get("text"),
            "like_count": c.get("like_count"),
            "timestamp": c.get("timestamp"),
            "is_pinned": bool(c.get("is_pinned")),
            "author_is_uploader": bool(c.get("author_is_uploader")),
        }
        for c in (info.get("comments") or [])
        if c.get("parent") in (None, "root")
    ][:max_comments]
    raw = {k: v for k, v in info.items() if k not in RAW_JSON_DROP}
    sub_lang, sub_kind, transcript = subtitle if subtitle else (None, None, None)
    values = {
        "video_id": video_id,
        "title": title,
        "description": info.get("description"),
        "channel": info.get("channel") or info.get("uploader"),
        "channel_id": info.get("channel_id"),
        "channel_url": info.get("channel_url") or info.get("uploader_url"),
        "upload_date": info.get("upload_date"),
        "duration_seconds": int(info["duration"]) if info.get("duration") else None,
        "view_count": info.get("view_count"),
        "like_count": info.get("like_count"),
        "comment_count": info.get("comment_count"),
        "age_limit": info.get("age_limit"),
        "categories": json_or_none(info.get("categories")),
        "tags": json_or_none(info.get("tags")),
        "chapters": json_or_none(info.get("chapters")),
        "language": info.get("language"),
        "live_status": info.get("live_status"),
        "availability": info.get("availability"),
        "thumbnail": info.get("thumbnail"),
        "comments": json_or_none(comments),
        "subtitle_lang": sub_lang,
        "subtitle_kind": sub_kind,
        "transcript": transcript,
        "raw_json": json_or_none(raw),
        "unavailable_reason": unavailable_reason,
        "note_file": allocate_note_file(conn, video_id, title) if not exists else "",  # kept on refresh
        "note_playlist_id": playlist_id,
        "now": now,
        "attempts": 0 if transcript else 1,
    }
    with conn:
        conn.execute(
            """
            INSERT INTO video_detail (
                video_id, title, description, channel, channel_id, channel_url, upload_date,
                duration_seconds, view_count, like_count, comment_count, age_limit, categories, tags,
                chapters, language, live_status, availability, thumbnail, comments, subtitle_lang,
                subtitle_kind, transcript, raw_json, unavailable_reason, note_file, note_playlist_id,
                fetched_at, last_checked_at, transcript_attempts)
            VALUES (
                :video_id, :title, :description, :channel, :channel_id, :channel_url, :upload_date,
                :duration_seconds, :view_count, :like_count, :comment_count, :age_limit, :categories, :tags,
                :chapters, :language, :live_status, :availability, :thumbnail, :comments, :subtitle_lang,
                :subtitle_kind, :transcript, :raw_json, :unavailable_reason, :note_file, :note_playlist_id,
                :now, :now, :attempts)
            ON CONFLICT(video_id) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                channel = excluded.channel,
                channel_id = excluded.channel_id,
                channel_url = excluded.channel_url,
                upload_date = excluded.upload_date,
                duration_seconds = excluded.duration_seconds,
                view_count = excluded.view_count,
                like_count = excluded.like_count,
                comment_count = excluded.comment_count,
                age_limit = excluded.age_limit,
                categories = excluded.categories,
                tags = excluded.tags,
                chapters = excluded.chapters,
                language = excluded.language,
                live_status = excluded.live_status,
                availability = excluded.availability,
                thumbnail = excluded.thumbnail,
                comments = COALESCE(excluded.comments, video_detail.comments),
                subtitle_lang = CASE WHEN COALESCE(excluded.transcript, '') <> ''
                                     THEN excluded.subtitle_lang ELSE video_detail.subtitle_lang END,
                subtitle_kind = CASE WHEN COALESCE(excluded.transcript, '') <> ''
                                     THEN excluded.subtitle_kind ELSE video_detail.subtitle_kind END,
                transcript = CASE WHEN COALESCE(excluded.transcript, '') <> ''
                                  THEN excluded.transcript ELSE video_detail.transcript END,
                transcript_attempts = CASE WHEN COALESCE(excluded.transcript, '') <> ''
                                                OR COALESCE(video_detail.transcript, '') <> ''
                                           THEN 0 ELSE video_detail.transcript_attempts + 1 END,
                raw_json = excluded.raw_json,
                unavailable_reason = excluded.unavailable_reason,
                fetched_at = excluded.fetched_at,
                last_checked_at = excluded.last_checked_at
            """,
            values,
        )


def refresh_candidates(
    conn: sqlite3.Connection, playlist_id: str, now: str, refresh_days: int
) -> List[sqlite3.Row]:
    """Videos of this playlist whose stored details are worth fetching again.

    * unavailable (private/deleted) videos, once UNAVAILABLE_RECHECK_DAYS have passed since the last check;
    * videos without a transcript: young uploads daily (captions often appear later), older ones monthly
      up to RETRY_OLD_MAX_ATTEMPTS checks in total;
    * with refresh_days > 0, every video not checked for that many days (fresh counts and comments).
    """
    conn.row_factory = sqlite3.Row
    moment = datetime.fromisoformat(now)

    def ago(days: int) -> str:
        return (moment - timedelta(days=days)).isoformat()

    no_transcript = "d.unavailable_reason IS NULL AND COALESCE(d.transcript, '') = ''"
    conditions = [
        "(d.unavailable_reason IS NOT NULL AND d.last_checked_at < :unavailable)",
        f"({no_transcript} AND d.upload_date >= :recent_upload AND d.last_checked_at < :recent_check)",
        f"({no_transcript} AND d.transcript_attempts < :max_attempts AND d.last_checked_at < :old_check)",
    ]
    params = {
        "playlist_id": playlist_id,
        "unavailable": ago(UNAVAILABLE_RECHECK_DAYS),
        "recent_upload": (moment - timedelta(days=RETRY_RECENT_DAYS)).strftime("%Y%m%d"),
        "recent_check": ago(RETRY_RECENT_INTERVAL_DAYS),
        "max_attempts": RETRY_OLD_MAX_ATTEMPTS,
        "old_check": ago(RETRY_OLD_INTERVAL_DAYS),
        "stale": ago(refresh_days) if refresh_days > 0 else "",
    }
    if refresh_days > 0:
        conditions.append("d.last_checked_at < :stale")
    return conn.execute(
        f"""
        SELECT v.video_id, v.title FROM video v
        JOIN video_detail d ON d.video_id = v.video_id
        WHERE v.playlist_id = :playlist_id AND v.removed_at IS NULL AND ({" OR ".join(conditions)})
        ORDER BY d.last_checked_at, v.position
        """,
        params,
    ).fetchall()
