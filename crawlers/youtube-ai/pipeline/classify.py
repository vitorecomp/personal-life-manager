"""Classification building blocks (a cheap text-only call, many videos per request).

The scheduler (pipeline/scheduler.py) drives them: classified videos flow straight into analysis.
Videos without usable metadata (no channel and no description) are put in "unknown" by a local rule,
without calling Gemini.
"""

import sqlite3
from typing import Any, Callable, Dict, List, Sequence

from google.genai import types

from config import FINAL_JOB_STATES
from gemini.calls import generate, served_tier
from gemini.classification import build_classify_request, read_classification
from prompting.builder import classify_prompt_hash
from prompting.categories import Category
from storage.state import (
    fail_classify_leftovers,
    mark_classify_submitted,
    open_batches,
    record_classification,
    record_classify_failure,
    save_batch,
    submitted_in_chunk,
    update_batch,
)
from utils import costs
from utils.stopper import GracefulStop

OnClassified = Callable[[str, str], None]


def needs_no_model(row: sqlite3.Row) -> bool:
    return not row["channel"] and not (row["description"] or "").strip()


def apply_rules(conn: sqlite3.Connection, rows: List[sqlite3.Row], now_fn: Callable[[], str],
                on_classified: OnClassified) -> List[sqlite3.Row]:
    """Classify the videos a local rule can decide; return the ones that need the model."""
    to_model = []
    for row in rows:
        if needs_no_model(row):
            record_classification(conn, row["video_id"], "unknown", 1.0, "rule", None, None, now_fn())
            on_classified(row["video_id"], "unknown")
        else:
            to_model.append(row)
    return to_model


def call_classify(client: Any, model: str, rows: Sequence[sqlite3.Row], categories: List[Category], mode: str,
                  stop: GracefulStop) -> Any:
    """Worker thread: one classification request (no database access)."""
    contents, config = build_classify_request(rows, categories, "low")
    return generate(client, model, contents, config, mode, stop)


def store_answer(conn: sqlite3.Connection, response: Any, video_ids: Sequence[str], names: Sequence[str],
                 model: str, mode: str, now: str, on_classified: OnClassified) -> Dict[str, int]:
    """Main thread: record usage, store the categories found, mark missing videos failed (retried later)."""
    costs.record("classify", served_tier(response, mode), model, response)
    try:
        found = read_classification(response, video_ids, names)
    except ValueError as exc:
        record_classify_failure(conn, list(video_ids), str(exc), now)
        return {"classified": 0, "failed": len(video_ids)}
    for video_id, (category, confidence) in found.items():
        record_classification(conn, video_id, category, confidence, "model", model, classify_prompt_hash(), now)
        on_classified(video_id, category)
    missing = [v for v in video_ids if v not in found]
    if missing:
        record_classify_failure(conn, missing, "not in the classification answer", now)
    return {"classified": len(found), "failed": len(missing)}


def submit_jobs(client: Any, conn: sqlite3.Connection, rows: List[sqlite3.Row], categories: List[Category],
                model: str, request_size: int, job_size: int, now_fn: Callable[[], str]) -> List[str]:
    """Batch mode: classification jobs of up to `job_size` videos (`request_size` per request)."""
    names = []
    for start in range(0, len(rows), job_size):
        job_rows = rows[start:start + job_size]
        chunks = [job_rows[i:i + request_size] for i in range(0, len(job_rows), request_size)]
        requests, keys = [], []
        for index, chunk in enumerate(chunks):
            contents, config = build_classify_request(chunk, categories, "low")
            key = f"classify|{index}"
            requests.append(types.InlinedRequest(contents=contents, config=config, metadata={"key": key}))
            keys.append((key, [row["video_id"] for row in chunk]))
        display = f"youtube-ai classify {now_fn()[:19]} #{len(names) + 1}"
        job = client.batches.create(model=model, src=requests, config={"display_name": display})
        now = now_fn()
        with conn:
            save_batch(conn, job.name, display, model, job.state.name if job.state else "JOB_STATE_PENDING",
                       len(requests), now, purpose="classify")
            for key, video_ids in keys:
                mark_classify_submitted(conn, video_ids, job.name, key, model, classify_prompt_hash(), now)
        names.append(job.name)
        print(f"  submitted classification batch {job.name}: {len(job_rows)} videos in {len(requests)} request(s)")
    return names


def collect_jobs(client: Any, conn: sqlite3.Connection, names: Sequence[str], now_fn: Callable[[], str],
                 on_classified: OnClassified) -> Dict[str, int]:
    """Check every open classification job once and store the results of finished ones."""
    counts = {"open": 0, "classified": 0, "failed": 0}
    for batch in open_batches(conn, purpose="classify"):
        job = client.batches.get(name=batch["name"])
        state = job.state.name if job.state else "JOB_STATE_UNSPECIFIED"
        now = now_fn()
        if state not in FINAL_JOB_STATES:
            if state != batch["state"]:
                update_batch(conn, batch["name"], state, now)
            counts["open"] += 1
            continue
        for response in (job.dest.inlined_responses if job.dest and job.dest.inlined_responses else []) or []:
            key = (response.metadata or {}).get("key", "")
            video_ids = submitted_in_chunk(conn, batch["name"], key)
            if not video_ids:
                continue
            if response.error:
                record_classify_failure(conn, video_ids, f"batch error: {response.error}", now)
                counts["failed"] += len(video_ids)
                continue
            stored = store_answer(conn, response.response, video_ids, names, batch["model"], "batch", now,
                                  on_classified)
            counts["classified"] += stored["classified"]
            counts["failed"] += stored["failed"]
        error = str(job.error) if job.error else None
        counts["failed"] += fail_classify_leftovers(conn, batch["name"], f"no result from batch ({state})", now)
        update_batch(conn, batch["name"], state, now, error=error, finished=True)
        print(f"  classification batch {batch['name']} finished: {state}")
    return counts
