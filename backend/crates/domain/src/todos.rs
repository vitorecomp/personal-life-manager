//! Module 07 — Todo List, Dependency Graph (`TERMINAL-I/O`) & Stopwatch/Pomodoro Focus Timer DTOs.

use chrono::{DateTime, NaiveDate, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ProjectArea {
    Career,
    Health,
    Learning,
    Finance,
    Personal,
    PersonalProject,
    Relationships,
    Systems,
}

impl Default for ProjectArea {
    fn default() -> Self {
        Self::Personal
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Active,
    Paused,
    Completed,
    Archived,
}

impl Default for ProjectStatus {
    fn default() -> Self {
        Self::Active
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Inbox,
    Backlog,
    Todo,
    InProgress,
    Review,
    Done,
    Canceled,
}

impl Default for TaskStatus {
    fn default() -> Self {
        Self::Inbox
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    #[serde(alias = "p3")]
    Low,
    #[serde(alias = "p2")]
    Medium,
    #[serde(alias = "p1")]
    High,
    #[serde(alias = "p0", alias = "critical")]
    Urgent,
}

impl Default for TaskPriority {
    fn default() -> Self {
        Self::Medium
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum TaskEnergyLevel {
    #[serde(alias = "deep_focus", alias = "deep_work")]
    Deep,
    #[serde(alias = "low_energy")]
    Shallow,
    #[serde(alias = "quick_win")]
    Quick,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum TimeCategory {
    DeepWork,
    Learning,
    Maintenance,
    Admin,
    Health,
}

impl Default for TimeCategory {
    fn default() -> Self {
        Self::DeepWork
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT")]
pub enum TimerMode {
    #[serde(rename = "stopwatch")]
    #[sqlx(rename = "stopwatch")]
    Stopwatch,
    #[serde(rename = "pomodoro_25_5", alias = "pomodoro", alias = "pomodoro25_5")]
    #[sqlx(rename = "pomodoro_25_5")]
    Pomodoro25_5,
    #[serde(rename = "pomodoro_50_10", alias = "pomodoro50_10")]
    #[sqlx(rename = "pomodoro_50_10")]
    Pomodoro50_10,
    #[serde(rename = "pomodoro_90_15", alias = "pomodoro90_15")]
    #[sqlx(rename = "pomodoro_90_15")]
    Pomodoro90_15,
    #[serde(rename = "pomodoro_custom", alias = "custom")]
    #[sqlx(rename = "pomodoro_custom")]
    PomodoroCustom,
}

impl Default for TimerMode {
    fn default() -> Self {
        Self::Stopwatch
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub area: ProjectArea,
    pub goal_id: Option<Uuid>,
    pub status: ProjectStatus,
    pub color: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

fn default_project_color() -> String {
    "#F87C18".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateProjectRequest {
    pub name: String,
    #[serde(default)]
    pub area: ProjectArea,
    pub goal_id: Option<Uuid>,
    #[serde(default)]
    pub status: ProjectStatus,
    #[serde(default = "default_project_color")]
    pub color: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateProjectRequest {
    pub name: Option<String>,
    pub area: Option<ProjectArea>,
    pub goal_id: Option<Uuid>,
    pub status: Option<ProjectStatus>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct Task {
    pub id: Uuid,
    pub title: String,
    pub description_md: String,
    pub status: TaskStatus,
    pub priority: TaskPriority,
    pub project_id: Option<Uuid>,
    pub goal_id: Option<Uuid>,
    pub course_id: Option<Uuid>,
    pub lesson_id: Option<Uuid>,
    pub parent_task_id: Option<Uuid>,
    pub blocked_by_task_ids: Vec<Uuid>,
    pub vault_note_path: Option<String>,
    pub scheduled_date: Option<NaiveDate>,
    pub due_date: Option<DateTime<Utc>>,
    pub estimated_minutes: Option<i32>,
    pub actual_seconds: i64,
    pub energy_level: Option<TaskEnergyLevel>,
    pub tags: Vec<String>,
    pub recurrence_rule: Option<String>,
    pub sort_order: i32,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateTaskRequest {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub quick_capture: Option<String>,
    #[serde(default, alias = "description")]
    pub description_md: String,
    #[serde(default)]
    pub status: TaskStatus,
    #[serde(default)]
    pub priority: TaskPriority,
    pub project_id: Option<Uuid>,
    pub goal_id: Option<Uuid>,
    pub course_id: Option<Uuid>,
    pub lesson_id: Option<Uuid>,
    pub parent_task_id: Option<Uuid>,
    #[serde(default, alias = "depends_on", alias = "dependency_ids", alias = "dependencies", alias = "blocked_by")]
    pub blocked_by_task_ids: Vec<Uuid>,
    pub vault_note_path: Option<String>,
    pub scheduled_date: Option<NaiveDate>,
    #[serde(alias = "due_at")]
    pub due_date: Option<DateTime<Utc>>,
    #[serde(alias = "estimate_minutes", alias = "duration_mins")]
    pub estimated_minutes: Option<i32>,
    #[serde(alias = "energy")]
    pub energy_level: Option<TaskEnergyLevel>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub recurrence_rule: Option<String>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateTaskRequest {
    pub title: Option<String>,
    #[serde(alias = "description")]
    pub description_md: Option<String>,
    pub status: Option<TaskStatus>,
    pub priority: Option<TaskPriority>,
    pub project_id: Option<Uuid>,
    pub goal_id: Option<Uuid>,
    pub course_id: Option<Uuid>,
    pub lesson_id: Option<Uuid>,
    pub parent_task_id: Option<Uuid>,
    #[serde(alias = "depends_on", alias = "dependency_ids", alias = "dependencies", alias = "blocked_by")]
    pub blocked_by_task_ids: Option<Vec<Uuid>>,
    pub vault_note_path: Option<String>,
    pub scheduled_date: Option<NaiveDate>,
    #[serde(alias = "due_at")]
    pub due_date: Option<DateTime<Utc>>,
    #[serde(alias = "estimate_minutes", alias = "duration_mins")]
    pub estimated_minutes: Option<i32>,
    pub actual_seconds: Option<i64>,
    #[serde(alias = "energy")]
    pub energy_level: Option<TaskEnergyLevel>,
    pub tags: Option<Vec<String>>,
    pub recurrence_rule: Option<String>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateTaskStatusRequest {
    pub status: TaskStatus,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct TaskListFilter {
    pub perspective: Option<String>,
    pub status: Option<TaskStatus>,
    pub project_id: Option<Uuid>,
    pub goal_id: Option<Uuid>,
    pub course_id: Option<Uuid>,
    pub parent_task_id: Option<Uuid>,
    pub priority: Option<TaskPriority>,
    pub energy_level: Option<TaskEnergyLevel>,
    pub due_before: Option<DateTime<Utc>>,
    pub scheduled_date: Option<NaiveDate>,
    pub tag: Option<String>,
    pub search: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct BulkUpdateTasksRequest {
    #[serde(alias = "ids")]
    pub task_ids: Vec<Uuid>,
    pub status: Option<TaskStatus>,
    pub priority: Option<TaskPriority>,
    pub project_id: Option<Uuid>,
    pub goal_id: Option<Uuid>,
    pub energy_level: Option<TaskEnergyLevel>,
    pub scheduled_date: Option<NaiveDate>,
    #[serde(default)]
    pub delete: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct TodayCapacityMeter {
    pub focus_capacity_minutes: i32,
    pub planned_minutes: i32,
    pub actual_minutes: i32,
    pub actual_seconds: i64,
    pub remaining_minutes: i32,
    pub utilization_pct: f64,
    pub overloaded: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct TimeSession {
    pub id: Uuid,
    pub task_id: Option<Uuid>,
    pub course_id: Option<Uuid>,
    pub lesson_id: Option<Uuid>,
    pub category: TimeCategory,
    pub timer_mode: TimerMode,
    pub work_minutes: Option<i32>,
    pub break_minutes: Option<i32>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub duration_seconds: i64,
    pub notes: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateTimeSessionRequest {
    pub task_id: Option<Uuid>,
    pub course_id: Option<Uuid>,
    pub lesson_id: Option<Uuid>,
    #[serde(default)]
    pub category: TimeCategory,
    #[serde(default)]
    pub timer_mode: TimerMode,
    pub work_minutes: Option<i32>,
    pub break_minutes: Option<i32>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub duration_seconds: i64,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ActiveTimerResponse {
    pub running: bool,
    pub session: Option<TimeSession>,
    pub elapsed_seconds: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct StartTimerRequest {
    pub task_id: Option<Uuid>,
    pub course_id: Option<Uuid>,
    pub lesson_id: Option<Uuid>,
    #[serde(default)]
    pub category: TimeCategory,
    #[serde(default, alias = "mode")]
    pub timer_mode: TimerMode,
    pub work_minutes: Option<i32>,
    pub break_minutes: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct StopTimerRequest {
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub duration_seconds: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct QuickCaptureParseRequest {
    #[serde(alias = "raw", alias = "input", alias = "text", alias = "query")]
    pub raw_input: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct QuickCaptureParsed {
    pub clean_title: String,
    pub tags: Vec<String>,
    pub energy_level: Option<TaskEnergyLevel>,
    pub priority: TaskPriority,
    pub scheduled_date: Option<NaiveDate>,
    pub due_at: Option<DateTime<Utc>>,
    pub estimated_minutes: Option<i32>,
    pub estimate_minutes: Option<i32>,
    pub status: TaskStatus,
    pub project_hint: Option<String>,
}

pub type TaskParseRequest = QuickCaptureParseRequest;
pub type TaskParseResponse = QuickCaptureParsed;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct TimeStatsResponse {
    pub today_seconds: i64,
    pub week_seconds: i64,
    pub deep_work_week_seconds: i64,
    pub learning_week_seconds: i64,
    pub hourly_buckets_24h: Vec<i64>,
    #[serde(default)]
    pub barcode_buckets_96: Vec<i64>,
    #[serde(default)]
    pub focus_capacity_minutes: i32,
    #[serde(default)]
    pub planned_today_minutes: i32,
    #[serde(default)]
    pub actual_today_minutes: i32,
    pub capacity: TodayCapacityMeter,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct FlowNode {
    pub id: Uuid,
    pub title: String,
    pub stage: i32,
    pub status: TaskStatus,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub node_kind: String,
    #[serde(default)]
    pub stage_label: String,
    #[serde(default)]
    pub is_blocked: bool,
    #[serde(default)]
    pub is_critical_path: bool,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub blocked_by_task_ids: Vec<Uuid>,
    #[serde(default)]
    pub parent_task_id: Option<Uuid>,
    #[serde(default)]
    pub estimated_minutes: Option<i32>,
    #[serde(default)]
    pub actual_seconds: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct FlowEdge {
    pub from_id: Uuid,
    pub to_id: Uuid,
    pub edge_type: String,
    #[serde(default)]
    pub is_blocked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct FlowStageSummary {
    pub stage: i32,
    pub code: String,
    pub label: String,
    pub task_ids: Vec<Uuid>,
    pub total_estimated_minutes: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ProjectFlowTopologyResponse {
    pub project_id: Option<Uuid>,
    pub hub_node: FlowNode,
    pub stages: Vec<FlowStageSummary>,
    pub nodes: Vec<FlowNode>,
    pub edges: Vec<FlowEdge>,
    pub dependency_arcs: Vec<FlowEdge>,
    pub subtask_edges: Vec<FlowEdge>,
    pub capacity: TodayCapacityMeter,
}
