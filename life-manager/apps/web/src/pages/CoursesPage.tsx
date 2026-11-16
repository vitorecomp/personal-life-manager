import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FuiBadge,
  FuiBatteryCapsule,
  FuiButton,
  FuiInput,
  FuiModal,
  FuiPanel,
  FuiSelect,
  FUI_TOKENS,
} from '@hermes/ui';
import {
  clampPercentage,
  COURSE_PROVIDER_LABELS,
  COURSE_STATUS_LABELS,
  createCourse,
  createCourseLesson,
  createCourseModule,
  createCourseQuiz,
  deleteCourse,
  getCourse,
  importCourseOutline,
  importYoutubePlaylist,
  LESSON_STATUS_ORDER,
  listCourses,
  listDueSpacedReviews,
  listYoutubePlaylists,
  nextLessonStatus,
  patchCourseLessonStatus,
  reviewCourseLesson,
  safeFiniteNumber,
  spawnCourseTodo,
  syncYoutubeCourse,
  updateCourse,
  updateCourseLesson,
  type Course,
  type CourseLesson,
  type CourseProvider,
  type CourseStatus,
  type LessonStatus,
  type SpacedReviewAction,
} from '../api/courses';
import { startTimer } from '../api/todos';
import { useAppStore } from '../store/appStore';

export function CoursesPage() {
  const queryClient = useQueryClient();
  const setActiveSessionKey = useAppStore((s) => s.setActiveSessionKey);

  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [userSelectedCourseId, setUserSelectedCourseId] = useState<string | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Course Create Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [courseTitleInput, setCourseTitleInput] = useState('');
  const [courseProviderInput, setCourseProviderInput] = useState<CourseProvider>('coursera');
  const [courseInstructorInput, setCourseInstructorInput] = useState('');
  const [courseStatusInput, setCourseStatusInput] = useState<CourseStatus>('active');
  const [courseEstMinutesInput, setCourseEstMinutesInput] = useState('240');
  const [courseRatingInput, setCourseRatingInput] = useState('5');
  const [courseSourceUrlInput, setCourseSourceUrlInput] = useState('');

  // Bulk Outline Paste State
  const [outlineText, setOutlineText] = useState('');
  const [outlineError, setOutlineError] = useState<string | null>(null);

  // Add Module / Lesson State
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [newLessonModuleId, setNewLessonModuleId] = useState<string>('');
  const [newLessonTitle, setNewLessonTitle] = useState('');
  const [newLessonDuration, setNewLessonDuration] = useState('25');

  // Lesson Summary Editor State
  const [lessonSummaryDraft, setLessonSummaryDraft] = useState('');

  // YouTube Read-Only Import Modal State
  const [youtubeModalOpen, setYoutubeModalOpen] = useState(false);
  const [manualPlaylistIdInput, setManualPlaylistIdInput] = useState('');
  const [manualPlaylistTitleInput, setManualPlaylistTitleInput] = useState('');

  // Queries
  const { data: courses = [] } = useQuery({
    queryKey: ['courses', 'list'],
    queryFn: async () => {
      try {
        return await listCourses();
      } catch {
        return [];
      }
    },
  });

  const filteredCourses = useMemo(() => {
    if (statusFilter === 'ALL') return courses;
    return courses.filter((c) => c.status === statusFilter);
  }, [courses, statusFilter]);

  const selectedCourseId = useMemo(() => {
    if (userSelectedCourseId && courses.some((c) => c.id === userSelectedCourseId)) {
      return userSelectedCourseId;
    }
    return courses[0]?.id ?? null;
  }, [userSelectedCourseId, courses]);

  const { data: selectedSyllabus } = useQuery({
    queryKey: ['courses', 'detail', selectedCourseId],
    enabled: Boolean(selectedCourseId),
    queryFn: async () => {
      if (!selectedCourseId) return null;
      try {
        return await getCourse(selectedCourseId);
      } catch {
        return null;
      }
    },
  });

  const { data: dueReviews = [] } = useQuery({
    queryKey: ['courses', 'spaced-reviews'],
    queryFn: async () => {
      try {
        return await listDueSpacedReviews();
      } catch {
        return [];
      }
    },
  });

  const { data: youtubeData } = useQuery({
    queryKey: ['courses-youtube', 'playlists', youtubeModalOpen],
    queryFn: async () => {
      try {
        return await listYoutubePlaylists();
      } catch {
        return { db_available: false, playlists: [] };
      }
    },
  });

  // WIP Cap Guardrail Calculation (> 2 active courses or backend wip_exceeded)
  const activeCoursesCount = useMemo(() => {
    const localCount = courses.filter(
      (c) => c.status === 'active' || c.status === 'capstone',
    ).length;
    const serverCount = safeFiniteNumber(selectedSyllabus?.active_courses_count, 0);
    return Math.max(localCount, serverCount);
  }, [courses, selectedSyllabus?.active_courses_count]);

  const isWipExceeded = useMemo(() => {
    return activeCoursesCount > 2 || Boolean(selectedSyllabus?.wip_exceeded);
  }, [activeCoursesCount, selectedSyllabus?.wip_exceeded]);

  const activeLesson = useMemo<CourseLesson | null>(() => {
    const allLessons = selectedSyllabus?.modules.flatMap((m) => m.lessons) ?? [];
    if (activeLessonId) {
      const match = allLessons.find((l) => l.id === activeLessonId);
      if (match) return match;
    }
    return allLessons[0] ?? null;
  }, [selectedSyllabus, activeLessonId]);

  const refreshCoursesQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['courses'] }),
      queryClient.invalidateQueries({ queryKey: ['courses-youtube'] }),
    ]);
  };

  // Mutations
  const createCourseMutation = useMutation({
    mutationFn: createCourse,
    onSuccess: async (created) => {
      setUserSelectedCourseId(created.id);
      await refreshCoursesQueries();
    },
  });

  const updateCourseMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateCourse>[1] }) =>
      updateCourse(id, payload),
    onSuccess: async () => {
      await refreshCoursesQueries();
    },
  });

  const deleteCourseMutation = useMutation({
    mutationFn: deleteCourse,
    onSuccess: async () => {
      await refreshCoursesQueries();
    },
  });

  const importOutlineMutation = useMutation({
    mutationFn: ({ courseId, text }: { courseId: string; text: string }) =>
      importCourseOutline(courseId, text),
    onSuccess: async () => {
      await refreshCoursesQueries();
    },
  });

  const createModuleMutation = useMutation({
    mutationFn: ({ courseId, title }: { courseId: string; title: string }) =>
      createCourseModule(courseId, { title }),
    onSuccess: async () => {
      await refreshCoursesQueries();
    },
  });

  const createLessonMutation = useMutation({
    mutationFn: ({
      moduleId,
      title,
      duration_minutes,
    }: {
      moduleId: string;
      title: string;
      duration_minutes: number;
    }) => createCourseLesson(moduleId, { title, duration_minutes }),
    onSuccess: async () => {
      await refreshCoursesQueries();
    },
  });

  const patchLessonStatusMutation = useMutation({
    mutationFn: ({
      lessonId,
      status,
      key_summary_md,
    }: {
      lessonId: string;
      status: LessonStatus;
      key_summary_md?: string;
    }) => patchCourseLessonStatus(lessonId, status, key_summary_md),
    onSuccess: async () => {
      await refreshCoursesQueries();
    },
  });

  const updateLessonMutation = useMutation({
    mutationFn: ({
      lessonId,
      payload,
    }: {
      lessonId: string;
      payload: Parameters<typeof updateCourseLesson>[1];
    }) => updateCourseLesson(lessonId, payload),
    onSuccess: async () => {
      await refreshCoursesQueries();
    },
  });

  const importYoutubeMutation = useMutation({
    mutationFn: importYoutubePlaylist,
    onSuccess: async (imported) => {
      setUserSelectedCourseId(imported.id);
      await refreshCoursesQueries();
    },
  });

  const syncYoutubeMutation = useMutation({
    mutationFn: syncYoutubeCourse,
    onSuccess: async () => {
      await refreshCoursesQueries();
    },
  });

  const spawnTodoMutation = useMutation({
    mutationFn: ({
      courseId,
      title,
      lessonId,
    }: {
      courseId: string;
      title: string;
      lessonId?: string | null;
    }) => spawnCourseTodo(courseId, { title, lesson_id: lessonId }),
  });

  const createQuizMutation = useMutation({
    mutationFn: ({
      courseId,
      lessonId,
      moduleId,
    }: {
      courseId: string;
      lessonId?: string | null;
      moduleId?: string | null;
    }) => createCourseQuiz(courseId, { lesson_id: lessonId, module_id: moduleId }),
  });

  const reviewLessonMutation = useMutation({
    mutationFn: ({
      lessonId,
      action,
      snooze_days,
    }: {
      lessonId: string;
      action: SpacedReviewAction;
      snooze_days?: number;
    }) => reviewCourseLesson(lessonId, { action, snooze_days }),
    onSuccess: async () => {
      await refreshCoursesQueries();
    },
  });

  // Action Handlers
  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const cleanTitle = courseTitleInput.trim();
    if (!cleanTitle) {
      setErrorMessage('Course title must not be empty.');
      return;
    }
    const ratingNum = Math.round(safeFiniteNumber(courseRatingInput, 5));
    if (ratingNum < 1 || ratingNum > 5) {
      setErrorMessage('Course rating must be between 1 and 5.');
      return;
    }

    try {
      const created = await createCourseMutation.mutateAsync({
        title: cleanTitle,
        provider: courseProviderInput,
        instructor: courseInstructorInput.trim(),
        status: courseStatusInput,
        estimated_total_minutes: Math.max(0, Math.round(safeFiniteNumber(courseEstMinutesInput, 180))),
        rating: ratingNum,
        source_url: courseSourceUrlInput.trim() || null,
      });
      setCourseTitleInput('');
      setCourseInstructorInput('');
      setCourseSourceUrlInput('');
      setCreateModalOpen(false);
      setStatusMessage(`Course "${created.title}" created.`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to create course.');
    }
  };

  const handleImportOutline = async (e: React.FormEvent) => {
    e.preventDefault();
    setOutlineError(null);
    setErrorMessage(null);
    if (!selectedCourseId) return;
    const trimmed = outlineText.trim();
    if (!trimmed) {
      setOutlineError('Syllabus outline text cannot be blank.');
      return;
    }
    try {
      await importOutlineMutation.mutateAsync({
        courseId: selectedCourseId,
        text: trimmed,
      });
      setOutlineText('');
      setStatusMessage('Markdown syllabus outline parsed and imported.');
    } catch (err: any) {
      setOutlineError(err?.message || 'Failed to import syllabus outline.');
    }
  };

  const handleStartStudyTimer = async (courseId: string, lessonId?: string | null) => {
    setErrorMessage(null);
    try {
      await startTimer({
        course_id: courseId,
        lesson_id: lessonId ?? null,
        category: 'learning',
        timer_mode: 'pomodoro_25_5',
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hermes:timer-updated'));
      }
      await queryClient.invalidateQueries({ queryKey: ['time-timer'] });
      setStatusMessage('Study Focus Timer started (25m Pomodoro).');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to start study timer.');
    }
  };

  const handleSpawnLabTodo = async (course: Course, lesson?: CourseLesson | null) => {
    setErrorMessage(null);
    const todoTitle = lesson
      ? `Lab Exercise: ${lesson.title} (${course.title})`
      : `Course Lab: ${course.title}`;
    try {
      await spawnTodoMutation.mutateAsync({
        courseId: course.id,
        title: todoTitle,
        lessonId: lesson?.id ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setStatusMessage(`Spawned Lab Todo: "${todoTitle}".`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to spawn lab todo.');
    }
  };

  const handleQuizInHermes = async (
    courseId: string,
    lessonId?: string | null,
    moduleId?: string | null,
  ) => {
    setErrorMessage(null);
    try {
      const res = await createQuizMutation.mutateAsync({
        courseId,
        lessonId,
        moduleId,
      });
      setActiveSessionKey(res.session_key);
      if (typeof window !== 'undefined') {
        const targetUrl = `/hermes?session=${encodeURIComponent(res.session_key)}`;
        try {
          window.history.pushState(null, '', targetUrl);
          window.dispatchEvent(new PopStateEvent('popstate'));
        } catch {
          // Ignore navigation errors in headless test environments
        }
      }
      setStatusMessage(`Launched Socratic Quiz session ${res.session_key} in Hermes.`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to launch Socratic Quiz session.');
    }
  };

  const handleImportYoutubePlaylist = async (playlistId: string, titleOverride?: string) => {
    const cleanId = playlistId.trim();
    if (!cleanId) return;
    setErrorMessage(null);
    try {
      const imported = await importYoutubeMutation.mutateAsync({
        playlist_id: cleanId,
        title_override: titleOverride?.trim() || undefined,
      });
      setYoutubeModalOpen(false);
      setManualPlaylistIdInput('');
      setManualPlaylistTitleInput('');
      setStatusMessage(`Imported YouTube playlist "${imported.title}".`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to import YouTube playlist.');
    }
  };

  const handleSyncYoutubeCourse = async (courseId: string) => {
    setErrorMessage(null);
    try {
      const synced = await syncYoutubeMutation.mutateAsync(courseId);
      setStatusMessage(`Synchronized YouTube notes & lessons for "${synced.title}".`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to synchronize YouTube playlist.');
    }
  };

  const handleReviewAction = async (
    lessonId: string,
    action: SpacedReviewAction,
    snoozeDays?: number,
  ) => {
    setErrorMessage(null);
    try {
      await reviewLessonMutation.mutateAsync({
        lessonId,
        action,
        snooze_days: snoozeDays,
      });
      setStatusMessage(`Spaced review updated (${action.toUpperCase()}).`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to record spaced review.');
    }
  };

  const overallProgressPct = useMemo(() => {
    if (courses.length === 0) return 0;
    const sum = courses.reduce((acc, c) => acc + clampPercentage(c.progress_pct_num, 0), 0);
    return clampPercentage(sum / courses.length, 0);
  }, [courses]);

  return (
    <div
      data-testid="courses-page"
      style={{
        flex: 1,
        padding: '16px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        borderRadius: '0px',
      }}
    >
      {/* Top Command Header & WIP Telemetry */}
      <FuiPanel
        surface="carbon"
        headerTitle="COURSE TRACKER // SYLLABUS, READ-ONLY YOUTUBE AI & 7D/30D/90D SPACED REVIEWS"
        headerProps={{
          title: 'COURSE TRACKER // SYLLABUS, READ-ONLY YOUTUBE AI & 7D/30D/90D SPACED REVIEWS',
          code: 'MOD_10',
          accent: 'cyan',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderRadius: '0px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
              borderRadius: '0px',
            }}
          >
            {/* Status Filter Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {(['ALL', 'active', 'capstone', 'wishlist', 'completed'] as string[]).map(
                (statusKey) => {
                  const isActive = statusFilter === statusKey;
                  return (
                    <button
                      key={statusKey}
                      type="button"
                      onClick={() => setStatusFilter(statusKey)}
                      style={{
                        fontFamily: FUI_TOKENS.fontMono,
                        fontSize: '12px',
                        fontWeight: 700,
                        padding: '6px 10px',
                        backgroundColor: isActive ? FUI_TOKENS.accentCyan : FUI_TOKENS.bgPanel,
                        color: isActive ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                        border: `1px solid ${isActive ? FUI_TOKENS.accentCyan : FUI_TOKENS.borderHairline}`,
                        cursor: 'pointer',
                        borderRadius: '0px',
                      }}
                    >
                      {statusKey.toUpperCase()}
                    </button>
                  );
                },
              )}
            </div>

            {/* Catalog Summary Battery Capsule & Primary Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <FuiBadge tone={isWipExceeded ? 'amber' : 'phosphor'}>
                ACTIVE WIP: {activeCoursesCount} / 2 RECOMMENDED
              </FuiBadge>
              {courses.length === 0 && (
                <FuiBatteryCapsule
                  progressPct={overallProgressPct}
                  segments={10}
                  playAriaLabel="Start study focus timer"
                  onTriggerPlay={() => {
                    if (selectedCourseId) {
                      handleStartStudyTimer(selectedCourseId);
                    }
                  }}
                />
              )}
              <FuiButton
                size="sm"
                variant="secondary"
                data-testid="youtube-import-btn"
                onClick={() => {
                  setErrorMessage(null);
                  setYoutubeModalOpen(true);
                }}
              >
                IMPORT YOUTUBE PLAYLIST
              </FuiButton>
              <FuiButton
                size="sm"
                variant="primary"
                data-testid="new-course-btn"
                onClick={() => {
                  setErrorMessage(null);
                  setCreateModalOpen(true);
                }}
              >
                + NEW COURSE
              </FuiButton>
            </div>
          </div>

          {/* Non-Blocking WIP Limit Warning Banner */}
          {isWipExceeded && (
            <div
              role="alert"
              data-testid="courses-wip-warning-banner"
              style={{
                padding: '10px 12px',
                backgroundColor: '#261409',
                border: `1px solid ${FUI_TOKENS.accentAmber}`,
                color: FUI_TOKENS.accentAmber,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                borderRadius: '0px',
              }}
            >
              <span>
                WIP LIMIT WARNING // Active courses ({activeCoursesCount}) exceed recommended WIP limit (2) — non-blocking guardrail active.
              </span>
              <FuiBadge tone="amber">WIP GUARDRAIL ACTIVE</FuiBadge>
            </div>
          )}

          {statusMessage && (
            <div
              data-testid="courses-status-banner"
              style={{
                padding: '8px 10px',
                backgroundColor: '#0E1F14',
                border: `1px solid ${FUI_TOKENS.accentPhosphor}`,
                color: FUI_TOKENS.accentPhosphor,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              {statusMessage}
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              data-testid="courses-error-banner"
              style={{
                padding: '8px 10px',
                backgroundColor: '#290E0B',
                border: `1px solid ${FUI_TOKENS.accentVermilion}`,
                color: FUI_TOKENS.accentVermilion,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              {errorMessage}
            </div>
          )}
        </div>
      </FuiPanel>

      {/* Course Catalog Cards with REF-10 Segmented Battery Capsule & Play Trigger */}
      <FuiPanel
        surface="carbon"
        headerTitle={`COURSE CATALOG // ${filteredCourses.length} TRACKED COURSES`}
        headerProps={{
          title: `COURSE CATALOG // ${filteredCourses.length} TRACKED COURSES`,
          code: 'CATALOG',
          accent: 'orange',
        }}
      >
        {filteredCourses.length === 0 ? (
          <div
            data-testid="courses-empty-state"
            style={{
              padding: '16px',
              backgroundColor: FUI_TOKENS.bgPanel,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: FUI_TOKENS.inkMuted,
              borderRadius: '0px',
            }}
          >
            NO COURSES IN CATALOG // CLICK &quot;+ NEW COURSE&quot; OR &quot;IMPORT YOUTUBE PLAYLIST&quot; TO INITIALIZE SYLLABUS TRACKING.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderRadius: '0px' }}>
            {filteredCourses.map((course, idx) => {
              const safePct = clampPercentage(course.progress_pct_num, 0);
              const isSelected = selectedCourseId === course.id;
              const studyHours = Math.max(
                0,
                Math.round((safeFiniteNumber(course.logged_study_seconds, 0) / 3600) * 10) / 10,
              );

              return (
                <div
                  key={course.id || idx}
                  data-testid={`course-card-${course.id}`}
                  onClick={() => setUserSelectedCourseId(course.id)}
                  style={{
                    backgroundColor: FUI_TOKENS.bgPanel,
                    border: `1px solid ${
                      isSelected ? FUI_TOKENS.accentCyan : FUI_TOKENS.borderHairline
                    }`,
                    padding: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px',
                    cursor: 'pointer',
                    borderRadius: '0px',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <FuiBadge tone="cyan">CRS.0{idx + 1}</FuiBadge>
                      <FuiBadge tone="orange">
                        {COURSE_PROVIDER_LABELS[course.provider]}
                      </FuiBadge>
                      <FuiBadge
                        tone={
                          course.status === 'completed'
                            ? 'phosphor'
                            : course.status === 'active'
                              ? 'cyan'
                              : 'muted'
                        }
                      >
                        {COURSE_STATUS_LABELS[course.status]}
                      </FuiBadge>
                      {course.instructor && (
                        <span
                          style={{
                            fontFamily: FUI_TOKENS.fontMono,
                            fontSize: '12px',
                            color: FUI_TOKENS.inkMuted,
                          }}
                        >
                          INSTRUCTOR: {course.instructor}
                        </span>
                      )}
                      {course.rating && (
                        <span
                          style={{
                            fontFamily: FUI_TOKENS.fontMono,
                            fontSize: '12px',
                            color: FUI_TOKENS.accentAmber,
                          }}
                        >
                          RATING: {course.rating}/5
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        fontFamily: FUI_TOKENS.fontSans,
                        fontSize: '15px',
                        fontWeight: 700,
                        color: FUI_TOKENS.inkStark,
                      }}
                    >
                      {course.title}
                    </div>

                    <div
                      style={{
                        fontFamily: FUI_TOKENS.fontMono,
                        fontSize: '12px',
                        color: FUI_TOKENS.inkMuted,
                      }}
                    >
                      {course.completed_items}/{course.total_items} LESSONS COMPLETED · STUDY TIME: {studyHours}H · EST: {course.estimated_total_minutes}M
                    </div>
                  </div>

                  {/* Right Slot: REF-10 Segmented Battery Capsule + Play Trigger + Quick Actions */}
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FuiBadge tone={safePct >= 100 ? 'phosphor' : 'cyan'}>{safePct}%</FuiBadge>
                    <FuiBatteryCapsule
                      progressPct={safePct}
                      segments={10}
                      playAriaLabel={`Start study timer for ${course.title}`}
                      onTriggerPlay={() => handleStartStudyTimer(course.id)}
                    />
                    <FuiButton
                      size="sm"
                      variant="secondary"
                      data-testid={`course-quiz-btn-${course.id}`}
                      onClick={() => handleQuizInHermes(course.id)}
                    >
                      Quiz Me in Hermes
                    </FuiButton>
                    <FuiButton
                      size="sm"
                      variant="ghost"
                      data-testid={`course-spawn-todo-btn-${course.id}`}
                      onClick={() => handleSpawnLabTodo(course)}
                    >
                      SPAWN LAB TODO
                    </FuiButton>
                    {course.youtube_playlist_id && (
                      <FuiButton
                        size="sm"
                        variant="ghost"
                        data-testid={`course-youtube-sync-btn-${course.id}`}
                        onClick={() => handleSyncYoutubeCourse(course.id)}
                      >
                        SYNC YOUTUBE
                      </FuiButton>
                    )}
                    <FuiButton
                      size="sm"
                      variant="danger"
                      data-testid={`course-delete-btn-${course.id}`}
                      onClick={async () => {
                        try {
                          await deleteCourseMutation.mutateAsync(course.id);
                        } catch {
                          // Ignore error
                        }
                      }}
                    >
                      DEL
                    </FuiButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </FuiPanel>

      {/* 2-Level Syllabus Drawer / Detail Workbench & Bulk Outline Importer */}
      {selectedSyllabus && (
        <FuiPanel
          surface="carbon"
          data-testid="course-syllabus-drawer"
          headerTitle={`2-LEVEL SYLLABUS WORKBENCH // ${selectedSyllabus.title.toUpperCase()} (${selectedSyllabus.completion_forecast_label})`}
          headerProps={{
            title: `2-LEVEL SYLLABUS WORKBENCH // ${selectedSyllabus.title.toUpperCase()} (${selectedSyllabus.completion_forecast_label})`,
            code: 'SYLLABUS',
            accent: 'phosphor',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '14px',
              borderRadius: '0px',
            }}
          >
            {/* Left Column: Modules -> Lessons Tree */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderRadius: '0px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                }}
              >
                <span style={{ color: FUI_TOKENS.accentCyan, fontWeight: 700 }}>
                  MODULES & LESSONS ({selectedSyllabus.modules.length} MODULES)
                </span>
                <span style={{ color: FUI_TOKENS.inkMuted }}>
                  REMAINING: {selectedSyllabus.remaining_minutes}M · 28D VELOCITY: {selectedSyllabus.weekly_study_minutes_28d}M/WK
                </span>
              </div>

              {selectedSyllabus.modules.length === 0 ? (
                <div
                  style={{
                    padding: '12px',
                    backgroundColor: FUI_TOKENS.bgPanel,
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    color: FUI_TOKENS.inkMuted,
                    borderRadius: '0px',
                  }}
                >
                  No modules imported yet. Paste a Markdown syllabus outline or add a module on the right.
                </div>
              ) : (
                selectedSyllabus.modules.map((mod) => (
                  <div
                    key={mod.id}
                    data-testid={`syllabus-module-${mod.id}`}
                    style={{
                      backgroundColor: FUI_TOKENS.bgPanel,
                      border: `1px solid ${FUI_TOKENS.borderHairline}`,
                      padding: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      borderRadius: '0px',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: FUI_TOKENS.fontMono,
                        fontSize: '12px',
                        fontWeight: 700,
                        color: FUI_TOKENS.accentOrange,
                      }}
                    >
                      {mod.title} ({mod.lessons.length} LESSONS)
                    </div>

                    {mod.lessons.map((lesson) => {
                      const nextSt = nextLessonStatus(lesson.status);
                      return (
                        <div
                          key={lesson.id}
                          data-testid={`syllabus-lesson-${lesson.id}`}
                          onClick={() => {
                            setActiveLessonId(lesson.id);
                            setLessonSummaryDraft(lesson.key_summary_md || '');
                          }}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '8px',
                            padding: '8px',
                            backgroundColor: FUI_TOKENS.bgCarbon,
                            border: `1px solid ${
                              activeLesson?.id === lesson.id
                                ? FUI_TOKENS.accentCyan
                                : FUI_TOKENS.borderHairline
                            }`,
                            fontFamily: FUI_TOKENS.fontMono,
                            fontSize: '12px',
                            cursor: 'pointer',
                            borderRadius: '0px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <FuiBadge
                              tone={
                                lesson.status === 'completed' || lesson.status === 'distilled'
                                  ? 'phosphor'
                                  : lesson.status === 'in_progress'
                                    ? 'cyan'
                                    : 'muted'
                              }
                            >
                              {lesson.status.toUpperCase()}
                            </FuiBadge>
                            <span style={{ color: FUI_TOKENS.inkStark, fontWeight: 600 }}>
                              {lesson.title}
                            </span>
                            <span style={{ color: FUI_TOKENS.inkMuted }}>
                              ({lesson.duration_minutes}m)
                            </span>
                            {lesson.vault_note_path && (
                              <FuiBadge tone="orange">VAULT: {lesson.vault_note_path}</FuiBadge>
                            )}
                          </div>

                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              data-testid={`lesson-status-btn-${lesson.id}`}
                              onClick={async () => {
                                try {
                                  await patchLessonStatusMutation.mutateAsync({
                                    lessonId: lesson.id,
                                    status: nextSt,
                                  });
                                } catch {
                                  // Ignore error
                                }
                              }}
                              style={{
                                fontFamily: FUI_TOKENS.fontMono,
                                fontSize: '12px',
                                padding: '4px 8px',
                                backgroundColor: FUI_TOKENS.bgPanel,
                                color: FUI_TOKENS.accentPhosphor,
                                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                                cursor: 'pointer',
                                borderRadius: '0px',
                              }}
                            >
                              -&gt; {nextSt.toUpperCase()}
                            </button>
                            <button
                              type="button"
                              data-testid={`lesson-timer-btn-${lesson.id}`}
                              onClick={() => handleStartStudyTimer(selectedSyllabus.id, lesson.id)}
                              style={{
                                fontFamily: FUI_TOKENS.fontMono,
                                fontSize: '12px',
                                padding: '4px 8px',
                                backgroundColor: FUI_TOKENS.bgPanel,
                                color: FUI_TOKENS.accentCyan,
                                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                                cursor: 'pointer',
                                borderRadius: '0px',
                              }}
                            >
                              STUDY TIMER
                            </button>
                            <button
                              type="button"
                              data-testid={`lesson-quiz-btn-${lesson.id}`}
                              onClick={() =>
                                handleQuizInHermes(selectedSyllabus.id, lesson.id, mod.id)
                              }
                              style={{
                                fontFamily: FUI_TOKENS.fontMono,
                                fontSize: '12px',
                                padding: '4px 8px',
                                backgroundColor: FUI_TOKENS.bgPanel,
                                color: FUI_TOKENS.accentOrange,
                                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                                cursor: 'pointer',
                                borderRadius: '0px',
                              }}
                            >
                              QUIZ
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Right Column: Bulk Outline Importer + Module/Lesson Add + Active Lesson Notes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderRadius: '0px' }}>
              {/* Bulk Markdown Outline Paste Form */}
              <form
                onSubmit={handleImportOutline}
                style={{
                  backgroundColor: FUI_TOKENS.bgPanel,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                <div style={{ color: FUI_TOKENS.accentOrange, fontWeight: 700 }}>
                  BULK SYLLABUS OUTLINE PASTE (MARKDOWN)
                </div>
                <textarea
                  data-testid="outline-paste-textarea"
                  rows={4}
                  placeholder={`## Module 1: Foundations\n- Ownership & Borrowing (20m)\n- Lifetimes & Traits (25m)`}
                  value={outlineText}
                  onChange={(e) => {
                    setOutlineText(e.target.value);
                    if (outlineError) setOutlineError(null);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px',
                    backgroundColor: FUI_TOKENS.bgCarbon,
                    color: FUI_TOKENS.inkStark,
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    borderRadius: '0px',
                  }}
                />
                {outlineError && (
                  <div
                    role="alert"
                    data-testid="outline-validation-error"
                    style={{ color: FUI_TOKENS.accentVermilion, fontSize: '12px' }}
                  >
                    {outlineError}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <FuiButton
                    type="button"
                    size="sm"
                    variant="primary"
                    data-testid="import-outline-btn"
                    disabled={!outlineText.trim()}
                    onClick={(e) => void handleImportOutline(e)}
                  >
                    IMPORT OUTLINE
                  </FuiButton>
                </div>
              </form>

              {/* Quick Add Module & Lesson */}
              <div
                style={{
                  backgroundColor: FUI_TOKENS.bgPanel,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                <div style={{ color: FUI_TOKENS.accentCyan, fontWeight: 700 }}>
                  ADD MODULE / LESSON
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <FuiInput
                      label="NEW MODULE TITLE"
                      placeholder="Module 2: Consensus"
                      value={newModuleTitle}
                      onChange={(e) => setNewModuleTitle(e.target.value)}
                    />
                  </div>
                  <FuiButton
                    type="button"
                    size="sm"
                    variant="secondary"
                    data-testid="add-module-btn"
                    onClick={async () => {
                      const clean = newModuleTitle.trim();
                      if (!clean || !selectedSyllabus.id) return;
                      try {
                        await createModuleMutation.mutateAsync({
                          courseId: selectedSyllabus.id,
                          title: clean,
                        });
                        setNewModuleTitle('');
                      } catch {
                        // Ignore error
                      }
                    }}
                  >
                    + MODULE
                  </FuiButton>
                </div>

                {selectedSyllabus.modules.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '140px' }}>
                      <FuiSelect
                        label="TARGET MODULE"
                        value={newLessonModuleId || selectedSyllabus.modules[0]!.id}
                        onChange={(e) => setNewLessonModuleId(e.target.value)}
                        options={selectedSyllabus.modules.map((m) => ({
                          value: m.id,
                          label: m.title,
                        }))}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: '140px' }}>
                      <FuiInput
                        label="NEW LESSON TITLE"
                        placeholder="Raft Leader Election"
                        value={newLessonTitle}
                        onChange={(e) => setNewLessonTitle(e.target.value)}
                      />
                    </div>
                    <div style={{ width: '90px' }}>
                      <FuiInput
                        label="MINS"
                        type="number"
                        min={1}
                        value={newLessonDuration}
                        onChange={(e) => setNewLessonDuration(e.target.value)}
                      />
                    </div>
                    <FuiButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      data-testid="add-lesson-btn"
                      onClick={async () => {
                        const clean = newLessonTitle.trim();
                        const modId = newLessonModuleId || selectedSyllabus.modules[0]?.id;
                        if (!clean || !modId) return;
                        try {
                          await createLessonMutation.mutateAsync({
                            moduleId: modId,
                            title: clean,
                            duration_minutes: Math.max(
                              1,
                              Math.round(safeFiniteNumber(newLessonDuration, 25)),
                            ),
                          });
                          setNewLessonTitle('');
                        } catch {
                          // Ignore error
                        }
                      }}
                    >
                      + LESSON
                    </FuiButton>
                  </div>
                )}
              </div>

              {/* Active Lesson Takeaway Workbench */}
              {activeLesson && (
                <div
                  data-testid="active-lesson-workbench"
                  style={{
                    backgroundColor: FUI_TOKENS.bgPanel,
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    padding: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    borderRadius: '0px',
                  }}
                >
                  <div style={{ color: FUI_TOKENS.accentPhosphor, fontWeight: 700 }}>
                    LESSON DISTILLATION NOTES // {activeLesson.title}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {LESSON_STATUS_ORDER.map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={async () => {
                          try {
                            await patchLessonStatusMutation.mutateAsync({
                              lessonId: activeLesson.id,
                              status: st,
                            });
                          } catch {
                            // Ignore
                          }
                        }}
                        style={{
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                          padding: '4px 8px',
                          backgroundColor:
                            activeLesson.status === st
                              ? FUI_TOKENS.accentPhosphor
                              : FUI_TOKENS.bgCarbon,
                          color:
                            activeLesson.status === st
                              ? FUI_TOKENS.bgCarbon
                              : FUI_TOKENS.inkStark,
                          border: `1px solid ${FUI_TOKENS.borderHairline}`,
                          cursor: 'pointer',
                          borderRadius: '0px',
                        }}
                      >
                        {st.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <FuiInput
                    label="KEY TAKEAWAYS & SUMMARY"
                    placeholder="Distilled mental models and key invariants..."
                    value={lessonSummaryDraft}
                    onChange={(e) => setLessonSummaryDraft(e.target.value)}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <FuiButton
                      type="button"
                      size="sm"
                      variant="primary"
                      data-testid="save-lesson-summary-btn"
                      onClick={async () => {
                        try {
                          await updateLessonMutation.mutateAsync({
                            lessonId: activeLesson.id,
                            payload: { key_summary_md: lessonSummaryDraft },
                          });
                          setStatusMessage(`Saved takeaways for "${activeLesson.title}".`);
                        } catch {
                          // Ignore error
                        }
                      }}
                    >
                      SAVE TAKEAWAYS
                    </FuiButton>
                  </div>
                </div>
              )}
            </div>
          </div>
        </FuiPanel>
      )}

      {/* 7d / 30d / 90d Spaced Review Prompts Queue */}
      <FuiPanel
        surface="carbon"
        data-testid="spaced-reviews-panel"
        headerTitle={`7D / 30D / 90D SPACED REVIEW PROMPTS // ${dueReviews.length} DUE FOR RECALL`}
        headerProps={{
          title: `7D / 30D / 90D SPACED REVIEW PROMPTS // ${dueReviews.length} DUE FOR RECALL`,
          code: 'SPACED_REVIEW',
          accent: 'amber',
        }}
      >
        {dueReviews.length === 0 ? (
          <div
            data-testid="spaced-reviews-empty"
            style={{
              padding: '12px',
              backgroundColor: FUI_TOKENS.bgPanel,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: FUI_TOKENS.inkMuted,
              borderRadius: '0px',
            }}
          >
            NO SPACED REVIEWS DUE // All 7d / 30d / 90d distilled course lessons are up to date.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRadius: '0px' }}>
            {dueReviews.map((item) => (
              <div
                key={item.lesson.id}
                data-testid={`spaced-review-item-${item.lesson.id}`}
                style={{
                  padding: '10px',
                  backgroundColor: FUI_TOKENS.bgPanel,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '10px',
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <FuiBadge tone="amber">INTERVAL // {item.interval_label}</FuiBadge>
                  <FuiBadge tone="cyan">{item.course_title}</FuiBadge>
                  <span style={{ color: FUI_TOKENS.inkStark, fontWeight: 700 }}>
                    {item.lesson.title}
                  </span>
                  {item.lesson.next_review_date && (
                    <span style={{ color: FUI_TOKENS.inkMuted }}>
                      DUE: {item.lesson.next_review_date}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <FuiButton
                    size="sm"
                    variant="primary"
                    data-testid={`review-complete-btn-${item.lesson.id}`}
                    onClick={() => handleReviewAction(item.lesson.id, 'complete')}
                  >
                    COMPLETE REVIEW
                  </FuiButton>
                  <FuiButton
                    size="sm"
                    variant="secondary"
                    data-testid={`review-snooze-btn-${item.lesson.id}`}
                    onClick={() => handleReviewAction(item.lesson.id, 'snooze', 3)}
                  >
                    SNOOZE 3D
                  </FuiButton>
                  <FuiButton
                    size="sm"
                    variant="ghost"
                    data-testid={`review-again-btn-${item.lesson.id}`}
                    onClick={() => handleReviewAction(item.lesson.id, 'again')}
                  >
                    AGAIN (7D)
                  </FuiButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </FuiPanel>

      {/* Modal: Create New Course */}
      <FuiModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="CREATE NEW COURSE // SYLLABUS TRACKER"
      >
        <form
          onSubmit={handleCreateCourse}
          style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderRadius: '0px' }}
        >
          <FuiInput
            label="COURSE TITLE"
            placeholder="Enter course title..."
            value={courseTitleInput}
            onChange={(e) => setCourseTitleInput(e.target.value)}
            required
          />
          <FuiSelect
            label="PROVIDER"
            value={courseProviderInput}
            onChange={(e) => setCourseProviderInput(e.target.value as CourseProvider)}
            options={(Object.keys(COURSE_PROVIDER_LABELS) as CourseProvider[]).map((p) => ({
              value: p,
              label: COURSE_PROVIDER_LABELS[p],
            }))}
          />
          <FuiInput
            label="INSTRUCTOR / INSTITUTION"
            placeholder="Instructor or institution..."
            value={courseInstructorInput}
            onChange={(e) => setCourseInstructorInput(e.target.value)}
          />
          <FuiSelect
            label="STATUS"
            value={courseStatusInput}
            onChange={(e) => setCourseStatusInput(e.target.value as CourseStatus)}
            options={(Object.keys(COURSE_STATUS_LABELS) as CourseStatus[]).map((s) => ({
              value: s,
              label: COURSE_STATUS_LABELS[s],
            }))}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <FuiInput
              label="ESTIMATED TOTAL MINUTES"
              type="number"
              min={0}
              value={courseEstMinutesInput}
              onChange={(e) => setCourseEstMinutesInput(e.target.value)}
            />
            <FuiInput
              label="RATING (1..5)"
              type="number"
              min={1}
              max={5}
              value={courseRatingInput}
              onChange={(e) => setCourseRatingInput(e.target.value)}
            />
          </div>
          <FuiInput
            label="SOURCE URL (OPTIONAL)"
            placeholder="https://..."
            value={courseSourceUrlInput}
            onChange={(e) => setCourseSourceUrlInput(e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <FuiButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCreateModalOpen(false)}
            >
              CANCEL
            </FuiButton>
            <FuiButton
              type="button"
              variant="primary"
              size="sm"
              data-testid="confirm-create-course-btn"
              onClick={(e) => void handleCreateCourse(e)}
            >
              CREATE COURSE
            </FuiButton>
          </div>
        </form>
      </FuiModal>

      {/* Modal: Read-Only YouTube Playlist Importer */}
      <FuiModal
        open={youtubeModalOpen}
        onClose={() => setYoutubeModalOpen(false)}
        title="READ-ONLY YOUTUBE CRAWLER PLAYLIST IMPORTER (SQLITE_OPEN_READ_ONLY)"
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            borderRadius: '0px',
          }}
        >
          {!youtubeData?.db_available ? (
            <div
              data-testid="youtube-db-unavailable-banner"
              style={{
                padding: '10px',
                backgroundColor: '#261409',
                border: `1px solid ${FUI_TOKENS.accentAmber}`,
                color: FUI_TOKENS.accentAmber,
                borderRadius: '0px',
              }}
            >
              YOUTUBE SQLITE DB UNAVAILABLE // data/database/youtube-lists.sqlite is not present on disk (Read-Only Mode). Zero files were created.
            </div>
          ) : youtubeData.playlists.length === 0 ? (
            <div style={{ color: FUI_TOKENS.inkMuted }}>
              Connected to youtube-lists.sqlite (read-only), but 0 playlists were found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ color: FUI_TOKENS.accentCyan, fontWeight: 700 }}>
                DISCOVERED YOUTUBE PLAYLISTS ({youtubeData.playlists.length})
              </div>
              {youtubeData.playlists.map((pl) => (
                <div
                  key={pl.playlist_id}
                  data-testid={`youtube-playlist-row-${pl.playlist_id}`}
                  style={{
                    padding: '10px',
                    backgroundColor: FUI_TOKENS.bgCarbon,
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                    flexWrap: 'wrap',
                    borderRadius: '0px',
                  }}
                >
                  <div>
                    <div style={{ color: FUI_TOKENS.inkStark, fontWeight: 700 }}>{pl.title}</div>
                    <div style={{ color: FUI_TOKENS.inkMuted }}>
                      ID: {pl.playlist_id} · VIDEOS: {pl.video_count} · AI DISTILLED: {pl.distilled_count}
                    </div>
                  </div>
                  <FuiButton
                    type="button"
                    size="sm"
                    variant="primary"
                    data-testid={`import-playlist-btn-${pl.playlist_id}`}
                    onClick={() => handleImportYoutubePlaylist(pl.playlist_id, pl.title)}
                  >
                    CONFIRM IMPORT {pl.title.toUpperCase()}
                  </FuiButton>
                </div>
              ))}
            </div>
          )}

          {/* Manual Playlist ID Import Form */}
          <div
            style={{
              padding: '10px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              borderRadius: '0px',
            }}
          >
            <div style={{ color: FUI_TOKENS.accentOrange, fontWeight: 700 }}>
              MANUAL PLAYLIST ID IMPORT
            </div>
            <FuiInput
              label="YOUTUBE PLAYLIST ID"
              placeholder="PL_..."
              value={manualPlaylistIdInput}
              onChange={(e) => setManualPlaylistIdInput(e.target.value)}
            />
            <FuiInput
              label="TITLE OVERRIDE (OPTIONAL)"
              placeholder="Custom Playlist Course Title"
              value={manualPlaylistTitleInput}
              onChange={(e) => setManualPlaylistTitleInput(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <FuiButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setYoutubeModalOpen(false)}
              >
                CLOSE
              </FuiButton>
              <FuiButton
                type="button"
                variant="primary"
                size="sm"
                data-testid="confirm-manual-youtube-import-btn"
                disabled={!manualPlaylistIdInput.trim()}
                onClick={() =>
                  handleImportYoutubePlaylist(manualPlaylistIdInput, manualPlaylistTitleInput)
                }
              >
                CONFIRM IMPORT
              </FuiButton>
            </div>
          </div>
        </div>
      </FuiModal>
    </div>
  );
}
