//! Module 01 & 02 — Operator Auth, Web Sessions, SHA-256 Personal Access Tokens & Pairing QR DTOs.

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum GatewayHealthMode {
    Online,
    OfflineMock,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct HealthStatusResponse {
    pub status: String,
    pub db_online: bool,
    pub redis_online: bool,
    pub hermes_gateway: GatewayHealthMode,
    pub version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    Admin,
    Operator,
    Viewer,
}

impl Default for UserRole {
    fn default() -> Self {
        Self::Admin
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    #[serde(default = "default_display_name")]
    pub display_name: String,
    #[serde(default)]
    pub role: UserRole,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn default_display_name() -> String {
    "Operator".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct LoginResponse {
    pub authenticated: bool,
    pub user: User,
    pub token: String,
    pub session_token: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct AuthVerifyResponse {
    pub authenticated: bool,
    pub auth_type: String,
    pub token_name: Option<String>,
    pub scopes: Vec<String>,
    pub server_time: DateTime<Utc>,
    pub latest_server_seq: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema, sqlx::FromRow)]
pub struct ApiTokenSummary {
    pub id: Uuid,
    pub name: String,
    pub token_prefix: String,
    pub scopes: Vec<String>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

fn default_pat_scopes() -> Vec<String> {
    vec!["*".to_string()]
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreatePatRequest {
    #[serde(alias = "label", alias = "title")]
    pub name: String,
    #[serde(default = "default_pat_scopes")]
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CreatedPatResponse {
    pub id: Uuid,
    pub name: String,
    pub token: String,
    pub token_prefix: String,
    pub scopes: Vec<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct PairingQrRequest {
    #[serde(alias = "server_url", alias = "base_url", alias = "url")]
    pub primary_url: Option<String>,
    pub fallback_url: Option<String>,
    #[serde(alias = "name", alias = "label")]
    pub token_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct PairingQrResponse {
    pub primary_url: String,
    pub fallback_url: Option<String>,
    pub token: String,
    pub token_id: Uuid,
    pub token_name: String,
    pub qr_payload_json: String,
    pub created_at: DateTime<Utc>,
}
