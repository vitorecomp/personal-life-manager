"""Everything that talks to the yt-dlp binary: account feed, playlists and video metadata."""

import argparse
import json
import subprocess
import time
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
        "yt-dlp", "--dump-single-json", "--skip-download", "--no-playlist",  # warnings carry the failure reason
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
    if not isinstance(data, dict) or is_placeholder(data):
        # A placeholder happens with --ignore-no-formats-error: errors such as "This video is private"
        # become warnings and yt-dlp prints a stub instead of failing.
        errors = [line for line in proc.stderr.splitlines() if line.startswith(("ERROR", "WARNING"))]
        errors.sort(key=lambda line: not is_permanent_failure(line))  # the real reason first
        detail = "\n".join(errors[:5]) or f"yt-dlp returned no data for {url}"
        if isinstance(data, dict) and not any(is_permanent_failure(line) for line in errors):
            detail = "Video unavailable: YouTube returned no data for it\n" + detail
        raise YtDlpError(detail)
    return data


def is_placeholder(data: dict) -> bool:
    """yt-dlp's stub for a video it could not read: made-up title, no channel, no duration."""
    return (
        data.get("_type", "video") == "video"
        and data.get("title") == f"youtube video #{data.get('id')}"
        and not data.get("channel")
        and not data.get("uploader")
        and not data.get("duration")
    )


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


# What YouTube answers about your own private playlists when it doesn't see you as logged in.
LOGGED_OUT_MARKERS = ("playlist does not exist", "sign in", "login required", "confirm you're not a bot")


def looks_logged_out(message: str) -> bool:
    lowered = message.lower()
    return any(marker in lowered for marker in LOGGED_OUT_MARKERS)


def check_logged_in(base_cmd: List[str], attempts: int = 3, wait_seconds: float = 10) -> Optional[str]:
    """Your channel id when YouTube sees you as logged in (Watch Later only exists for a logged-in
    account), retrying a few times; None when it still doesn't after `attempts` tries."""
    for attempt in range(1, attempts + 1):
        channel_id = detect_my_channel_id(base_cmd)
        if channel_id:
            return channel_id
        if attempt < attempts:
            time.sleep(wait_seconds)
    return None


def fetch_playlist(base_cmd: List[str], playlist: Dict[str, str], retry_wait: float = 10) -> Dict[str, Any]:
    """Fetch one playlist: returns {title, meta: {...}, videos: [{video_id, position, ...}]}.
    An answer that looks like a logged-out session is retried once after a short wait."""
    try:
        data = run_ytdlp(base_cmd, playlist_url(playlist["id"]))
    except YtDlpError as exc:
        if not looks_logged_out(str(exc)):
            raise
        time.sleep(retry_wait)
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
