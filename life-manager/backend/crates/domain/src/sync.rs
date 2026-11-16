//! Module 01 & 02 — Scoped 8-Table Mobile Delta Sync DTOs (`sync_push` & `sync_pull`).

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum SyncOp {
    Upsert,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SyncMutationInput {
    #[serde(default = "crate::id::new_uuid_v7")]
    pub mutation_id: Uuid,
    #[serde(alias = "entity_type")]
    pub entity_table: String,
    pub entity_id: String,
    pub op: SyncOp,
    #[serde(default)]
    pub payload: serde_json::Value,
    pub client_updated_at: Option<DateTime<Utc>>,
}

fn default_client_id() -> String {
    "mobile-companion".to_string()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SyncPushRequest {
    #[serde(default = "default_client_id")]
    pub client_id: String,
    #[serde(alias = "operations")]
    pub mutations: Vec<SyncMutationInput>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SyncPushResponse {
    pub applied_count: usize,
    pub conflicts_resolved: usize,
    pub server_seq: i64,
    pub current_server_seq: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SyncChangeEntry {
    pub server_seq: i64,
    pub entity_table: String,
    pub entity_id: String,
    pub op: SyncOp,
    pub payload: serde_json::Value,
    pub changed_at: DateTime<Utc>,
}

fn default_pull_limit() -> usize {
    500
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SyncPullQuery {
    #[serde(default)]
    pub since: i64,
    #[serde(default = "default_pull_limit")]
    pub limit: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SyncPullResponse {
    pub changes: Vec<SyncChangeEntry>,
    pub latest_server_seq: i64,
    pub next_seq: i64,
    pub has_more: bool,
}
