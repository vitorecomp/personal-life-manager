"""Command line interface: choose videos, call Gemini (batch or direct) and write the AI notes."""

import argparse
import os
import sys
from datetime import datetime, timezone
from typing import List, Optional

from config import BATCH_SIZE, CLASSIFY_LIMIT, HTTP_TIMEOUT_SECONDS, CLASSIFY_VIDEOS_PER_REQUEST, DEFAULT_MODEL, KINDS, MAX_OUTPUT_TOKENS, POLL_SECONDS
from gemini.request import build_request, estimate_input_tokens
from storage.lock import RunLocked, run_lock
from notes.front_matter import write_category
from notes.writer import write_note
from prompting.builder import PromptError, configure, prompts_dir, video_context
from prompting.categories import CategoriesError, load_categories
from pipeline.selection import select_videos
from storage.state import open_state, set_output_file, unwritten_notes
from utils import costs
from utils.costs import CostMeter, price_for
from utils.stopper import GracefulStop
from utils.statusbar import StatusBar


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    def env(name: str, default: str) -> str:
        return os.environ.get(name) or default

    parser = argparse.ArgumentParser(description="Generate AI knowledge and visual-description notes for YouTube videos with Gemini.")
    parser.add_argument("--db", required=True, help="The youtube-lists SQLite database.")
    parser.add_argument("--notes-dir", required=True, help="The youtube-lists notes folder.")
    parser.add_argument("--mode", choices=("flex", "standard", "priority", "batch", "direct"),
                        default=env("YOUTUBE_AI_MODE", "flex"),
                        help="flex: half price, each call takes minutes (default). standard (or direct): full price, "
                             "answers in seconds. priority: 1.8x standard, fastest and most reliable. batch: half "
                             "price, asynchronous jobs (up to 24h).")
    parser.add_argument("--max-videos", type=int, default=int(env("YOUTUBE_AI_MAX_VIDEOS", "0")),
                        help="Analyse at most this many videos in this run (default: no limit; 0 also means no limit).")
    parser.add_argument("--workers", type=int, default=int(env("YOUTUBE_AI_WORKERS", "4")),
                        help="Flex/standard/priority: calls running at the same time (default 4).")
    parser.add_argument("--order", choices=("score", "playlist"), default="score",
                        help="score: highest score first (views, comments, age; see config.py). playlist: playlist order.")
    parser.add_argument("--playlist", action="append", default=[], help="Only videos in this playlist (title or folder). Repeatable.")
    parser.add_argument("--video", action="append", default=[], help="Only this video id. Repeatable.")
    parser.add_argument("--kinds", default=",".join(KINDS), help=f"Which notes to make (default: {','.join(KINDS)}).")
    parser.add_argument("--model", default=env("YOUTUBE_AI_MODEL", DEFAULT_MODEL), help=f"Gemini model (default {DEFAULT_MODEL}).")
    parser.add_argument("--media-resolution", choices=("auto", "high", "low"), default="auto",
                        help="Video detail; auto = high when the video fits, else low (default auto).")
    parser.add_argument("--thinking-level", choices=("low", "medium", "high"), default="low",
                        help="Model thinking (counts against the output limit; default low).")
    parser.add_argument("--max-output-tokens", type=int, default=MAX_OUTPUT_TOKENS, help="Default: the model maximum.")
    parser.add_argument("--no-transcript", action="store_true", help="Don't send the caption track as context.")
    parser.add_argument("--prompts-dir", help="Folder with the prompts (default: prompts/ next to this script).")
    parser.add_argument("--force", action="store_true", help="Regenerate notes that already exist (old files are kept, renamed).")
    parser.add_argument("--no-wait", action="store_true", help="Batch mode: submit and exit; collect on the next run.")
    parser.add_argument("--poll-seconds", type=int, default=POLL_SECONDS, help="Batch mode: how often to check jobs.")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be sent, without calling Gemini.")
    parser.add_argument("--no-classify", action="store_true",
                        help="Skip classification: analyse every selected video fully.")
    parser.add_argument("--classify-only", action="store_true", help="Only classify videos; don't analyse any.")
    parser.add_argument("--reclassify", action="store_true",
                        help="Classify the candidate videos again (e.g. after editing prompts/categories.md).")
    parser.add_argument("--classify-limit", type=int, default=CLASSIFY_LIMIT,
                        help="Classify at most this many videos per run, highest score first "
                             "(default: no limit; 0 also means no limit).")
    parser.add_argument("--timeout", type=int, default=int(env("YOUTUBE_AI_TIMEOUT", str(HTTP_TIMEOUT_SECONDS))),
                        help=f"Seconds to wait for one Gemini answer (default {HTTP_TIMEOUT_SECONDS}; Flex answers "
                             "include queue time and can take long for long notes).")
    parser.add_argument("--batch-size", type=int, default=int(env("YOUTUBE_AI_BATCH_SIZE", str(BATCH_SIZE))),
                        help=f"Batch mode: videos per batch job, for classification and analysis (default {BATCH_SIZE}).")
    parser.add_argument("--classify-request-size", type=int, default=CLASSIFY_VIDEOS_PER_REQUEST,
                        help=f"Videos classified per request (default {CLASSIFY_VIDEOS_PER_REQUEST}).")
    parser.add_argument("--classify-model", default=env("YOUTUBE_AI_CLASSIFY_MODEL", ""),
                        help="Model for classification (default: same as --model).")
    args = parser.parse_args(argv)
    if args.mode == "direct":
        args.mode = "standard"
    args.kinds = [k.strip() for k in args.kinds.split(",") if k.strip()]
    unknown = [k for k in args.kinds if k not in KINDS]
    if unknown:
        parser.error(f"unknown kind(s): {', '.join(unknown)}; choose from {', '.join(KINDS)}")
    return args


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def print_plan(selection: dict, args: argparse.Namespace) -> None:
    selected = selection["selected"]
    eligible = selection.get("eligible", len(selected))
    limit = f"max {args.max_videos}" if args.max_videos > 0 else "no limit"
    print(f"{len(selected)} video(s) selected ({limit}, {eligible} need notes, order: {args.order}), "
          f"mode: {args.mode}, model: {args.model}")
    for reason, count in selection["skipped"].items():
        print(f"  skipped {count}: {reason}")
    total = 0
    for item in selected:
        row = item["row"]
        video = video_context(item["row"], include_transcript=not args.no_transcript)
        chars = build_request(video, item["kinds"][0], item["resolution"], args.thinking_level, args.max_output_tokens)[2]
        tokens = estimate_input_tokens(row["duration_seconds"], item["resolution"], chars)
        total += tokens * len(item["kinds"])
        category = f" ({item['category']})" if item.get("category") else ""
        print(f"  - score {item['score']:>6}  {row['title'][:55]} [{row['video_id']}]{category} {', '.join(item['kinds'])}; "
              f"{item['resolution']} resolution, ~{tokens:,} input tokens per call")
    if selected:
        calls = sum(len(item["kinds"]) for item in selected)
        prices = price_for(args.model, now(), args.mode)
        cost = ""
        if prices:
            input_cost = total * prices["input"] / 1e6
            output_max = calls * args.max_output_tokens * prices["output"] / 1e6
            cost = f"; ~${input_cost:.2f} input + up to ${output_max:.2f} output (usually far less)"
        print(f"  ~{total:,} input tokens in total before caching; up to {args.max_output_tokens:,} output tokens per call{cost}")


def print_classification_summary(conn, categories) -> None:
    counts = {r[0]: r[1] for r in conn.execute(
        "SELECT category, COUNT(*) FROM ai_classification WHERE status = 'done' GROUP BY category")}
    if counts:
        parts = [f"{name} {counts[name]} ({categories[name].action})" for name in categories if name in counts]
        print("Classified so far: " + ", ".join(parts))


def run(args: argparse.Namespace) -> int:
    conn = open_state(args.db)
    stats = {"written": 0, "categories": 0}
    categories = None if args.no_classify else load_categories(prompts_dir())
    names = list(categories) if categories else []

    def select(**overrides):
        options = dict(categories=categories)
        options.update(overrides)
        return select_videos(conn, args.notes_dir, args.kinds, args.playlist, args.video, args.max_videos,
                             args.media_resolution, args.force, args.order, **options)

    def to_classify() -> list:
        """For --dry-run: the videos a run would classify (not counting ones waiting in open jobs)."""
        if categories is None:
            return []
        if args.reclassify:
            pool = select_videos(conn, args.notes_dir, args.kinds, args.playlist, args.video, 10**9,
                                 args.media_resolution, args.force, args.order)["selected"]
            rows = [item["row"] for item in pool]
        else:
            submitted = {r[0] for r in conn.execute("SELECT video_id FROM ai_classification WHERE status = 'submitted'")}
            rows = [row for row in select()["unclassified"] if row["video_id"] not in submitted]
        return rows[: args.classify_limit] if args.classify_limit > 0 else rows

    def on_done(video_id: str, kind: str) -> None:
        path = write_note(conn, args.notes_dir, video_id, kind, args.force)
        if path:
            set_output_file(conn, video_id, kind, path)
            stats["written"] += 1

    def on_classified(video_id: str, category: str) -> None:
        if write_category(conn, args.notes_dir, video_id, category):
            stats["categories"] += 1

    for row in unwritten_notes(conn):  # finished earlier while the video's folder was unavailable
        on_done(row["video_id"], row["kind"])

    if args.dry_run:
        if categories is not None:
            print_classification_summary(conn, categories)
            pending = to_classify()
            if pending:
                print(f"Would classify {len(pending)} video(s) first (text only, about "
                      f"{-(-len(pending) // max(1, args.classify_request_size))} request(s)).")
        print_plan(select(), args)
        return 0

    from google import genai  # imported late so --dry-run works without credentials

    from google.genai import types

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"],
                          http_options=types.HttpOptions(timeout=args.timeout * 1000))
    stop = GracefulStop().install()
    meter = CostMeter(conn, now)
    costs.install(meter)
    bar = StatusBar().install()
    meter.listeners.append(lambda m: bar.update(m.status_line()))
    bar.update(meter.status_line())
    try:
        return _run_calls(args, conn, client, stop, meter, categories, names, select, to_classify, on_done,
                          on_classified, stats)
    finally:
        bar.close()
        print(meter.report())


def _run_calls(args, conn, client, stop, meter, categories, names, select, to_classify, on_done, on_classified,
               stats) -> int:
    before = {(r[0], r[1]): r[2] for r in conn.execute("SELECT video_id, kind, completed_at FROM ai_note")}

    from pipeline.scheduler import Pipeline

    pipeline = Pipeline(conn, client, args, categories, now, stop, on_done, on_classified)
    pipeline.prepare()
    if args.mode == "batch":
        pipeline.run_batch()
    else:
        pipeline.run_direct()
    if categories is not None:
        print_classification_summary(conn, categories)
    print(pipeline.skip_report())

    # calls that finished during this run = rows whose completion changed since the start
    changed = [r for r in conn.execute("SELECT * FROM ai_note WHERE completed_at IS NOT NULL")
               if before.get((r["video_id"], r["kind"])) != r["completed_at"]]
    done_rows = [r for r in changed if r["status"] == "done"]
    finished, failed = len(changed), len(changed) - len(done_rows)
    waiting = conn.execute("SELECT COUNT(*) FROM ai_note WHERE status = 'submitted'").fetchone()[0]
    if stats["categories"]:
        print(f"Categories written to {stats['categories']} video note(s)")
    print(f"\nAI notes written: {stats['written']}; finished calls: {finished - failed}, failed: {failed} "
          f"(retried next run), still in batch jobs: {waiting}")
    return 1 if failed else 0


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    if not args.dry_run and not os.environ.get("GEMINI_API_KEY"):
        print("error: GEMINI_API_KEY is not set (add it to the project root .env)", file=sys.stderr)
        return 1
    try:
        configure(args.prompts_dir)
        with run_lock(args.db):
            return run(args)
    except (RunLocked, PromptError, CategoriesError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
