"""Fetch details for a playlist's videos: new ones first, then re-checks that are due."""

import argparse
import re
import sqlite3
import sys
import time
import urllib.error
from typing import Dict, List, Optional

from notes.writer import refresh_video_note, write_video_notes
from storage.videos import pending_videos, refresh_candidates, store_video_detail
from youtube.client import YtDlpError, is_permanent_failure, run_ytdlp
from youtube.subtitles import download_transcript, pick_subtitle


def sync_details(
    conn: sqlite3.Connection,
    args: argparse.Namespace,
    detail_cmd: List[str],
    playlist_id: str,
    budget: Dict[str, Optional[int]],
    now: str,
    totals: Dict[str, int],
) -> None:
    """Fetch details for this playlist's videos lacking them, then re-check ones worth fetching again."""
    work = [(row["video_id"], row["title"], False) for row in pending_videos(conn, playlist_id)]
    work += [
        (row["video_id"], row["title"], True)
        for row in refresh_candidates(conn, playlist_id, now, args.refresh_days)
    ]
    for index, (video_id, title, is_refresh) in enumerate(work, start=1):
        if budget["left"] is not None and budget["left"] <= 0:
            print(f"  details limit reached; {len(work) - index + 1} videos left for the next run")
            return
        label = f"  [{index}/{len(work)}] {'re-check ' if is_refresh else ''}{title[:60]}"
        try:
            info = run_ytdlp(detail_cmd, f"https://www.youtube.com/watch?v={video_id}")
            unavailable = None
        except YtDlpError as exc:
            if not is_permanent_failure(str(exc)):
                totals["detail_failures"] += 1
                print(f"{label}: failed ({str(exc).splitlines()[0][:100]}) - will retry next run", file=sys.stderr)
                continue
            reason = str(exc).splitlines()[0]
            info, unavailable = None, re.sub(r"^ERROR:\s*(\[\w+\]\s*[\w-]+:\s*)?", "", reason)

        subtitle = None
        has_transcript = is_refresh and conn.execute(
            "SELECT COALESCE(transcript, '') <> '' FROM video_detail WHERE video_id = ?", (video_id,)
        ).fetchone()[0]
        if info and not has_transcript:
            choice = pick_subtitle(info)
            if choice:
                lang, kind, url = choice
                try:
                    subtitle = (lang, kind, download_transcript(url))
                except (urllib.error.URLError, OSError, ValueError) as exc:
                    print(f"{label}: subtitles failed ({exc})", file=sys.stderr)
        store_video_detail(conn, playlist_id, video_id, title, info, unavailable, subtitle, args.comments, now)
        totals["refreshed" if is_refresh else "details"] += 1
        if args.output_dir and not is_refresh:
            write_video_notes(conn, args.output_dir, playlist_id, only_video_id=video_id)
        if budget["left"] is not None:
            budget["left"] -= 1
        status = f"unavailable ({unavailable})" if unavailable else (
            f"ok, transcript: {subtitle[0] + ' ' + subtitle[1] if subtitle and subtitle[2] else 'none'}"
        )
        if is_refresh and args.output_dir:
            status += f", note {refresh_video_note(conn, args.output_dir, video_id)}"
        print(f"{label}: {status}")
        if args.detail_delay > 0 and index < len(work):
            time.sleep(args.detail_delay)
