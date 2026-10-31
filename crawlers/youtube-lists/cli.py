"""Command line interface: parse the arguments and start a run under the database lock."""

import argparse
import os
import sys
from typing import List, Optional

from pipeline.run import run
from notes.templates import TemplateSetupError, configure as configure_templates
from storage.lock import RunLocked, run_lock
from config import PLAYLISTS_FEED_URL


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync your YouTube playlists into SQLite and Markdown notes.")
    auth = parser.add_mutually_exclusive_group()
    auth.add_argument(
        "--browser",
        default=os.environ.get("YOUTUBE_COOKIES_BROWSER"),
        help="Browser to read login cookies from (firefox, chrome, chromium, brave, ...). "
        "Defaults to $YOUTUBE_COOKIES_BROWSER.",
    )
    auth.add_argument(
        "--cookies",
        default=os.environ.get("YOUTUBE_COOKIES_FILE"),
        help="Netscape-format cookies file. Defaults to $YOUTUBE_COOKIES_FILE.",
    )
    parser.add_argument(
        "--db", default="youtube-lists.sqlite", help="SQLite database path (created if missing)."
    )
    parser.add_argument(
        "--output-dir",
        help="Write notes: <dir>/<playlist>/<playlist>.md and <dir>/<playlist>/videos/<video>.md.",
    )
    parser.add_argument("-o", "--output", help="Also export all videos to this CSV file.")
    parser.add_argument(
        "--my-channel-id",
        default=os.environ.get("YOUTUBE_MY_CHANNEL_ID"),
        help="Your channel ID, used to decide 'created by me'. Auto-detected from Watch Later if omitted.",
    )
    parser.add_argument("--no-special", action="store_true", help="Skip Watch Later and Liked videos.")
    parser.add_argument("--no-details", action="store_true", help="Only sync playlists/videos; skip per-video details.")
    parser.add_argument(
        "--details-limit",
        type=int,
        default=0,
        help="Fetch details for at most this many videos per run (0 = no limit). Remaining videos are picked up next run.",
    )
    parser.add_argument(
        "--comments", type=int, default=20, help="How many of the newest comments to store per video (0 = none)."
    )
    parser.add_argument(
        "--templates-dir",
        help="Folder with playlist.md, video.md and video-ref.md (default: md-templates/ next to this script).",
    )
    parser.add_argument(
        "--refresh-days",
        type=int,
        default=0,
        help="Also re-fetch details (counts, comments) of videos not checked for this many days (0 = off). "
        "Missing transcripts and unavailable videos are re-checked on their own schedule regardless.",
    )
    parser.add_argument(
        "--detail-delay", type=float, default=1.0, help="Seconds to wait between video detail requests."
    )
    parser.add_argument(
        "--feed-url",
        default=PLAYLISTS_FEED_URL,
        help="Page that lists your playlists (override if YouTube changes it).",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    if args.output_dir:
        try:
            configure_templates(args.templates_dir)
        except TemplateSetupError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
    try:
        with run_lock(args.db):
            return run(args)
    except (RunLocked, TemplateSetupError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
