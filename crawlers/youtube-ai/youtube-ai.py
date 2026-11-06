#!/usr/bin/env python3
"""
youtube-ai: generate two AI notes per YouTube video with Gemini, next to the notes written by the
youtube-lists crawler:

    <title>-ai-knowledge.md            everything the video teaches
    <title>-ai-visual-description.md   everything the video shows

Videos come from the youtube-lists database; progress is stored in its ai_* tables. Prompts live in
prompts/. See README.md.

Code lives in the modules next to this file:
    cli.py                  arguments and the run
    config.py               constants
    pipeline/scheduler.py   producer/consumer run: classification feeds analysis
    pipeline/selection.py   which videos need notes
    pipeline/batch.py       batch jobs: submit, poll, collect
    pipeline/direct.py      synchronous calls (Flex or standard), several at a time
    gemini/calls.py         service tier (Flex) and retries when Gemini is busy
    gemini/request.py       request building (cache-friendly order), media resolution
    gemini/response.py      reading answers (text without thinking, token usage)
    prompting/builder.py    prompts/ (Jinja2) and per-video template data
    notes/writer.py         writing the notes
    storage/state.py        ai_note / ai_batch tables
    storage/lock.py         one run at a time
    utils/stopper.py        graceful Ctrl+C
    migrate.py, migrations/ database migrations (run.sh applies them first)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
