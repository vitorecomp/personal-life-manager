#!/usr/bin/env python3
"""Apply pending migrations to the youtube-lists database and notes folder (run.sh does this first)."""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from migrations.runner import run  # noqa: E402
from storage.lock import RunLocked, run_lock  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    parser.add_argument("--notes-dir", required=True)
    args = parser.parse_args()
    try:
        with run_lock(args.db):
            names = run(args.db, args.notes_dir)
    except RunLocked as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    for name in names:
        print(f"  applied migration {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
