//! Module 08 — Routine Planning, Habits, Daily Check-ins, Ideal Week & Weekly Review DTOs.

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum RoutineTimeSlot {
    Morning,
    Afternoon,
    Shutdown,
    Evening,
    Custom,
}

impl Default for RoutineTimeSlot {
    fn default() -> Self {
        Self::Morning
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum DayProfile {
    #[serde(alias = "weekday")]
    Workday,
    Weekend,
    Travel,
    #[serde(alias = "mvd", alias = "minimum_viable_day")]
    MinimumViable,
    All,
}

impl Default for DayProfile {
    fn default() -> Self {
        Self::Workday
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum HabitTrackingType {
    Boolean,
    Numeric,
    Duration,
}

impl Default for HabitTrackingType {
    fn default() -> Self {
        Self::Boolean
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum HabitFrequencyType {
    Daily,
    Weekdays,
    #[serde(alias = "custom")]
    TimesPerWeek,
}

impl Default for HabitFrequencyType {
    fn default() -> Self {
        Self::Daily
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum RoutineLogStatus {
    #[serde(alias = "done")]
    Completed,
    Partial,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct Routine {
    pub id: Uuid,
    pub name: String,
    pub time_slot: RoutineTimeSlot,
    pub day_profile: DayProfile,
    pub target_start_time: Option<NaiveTime>,
    pub sort_order: i32,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateRoutineRequest {
    pub name: String,
    #[serde(default)]
    pub time_slot: RoutineTimeSlot,
    #[serde(default)]
    pub day_profile: DayProfile,
    pub target_start_time: Option<NaiveTime>,
    pub sort_order: Option<i32>,
    #[serde(default = "default_true")]
    pub active: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateRoutineRequest {
    pub name: Option<String>,
    pub time_slot: Option<RoutineTimeSlot>,
    pub day_profile: Option<DayProfile>,
    pub target_start_time: Option<NaiveTime>,
    pub sort_order: Option<i32>,
    pub active: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct RoutineItem {
    pub id: Uuid,
    pub routine_id: Uuid,
    pub goal_id: Option<Uuid>,
    pub title: String,
    pub tracking_type: HabitTrackingType,
    pub target_value: Option<Decimal>,
    pub unit: Option<String>,
    pub frequency_type: HabitFrequencyType,
    pub frequency_config: serde_json::Value,
    pub estimated_minutes: Option<i32>,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateRoutineItemRequest {
    pub goal_id: Option<Uuid>,
    pub title: String,
    #[serde(default)]
    pub tracking_type: HabitTrackingType,
    pub target_value: Option<Decimal>,
    pub unit: Option<String>,
    #[serde(default)]
    pub frequency_type: HabitFrequencyType,
    #[serde(default)]
    pub frequency_config: serde_json::Value,
    pub estimated_minutes: Option<i32>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateRoutineItemRequest {
    pub goal_id: Option<Uuid>,
    pub title: Option<String>,
    pub tracking_type: Option<HabitTrackingType>,
    pub target_value: Option<Decimal>,
    pub unit: Option<String>,
    pub frequency_type: Option<HabitFrequencyType>,
    pub frequency_config: Option<serde_json::Value>,
    pub estimated_minutes: Option<i32>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct RoutineLog {
    pub id: Uuid,
    pub routine_item_id: Uuid,
    pub log_date: NaiveDate,
    pub status: RoutineLogStatus,
    pub numeric_value: Option<Decimal>,
    pub completed_at: Option<DateTime<Utc>>,
    pub notes: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct LogRoutineItemRequest {
    #[serde(alias = "item_id", alias = "habit_id")]
    pub routine_item_id: Uuid,
    #[serde(alias = "date")]
    pub log_date: Option<NaiveDate>,
    pub status: RoutineLogStatus,
    pub numeric_value: Option<Decimal>,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct DailyCheckin {
    pub log_date: NaiveDate,
    pub day_profile_used: DayProfile,
    pub energy_score: Option<i16>,
    pub mood_score: Option<i16>,
    pub sleep_hours: Option<Decimal>,
    pub highlight: String,
    pub reflection_md: String,
    pub weekly_review_json: Option<serde_json::Value>,
    #[sqlx(default)]
    #[serde(default)]
    pub obsidian_vault_path: Option<String>,
    #[sqlx(default)]
    #[serde(default)]
    pub weekly_review_vault_path: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpsertDailyCheckinRequest {
    #[serde(alias = "day_profile", alias = "profile")]
    pub day_profile_used: Option<DayProfile>,
    pub energy_score: Option<i16>,
    pub mood_score: Option<i16>,
    pub sleep_hours: Option<Decimal>,
    #[serde(alias = "highlights_md", alias = "highlights")]
    pub highlight: Option<String>,
    #[serde(alias = "notes_md", alias = "blockers_md", alias = "blocker")]
    pub reflection_md: Option<String>,
    pub weekly_review_json: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct IdealWeekBlock {
    #[serde(default = "crate::id::new_uuid_v7")]
    pub id: Uuid,
    pub day_of_week: i16,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
    pub category: String,
    pub linked_goal_id: Option<Uuid>,
    pub label: String,
    #[serde(default = "Utc::now")]
    pub created_at: DateTime<Utc>,
    #[serde(default = "Utc::now")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpsertIdealWeekRequest {
    pub blocks: Vec<IdealWeekBlock>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct IdealWeekCategoryVariance {
    pub category: String,
    pub planned_minutes: i64,
    pub actual_minutes: i64,
    pub variance_minutes: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct IdealWeekResponse {
    pub blocks: Vec<IdealWeekBlock>,
    pub total_planned_minutes: i64,
    pub total_actual_minutes: i64,
    pub variance_by_category: Vec<IdealWeekCategoryVariance>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct RoutineStackWithItems {
    #[serde(flatten)]
    pub routine: Routine,
    pub items: Vec<RoutineItem>,
    #[serde(default)]
    pub today_logs: Vec<RoutineLog>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct HabitStreakSummary {
    pub routine_item_id: Uuid,
    pub title: String,
    pub current_streak: i32,
    pub longest_streak: i32,
    #[serde(default)]
    pub best_streak: i32,
    #[serde(default)]
    pub frequency_type: HabitFrequencyType,
    pub completion_rate_30d_pct: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct RoutineHeatmapDay {
    pub date: NaiveDate,
    pub completed_count: i32,
    pub total_count: i32,
    pub completion_ratio: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct RoutineStackAdherence {
    pub routine_id: Uuid,
    pub routine_name: String,
    pub adherence_pct: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct RoutineAnalyticsResponse {
    pub streaks: Vec<HabitStreakSummary>,
    pub matrix_8x12: Vec<bool>,
    pub consistency_score_pct: f64,
    #[serde(default)]
    pub heatmap_365d: Vec<RoutineHeatmapDay>,
    #[serde(default)]
    pub routine_adherence: Vec<RoutineStackAdherence>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct WeeklyReviewSummaryResponse {
    pub week_start: NaiveDate,
    pub week_end: NaiveDate,
    #[serde(default)]
    pub iso_week: String,
    pub completed_tasks_count: usize,
    #[serde(default)]
    pub inbox_tasks_count: usize,
    pub focus_hours: f64,
    #[serde(default)]
    pub focus_minutes: i64,
    pub routine_consistency_pct: f64,
    #[serde(default)]
    pub completed_lessons_count: usize,
    #[serde(default)]
    pub goals_avg_progress_pct: f64,
    #[serde(default)]
    pub investable_surplus_cents: i64,
    pub vault_export_path: Option<String>,
}
