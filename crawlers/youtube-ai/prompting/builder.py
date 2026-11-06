"""Load the prompts in prompts/ (Jinja2) and build the per-video template data."""

import hashlib
import json
import os
import sqlite3
from typing import Any, Dict, Optional

from config import KINDS, TRANSCRIPT_MAX_CHARS

DEFAULT_PROMPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "prompts")
SHARED = ("system.md", "context.md")
CLASSIFY = ("classify.md", "categories.md")
NO_VERBATIM = "no-verbatim.md"  # added to the task after Gemini blocked a verbatim copy (RECITATION)

_env = None
_dir = DEFAULT_PROMPTS_DIR


class PromptError(RuntimeError):
    pass


def configure(prompts_dir: Optional[str] = None) -> None:
    """Create the Jinja2 environment and check that every prompt exists and parses."""
    global _env, _dir
    import jinja2

    _dir = prompts_dir or DEFAULT_PROMPTS_DIR
    names = list(SHARED) + [prompt for prompt, _suffix in KINDS.values()] + list(CLASSIFY) + [NO_VERBATIM]
    missing = [n for n in names if not os.path.isfile(os.path.join(_dir, n))]
    if missing:
        raise PromptError(f"missing prompt(s) in {_dir}: {', '.join(missing)}")
    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(_dir), undefined=jinja2.StrictUndefined,
        trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=False, autoescape=False,
    )
    for name in names:
        try:
            env.get_template(name)
        except jinja2.TemplateSyntaxError as exc:
            raise PromptError(f"{_dir}/{name}, line {exc.lineno}: {exc.message}") from None
    _env = env


def render(name: str, video: Dict[str, Any]) -> str:
    import jinja2

    if _env is None:
        configure()
    try:
        return _env.get_template(name).render(video=video).strip() + "\n"
    except jinja2.TemplateError as exc:
        raise PromptError(f"prompt {name}: {exc}") from None


def render_template(name: str, **context: Any) -> str:
    import jinja2

    if _env is None:
        configure()
    try:
        return _env.get_template(name).render(**context).strip() + "\n"
    except jinja2.TemplateError as exc:
        raise PromptError(f"prompt {name}: {exc}") from None


def classify_prompt_hash() -> str:
    digest = hashlib.sha256()
    for name in CLASSIFY:
        with open(os.path.join(_dir, name), "rb") as fh:
            digest.update(fh.read())
    return digest.hexdigest()[:16]


def prompts_dir() -> str:
    return _dir


def prompt_hash(kind: str, paraphrase: bool = False) -> str:
    """Identifies the prompt version used for a note (the template sources, not the per-video data)."""
    digest = hashlib.sha256()
    for name in list(SHARED) + [KINDS[kind][0]] + ([NO_VERBATIM] if paraphrase else []):
        with open(os.path.join(_dir, name), "rb") as fh:
            digest.update(fh.read())
    return digest.hexdigest()[:16]


def _clock(seconds: Optional[float]) -> str:
    if seconds is None:
        return ""
    seconds = int(seconds)
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"


def video_context(row: sqlite3.Row, include_transcript: bool = True) -> Dict[str, Any]:
    """Template data for one video, from its youtube-lists video_detail row."""
    upload = row["upload_date"] or ""
    transcript = (row["transcript"] or "") if include_transcript else ""
    if len(transcript) > TRANSCRIPT_MAX_CHARS:
        transcript = transcript[:TRANSCRIPT_MAX_CHARS] + "\n[caption track cut here because of its length]"
    chapters = json.loads(row["chapters"]) if row["chapters"] else []
    return {
        "video_id": row["video_id"],
        "title": row["title"],
        "channel": row["channel"],
        "url": f"https://www.youtube.com/watch?v={row['video_id']}",
        "language": row["language"],
        "upload_date": f"{upload[:4]}-{upload[4:6]}-{upload[6:]}" if len(upload) == 8 else upload,
        "duration": _clock(row["duration_seconds"]),
        "duration_seconds": row["duration_seconds"],
        "description": row["description"] or "",
        "tags": json.loads(row["tags"]) if row["tags"] else [],
        "chapters": [{"start": _clock(c.get("start_time") or 0), "title": c.get("title") or ""} for c in chapters],
        "transcript": transcript,
        "subtitle_lang": row["subtitle_lang"],
        "subtitle_kind": row["subtitle_kind"],
    }
