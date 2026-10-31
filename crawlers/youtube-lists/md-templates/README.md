# Note templates

These [Jinja2](https://jinja.palletsprojects.com/templates/) templates control how notes are
written. Edit them freely. This README is not a template.

| Template | Used for |
| :--- | :--- |
| `video.md` | the full note of a video |
| `video-ref.md` | the pointer note a playlist gets when another playlist owns the video's full note |
| `playlist.md` | the note of each playlist |

## When changes apply

- **Full video notes:** a note is written once, when it is created, and never overwritten, so your
  edits are safe. New videos use the new template. An existing note picks up the new template only
  when a re-check refreshes it, and only if you haven't edited it.
- **Playlist and `-ref` notes:** these are re-rendered on every run, so template changes apply to
  all of them on the next run.

To regenerate a full video note with the new template, delete it and run the sync again.

## Protected text (keep blocks)

Text between keep markers is never changed by a run:

```markdown
<!-- keep -->
My own notes. They survive every future run exactly as written.
<!-- /keep -->
```

The markers are HTML comments, so Obsidian and other Markdown previews don't show them.

- **In a generated note:** wrap your text in `<!-- keep -->` ... `<!-- /keep -->`, with each marker on
  its own line. When the note is rewritten, the block stays in the same section (under the same `##`
  heading). If that section disappears, the block moves to the end of the note.
- **In a template:** use a named block for text that should only be a default:
  `<!-- keep:my-name -->default text<!-- /keep:my-name -->`. New notes get the default. After that,
  whatever the note contains between those markers is kept. Named blocks can also sit inside a line.
  `playlist.md` uses one for the **AI Full Description** line, so setting it to `[True]` sticks.
- **Video notes:** adding or editing keep blocks doesn't count as editing the note, so a re-check can
  still refresh the rest of it. Changes outside keep blocks still make the sync leave the whole note
  alone.
- **`-ref` notes:** when a playlist takes over a video's full note, keep blocks from its old `-ref`
  note are moved into the full note.

## Rules

- **Keep the `ai-summary` flag lines.** In `playlist.md`, keep the line
  `- {{ name }}: [{{ value }}]`. The sync reads the flags back from that exact format
  (`- summary: [True]`).
- **Typos fail loudly.** Unknown fields stop the run with an error naming the template, rather
  than printing nothing.
- **Whitespace:** block tags such as `{% if %}` and `{% for %}` on their own line don't leave empty
  lines behind. When a block tag ends a line of text, write `+%}` (for example `{% endif +%}`) to
  keep the line break.

## Fields

### `video.md` and `video-ref.md`: `video`

- **Identity:** `video_id`, `url`, `title`, `note_file`.
- **Channel:** `channel`, `channel_id`, `channel_url`.
- **Counts:** `view_count`, `like_count`, `comment_count`. Use these with `| number`.
- **Dates and times:** `upload_date` (`YYYYMMDD`, use `| date`) and `duration_seconds` (use
  `| duration`).
- **Lists:** `categories` and `tags`.
- **Other metadata:** `language`, `live_status`, `age_limit`, `availability`, `thumbnail`,
  `description`.
- **`chapters`:** a list of `{start_seconds, end_seconds, title}`.
- **`comments`:** a list of `{author, text, like_count, date, timestamp, is_pinned,
  author_is_uploader}`.
- **Transcript:** `transcript` with `subtitle_lang` and `subtitle_kind` (`manual` or `auto`).
- **`unavailable_reason`:** set while the video is private or deleted.
- **Housekeeping:** `fetched_at`, `last_checked_at`, `note_playlist_id`, `note_path`.

`video-ref.md` also gets `owner` (`{title, folder}` of the playlist holding the full note) and
`full_note_link`.

### `playlist.md`

- **`playlist`:**
  - Identity and owner: `id`, `title`, `url`, `created_by_me` (1, 0 or empty; use `| yesno`),
    `owner_name`, `owner_url`.
  - Metadata: `availability`, `description`, `youtube_video_count`, `modified_date` (use
    `| date`), `view_count`, `first_seen_at`, `last_seen_at`.
- **`videos`:** a list of `{position, title, url, channel, duration_seconds, note_link}`.
  `note_link` is the relative link to the video's note, or empty when it has no note yet.
- **`ai_flags`:** the `name: value` pairs of the `ai-summary` section.

## Helpers (filters)

| Filter | Example | Result |
| :--- | :--- | :--- |
| `md` | `{{ video.title \| md }}` | escapes Markdown characters (`[ ] * _` ...) |
| `link(url)` | `{{ video.channel \| link(video.channel_url) }}` | `[text](url)`, or the escaped text when there is no URL |
| `number` | `{{ video.view_count \| number }}` | `1,234,567`, or `unknown` |
| `date` | `{{ video.upload_date \| date }}` | `2024-01-02` |
| `duration` | `{{ video.duration_seconds \| duration }}` | `1:02:05`, or empty |
| `yesno` | `{{ playlist.created_by_me \| yesno }}` | `Yes` / `No` / `Unknown` |
| `fence` | `{{ video.transcript \| fence }}` | a code block that backticks in the text cannot break |
| `blockquote(prefix)` | `{{ comment.text \| blockquote("  > ") }}` | prefixes every line |
| `timestamp_date` | `{{ comment.timestamp \| timestamp_date }}` | Unix time as `YYYY-MM-DD` |

Standard Jinja2 filters work as well (`join`, `length`, `default`, `truncate`, ...).
