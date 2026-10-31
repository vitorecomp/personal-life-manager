"""Pick and download the subtitle track in a video's original language."""

import json
import time
import urllib.error
import urllib.request
from typing import List, Optional, Tuple


def pick_subtitle(info: dict) -> Optional[Tuple[str, str, str]]:
    """Choose the subtitle track in the video's original language: (lang, kind, json3 url)."""
    manual = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}
    lang = info.get("language") or next((k[: -len("-orig")] for k in auto if k.endswith("-orig")), None)
    if not lang:
        return None

    candidates = []
    for key in manual:
        if key == lang or key.startswith(lang + "-"):
            candidates.append((key, "manual", manual[key]))
    for key in (f"{lang}-orig", lang):
        if key in auto:
            candidates.append((key, "auto", auto[key]))
    for key, kind, formats in candidates:
        by_ext = {f.get("ext"): f.get("url") for f in formats if f.get("url")}
        if "json3" in by_ext:
            return key, kind, by_ext["json3"]
    return None


def download_transcript(url: str) -> str:
    """Download a json3 caption track and flatten it to one line of text per caption event."""
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in (1, 2):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt == 1:
                time.sleep(5)
                continue
            raise
    lines: List[str] = []
    for event in payload.get("events") or []:
        text = "".join(seg.get("utf8", "") for seg in event.get("segs") or []).replace("\n", " ").strip()
        if text and (not lines or lines[-1] != text):
            lines.append(text)
    return "\n".join(lines)
