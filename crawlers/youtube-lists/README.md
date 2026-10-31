# YouTube Lists Crawler

Syncs all of your YouTube playlists into a SQLite database and writes an Obsidian-friendly
Markdown note for every playlist and every video. That includes private playlists, Watch Later and
Liked videos. Runs are incremental: each run only fetches what is new or due for a re-check,
and no note is ever deleted.

It uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) with the login cookies of your browser, so no
Google API key or OAuth setup is needed.

## Setup

Settings live in the project root `.env` (documented in the root `.env.example`):

| Variable | Meaning |
| :--- | :--- |
| `YOUTUBE_COOKIES_BROWSER` | Browser you are logged in to YouTube with (`chrome`, `firefox`, `chromium`, `brave`, ...) |
| `YOUTUBE_COOKIES_FILE` | Optional: a Netscape `cookies.txt` instead of a browser (takes precedence) |
| `YOUTUBE_LISTS_DB` | SQLite database path, e.g. `database/database_files/youtube-lists.sqlite` |
| `YOUTUBE_LISTS_NOTES_DIR` | Notes folder, e.g. `database/lists/youtube` |
| `YOUTUBE_MY_CHANNEL_ID` | Optional: your channel ID for "Created by me" (auto-detected otherwise) |

Relative paths are relative to the project root. An environment variable with the same name
overrides the `.env` value.

Chromium-based browsers get `+gnomekeyring` appended automatically, because yt-dlp cannot find
the cookie decryption key on desktops it doesn't recognise (such as Hyprland). Give an explicit
keyring to override it, for example `chrome+basictext`.

## Running

```bash
./crawlers/youtube-lists/run.sh                    # browser and paths from .env
./crawlers/youtube-lists/run.sh firefox            # a browser argument overrides .env
./crawlers/youtube-lists/run.sh --no-special       # extra arguments go to the Python CLI
./crawlers/youtube-lists/run.sh --details-limit 50 # cap the slow part; the rest continues next run
```

`run.sh` creates `.venv/` next to itself on the first run and installs `requirements.txt` into it.
It upgrades them on every run, which keeps yt-dlp current when YouTube changes.

The first run fetches details for every video at roughly a second or two each, so a large Watch
Later list takes a while. `--details-limit` splits that work across runs.

### Options

| Option | Meaning |
| :--- | :--- |
| `--no-special` | Skip Watch Later and Liked videos |
| `--no-details` | Only sync playlist contents; don't fetch per-video details |
| `--details-limit N` | Fetch details for at most N videos per run |
| `--comments N` | Newest comments stored per video (default 20, 0 = none) |
| `--refresh-days N` | Also re-fetch counts and comments of videos not checked for N days |
| `--detail-delay S` | Pause between video requests (default 1 second) |
| `--templates-dir DIR` | Use templates from another folder |
| `-o FILE.csv` | Also export every active playlist entry to CSV |
| `--my-channel-id ID` | Override the "Created by me" channel detection |
| `--feed-url URL` | Page that lists your playlists, in case YouTube moves it |

The exit code is 1 if any playlist or video fetch failed. Those are retried on the next run.

## Output

```
<notes dir>/
├── <Playlist>/
│   ├── <Playlist>.md                  # playlist note
│   └── videos/
│       ├── <Title> [<video id>].md     # full video note
│       └── <Title> [<video id>]-ref.md # pointer to a full note owned by another playlist
└── removed/
    └── <Playlist>/                     # notes of videos (or whole playlists) that left a playlist
```

- **Playlist note:** name, whether you created it, metadata, an `ai-summary` section with
  `summary: [False]` and `videos-ai-description: [False]` flags, and the video list linking to each
  video's note. Flags you or an AI step change are never reset by a sync.
- **Video note:** metadata (channel, upload date, duration, views, likes, comment count,
  categories, tags, language, ...), description, chapters, latest comments, and the transcript in the
  video's original language. The script uses manual subtitles when they exist and falls back to the
  auto-generated original-language track.
- **Protected text:** wrap any text in `<!-- keep -->` ... `<!-- /keep -->` and no run will change
  it. See [md-templates/README.md](md-templates/README.md#protected-text-keep-blocks).
- **One full note per video:** a video in several playlists gets its full note in one of them, the
  owner. Every other playlist gets a `-ref` note pointing to it.

## How runs stay incremental

The database is the source of truth for what exists, which playlist owns each video's note, and
where every note currently is. Each run works depth first: it handles one playlist completely,
including membership changes, video details and notes, before starting the next.

- **Never refetched:** videos that already have details. A video shared by several playlists is
  fetched once.
- **Owner loses the video:** the full note moves to another playlist that still has the video, and
  the `-ref` notes are rewritten to point there.
- **No playlist has the video:** its note moves to `removed/<playlist>/`. If it is added back
  anywhere, the note is moved back from `removed/`, not rebuilt.
- **Deleted playlist:** its own note and the notes it owned move the same way. If it comes back, its
  note returns with its `ai-summary` flags.
- **Incomplete fetches:** if YouTube returns fewer videos than it reports for a playlist, the
  missing videos are only treated as removed if they are still missing on the next run. The same
  applies to playlists missing from your account's playlist page.
- **Placeholder titles:** "[Private video]" and "[Deleted video]" never overwrite a title already
  stored.
- **Re-checks:**
  - Private or deleted videos are re-checked every 30 days, and the note shows an "Unavailable"
    banner while they are gone.
  - Videos without a transcript are re-checked daily while they are under 14 days old, because
    captions often appear late. Older ones are re-checked monthly, up to 3 checks in total.
  - The intervals are set in `config.py`.
- **Hand edits:**
  - A full note is only written when missing, so your edits are kept.
  - A re-check rewrites a note only if it still matches what the script last wrote.
  - If you rename or move a full note, it is found again by the `[video id]` in its file name and
    put back where it belongs.
- **One run at a time:** a lock file next to the database stops two runs from working on the same
  database at once.

### Database tables

| Table | One row per | Holds |
| :--- | :--- | :--- |
| `playlist` | playlist | metadata, owner, created-by-me, notes folder, removal state |
| `video` | playlist entry (a video in two playlists has two rows) | position, title, channel, removal state |
| `video_detail` | distinct video | description, counts, tags, chapters, comments, transcript, raw yt-dlp JSON, note owner and path |

Older databases are upgraded automatically when opened.

## Templates

Notes are rendered from the Jinja2 templates in `md-templates/`. Edit them to change how new notes
look. See [md-templates/README.md](md-templates/README.md) for the fields and helpers available.

## Project layout

```
crawlers/youtube-lists/
├── run.sh                 reads .env, manages .venv, runs the CLI
├── youtube-lists.py       entry point
├── requirements.txt
├── md-templates/          editable note templates
├── cli.py                 arguments; starts a run under the lock
├── config.py              constants and re-check intervals
├── pipeline/              run.py (depth-first run), details.py (video details, re-checks)
├── youtube/               client.py (yt-dlp), subtitles.py
├── storage/               schema.py, playlists.py, videos.py, lock.py
├── notes/                 templates.py, render.py, writer.py, reconcile.py, keep.py, paths.py
├── exports/               csv_export.py
└── utils/                 text.py
```

Modules import each other by their top-level names (`from storage.schema import open_db`), resolved from
this folder. The entry point puts the folder on `sys.path`, so run the crawler through `run.sh` or
`youtube-lists.py`.
