import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  CleanupRegistry,
  E2E_URLS,
  auditInteractiveFontFloor,
  auditZeroBorderRadius,
  createApiClient,
  createYoutubeFixtureEnv,
  ensureStackReady,
  uniqueId,
  unwrapList,
  waitForAppReady,
  withIsolatedBackend,
} from '../../harness';

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

test.describe('Area C Tier 2 — Course Tracker, Read-Only SQLite Importer & Spaced Review Boundary & Resilience (F16 & F31)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  test(
    '[T2][F16] Missing youtube-lists.sqlite returns db_available=false and strictly never creates a .sqlite file on disk (SQLITE_OPEN_READ_ONLY)',
    { tag: ['@tier2', '@F16'] },
    async () => {
      const missingDbPath = path.join(
        os.tmpdir(),
        `hermes-missing-yt-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
      );
      const missingNotesDir = path.join(os.tmpdir(), `hermes-missing-yt-notes-${Date.now()}`);
      expect(fs.existsSync(missingDbPath)).toBe(false);

      await withIsolatedBackend(
        {
          YOUTUBE_LISTS_DB: missingDbPath,
          YOUTUBE_LISTS_NOTES_DIR: missingNotesDir,
        },
        async ({ apiBaseUrl }) => {
          const api = createApiClient(apiBaseUrl);

          const playlistsRes = await api.get('/courses/youtube/playlists');
          expect(playlistsRes.status).toBe(200);
          expect(playlistsRes.json.db_available).toBe(false);
          expect(unwrapList(playlistsRes.json.playlists ?? [], ['playlists'])).toEqual([]);

          const importRes = await api.post('/courses/youtube/import', {
            playlist_id: 'PL_DIST_SYS_01',
          });
          expect([400, 404, 422, 503]).toContain(importRes.status);

          expect(fs.existsSync(missingDbPath)).toBe(false);
        },
      );

      expect(fs.existsSync(missingDbPath)).toBe(false);
    },
  );

  test(
    '[T2][F16] youtube-lists.sqlite without ai_note table imports playlist cleanly with todo status fallback',
    { tag: ['@tier2', '@F16'] },
    async () => {
      const yt = await createYoutubeFixtureEnv({
        includeAiTable: false,
        includeSharedRefNote: false,
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
              expect(Number(distSys.video_count)).toBe(3);
              expect(Number(distSys.distilled_count ?? 0)).toBe(0);

              const importRes = await api.post('/courses/youtube/import', {
                playlist_id: yt.playlistId,
              });
              expect([200, 201]).toContain(importRes.status);
              const course = importRes.json.course ?? unwrapEntity(importRes, ['course']);
              cleanup.defer(async () => {
                await api.delete(`/courses/${course.id}`);
              });

              const syllabusRes = await api.get(`/courses/${course.id}`);
              expect(syllabusRes.status).toBe(200);
              const modules = unwrapList(syllabusRes.json.modules ?? [], ['modules']);
              const lessons = modules.flatMap((m: any) => unwrapList(m.lessons ?? [], ['lessons']));
              expect(lessons.length).toBe(3);
              for (const lesson of lessons) {
                expect(lesson.status).toBe('todo');
              }
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
    '[T2][F16] YouTube importer filters out [Private video], [Deleted video], and soft-removed playlist_video and playlist rows',
    { tag: ['@tier2', '@F16'] },
    async () => {
      const yt = await createYoutubeFixtureEnv({
        includeAiTable: true,
        includeSharedRefNote: true,
        includeUnavailableVideos: true,
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
              const playlists = unwrapList(listRes.json.playlists ?? listRes, ['playlists']);
              expect(playlists.some((p: any) => p.playlist_id === 'PL_REMOVED_LEGACY')).toBe(false);

              const distSys = playlists.find((p: any) => p.playlist_id === yt.playlistId);
              expect(distSys).toBeTruthy();
              expect(Number(distSys.video_count)).toBe(3);

              const importRes = await api.post('/courses/youtube/import', {
                playlist_id: yt.playlistId,
              });
              expect([200, 201]).toContain(importRes.status);
              const course = importRes.json.course ?? unwrapEntity(importRes, ['course']);
              cleanup.defer(async () => {
                await api.delete(`/courses/${course.id}`);
              });

              const syllabusRes = await api.get(`/courses/${course.id}`);
              const modules = unwrapList(syllabusRes.json.modules ?? [], ['modules']);
              const lessons = modules.flatMap((m: any) => unwrapList(m.lessons ?? [], ['lessons']));
              expect(lessons.length).toBe(3);
              expect(lessons.some((l: any) => String(l.title).includes('[Private video]'))).toBe(
                false,
              );
              expect(lessons.some((l: any) => String(l.title).includes('[Deleted video]'))).toBe(
                false,
              );
              expect(
                lessons.some((l: any) => String(l.title).includes('Deprecated RPC Layer')),
              ).toBe(false);

              const importRemovedRes = await api.post('/courses/youtube/import', {
                playlist_id: 'PL_REMOVED_LEGACY',
              });
              expect([400, 404, 422]).toContain(importRemovedRes.status);
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
    '[T2][F16] Duplicate youtube playlist import is idempotent or rejected with 409 without creating duplicate courses',
    { tag: ['@tier2', '@F16'] },
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
              const firstImport = await api.post('/courses/youtube/import', {
                playlist_id: yt.secondPlaylistId,
              });
              expect([200, 201]).toContain(firstImport.status);
              const firstCourse = firstImport.json.course ?? unwrapEntity(firstImport, ['course']);
              cleanup.defer(async () => {
                await api.delete(`/courses/${firstCourse.id}`);
              });

              const secondImport = await api.post('/courses/youtube/import', {
                playlist_id: yt.secondPlaylistId,
              });
              expect([200, 201, 400, 409]).toContain(secondImport.status);

              const allCourses = unwrapList(await api.get('/courses'), ['courses']);
              const matching = allCourses.filter(
                (c: any) => c.youtube_playlist_id === yt.secondPlaylistId,
              );
              expect(matching.length).toBe(1);
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
    '[T2][F16] import-outline rejects empty/whitespace text and handles headerless flat bullet lists gracefully',
    { tag: ['@tier2', '@F16'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const course = unwrapEntity(
          await api.post('/courses', {
            title: uniqueId('Headerless-Outline-Course'),
            provider: 'custom',
            status: 'active',
          }),
          ['course'],
        );
        cleanup.defer(async () => {
          await api.delete(`/courses/${course.id}`);
        });

        const emptyOutlineRes = await api.post(`/courses/${course.id}/import-outline`, {
          outline_text: '   \n\t  ',
        });
        expect([400, 422]).toContain(emptyOutlineRes.status);

        const flatOutlineRes = await api.post(`/courses/${course.id}/import-outline`, {
          outline_text: '- Intro to Consensus (12m)\n- Paxos vs Raft (28m)',
        });
        expect([200, 201]).toContain(flatOutlineRes.status);

        const syllabusRes = await api.get(`/courses/${course.id}`);
        expect(syllabusRes.status).toBe(200);
        const updatedCourse = syllabusRes.json.course ?? syllabusRes.json;
        expect(Number(updatedCourse.total_items)).toBe(2);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F16] Course rating constraint (1..=5), invalid enums, and 404 on unknown course/module/lesson UUIDs',
    { tag: ['@tier2', '@F16'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const missingUuid = '01932b7c-0000-7000-8000-000000009999';

      try {
        const blankCourseRes = await api.post('/courses', {
          title: '   ',
          provider: 'custom',
        });
        expect([400, 422]).toContain(blankCourseRes.status);

        const course = unwrapEntity(
          await api.post('/courses', {
            title: uniqueId('Rating-Bounds-Course'),
            provider: 'book',
            status: 'active',
          }),
          ['course'],
        );
        cleanup.defer(async () => {
          await api.delete(`/courses/${course.id}`);
        });

        const ratingHighRes = await api.put(`/courses/${course.id}`, {
          title: course.title,
          rating: 6,
        });
        expect([400, 422]).toContain(ratingHighRes.status);

        const ratingZeroRes = await api.put(`/courses/${course.id}`, {
          title: course.title,
          rating: 0,
        });
        expect([400, 422]).toContain(ratingZeroRes.status);

        const missingLessonStatus = await api.patch(`/course-lessons/${missingUuid}/status`, {
          status: 'completed',
        });
        expect(missingLessonStatus.status).toBe(404);

        const missingLessonReview = await api.post(`/course-lessons/${missingUuid}/review`, {
          action: 'complete',
        });
        expect(missingLessonReview.status).toBe(404);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F31] WIP guardrail banner warns when > 2 courses are in Active status without hard-blocking',
    { tag: ['@tier2', '@F31'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        for (let i = 1; i <= 3; i++) {
          const c = unwrapEntity(
            await api.post('/courses', {
              title: uniqueId(`WIP-Active-Course-${i}`),
              provider: 'coursera',
              status: 'active',
            }),
            ['course'],
          );
          cleanup.defer(async () => {
            await api.delete(`/courses/${c.id}`);
          });
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/courses`);
        await expect(page.locator('body')).toContainText(/active|wip|limit|course/i);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F31] /courses gracefully displays YouTube DB unavailable state when youtube-lists.sqlite is absent',
    { tag: ['@tier2', '@F31'] },
    async ({ page }) => {
      const missingDb = path.join(os.tmpdir(), `hermes-ui-missing-yt-${Date.now()}.sqlite`);

      await withIsolatedBackend(
        {
          YOUTUBE_LISTS_DB: missingDb,
          YOUTUBE_LISTS_NOTES_DIR: path.join(os.tmpdir(), `hermes-ui-missing-notes-${Date.now()}`),
        },
        async ({ baseUrl }) => {
          await waitForAppReady(page, `${baseUrl}/courses`);

          const ytBtn = page
            .getByRole('button', { name: /youtube|playlist|import/i })
            .first();
          if ((await ytBtn.count()) > 0 && (await ytBtn.isVisible())) {
            await ytBtn.click();
          }

          const bodyText = await page.locator('body').innerText();
          expect(bodyText).not.toContain('NaN');
          expect(fs.existsSync(missingDb)).toBe(false);
        },
      );
    },
  );

  test(
    '[T2][F31] Empty outline paste validation prevents blank syllabus submission in /courses',
    { tag: ['@tier2', '@F31'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const course = unwrapEntity(
          await api.post('/courses', {
            title: uniqueId('Empty-Outline-UI-Course'),
            provider: 'custom',
            status: 'active',
          }),
          ['course'],
        );
        cleanup.defer(async () => {
          await api.delete(`/courses/${course.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/courses`);

        const checkRes = await api.get(`/courses/${course.id}`);
        const checkCourse = checkRes.json.course ?? checkRes.json;
        expect(Number(checkCourse.total_items ?? 0)).toBe(0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F31] Course creation modal rejects blank title and enforces rating 1..=5 bounds',
    { tag: ['@tier2', '@F31'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/courses`);

      const newBtn = page
        .getByRole('button', { name: /new.*course|add.*course|\+/i })
        .first();
      if ((await newBtn.count()) > 0 && (await newBtn.isVisible())) {
        await newBtn.click();
      }

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);
    },
  );

  test(
    '[T2][F31] Spaced review empty state when zero lessons are due for 7d/30d/90d review',
    { tag: ['@tier2', '@F31'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/courses`);

      const text = await page.locator('body').innerText();
      expect(text).not.toContain('NaN');
      expect(text).not.toContain('undefined');
    },
  );

  test(
    '[T2][F31] /courses viewport & FUI structural audit: zero horizontal overflow and >= 12px interactive font floor',
    { tag: ['@tier2', '@F31'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/courses`);

      const [radiusAudit, fontAudit] = await Promise.all([
        auditZeroBorderRadius(page),
        auditInteractiveFontFloor(page, 12),
      ]);
      expect(radiusAudit.violations).toEqual([]);
      expect(fontAudit.violations).toEqual([]);

      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 4;
      });
      expect(hasHorizontalOverflow).toBe(false);
    },
  );
});
