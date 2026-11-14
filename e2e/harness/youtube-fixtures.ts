import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { E2E_PATHS } from './env';

const execFileAsync = promisify(execFile);

export interface YoutubeFixtureOptions {
  includeAiTable?: boolean;
  includeSharedRefNote?: boolean;
  includeUnavailableVideos?: boolean;
}

export interface YoutubeFixtureEnv {
  dir: string;
  dbPath: string;
  notesDir: string;
  playlistId: string;
  secondPlaylistId: string;
  videoIds: string[];
  cleanup: () => Promise<void>;
}

const PYTHON_FIXTURE_BUILDER = String.raw`
import importlib.util
import json
import os
import sqlite3
import sys

cfg = json.loads(sys.argv[1])
repo_root = cfg["repoRoot"]
db_path = cfg["dbPath"]
notes_dir = cfg["notesDir"]
include_ai = bool(cfg["includeAiTable"])
include_shared_ref = bool(cfg["includeSharedRefNote"])
include_unavailable = bool(cfg["includeUnavailableVideos"])

os.makedirs(notes_dir, exist_ok=True)

def load_module(mod_name, file_path):
    spec = importlib.util.spec_from_file_location(mod_name, file_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

lists_runner_path = os.path.join(repo_root, "crawlers", "youtube-lists", "migrations", "runner.py")
lists_runner = load_module("yt_lists_runner", lists_runner_path)
lists_runner.run(db_path, notes_dir)

if include_ai:
    ai_runner_path = os.path.join(repo_root, "crawlers", "youtube-ai", "migrations", "runner.py")
    ai_runner = load_module("yt_ai_runner", ai_runner_path)
    ai_runner.run(db_path)
    ai_secrets_path = os.path.join(repo_root, "crawlers", "youtube-ai", "utils", "secrets.py")
    ai_secrets = load_module("yt_ai_secrets", ai_secrets_path)

conn = sqlite3.connect(db_path)
conn.execute("PRAGMA journal_mode = DELETE")
conn.execute("PRAGMA foreign_keys = ON")

now_iso = "2026-11-10T12:00:00+00:00"
early_iso = "2026-10-01T09:00:00+00:00"

playlists = [
    (
        "PL_DIST_SYS_01",
        "Distributed Systems Engineering",
        "https://www.youtube.com/playlist?list=PL_DIST_SYS_01",
        early_iso,
        now_iso,
        None,
        "distributed-systems",
        1,
        "Systems Academy",
        "UC_SYS_ACADEMY_01",
        "https://www.youtube.com/@systems-academy",
        "Consensus, clocks, replication, and fault-tolerant async runtimes.",
        "public",
        3,
        "20261110",
        12500,
        0,
    ),
    (
        "PL_RUST_ASYNC_02",
        "Rust Async & Tokio Internals",
        "https://www.youtube.com/playlist?list=PL_RUST_ASYNC_02",
        early_iso,
        now_iso,
        None,
        "rust-async-internals",
        1,
        "Systems Academy",
        "UC_SYS_ACADEMY_01",
        "https://www.youtube.com/@systems-academy",
        "Deep dive into Futures, Wakers, and work-stealing executors.",
        "public",
        2,
        "20261110",
        8900,
        0,
    ),
    (
        "PL_REMOVED_LEGACY",
        "Archived Legacy Playlist",
        "https://www.youtube.com/playlist?list=PL_REMOVED_LEGACY",
        early_iso,
        early_iso,
        "2026-09-01T00:00:00+00:00",
        "archived-legacy",
        0,
        "Legacy Channel",
        "UC_LEGACY_00",
        "https://www.youtube.com/@legacy-channel",
        "Soft-removed playlist that must not surface as active.",
        "unlisted",
        1,
        "20260901",
        120,
        3,
    ),
]

conn.executemany(
    """
    INSERT INTO playlist (
        id, title, url, first_seen_at, last_seen_at, removed_at,
        folder, created_by_me, owner_name, owner_channel_id, owner_url,
        description, availability, youtube_video_count, modified_date, view_count, missing_runs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
    playlists,
)

def write_text(rel_path, content):
    abs_p = os.path.join(notes_dir, rel_path)
    os.makedirs(os.path.dirname(abs_p), exist_ok=True)
    with open(abs_p, "w", encoding="utf-8") as fh:
        fh.write(content)

write_text(
    "distributed-systems/distributed-systems.md",
    """# Distributed Systems Engineering

<!-- keep:ai-full-description -->
- **Playlist ID:** PL_DIST_SYS_01
- **URL:** https://www.youtube.com/playlist?list=PL_DIST_SYS_01
- **AI Video Description:** [True]

## Videos
1. [Raft Consensus & Log Replication](videos/raft-consensus-log-replication/raft-consensus-log-replication.md)
2. [Vector Clocks & Causal Ordering](videos/vector-clocks-causal-ordering/vector-clocks-causal-ordering.md)
3. [Tokio Work-Stealing Scheduler](videos/tokio-work-stealing-scheduler/tokio-work-stealing-scheduler.md)
""",
)

write_text(
    "rust-async-internals/rust-async-internals.md",
    """# Rust Async & Tokio Internals

<!-- keep:ai-full-description -->
- **Playlist ID:** PL_RUST_ASYNC_02
- **URL:** https://www.youtube.com/playlist?list=PL_RUST_ASYNC_02
- **AI Video Description:** [True]
""",
)

def render_ai_markdown(video_id, title, note_file, kind, model, completed_at, category, paraphrased, body):
    front = {
        "video_id": video_id,
        "title": title,
        "ai_kind": kind,
        "model": model,
        "mode": "batch",
        "media_resolution": "low",
        "prompt_version": "sha256:fixture-v1",
        "generated_at": completed_at,
        "finish_reason": "STOP",
        "prompt_tokens": 1240,
        "cached_tokens": 200,
        "output_tokens": 580,
        "thinking_tokens": 160,
        "category": category,
        "paraphrased": bool(paraphrased),
    }
    header = ["---"] + [f"{k}: {json.dumps(v, ensure_ascii=False)}" for k, v in front.items()] + ["---", ""]
    kind_title = "AI knowledge" if kind == "knowledge" else "AI visual description"
    header.append(f"> {kind_title} generated by {model}. [Video note]({note_file}) · [YouTube](https://www.youtube.com/watch?v={video_id})")
    header.append("")
    if paraphrased:
        header.append("> **Note:** Gemini blocked a word-for-word copy of this video's code or text, so they are summarised in its own words here.")
        header.append("")
    return "\n".join(header) + body.strip() + "\n"

# Video 1: Owned by PL_DIST_SYS_01
v1_note_rel = "distributed-systems/videos/raft-consensus-log-replication/raft-consensus-log-replication.md"
write_text(
    v1_note_rel,
    """---
video_id: "vDistSys001"
category: tutorial
---

# Raft Consensus & Log Replication

- **Channel:** Systems Academy
- **Duration:** 30m 45s
- **URL:** https://www.youtube.com/watch?v=vDistSys001

## Transcript
Leader election uses randomized election timeouts and term numbers to guarantee election safety.
""",
)

# Video 2: Owned by PL_DIST_SYS_01
v2_note_rel = "distributed-systems/videos/vector-clocks-causal-ordering/vector-clocks-causal-ordering.md"
write_text(
    v2_note_rel,
    """---
video_id: "vDistSys002"
category: lecture
---

# Vector Clocks & Causal Ordering

- **Channel:** Systems Academy
- **Duration:** 23m 40s
- **URL:** https://www.youtube.com/watch?v=vDistSys002

## Transcript
Lamport timestamps capture happens-before partially; vector clocks detect concurrent writes accurately.
""",
)

# Video 3: Owned by PL_RUST_ASYNC_02 when include_shared_ref is True, else PL_DIST_SYS_01
if include_shared_ref:
    v3_owner_playlist = "PL_RUST_ASYNC_02"
    v3_note_rel = "rust-async-internals/videos/tokio-work-stealing-scheduler/tokio-work-stealing-scheduler.md"
    write_text(
        "distributed-systems/videos/tokio-work-stealing-scheduler/tokio-work-stealing-scheduler-ref.md",
        """# Tokio Work-Stealing Scheduler (ref)

> Reference only. The full note for this video is stored in the playlist **Rust Async & Tokio Internals**.

- **Full note:** [Tokio Work-Stealing Scheduler](../../../rust-async-internals/videos/tokio-work-stealing-scheduler/tokio-work-stealing-scheduler.md)
- **Video ID:** vDistSys003
- **URL:** https://www.youtube.com/watch?v=vDistSys003
""",
    )
    write_text(
        "rust-async-internals/videos/raft-consensus-log-replication/raft-consensus-log-replication-ref.md",
        """# Raft Consensus & Log Replication (ref)

> Reference only. The full note for this video is stored in the playlist **Distributed Systems Engineering**.

- **Full note:** [Raft Consensus & Log Replication](../../../distributed-systems/videos/raft-consensus-log-replication/raft-consensus-log-replication.md)
- **Video ID:** vDistSys001
- **URL:** https://www.youtube.com/watch?v=vDistSys001
""",
    )
else:
    v3_owner_playlist = "PL_DIST_SYS_01"
    v3_note_rel = "distributed-systems/videos/tokio-work-stealing-scheduler/tokio-work-stealing-scheduler.md"

write_text(
    v3_note_rel,
    """---
video_id: "vDistSys003"
category: deep-dive
---

# Tokio Work-Stealing Scheduler

- **Channel:** Systems Academy
- **Duration:** 36m 00s
- **URL:** https://www.youtube.com/watch?v=vDistSys003

## Transcript
Each worker thread maintains a local LIFO slot and a fixed-size run queue with cross-thread stealing.
""",
)

videos = [
    ("PL_DIST_SYS_01", "vDistSys001", 1, "Raft Consensus & Log Replication", "https://www.youtube.com/watch?v=vDistSys001", "Systems Academy", 1845, early_iso, now_iso, None, 0),
    ("PL_DIST_SYS_01", "vDistSys002", 2, "Vector Clocks & Causal Ordering", "https://www.youtube.com/watch?v=vDistSys002", "Systems Academy", 1420, early_iso, now_iso, None, 0),
    ("PL_DIST_SYS_01", "vDistSys003", 3, "Tokio Work-Stealing Scheduler", "https://www.youtube.com/watch?v=vDistSys003", "Systems Academy", None, early_iso, now_iso, None, 0),
]

if include_shared_ref:
    videos.extend([
        ("PL_RUST_ASYNC_02", "vDistSys003", 1, "Tokio Work-Stealing Scheduler", "https://www.youtube.com/watch?v=vDistSys003", "Systems Academy", 2160, early_iso, now_iso, None, 0),
        ("PL_RUST_ASYNC_02", "vDistSys001", 2, "Raft Consensus & Log Replication", "https://www.youtube.com/watch?v=vDistSys001", "Systems Academy", 1845, early_iso, now_iso, None, 0),
    ])

details = [
    (
        "vDistSys001",
        "Raft Consensus & Log Replication",
        "Complete walkthrough of Raft leader election, log replication, and safety invariants.",
        "Systems Academy",
        "UC_SYS_ACADEMY_01",
        "https://www.youtube.com/@systems-academy",
        "20261002",
        1845,
        42000,
        2100,
        145,
        0,
        json.dumps(["Science & Technology"]),
        json.dumps(["raft", "consensus", "distributed-systems"]),
        json.dumps([{"start_time": 0, "title": "Election Safety"}, {"start_time": 900, "title": "Log Matching"}]),
        "en",
        "not_live",
        "public",
        "https://i.ytimg.com/vi/vDistSys001/maxresdefault.jpg",
        json.dumps([]),
        "en",
        "manual",
        "Leader election uses randomized election timeouts and term numbers to guarantee election safety.",
        None,
        None,
        "raft-consensus-log-replication.md",
        now_iso,
        "PL_DIST_SYS_01",
        v1_note_rel,
        "sha256:v1-note",
        now_iso,
        0,
    ),
    (
        "vDistSys002",
        "Vector Clocks & Causal Ordering",
        "Understanding logical time, happens-before, and sibling conflict detection.",
        "Systems Academy",
        "UC_SYS_ACADEMY_01",
        "https://www.youtube.com/@systems-academy",
        "20261009",
        1420,
        31500,
        1650,
        98,
        0,
        json.dumps(["Science & Technology"]),
        json.dumps(["vector-clocks", "lamport", "causality"]),
        json.dumps([{"start_time": 0, "title": "Lamport Clocks"}, {"start_time": 720, "title": "Vector Clocks"}]),
        "en",
        "not_live",
        "public",
        "https://i.ytimg.com/vi/vDistSys002/maxresdefault.jpg",
        json.dumps([]),
        "en",
        "auto",
        "Lamport timestamps capture happens-before partially; vector clocks detect concurrent writes accurately.",
        None,
        None,
        "vector-clocks-causal-ordering.md",
        now_iso,
        "PL_DIST_SYS_01",
        v2_note_rel,
        "sha256:v2-note",
        now_iso,
        0,
    ),
    (
        "vDistSys003",
        "Tokio Work-Stealing Scheduler",
        "How multi-threaded async Rust runtimes schedule cooperative tasks without global lock contention.",
        "Systems Academy",
        "UC_SYS_ACADEMY_01",
        "https://www.youtube.com/@systems-academy",
        "20261016",
        2160,
        54000,
        3200,
        210,
        0,
        json.dumps(["Science & Technology"]),
        json.dumps(["rust", "tokio", "work-stealing"]),
        json.dumps([{"start_time": 0, "title": "Run Queues"}, {"start_time": 1100, "title": "Stealing Half"}]),
        "en",
        "not_live",
        "public",
        "https://i.ytimg.com/vi/vDistSys003/maxresdefault.jpg",
        json.dumps([]),
        "en",
        "manual",
        "Each worker thread maintains a local LIFO slot and a fixed-size run queue with cross-thread stealing.",
        None,
        None,
        "tokio-work-stealing-scheduler.md",
        now_iso,
        v3_owner_playlist,
        v3_note_rel,
        "sha256:v3-note",
        now_iso,
        0,
    ),
]

if include_unavailable:
    priv_rel = "distributed-systems/videos/.private-video/private-video.md"
    del_rel = "distributed-systems/videos/.deleted-video/deleted-video.md"
    rem_rel = "removed/distributed-systems/videos/deprecated-rpc-layer/deprecated-rpc-layer.md"

    write_text(priv_rel, '---\nvideo_id: "vPrivStub04"\n---\n\n# [Private video]\n\n> Unavailable: Private video\n')
    write_text(del_rel, '---\nvideo_id: "vDelStub005"\n---\n\n# [Deleted video]\n\n> Unavailable: This video has been removed by the uploader\n')
    write_text(rem_rel, '---\nvideo_id: "vRemoved006"\n---\n\n# Deprecated RPC Layer\n')

    videos.extend([
        ("PL_DIST_SYS_01", "vPrivStub04", 4, "[Private video]", "https://www.youtube.com/watch?v=vPrivStub04", "", None, early_iso, now_iso, None, 0),
        ("PL_DIST_SYS_01", "vDelStub005", 5, "[Deleted video]", "https://www.youtube.com/watch?v=vDelStub005", "", None, early_iso, now_iso, None, 0),
        ("PL_DIST_SYS_01", "vRemoved006", 6, "Deprecated RPC Layer", "https://www.youtube.com/watch?v=vRemoved006", "Systems Academy", 900, early_iso, early_iso, "2026-10-01T00:00:00+00:00", 3),
    ])

    details.extend([
        (
            "vPrivStub04", "[Private video]", None, None, None, None, None, None, None, None, None,
            None, None, None, None, None, None, "private", None, None, None, None, None, None,
            "Private video", "private-video.md", now_iso, "PL_DIST_SYS_01", priv_rel, "sha256:priv", now_iso, 1,
        ),
        (
            "vDelStub005", "[Deleted video]", None, None, None, None, None, None, None, None, None,
            None, None, None, None, None, None, "unavailable", None, None, None, None, None, None,
            "This video has been removed by the uploader", "deleted-video.md", now_iso, "PL_DIST_SYS_01", del_rel, "sha256:del", now_iso, 1,
        ),
        (
            "vRemoved006", "Deprecated RPC Layer", "Old video removed from playlist.", "Systems Academy",
            "UC_SYS_ACADEMY_01", "https://www.youtube.com/@systems-academy", "20250101", 900, 1000, 50, 2,
            0, None, None, None, "en", "not_live", "public", None, None, None, None, None, None,
            None, "deprecated-rpc-layer.md", early_iso, "PL_DIST_SYS_01", rem_rel, "sha256:rem", early_iso, 0,
        ),
    ])

conn.executemany(
    """
    INSERT INTO video (
        playlist_id, video_id, position, title, url, channel,
        duration_seconds, first_seen_at, last_seen_at, removed_at, missing_runs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
    videos,
)

conn.executemany(
    """
    INSERT INTO video_detail (
        video_id, title, description, channel, channel_id, channel_url,
        upload_date, duration_seconds, view_count, like_count, comment_count,
        age_limit, categories, tags, chapters, language, live_status,
        availability, thumbnail, comments, subtitle_lang, subtitle_kind,
        transcript, raw_json, unavailable_reason, note_file, fetched_at,
        note_playlist_id, note_path, note_hash, last_checked_at, transcript_attempts
    ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
    )
    """,
    details,
)

if include_ai:
    model_name = "gemini-2.5-flash"
    conn.execute(
        """
        INSERT INTO ai_batch (
            name, display_name, model, state, request_count,
            created_at, updated_at, finished_at, error, purpose
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("batches/fixture-001", "e2e-fixture-batch", model_name, "JOB_STATE_SUCCEEDED", 4, early_iso, now_iso, now_iso, None, "notes"),
    )

    v1_know_rel = "distributed-systems/videos/raft-consensus-log-replication/raft-consensus-log-replication-ai-knowledge.md"
    v1_vis_rel = "distributed-systems/videos/raft-consensus-log-replication/raft-consensus-log-replication-ai-visual-description.md"
    v2_know_rel = "distributed-systems/videos/vector-clocks-causal-ordering/vector-clocks-causal-ordering-ai-knowledge.md"
    v3_prefix = v3_note_rel[:-len(".md")]
    v3_know_rel = f"{v3_prefix}-ai-knowledge.md"

    v1_db_unredacted = "## Key Takeaways\n- Term monotonically increases across elections.\n- Demo config token: sk-proj-REDACTED_TEST_KEY_0001_EXAMPLE\n"
    v1_disk_redacted, _ = ai_secrets.redact(v1_db_unredacted)
    v1_vis_body = "## Visual Diagrams\n- State transition graph: Follower -> Candidate -> Leader.\n"
    v2_body = "## Summary\n- Vector clocks maintain an integer counter per node to track causality.\n"
    v3_body = "## Summary\n- Work-stealing balances uneven async task poll times across CPU cores.\n"

    write_text(v1_know_rel, render_ai_markdown("vDistSys001", "Raft Consensus & Log Replication", "raft-consensus-log-replication.md", "knowledge", model_name, now_iso, "tutorial", 0, v1_disk_redacted))
    write_text(v1_vis_rel, render_ai_markdown("vDistSys001", "Raft Consensus & Log Replication", "raft-consensus-log-replication.md", "visual", model_name, now_iso, "tutorial", 0, v1_vis_body))
    write_text(v2_know_rel, render_ai_markdown("vDistSys002", "Vector Clocks & Causal Ordering", "vector-clocks-causal-ordering.md", "knowledge", model_name, now_iso, "lecture", 1, v2_body))
    write_text(v3_know_rel, render_ai_markdown("vDistSys003", "Tokio Work-Stealing Scheduler", "tokio-work-stealing-scheduler.md", "knowledge", model_name, now_iso, "deep-dive", 0, v3_body))

    conn.executemany(
        """
        INSERT INTO ai_classification (
            video_id, status, category, confidence, source, model,
            prompt_hash, batch_name, chunk_key, error, attempts, requested_at, classified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            ("vDistSys001", "done", "tutorial", 0.96, "model", model_name, "sha256:cls-v1", "batches/fixture-001", "c1", None, 1, early_iso, now_iso),
            ("vDistSys002", "done", "lecture", 0.93, "model", model_name, "sha256:cls-v1", "batches/fixture-001", "c1", None, 1, early_iso, now_iso),
            ("vDistSys003", "done", "deep-dive", 0.95, "model", model_name, "sha256:cls-v1", "batches/fixture-001", "c1", None, 1, early_iso, now_iso),
        ],
    )

    conn.executemany(
        """
        INSERT INTO ai_note (
            video_id, kind, status, mode, batch_name, model, media_resolution,
            prompt_hash, output_text, output_file, finish_reason,
            prompt_tokens, cached_tokens, output_tokens, thinking_tokens,
            error, attempts, requested_at, completed_at, paraphrased
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            ("vDistSys001", "knowledge", "done", "batch", "batches/fixture-001", model_name, "low", "sha256:fixture-v1", v1_db_unredacted, v1_know_rel, "STOP", 1240, 200, 580, 160, None, 1, early_iso, now_iso, 0),
            ("vDistSys001", "visual", "done", "batch", "batches/fixture-001", model_name, "low", "sha256:fixture-v1", v1_vis_body, v1_vis_rel, "STOP", 1100, 150, 420, 110, None, 1, early_iso, now_iso, 0),
            ("vDistSys002", "knowledge", "done", "batch", "batches/fixture-001", model_name, "low", "sha256:fixture-v1", v2_body, v2_know_rel, "STOP", 980, 100, 390, 95, None, 1, early_iso, now_iso, 1),
            ("vDistSys003", "knowledge", "done", "batch", "batches/fixture-001", model_name, "low", "sha256:fixture-v1", v3_body, v3_know_rel, "STOP", 1320, 220, 610, 175, None, 1, early_iso, now_iso, 0),
        ],
    )

    conn.executemany(
        """
        INSERT INTO ai_usage (
            at, purpose, mode, model, video_id, kind,
            prompt_tokens, cached_tokens, output_tokens, thinking_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (now_iso, "notes", "batch", model_name, "vDistSys001", "knowledge", 1240, 200, 580, 160),
            (now_iso, "notes", "batch", model_name, "vDistSys001", "visual", 1100, 150, 420, 110),
            (now_iso, "notes", "batch", model_name, "vDistSys002", "knowledge", 980, 100, 390, 95),
            (now_iso, "notes", "batch", model_name, "vDistSys003", "knowledge", 1320, 220, 610, 175),
        ],
    )

conn.commit()
fk_errors = conn.execute("PRAGMA foreign_key_check").fetchall()
if fk_errors:
    raise RuntimeError(f"Foreign key check failed in youtube fixture: {fk_errors}")
conn.close()
`;

export async function createYoutubeFixtureEnv(
  options?: YoutubeFixtureOptions,
): Promise<YoutubeFixtureEnv> {
  const includeAiTable = options?.includeAiTable ?? true;
  const includeSharedRefNote = options?.includeSharedRefNote ?? true;
  const includeUnavailableVideos = options?.includeUnavailableVideos ?? false;

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hermes-e2e-yt-'));
  const dbPath = path.join(dir, 'youtube-lists.sqlite');
  const notesDir = path.join(dir, 'notes');

  let cleanedUp = false;
  const cleanup = async (): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;
    await fs.promises.rm(dir, { recursive: true, force: true });
  };

  try {
    const payload = JSON.stringify({
      repoRoot: E2E_PATHS.repoRoot,
      dbPath,
      notesDir,
      includeAiTable,
      includeSharedRefNote,
      includeUnavailableVideos,
    });

    await execFileAsync('/usr/bin/python3', ['-B', '-c', PYTHON_FIXTURE_BUILDER, payload], {
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
      timeout: 15_000,
    });
  } catch (err) {
    await cleanup();
    throw err;
  }

  return {
    dir,
    dbPath,
    notesDir,
    playlistId: 'PL_DIST_SYS_01',
    secondPlaylistId: 'PL_RUST_ASYNC_02',
    videoIds: ['vDistSys001', 'vDistSys002', 'vDistSys003'],
    cleanup,
  };
}
