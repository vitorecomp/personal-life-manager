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
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum McpAutonomyTier {
    #[serde(alias = "read", alias = "READ")]
    Read,
    #[serde(alias = "immediate_undo", alias = "IMMEDIATE_UNDO", alias = "IMMEDIATEUNDO")]
    ImmediateUndo,
    #[serde(alias = "require_approval", alias = "REQUIRE_APPROVAL", alias = "REQUIREAPPROVAL")]
    RequireApproval,
}

pub type McpSafetyTier = McpAutonomyTier;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Rejected,
}

pub type McpApprovalStatus = ApprovalStatus;

impl Default for ApprovalStatus {
    fn default() -> Self {
        Self::Pending
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum TriggerContext {
    #[serde(alias = "morning", alias = "evening", alias = "idle", alias = "default", alias = "general")]
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

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ListHermesSessionsQuery {
    pub q: Option<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
    pub origin: Option<SessionOrigin>,
    pub folder_name: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct HermesChatMessage {
    #[serde(default)]
    pub id: Option<String>,
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_ids: Option<Vec<Uuid>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_ids: Option<Vec<Uuid>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gateway_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct HermesSession {
    pub session_key: String,
    pub title: String,
    pub origin: SessionOrigin,
    pub profile_slug: Option<String>,
    #[sqlx(default)]
    #[serde(default)]
    pub model: Option<String>,
    pub pinned: bool,
    pub archived: bool,
    pub folder_name: Option<String>,
    pub parent_session_key: Option<String>,
    #[sqlx(default)]
    #[serde(default)]
    pub forked_from: Option<String>,
    pub branched_at_turn: Option<i32>,
    pub high_level_mode: bool,
    pub last_route_context: Option<serde_json::Value>,
    pub messages_json: serde_json::Value,
    #[sqlx(default)]
    #[serde(default)]
    pub message_count: i32,
    #[sqlx(default)]
    #[serde(default)]
    pub token_count: i32,
    #[sqlx(default)]
    #[serde(default)]
    pub last_message_preview: Option<String>,
    #[sqlx(default)]
    #[serde(default)]
    pub last_message_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl HermesSession {
    pub fn with_computed_metadata(mut self) -> Self {
        self.model = self
            .model
            .or_else(|| self.profile_slug.clone())
            .or_else(|| Some("hermes-3-llama-3.1-70b".to_string()));
        self.forked_from = self.parent_session_key.clone();

        if let Some(arr) = self.messages_json.as_array() {
            self.message_count = arr.len() as i32;
            self.token_count = arr
                .iter()
                .map(|m| {
                    m.get("content")
                        .and_then(|c| c.as_str())
                        .map(|s| ((s.len() + 3) / 4) as i32)
                        .unwrap_or(0)
                })
                .sum();
            self.last_message_preview = arr.iter().rev().find_map(|m| {
                m.get("content")
                    .and_then(|c| c.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(|s| s.chars().take(140).collect())
            });
            self.last_message_at = arr
                .iter()
                .rev()
                .find_map(|m| {
                    m.get("created_at")
                        .and_then(|c| c.as_str())
                        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                        .map(|dt| dt.with_timezone(&Utc))
                })
                .or(Some(self.updated_at));
        } else {
            self.message_count = 0;
            self.token_count = 0;
            self.last_message_preview = None;
            self.last_message_at = Some(self.updated_at);
        }

        self
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateHermesSessionRequest {
    #[serde(default)]
    pub session_key: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub origin: SessionOrigin,
    #[serde(default)]
    pub profile_slug: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub high_level_mode: bool,
    #[serde(default)]
    pub folder_name: Option<String>,
    #[serde(default, alias = "page_context", alias = "route_context")]
    pub last_route_context: Option<serde_json::Value>,
    #[serde(default, alias = "initial_messages")]
    pub messages_json: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateHermesSessionRequest {
    pub title: Option<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
    pub folder_name: Option<String>,
    pub high_level_mode: Option<bool>,
    #[serde(alias = "page_context", alias = "route_context")]
    pub last_route_context: Option<serde_json::Value>,
    pub profile_slug: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ForkHermesSessionRequest {
    pub title: Option<String>,
    #[serde(alias = "message_index", alias = "up_to_turn", alias = "branched_at_turn")]
    pub turn_index: Option<i32>,
    #[serde(default)]
    pub new_session_key: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct PageContextPayload {
    #[serde(default, alias = "route")]
    pub active_route: String,
    pub active_dashboard_id: Option<Uuid>,
    pub selected_entity_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ChatToolCallDirective {
    #[serde(alias = "tool_name", alias = "tool")]
    pub name: String,
    #[serde(default, alias = "args", alias = "payload")]
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ChatStreamRequest {
    #[serde(default)]
    pub session_key: Option<String>,
    #[serde(alias = "prompt", alias = "content")]
    pub message: String,
    pub high_level_mode: Option<bool>,
    pub page_context: Option<PageContextPayload>,
    pub mentions: Option<Vec<String>>,
    pub slash_command: Option<String>,
    pub origin: Option<SessionOrigin>,
    pub profile_slug: Option<String>,
    pub model: Option<String>,
    pub tool_call: Option<ChatToolCallDirective>,
}

pub type HermesChatRequest = ChatStreamRequest;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ThinkingOrbState {
    pub active: bool,
    pub vertices_lit: usize,
    pub rings_locked: usize,
    pub phase: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HermesStreamEvent {
    Thinking {
        session_key: String,
        content: String,
        step: usize,
        thinking_orb_active: bool,
        orb_state: ThinkingOrbState,
        gateway_mode: String,
    },
    ToolCall {
        session_key: String,
        tool_name: String,
        arguments: serde_json::Value,
        autonomy_tier: McpAutonomyTier,
        status: String,
        result: Option<serde_json::Value>,
        undo_id: Option<Uuid>,
        approval_id: Option<Uuid>,
    },
    UndoAvailable {
        session_key: String,
        undo_id: Uuid,
        tool_name: String,
        entity_table: Option<String>,
        entity_id: Option<String>,
        expires_at: DateTime<Utc>,
    },
    ApprovalRequired {
        session_key: String,
        approval_id: Uuid,
        tool_name: String,
        payload_json: serde_json::Value,
        status: ApprovalStatus,
    },
    Token {
        session_key: String,
        delta: String,
        content: String,
    },
    Done {
        session_key: String,
        message: String,
        thinking: String,
        thinking_orb_active: bool,
        gateway_mode: String,
        resolved_mentions: Vec<String>,
        slash_command: Option<String>,
        tool_calls: Vec<serde_json::Value>,
        undo_ids: Vec<Uuid>,
        approval_ids: Vec<Uuid>,
        message_count: i32,
        token_count: i32,
    },
}

pub type HermesChatEvent = HermesStreamEvent;

impl HermesStreamEvent {
    pub fn event_name(&self) -> &'static str {
        match self {
            Self::Thinking { .. } => "thinking",
            Self::ToolCall { .. } => "tool_call",
            Self::UndoAvailable { .. } => "undo_available",
            Self::ApprovalRequired { .. } => "approval_required",
            Self::Token { .. } => "token",
            Self::Done { .. } => "done",
        }
    }

    pub fn to_sse_frame(&self) -> String {
        let data = serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string());
        format!("event: {}\ndata: {}\n\n", self.event_name(), data)
    }
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
    #[serde(alias = "edited_arguments", alias = "edited_args", alias = "arguments", alias = "args")]
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

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct VaultNoteListQuery {
    pub q: Option<String>,
    pub folder: Option<String>,
    #[serde(default)]
    pub semantic: bool,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct VaultNoteSummary {
    pub path: String,
    pub title: String,
    pub folder: String,
    pub updated_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub similarity_score: Option<f64>,
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
    #[serde(alias = "content", alias = "markdown", alias = "body")]
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
    #[serde(alias = "text", alias = "phrase")]
    pub phrase_text: String,
    #[serde(default, alias = "category", alias = "context")]
    pub trigger_context: TriggerContext,
    pub animation_hint: Option<CompanionAnimationHint>,
    #[serde(default = "default_true", alias = "enabled")]
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
