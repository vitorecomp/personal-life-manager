"""Credentials that may appear in AI notes (Gemini transcribes on-screen text, e.g. a tutorial showing its
API key) are replaced before a note is written, so they never reach git or GitHub."""

import re
from typing import Tuple

PATTERNS = [
    ("Google API key", re.compile(r"(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])")),
    ("AWS access key", re.compile(r"(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])")),
    ("API key", re.compile(r"(?<![A-Za-z0-9-])sk-(?:proj-|ant-)?[A-Za-z0-9_]{20,}[A-Za-z0-9_-]*")),
    ("GitHub token", re.compile(r"(?<![A-Za-z0-9])(?:gh[pousr]_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{40,})")),
    ("Slack token", re.compile(r"(?<![A-Za-z0-9])xox[baprs]-[0-9A-Za-z-]{10,}")),
    ("private key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)")),
]


def redact(text: str) -> Tuple[str, int]:
    """Replace credential-looking strings; returns (text, how many were replaced)."""
    count = 0
    for label, pattern in PATTERNS:
        text, n = pattern.subn(f"[redacted {label}]", text)
        count += n
    return text, count
