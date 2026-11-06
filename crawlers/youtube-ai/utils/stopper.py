"""Graceful Ctrl+C: the first press stops new Gemini calls and waits for running ones; the second quits."""

import os
import signal
import sys


class GracefulStop:
    def __init__(self) -> None:
        self.requested = False

    def install(self) -> "GracefulStop":
        signal.signal(signal.SIGINT, self._handle)
        return self

    def _handle(self, _signum, _frame) -> None:
        if self.requested:
            print("\nQuitting now. Submitted batch jobs keep running and are collected on the next run.",
                  file=sys.stderr)
            os._exit(130)
        self.requested = True
        print("\nStopping: no new Gemini calls will start; waiting for the running ones to finish. "
              "Press Ctrl+C again to quit immediately.", file=sys.stderr)
