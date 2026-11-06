# Prompts

The prompts sent to Gemini for every video. Edit them freely; changes apply to the next videos
processed (existing AI notes are not regenerated unless you run with `--force`).

| File | Role | Sent in |
| :--- | :--- | :--- |
| `system.md` | system instruction: who the model is and the writing rules | both calls |
| `context.md` | the video's metadata, chapters, description and caption track | both calls |
| `knowledge.md` | the task for `<video>-ai-knowledge.md` | knowledge call |
| `visual-description.md` | the task for `<video>-ai-visual-description.md` | visual call |
| `categories.md` | the categories and their action (`full`, `knowledge`, `skip`) | classification |
| `classify.md` | the classification instructions (gets the categories as `categories`) | classification |
| `no-verbatim.md` | added to the task when Gemini blocked an answer for copying existing text (code, slides, narration) word for word | retries after a RECITATION block |

`categories.md` is a table the code reads. Keep its three columns (Category, Action, Description), use
lowercase kebab-case names, and keep the `unknown` row. A malformed row stops the run with an error
naming the line.

## Keep caching working

Each video gets two requests built in the same order: system instruction, then the video, then
`context.md`, then the task. Gemini caches identical prompt prefixes, so the second request reuses the
video and everything before the task at about a tenth of the input price. That only works if
`system.md` and `context.md` are identical for both calls, so put anything specific to one output in
`knowledge.md` or `visual-description.md`, never in the shared files.

## Template syntax

The files are [Jinja2](https://jinja.palletsprojects.com/templates/) templates. Available fields, all
under `video`:

- **Basics:** `title`, `channel`, `url`, `video_id`, `language`.
- **Dates and length:** `upload_date` (as `YYYY-MM-DD`), `duration` (as `H:MM:SS`), `duration_seconds`.
- **Text:** `description` and `tags` (a list).
- **`chapters`:** a list of `{start, title}`, with `start` formatted as `MM:SS`.
- **Captions:** `transcript` with `subtitle_lang` and `subtitle_kind` (`manual` or `auto`).

`transcript` is empty when the video has no captions in its original language, or when transcripts
are turned off (`--no-transcript`). An unknown field stops the run with an error naming the file.
