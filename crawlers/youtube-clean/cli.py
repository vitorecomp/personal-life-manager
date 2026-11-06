"""Command line: find deleted and private videos in your playlists and (with --apply) remove them."""

import argparse
import os
import sys
from collections import Counter
from typing import List, Optional

from config import REMOVALS_PER_REQUEST
from storage.playlists import target_playlists
from storage.removal_log import append as log_removals
from youtube.client import YouTube, YouTubeError

REASONS = ("private", "deleted", "unavailable")


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Remove deleted and private videos from your YouTube playlists.")
    parser.add_argument("--db", required=True, help="The youtube-lists database (to know your playlists).")
    parser.add_argument("--browser", required=True, help="Browser with your YouTube login, e.g. chrome+gnomekeyring.")
    parser.add_argument("--apply", action="store_true", help="Really remove them (default: only show what would go).")
    parser.add_argument("--playlist", action="append", default=[], help="Only this playlist (title or folder). Repeatable.")
    parser.add_argument("--only", default=",".join(REASONS),
                        help=f"Which videos to remove: any of {', '.join(REASONS)} (default: all).")
    parser.add_argument("--include-liked", action="store_true", help="Also un-like unavailable videos in Liked videos.")
    parser.add_argument("--limit", type=int, default=0, help="Remove at most this many videos in this run (0 = no limit).")
    parser.add_argument("--log", help="CSV log of removals (default: youtube-clean-log.csv next to the database).")
    args = parser.parse_args(argv)
    args.only = {r.strip() for r in args.only.split(",") if r.strip()}
    unknown = args.only - set(REASONS)
    if unknown:
        parser.error(f"unknown reason(s) in --only: {', '.join(sorted(unknown))}")
    args.log = args.log or os.path.join(os.path.dirname(os.path.abspath(args.db)), "youtube-clean-log.csv")
    return args


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    try:
        targets = target_playlists(args.db, args.playlist, args.include_liked)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    youtube = YouTube(args.browser)
    try:
        youtube.call("browse", {"browseId": "VLWL"})  # Watch later only exists for a logged-in account
    except YouTubeError as exc:
        print(f"error: YouTube doesn't see you as logged in (Watch later can't be read): {exc}\n"
              "Open youtube.com in your browser, make sure you're signed in, then run again. Nothing was changed.",
              file=sys.stderr)
        return 1

    mode = "REMOVING" if args.apply else "DRY RUN (nothing will be changed; add --apply to remove)"
    print(f"{mode}: checking {len(targets['clean'])} playlist(s)\n")
    totals, rows, failures, budget = Counter(), [], 0, args.limit or None
    for playlist in targets["clean"]:
        try:
            entries = youtube.playlist_entries(playlist["id"])
        except YouTubeError as exc:
            print(f"{playlist['title']}: could not be read ({exc})", file=sys.stderr)
            failures += 1
            continue
        gone = [e for e in entries if e.reason in args.only]
        if not gone:
            continue
        counts = Counter(e.reason for e in gone)
        print(f"{playlist['title']}: {len(gone)} of {len(entries)} videos to remove "
              f"({', '.join(f'{n} {r}' for r, n in counts.most_common())})")
        for e in gone:
            print(f"    #{e.position:<5} {e.video_id}  {e.title}")
        removed = 0
        if args.apply:
            todo = [e for e in gone if e.set_video_id or playlist["id"] == "LL"]
            if budget is not None:
                todo = todo[:budget]
            removed, failed = remove(youtube, args.log, playlist, todo)
            failures += failed
            if budget is not None:
                budget -= removed
        totals.update(counts)
        rows.append((playlist["title"], len(entries), len(gone), removed))
        if budget is not None and budget <= 0:
            print("\n--limit reached; the rest is left for the next run")
            break

    print_summary(rows, totals, targets["skipped"], args)
    return 1 if failures else 0


def remove(youtube: YouTube, log_path: str, playlist: dict, entries: list) -> tuple:
    """Remove entries (in requests of REMOVALS_PER_REQUEST); returns (removed, failed requests)."""
    removed = failed = 0
    if playlist["id"] == "LL":
        for e in entries:
            try:
                youtube.unlike(e.video_id)
                log_removals(log_path, playlist["id"], playlist["title"], [e], "unliked")
                removed += 1
            except YouTubeError as exc:
                log_removals(log_path, playlist["id"], playlist["title"], [e], f"failed: {exc}")
                failed += 1
        return removed, failed
    for start in range(0, len(entries), REMOVALS_PER_REQUEST):
        chunk = entries[start:start + REMOVALS_PER_REQUEST]
        try:
            youtube.remove(playlist["id"], chunk)
            log_removals(log_path, playlist["id"], playlist["title"], chunk, "removed")
            removed += len(chunk)
        except YouTubeError as exc:
            log_removals(log_path, playlist["id"], playlist["title"], chunk, f"failed: {exc}")
            print(f"    failed to remove {len(chunk)} video(s): {exc}", file=sys.stderr)
            failed += 1
    print(f"    removed {removed} video(s)")
    return removed, failed


def print_summary(rows: list, totals: Counter, skipped: list, args: argparse.Namespace) -> None:
    print()
    if not rows:
        print("No deleted or private videos found. Your playlists are clean.")
    else:
        width = max(len(r[0]) for r in rows + [("Playlist",)])
        verb = "Removed" if args.apply else "Would remove"
        print(f"{'Playlist':<{width}}  {'Videos':>6}  {verb:>12}")
        for title, total, gone, removed in rows:
            print(f"{title:<{width}}  {total:>6,}  {(removed if args.apply else gone):>12,}")
        print(f"{'TOTAL':<{width}}  {'':>6}  {(sum(r[3] for r in rows) if args.apply else sum(r[2] for r in rows)):>12,}"
              f"   ({', '.join(f'{n} {r}' for r, n in totals.most_common())})")
    not_mine = [item for item in skipped if item["reason"].startswith("not your playlist")]
    for item in skipped:
        if item not in not_mine:
            print(f"skipped {item['title']}: {item['reason']}")
    if not_mine:
        print(f"skipped {len(not_mine)} playlist(s) saved from other people (YouTube doesn't allow editing them)")
    if args.apply and rows:
        print(f"\nRemovals are logged in {args.log}. Run the youtube-lists sync to update your notes.")
    elif rows:
        print("\nNothing was changed. Run again with --apply to remove them.")
