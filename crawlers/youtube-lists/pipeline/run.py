"""One full sync run: playlists listed and synced in turn while their videos flow through one shared
detail pool (pipeline.details.DetailPool), then a final reconciliation pass."""

import argparse
import os
import shutil
import sys
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime, timezone
from typing import Dict, Optional

from exports.csv_export import write_csv
from notes.reconcile import reconcile_notes
from notes.writer import write_playlist_notes, write_video_notes
from storage.playlists import mark_missing_playlists, sync_playlist
from storage.schema import open_db
from youtube.client import (
    YtDlpError,
    build_base_cmd,
    build_detail_cmd,
    check_logged_in,
    fetch_playlist,
    list_playlists,
)
from config import SPECIAL_PLAYLISTS
from pipeline.details import DetailPool


def report_reconcile(stats: Dict[str, int]) -> None:
    labels = {
        "promoted": "notes handed to another playlist",
        "removed": "notes moved to removed/",
        "restored": "notes restored from removed/",
        "refs_removed": "ref notes moved to removed/",
        "stubs_dropped": "redundant ref notes dropped",
        "adopted": "renamed/moved notes found again by video id",
        "playlists_parked": "removed playlists' notes moved to removed/",
        "visibility": "folders hidden or shown (video unavailable / available again)",
    }
    done = [f"{stats[key]} {text}" for key, text in labels.items() if stats.get(key)]
    if done:
        print("  files: " + ", ".join(done))


def looks_complete(reported: Optional[int], returned: int) -> bool:
    """Did a playlist fetch return everything YouTube says is in it? (No count and nothing returned: unsure.)"""
    if reported is None:
        return returned > 0
    return returned >= reported


def run(args: argparse.Namespace) -> int:
    if shutil.which("yt-dlp") is None:
        print("error: yt-dlp not found on PATH (install it, e.g. `pacman -S yt-dlp`).", file=sys.stderr)
        return 1
    if not (args.browser or args.cookies):
        print(
            "error: authentication required to read your playlists. "
            "Pass --browser <name> or --cookies <file>.",
            file=sys.stderr,
        )
        return 1

    base_cmd = build_base_cmd(args)

    try:
        playlists = list_playlists(base_cmd, args.feed_url)
    except YtDlpError as exc:
        print(f"error: could not list playlists: {exc}", file=sys.stderr)
        return 1

    if not args.no_special:
        known = {p["id"] for p in playlists}
        playlists += [
            {"id": pid, "title": title} for pid, title in SPECIAL_PLAYLISTS.items() if pid not in known
        ]

    if not playlists:
        print("error: no playlists found - are you logged in to YouTube in that browser?", file=sys.stderr)
        return 1

    detected = check_logged_in(base_cmd)
    if detected is None:
        print(
            "error: YouTube doesn't see you as logged in (Watch Later can't be read), so your private playlists\n"
            "would all fail. Open youtube.com in your browser, make sure you're signed in, then run again.\n"
            "Nothing was changed.",
            file=sys.stderr,
        )
        return 1
    my_channel_id = args.my_channel_id or detected

    now = datetime.now(timezone.utc).isoformat()
    conn = open_db(args.db)
    totals = {"added": 0, "restored": 0, "removed": 0, "unconfirmed": 0, "details": 0, "refreshed": 0, "detail_failures": 0}
    budget = {"left": args.details_limit or None}
    detail_cmd = build_detail_cmd(args)
    failed = []

    def playlist_done(playlist_id: str) -> None:
        if args.output_dir:
            write_video_notes(conn, args.output_dir, playlist_id)
            write_playlist_notes(conn, args.output_dir, only_id=playlist_id)

    pool = None if args.no_details else DetailPool(conn, args, detail_cmd, now, totals, budget, playlist_done)
    try:
        sync_all_playlists(args, conn, base_cmd, playlists, my_channel_id, now, totals, failed, pool)
        if pool:
            pool.finish()  # the remaining queued videos, after the last playlist was listed
    except BaseException:
        if pool:
            pool.cancel()
        raise

    # Failed playlists are still "seen" so a transient error never flags them as removed.
    gone = mark_missing_playlists(conn, [p["id"] for p in playlists], now)
    if gone["playlists_unconfirmed"]:
        print(f"{gone['playlists_unconfirmed']} playlists missing from your account feed; flagged only if missing next run too")

    if args.output_dir:
        # Removals found in a later playlist can change notes of earlier ones (new owner, ref targets).
        report_reconcile(reconcile_notes(conn, args.output_dir))
        playlist_ids = [
            row[0] for row in conn.execute("SELECT id FROM playlist WHERE removed_at IS NULL AND folder IS NOT NULL")
        ]
        for playlist_id in playlist_ids:
            write_video_notes(conn, args.output_dir, playlist_id)
        notes = write_playlist_notes(conn, args.output_dir)
        print(f"Playlist notes in {args.output_dir}: {notes['written']} written, {notes['unchanged']} unchanged")
    if args.output:
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        write_csv(conn, args.output)
        print(f"Wrote {args.output}")

    conn.close()
    print(
        f"\nSynced {len(playlists) - len(failed)}/{len(playlists)} playlists into {args.db}: "
        f"{totals['added']} new videos, {totals['restored']} restored, {totals['removed']} removed, "
        f"{gone['playlists_removed']} playlists removed ({gone['videos_removed']} of their videos); "
        f"details fetched for {totals['details']} new and {totals['refreshed']} re-checked videos "
        f"({totals['detail_failures']} failed, will retry next run)"
    )
    return 1 if failed or totals["detail_failures"] else 0


def sync_all_playlists(args, conn, base_cmd, playlists, my_channel_id, now, totals, failed, pool) -> None:
    """Sync every playlist, feeding their videos into the shared detail pool.

    Listing a playlist is a slow yt-dlp call of its own, so the next ones are listed ahead of time,
    --listing-workers at once; their results are still handled in the original order (which decides,
    for a video in several playlists, which one holds its note). While waiting for a listing, finished
    video details keep being handled, so the detail workers never wait on the listing.
    """
    listing = ThreadPoolExecutor(max_workers=max(1, args.listing_workers), thread_name_prefix="listing")
    futures = [listing.submit(fetch_playlist, base_cmd, playlist) for playlist in playlists]
    try:
        for playlist, future in zip(playlists, futures):
            while not future.done():
                if pool and pool.futures:
                    wait([future, *pool.futures], timeout=1, return_when=FIRST_COMPLETED)
                    pool.drain()
                else:
                    wait([future], timeout=1)
            if pool:
                pool.drain()
            sync_one_playlist(args, conn, playlist, future, my_channel_id, now, totals, failed, pool)
    finally:
        listing.shutdown(wait=False, cancel_futures=True)


def sync_one_playlist(args, conn, playlist, future, my_channel_id, now, totals, failed, pool) -> None:
    """List results of one playlist: store its videos, move notes, queue its videos for details."""
    try:
        fetched = future.result()
    except YtDlpError as exc:
        failed.append(playlist["title"])
        print(f"warning: skipped '{playlist['title']}': {exc}", file=sys.stderr)
        return
    owner_id = fetched["meta"]["owner_channel_id"]
    if playlist["id"] in SPECIAL_PLAYLISTS:
        created_by_me: Optional[bool] = True
    elif my_channel_id and owner_id:
        created_by_me = owner_id == my_channel_id
    else:
        created_by_me = None
    complete = looks_complete(fetched["meta"]["youtube_video_count"], len(fetched["videos"]))
    counts = sync_playlist(
        conn, playlist["id"], fetched["title"], fetched["meta"], created_by_me, fetched["videos"], now, complete
    )
    for key, value in counts.items():
        totals[key] += value
    print(
        f"{fetched['title']}: {len(fetched['videos'])} videos "
        f"(+{counts['added']} new, -{counts['removed']} removed)"
    )
    if counts["unconfirmed"]:
        print(
            f"  {counts['unconfirmed']} videos missing from an incomplete-looking fetch; "
            "they are only flagged removed if still missing next run"
        )

    # Videos that left or returned to playlists: move their notes before anything new is written.
    # The playlist note is written straight away (videos without a note yet link to YouTube) and
    # rewritten once its videos are done; each video note is written as soon as its details arrive.
    if args.output_dir:
        report_reconcile(reconcile_notes(conn, args.output_dir))
        write_video_notes(conn, args.output_dir, playlist["id"])
        write_playlist_notes(conn, args.output_dir, only_id=playlist["id"])

    # Queue this playlist's videos; the workers start on them while the next playlist is listed.
    if pool:
        pool.enqueue(playlist["id"])
