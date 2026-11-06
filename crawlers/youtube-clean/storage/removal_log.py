"""CSV log of every removal (written before the removal is sent), to re-add videos later if needed."""

import csv
import os
from datetime import datetime, timezone
from typing import List

from youtube.client import Entry

FIELDS = ["removed_at", "playlist_id", "playlist_title", "video_id", "title_shown", "reason", "position", "status"]


def append(path: str, playlist_id: str, playlist_title: str, entries: List[Entry], status: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    new_file = not os.path.exists(path)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with open(path, "a", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        if new_file:
            writer.writeheader()
        for e in entries:
            writer.writerow({"removed_at": now, "playlist_id": playlist_id, "playlist_title": playlist_title,
                             "video_id": e.video_id, "title_shown": e.title, "reason": e.reason,
                             "position": e.position, "status": status})
