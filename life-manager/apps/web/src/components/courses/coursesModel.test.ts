import { describe, expect, it } from 'vitest';
import {
  computeCourseProgressPct,
  nextLessonStatus,
  normalizeCourse,
  normalizeCourseSyllabus,
  normalizeSpacedReviewDueItem,
  normalizeYoutubePlaylistsResponse,
} from './coursesModel';

describe('coursesModel — F31 Course Progress Guards, Syllabus Normalizer & Spaced Review', () => {
  it('computeCourseProgressPct handles zero-total courses without NaN or Infinity', () => {
    expect(
      computeCourseProgressPct({
        total_items: 0,
        completed_items: 0,
        estimated_total_minutes: 0,
        completed_minutes: 0,
      }),
    ).toBe(0);

    expect(
      computeCourseProgressPct({
        total_lessons: 10,
        completed_lessons: 6,
      }),
    ).toBe(60);

    expect(
      computeCourseProgressPct({
        progress_pct: '85.5',
      }),
    ).toBe(85.5);
  });

  it('normalizeCourseSyllabus exposes both top-level course fields and res.course', () => {
    const syllabus = normalizeCourseSyllabus({
      id: 'course-1',
      title: 'Concurrency & Async Runtimes',
      provider: 'coursera',
      status: 'active',
      active_courses_count: 4,
      wip_limit: 3,
      wip_exceeded: true,
      completion_forecast_label: '~14d at 120m/wk',
      modules: [
        {
          id: 'mod-1',
          course_id: 'course-1',
          title: 'Module 1: Foundations',
          sort_order: 1,
          lessons: [
            {
              id: 'les-1',
              module_id: 'mod-1',
              course_id: 'course-1',
              title: 'Lesson 1',
              duration_minutes: 20,
              status: 'completed',
            },
            {
              id: 'les-2',
              module_id: 'mod-1',
              course_id: 'course-1',
              title: 'Lesson 2',
              duration_minutes: 25,
              status: 'todo',
            },
          ],
        },
      ],
    });

    expect(syllabus.id).toBe('course-1');
    expect(syllabus.course.id).toBe('course-1');
    expect(syllabus.progress_pct_num).toBe(50);
    expect(syllabus.course.progress_pct_num).toBe(50);
    expect(syllabus.wip_exceeded).toBe(true);
    expect(syllabus.modules.length).toBe(1);
    expect(syllabus.modules[0]!.lessons.length).toBe(2);
  });

  it('nextLessonStatus advances todo -> in_progress -> distilled -> completed', () => {
    expect(nextLessonStatus('todo')).toBe('in_progress');
    expect(nextLessonStatus('in_progress')).toBe('distilled');
    expect(nextLessonStatus('distilled')).toBe('completed');
    expect(nextLessonStatus('completed')).toBe('completed');
  });

  it('normalizeYoutubePlaylistsResponse and normalizeSpacedReviewDueItem normalize payloads cleanly', () => {
    const yt = normalizeYoutubePlaylistsResponse({
      db_available: false,
      playlists: [],
    });
    expect(yt.db_available).toBe(false);
    expect(yt.playlists).toEqual([]);

    const due = normalizeSpacedReviewDueItem({
      course_title: 'Async Rust Deep Dive',
      interval_label: '7d',
      interval_days: 7,
      lesson: {
        id: 'les-99',
        title: 'Pinning & Futures',
        status: 'distilled',
        review_stage: 0,
      },
    });
    expect(due.interval_label).toBe('7d');
    expect(due.lesson.title).toBe('Pinning & Futures');
  });

  it('normalizeCourse clamps rating to 1..5 or null', () => {
    const valid = normalizeCourse({ id: 'c1', title: 'Test', rating: 5 });
    expect(valid.rating).toBe(5);
    const outOfRange = normalizeCourse({ id: 'c2', title: 'Test', rating: 9 });
    expect(outOfRange.rating).toBeNull();
  });

  it('adv_computeCourseProgressPct_and_spacedReview_handle_minutes_fallback_and_review_stage_intervals', () => {
    expect(
      computeCourseProgressPct({
        total_items: 0,
        completed_items: 0,
        estimated_total_minutes: 120,
        completed_minutes: 90,
      }),
    ).toBe(75);

    expect(nextLessonStatus('todo')).toBe('in_progress');
    expect(nextLessonStatus('in_progress')).toBe('distilled');
    expect(nextLessonStatus('distilled')).toBe('completed');
    expect(nextLessonStatus('completed')).toBe('completed');

    const due0 = normalizeSpacedReviewDueItem({
      lesson: { id: 'l1', title: 'Borrow Checker', review_stage: 0 },
      course_title: 'Rust Systems',
    });
    expect(due0.interval_label).toBe('7d');
    expect(due0.interval_days).toBe(7);

    const due1 = normalizeSpacedReviewDueItem({
      lesson: { id: 'l2', title: 'Lifetimes', review_stage: 1 },
      course_title: 'Rust Systems',
    });
    expect(due1.interval_label).toBe('30d');
    expect(due1.interval_days).toBe(30);

    const syllabus = normalizeCourseSyllabus({
      id: 'c1',
      title: 'Rust Track',
      active_courses_count: 5,
      wip_limit: 3,
      modules: [
        {
          id: 'm1',
          title: 'Mod 1',
          lessons: [
            { id: 'l1', title: 'L1', status: 'completed' },
            { id: 'l2', title: 'L2', status: 'todo' },
          ],
        },
      ],
    });
    expect(syllabus.wip_exceeded).toBe(true);
    expect(syllabus.progress_pct_num).toBe(50);
  });
});
