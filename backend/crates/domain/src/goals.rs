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
    #[serde(alias = "career_craft", alias = "craft")]
    Career,
    #[serde(alias = "health_vitality")]
    Health,
    #[serde(alias = "learning_mastery")]
    Learning,
    #[serde(alias = "wealth_finance", alias = "wealth")]
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
    #[serde(alias = "active")]
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

fn default_cycle_year() -> i32 {
    2026
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpsertYearlyCycleRequest {
    #[serde(default = "default_cycle_year")]
    pub year: i32,
    pub theme: String,
    #[serde(default, alias = "vision_markdown", alias = "vision")]
    pub vision_md: String,
    #[serde(default, alias = "anti_goals_markdown", alias = "anti_goals")]
    pub anti_goals_md: String,
    #[serde(default = "default_focus_cap", alias = "focus_cap")]
    pub focus_cap_limit: i32,
    #[serde(default)]
    pub status: CycleStatus,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateYearlyCycleRequest {
    pub theme: Option<String>,
    #[serde(alias = "vision_markdown", alias = "vision")]
    pub vision_md: Option<String>,
    #[serde(alias = "anti_goals_markdown", alias = "anti_goals")]
    pub anti_goals_md: Option<String>,
    #[serde(alias = "focus_cap")]
    pub focus_cap_limit: Option<i32>,
    pub status: Option<CycleStatus>,
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
    #[sqlx(json(nullable))]
    pub blueprint_pos: Option<BlueprintPos>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateGoalRequest {
    #[serde(default = "default_cycle_year", alias = "cycle_year")]
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
    #[serde(alias = "confidence")]
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
    #[sqlx(json(nullable))]
    pub blueprint_pos: Option<BlueprintPos>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl GoalKeyResult {
    pub fn computed_progress_pct(&self) -> Decimal {
        match self.metric_type {
            KrMetricType::Binary => {
                if (self.target_value > Decimal::ZERO && self.current_value >= self.target_value)
                    || self.current_value >= Decimal::ONE
                {
                    Decimal::from(100)
                } else {
                    Decimal::ZERO
                }
            }
            KrMetricType::Milestones => {
                if let Some(arr) = self.milestones_json.as_array() {
                    if !arr.is_empty() {
                        let mut total_w = 0.0_f64;
                        let mut done_w = 0.0_f64;
                        for item in arr {
                            let w = item
                                .get("weight")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(1.0)
                                .max(0.0);
                            let done = item
                                .get("done")
                                .and_then(|v| v.as_bool())
                                .or_else(|| item.get("completed").and_then(|v| v.as_bool()))
                                .unwrap_or(false);
                            total_w += w;
                            if done {
                                done_w += w;
                            }
                        }
                        if total_w > 0.0 {
                            let pct = ((done_w / total_w) * 100.0).clamp(0.0, 100.0);
                            return Decimal::from_f64_retain(pct)
                                .unwrap_or(Decimal::ZERO)
                                .round_dp(2);
                        }
                        return Decimal::ZERO;
                    }
                }
                if self.target_value == self.start_value {
                    if self.current_value >= self.target_value {
                        Decimal::from(100)
                    } else {
                        Decimal::ZERO
                    }
                } else {
                    (((self.current_value - self.start_value)
                        / (self.target_value - self.start_value))
                        * Decimal::from(100))
                    .clamp(Decimal::ZERO, Decimal::from(100))
                    .round_dp(2)
                }
            }
            _ => {
                if self.target_value == self.start_value {
                    if self.current_value >= self.target_value {
                        Decimal::from(100)
                    } else {
                        Decimal::ZERO
                    }
                } else {
                    (((self.current_value - self.start_value)
                        / (self.target_value - self.start_value))
                        * Decimal::from(100))
                    .clamp(Decimal::ZERO, Decimal::from(100))
                    .round_dp(2)
                }
            }
        }
    }
}

fn default_kr_metric_type() -> KrMetricType {
    KrMetricType::Numeric
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateKeyResultRequest {
    #[serde(default)]
    pub quarter: OkrQuarter,
    pub code: Option<String>,
    pub title: String,
    #[serde(default = "default_kr_metric_type")]
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
    #[serde(default)]
    pub kr_id: Option<Uuid>,
    #[serde(default, alias = "current_value")]
    pub kr_current_value: Option<Decimal>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct GoalWithDetails {
    #[serde(flatten)]
    pub goal: Goal,
    pub pace_status: PaceHealthStatus,
    #[serde(default)]
    pub elapsed_pct: Decimal,
    #[serde(default)]
    pub invested_seconds: i64,
    #[serde(default)]
    pub invested_hours: f64,
    #[serde(default = "default_focus_cap")]
    pub focus_cap_limit: i32,
    #[serde(default)]
    pub active_goals_in_cycle: i32,
    #[serde(default)]
    pub focus_cap_exceeded: bool,
    #[serde(default)]
    pub focus_cap_warning: Option<String>,
    pub key_results: Vec<GoalKeyResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct BlueprintTitleBlock {
    pub year: i32,
    pub theme: String,
    pub status: CycleStatus,
    pub days_elapsed: i32,
    pub days_total: i32,
    pub revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct BlueprintQuarterMatrixCell {
    pub quarter: OkrQuarter,
    pub pillar: GoalPillar,
    pub deliverables: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct BlueprintPillarZone {
    pub pillar: GoalPillar,
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
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
    pub pillar: GoalPillar,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub height: f64,
    #[serde(default)]
    pub is_north_star_beacon: bool,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct BlueprintCorridor {
    pub from_id: Uuid,
    pub to_id: Uuid,
    pub waypoints: Vec<BlueprintPos>,
    #[serde(default)]
    pub style: String,
    #[serde(default)]
    pub polyline: Vec<[i32; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct BlueprintLayoutResponse {
    pub year: i32,
    pub cycle: YearlyCycle,
    pub title_block: BlueprintTitleBlock,
    pub nodes: Vec<BlueprintNode>,
    pub corridors: Vec<BlueprintCorridor>,
    #[serde(default)]
    pub quarter_matrix: Vec<BlueprintQuarterMatrixCell>,
    #[serde(default)]
    pub pillar_zones: Vec<BlueprintPillarZone>,
    #[serde(default)]
    pub strategist_notes_md: String,
}
