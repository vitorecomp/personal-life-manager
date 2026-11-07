# YouTube Clean

Removes deleted and private videos from your YouTube playlists. YouTube keeps them in playlists as
"[Deleted video]" and "[Private video]" entries (the website just hides them), and that includes
Watch later.

It runs as a **dry run by default**: without `--apply` nothing changes, and it only lists what would
be removed.

## Running

```bash
./crawlers/youtube-clean/run.sh                           # list what would be removed (no changes)
./crawlers/youtube-clean/run.sh --apply                   # remove them
./crawlers/youtube-clean/run.sh --playlist Build --apply  # only one playlist
./crawlers/youtube-clean/run.sh --only deleted --apply    # only deleted videos, keep private ones
./crawlers/youtube-clean/run.sh --limit 20 --apply        # at most 20 removals this run
./crawlers/youtube-clean/run.sh -h                        # manual and every option
```

After removing, run `./crawlers/youtube-lists/run.sh` so your notes follow (the removed videos move
to `removed/`).

Settings come from the project root `.env`: `YOUTUBE_COOKIES_BROWSER` (your YouTube login) and
`YOUTUBE_LISTS_DB` (the youtube-lists database, which says what your playlists are).

## How it works

- **Which playlists:** every playlist the youtube-lists crawler knows that you own, plus Watch later.
  - Playlists you saved from other people can't be edited, so they're skipped.
  - Liked videos is skipped unless you pass `--include-liked`, because removing from it means
    un-liking the video.
- **Finding them:** each playlist is read live from YouTube, including the unavailable entries it
  hides by default. Entries titled "[Private video]" or "[Deleted video]", or that can't be played
  and have no length, are the ones to remove. `--only private,deleted,unavailable` narrows that.
- **Removing:** it uses the same internal call youtube.com makes when you click "Remove from
  playlist", 50 videos per request, authenticated with your browser's cookies. `yt-dlp` reads the
  cookies and signs the requests.
- **Log:** every removal, or failed removal, is appended to
  `data/database/youtube-clean-log.csv`, with the playlist, video ID, position and reason.
  If a private video becomes public again, you can find it there and re-add it.

This is YouTube's internal API, not the official one. The official YouTube Data API can't edit Watch
later at all. If YouTube changes its website, removals may fail; they're reported and logged, and
nothing else is affected. Reading always comes first, so a dry run is a safe way to check it still
works.

## Project layout

```
crawlers/youtube-clean/
├── run.sh                  reads .env, manages .venv, runs the CLI (-h prints the manual)
├── youtube-clean.py        entry point
├── requirements.txt
├── cli.py                  arguments, the run and the summary
├── config.py               constants
├── youtube/client.py       list a playlist's entries (incl. hidden unavailable), remove, un-like
└── storage/
    ├── playlists.py        which playlists to clean (read-only from the youtube-lists database)
    └── removal_log.py      the CSV log of removals
```
