#!/usr/bin/env python3
"""Print a table of the unavailable (deleted, private, ...) videos in each playlist.

Reads the youtube-lists database without changing it. The database comes from --db, or from
YOUTUBE_LISTS_DB in the project root .env (relative paths are relative to the project root).

    ./crawlers/youtube-lists/unavailable-report.py          # playlists with unavailable videos
    ./crawlers/youtube-lists/unavailable-report.py --all    # every playlist
"""

import argparse
import os
import sqlite3
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
COLUMNS = ("deleted / removed", "private", "not re-checked yet", "other")


def db_from_env() -> str:
    """YOUTUBE_LISTS_DB from the environment or the project root .env."""
    value = os.environ.get("YOUTUBE_LISTS_DB", "")
    env_file = os.path.join(ROOT, ".env")
    if not value and os.path.isfile(env_file):
        with open(env_file, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("YOUTUBE_LISTS_DB="):
                    value = line.split("=", 1)[1].strip().strip("\"'")
    return value if not value or os.path.isabs(value) else os.path.join(ROOT, value)


def kind(reason: str) -> str:
    text = reason.lower()
    if "private" in text:
        return "private"
    if "no data from youtube" in text:
        return "not re-checked yet"
    if any(word in text for word in ("removed", "deleted", "terminated", "no longer available", "unavailable")):
        return "deleted / removed"
    return "other"


def main() -> int:
    parser = argparse.ArgumentParser(description="Unavailable videos per playlist.")
    parser.add_argument("--db", default=db_from_env(), help="youtube-lists database (default: YOUTUBE_LISTS_DB)")
    parser.add_argument("--all", action="store_true", help="also list playlists without unavailable videos")
    args = parser.parse_args()
    if not args.db or not os.path.isfile(args.db):
        print(f"error: database not found ({args.db or 'set YOUTUBE_LISTS_DB or pass --db'})", file=sys.stderr)
        return 1

    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    rows = conn.execute(
        """
        SELECT p.title, d.unavailable_reason
        FROM video v
        JOIN playlist p ON p.id = v.playlist_id
        LEFT JOIN video_detail d ON d.video_id = v.video_id
        WHERE v.removed_at IS NULL AND p.removed_at IS NULL
        """
    ).fetchall()

    videos, counts = Counter(), defaultdict(Counter)
    for playlist, reason in rows:
        videos[playlist] += 1
        if reason:
            counts[playlist][kind(reason)] += 1

    playlists = sorted(videos, key=lambda p: (-sum(counts[p].values()), p.lower()))
    if not args.all:
        playlists = [p for p in playlists if counts[p]]

    header = ["Playlist", "Videos", *[c.capitalize() for c in COLUMNS], "Unavailable"]
    table = [[p, f"{videos[p]:,}", *[str(counts[p][c]) for c in COLUMNS], str(sum(counts[p].values()))]
             for p in playlists]
    totals = Counter()
    for p in videos:
        totals.update(counts[p])
    table.append(["TOTAL", f"{sum(videos.values()):,}", *[str(totals[c]) for c in COLUMNS], str(sum(totals.values()))])

    widths = [max(len(row[i]) for row in [header] + table) for i in range(len(header))]
    def line(cells):
        return "  ".join(cell.ljust(w) if i == 0 else cell.rjust(w) for i, (cell, w) in enumerate(zip(cells, widths)))
    print(line(header))
    print("  ".join("-" * w for w in widths))
    for row in table[:-1]:
        print(line(row))
    print("  ".join("-" * w for w in widths))
    print(line(table[-1]))

    distinct = conn.execute("SELECT COUNT(*) FROM video_detail WHERE unavailable_reason IS NOT NULL").fetchone()[0]
    affected = sum(1 for p in videos if counts[p])
    print(f"\n{distinct:,} distinct unavailable videos in {affected} of {len(videos)} playlists "
          f"(a video in several playlists is counted in each).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
