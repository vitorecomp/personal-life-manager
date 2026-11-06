"""Small text helpers shared by the database and note writers."""

import re
import unicodedata
from typing import List, Optional


def kebab(text: str, max_length: int = 60) -> str:
    """'How To RGB 8x8x8 LED CUBE - The BUILD!' -> 'how-to-rgb-8x8x8-led-cube-the-build'.

    Accents are dropped (ń -> n); letters of other scripts are kept (강남 스타일 -> 강남-스타일).
    """
    text = "".join(ch for ch in unicodedata.normalize("NFKD", text) if not unicodedata.combining(ch)).lower()
    slug = re.sub(r"[\W_]+", "-", text).strip("-")
    if len(slug) > max_length:
        slug = slug[:max_length].rsplit("-", 1)[0] or slug[:max_length]
    return slug


def video_slug(title: str) -> str:
    """Base folder and note name of a video (made unique by storage.videos.allocate_note_file)."""
    return kebab(title) or "video"


def md_escape(text: str) -> str:
    return re.sub(r"([\\\[\]`*_<>|])", r"\\\1", text).replace("\n", " ")


def fence(text: str) -> List[str]:
    """Fenced block that cannot be closed early by backticks inside the text."""
    longest = max((len(run) for run in re.findall(r"`+", text)), default=0)
    marker = "`" * max(3, longest + 1)
    return [f"{marker}text", text, marker]


def format_duration(seconds: Optional[int]) -> str:
    if not seconds:
        return ""
    hours, rest = divmod(int(seconds), 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def format_date(value: Optional[str]) -> str:
    if value and re.fullmatch(r"\d{8}", value):
        return f"{value[:4]}-{value[4:6]}-{value[6:]}"
    return value or "unknown"
