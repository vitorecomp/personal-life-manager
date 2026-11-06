# YouTube AI Notes

Generates two AI notes per YouTube video with Gemini (`gemini-3.8-flash` by default). The notes are
written next to the notes of the [youtube-lists](../youtube-lists/README.md) crawler, inside each
video's folder:

```
<playlist>/videos/<title>/
├── <title>.md                         video note (youtube-lists)
├── <title>-ai-knowledge.md            everything the video teaches
└── <title>-ai-visual-description.md   everything the video shows
```

Gemini watches the video itself: the script passes the YouTube URL, plus the metadata, description,
chapters and caption track already collected by youtube-lists. Because the notes live in the video's
folder, they move with it when youtube-lists hands the video to another playlist or parks it in
`removed/`.

## Setup

1. Run the youtube-lists crawler first. This script reads its database and notes folder
   (`YOUTUBE_LISTS_DB` and `YOUTUBE_LISTS_NOTES_DIR` in the project root `.env`).
2. Put your Gemini API key in the project root `.env` as `GEMINI_API_KEY=...`.

Optional `.env` settings: `YOUTUBE_AI_MODEL`, `YOUTUBE_AI_MAX_VIDEOS` (default: no limit), `YOUTUBE_AI_MODE`
(`flex`, `standard` or `batch`), `YOUTUBE_AI_WORKERS` (default 4) and `YOUTUBE_AI_BATCH_SIZE`
(default 50).

## Running

`./crawlers/youtube-ai/run.sh -h` prints a short manual and every option.

```bash
./crawlers/youtube-ai/run.sh --dry-run                 # the plan and estimated cost, no API calls
./crawlers/youtube-ai/run.sh --max-videos 1            # try it on one video first
./crawlers/youtube-ai/run.sh                           # classify and analyse everything eligible (Flex)
./crawlers/youtube-ai/run.sh --playlist Build --max-videos 50
./crawlers/youtube-ai/run.sh --mode standard           # immediate answers, full price
```

### How a run flows (producer / consumer)

Classification produces work and analysis consumes it:

- **Already classified videos** (from earlier runs) go straight into an analysis queue, highest
  score first.
- **Unclassified videos** are classified in groups (`--classify-request-size`, default 50). As soon
  as a group is classified, its videos whose category allows notes join the analysis queue. Analysis
  starts after the first group, not after all of them.
- **Flex and standard modes:** one pool of `--workers` threads runs both kinds of task. One worker
  at a time classifies the next group (more when the queue is empty), while the others analyse.
- **Batch mode:** classification goes out in jobs of `--batch-size` videos. Each time a
  classification job finishes, its eligible videos go out as an analysis job straight away, while the
  other jobs keep running.
- **Limit:** there is none by default; `--max-videos N` caps how many videos are queued for analysis in
  one run. Check the cost of a full run with `--dry-run` first.

### Modes

| Mode | Price | How it answers |
| :--- | :--- | :--- |
| `flex` (default) | half | normal calls on Google's spare capacity: each can take minutes, and "busy" answers (429/503) are retried automatically with growing waits |
| `standard` (or `direct`) | full | normal calls, answered in seconds |
| `priority` | 1.8× standard | fastest and most reliable; when Priority capacity runs out Gemini serves the call at standard instead (and bills it as standard) |
| `batch` | half | asynchronous jobs of `--batch-size` videos, done within 24 hours; saved in the database, so `--no-wait` or quitting leaves them to be collected by the next run |

Flex and batch cost the same, and Flex needs no job management, so it is the default. A Flex call
returns nothing until the whole answer is ready, including the time queued for spare capacity
(1–15 minutes) and the time to generate a long note, so the client waits up to an hour
(`--timeout`). A call that times out is not retried automatically, because the answer may already
have been generated and billed. It is marked failed and retried on the next run. If Gemini stays
busy through every retry (6 tries, waiting 30 seconds up to 5 minutes), that call is recorded as
failed and retried on the next run. Batch jobs left by earlier runs are collected in every mode.

### Stopping

- **First Ctrl+C:** no new Gemini calls start, and the script waits for the running ones to finish
  and saves their notes. In batch mode it keeps waiting for submitted jobs.
- **Second Ctrl+C:** quits immediately. Submitted batch jobs keep running and are collected on the
  next run.

### Options

| Option | Meaning |
| :--- | :--- |
| `--max-videos N` | analyse at most N videos this run (default: no limit; `0` also means no limit) |
| `--mode flex\|standard\|priority\|batch` | see above (default `flex`) |
| `--workers N` | Flex, standard and priority: calls running at the same time (default 4) |
| `--timeout S` | seconds to wait for one answer (default 3600; `YOUTUBE_AI_TIMEOUT`) |
| `--batch-size N` | batch mode: videos per batch job, for classification and analysis (default 50) |
| `--order score\|playlist` | which videos go first (default `score`, see below) |
| `--playlist NAME` | only videos in this playlist (title or folder name); repeatable |
| `--video ID` | only this video; repeatable |
| `--kinds knowledge,visual` | which of the two notes to make |
| `--media-resolution auto\|high\|low` | requested video detail (default `auto`; YouTube videos cost the same at every setting) |
| `--thinking-level low\|medium\|high` | model thinking (default `low`) |
| `--no-transcript` | don't send the caption track |
| `--prompts-dir DIR` | use prompts from another folder |
| `--force` | regenerate existing notes (the old file is kept, renamed `... (old <time>).md`) |
| `--no-wait` | batch mode: submit and exit |
| `--dry-run` | show the plan without calling Gemini |
| `--classify-only` | only classify videos, no analysis |
| `--reclassify` | classify the candidates again (after editing the categories) |
| `--classify-limit N` | classify at most N videos per run (default: no limit; `0` also means no limit) |
| `--classify-request-size N` | videos per classification request (default 50) |
| `--classify-model MODEL` | model for classification (default: same as `--model`) |
| `--no-classify` | skip classification; analyse every selected video fully |

## Classification

Before any video is analysed, it is classified into a category from
[`prompts/categories.md`](prompts/categories.md). The category's action decides what it gets:

| Action | Notes |
| :--- | :--- |
| `full` | knowledge and visual description (maker/DIY, tutorials, explainers, talks, reviews) |
| `knowledge` | knowledge only (tech news, podcasts and interviews, business and career) |
| `skip` | none (music, entertainment, gaming, story recaps, motivation and ambient, unknown) |

- **Cost:** the call is text only, using the title, channel, YouTube category, tags, duration, and the
  start of the description and captions. 50 videos are classified per request, in the same mode as
  the analysis, so classifying is a tiny fraction of the cost of analysing.
- **Missing metadata:** videos without any (no channel and no description) are put in `unknown`
  directly, without a call.
- **Low confidence:** a `full` category with confidence under 0.6 gets only the knowledge note
  (`CLASSIFY_MIN_CONFIDENCE` in `config.py`).
- **Per run:** each run classifies every unclassified candidate, highest score first, and feeds them
  into analysis as they are classified. `--classify-limit N` caps that at N videos per run. To only
  classify everything (and analyse nothing), run `--classify-only`. Videos the model leaves out of an answer are
  retried on the next run.
- **Storage:** results are stored in the `ai_classification` table (category, confidence, model, prompt
  version). The category is also written into each video note's front matter (`category: music`) and
  into the AI notes. The youtube-lists sync keeps that line when it refreshes a note, so you can
  filter by category in Obsidian.
- **Changing categories:** edit `prompts/categories.md`, then run with `--reclassify`, together with
  `--classify-only` to review the result before analysing.
- **Turning it off:** `--no-classify` analyses every selected video fully.

## What gets processed

### Order

By default the videos with the highest score are analysed first, and `--max-videos` takes the top of
that list:

```
score = 1 per 1,000 views + 1 per 100 comments - 10 per full month since upload
```

- **Rounding:** only complete steps count. 1,999 views is +1, 250 comments is +2, and a video
  uploaded on 31 January is 9 months old on 31 October.
- **Missing values:** unknown views, comments or upload date count as 0.
- **Ties:** equal scores keep playlist order.
- **Inputs:** the numbers come from the youtube-lists database (the counts from when each video was
  last checked).
- **Tuning:** the weights are in `config.py` (`SCORE_*`).
- **Old order:** `--order playlist` processes playlist by playlist instead.
- **Dry run:** `--dry-run` shows the score of every selected video.

### Turning AI off for a playlist

Put this line in the top section of the playlist's note, above `## Metadata`:

```markdown
- **AI Video Description:** [False]
```

- **Effect:** that playlist's videos get no AI notes.
- **Shared videos:** a video that is also in a playlist that allows AI is still analysed.
- **Default:** a missing line, or `[True]`, allows AI.
- **New playlist notes:** they get the line, set to `[True]`, inside a protected block, so the value
  you set is never reset by a sync. For older playlist notes, add the line inside their
  `<!-- keep:ai-full-description -->` block.
- **Format:** spelling is flexible. Capitals, bold and a missing `- ` all work.
- **Dry run:** `--dry-run` reports how many videos were skipped this way.

### Which videos

- **Eligible videos:** ones with a video note in an active playlist folder, in playlist order,
  each video once even if it is in several playlists.
- **Skipped:**
  - private, unlisted and members-only videos, because Gemini can only open public YouTube videos;
  - live or upcoming streams;
  - videos too long to fit the model's input even at low resolution, beyond roughly 2.3 hours.
- **Already done:** finished notes are never requested again, and a note that already exists on
  disk is never overwritten (except with `--force`).
- **Failures:** failed calls are retried on later runs, up to 3 attempts.

## Getting the most out of Gemini

- **Output size:** each call allows the model's full 65,536 output tokens. The prompts ask for
  exhaustive, timestamped notes that use as much of that as the video justifies. Thinking tokens
  count against the same limit, so thinking defaults to `low`.
- **Cut-off notes:** if a note hits the limit, its header says it may be cut off.
- **Resolution:** for YouTube videos, Gemini 3.8 Flash uses about 91 tokens per second of video at
  every media resolution (measured), so cost depends only on length. Videos up to roughly 2.5 hours
  fit the model's input; longer ones are skipped.
- **Caching:** the two requests for a video are identical except for the final task (same system
  instruction, video, context and resolution) and are sent next to each other, so Gemini's implicit
  cache *can* serve the shared part of the second one at a tenth of the price.
  - **Best effort:** with YouTube URLs this implicit caching happens only sometimes. In tests, one of
    three identical requests was served from the cache, and an analysis pair got none.
  - **Explicit caching:** this would guarantee the reuse, but the API rejects it for YouTube URLs.
  - **Checking:** each note's header shows `cached_tokens`, and the end-of-run report shows the
    share of input served from the cache.

## Blocked answers (RECITATION)

Gemini refuses to return an answer that would reproduce existing text word for word, such as source
code, slides, lyrics or narration. The finish reason is `RECITATION`. The prompts ask for code and
on-screen text verbatim, so this mostly happens with coding tutorials.

- **Flex, standard and priority:** a blocked note is retried once at once with
  [`prompts/no-verbatim.md`](prompts/no-verbatim.md) added to the task. That asks for code and text to
  be described in Gemini's own words, quoting only short fragments.
- **Batch mode, and notes that are blocked again:** the next run sends them with that instruction
  from the start, up to the usual 3 attempts.
- **Marking:** notes written this way have `paraphrased: true` in their front matter and a short note
  at the top.
- **Cost:** blocked answers still cost their input tokens, and they are included in the cost report.

## Skipped videos report

Every run ends with the videos it skipped and why, most frequent reason first:

```
Skipped videos this run
  271  category music (skip)
  267  category entertainment (skip)
  165  not public (unlisted)
  ...
```

The reasons include:

- **On YouTube:** unavailable (private or deleted), or not public.
- **Too long:** over the model's input limit, roughly 2.5 hours.
- **Your choices:** AI turned off for the playlist, or a category with action `skip`.
- **Not ready yet:** no video note yet, or left for the next run by `--max-videos`.
- **Errors:** classification failed. Those are retried on the next run.

`--dry-run` shows the same counts for the plan.

## Costs

While Gemini calls run, a status line below the output shows the calls, tokens and estimated cost so
far. Every run ends with a report like this:

```
Gemini usage this run
  calls:          1 (notes 0, classification 1)
  input tokens:   21,588
  cached tokens:  0 (0% of input served from cache)
  output tokens:  1,672 (thinking 0)
  estimated cost: ~$0.0225
All runs so far: ~$0.0533 for 3 calls, 34,406 input (0 cached) and 7,337 output tokens
```

- **How the estimate works:** it uses the token counts Gemini reports for each call and the prices in
  `config.py` (`PRICES`, with the price change on 1 January 2027). Each call is priced at the tier
  that actually served it, from Gemini's `x-gemini-service-tier` header: a downgraded Priority call
  counts as standard. Flex and batch cost half of standard, Priority has its own prices, and thinking
  tokens are billed as output. The report shows how many calls each tier served.
- **Storage:** every call's usage is stored in the `ai_usage` table, which is where the all-time total
  comes from.
- **Dry run:** `--dry-run` estimates a run before you start it: input cost, and the worst case for
  output.
- **Measured so far:** classifying 50 videos costs about $0.02 at standard price and $0.01 with Flex
  or batch. Analysing a 1-minute video (two notes, about 2,000 words each) costs about $0.03 at
  standard price and $0.015 with Flex or batch.
  Output dominates the cost for short videos.

## Prompts

The prompts are in [`prompts/`](prompts/README.md): `system.md`, `context.md`, `knowledge.md` and
`visual-description.md`. Edit them to change what the notes contain. Keep `system.md` and
`context.md` free of task-specific text, or the second call can't reuse the cache.

## Bookkeeping

Progress is stored in two tables added to the youtube-lists database. The youtube-lists tables are
only read. The tables are created by `migrations/0001_ai_tables.py`. `run.sh` runs `migrate.py`
before every run and records the result in the shared `schema_migrations` table under the
`youtube-ai` component.

- **`ai_note`:** one row per video and note type, with status, the generated text, tokens used
  (including cached), and the prompt version.
- **`ai_batch`:** the submitted batch jobs, their state and their purpose (`notes` or `classify`).
- **`ai_usage`:** the token usage of every Gemini call (for the cost estimates).
- **`ai_classification`:** one row per video: category, confidence, source (`model`, or `rule` for
  videos without metadata), model and prompt version.

Because the generated text is kept in the database, a note whose folder is missing at the moment it
finishes is written on a later run, without calling Gemini again.

## Project layout

```
crawlers/youtube-ai/
├── run.sh              reads .env, manages .venv, runs migrations then the CLI
├── youtube-ai.py       entry point
├── migrate.py          applies pending migrations
├── requirements.txt
├── prompts/            the prompts (editable)
├── migrations/         numbered database migrations
├── cli.py              arguments and the run
├── config.py           constants
├── pipeline/           scheduler.py (producer/consumer run), selection.py, classify.py, direct.py, batch.py
├── gemini/             calls.py (tier and retries), request.py, classification.py, response.py
├── prompting/          builder.py (prompt rendering), categories.py (the categories table)
├── notes/              writer.py (writing the AI notes), front_matter.py (category in video notes)
├── storage/            state.py (ai_note and ai_batch tables), lock.py (one run at a time)
└── utils/              stopper.py (graceful Ctrl+C), costs.py (usage and cost), statusbar.py (live status line)
```

Modules import each other by their top-level names (`from storage.state import open_state`), resolved
from this folder. The entry points put the folder on `sys.path`, so run through `run.sh`,
`youtube-ai.py` or `migrate.py`.
