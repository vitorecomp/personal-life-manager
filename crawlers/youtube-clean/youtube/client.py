"""YouTube's internal web API (the one youtube.com itself calls), authenticated with browser cookies.

yt-dlp is used for what it does well: reading the browser's cookies and signing the requests. The calls
are the ones the website makes when you open a playlist (browse) and click "Remove from playlist"
(browse/edit_playlist), or remove a like (like/removelike).
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from config import PLACEHOLDER_REASONS, SHOW_UNAVAILABLE_PARAMS


class YouTubeError(RuntimeError):
    pass


@dataclass
class Entry:
    video_id: str
    set_video_id: Optional[str]
    title: str
    reason: Optional[str]  # None for a playable video, else "private", "deleted" or "unavailable"
    position: int


def browser_spec(text: str) -> tuple:
    """'chrome+gnomekeyring' -> ('chrome', None, 'GNOMEKEYRING', None), as yt-dlp's cookiesfrombrowser."""
    browser, _, keyring = text.partition("+")
    return (browser.strip().lower(), None, keyring.strip().upper() or None, None)


class YouTube:
    def __init__(self, browser: str) -> None:
        from yt_dlp import YoutubeDL

        self.ydl = YoutubeDL({"cookiesfrombrowser": browser_spec(browser), "quiet": True, "no_warnings": True})
        self.ie = self.ydl.get_info_extractor("YoutubeTab")

    def call(self, endpoint: str, query: Dict[str, Any]) -> Dict[str, Any]:
        try:
            return self.ie._call_api(endpoint, query, None, note=False)
        except Exception as exc:  # yt-dlp raises ExtractorError with the HTTP details
            raise YouTubeError(f"{endpoint}: {exc}") from None

    def playlist_entries(self, playlist_id: str) -> List[Entry]:
        """Every entry of a playlist, including the unavailable ones YouTube hides by default."""
        data = self.call("browse", {"browseId": f"VL{playlist_id}", "params": SHOW_UNAVAILABLE_PARAMS})
        entries: List[Entry] = []
        while True:
            for renderer in _find(data, "playlistVideoRenderer"):
                entries.append(_entry(renderer, len(entries) + 1))
            token = next(iter(_find(data, "continuationCommand")), {}).get("token")
            if not token:
                return entries
            data = self.call("browse", {"continuation": token})

    def remove(self, playlist_id: str, entries: List[Entry]) -> None:
        """Remove entries from a playlist (what "Remove from playlist" does); raises on failure."""
        actions = [{"action": "ACTION_REMOVE_VIDEO", "setVideoId": e.set_video_id, "removedVideoId": e.video_id}
                   for e in entries]
        data = self.call("browse/edit_playlist", {"playlistId": playlist_id, "actions": actions})
        if data.get("status") != "STATUS_SUCCEEDED":
            raise YouTubeError(f"edit_playlist answered {data.get('status')!r}")

    def unlike(self, video_id: str) -> None:
        """Remove a like (how videos leave "Liked videos")."""
        self.call("like/removelike", {"target": {"videoId": video_id}})


def _find(node: Any, key: str) -> List[Dict[str, Any]]:
    """All values stored under `key` anywhere in a JSON tree, in document order."""
    found: List[Dict[str, Any]] = []
    stack = [node]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            if key in current:
                found.append(current[key])
            stack.extend(reversed(list(current.values())))
        elif isinstance(current, list):
            stack.extend(reversed(current))
    return found


def _entry(renderer: Dict[str, Any], position: int) -> Entry:
    title_obj = renderer.get("title") or {}
    title = title_obj.get("simpleText") or "".join(run.get("text", "") for run in title_obj.get("runs", []))
    reason = PLACEHOLDER_REASONS.get(title)
    if reason is None and not renderer.get("isPlayable") and "lengthText" not in renderer:
        reason = "unavailable"
    return Entry(renderer.get("videoId", ""), renderer.get("setVideoId"), title, reason, position)
