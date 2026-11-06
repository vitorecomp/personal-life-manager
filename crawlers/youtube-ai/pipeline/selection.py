"""Pick the videos to process from the youtube-lists database."""

import os
import re
import sqlite3
from datetime import date
from typing import Any, Dict, List, Optional, Sequence, Tuple

from config import (
    ACTION_KINDS,
    CLASSIFY_MIN_CONFIDENCE,
    KINDS,
    PLAYLIST_AI_SWITCH,
    SCORE_COMMENTS_PER_POINT,
    SCORE_PENALTY_PER_MONTH,
    SCORE_VIEWS_PER_POINT,
    SKIP_LIVE_STATUS,
)
from gemini.request import choose_resolution
from storage.state import can_retry, classifications, note_states


def ai_note_path(notes_dir: str, note_path: str, note_file: str, kind: str) -> str:
    folder = os.path.dirname(os.path.join(notes_dir, note_path))
    return os.path.join(folder, f"{note_file[: -len('.md')]}{KINDS[kind][1]}.md")


SWITCH_RE = re.compile(rf"{re.escape(PLAYLIST_AI_SWITCH)}\s*:?\s*\**\s*:?\s*\[\s*(true|false)\s*\]", re.IGNORECASE)


def playlist_allows_ai(notes_dir: str, folder: str) -> bool:
    """False only when the playlist note's top section says "AI Video Description: [False]"."""
    path = os.path.join(notes_dir, folder, f"{folder}.md")
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return True
    top = re.split(r"^## ", text, maxsplit=1, flags=re.MULTILINE)[0]
    match = SWITCH_RE.search(top)
    return not (match and match.group(1).lower() == "false")


def months_since(upload_date: Optional[str], today: date) -> int:
    """Full calendar months between an upload date (YYYYMMDD) and today; 0 when unknown or in the future."""
    if not upload_date or len(upload_date) != 8 or not upload_date.isdigit():
        return 0
    year, month, day = int(upload_date[:4]), int(upload_date[4:6]), int(upload_date[6:])
    months = (today.year - year) * 12 + (today.month - month)
    if today.day < day:
        months -= 1
    return max(0, months)


def video_score(row: sqlite3.Row, today: date) -> int:
    """Higher first: +1 per 1,000 views, +1 per 100 comments, -10 per full month since upload."""
    return (
        (row["view_count"] or 0) // SCORE_VIEWS_PER_POINT
        + (row["comment_count"] or 0) // SCORE_COMMENTS_PER_POINT
        - SCORE_PENALTY_PER_MONTH * months_since(row["upload_date"], today)
    )


def eligible_items(conn: sqlite3.Connection, notes_dir: str, kinds: Sequence[str], playlists: Sequence[str],
                   video_ids: Sequence[str], media_resolution: str, force: bool, order: str = "score",
                   today: Optional[date] = None) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """Every video that still needs notes, before classification, in processing order.

    Only videos whose note sits in an active playlist folder are considered (not ones parked in removed/),
    only public ones (Gemini can't open private or unlisted YouTube videos), and not ones whose playlists
    all turned AI off. With order="score" they are sorted by video_score (highest first, ties in playlist
    order); with order="playlist" they keep playlist order. Returns (items, {skip reason: count}).
    """
    today = today or date.today()
    filters, params = [], []
    if playlists:
        marks = ",".join("?" * len(playlists))
        filters.append(f"AND (LOWER(p.title) IN ({marks}) OR LOWER(p.folder) IN ({marks}))")
        params += [p.lower() for p in playlists] * 2
    video_filter = ""
    if video_ids:
        video_filter = f"AND d.video_id IN ({','.join('?' * len(video_ids))})"
    rows = conn.execute(
        f"""
        SELECT d.* FROM video_detail d
        LEFT JOIN playlist op ON op.id = d.note_playlist_id
        LEFT JOIN video ov ON ov.playlist_id = d.note_playlist_id AND ov.video_id = d.video_id
        WHERE (d.note_path IS NULL OR d.note_path NOT LIKE 'removed/%')
          AND EXISTS (SELECT 1 FROM video v JOIN playlist p ON p.id = v.playlist_id
                      WHERE v.video_id = d.video_id AND v.removed_at IS NULL AND p.removed_at IS NULL
                      {" ".join(filters)})
          {video_filter}
        ORDER BY op.first_seen_at, op.rowid, ov.position
        """,
        params + list(video_ids),
    ).fetchall()

    allowed_folders: Dict[str, bool] = {}
    allowed_videos = set()
    for video_id, folder in conn.execute(
        "SELECT v.video_id, p.folder FROM video v JOIN playlist p ON p.id = v.playlist_id "
        "WHERE v.removed_at IS NULL AND p.removed_at IS NULL AND p.folder IS NOT NULL"
    ):
        if folder not in allowed_folders:
            allowed_folders[folder] = playlist_allows_ai(notes_dir, folder)
        if allowed_folders[folder]:
            allowed_videos.add(video_id)

    states = note_states(conn)
    items: List[Dict[str, Any]] = []
    skipped: Dict[str, int] = {}

    def skip(reason: str) -> None:
        skipped[reason] = skipped.get(reason, 0) + 1

    for row in rows:
        if row["unavailable_reason"]:
            skip("unavailable on YouTube (private or deleted)")
            continue
        if not row["note_path"]:
            skip("no video note yet (the youtube-lists sync hasn't written it)")
            continue
        if row["video_id"] not in allowed_videos:
            skip(f"AI turned off for its playlist ({PLAYLIST_AI_SWITCH}: False)")
            continue
        if row["availability"] not in (None, "public"):
            skip(f"not public ({row['availability']})")
            continue
        if row["live_status"] in SKIP_LIVE_STATUS:
            skip("live or upcoming")
            continue
        wanted = []
        for kind in kinds:
            state = states.get((row["video_id"], kind))
            on_disk = os.path.exists(ai_note_path(notes_dir, row["note_path"], row["note_file"], kind))
            if state is None and on_disk and not force:
                continue  # written earlier (or by hand): never overwrite it
            if can_retry(state, force):
                wanted.append(kind)
        if not wanted:
            continue
        resolution, reason = choose_resolution(row["duration_seconds"], media_resolution)
        if resolution is None:
            skip(reason.split(" (")[0])
            continue
        # notes blocked earlier for copying text verbatim get the no-verbatim prompt this time
        paraphrase = [k for k in wanted if (states.get((row["video_id"], k)) or {"error": None})["error"]
                      and "RECITATION" in states[(row["video_id"], k)]["error"]]
        items.append({"row": row, "kinds": wanted, "resolution": resolution, "score": video_score(row, today),
                      "paraphrase": paraphrase})
    if order == "score":
        items.sort(key=lambda item: -item["score"])  # stable: equal scores stay in playlist order
    return items, skipped


def kinds_for_category(item: Dict[str, Any], result: Optional[sqlite3.Row],
                       categories: Dict[str, Any]) -> Tuple[Optional[List[str]], Optional[str]]:
    """Which of the item's notes its classification allows: (kinds, skip reason).

    kinds is None when the video isn't classified yet (or its category was removed from the table);
    an empty list means nothing to do, with a skip reason when the category's action is "skip". A "full"
    category with a confidence under CLASSIFY_MIN_CONFIDENCE counts as "knowledge".
    """
    if result is None or result["status"] != "done" or result["category"] not in categories:
        return None, None
    action = categories[result["category"]].action
    if action == "full" and (result["confidence"] or 0) < CLASSIFY_MIN_CONFIDENCE:
        action = "knowledge"
    kinds = [k for k in item["kinds"] if k in ACTION_KINDS[action]]
    reason = f"category {result['category']} (skip)" if not ACTION_KINDS[action] else None
    return kinds, reason


def select_videos(conn: sqlite3.Connection, notes_dir: str, kinds: Sequence[str], playlists: Sequence[str],
                  video_ids: Sequence[str], max_videos: int, media_resolution: str, force: bool,
                  order: str = "score", today: Optional[date] = None,
                  categories: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """The plan as of now (used by --dry-run): up to max_videos (0 = all) classified videos ready for analysis,
    the unclassified candidates (in order) and skip counts."""
    items, skipped = eligible_items(conn, notes_dir, kinds, playlists, video_ids, media_resolution, force,
                                    order, today)
    unclassified: List[sqlite3.Row] = []
    if categories is not None:
        classified = classifications(conn)
        kept = []
        for item in items:
            result = classified.get(item["row"]["video_id"])
            allowed, reason = kinds_for_category(item, result, categories)
            if allowed is None:
                unclassified.append(item["row"])
                continue
            if reason:
                skipped[reason] = skipped.get(reason, 0) + 1
            if allowed:
                kept.append({**item, "kinds": allowed, "category": result["category"]})
        if unclassified:
            skipped["not classified yet"] = len(unclassified)
        items = kept
    return {"selected": items[:max_videos] if max_videos > 0 else items, "skipped": skipped, "eligible": len(items),
            "unclassified": unclassified}
