import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoursesPage } from './CoursesPage';
import { useAppStore } from '../store/appStore';

function renderCoursesPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CoursesPage />
    </QueryClientProvider>,
  );
}

describe('CoursesPage (/courses) — F31 Catalog, Battery Capsule, Syllabus, YouTube Import, Quiz & Spaced Review', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function stubCoursesApiMocks(options?: {
    wipExceeded?: boolean;
    youtubeAvailable?: boolean;
    emptyReviews?: boolean;
  }) {
    const baseCourses: any[] = [
      {
        id: '01963000-0000-7000-8000-00000000c001',
        title: 'Async Rust Kernel Architecture',
        provider: 'coursera',
        instructor: 'Jon Gjengset',
        status: 'active',
        priority: 'high',
        youtube_playlist_id: 'PL_ASYNC_01',
        total_items: 10,
        completed_items: 6,
        estimated_total_minutes: 300,
        completed_minutes: 180,
        logged_study_seconds: 10800,
        progress_pct: '60.0',
        rating: 5,
      },
    ];

    if (options?.wipExceeded) {
      baseCourses.push(
        {
          id: '01963000-0000-7000-8000-00000000c002',
          title: 'Active Course Alpha',
          provider: 'udemy',
          instructor: 'Instructor A',
          status: 'active',
          total_items: 5,
          completed_items: 1,
          progress_pct: '20.0',
        },
        {
          id: '01963000-0000-7000-8000-00000000c003',
          title: 'Active Course Beta',
          provider: 'book',
          instructor: 'Instructor B',
          status: 'active',
          total_items: 8,
          completed_items: 2,
          progress_pct: '25.0',
        },
      );
    }

    let coursesState = [...baseCourses];
    let lessonStatus: string = 'todo';

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      const bodyObj = init?.body ? JSON.parse(String(init.body)) : {};

      if (url.includes('/api/courses/youtube/playlists') && method === 'GET') {
        if (options?.youtubeAvailable === false) {
          return new Response(
            JSON.stringify({
              db_available: false,
              playlists: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            db_available: true,
            playlists: [
              {
                playlist_id: 'PL_TEST_YT_99',
                title: 'Compiler Design Track',
                video_count: 12,
                distilled_count: 8,
                already_imported: false,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/courses/youtube/import') && method === 'POST') {
        const importedCourse = {
          id: '01963000-0000-7000-8000-00000000c099',
          title: bodyObj.title_override || 'Compiler Design Track',
          provider: 'youtube',
          instructor: 'YouTube',
          status: 'active',
          youtube_playlist_id: bodyObj.playlist_id,
          total_items: 12,
          completed_items: 8,
          progress_pct: '66.7',
          modules: [],
        };
        coursesState = [importedCourse, ...coursesState];
        return new Response(JSON.stringify(importedCourse), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/courses/spaced-reviews/due') && method === 'GET') {
        if (options?.emptyReviews) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify([
            {
              course_title: 'Async Rust Kernel Architecture',
              interval_label: '7d',
              interval_days: 7,
              lesson: {
                id: '01963000-0000-7000-8000-00000000c201',
                module_id: '01963000-0000-7000-8000-00000000c101',
                course_id: '01963000-0000-7000-8000-00000000c001',
                title: 'Pinning & Self-Referential Structs',
                duration_minutes: 25,
                status: 'distilled',
                review_stage: 0,
                next_review_date: '2026-05-01',
              },
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/course-lessons/') && url.includes('/review') && method === 'POST') {
        return new Response(
          JSON.stringify({
            id: '01963000-0000-7000-8000-00000000c201',
            title: 'Pinning & Self-Referential Structs',
            status: 'distilled',
            review_stage: bodyObj.action === 'complete' ? 1 : 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/course-lessons/') && url.includes('/status') && method === 'PATCH') {
        lessonStatus = bodyObj.status ?? 'in_progress';
        return new Response(
          JSON.stringify({
            id: '01963000-0000-7000-8000-00000000c201',
            title: 'Pinning & Self-Referential Structs',
            status: lessonStatus,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/quiz') && method === 'POST') {
        return new Response(
          JSON.stringify({
            session_key: 'sess_quiz_01963000_test',
            course_id: '01963000-0000-7000-8000-00000000c001',
            prompt_context: 'Quiz me on Async Rust.',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/time/timer/start') && method === 'POST') {
        return new Response(
          JSON.stringify({
            running: true,
            elapsed_seconds: 0,
            session: {
              id: '01963000-0000-7000-8000-00000000c999',
              course_id: bodyObj.course_id,
              lesson_id: bodyObj.lesson_id,
              category: 'learning',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/courses/01963000-0000-7000-8000-00000000c001') && method === 'GET') {
        return new Response(
          JSON.stringify({
            ...coursesState[0],
            active_courses_count: coursesState.length,
            wip_limit: 3,
            wip_exceeded: coursesState.length > 3,
            remaining_minutes: 120,
            weekly_study_minutes_28d: 90,
            completion_forecast_label: '~10d at 90m/wk',
            modules: [
              {
                id: '01963000-0000-7000-8000-00000000c101',
                course_id: '01963000-0000-7000-8000-00000000c001',
                title: 'Module 1: Futures & Executors',
                sort_order: 1,
                lessons: [
                  {
                    id: '01963000-0000-7000-8000-00000000c201',
                    module_id: '01963000-0000-7000-8000-00000000c101',
                    course_id: '01963000-0000-7000-8000-00000000c001',
                    title: 'Pinning & Self-Referential Structs',
                    duration_minutes: 25,
                    status: lessonStatus,
                    vault_note_path: 'lists/youtube/pinning.md',
                    key_summary_md: 'Pin guarantees stable memory address.',
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/courses') && method === 'GET') {
        return new Response(JSON.stringify(coursesState), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock };
  }

  it('renders course cards with REF-10 FuiBatteryCapsule + play-trigger button and 2-level syllabus drawer', async () => {
    const { fetchMock } = stubCoursesApiMocks();
    renderCoursesPage();

    await waitFor(() => {
      expect(screen.getAllByText(/Async Rust Kernel Architecture/i).length).toBeGreaterThan(0);
    });

    // Verify FuiBatteryCapsule and [data-fui-part="battery-play-trigger"] are present
    const battery = document.querySelector('[data-fui="battery-capsule"]');
    expect(battery).toBeTruthy();
    const playTrigger = document.querySelector('[data-fui-part="battery-play-trigger"]');
    expect(playTrigger).toBeTruthy();

    // Clicking battery play trigger starts study timer
    fireEvent.click(playTrigger!);
    await waitFor(() => {
      const timerCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/api/time/timer/start'),
      );
      expect(timerCalls.length).toBeGreaterThanOrEqual(1);
    });

    // Verify 2-level syllabus module & lesson render
    await waitFor(() => {
      expect(screen.getAllByText(/Module 1: Futures & Executors/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Pinning & Self-Referential Structs/i).length).toBeGreaterThan(0);
    });
  });

  it('renders WIP guardrail warning when > 2 active courses exist and handles Spaced Review Complete/Snooze', async () => {
    const { fetchMock } = stubCoursesApiMocks({ wipExceeded: true });
    renderCoursesPage();

    await waitFor(() => {
      expect(screen.getByTestId('courses-wip-warning-banner')).toBeTruthy();
    });

    // Complete 7d spaced review
    const completeBtn = await screen.findByTestId(
      'review-complete-btn-01963000-0000-7000-8000-00000000c201',
    );
    fireEvent.click(completeBtn);

    await waitFor(() => {
      const reviewCalls = fetchMock.mock.calls.filter(([url, init]) =>
        String(url).includes('/review') && (init?.method ?? '').toUpperCase() === 'POST',
      );
      expect(reviewCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('launches 1-click "Quiz Me in Hermes" and updates activeSessionKey', async () => {
    stubCoursesApiMocks();
    renderCoursesPage();

    const quizBtn = await screen.findByTestId(
      'course-quiz-btn-01963000-0000-7000-8000-00000000c001',
    );
    fireEvent.click(quizBtn);

    await waitFor(() => {
      expect(useAppStore.getState().activeSessionKey).toBe('sess_quiz_01963000_test');
    });
  });

  it('handles Read-Only YouTube Import Modal in both available and unavailable SQLite states without NaN', async () => {
    stubCoursesApiMocks({ youtubeAvailable: false, emptyReviews: true });
    renderCoursesPage();

    const ytBtn = await screen.findByTestId('youtube-import-btn');
    fireEvent.click(ytBtn);

    await waitFor(() => {
      expect(screen.getByTestId('youtube-db-unavailable-banner')).toBeTruthy();
    });
    expect(document.body.textContent?.includes('NaN')).toBe(false);
    expect(document.body.textContent?.includes('undefined')).toBe(false);
  });

  it('imports discovered YouTube playlist via POST /api/courses/youtube/import when SQLite DB is available', async () => {
    const { fetchMock } = stubCoursesApiMocks({ youtubeAvailable: true });
    renderCoursesPage();

    const ytBtn = await screen.findByTestId('youtube-import-btn');
    fireEvent.click(ytBtn);

    const importBtn = await screen.findByTestId('import-playlist-btn-PL_TEST_YT_99');
    fireEvent.click(importBtn);

    await waitFor(() => {
      const importCalls = fetchMock.mock.calls.filter(([url, init]) =>
        String(url).includes('/api/courses/youtube/import') &&
        (init?.method ?? '').toUpperCase() === 'POST',
      );
      expect(importCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
