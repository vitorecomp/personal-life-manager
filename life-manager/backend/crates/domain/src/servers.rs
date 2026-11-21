//! Module 03 — Server Infrastructure Prober DTOs (`server_nodes`).

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ServerCheckType {
    Tcp,
    Http,
}

impl Default for ServerCheckType {
    fn default() -> Self {
        Self::Tcp
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ServerStatus {
    Online,
    Degraded,
    Offline,
    Unknown,
}

impl Default for ServerStatus {
    fn default() -> Self {
        Self::Unknown
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct ServerNode {
    pub id: Uuid,
    pub name: String,
    pub host: String,
    pub port: i32,
    pub check_type: ServerCheckType,
    pub http_url: Option<String>,
    pub status: ServerStatus,
    pub last_latency_ms: Option<i64>,
    pub last_message: Option<String>,
    pub latency_history_ms: Vec<i64>,
    pub last_checked_at: Option<DateTime<Utc>>,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn default_ssh_port() -> i32 {
    22
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreateServerRequest {
    #[serde(alias = "title", alias = "label")]
    pub name: String,
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: i32,
    #[serde(default, alias = "probe_type", alias = "protocol")]
    pub check_type: ServerCheckType,
    #[serde(alias = "url", alias = "endpoint")]
    pub http_url: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct UpdateServerRequest {
    #[serde(alias = "title", alias = "label")]
    pub name: Option<String>,
    pub host: Option<String>,
    pub port: Option<i32>,
    #[serde(alias = "probe_type", alias = "protocol")]
    pub check_type: Option<ServerCheckType>,
    #[serde(alias = "url", alias = "endpoint")]
    pub http_url: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct ServerSummaryResponse {
    pub total: usize,
    pub online: usize,
    pub degraded: usize,
    pub offline: usize,
    pub unknown: usize,
    pub avg_latency_ms: Option<f64>,
    pub checked_at: DateTime<Utc>,
}
