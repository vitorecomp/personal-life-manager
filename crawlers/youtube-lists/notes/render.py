"""Turn database rows into template data and render the Markdown templates in md-templates/."""

import hashlib
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List
from urllib.parse import quote

from config import AI_FLAGS, VIDEOS_DIR
from notes.keep import normalize
from notes.paths import ref_file_name
from notes.templates import render


def legacy_content_hash(text: str) -> str:
    """How note hashes were computed before keep blocks existed (plain hash of the file)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def content_hash(text: str) -> str:
    """Hash of a note ignoring what is inside keep blocks, so edits there never count as hand edits."""
    return hashlib.sha256(normalize(text).encode("utf-8")).hexdigest()


def _load(row: sqlite3.Row, column: str) -> list:
    return json.loads(row[column]) if row[column] else []


def video_context(video: sqlite3.Row) -> Dict[str, Any]:
    """Everything a video template can use: every video_detail column, with JSON columns decoded."""
    context = {k: video[k] for k in video.keys() if k != "raw_json"}
    context["url"] = f"https://www.youtube.com/watch?v={video['video_id']}"
    context["categories"] = _load(video, "categories")
    context["tags"] = _load(video, "tags")
    context["chapters"] = [
        {"start_seconds": int(c.get("start_time") or 0), "end_seconds": int(c.get("end_time") or 0),
         "title": c.get("title") or ""}
        for c in _load(video, "chapters")
    ]
    context["comments"] = [
        {
            "author": c.get("author") or "unknown",
            "text": c.get("text") or "",
            "like_count": c.get("like_count") if c.get("like_count") is not None else 0,
            "timestamp": c.get("timestamp"),
            "date": datetime.fromtimestamp(c["timestamp"], timezone.utc).strftime("%Y-%m-%d")
            if c.get("timestamp") else "unknown date",
            "is_pinned": bool(c.get("is_pinned")),
            "author_is_uploader": bool(c.get("author_is_uploader")),
        }
        for c in _load(video, "comments")
    ]
    return context


def render_video_note(video: sqlite3.Row) -> str:
    return render("video.md", video=video_context(video))


def render_ref_note(video: sqlite3.Row) -> str:
    """Short note pointing at the full note, which lives in another playlist's folder."""
    return render(
        "video-ref.md",
        video=video_context(video),
        owner={"title": video["owner_title"], "folder": video["owner_folder"]},
        full_note_link=f"../../{quote(video['owner_folder'])}/{VIDEOS_DIR}/{quote(video['note_file'])}",
    )


def read_ai_flags(path: str) -> Dict[str, str]:
    """Keep whatever the note already says (e.g. an AI step flipped a flag to True)."""
    flags = {name: "False" for name in AI_FLAGS}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        for name in AI_FLAGS:
            match = re.search(rf"^- {re.escape(name)}: \[(True|False)\]\s*$", text, re.MULTILINE)
            if match:
                flags[name] = match.group(1)
    return flags


def render_playlist_note(playlist: sqlite3.Row, videos: List[sqlite3.Row], flags: Dict[str, str]) -> str:
    entries = []
    for video in videos:
        entry = {k: video[k] for k in video.keys()}
        entry["note_link"] = None
        if video["note_file"]:
            is_owner = video["note_playlist_id"] in (None, playlist["id"])
            local = video["note_file"] if is_owner else ref_file_name(video["note_file"])
            entry["note_link"] = f"{VIDEOS_DIR}/{quote(local)}"
        entries.append(entry)
    return render(
        "playlist.md",
        playlist={k: playlist[k] for k in playlist.keys()},
        videos=entries,
        ai_flags=flags,
    )
