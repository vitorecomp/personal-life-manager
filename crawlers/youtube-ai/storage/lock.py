"""Refuse to run twice at once against the same database."""

import fcntl
from contextlib import contextmanager
from typing import Iterator


class RunLocked(RuntimeError):
    pass


@contextmanager
def run_lock(db_path: str) -> Iterator[None]:
    lock_path = f"{db_path}.ai.lock"
    with open(lock_path, "w") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RunLocked(f"another youtube-ai run is already using {db_path}") from None
        yield
