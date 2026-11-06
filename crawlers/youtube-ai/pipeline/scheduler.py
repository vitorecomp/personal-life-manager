"""Producer / consumer pipeline for one run: classification feeds an analysis queue.

Videos that still need notes are taken in processing order (score by default):

- already classified ones go straight into the analysis queue (if their category allows notes);
- unclassified ones go to classification; as soon as a group is classified, the videos whose category
  allows notes join the analysis queue, so analysis starts long before classification is finished.

Flex (default) and standard modes: one pool of `--workers` threads runs both kinds of task. One worker at a time classifies the
next group (more when the analysis queue is empty) while the others analyse queued videos, so no worker
waits for classification to finish.

Batch mode: classification goes out in jobs of `--batch-size` videos; every time a classification job
finishes, the videos it made eligible go out as an analysis job right away, while the other jobs run.

`--max-videos` caps how many videos are queued for analysis this run (no limit by default). A stop request (Ctrl+C) starts
nothing new and lets running work finish.
"""

import sqlite3
import time
from collections import Counter, deque
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from typing import Any, Callable, Dict, List

from pipeline import batch, classify, direct
from pipeline.selection import eligible_items, kinds_for_category
from prompting.builder import classify_prompt_hash
from storage.state import classifications, mark_classify_submitted, record_classify_failure
from utils import costs
from utils.stopper import GracefulStop


class Pipeline:
    def __init__(self, conn: sqlite3.Connection, client: Any, args: Any, categories: Dict[str, Any],
                 now_fn: Callable[[], str], stop: GracefulStop, on_done: Callable[[str, str], None],
                 on_classified: Callable[[str, str], None]) -> None:
        self.conn, self.client, self.args, self.now = conn, client, args, now_fn
        self.categories = categories
        self.names = list(categories) if categories else []
        self.category_list = list(categories.values()) if categories else []
        self.stop, self.on_done, self.write_category = stop, on_done, on_classified
        self.classify_model = args.classify_model or args.model
        # None = no limit; --classify-only analyses nothing
        self.quota = 0 if args.classify_only else (args.max_videos if args.max_videos > 0 else None)
        self.queue: deque = deque()          # videos ready for analysis, in processing order
        self.waiting: Dict[str, Dict] = {}   # eligible videos waiting for their classification
        self.to_classify: List[sqlite3.Row] = []
        self.skipped: Counter = Counter()
        self.queued = 0
        self.stats = Counter()

    # ------------------------------------------------------------------------------------- routing

    def prepare(self) -> None:
        items, skipped = eligible_items(self.conn, self.args.notes_dir, self.args.kinds, self.args.playlist,
                                        self.args.video, self.args.media_resolution, self.args.force,
                                        self.args.order)
        self.skipped.update(skipped)
        classified = classifications(self.conn) if self.categories is not None else {}
        for item in items:
            video_id = item["row"]["video_id"]
            if self.categories is None:
                self.offer(item, item["kinds"], None)
                continue
            result = classified.get(video_id)
            kinds, reason = (None, None) if self.args.reclassify else kinds_for_category(item, result, self.categories)
            if kinds is None:
                if result is not None and result["status"] == "submitted" and not self.args.reclassify:
                    self.waiting[video_id] = item  # in a batch job of an earlier run; routed when collected
                elif self.args.classify_limit <= 0 or len(self.to_classify) < self.args.classify_limit:
                    self.to_classify.append(item["row"])
                    self.waiting[video_id] = item
                else:
                    self.skipped["not classified yet (over --classify-limit)"] += 1
                continue
            if reason:
                self.skipped[reason] += 1
            if kinds:
                self.offer(item, kinds, result["category"])
        limit = "no limit on analysis" if self.quota is None else f"max {self.quota} analysed"
        print(f"{self.queued} video(s) ready for analysis now, {len(self.to_classify)} to classify first "
              f"({limit} this run, order: {self.args.order})")
        if self.skipped:
            print(f"  {sum(self.skipped.values())} video(s) skipped so far (reasons in the report at the end)")

    def skip_report(self) -> str:
        """Skipped videos of this run by reason, most frequent first."""
        rows = Counter(self.skipped)
        if self.stats["over max"]:
            rows[f"ready, left for the next run (--max-videos {self.args.max_videos})"] = self.stats["over max"]
        if self.stats["classify failed"]:
            rows["classification failed (retried next run)"] = self.stats["classify failed"]
        if not rows:
            return "\nSkipped videos this run: none"
        width = max(len(f"{count:,}") for count in rows.values())
        lines = ["", "Skipped videos this run"]
        lines += [f"  {count:>{width},}  {reason}" for reason, count in rows.most_common()]
        lines.append(f"  {sum(rows.values()):>{width},}  total")
        return "\n".join(lines)

    def offer(self, item: Dict[str, Any], kinds: List[str], category: Any) -> None:
        """Put a video in the analysis queue if this run's --max-videos allows it."""
        if self.quota is not None and self.queued >= self.quota:
            self.stats["over max"] += 1
            return
        self.queue.append({**item, "kinds": kinds, "category": category})
        self.queued += 1
        row = item["row"]
        label = f" ({category})" if category else ""
        print(f"  queued for analysis: score {item['score']:>6}  {row['title'][:55]} [{row['video_id']}]"
              f"{label} {', '.join(kinds)}")

    def classified(self, video_id: str, category: str) -> None:
        """Called for every video as soon as it is classified: write its category, route it."""
        self.write_category(video_id, category)
        self.stats["classified"] += 1
        item = self.waiting.pop(video_id, None)
        if item is None or self.stop.requested:
            return
        result = self.conn.execute("SELECT * FROM ai_classification WHERE video_id = ?", (video_id,)).fetchone()
        kinds, reason = kinds_for_category(item, result, self.categories)
        if reason:
            self.skipped[reason] += 1
        if kinds:
            self.offer(item, kinds, result["category"])

    # --------------------------------------------------------------------------------- direct mode

    def collect_leftover_jobs(self) -> None:
        """Results of batch jobs submitted by earlier runs (in any mode, so nothing paid for is lost)."""
        if self.conn.execute("SELECT 1 FROM ai_batch WHERE finished_at IS NULL LIMIT 1").fetchone():
            batch.collect(self.client, self.conn, self.now, self.on_done)
            classify.collect_jobs(self.client, self.conn, self.names, self.now, self.classified)

    def run_direct(self) -> None:
        """Flex or standard mode: synchronous calls through one shared worker pool."""
        self.collect_leftover_jobs()
        rows = classify.apply_rules(self.conn, self.to_classify, self.now, self.classified)
        size = max(1, self.args.classify_request_size)
        chunks = deque(rows[i:i + size] for i in range(0, len(rows), size))
        workers = max(1, self.args.workers)
        executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="gemini")
        inflight: Dict[Future, tuple] = {}

        def submit_classification() -> None:
            chunk = chunks.popleft()
            video_ids = [row["video_id"] for row in chunk]
            with self.conn:
                mark_classify_submitted(self.conn, video_ids, None, self.args.mode, self.classify_model,
                                        classify_prompt_hash(), self.now())
            future = executor.submit(classify.call_classify, self.client, self.classify_model, chunk,
                                     self.category_list, self.args.mode, self.stop)
            inflight[future] = ("classify", video_ids)

        def submit_analysis() -> None:
            item = self.queue.popleft()
            video = direct.start(self.conn, item, self.args, self.now)
            future = executor.submit(direct.analyse, self.client, self.args.model, video, item["kinds"],
                                     item["resolution"], self.args, self.stop, item.get("paraphrase", ()))
            inflight[future] = ("analyse", item)

        def fill() -> None:
            while len(inflight) < workers and not self.stop.requested:
                classifying = sum(1 for kind, _ in inflight.values() if kind == "classify")
                if chunks and (classifying == 0 or not self.queue):
                    submit_classification()  # keep one producer running; more when consumers are idle
                elif self.queue:
                    submit_analysis()
                else:
                    break
            costs.activity(f"{len(inflight)} running, {len(self.queue)} queued for analysis, "
                           f"{sum(len(c) for c in chunks)} to classify" if inflight else "")

        fill()
        try:
            while inflight:
                finished, _ = wait(list(inflight), timeout=0.5, return_when=FIRST_COMPLETED)
                for future in finished:
                    kind, payload = inflight.pop(future)
                    if kind == "classify":
                        try:
                            counts = classify.store_answer(self.conn, future.result(), payload, self.names,
                                                           self.classify_model, self.args.mode, self.now(),
                                                           self.classified)
                        except Exception as exc:  # noqa: BLE001 - recorded, retried on a later run
                            record_classify_failure(self.conn, payload, f"{type(exc).__name__}: {exc}", self.now())
                            counts = {"failed": len(payload)}
                        self.stats["classify failed"] += counts.get("failed", 0)
                    else:
                        counts = direct.store(self.conn, payload, future.result(), self.args, self.now, self.on_done)
                        self.stats["results"] += counts["results"]
                        self.stats["failed"] += counts["failed"]
                fill()
        finally:
            costs.activity("")
            executor.shutdown(wait=True)

    # ---------------------------------------------------------------------------------- batch mode

    def run_batch(self) -> None:
        # results of jobs submitted by earlier runs (their classified videos join the queue)
        batch.collect(self.client, self.conn, self.now, self.on_done)
        classify.collect_jobs(self.client, self.conn, self.names, self.now, self.classified)
        rows = classify.apply_rules(self.conn, self.to_classify, self.now, self.classified)
        if rows and not self.stop.requested:
            classify.submit_jobs(self.client, self.conn, rows, self.category_list, self.classify_model,
                                 max(1, self.args.classify_request_size), max(1, self.args.batch_size), self.now)
        self.submit_queue()
        if self.args.no_wait:
            return
        started = time.monotonic()
        announced = False
        while True:
            batch.collect(self.client, self.conn, self.now, self.on_done)
            classify.collect_jobs(self.client, self.conn, self.names, self.now, self.classified)
            self.submit_queue()  # analysis jobs for videos classified just now
            open_jobs = dict(self.conn.execute(
                "SELECT purpose, COUNT(*) FROM ai_batch WHERE finished_at IS NULL GROUP BY purpose").fetchall())
            if not open_jobs and not self.queue:
                break
            if not announced:
                print(f"  waiting for batch jobs; checking every {self.args.poll_seconds}s "
                      "(Ctrl+C twice to leave them running and collect them next run)")
                announced = True
            deadline = time.monotonic() + self.args.poll_seconds
            while time.monotonic() < deadline:
                elapsed = int(time.monotonic() - started)
                costs.activity(f"waiting for {open_jobs.get('classify', 0)} classification and "
                               f"{open_jobs.get('notes', 0)} analysis job(s) ({elapsed // 60}m {elapsed % 60:02d}s)")
                time.sleep(1)
        costs.activity("")

    def submit_queue(self) -> None:
        if self.queue and not self.stop.requested:
            items = list(self.queue)
            self.queue.clear()
            batch.submit(self.client, self.conn, items, self.args, self.now(), self.stop)
