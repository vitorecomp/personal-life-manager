"""Making one generate_content call with the run's service tier, retrying when Gemini is busy."""

import time
from typing import Any

from google.genai import errors, types

from config import RETRY_ATTEMPTS, RETRY_FIRST_WAIT_SECONDS, RETRY_MAX_WAIT_SECONDS
from utils.stopper import GracefulStop

TIERS = {"flex": types.ServiceTier.FLEX, "standard": types.ServiceTier.STANDARD, "priority": types.ServiceTier.PRIORITY}
SERVED_TIERS = ("flex", "standard", "priority")


def served_tier(response: Any, mode: str) -> str:
    """The tier that actually served a call (Gemini can serve Priority at standard when Priority capacity
    runs out, and bills it as standard); read from the x-gemini-service-tier header, else the mode asked."""
    http = getattr(response, "sdk_http_response", None)
    headers = getattr(http, "headers", None) or {}
    value = next((v for k, v in dict(headers).items() if k.lower() == "x-gemini-service-tier"), "")
    value = (value or "").strip().lower()
    return value if value in SERVED_TIERS else mode
BUSY_CODES = (429, 500, 503)


def generate(client: Any, model: str, contents: Any, config: types.GenerateContentConfig, mode: str,
             stop: GracefulStop) -> Any:
    """generate_content on the mode's tier; 429/500/503 answers are retried with growing waits (Flex runs on
    spare capacity and is refused when there is none). A stop request ends the waiting."""
    config = config.model_copy(update={"service_tier": TIERS.get(mode, types.ServiceTier.STANDARD)})
    wait = RETRY_FIRST_WAIT_SECONDS
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            return client.models.generate_content(model=model, contents=contents, config=config)
        except errors.APIError as exc:
            if getattr(exc, "code", None) not in BUSY_CODES or attempt == RETRY_ATTEMPTS:
                raise
            deadline = time.monotonic() + wait
            while time.monotonic() < deadline:
                if stop.requested:
                    raise
                time.sleep(1)
            wait = min(wait * 2, RETRY_MAX_WAIT_SECONDS)
    raise RuntimeError("unreachable")
