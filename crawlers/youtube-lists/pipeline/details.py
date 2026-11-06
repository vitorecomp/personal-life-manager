"""Fetch video details: new videos first, then re-checks that are due.

The slow part (yt-dlp and the subtitle download) runs in one pool of worker threads for the whole run,
`--workers` at a time (see DetailPool). Everything that touches the database or the notes happens in the
main thread as each result arrives, so each video's note appears as soon as that video is done.
"""

import argparse
import re
import sqlite3
import sys
import time
import urllib.error
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from typing import Dict, List, Optional, Tuple

from notes.writer import refresh_video_note, write_video_notes
from storage.videos import pending_videos, refresh_candidates, store_video_detail
from youtube.client import YtDlpError, is_permanent_failure, run_ytdlp
from youtube.subtitles import download_transcript, pick_subtitle

Subtitle = Optional[Tuple[str, str, str]]


def fetch_one(detail_cmd: List[str], video_id: str, want_subtitles: bool, delay: float) -> dict:
    """Worker: fetch one video's details (and transcript). No database or file access here."""
    result: dict = {"info": None, "unavailable": None, "error": None, "subtitle": None, "subtitle_error": None}
    try:
        result["info"] = run_ytdlp(detail_cmd, f"https://www.youtube.com/watch?v={video_id}")
    except YtDlpError as exc:
        reason = str(exc).splitlines()[0]
        if is_permanent_failure(str(exc)):
            result["unavailable"] = re.sub(r"^(?:ERROR|WARNING):\s*(\[\w+\]\s*([\w-]+:\s*)?)?", "", reason)
        else:
            result["error"] = reason
    if result["info"] and want_subtitles:
        choice = pick_subtitle(result["info"])
        if choice:
            lang, kind, url = choice
            try:
                result["subtitle"] = (lang, kind, download_transcript(url))
            except (urllib.error.URLError, OSError, ValueError) as exc:
                result["subtitle_error"] = str(exc)
    if delay > 0:
        time.sleep(delay)
    return result


class DetailPool:
    """One pool of workers for the whole run, fed like a channel.

    The main thread lists playlists one after another and pushes each playlist's videos into the pool as
    soon as the playlist is synced; the workers keep fetching across playlist boundaries (and while the next
    playlist is being listed) instead of waiting for every playlist to finish. Results come back to the main
    thread, which stores them and writes each video's note as it arrives. A playlist counts as done when
    its last queued video has been handled; `on_playlist_done` is then called (to write its notes).

    A video in several playlists is fetched once: later playlists just wait for the copy already queued.
    """

    def __init__(self, conn: sqlite3.Connection, args: argparse.Namespace, detail_cmd: List[str], now: str,
                 totals: Dict[str, int], budget: Dict[str, Optional[int]], on_playlist_done) -> None:
        self.conn, self.args, self.detail_cmd, self.now = conn, args, detail_cmd, now
        self.totals, self.budget, self.on_playlist_done = totals, budget, on_playlist_done
        self.executor = ThreadPoolExecutor(max_workers=max(1, args.workers), thread_name_prefix="details")
        self.futures: Dict[Future, Tuple[str, str, bool, str]] = {}
        self.in_flight: set = set()
        self.waiting: Dict[str, set] = {}
        self.submitted = 0
        self.handled = 0
        self.limit_skipped = 0

    def enqueue(self, playlist_id: str) -> None:
        """Queue the playlist's videos that need details (new ones first, then due re-checks)."""
        work = [(row["video_id"], row["title"], False) for row in pending_videos(self.conn, playlist_id)]
        work += [(row["video_id"], row["title"], True)
                 for row in refresh_candidates(self.conn, playlist_id, self.now, self.args.refresh_days)]
        with_transcript = {row[0] for row in self.conn.execute(
            "SELECT video_id FROM video_detail WHERE COALESCE(transcript, '') <> ''")}
        waiting, skipped = set(), 0
        for video_id, title, is_refresh in work:
            if video_id in self.in_flight:
                waiting.add(video_id)  # already queued by another playlist
                continue
            if self.budget["left"] is not None and self.budget["left"] <= 0:
                skipped += 1
                continue
            want_subtitles = not (is_refresh and video_id in with_transcript)
            future = self.executor.submit(fetch_one, self.detail_cmd, video_id, want_subtitles, self.args.detail_delay)
            self.futures[future] = (video_id, title, is_refresh, playlist_id)
            self.in_flight.add(video_id)
            waiting.add(video_id)
            self.submitted += 1
            if self.budget["left"] is not None:
                self.budget["left"] -= 1
        if skipped:
            self.limit_skipped += skipped
            print(f"  details limit reached; {skipped} videos of this playlist left for the next run")
        if waiting:
            self.waiting[playlist_id] = waiting
        else:
            self.on_playlist_done(playlist_id)

    def drain(self, block: bool = False) -> None:
        """Handle the results that are ready (with block=True, wait for at least one)."""
        if not self.futures:
            return
        finished, _ = wait(list(self.futures), timeout=None if block else 0, return_when=FIRST_COMPLETED)
        for future in finished:
            video_id, title, is_refresh, playlist_id = self.futures.pop(future)
            self.in_flight.discard(video_id)
            self.handled += 1
            label = f"  [{self.handled}/{self.submitted}] {'re-check ' if is_refresh else ''}{title[:60]}"
            handle_result(self.conn, self.args, playlist_id, video_id, title, is_refresh, future.result(),
                          label, self.now, self.totals)
            for waiting_playlist in [p for p, ids in self.waiting.items() if video_id in ids]:
                self.waiting[waiting_playlist].discard(video_id)
                if not self.waiting[waiting_playlist]:
                    del self.waiting[waiting_playlist]
                    self.on_playlist_done(waiting_playlist)

    def finish(self) -> None:
        """Wait for every queued video and handle it."""
        while self.futures:
            self.drain(block=True)
        for playlist_id in list(self.waiting):  # only if something was left unhandled
            del self.waiting[playlist_id]
            self.on_playlist_done(playlist_id)
        self.executor.shutdown(wait=True)

    def cancel(self) -> None:
        self.executor.shutdown(wait=False, cancel_futures=True)


def handle_result(
    conn: sqlite3.Connection,
    args: argparse.Namespace,
    playlist_id: str,
    video_id: str,
    title: str,
    is_refresh: bool,
    result: dict,
    label: str,
    now: str,
    totals: Dict[str, int],
) -> None:
    """Main thread: store one fetched video and write or refresh its note."""
    if result["error"]:
        totals["detail_failures"] += 1
        print(f"{label}: failed ({result['error'][:100]}) - will retry next run", file=sys.stderr)
        return
    if result["subtitle_error"]:
        print(f"{label}: subtitles failed ({result['subtitle_error']})", file=sys.stderr)
    info, unavailable, subtitle = result["info"], result["unavailable"], result["subtitle"]
    store_video_detail(conn, playlist_id, video_id, title, info, unavailable, subtitle, args.comments, now)
    totals["refreshed" if is_refresh else "details"] += 1
    if args.output_dir and not is_refresh:
        write_video_notes(conn, args.output_dir, playlist_id, only_video_id=video_id)
    status = f"unavailable ({unavailable})" if unavailable else (
        f"ok, transcript: {subtitle[0] + ' ' + subtitle[1] if subtitle and subtitle[2] else 'none'}"
    )
    if is_refresh and args.output_dir:
        status += f", note {refresh_video_note(conn, args.output_dir, video_id)}"
    print(f"{label}: {status}")
