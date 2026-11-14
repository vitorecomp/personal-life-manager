//! Module 04 & 06 — Hermes Sessions, Companion Offline Phrases, MCP Approvals/Undo & Vault DTOs.

use chrono::{DateTime, Utc};
use pgvector::Vector;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum SessionOrigin {
    HermesView,
    FrierenPopover,
    KnightRun,
}

impl Default for SessionOrigin {
    fn default() -> Self {
        Self::HermesView
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "UPPERCASE")]
pub enum McpAutonomyTier {
    Read,
    ImmediateUndo,
    RequireApproval,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Rejected,
}

impl Default for ApprovalStatus {
    fn default() -> Self {
        Self::Pending
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum TriggerContext {
    Any,
    Tap,
    ScreenOpen,
    TodoDone,
    RoutineDone,
}

impl Default for TriggerContext {
    fn default() -> Self {
        Self::Any
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum CompanionAnimationHint {
    Grimoire,
    Stargazing,
    BlueFlowerSpell,
    Tea,
    NodOff,
    MimicGag,
    IdleGaze,
    WindBlink,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct HermesSession {
    pub session_key: String,
    pub title: String,
    pub origin: SessionOrigin,
    pub profile_slug: Option<String>,
    pub pinned: bool,
    pub archived: bool,
    pub folder_name: Option<String>,
    pub parent_session_key: Option<String>,
    pub branched_at_turn: Option<i32>,
    pub high_level_mode: bool,
    pub last_route_context: Option<serde_json::Value>,
    pub messages_json: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateHermesSessionRequest {
    pub session_key: Option<String>,
    pub title: Option<String>,
    #[serde(default)]
    pub origin: SessionOrigin,
    pub profile_slug: Option<String>,
    #[serde(default)]
    pub high_level_mode: bool,
    pub folder_name: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateHermesSessionRequest {
    pub title: Option<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
    pub folder_name: Option<String>,
    pub high_level_mode: Option<bool>,
    pub last_route_context: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ForkHermesSessionRequest {
    pub title: Option<String>,
    pub turn_index: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct PageContextPayload {
    pub active_route: String,
    pub active_dashboard_id: Option<Uuid>,
    pub selected_entity_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ChatStreamRequest {
    pub message: String,
    pub high_level_mode: Option<bool>,
    pub page_context: Option<PageContextPayload>,
    pub mentions: Option<Vec<String>>,
    pub slash_command: Option<String>,
    pub origin: Option<SessionOrigin>,
    pub profile_slug: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct PendingMcpApproval {
    pub id: Uuid,
    pub session_key: String,
    pub agent_run_id: Option<Uuid>,
    pub tool_name: String,
    pub payload_json: serde_json::Value,
    pub status: ApprovalStatus,
    pub result_json: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ResolveMcpApprovalRequest {
    pub payload_json: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct McpUndoAction {
    pub id: Uuid,
    pub session_key: String,
    pub tool_name: String,
    pub entity_table: Option<String>,
    pub entity_id: Option<String>,
    pub undo_kind: String,
    pub undo_payload: serde_json::Value,
    pub undone_at: Option<DateTime<Utc>>,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct VaultNoteSummary {
    pub path: String,
    pub title: String,
    pub folder: String,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct VaultNoteDetail {
    pub path: String,
    pub title: String,
    pub content_md: String,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct DistillVaultRequest {
    pub title: String,
    pub content_md: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub session_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct DistillVaultResponse {
    pub vault_note_path: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct VaultEmbeddingRecord {
    pub id: Uuid,
    pub vault_note_path: String,
    pub chunk_index: i32,
    pub heading: String,
    pub content_text: String,
    pub content_sha256: String,
    #[schema(value_type = Vec<f32>)]
    #[schemars(with = "Vec<f32>")]
    pub embedding: Vector,
    pub metadata: serde_json::Value,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct CompanionOfflinePhrase {
    pub id: Uuid,
    pub phrase_text: String,
    pub trigger_context: TriggerContext,
    pub animation_hint: Option<CompanionAnimationHint>,
    pub is_builtin: bool,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateCompanionPhraseRequest {
    pub phrase_text: String,
    #[serde(default)]
    pub trigger_context: TriggerContext,
    pub animation_hint: Option<CompanionAnimationHint>,
    #[serde(default = "default_true")]
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CompanionNudge {
    pub id: Uuid,
    pub category: String,
    pub title: String,
    pub message: String,
    pub route: String,
    pub entity_id: Option<String>,
    pub created_at: DateTime<Utc>,
}
