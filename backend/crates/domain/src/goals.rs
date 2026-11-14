//! Module 09 — Yearly Goals, Q1–Q4 OKRs & REF-03 90° Orthogonal Blueprint DTOs.

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum CycleStatus {
    Planning,
    Active,
    Closed,
}

impl Default for CycleStatus {
    fn default() -> Self {
        Self::Active
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum GoalPillar {
    Career,
    Health,
    Learning,
    Finance,
    Personal,
    PersonalProject,
    Relationships,
    Systems,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    NotStarted,
    InProgress,
    Completed,
    Paused,
    Dropped,
}

impl Default for GoalStatus {
    fn default() -> Self {
        Self::NotStarted
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "UPPERCASE")]
#[serde(rename_all = "UPPERCASE")]
pub enum OkrQuarter {
    Q1,
    Q2,
    Q3,
    Q4,
    Annual,
}

impl Default for OkrQuarter {
    fn default() -> Self {
        Self::Annual
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum KrMetricType {
    Numeric,
    Milestones,
    Binary,
    LinkedCourse,
    LinkedFinance,
    LinkedHabit,
    LinkedProject,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PaceHealthStatus {
    OnTrack,
    AtRisk,
    OffTrack,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct BlueprintPos {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct YearlyCycle {
    pub year: i32,
    pub theme: String,
    pub vision_md: String,
    pub anti_goals_md: String,
    pub focus_cap_limit: i32,
    pub status: CycleStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn default_focus_cap() -> i32 {
    6
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpsertYearlyCycleRequest {
    pub year: i32,
    pub theme: String,
    #[serde(default)]
    pub vision_md: String,
    #[serde(default)]
    pub anti_goals_md: String,
    #[serde(default = "default_focus_cap")]
    pub focus_cap_limit: i32,
    #[serde(default)]
    pub status: CycleStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct Goal {
    pub id: Uuid,
    pub year: i32,
    pub pillar: GoalPillar,
    pub code: String,
    pub title: String,
    pub why_motivation_md: String,
    pub status: GoalStatus,
    pub priority_rank: i32,
    pub target_date: Option<NaiveDate>,
    pub progress_pct: Decimal,
    pub confidence_score: i16,
    #[sqlx(json)]
    pub blueprint_pos: Option<BlueprintPos>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateGoalRequest {
    pub year: i32,
    pub pillar: GoalPillar,
    pub code: Option<String>,
    pub title: String,
    #[serde(default)]
    pub why_motivation_md: String,
    #[serde(default)]
    pub status: GoalStatus,
    pub priority_rank: Option<i32>,
    pub target_date: Option<NaiveDate>,
    pub confidence_score: Option<i16>,
    pub blueprint_pos: Option<BlueprintPos>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateGoalRequest {
    pub pillar: Option<GoalPillar>,
    pub code: Option<String>,
    pub title: Option<String>,
    pub why_motivation_md: Option<String>,
    pub status: Option<GoalStatus>,
    pub priority_rank: Option<i32>,
    pub target_date: Option<NaiveDate>,
    pub progress_pct: Option<Decimal>,
    pub confidence_score: Option<i16>,
    pub blueprint_pos: Option<BlueprintPos>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateGoalBlueprintPosRequest {
    pub blueprint_pos: BlueprintPos,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct GoalKeyResult {
    pub id: Uuid,
    pub goal_id: Uuid,
    pub quarter: OkrQuarter,
    pub code: String,
    pub title: String,
    pub metric_type: KrMetricType,
    pub start_value: Decimal,
    pub current_value: Decimal,
    pub target_value: Decimal,
    pub unit: String,
    pub milestones_json: serde_json::Value,
    pub linked_entity_id: Option<Uuid>,
    pub weight: Decimal,
    #[sqlx(json)]
    pub blueprint_pos: Option<BlueprintPos>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateKeyResultRequest {
    #[serde(default)]
    pub quarter: OkrQuarter,
    pub code: Option<String>,
    pub title: String,
    pub metric_type: KrMetricType,
    #[serde(default)]
    pub start_value: Decimal,
    #[serde(default)]
    pub current_value: Decimal,
    pub target_value: Decimal,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub milestones_json: serde_json::Value,
    pub linked_entity_id: Option<Uuid>,
    pub weight: Option<Decimal>,
    pub blueprint_pos: Option<BlueprintPos>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateKeyResultRequest {
    pub quarter: Option<OkrQuarter>,
    pub code: Option<String>,
    pub title: Option<String>,
    pub metric_type: Option<KrMetricType>,
    pub start_value: Option<Decimal>,
    pub current_value: Option<Decimal>,
    pub target_value: Option<Decimal>,
    pub unit: Option<String>,
    pub milestones_json: Option<serde_json::Value>,
    pub linked_entity_id: Option<Uuid>,
    pub weight: Option<Decimal>,
    pub blueprint_pos: Option<BlueprintPos>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct GoalCheckin {
    pub id: Uuid,
    pub goal_id: Uuid,
    pub checkin_date: NaiveDate,
    pub progress_snapshot: Decimal,
    pub confidence_score: i16,
    pub wins_md: String,
    pub blockers_md: String,
    pub next_steps_md: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateGoalCheckinRequest {
    pub checkin_date: Option<NaiveDate>,
    pub progress_snapshot: Option<Decimal>,
    pub confidence_score: i16,
    #[serde(default)]
    pub wins_md: String,
    #[serde(default)]
    pub blockers_md: String,
    #[serde(default)]
    pub next_steps_md: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct GoalWithDetails {
    #[serde(flatten)]
    pub goal: Goal,
    pub pace_status: PaceHealthStatus,
    pub key_results: Vec<GoalKeyResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct BlueprintNode {
    pub id: Uuid,
    pub node_kind: String,
    pub code: String,
    pub title: String,
    pub quarter: Option<OkrQuarter>,
    pub x: f64,
    pub y: f64,
    pub progress_pct: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct BlueprintCorridor {
    pub from_id: Uuid,
    pub to_id: Uuid,
    pub waypoints: Vec<BlueprintPos>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct BlueprintLayoutResponse {
    pub year: i32,
    pub nodes: Vec<BlueprintNode>,
    pub corridors: Vec<BlueprintCorridor>,
}
