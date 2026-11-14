//! Module 05 — Agent Studio Isometric Knights, Triggers, Runs & Turn-Order Queue DTOs.

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::hermes::ChatToolCallDirective;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum KnightArchetype {
    Paladin,
    Vanguard,
    LoreWarden,
    Inquisitor,
    Artificer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ArenaZone {
    CronWatchtower,
    EventAmbush,
    MastermindCouncil,
    StandbyBarracks,
}

impl Default for ArenaZone {
    fn default() -> Self {
        Self::CronWatchtower
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "UPPERCASE")]
pub enum SkillPolicyMode {
    #[serde(alias = "read")]
    Read,
    #[serde(alias = "approve")]
    Approve,
    #[serde(alias = "auto")]
    Auto,
}

pub type AgentToolsPolicy = SkillPolicyMode;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct KnightGridPos {
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub zone: ArenaZone,
}

impl Default for KnightGridPos {
    fn default() -> Self {
        Self {
            x: 0,
            y: 0,
            zone: ArenaZone::CronWatchtower,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum AgentTriggerType {
    Cron,
    Event,
    Webhook,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum AgentRunStatus {
    Running,
    AwaitingApproval,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct Agent {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub knight_archetype: KnightArchetype,
    pub crest_color: String,
    pub sprite_sheet_id: Option<String>,
    #[sqlx(json)]
    pub grid_pos: KnightGridPos,
    pub hermes_profile: Option<String>,
    pub system_prompt: String,
    pub model_config: serde_json::Value,
    pub tools_policy: serde_json::Value,
    pub monthly_budget_cents: i64,
    pub is_mastermind_member: bool,
    pub enabled: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct AgentWithTelemetry {
    #[serde(flatten)]
    pub agent: Agent,
    pub hp_remaining_cents: i64,
    pub hp_pct: f64,
    pub spent_month_cents: i64,
    pub ep_used_tokens: i32,
    pub ep_max_tokens: i32,
    pub ep_pct: f64,
    #[serde(default)]
    pub is_paused: bool,
    #[serde(default)]
    pub triggers: Vec<AgentTrigger>,
}

fn default_crest_color() -> String {
    "#F87C18".to_string()
}
fn default_budget_cents() -> i64 {
    500
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateAgentRequest {
    pub slug: Option<String>,
    pub name: String,
    pub knight_archetype: KnightArchetype,
    #[serde(default = "default_crest_color")]
    pub crest_color: String,
    pub sprite_sheet_id: Option<String>,
    #[serde(default)]
    pub grid_pos: KnightGridPos,
    pub hermes_profile: Option<String>,
    pub system_prompt: String,
    #[serde(default)]
    pub model_config: serde_json::Value,
    #[serde(default)]
    pub tools_policy: serde_json::Value,
    #[serde(default = "default_budget_cents")]
    pub monthly_budget_cents: i64,
    #[serde(default)]
    pub is_mastermind_member: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateAgentRequest {
    pub slug: Option<String>,
    pub name: Option<String>,
    pub knight_archetype: Option<KnightArchetype>,
    pub crest_color: Option<String>,
    pub sprite_sheet_id: Option<String>,
    pub grid_pos: Option<KnightGridPos>,
    pub hermes_profile: Option<String>,
    pub system_prompt: Option<String>,
    pub model_config: Option<serde_json::Value>,
    pub tools_policy: Option<serde_json::Value>,
    pub monthly_budget_cents: Option<i64>,
    pub is_mastermind_member: Option<bool>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct AgentTrigger {
    pub id: Uuid,
    pub agent_id: Uuid,
    #[sqlx(rename = "type")]
    #[serde(rename = "type")]
    pub trigger_type: AgentTriggerType,
    pub config_json: serde_json::Value,
    pub enabled: bool,
    pub last_run_at: Option<DateTime<Utc>>,
    pub next_run_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateAgentTriggerRequest {
    #[serde(rename = "type")]
    pub trigger_type: AgentTriggerType,
    #[serde(default)]
    pub config_json: serde_json::Value,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub next_run_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateAgentTriggerRequest {
    #[serde(rename = "type")]
    pub trigger_type: Option<AgentTriggerType>,
    pub config_json: Option<serde_json::Value>,
    pub enabled: Option<bool>,
    pub next_run_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct AgentRun {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub trigger_id: Option<Uuid>,
    pub hermes_session_key: Option<String>,
    pub is_dry_run: bool,
    pub status: AgentRunStatus,
    pub steps_trace: serde_json::Value,
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub estimated_cost_usd: Decimal,
    pub error_message: Option<String>,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct DispatchAgentRequest {
    pub dry_run: Option<bool>,
    pub sample_input: Option<String>,
    #[serde(default)]
    pub trigger_id: Option<Uuid>,
    #[serde(default)]
    pub tool_call: Option<ChatToolCallDirective>,
    #[serde(default)]
    pub estimated_cost_cents: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct AgentRunFilter {
    pub agent_id: Option<Uuid>,
    pub status: Option<AgentRunStatus>,
    pub is_dry_run: Option<bool>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct TurnOrderQueueItem {
    pub trigger_id: Uuid,
    pub agent_id: Uuid,
    pub agent_slug: String,
    pub agent_name: String,
    pub trigger_type: AgentTriggerType,
    pub label: String,
    pub scheduled_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct AgentQueueResponse {
    pub queue: Vec<TurnOrderQueueItem>,
}
