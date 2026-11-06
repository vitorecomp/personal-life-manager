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

The first run fetches details for every video. Each takes several seconds, and 4 are fetched at a
time by default, so a large Watch Later list still takes a while. `--details-limit` splits that work
across runs. Each video's note is written as soon as its details arrive, and the playlist note when
the playlist starts.

### Unavailable videos report

```bash
./crawlers/youtube-lists/unavailable-report.py          # deleted, private... videos per playlist
./crawlers/youtube-lists/unavailable-report.py --all    # include playlists without any
```

Prints a table per playlist (deleted or removed, private, not re-checked yet) from the database,
without changing anything. It finds the database through `YOUTUBE_LISTS_DB` in `.env`, or through
`--db`.

### Options

| Option | Meaning |
| :--- | :--- |
| `--no-special` | Skip Watch Later and Liked videos |
| `--no-details` | Only sync playlist contents; don't fetch per-video details |
| `--details-limit N` | Fetch details for at most N videos per run |
| `--comments N` | Newest comments stored per video (default 20, 0 = none) |
| `--refresh-days N` | Also re-fetch counts and comments of videos not checked for N days |
| `--workers N` | Videos fetched at the same time (default 4; `YOUTUBE_LISTS_WORKERS` in `.env`) |
| `--listing-workers N` | Playlists listed at the same time, ahead of the video workers (default 3) |
| `--detail-delay S` | Pause each worker takes after a video request (default 1 second) |
| `--templates-dir DIR` | Use templates from another folder |
| `-o FILE.csv` | Also export every active playlist entry to CSV |
| `--my-channel-id ID` | Override the "Created by me" channel detection |
| `--feed-url URL` | Page that lists your playlists, in case YouTube moves it |

The exit code is 1 if any playlist or video fetch failed. Those are retried on the next run.

## Output

```
<notes dir>/
├── <playlist>/
│   ├── <playlist>.md                       # playlist note
│   └── videos/
│       ├── <title>/                        # one folder per video
│       │   ├── <title>.md                  # full video note (+ AI notes from crawlers/youtube-ai)
│       │   └── ...                         # anything else you put here travels with the video
│       └── <title>/
│           └── <title>-ref.md              # pointer to a full note owned by another playlist
└── removed/
    └── <playlist>/                         # same layout, for videos (or whole playlists) that left
        ├── <playlist>.md
        └── videos/<title>/...
```

When a video moves (to another playlist, into `removed/`, or back), its whole folder moves. If the
destination folder already exists, the two are merged, and no file is ever overwritten. Relative links
in moved notes are rewritten so they keep pointing at the same files.

**Naming:** folder and file names are the kebab-cased title:
`build/videos/how-to-rgb-8x8x8-led-cube-the-build/how-to-rgb-8x8x8-led-cube-the-build.md`.
- **Characters:** accents are dropped (`ń` becomes `n`), and letters of other scripts are kept
  (`강남-스타일`).
- **Shared titles:** when two videos have the same title, the later one gets `-2`, `-3`... Names have
  to be unique, because a video's folder can move to any playlist.
- **Fixed names:** names are chosen once, so renaming a video or playlist on YouTube never renames its
  folder.
- **Unavailable videos:** a video that is private, deleted or otherwise unavailable on YouTube gets a
  hidden folder (`.title/`), which Obsidian and file managers don't show. Playlist notes still list it,
  linking only to YouTube. If a later re-check finds the video available again, the folder loses the
  dot. Everything inside moves with it.
- **Video ID:** it isn't in the name. It's in the note's front matter (`video_id: "zS5oZPJVh_o"`) and
  in its Metadata section.

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
where every note currently is. Listing a playlist is a slow call of its own, so upcoming playlists
are listed ahead of time, 3 at once (`--listing-workers`). They are still handled in their original
order, so the playlist that owns a shared video's note never changes. As soon as a playlist is synced,
its videos that need details go into one shared pool of workers (`--workers`, 4 by default). Like a Go channel, the pool keeps fetching across playlist boundaries, and while the next
playlist is being listed, instead of waiting for each playlist to finish. Each video's note is written
when its details arrive, and a playlist's note is rewritten when its last video is done. A video in
several playlists is fetched once.

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
  - A re-check rewrites a note only if it still matches what the script last wrote. Front matter and
    keep blocks don't count, and front matter properties the template doesn't write are kept.
  - If you rename or move a full note, it is found again through the `video_id` in its front matter and
    put back where it belongs.
- **Logged out:** the sync first checks that YouTube sees you as logged in, by reading Watch Later,
  with 3 tries 10 seconds apart. If it still doesn't, it stops before changing anything, because
  every private playlist would fail. A playlist that answers "does not exist" is retried once after
  a short wait.
- **One run at a time:** a lock file next to the database stops two runs from working on the same
  database at once.

### Database tables

| Table | One row per | Holds |
| :--- | :--- | :--- |
| `playlist` | playlist | metadata, owner, created-by-me, notes folder, removal state |
| `video` | playlist entry (a video in two playlists has two rows) | position, title, channel, removal state |
| `video_detail` | distinct video | description, counts, tags, chapters, comments, transcript, raw yt-dlp JSON, note owner and path |

## Migrations

Schema and layout changes live in numbered scripts in `migrations/`, not in the regular code:

| Migration | Change |
| :--- | :--- |
| `0001_initial_schema` | playlist, video and video_detail tables |
| `0002_playlist_metadata` | playlist metadata, owner, notes folder, created-by-me |
| `0003_note_ownership` | which playlist owns each video's full note |
| `0004_tracking_columns` | note paths and hashes, re-check scheduling, removal confirmation |
| `0005_per_video_folders` | notes folder: one folder per video |
| `0006_kebab_case_names` | notes folder: kebab-case names (paths in the database and links in notes updated) |
| `0007_names_without_video_id` | notes folder: names without the video ID; the ID moves into each note's front matter |
| `0008_flag_placeholder_details` | marks details saved from yt-dlp placeholders (private or removed videos) as unavailable and due for a re-check |

- **Tracking:** applied migrations are recorded in the `schema_migrations` table, which youtube-ai
  shares, using its own `component` value.
- **Running:** `run.sh` runs `migrate.py` before every sync. The sync refuses to start on a database
  with pending migrations.
- **Running by hand:** use `.venv/bin/python migrate.py --db <db> --notes-dir <notes>`.

To change the schema or the notes layout, add the next `NNNN_description.py` with a
`migrate(conn, notes_dir)` function. It must leave a database that already has the change
untouched, because databases created before migrations existed are brought up to date by running
all of them.

## Templates

Notes are rendered from the Jinja2 templates in `md-templates/`. Edit them to change how new notes
look. See [md-templates/README.md](md-templates/README.md) for the fields and helpers available.

## Project layout

```
crawlers/youtube-lists/
├── run.sh                 reads .env, manages .venv, runs the CLI
├── youtube-lists.py       entry point
├── migrate.py             applies pending migrations (run.sh calls it first)
├── migrations/            numbered schema and notes-layout migrations
├── requirements.txt
├── md-templates/          editable note templates
├── cli.py                 arguments; starts a run under the lock
├── config.py              constants and re-check intervals
├── pipeline/              run.py (the run), details.py (shared detail worker pool, re-checks)
├── youtube/               client.py (yt-dlp), subtitles.py
├── storage/               schema.py, playlists.py, videos.py, lock.py
├── notes/                 templates.py, render.py, writer.py, reconcile.py, keep.py, paths.py, migrate.py
├── exports/               csv_export.py
└── utils/                 text.py
```

Modules import each other by their top-level names (`from storage.schema import open_db`), resolved from
this folder. The entry point puts the folder on `sys.path`, so run the crawler through `run.sh` or
`youtube-lists.py`.
