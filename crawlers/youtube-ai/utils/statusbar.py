"""A status line pinned below the output (only when writing to a terminal)."""

import io
import shutil
import sys
import threading


class StatusBar:
    def __init__(self) -> None:
        self.text = ""
        self.drawn = False  # whether the status line is on screen right now (at the start of a line)
        self.lock = threading.RLock()
        self.active = sys.stdout.isatty()
        self._mid_line = False  # ordinary output ended without a newline (the status line must wait)
        self._out, self._err = sys.stdout, sys.stderr

    def install(self) -> "StatusBar":
        if self.active:
            sys.stdout = _Stream(self, self._out)
            sys.stderr = _Stream(self, self._err)
        return self

    def update(self, text: str) -> None:
        with self.lock:
            self.text = text
            if self.drawn:  # redraw in place; if a line is half written, wait for its newline
                self._draw()
            elif not self._mid_line:
                self._draw()

    def _clear(self) -> None:
        # Only erase the status line itself: print() writes a line's text and its newline separately, and
        # clearing between the two would wipe the text that was just written.
        if self.active and self.drawn:
            self._out.write("\r\033[K")
            self._out.flush()  # before anything goes to stderr, which is unbuffered
            self.drawn = False

    def _draw(self) -> None:
        if self.active and self.text:
            width = shutil.get_terminal_size((100, 20)).columns
            self._out.write("\r\033[K\033[7m" + self.text[: width - 1] + "\033[0m")
            self._out.flush()
            self.drawn = True

    def close(self) -> None:
        with self.lock:
            self._clear()
            self.text = ""
            if self.active:
                sys.stdout, sys.stderr = self._out, self._err
            self._out.flush()


class _Stream(io.TextIOBase):
    """Writes ordinary output above the status line, then redraws the status line."""

    def __init__(self, bar: StatusBar, target) -> None:
        self.bar, self.target = bar, target

    def write(self, text: str) -> int:
        with self.bar.lock:
            self.bar._clear()
            if self.target is not self.bar._out:
                self.bar._out.flush()
            self.target.write(text)
            self.target.flush()
            if text:
                self.bar._mid_line = not text.endswith("\n")
            if not self.bar._mid_line:
                self.bar._draw()
        return len(text)

    def flush(self) -> None:
        self.target.flush()

    def isatty(self) -> bool:
        return self.target.isatty()
