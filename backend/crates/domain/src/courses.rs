//! Module 10 — Course Tracker, Read-Only YouTube Crawler Import & 7d/30d/90d Spaced Review DTOs.

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::todos::TaskPriority;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum CourseProvider {
    Udemy,
    Coursera,
    Youtube,
    Book,
    Certification,
    University,
    FrontendMasters,
    Custom,
}

impl Default for CourseProvider {
    fn default() -> Self {
        Self::Custom
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum CourseStatus {
    Wishlist,
    Active,
    Capstone,
    Completed,
    Paused,
    Dropped,
}

impl Default for CourseStatus {
    fn default() -> Self {
        Self::Wishlist
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum LessonStatus {
    Todo,
    InProgress,
    Distilled,
    #[serde(alias = "done")]
    Completed,
}

impl Default for LessonStatus {
    fn default() -> Self {
        Self::Todo
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SpacedReviewAction {
    #[serde(alias = "advance", alias = "good", alias = "easy", alias = "pass")]
    Complete,
    #[serde(alias = "postpone")]
    Snooze,
    #[serde(alias = "reset", alias = "fail")]
    Again,
}

impl Default for SpacedReviewAction {
    fn default() -> Self {
        Self::Complete
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct Course {
    pub id: Uuid,
    pub title: String,
    pub provider: CourseProvider,
    pub instructor: String,
    pub source_url: Option<String>,
    pub status: CourseStatus,
    pub priority: TaskPriority,
    pub goal_id: Option<Uuid>,
    pub youtube_playlist_id: Option<String>,
    pub vault_folder_path: Option<String>,
    pub certificate_url: Option<String>,
    pub practice_scores_json: serde_json::Value,
    pub total_items: i32,
    pub completed_items: i32,
    pub progress_pct: Decimal,
    pub estimated_total_minutes: i32,
    pub logged_study_seconds: i64,
    pub target_completion_date: Option<NaiveDate>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub rating: Option<i16>,
    pub takeaways_md: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateCourseRequest {
    pub title: String,
    #[serde(default)]
    pub provider: CourseProvider,
    #[serde(default)]
    pub instructor: String,
    pub source_url: Option<String>,
    #[serde(default)]
    pub status: CourseStatus,
    #[serde(default)]
    pub priority: TaskPriority,
    pub goal_id: Option<Uuid>,
    pub youtube_playlist_id: Option<String>,
    pub vault_folder_path: Option<String>,
    #[serde(default)]
    pub estimated_total_minutes: i32,
    pub target_completion_date: Option<NaiveDate>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateCourseRequest {
    pub title: Option<String>,
    pub provider: Option<CourseProvider>,
    pub instructor: Option<String>,
    pub source_url: Option<String>,
    pub status: Option<CourseStatus>,
    pub priority: Option<TaskPriority>,
    pub goal_id: Option<Uuid>,
    pub vault_folder_path: Option<String>,
    pub certificate_url: Option<String>,
    pub practice_scores_json: Option<serde_json::Value>,
    pub target_completion_date: Option<NaiveDate>,
    pub rating: Option<i16>,
    pub takeaways_md: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct CourseModule {
    pub id: Uuid,
    pub course_id: Uuid,
    pub title: String,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateCourseModuleRequest {
    pub title: String,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateCourseModuleRequest {
    pub title: Option<String>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct CourseLesson {
    pub id: Uuid,
    pub course_id: Uuid,
    pub module_id: Uuid,
    pub title: String,
    pub duration_minutes: i32,
    pub status: LessonStatus,
    pub external_url: Option<String>,
    pub youtube_video_id: Option<String>,
    pub vault_note_path: Option<String>,
    pub key_summary_md: String,
    pub completed_at: Option<DateTime<Utc>>,
    pub review_stage: i16,
    pub next_review_date: Option<NaiveDate>,
    pub last_reviewed_at: Option<DateTime<Utc>>,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateCourseLessonRequest {
    pub title: String,
    #[serde(default)]
    pub duration_minutes: i32,
    #[serde(default)]
    pub status: LessonStatus,
    pub external_url: Option<String>,
    pub youtube_video_id: Option<String>,
    pub vault_note_path: Option<String>,
    #[serde(default)]
    pub key_summary_md: String,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateCourseLessonRequest {
    pub title: Option<String>,
    pub duration_minutes: Option<i32>,
    pub status: Option<LessonStatus>,
    pub external_url: Option<String>,
    pub vault_note_path: Option<String>,
    pub key_summary_md: Option<String>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateLessonStatusRequest {
    pub status: LessonStatus,
    #[serde(default)]
    pub key_summary_md: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CourseModuleWithLessons {
    #[serde(flatten)]
    pub module: CourseModule,
    pub lessons: Vec<CourseLesson>,
}

fn default_wip_limit() -> i32 {
    3
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CourseSyllabusResponse {
    pub course: Course,
    pub modules: Vec<CourseModuleWithLessons>,
    #[serde(default)]
    pub active_courses_count: i32,
    #[serde(default = "default_wip_limit")]
    pub wip_limit: i32,
    #[serde(default)]
    pub wip_exceeded: bool,
    #[serde(default)]
    pub wip_warning: Option<String>,
    #[serde(default)]
    pub remaining_minutes: i32,
    #[serde(default)]
    pub weekly_study_minutes_28d: f64,
    #[serde(default)]
    pub estimated_completion_date: Option<NaiveDate>,
    #[serde(default)]
    pub completion_forecast_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ImportOutlineRequest {
    #[serde(alias = "outline_md", alias = "outline", alias = "markdown")]
    pub outline_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct YoutubePlaylistCandidate {
    pub playlist_id: String,
    pub title: String,
    pub video_count: usize,
    pub distilled_count: usize,
    pub already_imported: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct YoutubePlaylistsResponse {
    pub db_available: bool,
    pub playlists: Vec<YoutubePlaylistCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ImportYoutubePlaylistRequest {
    #[serde(alias = "youtube_playlist_id")]
    pub playlist_id: String,
    pub goal_id: Option<Uuid>,
    #[serde(alias = "course_title", alias = "title")]
    pub title_override: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CourseQuizRequest {
    pub lesson_id: Option<Uuid>,
    #[serde(default)]
    pub module_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CourseQuizResponse {
    pub session_key: String,
    pub course_id: Uuid,
    pub prompt_context: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SpawnCourseTodoRequest {
    pub title: String,
    pub lesson_id: Option<Uuid>,
    pub scheduled_date: Option<NaiveDate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SpacedReviewDueItem {
    pub lesson: CourseLesson,
    pub course_title: String,
    pub interval_label: String,
    #[serde(default)]
    pub interval_days: i32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ReviewLessonRequest {
    #[serde(default)]
    pub action: SpacedReviewAction,
    #[serde(default)]
    pub rating: Option<String>,
    #[serde(default)]
    pub snooze_days: Option<i64>,
}
