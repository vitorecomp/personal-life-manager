"""Analysis building blocks for synchronous calls (Flex or standard tier), driven by pipeline/scheduler.py.

A worker handles one video and makes its two calls back to back, so the second can hit Gemini's
implicit cache while it is fresh. A stop request lets the running call finish but starts no new one.
"""

import sqlite3
from typing import Any, Callable, Dict, List, Sequence, Tuple

from gemini.calls import generate, served_tier
from gemini.request import build_request
from gemini.response import Blocked, read_response
from prompting.builder import prompt_hash, video_context
from storage.state import mark_submitted, record_failure, record_result, restore, snapshot
from utils import costs
from utils.costs import usage_of
from utils.stopper import GracefulStop


def start(conn: sqlite3.Connection, item: Dict[str, Any], args: Any, now_fn: Callable[[], str]) -> Dict[str, Any]:
    """Main thread: mark the video's notes as submitted (remembering their previous state)."""
    video = video_context(item["row"], include_transcript=not args.no_transcript)
    item["previous"] = {kind: snapshot(conn, video["video_id"], kind) for kind in item["kinds"]}
    with conn:
        for kind in item["kinds"]:
            paraphrase = kind in item.get("paraphrase", ())
            mark_submitted(conn, video["video_id"], kind, args.mode, None, args.model, item["resolution"],
                           prompt_hash(kind, paraphrase), now_fn(), paraphrase)
    return video


def analyse(client: Any, model: str, video: Dict[str, Any], kinds: List[str], resolution: str, args: Any,
            stop: GracefulStop, paraphrase_kinds: Sequence[str] = ()) -> List[Tuple[str, Dict[str, Any], str]]:
    """Worker thread: call Gemini for each kind of one video. No database access here.

    An answer blocked for copying existing text verbatim (finish reason RECITATION) is retried once at once
    with prompts/no-verbatim.md. Usage of blocked answers is returned too ("blocked_usage"), so it can be
    counted in the cost report.
    """
    results = []
    for kind in kinds:
        if stop.requested:
            break
        paraphrase = kind in paraphrase_kinds
        blocked_usage: List[Tuple[Dict[str, int], str]] = []
        while True:
            try:
                contents, config, _chars = build_request(video, kind, resolution, args.thinking_level,
                                                         args.max_output_tokens, paraphrase)
                response = generate(client, model, contents, config, args.mode, stop)
            except Exception as exc:  # noqa: BLE001 - any API failure is recorded and retried on a later run
                message = f"{type(exc).__name__}: {exc}"
                if "timeout" in type(exc).__name__.lower() or "timed out" in str(exc).lower():
                    message += f" (no answer within --timeout {args.timeout}s; retried next run)"
                results.append((kind, {"blocked_usage": blocked_usage}, message))
                break
            tier = served_tier(response, args.mode)
            try:
                result = read_response(response)
            except Blocked as exc:
                blocked_usage.append((usage_of(response), tier))
                if exc.finish_reason == "RECITATION" and not paraphrase and not stop.requested:
                    paraphrase = True  # try again, describing code and text instead of copying it
                    continue
                results.append((kind, {"blocked_usage": blocked_usage}, f"{type(exc).__name__}: {exc}"))
                break
            except ValueError as exc:
                blocked_usage.append((usage_of(response), tier))
                results.append((kind, {"blocked_usage": blocked_usage}, f"{type(exc).__name__}: {exc}"))
                break
            results.append((kind, {**result, "tier": tier, "paraphrased": int(paraphrase),
                                   "blocked_usage": blocked_usage}, ""))
            break
    return results


def store(conn: sqlite3.Connection, item: Dict[str, Any], results: List[Tuple[str, Dict[str, Any], str]],
          args: Any, now_fn: Callable[[], str], on_done: Callable[[str, str], None]) -> Dict[str, int]:
    """Main thread: store one video's results, write its notes, undo calls that never started."""
    counts = {"results": 0, "failed": 0}
    video_id, title = item["row"]["video_id"], item["row"]["title"][:60]
    done_kinds = set()
    for kind, result, error in results:
        done_kinds.add(kind)
        for usage, tier in result.get("blocked_usage", []):  # answers Gemini blocked still cost
            costs.record_tokens("notes", tier, args.model, usage["prompt"], usage["cached"], usage["output"],
                                usage["thinking"], video_id, kind)
        if error:
            record_failure(conn, video_id, kind, error, now_fn())
            counts["failed"] += 1
            print(f"  {title}: {kind} failed ({error[:120]})")
            continue
        tier = result.get("tier", args.mode)
        costs.record_tokens("notes", tier, args.model, result["prompt_tokens"], result["cached_tokens"],
                            result["output_tokens"], result["thinking_tokens"], video_id, kind)
        record_result(conn, video_id, kind, result, now_fn())
        counts["results"] += 1
        served = f", served as {tier}" if tier != args.mode else ""
        if result.get("paraphrased") and (result.get("blocked_usage") or kind in item.get("paraphrase", ())):
            served += ", code/text summarised (verbatim copy blocked)"
        print(f"  {title}: {kind} done ({result['output_tokens']} output tokens, "
              f"{result['cached_tokens'] or 0} cached input tokens{served})")
        on_done(video_id, kind)
    for kind in set(item["kinds"]) - done_kinds:  # not started because of a stop request
        restore(conn, video_id, kind, item["previous"][kind])
    return counts
