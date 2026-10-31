"""Small text helpers shared by the database and note writers."""

import re
from typing import List, Optional


def safe_name(text: str, fallback: str) -> str:
    name = re.sub(r'[\x00-\x1f/\\:*?"<>|]', "-", text)
    name = re.sub(r"\s+", " ", name).strip(" .-")[:80].strip(" .-")
    return name or fallback


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
