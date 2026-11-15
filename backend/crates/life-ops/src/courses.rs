//! Module 10 — Course Tracker, Read-Only YouTube Crawler Import & Spaced Review (`F16`).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use chrono::{Duration, Utc};
use hermes_domain::courses::{
    Course, CourseLesson, CourseModule, CourseModuleWithLessons, CourseProvider, CourseQuizRequest,
    CourseQuizResponse, CourseStatus, CourseSyllabusResponse, CreateCourseLessonRequest,
    CreateCourseModuleRequest, CreateCourseRequest, ImportOutlineRequest,
    ImportYoutubePlaylistRequest, LessonStatus, ReviewLessonRequest, SpacedReviewAction,
    SpacedReviewDueItem, SpawnCourseTodoRequest, UpdateCourseLessonRequest,
    UpdateCourseModuleRequest, UpdateCourseRequest, UpdateLessonStatusRequest,
    YoutubePlaylistCandidate, YoutubePlaylistsResponse,
};
use hermes_domain::error::ApiError;
use hermes_domain::events::SystemEvent;
use hermes_domain::id::new_uuid_v7;
use hermes_domain::todos::{CreateTaskRequest, Task, TaskEnergyLevel, TaskStatus};
use rusqlite::{Connection, OpenFlags};
use rust_decimal::Decimal;
use sqlx::Row;
use uuid::Uuid;

use crate::service::LifeOpsService;

const ACTIVE_COURSE_WIP_LIMIT: i32 = 3;

impl LifeOpsService {
    // =========================================================================
    // 1. Courses CRUD, WIP Guardrail & 28-Day Completion Forecast
    // =========================================================================

    pub async fn list_courses(
        &self,
        status: Option<CourseStatus>,
        provider: Option<CourseProvider>,
        goal_id: Option<Uuid>,
    ) -> Result<Vec<Course>, ApiError> {
        let mut courses = sqlx::query_as::<_, Course>(
            "SELECT * FROM courses ORDER BY updated_at DESC, created_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        if let Some(s) = status {
            courses.retain(|c| c.status == s);
        }
        if let Some(p) = provider {
            courses.retain(|c| c.provider == p);
        }
        if let Some(gid) = goal_id {
            courses.retain(|c| c.goal_id == Some(gid));
        }
        Ok(courses)
    }

    async fn fetch_course_row(&self, id: Uuid) -> Result<Course, ApiError> {
        sqlx::query_as::<_, Course>("SELECT * FROM courses WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| ApiError::not_found(format!("Course {id} not found")))
    }

    pub async fn get_course(&self, id: Uuid) -> Result<CourseSyllabusResponse, ApiError> {
        let course = self.recalculate_course_rollups(id).await?;
        self.build_course_syllabus_response(course).await
    }

    pub async fn create_course(
        &self,
        req: CreateCourseRequest,
    ) -> Result<CourseSyllabusResponse, ApiError> {
        let title = req.title.trim();
        if title.is_empty() {
            return Err(ApiError::bad_request("Course title must not be empty"));
        }
        if req.estimated_total_minutes < 0 {
            return Err(ApiError::bad_request(
                "estimated_total_minutes must be non-negative",
            ));
        }

        let started_at = if matches!(req.status, CourseStatus::Active | CourseStatus::Capstone) {
            Some(Utc::now())
        } else {
            None
        };
        let completed_at = if req.status == CourseStatus::Completed {
            Some(Utc::now())
        } else {
            None
        };

        let id = new_uuid_v7();
        let course = sqlx::query_as::<_, Course>(
            r#"
            INSERT INTO courses (
                id, title, provider, instructor, source_url, status, priority,
                goal_id, youtube_playlist_id, vault_folder_path,
                estimated_total_minutes, target_completion_date, started_at, completed_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(title)
        .bind(req.provider)
        .bind(req.instructor.trim())
        .bind(req.source_url)
        .bind(req.status)
        .bind(req.priority)
        .bind(req.goal_id)
        .bind(req.youtube_playlist_id)
        .bind(req.vault_folder_path)
        .bind(req.estimated_total_minutes)
        .bind(req.target_completion_date)
        .bind(started_at)
        .bind(completed_at)
        .fetch_one(&self.pool)
        .await?;

        if let Some(goal_id) = course.goal_id {
            let _ = self.recalculate_goal_rollups(goal_id).await;
        }

        self.build_course_syllabus_response(course).await
    }

    pub async fn update_course(
        &self,
        id: Uuid,
        req: UpdateCourseRequest,
    ) -> Result<CourseSyllabusResponse, ApiError> {
        let existing = self.fetch_course_row(id).await?;
        let title = req
            .title
            .map(|t| t.trim().to_string())
            .unwrap_or(existing.title);
        if title.is_empty() {
            return Err(ApiError::bad_request("Course title must not be empty"));
        }
        if let Some(rating) = req.rating
            && !(1..=5).contains(&rating)
        {
            return Err(ApiError::bad_request(
                "Course rating must be between 1 and 5",
            ));
        }

        let provider = req.provider.unwrap_or(existing.provider);
        let instructor = req.instructor.unwrap_or(existing.instructor);
        let source_url = req.source_url.or(existing.source_url);
        let status = req.status.unwrap_or(existing.status);
        let priority = req.priority.unwrap_or(existing.priority);
        let goal_id = req.goal_id.or(existing.goal_id);
        let vault_folder_path = req.vault_folder_path.or(existing.vault_folder_path);
        let certificate_url = req.certificate_url.or(existing.certificate_url);
        let practice_scores_json = req
            .practice_scores_json
            .unwrap_or(existing.practice_scores_json);
        let target_completion_date = req
            .target_completion_date
            .or(existing.target_completion_date);
        let rating = req.rating.or(existing.rating);
        let takeaways_md = req.takeaways_md.unwrap_or(existing.takeaways_md);

        let started_at = if existing.started_at.is_none()
            && matches!(status, CourseStatus::Active | CourseStatus::Capstone)
        {
            Some(Utc::now())
        } else {
            existing.started_at
        };
        let completed_at = if status == CourseStatus::Completed {
            existing.completed_at.or_else(|| Some(Utc::now()))
        } else {
            existing.completed_at
        };

        sqlx::query(
            r#"
            UPDATE courses
            SET title = $2,
                provider = $3,
                instructor = $4,
                source_url = $5,
                status = $6,
                priority = $7,
                goal_id = $8,
                vault_folder_path = $9,
                certificate_url = $10,
                practice_scores_json = $11,
                target_completion_date = $12,
                started_at = $13,
                completed_at = $14,
                rating = $15,
                takeaways_md = $16,
                updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(title)
        .bind(provider)
        .bind(instructor)
        .bind(source_url)
        .bind(status)
        .bind(priority)
        .bind(goal_id)
        .bind(vault_folder_path)
        .bind(certificate_url)
        .bind(practice_scores_json)
        .bind(target_completion_date)
        .bind(started_at)
        .bind(completed_at)
        .bind(rating)
        .bind(takeaways_md)
        .execute(&self.pool)
        .await?;

        let course = self.recalculate_course_rollups(id).await?;
        self.build_course_syllabus_response(course).await
    }

    pub async fn delete_course(&self, id: Uuid) -> Result<(), ApiError> {
        let existing = self.fetch_course_row(id).await?;
        sqlx::query("DELETE FROM courses WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        if let Some(goal_id) = existing.goal_id {
            let _ = self.recalculate_goal_rollups(goal_id).await;
        }
        Ok(())
    }

    pub async fn recalculate_course_rollups(&self, course_id: Uuid) -> Result<Course, ApiError> {
        let existing = self.fetch_course_row(course_id).await?;
        let stats: (i64, i64, i64) = sqlx::query_as(
            r#"
            SELECT
                COUNT(*)::bigint AS total_items,
                COUNT(*) FILTER (WHERE status IN ('distilled', 'completed'))::bigint AS completed_items,
                COALESCE(SUM(duration_minutes), 0)::bigint AS total_minutes
            FROM course_lessons
            WHERE course_id = $1
            "#,
        )
        .bind(course_id)
        .fetch_one(&self.pool)
        .await?;

        let total_items = stats.0 as i32;
        let completed_items = stats.1 as i32;
        let lesson_minutes = stats.2 as i32;
        let estimated_total_minutes = if lesson_minutes > 0 {
            lesson_minutes
        } else {
            existing.estimated_total_minutes
        };

        let progress_pct = if total_items > 0 {
            ((Decimal::from(completed_items) / Decimal::from(total_items)) * Decimal::from(100))
                .clamp(Decimal::ZERO, Decimal::from(100))
                .round_dp(2)
        } else if existing.status == CourseStatus::Completed {
            Decimal::from(100)
        } else {
            existing.progress_pct
        };

        let updated = sqlx::query_as::<_, Course>(
            r#"
            UPDATE courses
            SET total_items = $2,
                completed_items = $3,
                progress_pct = $4,
                estimated_total_minutes = $5,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(course_id)
        .bind(total_items)
        .bind(completed_items)
        .bind(progress_pct)
        .bind(estimated_total_minutes)
        .fetch_one(&self.pool)
        .await?;

        if let Some(goal_id) = updated.goal_id {
            let _ = self.recalculate_goal_rollups(goal_id).await;
        }

        Ok(updated)
    }

    async fn build_course_syllabus_response(
        &self,
        course: Course,
    ) -> Result<CourseSyllabusResponse, ApiError> {
        let modules = sqlx::query_as::<_, CourseModule>(
            "SELECT * FROM course_modules WHERE course_id = $1 ORDER BY sort_order ASC, created_at ASC",
        )
        .bind(course.id)
        .fetch_all(&self.pool)
        .await?;

        let lessons = sqlx::query_as::<_, CourseLesson>(
            "SELECT * FROM course_lessons WHERE course_id = $1 ORDER BY sort_order ASC, created_at ASC",
        )
        .bind(course.id)
        .fetch_all(&self.pool)
        .await?;

        let mut remaining_lesson_minutes = 0_i32;
        let mut modules_with_lessons = Vec::with_capacity(modules.len());
        for m in modules {
            let mod_lessons: Vec<CourseLesson> = lessons
                .iter()
                .filter(|l| l.module_id == m.id)
                .cloned()
                .collect();
            for l in &mod_lessons {
                if !matches!(l.status, LessonStatus::Completed | LessonStatus::Distilled) {
                    remaining_lesson_minutes += l.duration_minutes.max(0);
                }
            }
            modules_with_lessons.push(CourseModuleWithLessons {
                module: m,
                lessons: mod_lessons,
            });
        }

        let remaining_minutes = if !lessons.is_empty() {
            remaining_lesson_minutes
        } else {
            let studied_min = (course.logged_study_seconds / 60) as i32;
            (course.estimated_total_minutes - studied_min).max(0)
        };

        let active_courses_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM courses WHERE status IN ('active', 'capstone')",
        )
        .fetch_one(&self.pool)
        .await?;
        let active_i32 = active_courses_count as i32;
        let wip_exceeded = active_i32 > ACTIVE_COURSE_WIP_LIMIT;
        let wip_warning = if wip_exceeded {
            Some(format!(
                "Active courses ({active_i32}) exceed WIP limit ({ACTIVE_COURSE_WIP_LIMIT})"
            ))
        } else {
            None
        };

        // 28-day study velocity in minutes/week
        let study_sec_28d: i64 = sqlx::query_scalar(
            r#"
            SELECT COALESCE(SUM(duration_seconds), 0)::bigint
            FROM time_sessions
            WHERE deleted_at IS NULL
              AND started_at >= NOW() - INTERVAL '28 days'
              AND (course_id = $1 OR category = 'learning')
            "#,
        )
        .bind(course.id)
        .fetch_one(&self.pool)
        .await?;

        let effective_study_sec = if study_sec_28d > 0 {
            study_sec_28d
        } else {
            course.logged_study_seconds
        };
        let weekly_study_minutes_28d =
            (((effective_study_sec as f64) / 60.0 / 4.0) * 10.0).round() / 10.0;

        let today = Utc::now().date_naive();
        let (estimated_completion_date, completion_forecast_label) =
            if course.status == CourseStatus::Completed || remaining_minutes <= 0 {
                (Some(today), "COMPLETED".to_string())
            } else if weekly_study_minutes_28d > 0.0 {
                let weeks_needed = (remaining_minutes as f64) / weekly_study_minutes_28d;
                let days_needed = (weeks_needed * 7.0).ceil() as i64;
                let est_date = today + Duration::days(days_needed.clamp(1, 3650));
                (
                    Some(est_date),
                    format!("~{}d at {:.0}m/wk", days_needed, weekly_study_minutes_28d),
                )
            } else {
                (
                    course.target_completion_date,
                    "AWAITING_STUDY_VELOCITY".to_string(),
                )
            };

        Ok(CourseSyllabusResponse {
            course,
            modules: modules_with_lessons,
            active_courses_count: active_i32,
            wip_limit: ACTIVE_COURSE_WIP_LIMIT,
            wip_exceeded,
            wip_warning,
            remaining_minutes,
            weekly_study_minutes_28d,
            estimated_completion_date,
            completion_forecast_label,
        })
    }

    // =========================================================================
    // 2. Modules, Lessons & Pasted Syllabus Outline Parser
    // =========================================================================

    pub async fn create_course_module(
        &self,
        course_id: Uuid,
        req: CreateCourseModuleRequest,
    ) -> Result<CourseModule, ApiError> {
        let _course = self.fetch_course_row(course_id).await?;
        let title = req.title.trim();
        if title.is_empty() {
            return Err(ApiError::bad_request("Module title must not be empty"));
        }

        let sort_order = req.sort_order.unwrap_or(0);
        let id = new_uuid_v7();
        let module = sqlx::query_as::<_, CourseModule>(
            r#"
            INSERT INTO course_modules (id, course_id, title, sort_order)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(course_id)
        .bind(title)
        .bind(sort_order)
        .fetch_one(&self.pool)
        .await?;

        Ok(module)
    }

    pub async fn update_course_module(
        &self,
        module_id: Uuid,
        req: UpdateCourseModuleRequest,
    ) -> Result<CourseModule, ApiError> {
        let existing = sqlx::query_as::<_, CourseModule>(
            "SELECT * FROM course_modules WHERE id = $1",
        )
        .bind(module_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| ApiError::not_found(format!("Course module {module_id} not found")))?;

        let title = req
            .title
            .map(|t| t.trim().to_string())
            .unwrap_or(existing.title);
        if title.is_empty() {
            return Err(ApiError::bad_request("Module title must not be empty"));
        }
        let sort_order = req.sort_order.unwrap_or(existing.sort_order);

        let updated = sqlx::query_as::<_, CourseModule>(
            r#"
            UPDATE course_modules
            SET title = $2,
                sort_order = $3,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(module_id)
        .bind(title)
        .bind(sort_order)
        .fetch_one(&self.pool)
        .await?;

        Ok(updated)
    }

    pub async fn delete_course_module(&self, module_id: Uuid) -> Result<(), ApiError> {
        let existing = sqlx::query_as::<_, CourseModule>(
            "SELECT * FROM course_modules WHERE id = $1",
        )
        .bind(module_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| ApiError::not_found(format!("Course module {module_id} not found")))?;

        sqlx::query("DELETE FROM course_modules WHERE id = $1")
            .bind(module_id)
            .execute(&self.pool)
            .await?;

        let _ = self.recalculate_course_rollups(existing.course_id).await?;
        Ok(())
    }

    pub async fn create_course_lesson(
        &self,
        module_id: Uuid,
        req: CreateCourseLessonRequest,
    ) -> Result<CourseLesson, ApiError> {
        let module = sqlx::query_as::<_, CourseModule>(
            "SELECT * FROM course_modules WHERE id = $1",
        )
        .bind(module_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| ApiError::not_found(format!("Course module {module_id} not found")))?;

        let title = req.title.trim();
        if title.is_empty() {
            return Err(ApiError::bad_request("Lesson title must not be empty"));
        }
        if req.duration_minutes < 0 {
            return Err(ApiError::bad_request(
                "Lesson duration_minutes must be non-negative",
            ));
        }

        let is_done = matches!(req.status, LessonStatus::Completed | LessonStatus::Distilled);
        let completed_at = if is_done { Some(Utc::now()) } else { None };
        let next_review_date = if is_done {
            Some(Utc::now().date_naive() + Duration::days(7))
        } else {
            None
        };
        let sort_order = req.sort_order.unwrap_or(0);

        let id = new_uuid_v7();
        let lesson = sqlx::query_as::<_, CourseLesson>(
            r#"
            INSERT INTO course_lessons (
                id, course_id, module_id, title, duration_minutes, status,
                external_url, youtube_video_id, vault_note_path, key_summary_md,
                completed_at, review_stage, next_review_date, sort_order
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12, $13)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(module.course_id)
        .bind(module_id)
        .bind(title)
        .bind(req.duration_minutes)
        .bind(req.status)
        .bind(req.external_url)
        .bind(req.youtube_video_id)
        .bind(req.vault_note_path)
        .bind(&req.key_summary_md)
        .bind(completed_at)
        .bind(next_review_date)
        .bind(sort_order)
        .fetch_one(&self.pool)
        .await?;

        let _ = self.recalculate_course_rollups(module.course_id).await?;
        Ok(lesson)
    }

    async fn fetch_lesson_row(&self, lesson_id: Uuid) -> Result<CourseLesson, ApiError> {
        sqlx::query_as::<_, CourseLesson>("SELECT * FROM course_lessons WHERE id = $1")
            .bind(lesson_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| ApiError::not_found(format!("Course lesson {lesson_id} not found")))
    }

    pub async fn update_course_lesson(
        &self,
        lesson_id: Uuid,
        req: UpdateCourseLessonRequest,
    ) -> Result<CourseLesson, ApiError> {
        let existing = self.fetch_lesson_row(lesson_id).await?;
        let title = req
            .title
            .map(|t| t.trim().to_string())
            .unwrap_or(existing.title);
        if title.is_empty() {
            return Err(ApiError::bad_request("Lesson title must not be empty"));
        }
        let duration_minutes = req.duration_minutes.unwrap_or(existing.duration_minutes);
        if duration_minutes < 0 {
            return Err(ApiError::bad_request(
                "Lesson duration_minutes must be non-negative",
            ));
        }

        let status = req.status.unwrap_or(existing.status);
        let external_url = req.external_url.or(existing.external_url);
        let vault_note_path = req.vault_note_path.or(existing.vault_note_path);
        let key_summary_md = req.key_summary_md.unwrap_or(existing.key_summary_md);
        let sort_order = req.sort_order.unwrap_or(existing.sort_order);

        let became_done = matches!(status, LessonStatus::Completed | LessonStatus::Distilled)
            && (existing.completed_at.is_none()
                || (req.status == Some(LessonStatus::Completed) && existing.review_stage >= 3));
        let completed_at = if became_done {
            Some(Utc::now())
        } else {
            existing.completed_at
        };
        let (review_stage, next_review_date) = if let Some(explicit_date) = req.next_review_date {
            (req.review_stage.unwrap_or(existing.review_stage), Some(explicit_date))
        } else if became_done {
            (req.review_stage.unwrap_or(0_i16), Some(Utc::now().date_naive() + Duration::days(7)))
        } else {
            (req.review_stage.unwrap_or(existing.review_stage), existing.next_review_date)
        };

        let updated = sqlx::query_as::<_, CourseLesson>(
            r#"
            UPDATE course_lessons
            SET title = $2,
                duration_minutes = $3,
                status = $4,
                external_url = $5,
                vault_note_path = $6,
                key_summary_md = $7,
                completed_at = $8,
                review_stage = $9,
                next_review_date = $10,
                sort_order = $11,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(lesson_id)
        .bind(title)
        .bind(duration_minutes)
        .bind(status)
        .bind(external_url)
        .bind(vault_note_path)
        .bind(key_summary_md)
        .bind(completed_at)
        .bind(review_stage)
        .bind(next_review_date)
        .bind(sort_order)
        .fetch_one(&self.pool)
        .await?;

        let _ = self.recalculate_course_rollups(existing.course_id).await?;
        Ok(updated)
    }

    pub async fn patch_course_lesson_status(
        &self,
        lesson_id: Uuid,
        req: UpdateLessonStatusRequest,
    ) -> Result<CourseLesson, ApiError> {
        self.update_course_lesson(
            lesson_id,
            UpdateCourseLessonRequest {
                title: None,
                duration_minutes: None,
                status: Some(req.status),
                external_url: None,
                vault_note_path: None,
                key_summary_md: req.key_summary_md,
                sort_order: None,
                review_stage: None,
                next_review_date: None,
            },
        )
        .await
    }

    pub async fn delete_course_lesson(&self, lesson_id: Uuid) -> Result<(), ApiError> {
        let existing = self.fetch_lesson_row(lesson_id).await?;
        sqlx::query("DELETE FROM course_lessons WHERE id = $1")
            .bind(lesson_id)
            .execute(&self.pool)
            .await?;

        let _ = self.recalculate_course_rollups(existing.course_id).await?;
        Ok(())
    }

    pub async fn import_course_outline(
        &self,
        course_id: Uuid,
        req: ImportOutlineRequest,
    ) -> Result<CourseSyllabusResponse, ApiError> {
        let _course = self.fetch_course_row(course_id).await?;
        let text = req.outline_text.trim();
        if text.is_empty() {
            return Err(ApiError::bad_request("Outline text must not be empty"));
        }

        let parsed = parse_syllabus_outline(text);
        if parsed.is_empty() {
            return Err(ApiError::bad_request(
                "Could not parse any modules or lessons from outline_text",
            ));
        }

        let existing_mod_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM course_modules WHERE course_id = $1",
        )
        .bind(course_id)
        .fetch_one(&self.pool)
        .await?;

        for (m_idx, (mod_title, lessons)) in parsed.into_iter().enumerate() {
            let module = self
                .create_course_module(
                    course_id,
                    CreateCourseModuleRequest {
                        title: mod_title,
                        sort_order: Some((existing_mod_count as i32) + (m_idx as i32)),
                    },
                )
                .await?;

            for (l_idx, (lesson_title, duration_minutes)) in lessons.into_iter().enumerate() {
                self.create_course_lesson(
                    module.id,
                    CreateCourseLessonRequest {
                        title: lesson_title,
                        duration_minutes,
                        status: LessonStatus::Todo,
                        external_url: None,
                        youtube_video_id: None,
                        vault_note_path: None,
                        key_summary_md: String::new(),
                        sort_order: Some(l_idx as i32),
                    },
                )
                .await?;
            }
        }

        self.get_course(course_id).await
    }

    // =========================================================================
    // 3. Strictly Read-Only youtube-lists & youtube-ai Importer & Sync
    // =========================================================================

    pub async fn list_youtube_playlists(&self) -> Result<YoutubePlaylistsResponse, ApiError> {
        // CRITICAL: Check .is_file() BEFORE opening rusqlite so a missing DB file is NEVER created!
        if !self.config.youtube_lists_db.is_file() {
            return Ok(YoutubePlaylistsResponse {
                db_available: false,
                playlists: Vec::new(),
            });
        }

        let imported_ids: HashSet<String> = sqlx::query_scalar::<_, String>(
            "SELECT youtube_playlist_id FROM courses WHERE youtube_playlist_id IS NOT NULL",
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .collect();

        let db_path = self.config.youtube_lists_db.clone();
        let playlists = tokio::task::spawn_blocking(move || {
            read_youtube_playlists_readonly(&db_path, &imported_ids)
        })
        .await
        .map_err(|e| ApiError::internal(format!("YouTube SQLite task join error: {e}")))??;

        Ok(YoutubePlaylistsResponse {
            db_available: true,
            playlists,
        })
    }

    pub async fn import_youtube_playlist(
        &self,
        req: ImportYoutubePlaylistRequest,
    ) -> Result<CourseSyllabusResponse, ApiError> {
        let playlist_id = req.playlist_id.trim().to_string();
        if playlist_id.is_empty() {
            return Err(ApiError::bad_request("playlist_id must not be empty"));
        }

        if !self.config.youtube_lists_db.is_file() {
            return Err(ApiError::not_found(
                "YouTube crawler SQLite database is not available on disk",
            ));
        }

        let db_path = self.config.youtube_lists_db.clone();
        let notes_dir = self.config.youtube_lists_notes_dir.clone();
        let pid_clone = playlist_id.clone();

        let extracted = tokio::task::spawn_blocking(move || {
            extract_playlist_from_sqlite_readonly(&db_path, &notes_dir, &pid_clone)
        })
        .await
        .map_err(|e| ApiError::internal(format!("YouTube SQLite import task error: {e}")))??;

        // Check if a course with this youtube_playlist_id already exists
        let existing_course = sqlx::query_as::<_, Course>(
            "SELECT * FROM courses WHERE youtube_playlist_id = $1",
        )
        .bind(&playlist_id)
        .fetch_optional(&self.pool)
        .await?;

        let course_id = if let Some(c) = existing_course {
            if let Some(title_override) = req.title_override.as_deref().map(str::trim)
                && !title_override.is_empty()
            {
                sqlx::query("UPDATE courses SET title = $2, updated_at = NOW() WHERE id = $1")
                    .bind(c.id)
                    .bind(title_override)
                    .execute(&self.pool)
                    .await?;
            }
            c.id
        } else {
            let course_title = req
                .title_override
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(&extracted.title)
                .to_string();

            let created = self
                .create_course(CreateCourseRequest {
                    title: course_title,
                    provider: CourseProvider::Youtube,
                    instructor: "YouTube".to_string(),
                    source_url: Some(format!(
                        "https://www.youtube.com/playlist?list={playlist_id}"
                    )),
                    status: CourseStatus::Active,
                    priority: hermes_domain::todos::TaskPriority::Medium,
                    goal_id: req.goal_id,
                    youtube_playlist_id: Some(playlist_id.clone()),
                    vault_folder_path: extracted.folder.clone(),
                    estimated_total_minutes: extracted
                        .videos
                        .iter()
                        .map(|v| v.duration_minutes)
                        .sum(),
                    target_completion_date: None,
                })
                .await?;
            created.course.id
        };

        self.merge_youtube_videos_into_course(course_id, &playlist_id, &extracted)
            .await?;

        self.get_course(course_id).await
    }

    pub async fn sync_youtube_course(
        &self,
        course_id: Uuid,
    ) -> Result<CourseSyllabusResponse, ApiError> {
        let course = self.fetch_course_row(course_id).await?;
        let playlist_id = course.youtube_playlist_id.clone().ok_or_else(|| {
            ApiError::bad_request("Course does not have an associated youtube_playlist_id")
        })?;

        if !self.config.youtube_lists_db.is_file() {
            return Err(ApiError::not_found(
                "YouTube crawler SQLite database is not available on disk",
            ));
        }

        let db_path = self.config.youtube_lists_db.clone();
        let notes_dir = self.config.youtube_lists_notes_dir.clone();
        let pid_clone = playlist_id.clone();

        let extracted = tokio::task::spawn_blocking(move || {
            extract_playlist_from_sqlite_readonly(&db_path, &notes_dir, &pid_clone)
        })
        .await
        .map_err(|e| ApiError::internal(format!("YouTube SQLite sync task error: {e}")))??;

        self.merge_youtube_videos_into_course(course_id, &playlist_id, &extracted)
            .await?;

        self.get_course(course_id).await
    }

    async fn merge_youtube_videos_into_course(
        &self,
        course_id: Uuid,
        playlist_id: &str,
        extracted: &ExtractedYoutubePlaylist,
    ) -> Result<(), ApiError> {
        let module = match sqlx::query_as::<_, CourseModule>(
            "SELECT * FROM course_modules WHERE course_id = $1 ORDER BY sort_order ASC, created_at ASC LIMIT 1",
        )
        .bind(course_id)
        .fetch_optional(&self.pool)
        .await?
        {
            Some(m) => m,
            None => {
                self.create_course_module(
                    course_id,
                    CreateCourseModuleRequest {
                        title: "Playlist Videos".to_string(),
                        sort_order: Some(0),
                    },
                )
                .await?
            }
        };

        let existing_lessons = sqlx::query_as::<_, CourseLesson>(
            "SELECT * FROM course_lessons WHERE course_id = $1",
        )
        .bind(course_id)
        .fetch_all(&self.pool)
        .await?;

        for (idx, v) in extracted.videos.iter().enumerate() {
            let existing = existing_lessons
                .iter()
                .find(|l| l.youtube_video_id.as_deref() == Some(v.video_id.as_str()));

            if let Some(lesson) = existing {
                let new_status = if v.has_distilled_note && lesson.status == LessonStatus::Todo {
                    LessonStatus::Distilled
                } else {
                    lesson.status
                };
                let became_done = matches!(
                    new_status,
                    LessonStatus::Distilled | LessonStatus::Completed
                ) && lesson.completed_at.is_none();
                let completed_at = if became_done {
                    Some(Utc::now())
                } else {
                    lesson.completed_at
                };
                let next_review_date = if became_done {
                    Some(Utc::now().date_naive() + Duration::days(7))
                } else {
                    lesson.next_review_date
                };
                let summary_to_store = if !v.key_summary_md.is_empty() {
                    v.key_summary_md.clone()
                } else {
                    lesson.key_summary_md.clone()
                };
                let vault_path_to_store = v
                    .vault_note_path
                    .clone()
                    .or_else(|| lesson.vault_note_path.clone());

                sqlx::query(
                    r#"
                    UPDATE course_lessons
                    SET title = $2,
                        duration_minutes = CASE WHEN $3 > 0 THEN $3 ELSE duration_minutes END,
                        status = $4,
                        external_url = COALESCE($5, external_url),
                        vault_note_path = $6,
                        key_summary_md = $7,
                        completed_at = $8,
                        next_review_date = $9,
                        sort_order = $10,
                        updated_at = NOW()
                    WHERE id = $1
                    "#,
                )
                .bind(lesson.id)
                .bind(&v.title)
                .bind(v.duration_minutes)
                .bind(new_status)
                .bind(&v.external_url)
                .bind(vault_path_to_store)
                .bind(summary_to_store)
                .bind(completed_at)
                .bind(next_review_date)
                .bind(idx as i32)
                .execute(&self.pool)
                .await?;
            } else {
                let status = if v.has_distilled_note {
                    LessonStatus::Distilled
                } else {
                    LessonStatus::Todo
                };
                self.create_course_lesson(
                    module.id,
                    CreateCourseLessonRequest {
                        title: v.title.clone(),
                        duration_minutes: v.duration_minutes,
                        status,
                        external_url: v.external_url.clone(),
                        youtube_video_id: Some(v.video_id.clone()),
                        vault_note_path: v.vault_note_path.clone(),
                        key_summary_md: v.key_summary_md.clone(),
                        sort_order: Some(idx as i32),
                    },
                )
                .await?;
            }
        }

        let _ = self.recalculate_course_rollups(course_id).await?;

        self.emit_event(SystemEvent::YoutubeCrawlerSynced {
            playlist_id: playlist_id.to_string(),
            course_id: Some(course_id),
            lessons_synced: extracted.videos.len(),
            timestamp: Utc::now(),
        });

        Ok(())
    }

    // =========================================================================
    // 4. 1-Click Hermes Quiz, Lab Todo Spawner & 7d/30d/90d Spaced Review
    // =========================================================================

    pub async fn create_course_quiz(
        &self,
        course_id: Uuid,
        req: CourseQuizRequest,
    ) -> Result<CourseQuizResponse, ApiError> {
        let course = self.fetch_course_row(course_id).await?;
        let lesson = if let Some(lesson_id) = req.lesson_id {
            let l = self.fetch_lesson_row(lesson_id).await?;
            if l.course_id != course_id {
                return Err(ApiError::not_found(format!(
                    "Lesson {lesson_id} does not belong to course {course_id}"
                )));
            }
            Some(l)
        } else {
            None
        };

        let target_label = lesson
            .as_ref()
            .map(|l| format!("{} — {}", course.title, l.title))
            .unwrap_or_else(|| course.title.clone());

        let summary_context = lesson
            .as_ref()
            .map(|l| l.key_summary_md.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| course.takeaways_md.clone());

        let prompt_context = format!(
            "Quiz me with 5 Socratic active-recall questions on: {target_label}.\n\nKey Notes:\n{summary_context}"
        );

        let session_key = format!("sess_quiz_{}", new_uuid_v7().simple());
        let session_title = format!("Quiz // {target_label}");
        let route_ctx = serde_json::json!({
            "course_id": course_id,
            "lesson_id": req.lesson_id,
            "module_id": req.module_id,
        });
        let initial_messages = serde_json::json!([
            {
                "role": "system",
                "content": prompt_context,
                "created_at": Utc::now().to_rfc3339()
            }
        ]);

        sqlx::query(
            r#"
            INSERT INTO hermes_sessions_index (
                session_key, title, origin, profile_slug, high_level_mode,
                last_route_context, messages_json
            )
            VALUES ($1, $2, 'hermes_view', 'frieren-sage', FALSE, $3, $4)
            "#,
        )
        .bind(&session_key)
        .bind(&session_title)
        .bind(route_ctx)
        .bind(initial_messages)
        .execute(&self.pool)
        .await?;

        Ok(CourseQuizResponse {
            session_key,
            course_id,
            prompt_context,
        })
    }

    pub async fn list_course_quizzes(
        &self,
        course_id: Uuid,
    ) -> Result<Vec<CourseQuizResponse>, ApiError> {
        let _ = self.fetch_course_row(course_id).await?;
        let rows = sqlx::query(
            r#"
            SELECT session_key, messages_json
            FROM hermes_sessions_index
            WHERE last_route_context->>'course_id' = $1
            ORDER BY created_at ASC
            "#,
        )
        .bind(course_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        let mut quizzes = Vec::with_capacity(rows.len());
        for row in rows {
            let session_key: String = row.try_get("session_key")?;
            let messages_json: serde_json::Value = row.try_get("messages_json")?;
            let prompt_context = messages_json
                .as_array()
                .and_then(|arr| arr.first())
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or_default()
                .to_string();
            quizzes.push(CourseQuizResponse {
                session_key,
                course_id,
                prompt_context,
            });
        }
        Ok(quizzes)
    }

    pub async fn spawn_course_todo(
        &self,
        course_id: Uuid,
        req: SpawnCourseTodoRequest,
    ) -> Result<Task, ApiError> {
        let course = self.fetch_course_row(course_id).await?;
        if let Some(lesson_id) = req.lesson_id {
            let l = self.fetch_lesson_row(lesson_id).await?;
            if l.course_id != course_id {
                return Err(ApiError::not_found(format!(
                    "Lesson {lesson_id} does not belong to course {course_id}"
                )));
            }
        }

        let title = req.title.trim();
        if title.is_empty() {
            return Err(ApiError::bad_request("Todo title must not be empty"));
        }

        self.create_task(CreateTaskRequest {
            title: title.to_string(),
            quick_capture: None,
            description_md: format!("Spawned lab/exercise from course **{}**", course.title),
            status: TaskStatus::Todo,
            priority: course.priority,
            project_id: None,
            goal_id: course.goal_id,
            course_id: Some(course.id),
            lesson_id: req.lesson_id,
            parent_task_id: None,
            blocked_by_task_ids: Vec::new(),
            vault_note_path: None,
            scheduled_date: req.scheduled_date.or_else(|| Some(Utc::now().date_naive())),
            due_date: None,
            estimated_minutes: Some(45),
            energy_level: Some(TaskEnergyLevel::Deep),
            tags: vec!["learning".to_string(), "lab".to_string()],
            recurrence_rule: None,
            sort_order: Some(0),
        })
        .await
    }

    pub async fn list_due_spaced_reviews(&self) -> Result<Vec<SpacedReviewDueItem>, ApiError> {
        let today = Utc::now().date_naive();
        let lessons = sqlx::query_as::<_, CourseLesson>(
            r#"
            SELECT *
            FROM course_lessons
            WHERE next_review_date IS NOT NULL
              AND next_review_date <= $1
              AND review_stage < 3
            ORDER BY next_review_date ASC, updated_at ASC
            "#,
        )
        .bind(today)
        .fetch_all(&self.pool)
        .await?;

        let mut items = Vec::with_capacity(lessons.len());
        for lesson in lessons {
            let course_title: String = sqlx::query_scalar(
                "SELECT title FROM courses WHERE id = $1",
            )
            .bind(lesson.course_id)
            .fetch_optional(&self.pool)
            .await?
            .unwrap_or_else(|| "Course".to_string());

            let (interval_label, interval_days) = match lesson.review_stage {
                0 => ("7d".to_string(), 7),
                1 => ("30d".to_string(), 30),
                2 => ("90d".to_string(), 90),
                _ => ("180d".to_string(), 180),
            };

            items.push(SpacedReviewDueItem {
                id: lesson.id,
                lesson_id: lesson.id,
                lesson,
                course_title,
                interval_label,
                interval_days,
            });
        }
        Ok(items)
    }

    pub async fn complete_lesson_review(
        &self,
        lesson_id: Uuid,
        req: ReviewLessonRequest,
    ) -> Result<CourseLesson, ApiError> {
        let existing = self.fetch_lesson_row(lesson_id).await?;
        let today = Utc::now().date_naive();

        let effective_action = match req
            .rating
            .as_deref()
            .map(|s| s.trim().to_ascii_lowercase())
            .as_deref()
        {
            Some("again" | "reset" | "fail") => SpacedReviewAction::Again,
            Some("snooze" | "postpone") => SpacedReviewAction::Snooze,
            Some("good" | "easy" | "pass" | "complete") => SpacedReviewAction::Complete,
            _ => req.action,
        };

        let (new_stage, next_review_date) = match effective_action {
            SpacedReviewAction::Snooze => {
                let days = req.snooze_days.unwrap_or(3).clamp(1, 365);
                (existing.review_stage, Some(today + Duration::days(days)))
            }
            SpacedReviewAction::Again => (0_i16, Some(today + Duration::days(7))),
            SpacedReviewAction::Complete => match existing.review_stage {
                0 => (1_i16, Some(today + Duration::days(30))),
                1 => (2_i16, Some(today + Duration::days(90))),
                _ => (3_i16, None),
            },
        };

        let updated = sqlx::query_as::<_, CourseLesson>(
            r#"
            UPDATE course_lessons
            SET review_stage = $2,
                next_review_date = $3,
                last_reviewed_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(lesson_id)
        .bind(new_stage)
        .bind(next_review_date)
        .fetch_one(&self.pool)
        .await?;

        Ok(updated)
    }
}

// =============================================================================
// Syllabus Outline Parser & Read-Only SQLite / Markdown Helpers
// =============================================================================

pub fn parse_syllabus_outline(outline_text: &str) -> Vec<(String, Vec<(String, i32)>)> {
    let mut modules: Vec<(String, Vec<(String, i32)>)> = Vec::new();

    for raw_line in outline_text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        let is_header = line.starts_with('#')
            || line.to_ascii_lowercase().starts_with("module ")
            || line.to_ascii_lowercase().starts_with("section ")
            || line.to_ascii_lowercase().starts_with("chapter ")
            || line.to_ascii_lowercase().starts_with("part ")
            || line.to_ascii_lowercase().starts_with("week ");

        let is_bullet = line.starts_with("- ")
            || line.starts_with("* ")
            || line.starts_with("+ ")
            || line
                .chars()
                .next()
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false);

        if is_header && !line.starts_with("- ") && !line.starts_with("* ") {
            let clean_mod = line.trim_start_matches('#').trim().to_string();
            if !clean_mod.is_empty() {
                modules.push((clean_mod, Vec::new()));
            }
        } else if is_bullet || !modules.is_empty() {
            if modules.is_empty() {
                modules.push(("Module 1".to_string(), Vec::new()));
            }
            let stripped = strip_bullet_prefix(line);
            let (title, duration) = extract_lesson_duration(stripped);
            if !title.is_empty()
                && let Some((_, lessons)) = modules.last_mut()
            {
                lessons.push((title, duration));
            }
        } else {
            modules.push((line.to_string(), Vec::new()));
        }
    }

    if modules.iter().all(|(_, l)| l.is_empty()) && !modules.is_empty() {
        let flat_lessons: Vec<(String, i32)> = modules
            .drain(..)
            .map(|(t, _)| extract_lesson_duration(&t))
            .collect();
        modules.push(("Syllabus".to_string(), flat_lessons));
    }

    modules
}

fn strip_bullet_prefix(s: &str) -> &str {
    let s = s.trim();
    for prefix in ["- [ ] ", "- [x] ", "- [X] ", "- ", "* ", "+ "] {
        if let Some(rest) = s.strip_prefix(prefix) {
            return rest.trim();
        }
    }
    if let Some(dot_idx) = s.find(['.', ')'])
        && dot_idx > 0
        && dot_idx <= 4
        && s[..dot_idx].chars().all(|c| c.is_ascii_digit())
    {
        return s[dot_idx + 1..].trim();
    }
    s
}

fn extract_lesson_duration(s: &str) -> (String, i32) {
    let trimmed = s.trim();
    if let Some((before, inside)) = split_trailing_delimited(trimmed, '(', ')')
        .or_else(|| split_trailing_delimited(trimmed, '[', ']'))
        && let Some(mins) = parse_duration_minutes(inside)
    {
        return (before.trim().to_string(), mins);
    }
    (trimmed.to_string(), 15)
}

fn split_trailing_delimited(s: &str, open: char, close: char) -> Option<(&str, &str)> {
    if !s.ends_with(close) {
        return None;
    }
    let open_idx = s.rfind(open)?;
    if open_idx == 0 {
        return None;
    }
    Some((&s[..open_idx], &s[open_idx + 1..s.len() - 1]))
}

fn parse_duration_minutes(raw: &str) -> Option<i32> {
    let lower = raw.trim().to_ascii_lowercase();
    if lower.contains(':') && lower.chars().all(|c| c.is_ascii_digit() || c == ':') {
        let parts: Vec<&str> = lower.split(':').collect();
        if parts.len() == 2 {
            let m = parts[0].parse::<i32>().ok()?;
            let sec = parts[1].parse::<i32>().ok()?;
            if (0..=14_400).contains(&m) && (0..60).contains(&sec) {
                return Some((m + i32::from(sec >= 30)).max(1));
            }
            return None;
        } else if parts.len() == 3 {
            let h = parts[0].parse::<i32>().ok()?;
            let m = parts[1].parse::<i32>().ok()?;
            let sec = parts[2].parse::<i32>().ok()?;
            if (0..=240).contains(&h) && (0..60).contains(&m) && (0..60).contains(&sec) {
                return Some((h * 60 + m + i32::from(sec >= 30)).max(1));
            }
            return None;
        }
    }

    let mut total_min = 0_i32;
    let mut matched = false;
    for token in lower.split_whitespace() {
        if let Some(num) = token
            .strip_suffix("hr")
            .or_else(|| token.strip_suffix("hrs"))
            .or_else(|| token.strip_suffix('h'))
            && let Ok(h) = num.parse::<f64>()
            && h.is_finite()
            && (0.0..=240.0).contains(&h)
        {
            total_min = total_min.saturating_add((h * 60.0).round() as i32);
            matched = true;
        } else if let Some(num) = token
            .strip_suffix("min")
            .or_else(|| token.strip_suffix("mins"))
            .or_else(|| token.strip_suffix('m'))
            && let Ok(m) = num.parse::<i32>()
            && (0..=14_400).contains(&m)
        {
            total_min = total_min.saturating_add(m);
            matched = true;
        }
    }

    if matched && total_min > 0 {
        Some(total_min.min(14_400))
    } else {
        None
    }
}

#[derive(Debug, Clone)]
struct ExtractedYoutubeVideo {
    video_id: String,
    title: String,
    duration_minutes: i32,
    external_url: Option<String>,
    vault_note_path: Option<String>,
    key_summary_md: String,
    has_distilled_note: bool,
}

#[derive(Debug, Clone)]
struct ExtractedYoutubePlaylist {
    title: String,
    folder: Option<String>,
    videos: Vec<ExtractedYoutubeVideo>,
}

fn sqlite_has_table(conn: &Connection, table_name: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table_name],
        |row| row.get::<_, i64>(0),
    )
    .unwrap_or(0)
        > 0
}

fn sqlite_table_columns(conn: &Connection, table_name: &str) -> HashSet<String> {
    let mut cols = HashSet::new();
    if let Ok(mut stmt) = conn.prepare(&format!("PRAGMA table_info({table_name})"))
        && let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(1))
    {
        for col in rows.flatten() {
            cols.insert(col.to_ascii_lowercase());
        }
    }
    cols
}

fn read_youtube_playlists_readonly(
    db_path: &Path,
    imported_ids: &HashSet<String>,
) -> Result<Vec<YoutubePlaylistCandidate>, ApiError> {
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| ApiError::internal(format!("Failed to open YouTube SQLite DB read-only: {e}")))?;

    let playlist_table = if sqlite_has_table(&conn, "playlist") {
        "playlist"
    } else if sqlite_has_table(&conn, "playlists") {
        "playlists"
    } else {
        return Ok(Vec::new());
    };

    let p_cols = sqlite_table_columns(&conn, playlist_table);
    let p_id = if p_cols.contains("playlist_id") {
        "p.playlist_id"
    } else {
        "p.id"
    };
    let p_where = if p_cols.contains("removed_at") {
        "WHERE p.removed_at IS NULL"
    } else {
        ""
    };

    let video_table = if sqlite_has_table(&conn, "video") {
        Some("video")
    } else if sqlite_has_table(&conn, "videos") {
        Some("videos")
    } else {
        None
    };
    let has_detail = sqlite_has_table(&conn, "video_detail");
    let has_ai_note = sqlite_has_table(&conn, "ai_note");

    let sql = if let Some(vt) = video_table {
        let v_cols = sqlite_table_columns(&conn, vt);
        let v_id = if v_cols.contains("video_id") {
            "v.video_id"
        } else {
            "v.id"
        };

        let mut v_conds = vec![format!("v.playlist_id = {p_id}")];
        if v_cols.contains("removed_at") {
            v_conds.push("v.removed_at IS NULL".to_string());
        }
        if v_cols.contains("title") {
            v_conds.push(
                "LOWER(TRIM(COALESCE(v.title, ''))) NOT IN ('[private video]', '[deleted video]', 'private video', 'deleted video')".to_string(),
            );
        }

        let detail_join = if has_detail {
            let d_cols = sqlite_table_columns(&conn, "video_detail");
            if d_cols.contains("title") {
                v_conds.push(
                    "LOWER(TRIM(COALESCE(d.title, ''))) NOT IN ('[private video]', '[deleted video]', 'private video', 'deleted video')".to_string(),
                );
            }
            if d_cols.contains("availability") {
                v_conds.push(
                    "LOWER(TRIM(COALESCE(d.availability, ''))) NOT IN ('private', 'unavailable', 'deleted', 'needs_auth')".to_string(),
                );
            }
            if d_cols.contains("note_path") {
                v_conds.push("COALESCE(d.note_path, '') NOT LIKE 'removed/%'".to_string());
            }
            format!("LEFT JOIN video_detail d ON d.video_id = {v_id}")
        } else {
            String::new()
        };

        let active_pred = v_conds.join(" AND ");
        let distilled_expr = if has_ai_note {
            let a_cols = sqlite_table_columns(&conn, "ai_note");
            let a_status_cond = if a_cols.contains("status") {
                " AND a.status = 'done'"
            } else {
                ""
            };
            format!(
                "COUNT(DISTINCT CASE WHEN ({active_pred}) AND EXISTS (SELECT 1 FROM ai_note a WHERE a.video_id = {v_id}{a_status_cond}) THEN {v_id} END)"
            )
        } else {
            "0".to_string()
        };

        format!(
            r#"
            SELECT
                {p_id} AS playlist_id,
                p.title,
                COUNT(DISTINCT CASE WHEN ({active_pred}) THEN {v_id} END) AS video_count,
                {distilled_expr} AS distilled_count
            FROM {playlist_table} p
            LEFT JOIN {vt} v ON v.playlist_id = {p_id}
            {detail_join}
            {p_where}
            GROUP BY {p_id}, p.title
            ORDER BY p.title ASC
            "#
        )
    } else {
        format!(
            r#"
            SELECT
                {p_id} AS playlist_id,
                p.title,
                0 AS video_count,
                0 AS distilled_count
            FROM {playlist_table} p
            {p_where}
            ORDER BY p.title ASC
            "#
        )
    };

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| ApiError::internal(format!("Failed to prepare playlist query: {e}")))?;
    let rows = stmt
        .query_map([], |row| {
            let pid: String = row.get(0)?;
            let title: String = row.get(1)?;
            let v_count: i64 = row.get(2)?;
            let d_count: i64 = row.get(3)?;
            Ok(YoutubePlaylistCandidate {
                already_imported: imported_ids.contains(&pid),
                playlist_id: pid,
                title,
                video_count: v_count.max(0) as usize,
                distilled_count: d_count.max(0) as usize,
            })
        })
        .map_err(|e| ApiError::internal(format!("Failed to query playlists: {e}")))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| ApiError::internal(format!("Row decode error: {e}")))?);
    }
    Ok(out)
}

fn extract_playlist_from_sqlite_readonly(
    db_path: &Path,
    notes_dir: &Path,
    playlist_id: &str,
) -> Result<ExtractedYoutubePlaylist, ApiError> {
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| ApiError::internal(format!("Failed to open YouTube SQLite DB read-only: {e}")))?;

    let playlist_table = if sqlite_has_table(&conn, "playlist") {
        "playlist"
    } else if sqlite_has_table(&conn, "playlists") {
        "playlists"
    } else {
        return Err(ApiError::not_found(format!(
            "Playlist {playlist_id} not found (missing playlist table)"
        )));
    };

    let p_cols = sqlite_table_columns(&conn, playlist_table);
    let p_id_col = if p_cols.contains("playlist_id") {
        "playlist_id"
    } else {
        "id"
    };
    let p_folder_expr = if p_cols.contains("folder") {
        "folder"
    } else {
        "NULL"
    };
    let p_removed_cond = if p_cols.contains("removed_at") {
        " AND removed_at IS NULL"
    } else {
        ""
    };

    let (title, folder): (String, Option<String>) = conn
        .query_row(
            &format!(
                "SELECT title, {p_folder_expr} FROM {playlist_table} WHERE {p_id_col} = ?1{p_removed_cond}"
            ),
            [playlist_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| ApiError::not_found(format!("YouTube playlist {playlist_id} not found")))?;

    let video_table = if sqlite_has_table(&conn, "video") {
        "video"
    } else if sqlite_has_table(&conn, "videos") {
        "videos"
    } else {
        return Ok(ExtractedYoutubePlaylist {
            title,
            folder,
            videos: Vec::new(),
        });
    };

    let v_cols = sqlite_table_columns(&conn, video_table);
    let v_id = if v_cols.contains("video_id") {
        "v.video_id"
    } else {
        "v.id"
    };
    let v_url = if v_cols.contains("url") {
        "v.url"
    } else {
        "NULL"
    };
    let v_dur = if v_cols.contains("duration_seconds") {
        "CAST(v.duration_seconds AS TEXT)"
    } else if v_cols.contains("duration") {
        "CAST(v.duration AS TEXT)"
    } else {
        "NULL"
    };

    let has_detail = sqlite_has_table(&conn, "video_detail");
    let has_ai_note = sqlite_has_table(&conn, "ai_note");

    let mut where_clauses = vec!["v.playlist_id = ?1".to_string()];
    if v_cols.contains("removed_at") {
        where_clauses.push("v.removed_at IS NULL".to_string());
    }
    if v_cols.contains("title") {
        where_clauses.push(
            "LOWER(TRIM(COALESCE(v.title, ''))) NOT IN ('[private video]', '[deleted video]', 'private video', 'deleted video')".to_string(),
        );
    }

    let (title_expr, dur_expr, desc_expr, note_path_expr, note_file_expr, detail_join) =
        if has_detail {
            let d_cols = sqlite_table_columns(&conn, "video_detail");
            let t_expr = if d_cols.contains("title") {
                where_clauses.push(
                    "LOWER(TRIM(COALESCE(d.title, ''))) NOT IN ('[private video]', '[deleted video]', 'private video', 'deleted video')".to_string(),
                );
                "COALESCE(d.title, v.title)".to_string()
            } else {
                "v.title".to_string()
            };
            if d_cols.contains("availability") {
                where_clauses.push(
                    "LOWER(TRIM(COALESCE(d.availability, ''))) NOT IN ('private', 'unavailable', 'deleted', 'needs_auth')".to_string(),
                );
            }
            if d_cols.contains("note_path") {
                where_clauses.push("COALESCE(d.note_path, '') NOT LIKE 'removed/%'".to_string());
            }
            let d_dur = if d_cols.contains("duration_seconds") {
                format!("COALESCE(CAST(d.duration_seconds AS TEXT), {v_dur})")
            } else if d_cols.contains("duration") {
                format!("COALESCE(CAST(d.duration AS TEXT), {v_dur})")
            } else {
                v_dur.to_string()
            };
            let d_desc = if d_cols.contains("description") {
                "d.description"
            } else {
                "NULL"
            };
            let d_npath = if d_cols.contains("note_path") {
                "d.note_path"
            } else {
                "NULL"
            };
            let d_nfile = if d_cols.contains("note_file") {
                "d.note_file"
            } else {
                "NULL"
            };
            (
                t_expr,
                d_dur,
                d_desc.to_string(),
                d_npath.to_string(),
                d_nfile.to_string(),
                format!("LEFT JOIN video_detail d ON d.video_id = {v_id}"),
            )
        } else {
            (
                "v.title".to_string(),
                v_dur.to_string(),
                "NULL".to_string(),
                "NULL".to_string(),
                "NULL".to_string(),
                String::new(),
            )
        };

    let (ai_text_expr, ai_file_expr) = if has_ai_note {
        let a_cols = sqlite_table_columns(&conn, "ai_note");
        let a_text_col = if a_cols.contains("output_text") {
            "a.output_text"
        } else if a_cols.contains("summary_md") {
            "a.summary_md"
        } else {
            "NULL"
        };
        let a_file_col = if a_cols.contains("output_file") {
            "a.output_file"
        } else if a_cols.contains("note_rel_path") {
            "a.note_rel_path"
        } else {
            "NULL"
        };
        let a_status_cond = if a_cols.contains("status") {
            " AND a.status = 'done'"
        } else {
            ""
        };
        let a_order = if a_cols.contains("kind") && a_cols.contains("completed_at") {
            "ORDER BY CASE WHEN a.kind = 'knowledge' THEN 0 ELSE 1 END, a.completed_at DESC"
        } else if a_cols.contains("kind") {
            "ORDER BY CASE WHEN a.kind = 'knowledge' THEN 0 ELSE 1 END"
        } else {
            ""
        };
        (
            format!(
                "(SELECT {a_text_col} FROM ai_note a WHERE a.video_id = {v_id}{a_status_cond} {a_order} LIMIT 1)"
            ),
            format!(
                "(SELECT {a_file_col} FROM ai_note a WHERE a.video_id = {v_id}{a_status_cond} {a_order} LIMIT 1)"
            ),
        )
    } else {
        ("NULL".to_string(), "NULL".to_string())
    };

    let where_sql = where_clauses.join(" AND ");
    let order_sql = if v_cols.contains("position") {
        "ORDER BY v.position ASC, v.rowid ASC"
    } else {
        "ORDER BY v.rowid ASC"
    };

    let sql = format!(
        r#"
        SELECT
            {v_id} AS video_id,
            {title_expr} AS title,
            {v_url} AS url,
            {dur_expr} AS duration,
            {desc_expr} AS description,
            {note_path_expr} AS note_path,
            {note_file_expr} AS note_file,
            {ai_text_expr} AS output_text,
            {ai_file_expr} AS output_file
        FROM {video_table} v
        {detail_join}
        WHERE {where_sql}
        {order_sql}
        "#
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| ApiError::internal(format!("Failed to prepare video query: {e}")))?;

    let rows = stmt
        .query_map([playlist_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
            ))
        })
        .map_err(|e| ApiError::internal(format!("Failed to query playlist videos: {e}")))?;

    let mut videos = Vec::new();
    for r in rows {
        let (
            video_id,
            raw_title,
            url,
            duration_str,
            description,
            note_path,
            note_file,
            ai_output_text,
            ai_output_file,
        ) = r.map_err(|e| ApiError::internal(format!("Video row decode error: {e}")))?;

        let v_title = raw_title
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("Video {video_id}"));
        let duration_minutes = duration_str
            .as_deref()
            .and_then(parse_iso_or_colon_duration_minutes)
            .unwrap_or(15);
        let external_url =
            url.or_else(|| Some(format!("https://www.youtube.com/watch?v={video_id}")));

        let (resolved_vault_path, ai_md_text) = resolve_video_markdown_notes(
            notes_dir,
            folder.as_deref(),
            note_path.as_deref(),
            note_file.as_deref(),
            ai_output_file.as_deref(),
        );

        let has_distilled_note = ai_md_text.is_some()
            || ai_output_text
                .as_deref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);

        let raw_summary = ai_md_text
            .or(ai_output_text)
            .or(description)
            .unwrap_or_default();
        let key_summary_md = redact_secrets(&strip_markdown_frontmatter(&raw_summary));

        videos.push(ExtractedYoutubeVideo {
            video_id,
            title: v_title,
            duration_minutes,
            external_url,
            vault_note_path: resolved_vault_path,
            key_summary_md,
            has_distilled_note,
        });
    }

    Ok(ExtractedYoutubePlaylist {
        title,
        folder,
        videos,
    })
}

fn parse_iso_or_colon_duration_minutes(s: &str) -> Option<i32> {
    let trimmed = s.trim();
    if let Ok(sec) = trimmed.parse::<i64>() {
        return Some(((sec + 59) / 60).max(1) as i32);
    }
    if let Some(rest) = trimmed.strip_prefix("PT") {
        let mut hours = 0_i32;
        let mut mins = 0_i32;
        let mut secs = 0_i32;
        let mut cur = String::new();
        for ch in rest.chars() {
            if ch.is_ascii_digit() {
                cur.push(ch);
            } else if ch == 'H' {
                hours = cur.parse().unwrap_or(0);
                cur.clear();
            } else if ch == 'M' {
                mins = cur.parse().unwrap_or(0);
                cur.clear();
            } else if ch == 'S' {
                secs = cur.parse().unwrap_or(0);
                cur.clear();
            }
        }
        return Some((hours * 60 + mins + i32::from(secs >= 30)).max(1));
    }
    parse_duration_minutes(trimmed)
}

fn resolve_video_markdown_notes(
    notes_dir: &Path,
    playlist_folder: Option<&str>,
    note_path: Option<&str>,
    note_file: Option<&str>,
    ai_output_file: Option<&str>,
) -> (Option<String>, Option<String>) {
    let mut resolved_rel_path: Option<String> = note_path.map(str::to_string);

    if let Some(p_folder) = playlist_folder {
        let slug = note_file
            .and_then(|nf| nf.strip_suffix(".md"))
            .or_else(|| {
                note_path
                    .and_then(|np| Path::new(np).file_stem())
                    .and_then(|os| os.to_str())
            });
        if let Some(slug_str) = slug {
            let ref_rel = format!("{p_folder}/videos/{slug_str}/{slug_str}-ref.md");
            let ref_abs = notes_dir.join(&ref_rel);
            if ref_abs.is_file()
                && let Ok(ref_content) = std::fs::read_to_string(&ref_abs)
                && let Some(target_rel) = parse_ref_md_target(&ref_abs, notes_dir, &ref_content)
            {
                resolved_rel_path = Some(target_rel);
            }
        }
    }

    let mut ai_candidates: Vec<PathBuf> = Vec::new();
    if let Some(ai_file) = ai_output_file {
        let p = Path::new(ai_file);
        if p.is_absolute() {
            ai_candidates.push(p.to_path_buf());
        } else {
            ai_candidates.push(notes_dir.join(p));
        }
    }
    if let Some(rel) = &resolved_rel_path {
        let full_note = notes_dir.join(rel);
        if let (Some(parent), Some(stem)) = (
            full_note.parent(),
            full_note.file_stem().and_then(|s| s.to_str()),
        ) {
            ai_candidates.push(parent.join(format!("{stem}-ai-knowledge.md")));
        }
    }

    for candidate in ai_candidates {
        if candidate.is_file()
            && let Ok(content) = std::fs::read_to_string(&candidate)
            && !content.trim().is_empty()
        {
            return (resolved_rel_path, Some(content));
        }
    }

    (resolved_rel_path, None)
}

fn parse_ref_md_target(ref_abs: &Path, notes_dir: &Path, content: &str) -> Option<String> {
    for line in content.lines() {
        if let Some(open_paren) = line.find("](")
            && let Some(close_paren) = line[open_paren + 2..].find(')')
        {
            let raw_link = &line[open_paren + 2..open_paren + 2 + close_paren];
            let decoded = raw_link.replace("%20", " ");
            if let Some(parent) = ref_abs.parent() {
                let joined = normalize_lexical_path(&parent.join(decoded));
                if let Ok(rel) = joined.strip_prefix(notes_dir) {
                    return Some(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    None
}

fn normalize_lexical_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn strip_markdown_frontmatter(raw: &str) -> String {
    let trimmed = raw.trim();
    let without_fm = if let Some(rest) = trimmed.strip_prefix("---")
        && let Some(end_idx) = rest.find("\n---")
    {
        rest[end_idx + 4..].trim()
    } else {
        trimmed
    };

    let mut lines: Vec<&str> = Vec::new();
    for line in without_fm.lines() {
        if line.trim_start().starts_with("> AI knowledge generated by") {
            continue;
        }
        lines.push(line);
    }
    lines.join("\n").trim().to_string()
}

/// Redacts common credential patterns matching `crawlers/youtube-ai/utils/secrets.py`.
pub fn redact_secrets(text: &str) -> String {
    let mut out = text.to_string();
    let mut search_from = 0usize;

    while search_from < out.len() {
        let Some(rel_start) = out[search_from..].find("-----BEGIN ") else {
            break;
        };
        let start = search_from + rel_start;
        let header_line_end = out[start..]
            .find('\n')
            .map(|nl| start + nl)
            .unwrap_or(out.len());
        if let Some(priv_idx) = out[start..header_line_end].find("PRIVATE KEY-----") {
            let search_end_from = start + priv_idx + "PRIVATE KEY-----".len();
            if let Some(end_marker) = out[search_end_from..].find("-----END ")
                && let Some(end_finish) =
                    out[search_end_from + end_marker..].find("PRIVATE KEY-----")
            {
                let full_end =
                    search_end_from + end_marker + end_finish + "PRIVATE KEY-----".len();
                let replacement = "[redacted private key]";
                out.replace_range(start..full_end, replacement);
                search_from = start + replacement.len();
                continue;
            }
        }
        search_from = header_line_end.max(start + "-----BEGIN ".len());
    }

    out = redact_prefixed_token(&out, "AIza", 20, 60, "[redacted Google API key]");
    out = redact_prefixed_token(&out, "AKIA", 16, 24, "[redacted AWS access key]");
    out = redact_prefixed_token(&out, "ASIA", 16, 24, "[redacted AWS access key]");
    out = redact_prefixed_token(&out, "sk-", 16, 120, "[redacted API key]");
    out = redact_prefixed_token(&out, "ghp_", 30, 60, "[redacted GitHub token]");
    out = redact_prefixed_token(&out, "gho_", 30, 60, "[redacted GitHub token]");
    out = redact_prefixed_token(&out, "ghu_", 30, 60, "[redacted GitHub token]");
    out = redact_prefixed_token(&out, "ghs_", 30, 60, "[redacted GitHub token]");
    out = redact_prefixed_token(&out, "github_pat_", 30, 120, "[redacted GitHub token]");
    out = redact_prefixed_token(&out, "xoxb-", 12, 100, "[redacted Slack token]");
    out = redact_prefixed_token(&out, "xoxp-", 12, 100, "[redacted Slack token]");
    out = redact_prefixed_token(&out, "plm_pat_", 16, 80, "[redacted PAT]");
    out = redact_prefixed_token(&out, "hermes_sess_", 20, 80, "[redacted session token]");

    out
}

pub fn redact_secrets_with_prefix(
    input: &str,
    prefix: &str,
    min_len: usize,
    max_len: usize,
    replacement: &str,
) -> String {
    redact_prefixed_token(input, prefix, min_len, max_len, replacement)
}

fn redact_prefixed_token(
    input: &str,
    prefix: &str,
    min_len: usize,
    max_len: usize,
    replacement: &str,
) -> String {
    let mut result = String::with_capacity(input.len());
    let mut rest = input;

    while let Some(idx) = rest.find(prefix) {
        let valid_start = rest[..idx]
            .chars()
            .next_back()
            .map_or(true, |c| !c.is_ascii_alphanumeric());
        result.push_str(&rest[..idx]);
        let after_prefix = &rest[idx + prefix.len()..];
        let token_chars: String = after_prefix
            .chars()
            .take_while(|c| {
                (c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                    && *c != '&'
                    && *c != '?'
                    && *c != '='
                    && *c != '#'
            })
            .collect();
        let total_len = prefix.len() + token_chars.len();
        if valid_start && total_len >= min_len && total_len <= max_len {
            result.push_str(replacement);
        } else {
            result.push_str(prefix);
            result.push_str(&token_chars);
        }
        rest = &after_prefix[token_chars.len()..];
    }
    result.push_str(rest);
    result
}
