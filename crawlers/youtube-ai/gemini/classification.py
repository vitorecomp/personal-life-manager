"""The text-only classification request (many videos per request) and reading its JSON answer."""

import json
import sqlite3
from typing import Any, Dict, List, Sequence, Tuple

from google.genai import types

from config import (
    CLASSIFY_DESCRIPTION_CHARS,
    CLASSIFY_MAX_OUTPUT_TOKENS,
    CLASSIFY_TRANSCRIPT_CHARS,
)
from gemini.response import read_response
from prompting.builder import render_template
from prompting.categories import Category


def video_metadata(row: sqlite3.Row) -> Dict[str, Any]:
    """What the classifier sees of one video (no video, no full transcript)."""
    def cut(text: str, limit: int) -> str:
        text = " ".join((text or "").split())
        return text if len(text) <= limit else text[:limit] + "..."

    youtube_categories = json.loads(row["categories"]) if row["categories"] else []
    tags = json.loads(row["tags"]) if row["tags"] else []
    return {
        "video_id": row["video_id"],
        "title": row["title"],
        "channel": row["channel"],
        "youtube_category": youtube_categories[0] if youtube_categories else None,
        "duration_seconds": row["duration_seconds"],
        "tags": tags[:15],
        "description": cut(row["description"], CLASSIFY_DESCRIPTION_CHARS),
        "captions_start": cut(row["transcript"], CLASSIFY_TRANSCRIPT_CHARS),
    }


def build_classify_request(rows: Sequence[sqlite3.Row], categories: List[Category],
                           thinking_level: str) -> Tuple[List[types.Content], types.GenerateContentConfig]:
    system = render_template("classify.md", categories=categories)
    lines = "\n".join(json.dumps(video_metadata(row), ensure_ascii=False) for row in rows)
    contents = [types.Content(role="user", parts=[types.Part(text=f"Videos, one JSON object per line:\n{lines}")])]
    schema = types.Schema(
        type=types.Type.ARRAY,
        items=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "video_id": types.Schema(type=types.Type.STRING),
                "category": types.Schema(type=types.Type.STRING, enum=[c.name for c in categories]),
                "confidence": types.Schema(type=types.Type.NUMBER),
            },
            required=["video_id", "category", "confidence"],
        ),
    )
    config = types.GenerateContentConfig(
        system_instruction=system,
        max_output_tokens=CLASSIFY_MAX_OUTPUT_TOKENS,
        response_mime_type="application/json",
        response_schema=schema,
        thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel[thinking_level.upper()]),
    )
    return contents, config


def read_classification(response: Any, expected: Sequence[str], names: Sequence[str]) -> Dict[str, Tuple[str, float]]:
    """{video_id: (category, confidence)} for the expected videos found in a valid answer."""
    text = read_response(response)["text"]
    try:
        items = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"answer is not JSON: {exc}") from None
    wanted, valid = set(expected), set(names)
    found: Dict[str, Tuple[str, float]] = {}
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        video_id, category = item.get("video_id"), item.get("category")
        if video_id in wanted and category in valid:
            try:
                confidence = max(0.0, min(1.0, float(item.get("confidence", 0))))
            except (TypeError, ValueError):
                confidence = 0.0
            found[video_id] = (category, confidence)
    return found
