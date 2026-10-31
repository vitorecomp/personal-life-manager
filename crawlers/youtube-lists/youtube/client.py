"""Everything that talks to the yt-dlp binary: account feed, playlists and video metadata."""

import argparse
import json
import subprocess
from typing import Any, Dict, List, Optional

from config import PERMANENT_FAILURES


class YtDlpError(RuntimeError):
    pass


def build_base_cmd(args: argparse.Namespace) -> List[str]:
    cmd = ["yt-dlp", "--flat-playlist", "--dump-single-json", "--no-warnings", "--ignore-errors"]
    if args.cookies:
        cmd += ["--cookies", args.cookies]
    elif args.browser:
        cmd += ["--cookies-from-browser", args.browser]
    return cmd


def build_detail_cmd(args: argparse.Namespace) -> List[str]:
    # --ignore-no-formats-error: we only need metadata. Without a JavaScript runtime yt-dlp can't solve
    # YouTube's playback challenge, finds no downloadable formats, and would otherwise fail the whole video.
    cmd = [
        "yt-dlp", "--dump-single-json", "--skip-download", "--no-warnings", "--no-playlist",
        "--ignore-no-formats-error",
    ]
    if args.cookies:
        cmd += ["--cookies", args.cookies]
    elif args.browser:
        cmd += ["--cookies-from-browser", args.browser]
    if args.comments > 0:
        cmd += [
            "--write-comments",
            "--extractor-args",
            f"youtube:max_comments={args.comments},all,0;comment_sort=new",
        ]
    return cmd


def run_ytdlp(base_cmd: List[str], url: str, extra: Optional[List[str]] = None) -> dict:
    proc = subprocess.run(base_cmd + (extra or []) + [url], capture_output=True, text=True)
    try:
        data = json.loads(proc.stdout) if proc.stdout.strip() else None
    except json.JSONDecodeError as exc:
        raise YtDlpError(f"Could not parse yt-dlp output for {url}: {exc}") from exc
    if not isinstance(data, dict):
        errors = [line for line in proc.stderr.splitlines() if line.startswith(("ERROR", "WARNING"))]
        detail = "\n".join(errors[:5]) or f"yt-dlp returned no data for {url}"
        raise YtDlpError(detail)
    return data


def playlist_url(playlist_id: str) -> str:
    return f"https://www.youtube.com/playlist?list={playlist_id}"


def list_playlists(base_cmd: List[str], feed_url: str) -> List[Dict[str, str]]:
    """Return [{id, title}] for every playlist shown on the account's playlists page."""
    data = run_ytdlp(base_cmd, feed_url)
    playlists = []
    for entry in data.get("entries") or []:
        if not entry:
            continue
        playlist_id = entry.get("id")
        if playlist_id:
            playlists.append({"id": playlist_id, "title": entry.get("title") or playlist_id})
    return playlists


def detect_my_channel_id(base_cmd: List[str]) -> Optional[str]:
    """Watch Later always belongs to the logged-in account, so its owner is "me"."""
    try:
        data = run_ytdlp(base_cmd, playlist_url("WL"), ["--playlist-items", "1"])
    except YtDlpError:
        return None
    return data.get("channel_id") or None


def fetch_playlist(base_cmd: List[str], playlist: Dict[str, str]) -> Dict[str, Any]:
    """Fetch one playlist: returns {title, meta: {...}, videos: [{video_id, position, ...}]}."""
    data = run_ytdlp(base_cmd, playlist_url(playlist["id"]))
    videos = []
    for position, entry in enumerate(data.get("entries") or [], start=1):
        if not entry or not entry.get("id"):
            continue
        videos.append(
            {
                "video_id": entry["id"],
                "position": position,
                "title": entry.get("title") or "",
                "url": entry.get("url") or f"https://www.youtube.com/watch?v={entry['id']}",
                "channel": entry.get("channel") or entry.get("uploader") or "",
                "duration_seconds": int(entry["duration"]) if entry.get("duration") else None,
            }
        )
    meta = {
        "owner_name": data.get("channel") or data.get("uploader"),
        "owner_channel_id": data.get("channel_id"),
        "owner_url": data.get("channel_url") or data.get("uploader_url"),
        "description": data.get("description") or None,
        "availability": data.get("availability"),
        "youtube_video_count": data.get("playlist_count"),
        "modified_date": data.get("modified_date"),
        "view_count": data.get("view_count"),
    }
    return {"title": data.get("title") or playlist["title"], "meta": meta, "videos": videos}


def is_permanent_failure(message: str) -> bool:
    lowered = message.lower()
    return any(marker in lowered for marker in PERMANENT_FAILURES)
