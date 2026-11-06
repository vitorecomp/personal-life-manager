#!/usr/bin/env python3
"""
youtube-lists: sync all of your YouTube playlists into a SQLite database and
render Markdown notes for every playlist and video.

Uses the `yt-dlp` binary (must be on PATH) authenticated with your browser
session cookies, so private playlists, Watch Later and Liked videos are included.

The database is the source of truth and runs are incremental: existing rows are
updated in place, new playlists/videos are inserted, and items that disappeared
from YouTube are kept but flagged with `removed_at` (cleared again if they return).

Tables:
    playlist      one row per playlist (metadata, owner, whether you created it, notes folder)
    video         membership of a video in a playlist (position, title, channel, ...)
    video_detail  one row per distinct video (description, counts, tags, chapters,
                  latest comments, original-language transcript, raw JSON)

Work flows like a channel: playlists are listed one after another, and as soon as a playlist is synced its
videos needing details go into one shared pool of workers (--workers), which keeps fetching across playlist
boundaries. Each video's note is written when its details arrive; a playlist's note is rewritten when its
last video is done. Videos already in video_detail are never fetched again, so repeat runs only do new work.

With --output-dir, each playlist gets <output-dir>/<playlist folder>/<playlist folder>.md and each
video gets <output-dir>/<playlist>/videos/<title>/<title>.md. The flags in a playlist's `ai-summary` section
are never reset by a sync once they have been changed.

Code lives in the modules next to this file:
    cli.py                 argument parsing; starts a run under the database lock
    config.py              shared constants and tuning knobs
    pipeline/run.py        one sync run: playlists listed in turn, then a final reconciliation pass
    pipeline/details.py    the shared detail worker pool (DetailPool) and due re-checks
    youtube/client.py      yt-dlp invocation (account feed, playlists, video metadata)
    youtube/subtitles.py   original-language subtitle selection and download
    storage/schema.py      schema, opening and upgrading the database
    storage/playlists.py   playlist and membership writes, removal confirmation
    storage/videos.py      video details and re-check scheduling
    storage/lock.py        refuses to run twice at once on the same database
    notes/templates.py     loads md-templates/ (Jinja2)
    notes/render.py        template data and rendering
    notes/writer.py        writing notes to disk
    notes/keep.py          keep blocks: text no run may change
    notes/reconcile.py     moving notes when videos leave or return to playlists (removed/ folder)
    notes/paths.py         note locations and safe moves
    exports/csv_export.py  CSV export
    utils/text.py          small text helpers (incl. kebab-case names)
    migrate.py + migrations/  schema and notes-layout migrations (run.sh applies them first)

Examples:
    ./youtube-lists.py --browser firefox --db youtube.sqlite --output-dir notes/youtube
    ./youtube-lists.py --cookies cookies.txt --db youtube.sqlite -o playlists.csv
    ./youtube-lists.py --browser chrome --db youtube.sqlite --no-special --details-limit 50
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
