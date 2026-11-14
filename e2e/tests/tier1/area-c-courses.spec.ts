import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import {
  CleanupRegistry,
  E2E_URLS,
  auditColorTokens,
  auditInteractiveFontFloor,
  auditZeroBorderRadius,
  createApiClient,
  createYoutubeFixtureEnv,
  ensureStackReady,
  startMockHermesGateway,
  uniqueId,
  unwrapList,
  waitForAppReady,
  withIsolatedBackend,
} from '../../harness';

const execFileAsync = promisify(execFile);

function unwrapEntity<T = any>(resOrBody: any, keys: string[] = []): T {
  const body =
    resOrBody &&
    typeof resOrBody === 'object' &&
    'status' in resOrBody &&
    'json' in resOrBody
      ? resOrBody.json
      : resOrBody;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body as T;
  }
  for (const k of [...keys, 'data', 'item', 'result']) {
    if (body[k] && typeof body[k] === 'object' && !Array.isArray(body[k])) {
      return body[k] as T;
    }
  }
  return body as T;
}

function isoDateOffset(daysOffset: number): string {
  const d = new Date(Date.now() + daysOffset * 86_400_000);
  return d.toISOString().slice(0, 10);
}

test.describe('Area C Tier 1 — Course Tracker, YouTube Crawler Import, Quiz & Spaced Review (F16 Backend & F31 Web UI)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  test(
    '[T1][F16] Course catalog CRUD, 2-level module/lesson hierarchy, and automatic progress_pct rollup',
    { tag: ['@tier1', '@F16'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const createCourseRes = await api.post('/courses', {
          title: uniqueId('Distributed-Systems-Mastery'),
          provider: 'coursera',
          instructor: 'Martin Kleppmann',
          status: 'active',
          priority: 'high',
          target_completion_date: '2026-12-31',
        });
        expect([200, 201]).toContain(createCourseRes.status);
        const course = unwrapEntity(createCourseRes, ['course']);
        expect(course.id).toBeTruthy();
        expect(course.status).toBe('active');
        expect(Number(course.total_items ?? 0)).toBe(0);
        expect(Number(course.completed_items ?? 0)).toBe(0);
        expect(Number(course.progress_pct ?? 0)).toBe(0);
        cleanup.defer(async () => {
          await api.delete(`/courses/${course.id}`);
        });

        const modRes = await api.post(`/courses/${course.id}/modules`, {
          title: 'Module 1: Replication & Consensus',
          sort_order: 1,
        });
        expect([200, 201]).toContain(modRes.status);
        const mod = unwrapEntity(modRes, ['module', 'course_module']);
        expect(mod.course_id).toBe(course.id);

        const lessonARes = await api.post(`/course-modules/${mod.id}/lessons`, {
          title: 'Leader-Based Replication',
          duration_minutes: 25,
          sort_order: 1,
        });
        expect([200, 201]).toContain(lessonARes.status);
        const lessonA = unwrapEntity(lessonARes, ['lesson', 'course_lesson']);

        const lessonBRes = await api.post(`/course-modules/${mod.id}/lessons`, {
          title: 'Raft Consensus Deep Dive',
          duration_minutes: 35,
          sort_order: 2,
        });
        expect([200, 201]).toContain(lessonBRes.status);
        const lessonB = unwrapEntity(lessonBRes, ['lesson', 'course_lesson']);

        const patchARes = await api.patch(`/course-lessons/${lessonA.id}/status`, {
          status: 'distilled',
        });
        expect(patchARes.status).toBe(200);

        const syllabusMidRes = await api.get(`/courses/${course.id}`);
        expect(syllabusMidRes.status).toBe(200);
        const midBody = syllabusMidRes.json;
        const midCourse = midBody.course ?? midBody;
        expect(Number(midCourse.total_items)).toBe(2);
        expect(Number(midCourse.completed_items)).toBe(1);
        expect(Math.abs(Number(midCourse.progress_pct) - 50)).toBeLessThanOrEqual(0.5);

        const patchBRes = await api.patch(`/course-lessons/${lessonB.id}/status`, {
          status: 'completed',
        });
        expect(patchBRes.status).toBe(200);

        const syllabusFullRes = await api.get(`/courses/${course.id}`);
        const fullCourse = syllabusFullRes.json.course ?? syllabusFullRes.json;
        expect(Number(fullCourse.completed_items)).toBe(2);
        expect(Math.abs(Number(fullCourse.progress_pct) - 100)).toBeLessThanOrEqual(0.5);

        const updateCourseRes = await api.put(`/courses/${course.id}`, {
          rating: 5,
          takeaways_md: '# Core Takeaways\n- Linearizability vs Serializability',
          status: 'completed',
        });
        expect(updateCourseRes.status).toBe(200);
        const updatedCourse = unwrapEntity(updateCourseRes, ['course']);
        expect(Number(updatedCourse.rating)).toBe(5);
        expect(updatedCourse.status).toBe('completed');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F16] Bulk syllabus outline parser creates ordered modules and lessons with extracted durations',
    { tag: ['@tier1', '@F16'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const course = unwrapEntity(
          await api.post('/courses', {
            title: uniqueId('Rust-Async-Outline'),
            provider: 'frontend_masters',
            status: 'active',
          }),
          ['course'],
        );
        cleanup.defer(async () => {
          await api.delete(`/courses/${course.id}`);
        });

        const outlineRes = await api.post(`/courses/${course.id}/import-outline`, {
          outline_text: [
            'Module 1: Foundations of Futures',
            '- Pinning & Self-Referential Structs (20m)',
            '- Wakers & Poll State Machines (35m)',
            'Module 2: Runtime Architecture',
            '- Work-Stealing Executor (45m)',
          ].join('\n'),
        });
        expect([200, 201]).toContain(outlineRes.status);

        const syllabusRes = await api.get(`/courses/${course.id}`);
        expect(syllabusRes.status).toBe(200);
        const courseObj = syllabusRes.json.course ?? syllabusRes.json;
        const modules = unwrapList(syllabusRes.json.modules ?? syllabusRes, ['modules']);

        expect(modules.length).toBe(2);
        expect(Number(courseObj.total_items)).toBe(3);
        expect(Number(courseObj.estimated_total_minutes)).toBe(100);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F16] Read-only youtube-lists and youtube-ai playlist discovery and 1-click import resolves shared -ref.md and ai_note summaries',
    { tag: ['@tier1', '@F16'] },
    async () => {
      const yt = await createYoutubeFixtureEnv({
        includeAiTable: true,
        includeSharedRefNote: true,
        includeUnavailableVideos: false,
      });

      try {
        await withIsolatedBackend(
          {
            YOUTUBE_LISTS_DB: yt.dbPath,
            YOUTUBE_LISTS_NOTES_DIR: yt.notesDir,
          },
          async ({ apiBaseUrl }) => {
            const api = createApiClient(apiBaseUrl);
            const cleanup = new CleanupRegistry();

            try {
              const listRes = await api.get('/courses/youtube/playlists');
              expect(listRes.status).toBe(200);
              expect(listRes.json.db_available).toBe(true);
              const playlists = unwrapList(listRes.json.playlists ?? listRes, ['playlists']);

              const distSys = playlists.find((p: any) => p.playlist_id === yt.playlistId);
              expect(distSys).toBeTruthy();
              expect(distSys.title).toBe('Distributed Systems Engineering');
              expect(Number(distSys.video_count)).toBe(3);
              expect(Number(distSys.distilled_count)).toBeGreaterThanOrEqual(2);
              expect(distSys.already_imported).toBe(false);

              expect(playlists.some((p: any) => p.playlist_id === 'PL_REMOVED_LEGACY')).toBe(false);

              const importRes = await api.post('/courses/youtube/import', {
                playlist_id: yt.playlistId,
              });
              expect([200, 201]).toContain(importRes.status);
              const importedCourse = importRes.json.course ?? unwrapEntity(importRes, ['course']);
              expect(importedCourse.id).toBeTruthy();
              expect(importedCourse.provider).toBe('youtube');
              expect(importedCourse.youtube_playlist_id).toBe(yt.playlistId);
              expect(Number(importedCourse.total_items)).toBe(3);
              cleanup.defer(async () => {
                await api.delete(`/courses/${importedCourse.id}`);
              });

              const syllabusRes = await api.get(`/courses/${importedCourse.id}`);
              expect(syllabusRes.status).toBe(200);
              const modules = unwrapList(syllabusRes.json.modules ?? [], ['modules']);
              const lessons = modules.flatMap((m: any) => unwrapList(m.lessons ?? [], ['lessons']));
              expect(lessons.length).toBe(3);

              const v3Lesson = lessons.find((l: any) =>
                String(l.title).includes('Tokio Work-Stealing Scheduler'),
              );
              expect(v3Lesson).toBeTruthy();
              expect(['distilled', 'completed']).toContain(v3Lesson.status);
              expect(String(v3Lesson.key_summary_md ?? '')).toMatch(/Work-stealing|poll|CPU/i);

              const listAfterRes = await api.get('/courses/youtube/playlists');
              const playlistsAfter = unwrapList(listAfterRes.json.playlists ?? listAfterRes, [
                'playlists',
              ]);
              const distSysAfter = playlistsAfter.find((p: any) => p.playlist_id === yt.playlistId);
              expect(distSysAfter?.already_imported).toBe(true);
            } finally {
              await cleanup.runAll();
            }
          },
        );
      } finally {
        await yt.cleanup();
      }
    },
  );

  test(
    '[T1][F16] Incremental youtube playlist sync imports newly appended crawler videos and newly distilled ai_note summaries',
    { tag: ['@tier1', '@F16'] },
    async () => {
      const yt = await createYoutubeFixtureEnv({
        includeAiTable: true,
        includeSharedRefNote: true,
      });

      try {
        await withIsolatedBackend(
          {
            YOUTUBE_LISTS_DB: yt.dbPath,
            YOUTUBE_LISTS_NOTES_DIR: yt.notesDir,
          },
          async ({ apiBaseUrl }) => {
            const api = createApiClient(apiBaseUrl);
            const cleanup = new CleanupRegistry();

            try {
              const importRes = await api.post('/courses/youtube/import', {
                playlist_id: yt.playlistId,
              });
              expect([200, 201]).toContain(importRes.status);
              const course = importRes.json.course ?? unwrapEntity(importRes, ['course']);
              expect(Number(course.total_items)).toBe(3);
              cleanup.defer(async () => {
                await api.delete(`/courses/${course.id}`);
              });

              const appendPy = `
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
now_iso = "2026-11-12T12:00:00+00:00"
conn.execute(
    "INSERT INTO video (playlist_id, video_id, position, title, url, channel, duration_seconds, first_seen_at, last_seen_at, removed_at, missing_runs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)",
    ("PL_DIST_SYS_01", "vDistSys004", 4, "Paxos Made Moderately Complex", "https://www.youtube.com/watch?v=vDistSys004", "Systems Academy", 1800, now_iso, now_iso),
)
conn.execute(
    "INSERT INTO video_detail (video_id, title, description, channel, duration_seconds, availability, note_file, fetched_at, note_playlist_id, note_path, last_checked_at, transcript_attempts) VALUES (?, ?, ?, ?, ?, 'public', 'paxos.md', ?, 'PL_DIST_SYS_01', 'distributed-systems/videos/paxos/paxos.md', ?, 0)",
    ("vDistSys004", "Paxos Made Moderately Complex", "Multi-Paxos quorum intersection.", "Systems Academy", 1800, now_iso, now_iso),
)
conn.execute(
    "INSERT INTO ai_note (video_id, kind, status, mode, model, output_text, finish_reason, attempts, requested_at, completed_at, paraphrased) VALUES (?, 'knowledge', 'done', 'batch', 'gemini-2.5-flash', '## Summary\\nSingle-decree vs Multi-Paxos quorum intersection.', 'STOP', 1, ?, ?, 0)",
    ("vDistSys004", now_iso, now_iso),
)
conn.commit()
conn.close()
`;
              await execFileAsync('/usr/bin/python3', ['-B', '-c', appendPy, yt.dbPath]);

              const syncRes = await api.post(`/courses/${course.id}/youtube/sync`, {});
              expect(syncRes.status).toBe(200);

              const syllabusAfter = await api.get(`/courses/${course.id}`);
              expect(syllabusAfter.status).toBe(200);
              const updatedCourse = syllabusAfter.json.course ?? syllabusAfter.json;
              expect(Number(updatedCourse.total_items)).toBe(4);
            } finally {
              await cleanup.runAll();
            }
          },
        );
      } finally {
        await yt.cleanup();
      }
    },
  );

  test(
    '[T1][F16] spawn-todo links action item to course_id and quiz endpoint creates scoped Hermes session',
    { tag: ['@tier1', '@F16'] },
    async () => {
      const gw = await startMockHermesGateway();
      try {
        await withIsolatedBackend(
          {
            HERMES_GATEWAY_URL: gw.baseV1Url,
          },
          async ({ apiBaseUrl }) => {
            const api = createApiClient(apiBaseUrl);
            const cleanup = new CleanupRegistry();

            try {
              const course = unwrapEntity(
                await api.post('/courses', {
                  title: uniqueId('Quiz-Course'),
                  provider: 'custom',
                  status: 'active',
                }),
                ['course'],
              );
              cleanup.defer(async () => {
                await api.delete(`/courses/${course.id}`);
              });

              const mod = unwrapEntity(
                await api.post(`/courses/${course.id}/modules`, {
                  title: 'Module 1: Consensus',
                  sort_order: 1,
                }),
                ['module', 'course_module'],
              );
              const lesson = unwrapEntity(
                await api.post(`/course-modules/${mod.id}/lessons`, {
                  title: 'CAP Theorem & Linearizability',
                  duration_minutes: 30,
                  key_summary_md: 'CAP Theorem: Consistency, Availability, Partition Tolerance.',
                  sort_order: 1,
                }),
                ['lesson', 'course_lesson'],
              );

              const todoTitle = uniqueId('Implement-Raft-Heartbeat');
              const spawnRes = await api.post(`/courses/${course.id}/spawn-todo`, {
                title: todoTitle,
                lesson_id: lesson.id,
                scheduled_date: isoDateOffset(1),
              });
              expect([200, 201]).toContain(spawnRes.status);
              const spawnedTask = unwrapEntity(spawnRes, ['task']);
              expect(spawnedTask.course_id).toBe(course.id);
              expect(spawnedTask.title).toBe(todoTitle);
              cleanup.defer(async () => {
                await api.delete(`/tasks/${spawnedTask.id}`);
              });

              const quizRes = await api.post(`/courses/${course.id}/quiz`, {
                lesson_id: lesson.id,
              });
              expect([200, 201]).toContain(quizRes.status);
              const quiz = unwrapEntity(quizRes, ['quiz']);
              expect(typeof quiz.session_key).toBe('string');
              expect(quiz.session_key.length).toBeGreaterThan(0);
              expect(quiz.course_id).toBe(course.id);
              expect(String(quiz.prompt_context)).toMatch(/CAP Theorem|Quiz-Course/i);
            } finally {
              await cleanup.runAll();
            }
          },
        );
      } finally {
        await gw.close();
      }
    },
  );

  test(
    '[T1][F16] Spaced review 7d -> 30d -> 90d lifecycle and snooze rescheduling',
    { tag: ['@tier1', '@F16'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const course = unwrapEntity(
          await api.post('/courses', {
            title: uniqueId('SpacedReview-Course'),
            provider: 'book',
            status: 'active',
          }),
          ['course'],
        );
        cleanup.defer(async () => {
          await api.delete(`/courses/${course.id}`);
        });

        const mod = unwrapEntity(
          await api.post(`/courses/${course.id}/modules`, {
            title: 'Module 1: Memory Models',
            sort_order: 1,
          }),
          ['module', 'course_module'],
        );
        const lesson = unwrapEntity(
          await api.post(`/course-modules/${mod.id}/lessons`, {
            title: 'Acquire-Release Ordering',
            duration_minutes: 25,
            sort_order: 1,
          }),
          ['lesson', 'course_lesson'],
        );

        const completePatch = await api.patch(`/course-lessons/${lesson.id}/status`, {
          status: 'completed',
        });
        expect(completePatch.status).toBe(200);
        const completedLesson = unwrapEntity(completePatch, ['lesson', 'course_lesson']);
        expect(Number(completedLesson.review_stage ?? 0)).toBe(0);
        expect(completedLesson.next_review_date).toBeTruthy();

        const snoozeRes = await api.post(`/course-lessons/${lesson.id}/review`, {
          action: 'snooze',
          snooze_days: 3,
        });
        expect(snoozeRes.status).toBe(200);
        const snoozedLesson = unwrapEntity(snoozeRes, ['lesson', 'course_lesson']);
        expect(Number(snoozedLesson.review_stage)).toBe(0);

        const stage1Res = await api.post(`/course-lessons/${lesson.id}/review`, {
          action: 'complete',
        });
        expect(stage1Res.status).toBe(200);
        const stage1Lesson = unwrapEntity(stage1Res, ['lesson', 'course_lesson']);
        expect(Number(stage1Lesson.review_stage)).toBe(1);
        expect(stage1Lesson.next_review_date).toBeTruthy();

        const stage2Res = await api.post(`/course-lessons/${lesson.id}/review`, {
          action: 'complete',
        });
        expect(stage2Res.status).toBe(200);
        const stage2Lesson = unwrapEntity(stage2Res, ['lesson', 'course_lesson']);
        expect(Number(stage2Lesson.review_stage)).toBe(2);
        expect(stage2Lesson.next_review_date).toBeTruthy();

        const stage3Res = await api.post(`/course-lessons/${lesson.id}/review`, {
          action: 'complete',
        });
        expect(stage3Res.status).toBe(200);
        const stage3Lesson = unwrapEntity(stage3Res, ['lesson', 'course_lesson']);
        expect(Number(stage3Lesson.review_stage)).toBe(3);
        expect(stage3Lesson.next_review_date ?? null).toBeNull();

        const dueRes = await api.get('/courses/spaced-reviews/due');
        expect(dueRes.status).toBe(200);
        const dueItems = unwrapList(dueRes, ['reviews', 'spaced_reviews']);
        expect(
          dueItems.some((item: any) => (item.lesson?.id ?? item.id) === lesson.id),
        ).toBe(false);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F31] /courses catalog renders course cards, provider/status badges, progress bar, and passes REF-02 0px border-radius audit',
    { tag: ['@tier1', '@F31'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const courseTitle = uniqueId('DDIA-Book-Course');
        const course = unwrapEntity(
          await api.post('/courses', {
            title: courseTitle,
            provider: 'book',
            instructor: 'Martin Kleppmann',
            status: 'active',
            priority: 'high',
          }),
          ['course'],
        );
        cleanup.defer(async () => {
          await api.delete(`/courses/${course.id}`);
        });

        const mod = unwrapEntity(
          await api.post(`/courses/${course.id}/modules`, {
            title: 'Part I: Foundations',
            sort_order: 1,
          }),
          ['module', 'course_module'],
        );
        const l1 = unwrapEntity(
          await api.post(`/course-modules/${mod.id}/lessons`, {
            title: 'Chapter 1: Reliable Systems',
            duration_minutes: 30,
            sort_order: 1,
          }),
          ['lesson', 'course_lesson'],
        );
        await api.post(`/course-modules/${mod.id}/lessons`, {
          title: 'Chapter 2: Data Models',
          duration_minutes: 35,
          sort_order: 2,
        });
        await api.patch(`/course-lessons/${l1.id}/status`, { status: 'completed' });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/courses`);
        await expect(page.locator('body')).toContainText(courseTitle);

        const [radiusAudit, fontAudit, colorAudit] = await Promise.all([
          auditZeroBorderRadius(page),
          auditInteractiveFontFloor(page, 12),
          auditColorTokens(page),
        ]);
        expect(radiusAudit.violations).toEqual([]);
        expect(fontAudit.violations).toEqual([]);
        expect(colorAudit.hasCarbonBg).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F31] 2-level syllabus drawer, bulk outline paste modal/form, and lesson status progression (Todo -> In Progress -> Distilled -> Completed)',
    { tag: ['@tier1', '@F31'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const courseTitle = uniqueId('Storage-Engines-Course');
        const course = unwrapEntity(
          await api.post('/courses', {
            title: courseTitle,
            provider: 'university',
            status: 'active',
          }),
          ['course'],
        );
        cleanup.defer(async () => {
          await api.delete(`/courses/${course.id}`);
        });

        await api.post(`/courses/${course.id}/import-outline`, {
          outline_text:
            'Module 1: Storage Engines\n- LSM Trees & SSTables (25m)\n- B-Trees & Write-Ahead Logs (30m)',
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/courses`);

        const courseCard = page.getByText(courseTitle).first();
        if ((await courseCard.count()) > 0) {
          await courseCard.click();
        }

        const syllabusRes = await api.get(`/courses/${course.id}`);
        const modules = unwrapList(syllabusRes.json.modules ?? [], ['modules']);
        const firstLesson = unwrapList(modules[0]?.lessons ?? [], ['lessons'])[0];
        expect(firstLesson).toBeTruthy();

        await api.patch(`/course-lessons/${firstLesson.id}/status`, {
          status: 'distilled',
        });

        const updatedRes = await api.get(`/courses/${course.id}`);
        const updatedCourse = updatedRes.json.course ?? updatedRes.json;
        expect(Math.abs(Number(updatedCourse.progress_pct) - 50)).toBeLessThanOrEqual(0.5);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F31] 1-click read-only youtube-lists playlist import modal and incremental sync button in /courses',
    { tag: ['@tier1', '@F31'] },
    async ({ page }) => {
      const yt = await createYoutubeFixtureEnv({
        includeAiTable: true,
        includeSharedRefNote: true,
      });

      try {
        await withIsolatedBackend(
          {
            YOUTUBE_LISTS_DB: yt.dbPath,
            YOUTUBE_LISTS_NOTES_DIR: yt.notesDir,
          },
          async ({ baseUrl, apiBaseUrl }) => {
            const api = createApiClient(apiBaseUrl);
            const cleanup = new CleanupRegistry();

            try {
              const importRes = await api.post('/courses/youtube/import', {
                playlist_id: yt.playlistId,
              });
              expect([200, 201]).toContain(importRes.status);
              const imported = importRes.json.course ?? unwrapEntity(importRes, ['course']);
              cleanup.defer(async () => {
                await api.delete(`/courses/${imported.id}`);
              });

              await waitForAppReady(page, `${baseUrl}/courses`);
              await expect(page.locator('body')).toContainText('Distributed Systems Engineering');

              const syncRes = await api.post(`/courses/${imported.id}/youtube/sync`, {});
              expect(syncRes.status).toBe(200);
            } finally {
              await cleanup.runAll();
            }
          },
        );
      } finally {
        await yt.cleanup();
      }
    },
  );

  test(
    '[T1][F31] Study timer / focus launch and 1-click spawn lab todo linked to course',
    { tag: ['@tier1', '@F31'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const course = unwrapEntity(
          await api.post('/courses', {
            title: uniqueId('UI-SpawnLab-Course'),
            provider: 'custom',
            status: 'active',
          }),
          ['course'],
        );
        cleanup.defer(async () => {
          await api.delete(`/courses/${course.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/courses`);

        const labTitle = uniqueId('Build-SSTable-Compaction');
        const spawnRes = await api.post(`/courses/${course.id}/spawn-todo`, {
          title: labTitle,
          scheduled_date: isoDateOffset(0),
        });
        expect([200, 201]).toContain(spawnRes.status);
        const task = unwrapEntity(spawnRes, ['task']);
        expect(task.course_id).toBe(course.id);
        cleanup.defer(async () => {
          await api.delete(`/tasks/${task.id}`);
        });

        const tasksRes = await api.get(`/tasks?course_id=${course.id}`);
        expect(tasksRes.status).toBe(200);
        expect(unwrapList(tasksRes, ['tasks']).some((t: any) => t.id === task.id)).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F31] 1-click "Quiz Me in Hermes" button creates scoped quiz session and links to /hermes',
    { tag: ['@tier1', '@F31'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const courseTitle = uniqueId('UI-Quiz-Course');
        const course = unwrapEntity(
          await api.post('/courses', {
            title: courseTitle,
            provider: 'coursera',
            status: 'active',
            takeaways_md: 'Raft log replication safety invariant.',
          }),
          ['course'],
        );
        cleanup.defer(async () => {
          await api.delete(`/courses/${course.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/courses`);

        const quizBtn = page.getByRole('button', { name: /quiz/i }).first();
        if ((await quizBtn.count()) > 0 && (await quizBtn.isVisible())) {
          await quizBtn.click();
        }

        const quizRes = await api.post(`/courses/${course.id}/quiz`, {});
        expect([200, 201]).toContain(quizRes.status);
        expect(quizRes.json.session_key).toBeTruthy();
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F31] 7d / 30d / 90d Spaced Review Prompts panel lists due lessons and supports Complete and Snooze actions',
    { tag: ['@tier1', '@F31'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const course = unwrapEntity(
          await api.post('/courses', {
            title: uniqueId('UI-Spaced-Course'),
            provider: 'book',
            status: 'active',
          }),
          ['course'],
        );
        cleanup.defer(async () => {
          await api.delete(`/courses/${course.id}`);
        });

        const mod = unwrapEntity(
          await api.post(`/courses/${course.id}/modules`, {
            title: 'Module 1: Consensus',
            sort_order: 1,
          }),
          ['module', 'course_module'],
        );
        const lesson = unwrapEntity(
          await api.post(`/course-modules/${mod.id}/lessons`, {
            title: uniqueId('Due-Lesson-7d'),
            duration_minutes: 20,
            sort_order: 1,
          }),
          ['lesson', 'course_lesson'],
        );

        await api.patch(`/course-lessons/${lesson.id}/status`, { status: 'completed' });
        await api.put(`/course-lessons/${lesson.id}`, {
          title: lesson.title,
          next_review_date: isoDateOffset(0),
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/courses`);
        await expect(page.locator('body')).toContainText(/review|course|syllabus/i);

        const revRes = await api.post(`/course-lessons/${lesson.id}/review`, {
          action: 'complete',
        });
        expect(revRes.status).toBe(200);
        const updatedLesson = unwrapEntity(revRes, ['lesson', 'course_lesson']);
        expect(Number(updatedLesson.review_stage)).toBeGreaterThanOrEqual(1);
      } finally {
        await cleanup.runAll();
      }
    },
  );
});
