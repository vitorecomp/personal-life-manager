import { clampPercentage, safeFiniteNumber } from '../goals/goalsModel';

export { clampPercentage, safeFiniteNumber };

export type CourseProvider =
  | 'udemy'
  | 'coursera'
  | 'youtube'
  | 'book'
  | 'certification'
  | 'university'
  | 'frontend_masters'
  | 'custom';

export type CourseStatus =
  | 'wishlist'
  | 'active'
  | 'capstone'
  | 'completed'
  | 'paused'
  | 'dropped';

export type CoursePriority = 'critical' | 'urgent' | 'high' | 'medium' | 'low';

export type LessonStatus = 'todo' | 'in_progress' | 'distilled' | 'completed';

export type SpacedReviewAction = 'complete' | 'snooze' | 'again';

export interface CoursePracticeScore {
  name?: string;
  label?: string;
  score?: number;
  date?: string;
}

export interface Course {
  id: string;
  title: string;
  provider: CourseProvider;
  instructor: string;
  source_url: string | null;
  status: CourseStatus;
  priority: CoursePriority;
  goal_id: string | null;
  youtube_playlist_id: string | null;
  vault_folder_path: string | null;
  certificate_url: string | null;
  practice_scores_json: CoursePracticeScore[];
  total_items: number;
  completed_items: number;
  total_lessons: number;
  completed_lessons: number;
  estimated_total_minutes: number;
  completed_minutes: number;
  logged_study_seconds: number;
  progress_pct: string;
  progress_pct_num: number;
  target_completion_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  rating: number | null;
  takeaways_md: string;
  created_at?: string;
  updated_at?: string;
}

export interface CourseLesson {
  id: string;
  module_id: string;
  course_id: string;
  title: string;
  duration_minutes: number;
  status: LessonStatus;
  external_url: string | null;
  youtube_video_id: string | null;
  vault_note_path: string | null;
  key_summary_md: string;
  completed_at: string | null;
  next_review_date: string | null;
  review_stage: number;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface CourseModule {
  id: string;
  course_id: string;
  title: string;
  sort_order: number;
  created_at?: string;
}

export interface CourseModuleWithLessons extends CourseModule {
  lessons: CourseLesson[];
}

export interface CourseSyllabusResponse extends Course {
  course: Course;
  modules: CourseModuleWithLessons[];
  active_courses_count: number;
  wip_limit: number;
  wip_exceeded: boolean;
  wip_warning: string | null;
  remaining_minutes: number;
  weekly_study_minutes_28d: number;
  estimated_completion_date: string | null;
  completion_forecast_label: string;
}

export interface YoutubePlaylistCandidate {
  playlist_id: string;
  title: string;
  video_count: number;
  distilled_count: number;
  already_imported: boolean;
}

export interface YoutubePlaylistsResponse {
  db_available: boolean;
  playlists: YoutubePlaylistCandidate[];
}

export interface CourseQuizResponse {
  session_key: string;
  course_id: string;
  prompt_context: string;
}

export interface SpacedReviewDueItem {
  lesson: CourseLesson;
  course_title: string;
  interval_label: '7d' | '30d' | '90d' | '180d';
  interval_days: number;
}

export const COURSE_PROVIDER_LABELS: Record<CourseProvider, string> = {
  coursera: 'COURSERA',
  udemy: 'UDEMY',
  youtube: 'YOUTUBE // AI',
  book: 'TECHNICAL BOOK',
  certification: 'CERTIFICATION',
  university: 'UNIVERSITY',
  frontend_masters: 'FRONTEND MASTERS',
  custom: 'CUSTOM TRACK',
};

export const COURSE_STATUS_LABELS: Record<CourseStatus, string> = {
  active: 'ACTIVE',
  capstone: 'CAPSTONE',
  wishlist: 'WISHLIST',
  completed: 'COMPLETED',
  paused: 'PAUSED',
  dropped: 'DROPPED',
};

export const LESSON_STATUS_ORDER: LessonStatus[] = [
  'todo',
  'in_progress',
  'distilled',
  'completed',
];

export function normalizeCourseProvider(raw: unknown): CourseProvider {
  const s = String(raw ?? 'custom').trim().toLowerCase();
  if (
    s === 'udemy' ||
    s === 'coursera' ||
    s === 'youtube' ||
    s === 'book' ||
    s === 'certification' ||
    s === 'university' ||
    s === 'frontend_masters' ||
    s === 'custom'
  ) {
    return s;
  }
  return 'custom';
}

export function normalizeCourseStatus(raw: unknown): CourseStatus {
  const s = String(raw ?? 'active').trim().toLowerCase();
  if (
    s === 'wishlist' ||
    s === 'active' ||
    s === 'capstone' ||
    s === 'completed' ||
    s === 'paused' ||
    s === 'dropped'
  ) {
    return s;
  }
  return 'active';
}

export function normalizeCoursePriority(raw: unknown): CoursePriority {
  const s = String(raw ?? 'medium').trim().toLowerCase();
  if (s === 'critical' || s === 'urgent' || s === 'high' || s === 'medium' || s === 'low') {
    return s;
  }
  return 'medium';
}

export function normalizeLessonStatus(raw: unknown): LessonStatus {
  const s = String(raw ?? 'todo').trim().toLowerCase();
  if (s === 'done' || s === 'completed') return 'completed';
  if (s === 'in_progress' || s === 'distilled') return s;
  return 'todo';
}

export function nextLessonStatus(current: LessonStatus): LessonStatus {
  const idx = LESSON_STATUS_ORDER.indexOf(current);
  if (idx < 0 || idx >= LESSON_STATUS_ORDER.length - 1) return 'completed';
  return LESSON_STATUS_ORDER[idx + 1]!;
}

export function computeCourseProgressPct(raw: {
  progress_pct?: unknown;
  total_items?: unknown;
  completed_items?: unknown;
  total_lessons?: unknown;
  completed_lessons?: unknown;
  estimated_total_minutes?: unknown;
  completed_minutes?: unknown;
}): number {
  const serverPct = safeFiniteNumber(raw?.progress_pct, Number.NaN);
  const totalItems = Math.max(
    0,
    Math.round(safeFiniteNumber(raw?.total_items ?? raw?.total_lessons, 0)),
  );
  const completedItems = Math.max(
    0,
    Math.round(safeFiniteNumber(raw?.completed_items ?? raw?.completed_lessons, 0)),
  );

  if (Number.isFinite(serverPct) && serverPct > 0) {
    return clampPercentage(serverPct, 0);
  }
  if (totalItems > 0) {
    return clampPercentage((completedItems / totalItems) * 100, 0);
  }
  if (Number.isFinite(serverPct)) {
    return clampPercentage(serverPct, 0);
  }

  const totalMins = Math.max(0, Math.round(safeFiniteNumber(raw?.estimated_total_minutes, 0)));
  const doneMins = Math.max(0, Math.round(safeFiniteNumber(raw?.completed_minutes, 0)));
  if (totalMins > 0) {
    return clampPercentage((doneMins / totalMins) * 100, 0);
  }
  return 0;
}

export function normalizeCourseLesson(raw: any): CourseLesson {
  const obj = raw?.lesson ?? raw?.data ?? raw ?? {};
  const stage = Math.max(0, Math.min(3, Math.round(safeFiniteNumber(obj.review_stage, 0))));
  return {
    id: String(obj.id ?? ''),
    module_id: String(obj.module_id ?? ''),
    course_id: String(obj.course_id ?? ''),
    title: String(obj.title ?? 'Lesson').trim() || 'Lesson',
    duration_minutes: Math.max(0, Math.round(safeFiniteNumber(obj.duration_minutes, 15))),
    status: normalizeLessonStatus(obj.status),
    external_url: obj.external_url ? String(obj.external_url) : null,
    youtube_video_id: obj.youtube_video_id ? String(obj.youtube_video_id) : null,
    vault_note_path: obj.vault_note_path ? String(obj.vault_note_path) : null,
    key_summary_md: String(obj.key_summary_md ?? ''),
    completed_at: obj.completed_at ? String(obj.completed_at) : null,
    next_review_date: obj.next_review_date ? String(obj.next_review_date).slice(0, 10) : null,
    review_stage: stage,
    sort_order: Math.round(safeFiniteNumber(obj.sort_order, 1)),
    created_at: obj.created_at,
    updated_at: obj.updated_at,
  };
}

export function normalizeCourseModule(raw: any): CourseModuleWithLessons {
  const obj = raw?.module ?? raw?.data ?? raw ?? {};
  const lessons: CourseLesson[] = Array.isArray(obj.lessons)
    ? obj.lessons.map(normalizeCourseLesson)
    : [];
  return {
    id: String(obj.id ?? ''),
    course_id: String(obj.course_id ?? ''),
    title: String(obj.title ?? 'Module').trim() || 'Module',
    sort_order: Math.round(safeFiniteNumber(obj.sort_order, 1)),
    created_at: obj.created_at,
    lessons,
  };
}

export function normalizeCourse(raw: any): Course {
  const obj = raw?.course ?? raw?.data ?? raw ?? {};
  const totalItems = Math.max(
    0,
    Math.round(safeFiniteNumber(obj.total_items ?? obj.total_lessons, 0)),
  );
  const completedItems = Math.max(
    0,
    Math.round(safeFiniteNumber(obj.completed_items ?? obj.completed_lessons, 0)),
  );
  const estMins = Math.max(0, Math.round(safeFiniteNumber(obj.estimated_total_minutes, 0)));
  const doneMins = Math.max(0, Math.round(safeFiniteNumber(obj.completed_minutes, 0)));
  const loggedSec = Math.max(0, Math.round(safeFiniteNumber(obj.logged_study_seconds, doneMins * 60)));

  const pctNum = computeCourseProgressPct({
    progress_pct: obj.progress_pct,
    total_items: totalItems,
    completed_items: completedItems,
    estimated_total_minutes: estMins,
    completed_minutes: doneMins,
  });

  const ratingRaw = safeFiniteNumber(obj.rating, Number.NaN);
  const rating =
    Number.isFinite(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5
      ? Math.round(ratingRaw)
      : null;

  return {
    id: String(obj.id ?? ''),
    title: String(obj.title ?? 'Untitled Course').trim() || 'Untitled Course',
    provider: normalizeCourseProvider(obj.provider),
    instructor: String(obj.instructor ?? ''),
    source_url: obj.source_url ? String(obj.source_url) : null,
    status: normalizeCourseStatus(obj.status),
    priority: normalizeCoursePriority(obj.priority),
    goal_id: obj.goal_id ? String(obj.goal_id) : null,
    youtube_playlist_id: obj.youtube_playlist_id ? String(obj.youtube_playlist_id) : null,
    vault_folder_path: obj.vault_folder_path ? String(obj.vault_folder_path) : null,
    certificate_url: obj.certificate_url ? String(obj.certificate_url) : null,
    practice_scores_json: Array.isArray(obj.practice_scores_json) ? obj.practice_scores_json : [],
    total_items: totalItems,
    completed_items: completedItems,
    total_lessons: totalItems,
    completed_lessons: completedItems,
    estimated_total_minutes: estMins,
    completed_minutes: doneMins,
    logged_study_seconds: loggedSec,
    progress_pct: String(pctNum),
    progress_pct_num: pctNum,
    target_completion_date: obj.target_completion_date
      ? String(obj.target_completion_date).slice(0, 10)
      : null,
    started_at: obj.started_at ? String(obj.started_at) : null,
    completed_at: obj.completed_at ? String(obj.completed_at) : null,
    rating,
    takeaways_md: String(obj.takeaways_md ?? ''),
    created_at: obj.created_at,
    updated_at: obj.updated_at,
  };
}

export function normalizeCourseSyllabus(raw: any): CourseSyllabusResponse {
  const top = raw?.data ?? raw ?? {};
  const modules: CourseModuleWithLessons[] = Array.isArray(top.modules)
    ? top.modules.map(normalizeCourseModule)
    : [];

  const allLessons = modules.flatMap((m) => m.lessons);
  const doneLessonCount = allLessons.filter(
    (l) => l.status === 'distilled' || l.status === 'completed',
  ).length;

  const baseCourse = normalizeCourse({
    ...(top.course && typeof top.course === 'object' ? top.course : top),
    total_items:
      allLessons.length > 0
        ? allLessons.length
        : (top.course?.total_items ?? top.total_items ?? 0),
    completed_items:
      allLessons.length > 0
        ? doneLessonCount
        : (top.course?.completed_items ?? top.completed_items ?? 0),
  });

  const activeCount = Math.max(0, Math.round(safeFiniteNumber(top.active_courses_count, 1)));
  const wipLimit = Math.max(1, Math.round(safeFiniteNumber(top.wip_limit, 3)));
  const wipExceeded = Boolean(top.wip_exceeded ?? activeCount > wipLimit);
  const remainingMinutes = Math.max(
    0,
    Math.round(
      safeFiniteNumber(
        top.remaining_minutes,
        Math.max(0, baseCourse.estimated_total_minutes - baseCourse.completed_minutes),
      ),
    ),
  );
  const weeklyVelocity = Math.max(
    0,
    Math.round(safeFiniteNumber(top.weekly_study_minutes_28d, 0) * 10) / 10,
  );

  return {
    ...baseCourse,
    course: baseCourse,
    modules,
    active_courses_count: activeCount,
    wip_limit: wipLimit,
    wip_exceeded: wipExceeded,
    wip_warning: top.wip_warning ? String(top.wip_warning) : null,
    remaining_minutes: remainingMinutes,
    weekly_study_minutes_28d: weeklyVelocity,
    estimated_completion_date: top.estimated_completion_date
      ? String(top.estimated_completion_date).slice(0, 10)
      : null,
    completion_forecast_label: String(
      top.completion_forecast_label ??
        (baseCourse.progress_pct_num >= 100 ? 'COMPLETED' : 'AWAITING_STUDY_VELOCITY'),
    ),
  };
}

export function normalizeYoutubePlaylistsResponse(raw: any): YoutubePlaylistsResponse {
  const obj = raw?.data ?? raw ?? {};
  const db_available = Boolean(obj.db_available);
  const playlists: YoutubePlaylistCandidate[] = Array.isArray(obj.playlists)
    ? obj.playlists.map((p: any) => ({
        playlist_id: String(p?.playlist_id ?? p?.id ?? ''),
        title: String(p?.title ?? 'YouTube Playlist'),
        video_count: Math.max(0, Math.round(safeFiniteNumber(p?.video_count, 0))),
        distilled_count: Math.max(0, Math.round(safeFiniteNumber(p?.distilled_count, 0))),
        already_imported: Boolean(p?.already_imported),
      }))
    : [];
  return {
    db_available,
    playlists,
  };
}

export function normalizeSpacedReviewDueItem(raw: any): SpacedReviewDueItem {
  const obj = raw?.data ?? raw ?? {};
  const lesson = normalizeCourseLesson(obj.lesson ?? obj);
  const stage = lesson.review_stage;
  const fallbackLabel = stage === 0 ? '7d' : stage === 1 ? '30d' : '90d';
  const fallbackDays = stage === 0 ? 7 : stage === 1 ? 30 : 90;
  const labelRaw = String(obj.interval_label ?? fallbackLabel);
  const interval_label =
    labelRaw === '7d' || labelRaw === '30d' || labelRaw === '90d' || labelRaw === '180d'
      ? labelRaw
      : fallbackLabel;

  return {
    lesson,
    course_title: String(obj.course_title ?? 'Course Module'),
    interval_label,
    interval_days: Math.max(1, Math.round(safeFiniteNumber(obj.interval_days, fallbackDays))),
  };
}
