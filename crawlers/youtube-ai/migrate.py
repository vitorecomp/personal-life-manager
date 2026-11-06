#!/usr/bin/env python3
"""Apply pending youtube-ai migrations to the shared database (run.sh does this first)."""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from storage.lock import RunLocked, run_lock  # noqa: E402
from migrations.runner import run  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    args = parser.parse_args()
    if not os.path.exists(args.db):
        print(f"error: {args.db} does not exist; run the youtube-lists crawler first", file=sys.stderr)
        return 1
    try:
        with run_lock(args.db):
            names = run(args.db)
    except RunLocked as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    for name in names:
        print(f"  applied migration {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
