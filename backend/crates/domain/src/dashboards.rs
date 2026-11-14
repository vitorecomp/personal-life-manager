//! Module 03 — Multi-Dashboard Room Monitor, Custom Widgets & 5-Pillar Life Score DTOs.

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum WidgetSourceKind {
    Builtin,
    Command,
    Http,
    Sql,
    Hermes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum WidgetRendererKind {
    Kpi,
    Sparkline,
    Waffle,
    Bar,
    Table,
    Terminal,
    CustomModule,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BuiltinWidgetType {
    LifeRadar,
    FocusVelocity,
    RoutineConsistency,
    PortfolioFire,
    GoalsCourses,
    ServerProber,
    KnightPulse,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct GridRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Default for GridRect {
    fn default() -> Self {
        Self { x: 0, y: 0, w: 4, h: 2 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct Dashboard {
    pub id: Uuid,
    pub slug: String,
    pub title: String,
    pub cycle_seconds: i32,
    pub in_rotation: bool,
    pub sort_order: i32,
    pub layout_cols: i32,
    pub layout_rows: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct DashboardWidget {
    pub id: Uuid,
    pub dashboard_id: Uuid,
    pub title: String,
    pub source_kind: WidgetSourceKind,
    pub renderer_kind: WidgetRendererKind,
    #[sqlx(json)]
    pub grid_rect: GridRect,
    pub source_config: serde_json::Value,
    pub refresh_interval_seconds: i32,
    pub cached_payload: Option<serde_json::Value>,
    pub last_refreshed_at: Option<DateTime<Utc>>,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct DashboardWithWidgets {
    #[serde(flatten)]
    pub dashboard: Dashboard,
    pub widgets: Vec<DashboardWidget>,
}

fn default_cycle_seconds() -> i32 {
    60
}
fn default_in_rotation() -> bool {
    true
}
fn default_layout_cols() -> i32 {
    12
}
fn default_layout_rows() -> i32 {
    8
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateDashboardRequest {
    pub slug: Option<String>,
    pub title: String,
    #[serde(default = "default_cycle_seconds")]
    pub cycle_seconds: i32,
    #[serde(default = "default_in_rotation")]
    pub in_rotation: bool,
    #[serde(default)]
    pub sort_order: Option<i32>,
    #[serde(default = "default_layout_cols")]
    pub layout_cols: i32,
    #[serde(default = "default_layout_rows")]
    pub layout_rows: i32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateDashboardRequest {
    pub slug: Option<String>,
    pub title: Option<String>,
    pub cycle_seconds: Option<i32>,
    pub in_rotation: Option<bool>,
    pub sort_order: Option<i32>,
    pub layout_cols: Option<i32>,
    pub layout_rows: Option<i32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CloneDashboardRequest {
    pub slug: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ReorderDashboardsRequest {
    #[serde(alias = "ordered_ids", alias = "ids")]
    pub dashboard_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateWidgetRequest {
    #[serde(alias = "name", alias = "label")]
    pub title: String,
    #[serde(alias = "source_type")]
    pub source_kind: WidgetSourceKind,
    #[serde(alias = "widget_type", alias = "renderer")]
    pub renderer_kind: WidgetRendererKind,
    #[serde(default)]
    pub grid_rect: GridRect,
    #[serde(default)]
    pub source_config: serde_json::Value,
    #[serde(default = "default_cycle_seconds")]
    pub refresh_interval_seconds: i32,
    #[serde(default)]
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateWidgetRequest {
    #[serde(alias = "name", alias = "label")]
    pub title: Option<String>,
    #[serde(alias = "source_type")]
    pub source_kind: Option<WidgetSourceKind>,
    #[serde(alias = "widget_type", alias = "renderer")]
    pub renderer_kind: Option<WidgetRendererKind>,
    pub grid_rect: Option<GridRect>,
    pub source_config: Option<serde_json::Value>,
    pub refresh_interval_seconds: Option<i32>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct LifeScorePillars {
    pub focus: f64,
    pub routines: f64,
    pub goals: f64,
    pub learning: f64,
    pub wealth: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct PillarWeights {
    pub focus: f64,
    pub routines: f64,
    pub goals: f64,
    pub learning: f64,
    pub wealth: f64,
}

impl Default for PillarWeights {
    fn default() -> Self {
        Self {
            focus: 0.20,
            routines: 0.20,
            goals: 0.20,
            learning: 0.20,
            wealth: 0.20,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct LifeScoreResponse {
    pub composite_score: f64,
    pub score: i32,
    pub pillars: LifeScorePillars,
    pub weights: PillarWeights,
    pub computed_at: DateTime<Utc>,
}
