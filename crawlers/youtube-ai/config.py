"""Shared constants and tuning knobs."""

DEFAULT_MODEL = "gemini-3.8-flash"
MAX_OUTPUT_TOKENS = 65536          # the model's output limit; thinking tokens count against it too
INPUT_TOKEN_LIMIT = 1_048_576

# Video tokens per second of a YouTube video, measured with gemini-3.8-flash: ~91 at every media resolution
# (YouTube URLs ignore media_resolution), rounded up for the estimates and the length limit below.
TOKENS_PER_SECOND = {"high": 95, "low": 95}
VIDEO_TOKEN_BUDGET = 850_000       # leave room for the system prompt, context, task and transcript

# kind -> (prompt file, suffix of the note written next to the video note)
KINDS = {
    "knowledge": ("knowledge.md", "-ai-knowledge"),
    "visual": ("visual-description.md", "-ai-visual-description"),
}

TRANSCRIPT_MAX_CHARS = 300_000     # longer caption tracks are cut (the video's audio is still analysed)
INLINE_BATCH_MAX_BYTES = 15_000_000  # inline batch requests are limited to 20 MB per job
MAX_ATTEMPTS = 3                   # failed notes are retried on later runs up to this many times
POLL_SECONDS = 30
FINAL_JOB_STATES = {
    "JOB_STATE_SUCCEEDED", "JOB_STATE_PARTIALLY_SUCCEEDED", "JOB_STATE_FAILED",
    "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED",
}
SKIP_LIVE_STATUS = {"is_live", "is_upcoming"}

# Processing order: videos with the highest score are analysed first (`--order score`, the default).
#   score = views // SCORE_VIEWS_PER_POINT + comments // SCORE_COMMENTS_PER_POINT
#           - SCORE_PENALTY_PER_MONTH * full months since upload
# Unknown views, comments or upload date count as 0.
SCORE_VIEWS_PER_POINT = 1000
SCORE_COMMENTS_PER_POINT = 100
SCORE_PENALTY_PER_MONTH = 10

# Per-playlist switch, read from the top section of each playlist note (before its first "## " heading):
#   - **AI Video Description:** [False]   -> the playlist's videos get no AI notes
# A missing line or [True] means AI is allowed. A video in several playlists is processed when at least
# one of them allows AI.
PLAYLIST_AI_SWITCH = "AI Video Description"

# Classification (a cheap text-only call before analysis; categories and actions in prompts/categories.md)
CLASSIFY_VIDEOS_PER_REQUEST = 50     # default videos per classification request (--classify-request-size)
CLASSIFY_MIN_CONFIDENCE = 0.6        # below this a "full" category is downgraded to "knowledge"
CLASSIFY_MAX_OUTPUT_TOKENS = 8192
CLASSIFY_DESCRIPTION_CHARS = 800     # how much of the description / captions each video contributes
CLASSIFY_TRANSCRIPT_CHARS = 1200
CLASSIFY_LIMIT = 0                   # videos classified per run at most, in score order (0 = no limit)
ACTION_KINDS = {"full": ("knowledge", "visual"), "knowledge": ("knowledge",), "skip": ()}

# Gemini prices in USD per 1M tokens, used for the cost estimates (https://ai.google.dev/gemini-api/docs/pricing).
# Each entry applies until its date (inclusive); thinking tokens are billed as output. Flex and batch cost
# half of "standard"; "priority" has its own prices (its cached price isn't published: assumed 1.8x too).
PRICES = {
    "gemini-3.8-flash": {
        "standard": [
            ("2026-12-31", {"input": 0.75, "cached": 0.075, "output": 3.75}),
            ("9999-12-31", {"input": 1.50, "cached": 0.15, "output": 7.50}),
        ],
        "priority": [
            ("2026-12-31", {"input": 1.35, "cached": 0.135, "output": 6.75}),
            ("9999-12-31", {"input": 2.70, "cached": 0.27, "output": 13.50}),
        ],
    },
}
BATCH_PRICE_FACTOR = 0.5

# Batch mode: videos per batch job, for classification and for analysis (`--batch-size`). Smaller jobs
# finish sooner, so classified videos flow into analysis earlier; larger jobs mean fewer jobs.
BATCH_SIZE = 50

# Flex (the default mode): half-price synchronous calls on spare capacity. They can take minutes and are
# refused with 429/503 when capacity runs out, so they are retried with growing waits.
# A call returns nothing until the whole answer is generated; with Flex that includes the time queued for
# spare capacity (1-15 min) plus generating a long note (minutes), so the wait must be generous (--timeout).
HTTP_TIMEOUT_SECONDS = 3600
RETRY_ATTEMPTS = 6                  # tries per call on 429/503 (Flex and standard)
RETRY_FIRST_WAIT_SECONDS = 30       # then doubled each time, up to RETRY_MAX_WAIT_SECONDS
RETRY_MAX_WAIT_SECONDS = 300
DISCOUNTED_MODES = ("batch", "flex")
