#!/usr/bin/env python3
"""
youtube-clean: remove deleted and private videos from your YouTube playlists.

Dry run by default: it lists what would be removed. With --apply it removes them through YouTube's own
web API (the call behind "Remove from playlist"), authenticated with your browser's cookies, and logs
every removal to a CSV file first. Playlists come from the youtube-lists database.

Code:
    cli.py                  arguments, the run and the summary
    youtube/client.py       YouTube's internal web API: list entries (incl. hidden unavailable), remove, un-like
    storage/playlists.py    which playlists to clean (read-only from the youtube-lists database)
    storage/removal_log.py  the CSV log of removals
    config.py               constants
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
