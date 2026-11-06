"""Token usage and estimated cost of every Gemini call: recorded in ai_usage, totalled for this run."""

import sqlite3
import threading
from typing import Any, Callable, Dict, List, Optional

from config import BATCH_PRICE_FACTOR, DISCOUNTED_MODES, PRICES


def price_for(model: str, at: str, mode: str = "standard") -> Optional[Dict[str, float]]:
    """USD per 1M tokens for a model, tier and date (ISO), or None when unknown. Flex and batch are half of
    the standard price; "direct" is the old name of standard."""
    tables = PRICES.get(model, {})
    table = tables.get("priority" if mode == "priority" else "standard", [])
    for until, prices in table:
        if (at or "")[:10] <= until:
            factor = BATCH_PRICE_FACTOR if mode in DISCOUNTED_MODES else 1.0
            return {key: value * factor for key, value in prices.items()}
    return None


def cost_of(model: str, mode: str, at: str, prompt: int, cached: int, output: int, thinking: int) -> Optional[float]:
    prices = price_for(model, at, mode)
    if prices is None:
        return None
    return ((prompt - cached) * prices["input"] + cached * prices["cached"] + (output + thinking) * prices["output"]) / 1e6


def usage_of(response: Any) -> Dict[str, int]:
    usage = getattr(response, "usage_metadata", None)
    def get(name: str) -> int:
        return int(getattr(usage, name, 0) or 0) if usage else 0
    return {"prompt": get("prompt_token_count"), "cached": get("cached_content_token_count"),
            "output": get("candidates_token_count"), "thinking": get("thoughts_token_count")}


class CostMeter:
    """Totals for this run; every call is also stored in ai_usage. Listeners get called on each change."""

    def __init__(self, conn: sqlite3.Connection, now_fn: Callable[[], str]) -> None:
        self.conn, self.now_fn = conn, now_fn
        self.lock = threading.Lock()
        self.calls = {"notes": 0, "classify": 0}
        self.tiers: Dict[str, int] = {}  # calls per tier that actually served them
        self.tokens = {"prompt": 0, "cached": 0, "output": 0, "thinking": 0}
        self.cost = 0.0
        self.unpriced = 0
        self.activity = ""
        self.listeners: List[Callable[["CostMeter"], None]] = []

    def set_activity(self, text: str) -> None:
        """What the run is doing right now (shown at the end of the status line, e.g. while waiting)."""
        self.activity = text
        for listener in self.listeners:
            listener(self)

    def record(self, purpose: str, mode: str, model: str, usage: Dict[str, int],
               video_id: Optional[str] = None, kind: Optional[str] = None) -> None:
        at = self.now_fn()
        with self.lock:
            with self.conn:
                self.conn.execute(
                    "INSERT INTO ai_usage (at, purpose, mode, model, video_id, kind, prompt_tokens, cached_tokens, "
                    "output_tokens, thinking_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (at, purpose, mode, model, video_id, kind, usage["prompt"], usage["cached"], usage["output"],
                     usage["thinking"]),
                )
            self.calls[purpose] = self.calls.get(purpose, 0) + 1
            self.tiers[mode] = self.tiers.get(mode, 0) + 1
            for key in self.tokens:
                self.tokens[key] += usage[key]
            cost = cost_of(model, mode, at, usage["prompt"], usage["cached"], usage["output"], usage["thinking"])
            if cost is None:
                self.unpriced += 1
            else:
                self.cost += cost
        for listener in self.listeners:
            listener(self)

    def all_time(self) -> Dict[str, Any]:
        rows = self.conn.execute(
            "SELECT model, mode, at, prompt_tokens, cached_tokens, output_tokens, thinking_tokens FROM ai_usage"
        ).fetchall()
        total = {"calls": len(rows), "prompt": 0, "cached": 0, "output": 0, "cost": 0.0}
        for model, mode, at, prompt, cached, output, thinking in rows:
            total["prompt"] += prompt
            total["cached"] += cached
            total["output"] += output + thinking
            total["cost"] += cost_of(model, mode, at, prompt, cached, output, thinking) or 0.0
        return total

    def status_line(self) -> str:
        t = self.tokens
        calls = sum(self.calls.values())
        line = (f"Gemini: {calls} calls · {t['prompt']:,} in ({t['cached']:,} cached) · "
                f"{t['output'] + t['thinking']:,} out · ~${self.cost:.4f} this run")
        return f"{line} · {self.activity}" if self.activity else line

    def report(self) -> str:
        t = self.tokens
        hit = f"{t['cached'] / t['prompt']:.0%}" if t["prompt"] else "0%"
        total = self.all_time()
        lines = [
            "",
            "Gemini usage this run",
            f"  calls:          {sum(self.calls.values())} (notes {self.calls.get('notes', 0)}, "
            f"classification {self.calls.get('classify', 0)}; served as "
            + (", ".join(f"{tier} {count}" for tier, count in sorted(self.tiers.items())) or "-") + ")",
            f"  input tokens:   {t['prompt']:,}",
            f"  cached tokens:  {t['cached']:,} ({hit} of input served from cache)",
            f"  output tokens:  {t['output'] + t['thinking']:,} (thinking {t['thinking']:,})",
            f"  estimated cost: ~${self.cost:.4f}" + (f" (+{self.unpriced} calls with unknown price)" if self.unpriced else ""),
            f"All runs so far: ~${total['cost']:.4f} for {total['calls']} calls, {total['prompt']:,} input "
            f"({total['cached']:,} cached) and {total['output']:,} output tokens",
            "  (estimates from the token counts Gemini reports and the prices in config.py, at the tier that served"
            " each call; Flex and batch at half price, priority at its own price)",
        ]
        return "\n".join(lines)


_meter: Optional[CostMeter] = None


def install(meter: CostMeter) -> None:
    global _meter
    _meter = meter


def activity(text: str) -> None:
    if _meter is not None:
        _meter.set_activity(text)


def waiting_text(what: str, conn: sqlite3.Connection, purpose: str, started: float, now: float) -> str:
    state = conn.execute(
        "SELECT state FROM ai_batch WHERE finished_at IS NULL AND purpose = ? ORDER BY created_at DESC LIMIT 1",
        (purpose,),
    ).fetchone()
    elapsed = int(now - started)
    clock = f"{elapsed // 3600}h {elapsed % 3600 // 60:02d}m" if elapsed >= 3600 else f"{elapsed // 60}m {elapsed % 60:02d}s"
    label = state[0].replace("JOB_STATE_", "").lower() if state else "checking"
    return f"waiting for {what} ({label}, {clock})"


def record_tokens(purpose: str, mode: str, model: str, prompt: int, cached: int, output: int, thinking: int,
                  video_id: Optional[str] = None, kind: Optional[str] = None) -> None:
    if _meter is not None:
        _meter.record(purpose, mode, model, {"prompt": prompt or 0, "cached": cached or 0, "output": output or 0,
                                             "thinking": thinking or 0}, video_id, kind)


def record(purpose: str, mode: str, model: str, response: Any, video_id: Optional[str] = None,
           kind: Optional[str] = None) -> None:
    """Record a call's usage if a meter is installed (no-op otherwise, e.g. in --dry-run)."""
    if _meter is not None and response is not None:
        _meter.record(purpose, mode, model, usage_of(response), video_id, kind)
