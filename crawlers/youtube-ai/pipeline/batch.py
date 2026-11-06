"""Batch-mode analysis building blocks (half price, results within 24 hours), driven by
pipeline/scheduler.py.

Both requests of a video are placed next to each other in the same job, so Gemini can serve the second
from its implicit cache. Jobs are saved in the database as soon as they are created: if the run stops,
the next run collects their results instead of paying again.
"""

import sqlite3
from typing import Any, Callable, Dict, List

from google.genai import types

from config import FINAL_JOB_STATES, INLINE_BATCH_MAX_BYTES
from gemini.request import build_request
from gemini.response import read_response
from prompting.builder import prompt_hash, video_context
from storage.state import fail_leftovers, mark_submitted, open_batches, record_failure, record_result, save_batch, update_batch
from utils import costs
from utils.stopper import GracefulStop


def submit(client: Any, conn: sqlite3.Connection, items: List[Dict[str, Any]], args: Any, now: str,
           stop: GracefulStop) -> List[str]:
    """Create batch jobs (up to --batch-size videos each) for these videos; returns the job names."""
    chunks: List[List[tuple]] = [[]]
    size = 0
    for item in items:
        video = video_context(item["row"], include_transcript=not args.no_transcript)
        for kind in item["kinds"]:
            paraphrase = kind in item.get("paraphrase", ())
            contents, config, chars = build_request(video, kind, item["resolution"], args.thinking_level,
                                                    args.max_output_tokens, paraphrase)
            videos_in_chunk = len({entry[0] for entry in chunks[-1]})
            full = size + chars * 2 > INLINE_BATCH_MAX_BYTES or videos_in_chunk >= args.batch_size
            if chunks[-1] and full and kind == item["kinds"][0]:
                chunks.append([])
                size = 0
            request = types.InlinedRequest(contents=contents, config=config,
                                           metadata={"key": f"{video['video_id']}|{kind}"})
            chunks[-1].append((video["video_id"], kind, item["resolution"], request, paraphrase))
            size += chars * 2  # rough bytes in JSON

    names = []
    for index, chunk in enumerate(c for c in chunks if c):
        if stop.requested:
            print("  not submitting the remaining batches (stop requested)")
            break
        display = f"youtube-ai {now[:19]} #{index + 1}"
        job = client.batches.create(model=args.model, src=[entry[3] for entry in chunk], config={"display_name": display})
        with conn:
            save_batch(conn, job.name, display, args.model, job.state.name if job.state else "JOB_STATE_PENDING",
                       len(chunk), now)
            for video_id, kind, resolution, _request, paraphrase in chunk:
                mark_submitted(conn, video_id, kind, "batch", job.name, args.model, resolution,
                               prompt_hash(kind, paraphrase), now, paraphrase)
        names.append(job.name)
        print(f"  submitted batch {job.name}: {len(chunk)} requests ({len({c[0] for c in chunk})} videos)")
    return names


def collect(client: Any, conn: sqlite3.Connection, now_fn: Callable[[], str],
            on_done: Callable[[str, str], None]) -> Dict[str, int]:
    """Check every open batch once; store the results of finished ones. Returns counts of this pass."""
    counts = {"open": 0, "finished": 0, "results": 0, "failed": 0}
    for batch in open_batches(conn):
        job = client.batches.get(name=batch["name"])
        state = job.state.name if job.state else "JOB_STATE_UNSPECIFIED"
        now = now_fn()
        if state not in FINAL_JOB_STATES:
            if state != batch["state"]:
                update_batch(conn, batch["name"], state, now)
                print(f"  batch {batch['name']}: {state}")
            counts["open"] += 1
            continue
        responses = (job.dest.inlined_responses if job.dest and job.dest.inlined_responses else []) or []
        for response in responses:
            key = (response.metadata or {}).get("key", "")
            if "|" not in key:
                continue
            video_id, kind = key.split("|", 1)
            costs.record("notes", "batch", batch["model"], response.response, video_id, kind)
            if response.error:
                record_failure(conn, video_id, kind, f"batch error: {response.error}", now)
                counts["failed"] += 1
                continue
            try:
                record_result(conn, video_id, kind, read_response(response.response), now)
            except ValueError as exc:
                record_failure(conn, video_id, kind, str(exc), now)
                counts["failed"] += 1
                continue
            counts["results"] += 1
            on_done(video_id, kind)
        error = str(job.error) if job.error else None
        counts["failed"] += fail_leftovers(conn, batch["name"], f"no result from batch ({state}{': ' + error if error else ''})", now)
        update_batch(conn, batch["name"], state, now, error=error, finished=True)
        counts["finished"] += 1
        print(f"  batch {batch['name']} finished: {state}")
    return counts
