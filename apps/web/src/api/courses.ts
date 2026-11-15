import { apiDelete, apiGet, apiPatch, apiPost, apiPut, unwrapList } from './client';
import {
  clampPercentage,
  computeCourseProgressPct,
  COURSE_PROVIDER_LABELS,
  COURSE_STATUS_LABELS,
  LESSON_STATUS_ORDER,
  nextLessonStatus,
  normalizeCourse,
  normalizeCourseLesson,
  normalizeCourseModule,
  normalizeCoursePriority,
  normalizeCourseProvider,
  normalizeCourseStatus,
  normalizeCourseSyllabus,
  normalizeLessonStatus,
  normalizeSpacedReviewDueItem,
  normalizeYoutubePlaylistsResponse,
  safeFiniteNumber,
  type Course,
  type CourseLesson,
  type CourseModule,
  type CourseModuleWithLessons,
  type CoursePracticeScore,
  type CoursePriority,
  type CourseProvider,
  type CourseQuizResponse,
  type CourseStatus,
  type CourseSyllabusResponse,
  type LessonStatus,
  type SpacedReviewAction,
  type SpacedReviewDueItem,
  type YoutubePlaylistCandidate,
  type YoutubePlaylistsResponse,
} from '../components/courses/coursesModel';

export {
  clampPercentage,
  computeCourseProgressPct,
  COURSE_PROVIDER_LABELS,
  COURSE_STATUS_LABELS,
  LESSON_STATUS_ORDER,
  nextLessonStatus,
  normalizeCourse,
  normalizeCourseLesson,
  normalizeCourseModule,
  normalizeCoursePriority,
  normalizeCourseProvider,
  normalizeCourseStatus,
  normalizeCourseSyllabus,
  normalizeLessonStatus,
  normalizeSpacedReviewDueItem,
  normalizeYoutubePlaylistsResponse,
  safeFiniteNumber,
  type Course,
  type CourseLesson,
  type CourseModule,
  type CourseModuleWithLessons,
  type CoursePracticeScore,
  type CoursePriority,
  type CourseProvider,
  type CourseQuizResponse,
  type CourseStatus,
  type CourseSyllabusResponse,
  type LessonStatus,
  type SpacedReviewAction,
  type SpacedReviewDueItem,
  type YoutubePlaylistCandidate,
  type YoutubePlaylistsResponse,
};

export interface CreateCoursePayload {
  title: string;
  provider?: CourseProvider;
  instructor?: string;
  source_url?: string | null;
  status?: CourseStatus;
  priority?: CoursePriority;
  goal_id?: string | null;
  youtube_playlist_id?: string | null;
  vault_folder_path?: string | null;
  certificate_url?: string | null;
  estimated_total_minutes?: number;
  target_completion_date?: string | null;
  rating?: number | null;
  takeaways_md?: string;
}

export interface UpdateCoursePayload {
  title?: string;
  provider?: CourseProvider;
  instructor?: string;
  source_url?: string | null;
  status?: CourseStatus;
  priority?: CoursePriority;
  goal_id?: string | null;
  youtube_playlist_id?: string | null;
  vault_folder_path?: string | null;
  certificate_url?: string | null;
  practice_scores_json?: CoursePracticeScore[];
  estimated_total_minutes?: number;
  target_completion_date?: string | null;
  rating?: number | null;
  takeaways_md?: string;
}

export interface CreateCourseLessonPayload {
  title: string;
  duration_minutes?: number;
  status?: LessonStatus;
  external_url?: string | null;
  youtube_video_id?: string | null;
  vault_note_path?: string | null;
  key_summary_md?: string;
  sort_order?: number;
}

export interface UpdateCourseLessonPayload {
  title?: string;
  duration_minutes?: number;
  status?: LessonStatus;
  external_url?: string | null;
  youtube_video_id?: string | null;
  vault_note_path?: string | null;
  key_summary_md?: string;
  sort_order?: number;
}

function withQuery(
  basePath: string,
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      qs.set(k, String(v));
    }
  }
  const str = qs.toString();
  return str ? `${basePath}?${str}` : basePath;
}

export async function listCourses(params?: {
  status?: string;
  provider?: string;
  goal_id?: string;
}): Promise<Course[]> {
  const res = await apiGet<unknown>(
    withQuery('/api/courses', {
      status: params?.status,
      provider: params?.provider,
      goal_id: params?.goal_id,
    }),
  );
  return unwrapList<any>(res, ['courses']).map(normalizeCourse);
}

export async function getCourse(id: string): Promise<CourseSyllabusResponse> {
  const res = await apiGet<unknown>(`/api/courses/${encodeURIComponent(id)}`);
  return normalizeCourseSyllabus(res);
}

export async function createCourse(payload: CreateCoursePayload): Promise<CourseSyllabusResponse> {
  const ratingRaw =
    payload.rating !== undefined && payload.rating !== null
      ? Math.round(safeFiniteNumber(payload.rating, Number.NaN))
      : Number.NaN;
  const rating =
    Number.isFinite(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5 ? ratingRaw : undefined;

  const body: Record<string, unknown> = {
    title: payload.title.trim(),
    provider: normalizeCourseProvider(payload.provider ?? 'coursera'),
    instructor: payload.instructor?.trim() ?? '',
    ...(payload.source_url !== undefined ? { source_url: payload.source_url } : {}),
    status: normalizeCourseStatus(payload.status ?? 'active'),
    priority: normalizeCoursePriority(payload.priority ?? 'medium'),
    ...(payload.goal_id !== undefined ? { goal_id: payload.goal_id || null } : {}),
    ...(payload.youtube_playlist_id !== undefined
      ? { youtube_playlist_id: payload.youtube_playlist_id || null }
      : {}),
    ...(payload.vault_folder_path !== undefined
      ? { vault_folder_path: payload.vault_folder_path || null }
      : {}),
    ...(payload.certificate_url !== undefined
      ? { certificate_url: payload.certificate_url || null }
      : {}),
    ...(payload.estimated_total_minutes !== undefined
      ? {
          estimated_total_minutes: Math.max(
            0,
            Math.round(safeFiniteNumber(payload.estimated_total_minutes, 0)),
          ),
        }
      : {}),
    ...(payload.target_completion_date !== undefined
      ? {
          target_completion_date: payload.target_completion_date
            ? String(payload.target_completion_date).slice(0, 10)
            : null,
        }
      : {}),
    ...(rating !== undefined ? { rating } : {}),
    ...(payload.takeaways_md !== undefined ? { takeaways_md: payload.takeaways_md } : {}),
  };

  const res = await apiPost<unknown>('/api/courses', body);
  return normalizeCourseSyllabus(res);
}

export async function updateCourse(
  id: string,
  payload: UpdateCoursePayload,
): Promise<CourseSyllabusResponse> {
  const ratingRaw =
    payload.rating !== undefined && payload.rating !== null
      ? Math.round(safeFiniteNumber(payload.rating, Number.NaN))
      : Number.NaN;
  const rating =
    Number.isFinite(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5 ? ratingRaw : undefined;

  const body: Record<string, unknown> = {
    ...(payload.title !== undefined ? { title: payload.title.trim() } : {}),
    ...(payload.provider !== undefined
      ? { provider: normalizeCourseProvider(payload.provider) }
      : {}),
    ...(payload.instructor !== undefined ? { instructor: payload.instructor.trim() } : {}),
    ...(payload.source_url !== undefined ? { source_url: payload.source_url } : {}),
    ...(payload.status !== undefined ? { status: normalizeCourseStatus(payload.status) } : {}),
    ...(payload.priority !== undefined
      ? { priority: normalizeCoursePriority(payload.priority) }
      : {}),
    ...(payload.goal_id !== undefined ? { goal_id: payload.goal_id || null } : {}),
    ...(payload.vault_folder_path !== undefined
      ? { vault_folder_path: payload.vault_folder_path || null }
      : {}),
    ...(payload.certificate_url !== undefined
      ? { certificate_url: payload.certificate_url || null }
      : {}),
    ...(payload.practice_scores_json !== undefined
      ? { practice_scores_json: payload.practice_scores_json }
      : {}),
    ...(payload.estimated_total_minutes !== undefined
      ? {
          estimated_total_minutes: Math.max(
            0,
            Math.round(safeFiniteNumber(payload.estimated_total_minutes, 0)),
          ),
        }
      : {}),
    ...(payload.target_completion_date !== undefined
      ? {
          target_completion_date: payload.target_completion_date
            ? String(payload.target_completion_date).slice(0, 10)
            : null,
        }
      : {}),
    ...(rating !== undefined ? { rating } : {}),
    ...(payload.takeaways_md !== undefined ? { takeaways_md: payload.takeaways_md } : {}),
  };

  const res = await apiPut<unknown>(`/api/courses/${encodeURIComponent(id)}`, body);
  return normalizeCourseSyllabus(res);
}

export function deleteCourse(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiDelete(`/api/courses/${encodeURIComponent(id)}`);
}

export async function importCourseOutline(
  courseId: string,
  outlineText: string,
): Promise<CourseSyllabusResponse> {
  const res = await apiPost<unknown>(
    `/api/courses/${encodeURIComponent(courseId)}/import-outline`,
    {
      outline_text: outlineText,
    },
  );
  return normalizeCourseSyllabus(res);
}

export async function createCourseModule(
  courseId: string,
  payload: { title: string; sort_order?: number },
): Promise<CourseModule> {
  const res = await apiPost<any>(`/api/courses/${encodeURIComponent(courseId)}/modules`, {
    title: payload.title.trim(),
    ...(payload.sort_order !== undefined
      ? { sort_order: Math.round(safeFiniteNumber(payload.sort_order, 1)) }
      : {}),
  });
  const raw = res?.module ?? res?.data ?? res ?? {};
  return {
    id: String(raw.id ?? ''),
    course_id: String(raw.course_id ?? courseId),
    title: String(raw.title ?? payload.title),
    sort_order: Math.round(safeFiniteNumber(raw.sort_order, 1)),
    created_at: raw.created_at,
  };
}

export function deleteCourseModule(moduleId: string): Promise<{ id: string; deleted: boolean }> {
  return apiDelete(`/api/course-modules/${encodeURIComponent(moduleId)}`);
}

export async function createCourseLesson(
  moduleId: string,
  payload: CreateCourseLessonPayload,
): Promise<CourseLesson> {
  const res = await apiPost<unknown>(
    `/api/course-modules/${encodeURIComponent(moduleId)}/lessons`,
    {
      title: payload.title.trim(),
      duration_minutes: Math.max(0, Math.round(safeFiniteNumber(payload.duration_minutes, 20))),
      status: normalizeLessonStatus(payload.status ?? 'todo'),
      ...(payload.external_url !== undefined ? { external_url: payload.external_url } : {}),
      ...(payload.youtube_video_id !== undefined
        ? { youtube_video_id: payload.youtube_video_id }
        : {}),
      ...(payload.vault_note_path !== undefined
        ? { vault_note_path: payload.vault_note_path }
        : {}),
      ...(payload.key_summary_md !== undefined ? { key_summary_md: payload.key_summary_md } : {}),
      ...(payload.sort_order !== undefined
        ? { sort_order: Math.round(safeFiniteNumber(payload.sort_order, 1)) }
        : {}),
    },
  );
  return normalizeCourseLesson(res);
}

export async function updateCourseLesson(
  lessonId: string,
  payload: UpdateCourseLessonPayload,
): Promise<CourseLesson> {
  const res = await apiPut<unknown>(`/api/course-lessons/${encodeURIComponent(lessonId)}`, {
    ...(payload.title !== undefined ? { title: payload.title.trim() } : {}),
    ...(payload.duration_minutes !== undefined
      ? { duration_minutes: Math.max(0, Math.round(safeFiniteNumber(payload.duration_minutes, 0))) }
      : {}),
    ...(payload.status !== undefined ? { status: normalizeLessonStatus(payload.status) } : {}),
    ...(payload.external_url !== undefined ? { external_url: payload.external_url } : {}),
    ...(payload.vault_note_path !== undefined ? { vault_note_path: payload.vault_note_path } : {}),
    ...(payload.key_summary_md !== undefined ? { key_summary_md: payload.key_summary_md } : {}),
    ...(payload.sort_order !== undefined
      ? { sort_order: Math.round(safeFiniteNumber(payload.sort_order, 1)) }
      : {}),
  });
  return normalizeCourseLesson(res);
}

export async function patchCourseLessonStatus(
  lessonId: string,
  status: LessonStatus,
  key_summary_md?: string,
): Promise<CourseLesson> {
  const res = await apiPatch<unknown>(
    `/api/course-lessons/${encodeURIComponent(lessonId)}/status`,
    {
      status: normalizeLessonStatus(status),
      ...(key_summary_md !== undefined ? { key_summary_md } : {}),
    },
  );
  return normalizeCourseLesson(res);
}

export function deleteCourseLesson(lessonId: string): Promise<{ id: string; deleted: boolean }> {
  return apiDelete(`/api/course-lessons/${encodeURIComponent(lessonId)}`);
}

export async function listYoutubePlaylists(): Promise<YoutubePlaylistsResponse> {
  const res = await apiGet<unknown>('/api/courses/youtube/playlists');
  return normalizeYoutubePlaylistsResponse(res);
}

export async function importYoutubePlaylist(payload: {
  playlist_id: string;
  goal_id?: string | null;
  title_override?: string;
}): Promise<CourseSyllabusResponse> {
  const body: Record<string, unknown> = {
    playlist_id: payload.playlist_id.trim(),
    ...(payload.goal_id ? { goal_id: payload.goal_id } : {}),
    ...(payload.title_override?.trim()
      ? { title_override: payload.title_override.trim() }
      : {}),
  };
  const res = await apiPost<unknown>('/api/courses/youtube/import', body);
  return normalizeCourseSyllabus(res);
}

export async function syncYoutubeCourse(courseId: string): Promise<CourseSyllabusResponse> {
  const res = await apiPost<unknown>(
    `/api/courses/${encodeURIComponent(courseId)}/youtube/sync`,
    {},
  );
  return normalizeCourseSyllabus(res);
}

export async function spawnCourseTodo(
  courseId: string,
  payload: {
    title: string;
    lesson_id?: string | null;
    scheduled_date?: string | null;
  },
): Promise<{ id: string; title: string; course_id?: string | null; lesson_id?: string | null }> {
  const res = await apiPost<any>(`/api/courses/${encodeURIComponent(courseId)}/spawn-todo`, {
    title: payload.title.trim(),
    ...(payload.lesson_id ? { lesson_id: payload.lesson_id } : {}),
    ...(payload.scheduled_date ? { scheduled_date: payload.scheduled_date.slice(0, 10) } : {}),
  });
  const task = res?.task ?? res?.data ?? res ?? {};
  return {
    id: String(task.id ?? ''),
    title: String(task.title ?? payload.title),
    course_id: task.course_id ?? courseId,
    lesson_id: task.lesson_id ?? payload.lesson_id ?? null,
  };
}

export async function createCourseQuiz(
  courseId: string,
  payload?: { lesson_id?: string | null; module_id?: string | null },
): Promise<CourseQuizResponse> {
  const res = await apiPost<any>(`/api/courses/${encodeURIComponent(courseId)}/quiz`, {
    ...(payload?.lesson_id ? { lesson_id: payload.lesson_id } : {}),
    ...(payload?.module_id ? { module_id: payload.module_id } : {}),
  });
  const raw = res?.quiz ?? res?.data ?? res ?? {};
  return {
    session_key: String(raw.session_key ?? `sess_quiz_${courseId}`),
    course_id: String(raw.course_id ?? courseId),
    prompt_context: String(raw.prompt_context ?? ''),
  };
}

export async function listDueSpacedReviews(): Promise<SpacedReviewDueItem[]> {
  const res = await apiGet<unknown>('/api/courses/spaced-reviews/due');
  return unwrapList<any>(res, ['reviews', 'due_reviews', 'items']).map(
    normalizeSpacedReviewDueItem,
  );
}

export async function reviewCourseLesson(
  lessonId: string,
  payload: { action?: SpacedReviewAction; snooze_days?: number } = {},
): Promise<CourseLesson> {
  const res = await apiPost<unknown>(
    `/api/course-lessons/${encodeURIComponent(lessonId)}/review`,
    {
      action: payload.action ?? 'complete',
      ...(payload.snooze_days !== undefined ? { snooze_days: payload.snooze_days } : {}),
    },
  );
  return normalizeCourseLesson(res);
}
