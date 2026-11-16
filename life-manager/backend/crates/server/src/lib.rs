//! `hermes-server` — Unified Axum HTTP/SSE, `/mcp`, OpenAPI 3.1, and CSR SPA-Fallback Server.
//!
//! Exposes:
//! - `openapi::ApiDoc` (`GET /api/openapi.json`)
//! - `ServerConfig` (`from_env()`, `from_test_db(...)`)
//! - `AppState` (`new(...)`, `from_test_db(...)`, `with_static_dir(...)`)
//! - `build_router(state: AppState) -> Router` / `build_app`
//! - `F07`/`F06` Auth & SHA-256 PAT middleware
//! - All REST + SSE routes across all 12 Life Ops & Intelligence domains + `/mcp` + CSR SPA fallback

pub mod openapi;

use std::{
    collections::HashMap,
    convert::Infallible,
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
    time::Duration,
};

use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path as AxumPath, Query, Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header},
    middleware::{self, Next},
    response::{
        Html, IntoResponse, Response,
        sse::{Event as SseEvent, KeepAlive, Sse},
    },
    routing::{delete, get, patch, post, put},
};
use chrono::{NaiveDate, Utc};
use futures::stream::StreamExt;
use hermes_domain::*;
use hermes_intelligence::{
    IntelligenceService,
    mcp::{McpCallContext, mcp_router},
};
use hermes_life_ops::{LifeOpsConfig, LifeOpsService};
use notify::RecommendedWatcher;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use sqlx::{
    PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use tokio_cron_scheduler::JobScheduler;
use tower::ServiceExt;
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
};
use uuid::Uuid;

pub use openapi::ApiDoc;

// =============================================================================
// 1. ServerConfig & AppState
// =============================================================================

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub redis_url: Option<String>,
    pub hermes_gateway_url: String,
    pub hermes_gateway_api_key: Option<String>,
    pub static_dist_dir: PathBuf,
    pub server_prober_interval_secs: u64,
    pub life_ops_config: LifeOpsConfig,
}

impl ServerConfig {
    pub fn from_env() -> Self {
        let host = std::env::var("HERMES_SERVER_HOST")
            .or_else(|_| std::env::var("HOST"))
            .unwrap_or_else(|_| "0.0.0.0".to_string());

        let port = std::env::var("PORT")
            .or_else(|_| std::env::var("HERMES_SERVER_PORT"))
            .ok()
            .and_then(|v| v.trim().parse::<u16>().ok())
            .unwrap_or(8080);

        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://hermes:hermes@127.0.0.1:5432/hermes_os".to_string());

        let redis_url = std::env::var("REDIS_URL")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| Some("redis://127.0.0.1:6379".to_string()));

        let hermes_gateway_url = std::env::var("HERMES_GATEWAY_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8642/v1".to_string());

        let hermes_gateway_api_key = std::env::var("HERMES_GATEWAY_API_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let static_dist_dir = std::env::var("STATIC_DIST_DIR")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(resolve_default_static_dist_dir);

        let server_prober_interval_secs = std::env::var("SERVER_PROBER_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(60)
            .max(5);

        let life_ops_config = LifeOpsConfig::from_env();

        Self {
            host,
            port,
            database_url,
            redis_url,
            hermes_gateway_url,
            hermes_gateway_api_key,
            static_dist_dir,
            server_prober_interval_secs,
            life_ops_config,
        }
    }

    pub fn from_test_db(
        test_db: &hermes_life_ops::test_support::TestDb,
        static_dist_dir: Option<PathBuf>,
    ) -> Self {
        let mut life_ops_config = LifeOpsConfig::default();
        life_ops_config.second_brain_dir = test_db.second_brain_dir.clone();
        life_ops_config.youtube_lists_db = test_db.youtube_lists_db.clone();
        life_ops_config.youtube_lists_notes_dir = test_db.youtube_lists_notes_dir.clone();

        Self {
            host: "127.0.0.1".to_string(),
            port: 0,
            database_url: String::new(),
            redis_url: None,
            hermes_gateway_url: "http://127.0.0.1:59999/v1".to_string(),
            hermes_gateway_api_key: None,
            static_dist_dir: static_dist_dir
                .unwrap_or_else(|| test_db.temp_dir.join("web-dist")),
            server_prober_interval_secs: 3600,
            life_ops_config,
        }
    }
}

fn resolve_default_static_dist_dir() -> PathBuf {
    let candidates = [
        PathBuf::from("apps/web/dist"),
        PathBuf::from("life-manager/apps/web/dist"),
        PathBuf::from("../apps/web/dist"),
        PathBuf::from("../../apps/web/dist"),
        PathBuf::from("/app/apps/web/dist"),
    ];
    for candidate in &candidates {
        if candidate.exists() {
            return candidate.clone();
        }
    }
    PathBuf::from("apps/web/dist")
}

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<ServerConfig>,
    pub life_ops: LifeOpsService,
    pub intelligence: IntelligenceService,
    pub knight_scheduler: Arc<tokio::sync::Mutex<Option<JobScheduler>>>,
    pub vault_watcher: Arc<tokio::sync::Mutex<Option<RecommendedWatcher>>>,
}

impl AppState {
    pub fn new(
        config: ServerConfig,
        life_ops: LifeOpsService,
        intelligence: IntelligenceService,
    ) -> Self {
        Self {
            config: Arc::new(config),
            life_ops,
            intelligence,
            knight_scheduler: Arc::new(tokio::sync::Mutex::new(None)),
            vault_watcher: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }

    pub fn from_test_db(test_db: &hermes_life_ops::test_support::TestDb) -> Self {
        let config = ServerConfig::from_test_db(test_db, None);
        let life_ops = LifeOpsService::from_test_db(test_db);
        let intelligence = IntelligenceService::new(
            life_ops.clone(),
            Some(config.hermes_gateway_url.clone()),
            config.hermes_gateway_api_key.clone(),
        );
        Self::new(config, life_ops, intelligence)
    }

    pub fn with_static_dir(mut self, static_dist_dir: PathBuf) -> Self {
        let mut cfg = (*self.config).clone();
        cfg.static_dist_dir = static_dist_dir;
        self.config = Arc::new(cfg);
        self
    }

    pub fn with_gateway_url(mut self, gateway_url: impl Into<String>) -> Self {
        let gw = gateway_url.into();
        let mut cfg = (*self.config).clone();
        cfg.hermes_gateway_url = gw.clone();
        self.config = Arc::new(cfg);
        self.intelligence = IntelligenceService::new(
            self.life_ops.clone(),
            Some(gw),
            self.config.hermes_gateway_api_key.clone(),
        );
        self
    }

    pub async fn connect_from_config(config: ServerConfig) -> anyhow::Result<Self> {
        let pg_opts = PgConnectOptions::from_str(&config.database_url)?;
        let pool = PgPoolOptions::new()
            .max_connections(16)
            .acquire_timeout(Duration::from_secs(15))
            .connect_with(pg_opts)
            .await?;

        let redis_client = config
            .redis_url
            .as_deref()
            .and_then(|url| redis::Client::open(url).ok());

        let life_ops =
            LifeOpsService::new(pool, redis_client, config.life_ops_config.clone());
        let intelligence = IntelligenceService::new(
            life_ops.clone(),
            Some(config.hermes_gateway_url.clone()),
            config.hermes_gateway_api_key.clone(),
        );

        Ok(Self::new(config, life_ops, intelligence))
    }

    pub async fn initialize_database_and_background_tasks(&self) -> anyhow::Result<()> {
        hermes_life_ops::test_support::run_migrations(&self.life_ops.pool).await?;
        let _ = self.life_ops.ensure_admin_user().await?;
        let _ = self.life_ops.ensure_bootstrap_pat().await?;
        let _ = sqlx::query(
            "UPDATE dashboards SET in_rotation = TRUE \
             WHERE slug IN ('tactical-ops', 'wealth-fire', 'strategy-lore', 'infra-knights')",
        )
        .execute(&self.life_ops.pool)
        .await;

        // Background Server Prober loop
        let prober_svc = self.life_ops.clone();
        let prober_interval = self.config.server_prober_interval_secs;
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(prober_interval));
            // Skip immediate tick at t=0 so startup is instantaneous
            ticker.tick().await;
            loop {
                ticker.tick().await;
                let _ = prober_svc.check_all_servers().await;
            }
        });

        // Background Knight Cron Scheduler & SystemEvent listener
        if let Ok(sched) = self.intelligence.spawn_knight_scheduler().await {
            let mut guard = self.knight_scheduler.lock().await;
            *guard = Some(sched);
        }

        // Background Second Brain Vault watcher
        if let Ok(watcher) = self.intelligence.spawn_vault_watcher() {
            let mut guard = self.vault_watcher.lock().await;
            *guard = Some(watcher);
        }

        Ok(())
    }

    pub fn pool(&self) -> &PgPool {
        &self.life_ops.pool
    }
}

// =============================================================================
// 2. ServerError & Flexible Multi-Field JSON Alias Normalizer
// =============================================================================

#[derive(Debug)]
pub struct ServerError(pub ApiError);

impl From<ApiError> for ServerError {
    fn from(err: ApiError) -> Self {
        Self(err)
    }
}

impl From<sqlx::Error> for ServerError {
    fn from(err: sqlx::Error) -> Self {
        Self(ApiError::from(err))
    }
}

impl From<serde_json::Error> for ServerError {
    fn from(err: serde_json::Error) -> Self {
        Self(ApiError::unprocessable(format!("Invalid JSON payload: {err}")))
    }
}

impl From<anyhow::Error> for ServerError {
    fn from(err: anyhow::Error) -> Self {
        Self(ApiError::internal(err.to_string()))
    }
}

impl IntoResponse for ServerError {
    fn into_response(self) -> Response {
        let status =
            StatusCode::from_u16(self.0.status_code()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let body = self.0.to_body();
        (status, Json(body)).into_response()
    }
}

type ServerResult<T> = Result<T, ServerError>;

/// Resolves canonical vs. alias field pairs in incoming JSON payloads so requests carrying
/// both the canonical key and an alias key (e.g. `{ "name": "x", "label": "x" }` or
/// `{ "payload_json": {...}, "arguments": {...} }`) never trigger serde `duplicate field` errors.
pub fn normalize_json_payload(val: &mut Value) {
    match val {
        Value::Array(items) => {
            for item in items {
                normalize_json_payload(item);
            }
        }
        Value::Object(map) => {
            // Recurse into nested objects/arrays first
            for (_, v) in map.iter_mut() {
                normalize_json_payload(v);
            }

            const ALIAS_PAIRS: &[(&str, &[&str])] = &[
                ("knight_archetype", &["archetype"]),
                ("session_key", &["key"]),
                ("profile_slug", &["hermes_profile", "profile"]),
                ("folder_name", &["folder"]),
                ("last_route_context", &["page_context", "route_context"]),
                ("messages_json", &["initial_messages"]),
                ("turn_index", &["message_index", "up_to_turn", "branched_at_turn"]),
                ("active_route", &["route"]),
                ("message", &["prompt", "content"]),
                ("slash_command", &["command_slash"]),
                ("new_session_key", &["target_session_key", "child_session_key"]),
                ("payload_json", &["edited_arguments", "edited_args", "arguments", "args"]),
                ("arguments", &["args", "payload"]),
                ("phrase_text", &["text", "phrase"]),
                ("trigger_context", &["category", "context"]),
                ("active", &["enabled"]),
                ("content_md", &["content", "markdown", "body"]),
                ("folder", &["subfolder", "target_folder"]),
                ("raw_input", &["raw", "input", "text", "query"]),
                ("sample_input", &["input", "prompt"]),
                ("dashboard_ids", &["ordered_ids", "ids"]),
                ("renderer_kind", &["widget_type", "renderer"]),
                ("source_kind", &["source_type"]),
                ("http_url", &["url", "endpoint"]),
                ("check_type", &["probe_type", "protocol"]),
                ("primary_url", &["server_url", "base_url", "url"]),
                ("token_name", &["name", "label"]),
                ("entity_table", &["entity_type"]),
                ("mutations", &["operations"]),
                ("description_md", &["description"]),
                ("energy_level", &["energy"]),
                ("due_date", &["due_at"]),
                ("estimated_minutes", &["estimate_minutes", "duration_mins"]),
                ("blocked_by_task_ids", &["depends_on", "dependency_ids", "dependencies", "blocked_by"]),
                ("task_ids", &["ids"]),
                ("timer_mode", &["mode"]),
                ("routine_item_id", &["item_id", "habit_id"]),
                ("log_date", &["date"]),
                ("day_profile_used", &["day_profile", "profile"]),
                ("highlight", &["highlights_md", "highlights"]),
                ("reflection_md", &["notes_md", "blockers_md", "blocker", "blockers"]),
                ("day_of_week", &["day", "weekday"]),
                ("category", &["block_type"]),
                ("year", &["cycle_year"]),
                ("focus_cap_limit", &["focus_cap"]),
                ("vision_md", &["vision_markdown", "vision"]),
                ("anti_goals_md", &["anti_goals_markdown", "anti_goals"]),
                ("confidence_score", &["confidence"]),
                ("kr_current_value", &["current_value"]),
                ("note_md", &["note"]),
                ("outline_text", &["outline_md", "outline", "markdown"]),
                ("playlist_id", &["youtube_playlist_id"]),
                ("title_override", &["course_title"]),
                ("questions_json", &["questions"]),
                ("symbol", &["ticker"]),
                ("avg_cost_cents", &["average_cost_cents", "cost_basis_cents"]),
                ("current_price_cents", &["last_price_cents"]),
                ("target_weight_pct", &["target_pct"]),
                ("alert_low_cents", &["alert_below_cents", "price_alert_low_cents", "min_price_cents"]),
                ("alert_high_cents", &["alert_above_cents", "price_alert_high_cents", "max_price_cents"]),
                ("salary_income_cents", &["net_salary_cents", "planned_income_cents", "income_cents"]),
                ("planned_spend_cents", &["planned_living_spend_cents"]),
                ("actual_spend_cents", &["actual_living_spend_cents"]),
                ("planned_investment_cents", &["planned_invest_cents", "target_invest_cents"]),
                ("actual_invested_cents", &["actual_investment_cents", "actual_invest_cents", "invested_cents"]),
                ("subscriptions_audit", &["subscriptions"]),
                ("safe_withdrawal_rate_pct", &["swr_pct"]),
                ("expected_real_return_pct", &["real_return_pct", "annual_return_pct"]),
                ("monthly_contribution_brl_cents", &["monthly_investment_cents", "new_contribution_cents"]),
                ("monthly_retirement_spend_brl_cents", &["monthly_spend_cents"]),
                ("lean_monthly_expenses_cents", &["lean_fire_monthly_expense_cents", "lean_expenses_cents"]),
                ("base_monthly_expenses_cents", &["base_fire_monthly_expense_cents", "base_expenses_cents", "monthly_expenses_cents"]),
                ("fat_monthly_expenses_cents", &["fat_fire_monthly_expense_cents", "fat_expenses_cents"]),
                ("snapshot_date", &["date"]),
                ("total_brl_cents", &["net_worth_brl_cents"]),
                ("total_usd_cents", &["net_worth_usd_cents"]),
            ];

            for (canonical, aliases) in ALIAS_PAIRS {
                if map.contains_key(*canonical) {
                    for alias in *aliases {
                        if *alias != "title" && *alias != "url" {
                            map.remove(*alias);
                        }
                    }
                } else {
                    let present_aliases: Vec<&str> = aliases
                        .iter()
                        .copied()
                        .filter(|a| map.contains_key(*a))
                        .collect();
                    if present_aliases.len() > 1 {
                        for dup_alias in &present_aliases[1..] {
                            if *dup_alias != "title" && *dup_alias != "url" {
                                map.remove(*dup_alias);
                            }
                        }
                    }
                }
            }

            // Special handling: `name` vs `title` / `label` / `tool_name` / `tool` when sent together
            if map.contains_key("name") && map.contains_key("label") {
                map.remove("label");
            }
            if map.contains_key("title") && map.contains_key("label") {
                map.remove("label");
            }
            if map.contains_key("name") && map.contains_key("title") {
                map.remove("title");
            }
            if map.contains_key("name") {
                map.remove("tool_name");
                map.remove("tool");
            } else if map.contains_key("tool_name") && map.contains_key("tool") {
                map.remove("tool");
            }
            if (map.contains_key("title_override") || map.contains_key("course_title"))
                && map.contains_key("title")
            {
                map.remove("title");
            }
            if (map.contains_key("primary_url")
                || map.contains_key("server_url")
                || map.contains_key("base_url")
                || map.contains_key("http_url")
                || map.contains_key("endpoint"))
                && map.contains_key("url")
            {
                map.remove("url");
            }

            // Special handling: `type` vs `trigger_type` on AgentTrigger when both are sent together
            if map.contains_key("type") && map.contains_key("trigger_type") {
                map.remove("trigger_type");
            }
            // Populate `config_json` for triggers when `cron_expr`, `event_filter`, or `event_name` is passed at top-level
            if map.contains_key("cron_expr")
                || map.contains_key("event_filter")
                || map.contains_key("event_name")
            {
                let cron_expr = map.remove("cron_expr");
                let event_filter = map
                    .remove("event_filter")
                    .or_else(|| map.remove("event_name"));
                let cfg = map
                    .entry("config_json")
                    .or_insert_with(|| Value::Object(serde_json::Map::new()));
                if let Some(cfg_obj) = cfg.as_object_mut() {
                    if let Some(c) = cron_expr {
                        cfg_obj.entry("cron").or_insert(c);
                    }
                    if let Some(ev) = event_filter {
                        cfg_obj.entry("event").or_insert(ev);
                    }
                }
            }

            // Normalize `knight_archetype` (or its `archetype` alias) synonyms and casing
            if let Some(arch_str) = map
                .get("knight_archetype")
                .or_else(|| map.get("archetype"))
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_ascii_lowercase())
            {
                map.remove("archetype");
                let normalized_arch = match arch_str.as_str() {
                    "paladin" => "paladin",
                    "vanguard" | "ranger" => "vanguard",
                    "lore_warden" | "lorewarden" | "lore-warden" | "lore warden" | "scholar"
                    | "strategist" => "lore_warden",
                    "inquisitor" | "sentinel" => "inquisitor",
                    "artificer" => "artificer",
                    other => other,
                };
                map.insert(
                    "knight_archetype".to_string(),
                    Value::String(normalized_arch.to_string()),
                );
            }

            // Normalize `origin` aliases on HermesSession requests
            if let Some(orig_str) = map
                .get("origin")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_ascii_lowercase())
            {
                let normalized_orig = match orig_str.as_str() {
                    "hermes_view" | "hermes_workspace" | "hermes" | "workspace" | "web"
                    | "chat" => "hermes_view",
                    "frieren_popover" | "mobile_companion" | "companion" | "mobile"
                    | "frieren" | "popover" | "companion_popover" => "frieren_popover",
                    "knight_run" | "knight" | "agent" | "agent_run" => "knight_run",
                    other => other,
                };
                map.insert(
                    "origin".to_string(),
                    Value::String(normalized_orig.to_string()),
                );
            }

            // Special handling: `zone` -> `grid_pos.zone` on Agent create/update
            if let Some(zone_val) = map.remove("zone") {
                if !map.contains_key("grid_pos") {
                    map.insert(
                        "grid_pos".to_string(),
                        json!({ "x": 0, "y": 0, "zone": zone_val }),
                    );
                } else if let Some(gp) = map.get_mut("grid_pos").and_then(|v| v.as_object_mut()) {
                    gp.entry("zone").or_insert(zone_val);
                }
            }

            // Special handling: `raw_input` vs `raw` / `input` / `text` on QuickCaptureParseRequest
            if map.contains_key("raw_input") {
                map.remove("raw");
                map.remove("input");
                map.remove("text");
            }

            // Special handling: `task_ids` vs `ids` on BulkUpdateTasksRequest
            if map.contains_key("task_ids") && map.contains_key("ids") {
                map.remove("ids");
            }
            if map.contains_key("blocked_by_task_ids") {
                map.remove("depends_on");
                map.remove("dependency_ids");
                map.remove("dependencies");
                map.remove("blocked_by");
            }
            if map.contains_key("outline_text") {
                map.remove("outline_md");
                map.remove("outline");
            }
            if map.contains_key("title_override") && map.contains_key("course_title") {
                map.remove("course_title");
            }

            // Special handling: `action` / `op` = "delete" on BulkUpdateTasksRequest
            if !map.contains_key("delete") {
                if let Some(act) = map
                    .get("action")
                    .or_else(|| map.get("op"))
                    .and_then(|v| v.as_str())
                {
                    if act.eq_ignore_ascii_case("delete") {
                        map.insert("delete".to_string(), Value::Bool(true));
                    }
                }
            }

            // Special handling: `blueprint_pos` vs `position_x`/`position_y`/`x`/`y`
            if !map.contains_key("position_x") {
                if let Some(x) = map
                    .get("x")
                    .cloned()
                    .or_else(|| map.get("blueprint_pos").and_then(|bp| bp.get("x")).cloned())
                {
                    map.insert("position_x".to_string(), x);
                }
            }
            if !map.contains_key("position_y") {
                if let Some(y) = map
                    .get("y")
                    .cloned()
                    .or_else(|| map.get("blueprint_pos").and_then(|bp| bp.get("y")).cloned())
                {
                    map.insert("position_y".to_string(), y);
                }
            }

            // Special handling: `due_date` as 10-char YYYY-MM-DD -> RFC3339 DateTime<Utc>
            if let Some(due_str) = map.get("due_date").and_then(|v| v.as_str()).map(str::trim) {
                if due_str.len() == 10 && NaiveDate::parse_from_str(due_str, "%Y-%m-%d").is_ok() {
                    map.insert(
                        "due_date".to_string(),
                        Value::String(format!("{due_str}T12:00:00Z")),
                    );
                }
            }

            // Special handling: `scheduled_date`, `target_date`, `log_date`, `snapshot_date` as RFC3339 -> YYYY-MM-DD
            for date_key in ["scheduled_date", "target_date", "log_date", "snapshot_date"] {
                if let Some(d_str) = map.get(date_key).and_then(|v| v.as_str()).map(str::trim) {
                    if d_str.len() > 10 && d_str.as_bytes().get(10) == Some(&b'T') {
                        map.insert(date_key.to_string(), Value::String(d_str[..10].to_string()));
                    }
                }
            }

            // Special handling: `mutations` vs `operations` in SyncPushRequest
            if map.contains_key("mutations") && map.contains_key("operations") {
                map.remove("operations");
            }
            if map.contains_key("entity_table") && map.contains_key("entity_type") {
                map.remove("entity_type");
            }
            if map.contains_key("entity_table") && map.contains_key("table") {
                map.remove("table");
            }
            if map.contains_key("op") && map.contains_key("operation") {
                map.remove("operation");
            }
        }
        _ => {}
    }
}

pub fn parse_json_bytes<T: DeserializeOwned>(bytes: &[u8]) -> ServerResult<T> {
    if bytes.is_empty() {
        let mut empty = json!({});
        normalize_json_payload(&mut empty);
        return serde_json::from_value::<T>(empty).map_err(ServerError::from);
    }
    let mut val: Value = serde_json::from_slice(bytes).map_err(|e| {
        ServerError(ApiError::bad_request(format!("Malformed JSON request body: {e}")))
    })?;
    normalize_json_payload(&mut val);
    serde_json::from_value::<T>(val).map_err(ServerError::from)
}

pub fn parse_optional_json_bytes<T: DeserializeOwned + Default>(bytes: &[u8]) -> ServerResult<T> {
    if bytes.is_empty() {
        return Ok(T::default());
    }
    parse_json_bytes(bytes)
}

// =============================================================================
// 3. Auth & PAT Middleware (F07, F06)
// =============================================================================

fn extract_bearer_or_cookie_or_query_token(headers: &HeaderMap, uri: &Uri) -> (Option<String>, bool) {
    if let Some(auth_val) = headers.get(header::AUTHORIZATION) {
        let raw = auth_val.to_str().unwrap_or("").trim();
        if let Some(rest) = raw
            .strip_prefix("Bearer ")
            .or_else(|| raw.strip_prefix("bearer "))
        {
            return (Some(rest.trim().to_string()), true);
        }
        return (Some(raw.to_string()), true);
    }

    if let Some(cookie_val) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) {
        for part in cookie_val.split(';') {
            let trimmed = part.trim();
            if let Some(tok) = trimmed
                .strip_prefix("hermes_session=")
                .or_else(|| trimmed.strip_prefix("plm_token="))
            {
                let t = tok.trim();
                if !t.is_empty() {
                    return (Some(t.to_string()), false);
                }
            }
        }
    }

    if let Some(q) = uri.query() {
        for pair in q.split('&') {
            if let Some(tok) = pair
                .strip_prefix("token=")
                .or_else(|| pair.strip_prefix("pat="))
            {
                let t = tok.trim();
                if !t.is_empty() {
                    return (Some(t.to_string()), true);
                }
            }
        }
    }

    (None, false)
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Response {
    if req.method() == Method::OPTIONS {
        return next.run(req).await;
    }

    let path = req.uri().path().to_string();

    // 1. `/api/health` is ALWAYS publicly accessible without credentials
    if path == "/api/health" {
        return next.run(req).await;
    }

    let (token_opt, explicit_auth_supplied) =
        extract_bearer_or_cookie_or_query_token(req.headers(), req.uri());

    // 2. If an explicit `Authorization: Bearer ...` or `?token=...` was supplied on ANY `/api/*` or `/mcp`
    // route, verify it immediately and reject invalid/malformed/revoked tokens with `401 Unauthorized`.
    if let Some(ref raw_token) = token_opt {
        match state
            .life_ops
            .verify_pat_or_session(Some(raw_token.as_str()))
            .await
        {
            Ok(verified) => {
                req.extensions_mut().insert(verified);
                return next.run(req).await;
            }
            Err(err) => {
                if explicit_auth_supplied
                    || path == "/api/auth/verify"
                    || path.starts_with("/api/sync/")
                {
                    return ServerError(err).into_response();
                }
            }
        }
    }

    // 3. `/api/auth/verify` and `/api/sync/*` ALWAYS require a valid PAT or session token
    if path == "/api/auth/verify" || path.starts_with("/api/sync/") {
        return ServerError(ApiError::unauthorized(
            "Missing or invalid Personal Access Token (`Authorization: Bearer plm_pat_...`)",
        ))
        .into_response();
    }

    // 4. `/api/openapi.json` and `/api/auth/login` are public when no invalid Bearer header is attached
    if path == "/api/openapi.json" || path == "/api/auth/login" {
        return next.run(req).await;
    }

    // 5. When `REQUIRE_WEB_LOGIN=true`, all remaining `/api/*` and `/mcp` routes require auth
    if state.config.life_ops_config.require_web_login {
        return ServerError(ApiError::unauthorized(
            "Authentication required (`REQUIRE_WEB_LOGIN=true`)",
        ))
        .into_response();
    }

    next.run(req).await
}

// =============================================================================
// 4. Router Construction (`build_router` / `build_app`)
// =============================================================================

pub fn build_app(state: AppState) -> Router {
    build_router(state)
}

pub fn build_router(state: AppState) -> Router {
    let api_router = Router::new()
        // 1. Health & OpenAPI
        .route("/api/health", get(handle_health))
        .route("/api/openapi.json", get(handle_openapi_json))
        // 2. Auth & PATs (F07)
        .route("/api/auth/verify", get(handle_auth_verify).post(handle_auth_verify))
        .route("/api/auth/login", post(handle_auth_login))
        .route("/api/auth/logout", post(handle_auth_logout))
        .route("/api/auth/me", get(handle_auth_me))
        .route("/api/auth/tokens", get(handle_list_pats).post(handle_create_pat))
        .route("/api/auth/pats", get(handle_list_pats).post(handle_create_pat))
        .route("/api/auth/tokens/{id}", delete(handle_revoke_pat))
        .route("/api/auth/tokens/{id}/revoke", post(handle_revoke_pat))
        .route("/api/auth/pats/{id}", delete(handle_revoke_pat))
        .route("/api/auth/pats/{id}/revoke", post(handle_revoke_pat))
        .route(
            "/api/auth/pairing-qr",
            post(handle_pairing_qr).get(handle_pairing_qr_get),
        )
        // 3. Scoped Mobile Delta Sync (F08)
        .route("/api/sync/push", post(handle_sync_push))
        .route("/api/sync/pull", get(handle_sync_pull).post(handle_sync_pull_post))
        // 4. Dashboards, Widgets, Life Score, Servers & SSE (F11)
        .route(
            "/api/dashboards",
            get(handle_list_dashboards).post(handle_create_dashboard),
        )
        .route(
            "/api/dashboards/reorder",
            post(handle_reorder_dashboards).put(handle_reorder_dashboards),
        )
        .route(
            "/api/dashboards/life-score",
            get(handle_get_life_score),
        )
        .route(
            "/api/dashboards/{id}",
            get(handle_get_dashboard)
                .put(handle_update_dashboard)
                .patch(handle_update_dashboard)
                .delete(handle_delete_dashboard),
        )
        .route("/api/dashboards/{id}/clone", post(handle_clone_dashboard))
        .route("/api/dashboards/{id}/widgets", post(handle_create_widget))
        .route(
            "/api/dashboards/{id}/widgets/{widget_id}",
            put(handle_update_widget)
                .patch(handle_update_widget)
                .delete(handle_delete_widget),
        )
        .route(
            "/api/dashboards/{id}/widgets/{widget_id}/refresh",
            post(handle_refresh_dashboard_widget),
        )
        .route(
            "/api/widgets/{widget_id}",
            put(handle_update_widget_flat)
                .patch(handle_update_widget_flat)
                .delete(handle_delete_widget_flat),
        )
        .route(
            "/api/widgets/{widget_id}/refresh",
            post(handle_refresh_widget_flat),
        )
        .route("/api/telemetry/life-score", get(handle_get_life_score))
        .route("/api/life-score", get(handle_get_life_score))
        .route(
            "/api/servers",
            get(handle_list_servers).post(handle_create_server),
        )
        .route(
            "/api/monitor/servers",
            get(handle_list_servers).post(handle_create_server),
        )
        .route("/api/servers/summary", get(handle_servers_summary))
        .route("/api/monitor/servers/summary", get(handle_servers_summary))
        .route("/api/servers/check-all", post(handle_check_all_servers))
        .route("/api/servers/probe-all", post(handle_check_all_servers))
        .route("/api/monitor/servers/check-all", post(handle_check_all_servers))
        .route("/api/monitor/servers/probe-all", post(handle_check_all_servers))
        .route(
            "/api/servers/{id}",
            get(handle_get_server)
                .put(handle_update_server)
                .patch(handle_update_server)
                .delete(handle_delete_server),
        )
        .route(
            "/api/monitor/servers/{id}",
            get(handle_get_server)
                .put(handle_update_server)
                .patch(handle_update_server)
                .delete(handle_delete_server),
        )
        .route("/api/servers/{id}/check", post(handle_check_server))
        .route("/api/servers/{id}/probe", post(handle_check_server))
        .route("/api/monitor/servers/{id}/check", post(handle_check_server))
        .route("/api/monitor/servers/{id}/probe", post(handle_check_server))
        .route("/api/events/stream", get(handle_events_stream))
        // 5. Hermes Gateway, Sessions & Chat SSE (F09)
        .route("/api/hermes/health", get(handle_hermes_health))
        .route(
            "/api/hermes/sessions",
            get(handle_list_hermes_sessions).post(handle_create_hermes_session),
        )
        .route(
            "/api/hermes/sessions/{key}",
            get(handle_get_hermes_session)
                .put(handle_update_hermes_session)
                .patch(handle_update_hermes_session)
                .delete(handle_delete_hermes_session),
        )
        .route(
            "/api/hermes/sessions/{key}/fork",
            post(handle_fork_hermes_session),
        )
        .route(
            "/api/hermes/sessions/{key}/distill",
            post(handle_distill_session_to_vault),
        )
        .route("/api/hermes/chat/stream", post(handle_hermes_chat_stream))
        .route("/api/hermes/chat", post(handle_hermes_chat_stream))
        // 6. MCP Tools, Approvals & Undo (F10)
        .route("/api/mcp/tools", get(handle_list_mcp_tools))
        .route("/api/mcp/call", post(handle_call_mcp_tool))
        .route("/api/mcp/approvals", get(handle_list_mcp_approvals))
        .route("/api/hermes/approvals", get(handle_list_mcp_approvals))
        .route(
            "/api/mcp/approvals/{id}/approve",
            post(handle_approve_mcp_action),
        )
        .route(
            "/api/hermes/approvals/{id}/approve",
            post(handle_approve_mcp_action),
        )
        .route(
            "/api/mcp/approvals/{id}/reject",
            post(handle_reject_mcp_action),
        )
        .route(
            "/api/hermes/approvals/{id}/reject",
            post(handle_reject_mcp_action),
        )
        .route("/api/mcp/undo", get(handle_list_mcp_undo))
        .route("/api/hermes/undo", get(handle_list_mcp_undo))
        .route("/api/mcp/undo/{id}", post(handle_undo_mcp_action))
        .route("/api/hermes/undo/{id}", post(handle_undo_mcp_action))
        // 7. Agent Studio Knights, Vault Inspector & Companion (F12)
        .route(
            "/api/agents",
            get(handle_list_agents).post(handle_create_agent),
        )
        .route("/api/agents/queue", get(handle_get_agent_queue))
        .route("/api/agents/runs", get(handle_list_agent_runs))
        .route("/api/agent-runs", get(handle_list_agent_runs))
        .route("/api/agents/runs/{run_id}", get(handle_get_agent_run))
        .route("/api/agent-runs/{run_id}", get(handle_get_agent_run))
        .route(
            "/api/agents/{id}",
            get(handle_get_agent)
                .put(handle_update_agent)
                .patch(handle_update_agent)
                .delete(handle_delete_agent),
        )
        .route("/api/agents/{id}/runs", get(handle_list_runs_for_agent))
        .route("/api/agents/{id}/dispatch", post(handle_dispatch_agent))
        .route(
            "/api/agents/{id}/triggers",
            get(handle_list_agent_triggers).post(handle_create_agent_trigger),
        )
        .route(
            "/api/agents/{id}/triggers/{tid}",
            put(handle_update_agent_trigger)
                .patch(handle_update_agent_trigger)
                .delete(handle_delete_agent_trigger),
        )
        .route(
            "/api/agents/triggers/{tid}",
            put(handle_update_agent_trigger_flat)
                .patch(handle_update_agent_trigger_flat)
                .delete(handle_delete_agent_trigger_flat),
        )
        .route(
            "/api/agent-triggers/{tid}",
            put(handle_update_agent_trigger_flat)
                .patch(handle_update_agent_trigger_flat)
                .delete(handle_delete_agent_trigger_flat),
        )
        .route("/api/vault/notes", get(handle_list_vault_notes))
        .route("/api/vault/tree", get(handle_vault_tree))
        .route("/api/vault/note", get(handle_get_vault_note))
        .route("/api/vault/notes/{*path}", get(handle_get_vault_note_by_path))
        .route("/api/vault/distill", post(handle_distill_vault))
        .route("/api/vault/reindex", post(handle_vault_reindex))
        .route(
            "/api/vault/search",
            get(handle_list_vault_notes).post(handle_search_vault_post),
        )
        .route("/api/companion/state", get(handle_companion_state))
        .route("/api/companion/nudges", get(handle_get_companion_nudges))
        .route(
            "/api/companion/nudges/evaluate",
            get(handle_get_companion_nudges).post(handle_get_companion_nudges),
        )
        .route(
            "/api/companion/nudges/{id}/dismiss",
            post(handle_dismiss_nudge),
        )
        .route(
            "/api/companion/nudges/{id}/ack",
            post(handle_dismiss_nudge),
        )
        .route(
            "/api/companion/nudges/{id}",
            patch(handle_dismiss_nudge).delete(handle_dismiss_nudge),
        )
        .route(
            "/api/companion/phrases",
            get(handle_list_companion_phrases).post(handle_create_companion_phrase),
        )
        .route(
            "/api/companion/phrases/{id}",
            put(handle_update_companion_phrase)
                .patch(handle_update_companion_phrase)
                .delete(handle_delete_companion_phrase),
        )
        // 8. Todos, Projects & Focus Timer (F13)
        .route(
            "/api/projects",
            get(handle_list_projects).post(handle_create_project),
        )
        .route(
            "/api/projects/{id}",
            get(handle_get_project)
                .put(handle_update_project)
                .patch(handle_update_project)
                .delete(handle_delete_project),
        )
        .route("/api/projects/{id}/flow", get(handle_project_flow_by_id))
        .route("/api/tasks", get(handle_list_tasks).post(handle_create_task))
        .route(
            "/api/tasks/perspectives/{perspective}",
            get(handle_list_tasks_by_perspective),
        )
        .route("/api/tasks/parse", post(handle_parse_task))
        .route("/api/tasks/quick-capture", post(handle_parse_task))
        .route("/api/tasks/bulk", post(handle_bulk_tasks))
        .route("/api/tasks/flow", get(handle_task_flow))
        .route("/api/tasks/capacity", get(handle_task_capacity))
        .route(
            "/api/tasks/{id}",
            get(handle_get_task)
                .put(handle_update_task)
                .patch(handle_update_task)
                .delete(handle_delete_task),
        )
        .route(
            "/api/tasks/{id}/status",
            patch(handle_patch_task_status).post(handle_patch_task_status),
        )
        .route("/api/tasks/{id}/complete", post(handle_complete_task))
        .route("/api/time/timer", get(handle_get_active_timer))
        .route("/api/timer/active", get(handle_get_active_timer))
        .route("/api/time-sessions/active", get(handle_get_active_timer))
        .route("/api/time/timer/start", post(handle_start_timer))
        .route("/api/timer/start", post(handle_start_timer))
        .route("/api/time-sessions/start", post(handle_start_timer))
        .route("/api/time/timer/stop", post(handle_stop_timer))
        .route("/api/timer/stop", post(handle_stop_timer))
        .route("/api/time-sessions/stop", post(handle_stop_timer))
        .route("/api/time/timer/discard", post(handle_discard_timer))
        .route("/api/timer/discard", post(handle_discard_timer))
        .route("/api/time-sessions/discard", post(handle_discard_timer))
        .route(
            "/api/time/sessions",
            get(handle_list_time_sessions).post(handle_create_time_session),
        )
        .route(
            "/api/time-sessions",
            get(handle_list_time_sessions).post(handle_create_time_session),
        )
        .route(
            "/api/time/sessions/{id}",
            delete(handle_delete_time_session),
        )
        .route(
            "/api/time-sessions/{id}",
            delete(handle_delete_time_session),
        )
        .route("/api/time/stats", get(handle_get_time_stats))
        .route("/api/time-sessions/stats", get(handle_get_time_stats))
        // 9. Routines, Habit Engine, Ideal Week & Weekly Review (F14)
        .route(
            "/api/routines",
            get(handle_list_routines).post(handle_create_routine),
        )
        .route("/api/routines/analytics", get(handle_routines_analytics))
        .route(
            "/api/routines/ideal-week",
            get(handle_get_ideal_week)
                .put(handle_replace_ideal_week)
                .post(handle_replace_ideal_week),
        )
        .route(
            "/api/ideal-week",
            get(handle_get_ideal_week)
                .put(handle_replace_ideal_week)
                .post(handle_replace_ideal_week),
        )
        .route(
            "/api/routines/day-profile",
            post(handle_set_day_profile).put(handle_set_day_profile),
        )
        .route(
            "/api/routines/logs",
            get(handle_list_routine_logs).post(handle_log_routine_item),
        )
        .route(
            "/api/routine-logs",
            get(handle_list_routine_logs).post(handle_log_routine_item),
        )
        .route(
            "/api/routines/checkins/{date}",
            get(handle_get_checkin)
                .put(handle_upsert_checkin)
                .post(handle_upsert_checkin),
        )
        .route(
            "/api/checkins/{date}",
            get(handle_get_checkin)
                .put(handle_upsert_checkin)
                .post(handle_upsert_checkin),
        )
        .route(
            "/api/routines/weekly-review",
            get(handle_weekly_review).post(handle_weekly_review),
        )
        .route(
            "/api/routines/weekly-review/summary",
            get(handle_weekly_review).post(handle_weekly_review),
        )
        .route(
            "/api/routines/weekly-review/export",
            post(handle_weekly_review).get(handle_weekly_review),
        )
        .route(
            "/api/weekly-review",
            get(handle_weekly_review).post(handle_weekly_review),
        )
        .route(
            "/api/weekly-review/summary",
            get(handle_weekly_review).post(handle_weekly_review),
        )
        .route(
            "/api/weekly-review/export",
            post(handle_weekly_review).get(handle_weekly_review),
        )
        .route(
            "/api/reviews/weekly",
            get(handle_weekly_review).post(handle_weekly_review),
        )
        .route(
            "/api/reviews/weekly/export",
            post(handle_weekly_review).get(handle_weekly_review),
        )
        .route(
            "/api/reviews/{week_key}",
            get(handle_get_weekly_review_by_key)
                .put(handle_upsert_weekly_review_by_key)
                .post(handle_upsert_weekly_review_by_key),
        )
        .route(
            "/api/routines/reviews/{week_key}",
            get(handle_get_weekly_review_by_key)
                .put(handle_upsert_weekly_review_by_key)
                .post(handle_upsert_weekly_review_by_key),
        )
        .route(
            "/api/reviews/{week_key}/export",
            post(handle_export_weekly_review_by_key).get(handle_get_weekly_review_by_key),
        )
        .route(
            "/api/routines/reviews/{week_key}/export",
            post(handle_export_weekly_review_by_key).get(handle_get_weekly_review_by_key),
        )
        .route(
            "/api/routines/{id}",
            get(handle_get_routine)
                .put(handle_update_routine)
                .patch(handle_update_routine)
                .delete(handle_delete_routine),
        )
        .route("/api/routines/{id}/items", post(handle_create_routine_item))
        .route(
            "/api/routines/items/{item_id}",
            put(handle_update_routine_item)
                .patch(handle_update_routine_item)
                .delete(handle_delete_routine_item),
        )
        .route(
            "/api/routine-items/{item_id}",
            put(handle_update_routine_item)
                .patch(handle_update_routine_item)
                .delete(handle_delete_routine_item),
        )
        .route(
            "/api/routines/items/{item_id}/logs",
            post(handle_log_routine_item_by_path),
        )
        .route(
            "/api/routine-items/{item_id}/logs",
            post(handle_log_routine_item_by_path),
        )
        // 10. Goals, OKRs & Q1–Q4 Yearly Blueprint (F15)
        .route(
            "/api/goals/cycles",
            get(handle_list_yearly_cycles).post(handle_upsert_yearly_cycle),
        )
        .route(
            "/api/yearly-cycles",
            get(handle_list_yearly_cycles).post(handle_upsert_yearly_cycle),
        )
        .route(
            "/api/goals/cycles/{year}",
            get(handle_get_yearly_cycle)
                .put(handle_update_yearly_cycle)
                .patch(handle_update_yearly_cycle),
        )
        .route(
            "/api/yearly-cycles/{year}",
            get(handle_get_yearly_cycle)
                .put(handle_update_yearly_cycle)
                .patch(handle_update_yearly_cycle),
        )
        .route(
            "/api/goals/cycles/{year}/blueprint",
            get(handle_get_goal_blueprint_by_year),
        )
        .route(
            "/api/yearly-cycles/{year}/blueprint",
            get(handle_get_goal_blueprint_by_year),
        )
        .route("/api/goals", get(handle_list_goals).post(handle_create_goal))
        .route("/api/goals/blueprint", get(handle_get_goal_blueprint_query))
        .route("/api/goals/pace-drift", get(handle_get_goals_pace_drift))
        .route(
            "/api/goals/{id}",
            get(handle_get_goal)
                .put(handle_update_goal)
                .patch(handle_update_goal)
                .delete(handle_delete_goal),
        )
        .route(
            "/api/goals/{id}/blueprint-pos",
            patch(handle_update_goal_blueprint_pos)
                .put(handle_update_goal_blueprint_pos)
                .post(handle_update_goal_blueprint_pos),
        )
        .route(
            "/api/goals/{id}/position",
            patch(handle_update_goal_blueprint_pos)
                .put(handle_update_goal_blueprint_pos)
                .post(handle_update_goal_blueprint_pos),
        )
        .route(
            "/api/goals/{id}/key-results",
            post(handle_create_key_result),
        )
        .route(
            "/api/goals/key-results/{kr_id}",
            put(handle_update_key_result)
                .patch(handle_update_key_result)
                .delete(handle_delete_key_result),
        )
        .route(
            "/api/key-results/{kr_id}",
            put(handle_update_key_result)
                .patch(handle_update_key_result)
                .delete(handle_delete_key_result),
        )
        .route(
            "/api/goals/{id}/checkins",
            get(handle_list_goal_checkins).post(handle_create_goal_checkin),
        )
        // 11. Courses, Syllabus, Read-Only YouTube Import & Spaced Repetition (F16)
        .route(
            "/api/courses",
            get(handle_list_courses).post(handle_create_course),
        )
        .route(
            "/api/courses/youtube-playlists",
            get(handle_list_youtube_playlists),
        )
        .route(
            "/api/courses/youtube/playlists",
            get(handle_list_youtube_playlists),
        )
        .route("/api/youtube/playlists", get(handle_list_youtube_playlists))
        .route(
            "/api/courses/import-youtube",
            post(handle_import_youtube_playlist),
        )
        .route(
            "/api/courses/youtube/import",
            post(handle_import_youtube_playlist),
        )
        .route(
            "/api/youtube/import",
            post(handle_import_youtube_playlist),
        )
        .route("/api/courses/reviews/due", get(handle_list_due_reviews))
        .route(
            "/api/courses/spaced-reviews/due",
            get(handle_list_due_reviews),
        )
        .route(
            "/api/courses/lessons/{lesson_id}/review",
            post(handle_complete_lesson_review),
        )
        .route(
            "/api/courses/lessons/{lesson_id}/review/complete",
            post(handle_complete_lesson_review),
        )
        .route(
            "/api/courses/reviews/{lesson_id}/complete",
            post(handle_complete_lesson_review),
        )
        .route(
            "/api/course-lessons/{lesson_id}/review",
            post(handle_complete_lesson_review),
        )
        .route(
            "/api/courses/{id}",
            get(handle_get_course)
                .put(handle_update_course)
                .patch(handle_update_course)
                .delete(handle_delete_course),
        )
        .route(
            "/api/courses/{id}/sync-youtube",
            post(handle_sync_youtube_course),
        )
        .route(
            "/api/courses/{id}/youtube/sync",
            post(handle_sync_youtube_course),
        )
        .route(
            "/api/courses/{id}/import-outline",
            post(handle_import_course_outline),
        )
        .route(
            "/api/courses/{id}/outline",
            post(handle_import_course_outline),
        )
        .route(
            "/api/courses/{id}/modules",
            post(handle_create_course_module),
        )
        .route(
            "/api/courses/modules/{module_id}",
            put(handle_update_course_module)
                .patch(handle_update_course_module)
                .delete(handle_delete_course_module),
        )
        .route(
            "/api/course-modules/{module_id}",
            put(handle_update_course_module)
                .patch(handle_update_course_module)
                .delete(handle_delete_course_module),
        )
        .route(
            "/api/courses/modules/{module_id}/lessons",
            post(handle_create_course_lesson),
        )
        .route(
            "/api/course-modules/{module_id}/lessons",
            post(handle_create_course_lesson),
        )
        .route(
            "/api/courses/lessons/{lesson_id}",
            put(handle_update_course_lesson)
                .patch(handle_update_course_lesson)
                .delete(handle_delete_course_lesson),
        )
        .route(
            "/api/course-lessons/{lesson_id}",
            put(handle_update_course_lesson)
                .patch(handle_update_course_lesson)
                .delete(handle_delete_course_lesson),
        )
        .route(
            "/api/courses/lessons/{lesson_id}/status",
            patch(handle_patch_course_lesson_status).put(handle_patch_course_lesson_status),
        )
        .route(
            "/api/course-lessons/{lesson_id}/status",
            patch(handle_patch_course_lesson_status).put(handle_patch_course_lesson_status),
        )
        .route(
            "/api/courses/{id}/quizzes",
            get(handle_list_course_quizzes).post(handle_create_course_quiz),
        )
        .route("/api/courses/{id}/quiz", post(handle_create_course_quiz))
        .route(
            "/api/courses/{id}/spawn-todo",
            post(handle_spawn_course_todo),
        )
        // 12. Multi-Market Finance, Allocation & FIRE Simulator (F17)
        .route(
            "/api/finance/assets",
            get(handle_list_assets).post(handle_create_asset),
        )
        .route(
            "/api/finance/assets/{id}",
            get(handle_get_asset)
                .put(handle_update_asset)
                .patch(handle_update_asset)
                .delete(handle_delete_asset),
        )
        .route(
            "/api/finance/assets/{id}/candles",
            get(handle_get_asset_candles),
        )
        .route("/api/finance/quotes/refresh", post(handle_refresh_quotes))
        .route("/api/finance/refresh-quotes", post(handle_refresh_quotes))
        .route("/api/finance/allocation", get(handle_get_allocation))
        .route("/api/finance/rebalance", get(handle_get_allocation))
        .route("/api/finance/monthly-plans", get(handle_list_monthly_plans))
        .route("/api/finance/sheets", get(handle_list_monthly_plans))
        .route(
            "/api/finance/monthly-plans/{month}",
            get(handle_get_monthly_plan)
                .put(handle_upsert_monthly_plan)
                .post(handle_upsert_monthly_plan),
        )
        .route(
            "/api/finance/monthly-plan/{month}",
            get(handle_get_monthly_plan)
                .put(handle_upsert_monthly_plan)
                .post(handle_upsert_monthly_plan),
        )
        .route(
            "/api/finance/sheets/{month}",
            get(handle_get_monthly_plan)
                .put(handle_upsert_monthly_plan)
                .post(handle_upsert_monthly_plan),
        )
        .route(
            "/api/finance/retirement",
            get(handle_get_retirement_projection)
                .put(handle_update_retirement_config)
                .post(handle_update_retirement_config)
                .patch(handle_update_retirement_config),
        )
        .route(
            "/api/finance/retirement/config",
            get(handle_get_retirement_config)
                .put(handle_update_retirement_config)
                .post(handle_update_retirement_config)
                .patch(handle_update_retirement_config),
        )
        .route(
            "/api/finance/retirement/projection",
            get(handle_get_retirement_projection),
        )
        .route(
            "/api/finance/retirement/simulate",
            post(handle_simulate_retirement),
        )
        .route(
            "/api/finance/fire/simulate",
            post(handle_simulate_retirement),
        )
        .route(
            "/api/finance/snapshots",
            get(handle_list_snapshots).post(handle_create_snapshot),
        )
        // Catch-all for unknown `/api/*` routes so they NEVER fall through to SPA HTML
        .route("/api/{*rest}", axum::routing::any(handle_api_not_found))
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
        .with_state(state.clone());

    let mcp_subrouter = mcp_router(Arc::new(state.intelligence.clone())).layer(
        middleware::from_fn_with_state(state.clone(), auth_middleware),
    );

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
        .expose_headers([
            header::HeaderName::from_static("mcp-session-id"),
            header::CONTENT_TYPE,
        ]);

    let app_router = Router::new()
        .merge(api_router)
        .fallback(handle_spa_or_static_fallback)
        .with_state(state);

    app_router.merge(mcp_subrouter).layer(cors)
}

// =============================================================================
// 5. Static Bundle & CSR SPA Fallback (`STATIC_DIST_DIR` + Security Guards)
// =============================================================================

const FALLBACK_CSR_SHELL_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HERMES // OS</title>
  </head>
  <body style="background:#08080B;color:#F6F6F4;margin:0;border-radius:0;">
    <div id="root"></div>
    <script type="module" src="/assets/index.js"></script>
  </body>
</html>
"#;

async fn handle_api_not_found(uri: Uri) -> Response {
    ServerError(ApiError::not_found(format!(
        "API endpoint '{}' not found",
        uri.path()
    )))
    .into_response()
}

async fn handle_spa_or_static_fallback(
    State(state): State<AppState>,
    req: Request,
) -> Response {
    let raw_uri = req.uri().to_string();
    let raw_lower = raw_uri.to_ascii_lowercase();
    let path = req.uri().path().to_string();

    // 1. Block path traversal probes (`/..`, `%2e%2e`, `%2f`, `\`) with 400 Bad Request
    if path.contains("..")
        || path.contains('\\')
        || raw_lower.contains("%2e")
        || raw_lower.contains("%2f")
        || raw_lower.contains("%5c")
    {
        return ServerError(ApiError::bad_request("Path traversal is forbidden")).into_response();
    }

    // 2. Never serve HTML for `/api` or `/mcp` prefixes
    if path == "/api" || path.starts_with("/api/") || path == "/mcp" || path.starts_with("/mcp/") {
        return ServerError(ApiError::not_found(format!(
            "Endpoint '{}' not found",
            path
        )))
        .into_response();
    }

    let method = req.method().clone();
    let dist_dir: &Path = &state.config.static_dist_dir;

    // 3. Try serving an exact static file from `STATIC_DIST_DIR` via `ServeDir`
    if dist_dir.exists() && path != "/" {
        let rel = path.trim_start_matches('/');
        let candidate = dist_dir.join(rel);
        if candidate.is_file() {
            let Ok(resp) = ServeDir::new(dist_dir).oneshot(req).await;
            if resp.status().is_success() || resp.status().is_redirection() {
                return resp.into_response();
            }
        }
    }

    // 4. If the path looks like a missing static asset or file probe (e.g. `/assets/nonexistent.js`,
    // `/package.json`, `/Cargo.toml`) rather than a client SPA route, return 404 Not Found!
    let last_segment = path.rsplit('/').next().unwrap_or("");
    let is_html_file = last_segment.ends_with(".html");
    if (path.starts_with("/assets/") || (last_segment.contains('.') && !is_html_file))
        && path != "/"
    {
        return ServerError(ApiError::not_found(format!(
            "Static asset '{}' not found",
            path
        )))
        .into_response();
    }

    // 5. Only serve SPA `index.html` for `GET` / `HEAD` navigation requests
    if method != Method::GET && method != Method::HEAD {
        return ServerError(ApiError::not_found(format!(
            "Route '{}' not found",
            path
        )))
        .into_response();
    }

    let index_path = dist_dir.join("index.html");
    let html = std::fs::read_to_string(&index_path)
        .unwrap_or_else(|_| FALLBACK_CSR_SHELL_HTML.to_string());

    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        Html(html),
    )
        .into_response()
}

// =============================================================================
// 6. Domain 1 — Health, OpenAPI & Auth Handlers (F06, F07)
// =============================================================================

async fn handle_health(State(state): State<AppState>) -> Json<HealthStatusResponse> {
    let db_online = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.life_ops.pool)
        .await
        .is_ok();

    let redis_online = match &state.life_ops.redis {
        Some(client) => match client.get_multiplexed_async_connection().await {
            Ok(mut conn) => redis::cmd("PING")
                .query_async::<String>(&mut conn)
                .await
                .is_ok(),
            Err(_) => false,
        },
        None => true,
    };

    let gw = state.intelligence.check_gateway_health().await;
    let hermes_gateway = if gw == "online" {
        GatewayHealthMode::Online
    } else {
        GatewayHealthMode::OfflineMock
    };

    Json(HealthStatusResponse {
        status: "ok".to_string(),
        db_online,
        redis_online,
        hermes_gateway,
        version: SYSTEM_VERSION.to_string(),
    })
}

async fn handle_openapi_json() -> Response {
    let body = openapi::openapi_pretty_json();
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        body,
    )
        .into_response()
}

async fn handle_auth_verify(
    State(state): State<AppState>,
    headers: HeaderMap,
    uri: Uri,
) -> ServerResult<Json<AuthVerifyResponse>> {
    let (token, _) = extract_bearer_or_cookie_or_query_token(&headers, &uri);
    let verified = state
        .life_ops
        .verify_pat_or_session(token.as_deref())
        .await?;
    Ok(Json(verified))
}

async fn handle_auth_login(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Response> {
    let req: LoginRequest = parse_json_bytes(&body)?;
    let resp = state
        .life_ops
        .login_password(&req.username, &req.password)
        .await?;
    let cookie = format!(
        "hermes_session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
        resp.session_token
    );
    let mut response = (StatusCode::OK, Json(resp)).into_response();
    if let Ok(hv) = HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(header::SET_COOKIE, hv);
    }
    Ok(response)
}

async fn handle_auth_logout(
    State(state): State<AppState>,
    headers: HeaderMap,
    uri: Uri,
) -> ServerResult<Response> {
    let (token, _) = extract_bearer_or_cookie_or_query_token(&headers, &uri);
    if let Some(tok) = token {
        let _ = state.life_ops.logout_session(&tok).await;
    }
    let clear_cookie = "hermes_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
    let mut response = (StatusCode::OK, Json(json!({ "ok": true }))).into_response();
    if let Ok(hv) = HeaderValue::from_str(clear_cookie) {
        response.headers_mut().insert(header::SET_COOKIE, hv);
    }
    Ok(response)
}

async fn handle_auth_me(
    State(state): State<AppState>,
    headers: HeaderMap,
    uri: Uri,
) -> ServerResult<Json<User>> {
    let (token, _) = extract_bearer_or_cookie_or_query_token(&headers, &uri);
    let user = state.life_ops.get_me(token.as_deref()).await?;
    Ok(Json(user))
}

async fn handle_list_pats(
    State(state): State<AppState>,
) -> ServerResult<Json<Vec<ApiTokenSummary>>> {
    let tokens = state.life_ops.list_pats().await?;
    Ok(Json(tokens))
}

async fn handle_create_pat(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<CreatedPatResponse>)> {
    let req: CreatePatRequest = parse_json_bytes(&body)?;
    let created = state.life_ops.create_pat(req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_revoke_pat(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.life_ops.revoke_pat(id).await?;
    Ok(Json(json!({ "id": id, "revoked": true })))
}

async fn handle_pairing_qr(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Json<PairingQrResponse>> {
    let req: PairingQrRequest = parse_optional_json_bytes(&body)?;
    let qr = state.life_ops.build_pairing_qr(req).await?;
    Ok(Json(qr))
}

async fn handle_pairing_qr_get(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<PairingQrResponse>> {
    let req = PairingQrRequest {
        primary_url: params
            .get("primary_url")
            .or_else(|| params.get("server_url"))
            .or_else(|| params.get("base_url"))
            .cloned(),
        fallback_url: params.get("fallback_url").cloned(),
        token_name: params.get("token_name").cloned(),
    };
    let qr = state.life_ops.build_pairing_qr(req).await?;
    Ok(Json(qr))
}

// =============================================================================
// 7. Domain 2 — Scoped Mobile Delta Sync Handlers (F08)
// =============================================================================

async fn handle_sync_push(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Json<SyncPushResponse>> {
    let req: SyncPushRequest = parse_json_bytes(&body)?;
    let resp = state.life_ops.sync_push(req).await?;
    Ok(Json(resp))
}

async fn handle_sync_pull(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<SyncPullResponse>> {
    let since = params
        .get("since")
        .or_else(|| params.get("since_seq"))
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    let limit = params
        .get("limit")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(5000)
        .max(1);
    let resp = state.life_ops.sync_pull(since, limit).await?;
    Ok(Json(resp))
}

async fn handle_sync_pull_post(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
    body: Bytes,
) -> ServerResult<Json<SyncPullResponse>> {
    let body_val: Value = if body.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&body).unwrap_or_else(|_| json!({}))
    };
    let since = params
        .get("since")
        .or_else(|| params.get("since_seq"))
        .and_then(|s| s.parse::<i64>().ok())
        .or_else(|| body_val.get("since").and_then(|v| v.as_i64()))
        .or_else(|| body_val.get("since_seq").and_then(|v| v.as_i64()))
        .unwrap_or(0);
    let limit = params
        .get("limit")
        .and_then(|s| s.parse::<usize>().ok())
        .or_else(|| {
            body_val
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize)
        })
        .unwrap_or(5000)
        .max(1);
    let resp = state.life_ops.sync_pull(since, limit).await?;
    Ok(Json(resp))
}

// =============================================================================
// 8. Domain 3 — Dashboards, Widgets, Life Score, Servers & SSE (F11)
// =============================================================================

async fn handle_list_dashboards(
    State(state): State<AppState>,
) -> ServerResult<Json<Vec<DashboardWithWidgets>>> {
    let decks = state.life_ops.list_dashboards().await?;
    Ok(Json(decks))
}

async fn handle_create_dashboard(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<DashboardWithWidgets>)> {
    let mut req: CreateDashboardRequest = parse_json_bytes(&body)?;
    // Clamp positive sub-5s cycle_seconds (1..=4) to 5s to satisfy DB CHECK >= 5 while rejecting <= 0
    if (1..5).contains(&req.cycle_seconds) {
        req.cycle_seconds = 5;
    }
    let created = state.life_ops.create_dashboard(req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_get_dashboard(
    State(state): State<AppState>,
    AxumPath(id_or_slug): AxumPath<String>,
) -> ServerResult<Json<DashboardWithWidgets>> {
    let deck = state.life_ops.get_dashboard(&id_or_slug).await?;
    Ok(Json(deck))
}

async fn handle_update_dashboard(
    State(state): State<AppState>,
    AxumPath(id_or_slug): AxumPath<String>,
    body: Bytes,
) -> ServerResult<Json<DashboardWithWidgets>> {
    let existing = state.life_ops.get_dashboard(&id_or_slug).await?;
    let mut req: UpdateDashboardRequest = parse_json_bytes(&body)?;
    if let Some(cs) = req.cycle_seconds {
        if (1..5).contains(&cs) {
            req.cycle_seconds = Some(5);
        }
    }
    let updated = state
        .life_ops
        .update_dashboard(existing.dashboard.id, req)
        .await?;
    Ok(Json(updated))
}

async fn handle_delete_dashboard(
    State(state): State<AppState>,
    AxumPath(id_or_slug): AxumPath<String>,
) -> ServerResult<Json<Value>> {
    let existing = state.life_ops.get_dashboard(&id_or_slug).await?;
    state.life_ops.delete_dashboard(existing.dashboard.id).await?;
    Ok(Json(json!({ "id": existing.dashboard.id, "deleted": true })))
}

async fn handle_clone_dashboard(
    State(state): State<AppState>,
    AxumPath(id_or_slug): AxumPath<String>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<DashboardWithWidgets>)> {
    let existing = state.life_ops.get_dashboard(&id_or_slug).await?;
    let req: CloneDashboardRequest = parse_optional_json_bytes(&body)?;
    let cloned = state
        .life_ops
        .clone_dashboard(existing.dashboard.id, req)
        .await?;
    Ok((StatusCode::CREATED, Json(cloned)))
}

async fn handle_reorder_dashboards(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Json<Vec<Dashboard>>> {
    let req: ReorderDashboardsRequest = parse_json_bytes(&body)?;
    let ordered = state.life_ops.reorder_dashboards(req).await?;
    Ok(Json(ordered))
}

async fn handle_create_widget(
    State(state): State<AppState>,
    AxumPath(id_or_slug): AxumPath<String>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<DashboardWidget>)> {
    let deck = state.life_ops.get_dashboard(&id_or_slug).await?;
    let mut req: CreateWidgetRequest = parse_json_bytes(&body)?;
    if (1..5).contains(&req.refresh_interval_seconds) {
        req.refresh_interval_seconds = 5;
    }
    let created = state.life_ops.create_widget(deck.dashboard.id, req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_update_widget(
    State(state): State<AppState>,
    AxumPath((id_or_slug, widget_id)): AxumPath<(String, Uuid)>,
    body: Bytes,
) -> ServerResult<Json<DashboardWidget>> {
    let deck = state.life_ops.get_dashboard(&id_or_slug).await?;
    let mut req: UpdateWidgetRequest = parse_json_bytes(&body)?;
    if let Some(ri) = req.refresh_interval_seconds {
        if (1..5).contains(&ri) {
            req.refresh_interval_seconds = Some(5);
        }
    }
    let updated = state
        .life_ops
        .update_widget(deck.dashboard.id, widget_id, req)
        .await?;
    Ok(Json(updated))
}

async fn handle_delete_widget(
    State(state): State<AppState>,
    AxumPath((id_or_slug, widget_id)): AxumPath<(String, Uuid)>,
) -> ServerResult<Json<Value>> {
    let deck = state.life_ops.get_dashboard(&id_or_slug).await?;
    state
        .life_ops
        .delete_widget(deck.dashboard.id, widget_id)
        .await?;
    Ok(Json(json!({ "id": widget_id, "deleted": true })))
}

async fn handle_update_widget_flat(
    State(state): State<AppState>,
    AxumPath(widget_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<DashboardWidget>> {
    let dashboard_id = state.life_ops.find_widget_dashboard_id(widget_id).await?;
    let mut req: UpdateWidgetRequest = parse_json_bytes(&body)?;
    if let Some(ri) = req.refresh_interval_seconds {
        if (1..5).contains(&ri) {
            req.refresh_interval_seconds = Some(5);
        }
    }
    let updated = state
        .life_ops
        .update_widget(dashboard_id, widget_id, req)
        .await?;
    Ok(Json(updated))
}

async fn handle_delete_widget_flat(
    State(state): State<AppState>,
    AxumPath(widget_id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    let dashboard_id = state.life_ops.find_widget_dashboard_id(widget_id).await?;
    state.life_ops.delete_widget(dashboard_id, widget_id).await?;
    Ok(Json(json!({ "id": widget_id, "deleted": true })))
}

async fn handle_refresh_dashboard_widget(
    State(state): State<AppState>,
    AxumPath((_id_or_slug, widget_id)): AxumPath<(String, Uuid)>,
) -> ServerResult<Json<DashboardWidget>> {
    let refreshed = state.life_ops.refresh_widget(widget_id).await?;
    Ok(Json(refreshed))
}

async fn handle_refresh_widget_flat(
    State(state): State<AppState>,
    AxumPath(widget_id): AxumPath<Uuid>,
) -> ServerResult<Json<DashboardWidget>> {
    let refreshed = state.life_ops.refresh_widget(widget_id).await?;
    Ok(Json(refreshed))
}

async fn handle_get_life_score(
    State(state): State<AppState>,
) -> ServerResult<Json<LifeScoreResponse>> {
    let score = state.life_ops.compute_life_score().await?;
    Ok(Json(score))
}

async fn handle_list_servers(
    State(state): State<AppState>,
) -> ServerResult<Json<Vec<ServerNode>>> {
    let nodes = state.life_ops.list_servers().await?;
    Ok(Json(nodes))
}

async fn handle_create_server(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<ServerNode>)> {
    let req: CreateServerRequest = parse_json_bytes(&body)?;
    let node = state.life_ops.create_server(req).await?;
    Ok((StatusCode::CREATED, Json(node)))
}

async fn handle_servers_summary(
    State(state): State<AppState>,
) -> ServerResult<Json<ServerSummaryResponse>> {
    let summary = state.life_ops.get_servers_summary().await?;
    Ok(Json(summary))
}

async fn handle_check_all_servers(
    State(state): State<AppState>,
) -> ServerResult<Json<Vec<ServerNode>>> {
    let results = state.life_ops.check_all_servers().await?;
    Ok(Json(results))
}

async fn handle_get_server(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<ServerNode>> {
    let node = state.life_ops.get_server(id).await?;
    Ok(Json(node))
}

async fn handle_update_server(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<ServerNode>> {
    let req: UpdateServerRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.update_server(id, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_server(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.life_ops.delete_server(id).await?;
    Ok(Json(json!({ "id": id, "deleted": true })))
}

async fn handle_check_server(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<ServerNode>> {
    let checked = state.life_ops.check_server(id).await?;
    Ok(Json(checked))
}

async fn handle_events_stream(
    State(state): State<AppState>,
) -> Sse<impl futures::Stream<Item = Result<SseEvent, Infallible>>> {
    let rx = state.life_ops.subscribe_events();

    let stream = async_stream_from_broadcast(rx);
    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

fn async_stream_from_broadcast(
    rx: tokio::sync::broadcast::Receiver<SystemEvent>,
) -> impl futures::Stream<Item = Result<SseEvent, Infallible>> + Send + 'static {
    let initial_payload = json!({
        "type": "connected",
        "status": "ok",
        "timestamp": Utc::now(),
    });
    let initial_event = SseEvent::default()
        .event("connected")
        .data(initial_payload.to_string());

    let broadcast_stream = futures::stream::unfold(rx, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(ev) => {
                    let event_type = serde_json::to_value(&ev)
                        .ok()
                        .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(String::from))
                        .unwrap_or_else(|| "system_event".to_string());
                    let data = serde_json::to_string(&ev).unwrap_or_else(|_| "{}".to_string());
                    let sse = SseEvent::default().event(event_type).data(data);
                    return Some((Ok(sse), receiver));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
            }
        }
    });

    futures::stream::once(async move { Ok(initial_event) }).chain(broadcast_stream)
}

// =============================================================================
// 9. Domain 4 — Hermes Gateway, Sessions & Chat SSE (F09)
// =============================================================================

async fn handle_hermes_health(State(state): State<AppState>) -> Json<Value> {
    let mode = state.intelligence.check_gateway_health().await;
    Json(json!({
        "status": "ok",
        "hermes_gateway": mode,
        "gateway_url": state.intelligence.gateway_url,
    }))
}

async fn handle_list_hermes_sessions(
    State(state): State<AppState>,
    Query(query): Query<ListHermesSessionsQuery>,
) -> ServerResult<Json<Vec<HermesSession>>> {
    let sessions = state.intelligence.list_sessions(query).await?;
    Ok(Json(sessions))
}

async fn handle_create_hermes_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<HermesSession>)> {
    let mut req: CreateHermesSessionRequest = parse_optional_json_bytes(&body)?;
    if req.session_key.is_none() {
        if let Some(hdr_key) = headers
            .get("x-hermes-session-key")
            .and_then(|v| v.to_str().ok())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            req.session_key = Some(hdr_key.to_string());
        }
    }
    let session = state.intelligence.create_session(req).await?;
    Ok((StatusCode::CREATED, Json(session)))
}

async fn handle_get_hermes_session(
    State(state): State<AppState>,
    AxumPath(key): AxumPath<String>,
) -> ServerResult<Json<HermesSession>> {
    let session = state.intelligence.get_session(&key).await?;
    Ok(Json(session))
}

async fn handle_update_hermes_session(
    State(state): State<AppState>,
    AxumPath(key): AxumPath<String>,
    body: Bytes,
) -> ServerResult<Json<HermesSession>> {
    let req: UpdateHermesSessionRequest = parse_json_bytes(&body)?;
    let updated = state.intelligence.update_session(&key, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_hermes_session(
    State(state): State<AppState>,
    AxumPath(key): AxumPath<String>,
) -> ServerResult<Json<Value>> {
    state.intelligence.delete_session(&key).await?;
    Ok(Json(json!({ "session_key": key, "deleted": true })))
}

async fn handle_fork_hermes_session(
    State(state): State<AppState>,
    AxumPath(key): AxumPath<String>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<HermesSession>)> {
    let req: ForkHermesSessionRequest = parse_optional_json_bytes(&body)?;
    let forked = state.intelligence.fork_session(&key, req).await?;
    Ok((StatusCode::CREATED, Json(forked)))
}

async fn handle_distill_session_to_vault(
    State(state): State<AppState>,
    AxumPath(key): AxumPath<String>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<DistillVaultResponse>)> {
    let val: Value = parse_optional_json_bytes(&body)?;
    let session_opt = state.intelligence.get_session(&key).await.ok();
    let title = val
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| session_opt.as_ref().map(|s| s.title.clone()))
        .unwrap_or_else(|| format!("Distilled Session {key}"));
    let content_md = val
        .get("content_md")
        .or_else(|| val.get("content"))
        .or_else(|| val.get("markdown"))
        .or_else(|| val.get("body"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| {
            session_opt.as_ref().map(|s| {
                let mut lines = Vec::new();
                if let Some(arr) = s.messages_json.as_array() {
                    for msg in arr {
                        let role = msg
                            .get("role")
                            .and_then(|v| v.as_str())
                            .unwrap_or("assistant");
                        let content = msg
                            .get("content")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if !content.trim().is_empty() {
                            lines.push(format!("**{role}**: {content}"));
                        }
                    }
                }
                if lines.is_empty() {
                    format!("Distilled summary for session `{}`.", s.session_key)
                } else {
                    lines.join("\n\n")
                }
            })
        })
        .unwrap_or_else(|| format!("Distilled summary for session `{key}`."));
    let tags = val
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t.as_str().map(String::from))
                .collect::<Vec<String>>()
        })
        .unwrap_or_else(|| vec!["hermes-distill".to_string()]);

    let distilled = state
        .intelligence
        .distill_to_vault(DistillVaultRequest {
            title,
            content_md,
            session_key: Some(key),
            tags,
        })
        .await?;
    Ok((StatusCode::CREATED, Json(distilled)))
}

async fn handle_hermes_chat_stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> ServerResult<Sse<impl futures::Stream<Item = Result<SseEvent, Infallible>>>> {
    let header_session_key = headers
        .get("x-hermes-session-key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let req: ChatStreamRequest = parse_json_bytes(&body)?;
    let events = state
        .intelligence
        .stream_chat(header_session_key.as_deref(), req)
        .await?;

    let stream = futures::stream::unfold(events.into_iter(), |mut iter| async move {
        let ev = iter.next()?;
        tokio::task::yield_now().await;
        let event_name = ev.event_name();
        let data = serde_json::to_string(&ev).unwrap_or_else(|_| "{}".to_string());
        Some((Ok(SseEvent::default().event(event_name).data(data)), iter))
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}

// =============================================================================
// 10. Domain 5 — MCP Tools, Approvals & Undo REST Handlers (F10)
// =============================================================================

async fn handle_list_mcp_tools(State(state): State<AppState>) -> Json<Vec<Value>> {
    let specs = state
        .intelligence
        .list_mcp_tool_specs()
        .into_iter()
        .map(|s| {
            json!({
                "name": s.name,
                "domain": s.domain,
                "autonomy_tier": s.tier,
                "description": s.description,
                "inputSchema": s.schema,
            })
        })
        .collect();
    Json(specs)
}

async fn handle_call_mcp_tool(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> ServerResult<Json<Value>> {
    let payload: Value = parse_json_bytes(&body)?;
    let tool_name = payload
        .get("name")
        .or_else(|| payload.get("tool_name"))
        .or_else(|| payload.get("tool"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| ApiError::bad_request("Missing 'name' or 'tool_name' for MCP tool call"))?;

    let arguments = payload
        .get("arguments")
        .or_else(|| payload.get("args"))
        .or_else(|| payload.get("input"))
        .cloned()
        .unwrap_or_else(|| json!({}));

    let session_key = payload
        .get("session_key")
        .and_then(|v| v.as_str())
        .map(String::from)
        .or_else(|| {
            headers
                .get("x-hermes-session-key")
                .and_then(|v| v.to_str().ok())
                .map(String::from)
        })
        .unwrap_or_else(|| "mcp-rest".to_string());

    let ctx = McpCallContext {
        session_key,
        agent_run_id: None,
        knight_policy: payload.get("tools_policy").cloned(),
        allowed_tools: None,
        bypass_approval_gate: false,
    };

    let outcome = state
        .intelligence
        .execute_mcp_tool_with_autonomy(tool_name, arguments, ctx)
        .await?;
    Ok(Json(outcome.to_json_value()))
}

async fn handle_list_mcp_approvals(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<Vec<PendingMcpApproval>>> {
    let session_key = params.get("session_key").map(String::as_str);
    let status = params
        .get("status")
        .and_then(|s| serde_json::from_value::<ApprovalStatus>(Value::String(s.clone())).ok());
    let list = state
        .intelligence
        .list_pending_approvals(session_key, status)
        .await?;
    Ok(Json(list))
}

async fn handle_approve_mcp_action(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<Value>> {
    let req: ResolveMcpApprovalRequest = parse_optional_json_bytes(&body)?;
    let approval = state.intelligence.approve_mcp_action(id, req).await?;
    let mut val = serde_json::to_value(&approval)
        .map_err(|e| ServerError(ApiError::internal(format!("Serialization error: {e}"))))?;
    if let Some(obj) = val.as_object_mut() {
        obj.insert(
            "result".to_string(),
            approval.result_json.clone().unwrap_or(Value::Null),
        );
        obj.insert(
            "approval".to_string(),
            serde_json::to_value(&approval).unwrap_or(Value::Null),
        );
    }
    Ok(Json(val))
}

async fn handle_reject_mcp_action(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    _body: Bytes,
) -> ServerResult<Json<PendingMcpApproval>> {
    let rejected = state.intelligence.reject_mcp_action(id).await?;
    Ok(Json(rejected))
}

async fn handle_list_mcp_undo(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<Vec<McpUndoAction>>> {
    let session_key = params.get("session_key").map(String::as_str);
    let actions = state.intelligence.list_undo_actions(session_key).await?;
    Ok(Json(actions))
}

async fn handle_undo_mcp_action(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    let undo_action = state.intelligence.undo_mcp_action(id).await?;
    let mut val = serde_json::to_value(&undo_action)
        .map_err(|e| ServerError(ApiError::internal(format!("Serialization error: {e}"))))?;
    if let Some(obj) = val.as_object_mut() {
        obj.insert("reverted".to_string(), Value::Bool(true));
        obj.insert(
            "undo_action".to_string(),
            serde_json::to_value(&undo_action).unwrap_or(Value::Null),
        );
    }
    Ok(Json(val))
}

// =============================================================================
// 11. Domain 6 — Agent Studio Knights, Vault Inspector & Companion (F12)
// =============================================================================

async fn handle_list_agents(
    State(state): State<AppState>,
) -> ServerResult<Json<Vec<AgentWithTelemetry>>> {
    let agents = state.intelligence.list_agents().await?;
    Ok(Json(agents))
}

async fn handle_create_agent(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<AgentWithTelemetry>)> {
    let req: CreateAgentRequest = parse_json_bytes(&body)?;
    let created = state.intelligence.create_agent(req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_get_agent_queue(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<AgentQueueResponse>> {
    let limit = params.get("limit").and_then(|s| s.parse::<usize>().ok());
    let queue = state.intelligence.get_agent_queue(limit).await?;
    Ok(Json(queue))
}

async fn handle_list_agent_runs(
    State(state): State<AppState>,
    Query(filter): Query<AgentRunFilter>,
) -> ServerResult<Json<Vec<AgentRun>>> {
    let runs = state.intelligence.list_agent_runs(filter).await?;
    Ok(Json(runs))
}

async fn handle_get_agent_run(
    State(state): State<AppState>,
    AxumPath(run_id): AxumPath<Uuid>,
) -> ServerResult<Json<AgentRun>> {
    let run = state.intelligence.get_agent_run(run_id).await?;
    Ok(Json(run))
}

async fn handle_get_agent(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> ServerResult<Json<AgentWithTelemetry>> {
    let agent = state.intelligence.get_agent(id).await?;
    Ok(Json(agent))
}

async fn handle_update_agent(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    body: Bytes,
) -> ServerResult<Json<AgentWithTelemetry>> {
    let req: UpdateAgentRequest = parse_json_bytes(&body)?;
    let updated = state.intelligence.update_agent(id, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_agent(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> ServerResult<Json<Value>> {
    state.intelligence.delete_agent(&id).await?;
    Ok(Json(json!({ "id": id, "deleted": true })))
}

async fn handle_list_runs_for_agent(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(mut filter): Query<AgentRunFilter>,
) -> ServerResult<Json<Vec<AgentRun>>> {
    let agent = state.intelligence.get_agent(&id).await?;
    filter.agent_id = Some(agent.agent.id);
    let runs = state.intelligence.list_agent_runs(filter).await?;
    Ok(Json(runs))
}

async fn handle_dispatch_agent(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    body: Bytes,
) -> ServerResult<Json<AgentRun>> {
    let req: DispatchAgentRequest = parse_optional_json_bytes(&body)?;
    let run = state.intelligence.dispatch_agent(id, req).await?;
    Ok(Json(run))
}

async fn handle_list_agent_triggers(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> ServerResult<Json<Vec<AgentTrigger>>> {
    let triggers = state.intelligence.list_agent_triggers(id).await?;
    Ok(Json(triggers))
}

async fn handle_create_agent_trigger(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<AgentTrigger>)> {
    let req: CreateAgentTriggerRequest = parse_json_bytes(&body)?;
    let created = state.intelligence.create_agent_trigger(id, req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_update_agent_trigger(
    State(state): State<AppState>,
    AxumPath((_id, tid)): AxumPath<(String, Uuid)>,
    body: Bytes,
) -> ServerResult<Json<AgentTrigger>> {
    let req: UpdateAgentTriggerRequest = parse_json_bytes(&body)?;
    let updated = state.intelligence.update_agent_trigger(tid, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_agent_trigger(
    State(state): State<AppState>,
    AxumPath((_id, tid)): AxumPath<(String, Uuid)>,
) -> ServerResult<Json<Value>> {
    state.intelligence.delete_agent_trigger(tid).await?;
    Ok(Json(json!({ "id": tid, "deleted": true })))
}

async fn handle_update_agent_trigger_flat(
    State(state): State<AppState>,
    AxumPath(tid): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<AgentTrigger>> {
    let req: UpdateAgentTriggerRequest = parse_json_bytes(&body)?;
    let updated = state.intelligence.update_agent_trigger(tid, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_agent_trigger_flat(
    State(state): State<AppState>,
    AxumPath(tid): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.intelligence.delete_agent_trigger(tid).await?;
    Ok(Json(json!({ "id": tid, "deleted": true })))
}

async fn handle_list_vault_notes(
    State(state): State<AppState>,
    Query(query): Query<VaultNoteListQuery>,
) -> ServerResult<Json<Vec<VaultNoteSummary>>> {
    let notes = state.intelligence.list_vault_notes(query).await?;
    Ok(Json(notes))
}

async fn handle_vault_tree(
    State(state): State<AppState>,
    Query(query): Query<VaultNoteListQuery>,
) -> ServerResult<Json<Value>> {
    let notes = state.intelligence.list_vault_notes(query).await?;
    Ok(Json(json!({
        "notes": notes,
        "tree": notes,
        "items": notes,
    })))
}

async fn handle_search_vault_post(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Json<Vec<VaultNoteSummary>>> {
    let query: VaultNoteListQuery = parse_optional_json_bytes(&body)?;
    let notes = state.intelligence.list_vault_notes(query).await?;
    Ok(Json(notes))
}

async fn handle_get_vault_note(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<VaultNoteDetail>> {
    let path = params
        .get("path")
        .or_else(|| params.get("file_path"))
        .map(String::as_str)
        .unwrap_or("");
    let detail = state.intelligence.read_vault_note(path).await?;
    Ok(Json(detail))
}

async fn handle_get_vault_note_by_path(
    State(state): State<AppState>,
    AxumPath(raw_path): AxumPath<String>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<VaultNoteDetail>> {
    let query_path = params
        .get("path")
        .or_else(|| params.get("file_path"))
        .map(String::as_str)
        .filter(|s| !s.trim().is_empty());
    let resolved = if let Some(qp) = query_path {
        qp.to_string()
    } else {
        raw_path
            .trim_start_matches('/')
            .replace("%2F", "/")
            .replace("%2f", "/")
            .replace("%20", " ")
    };
    let detail = state.intelligence.read_vault_note(&resolved).await?;
    Ok(Json(detail))
}

async fn handle_distill_vault(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<DistillVaultResponse>)> {
    let req: DistillVaultRequest = parse_json_bytes(&body)?;
    let distilled = state.intelligence.distill_to_vault(req).await?;
    Ok((StatusCode::CREATED, Json(distilled)))
}

async fn handle_vault_reindex(
    State(state): State<AppState>,
) -> ServerResult<Json<Value>> {
    let notes = state
        .intelligence
        .list_vault_notes(VaultNoteListQuery::default())
        .await?;
    let mut indexed_count = 0usize;
    for summary in &notes {
        if let Ok(detail) = state.intelligence.read_vault_note(&summary.path).await {
            if state
                .intelligence
                .index_vault_note(&summary.path, &detail.content_md)
                .await
                .is_ok()
            {
                indexed_count += 1;
            }
        }
    }
    Ok(Json(json!({
        "status": "ok",
        "indexed_count": indexed_count.max(notes.len()),
        "total_notes": notes.len(),
    })))
}

async fn handle_companion_state(
    State(state): State<AppState>,
) -> ServerResult<Json<Value>> {
    let nudges = state.intelligence.get_companion_nudges().await?;
    Ok(Json(json!({
        "mood": "reading_tome",
        "state": "reading_tome",
        "active_nudges": nudges,
        "nudges": nudges,
    })))
}

async fn handle_get_companion_nudges(
    State(state): State<AppState>,
) -> ServerResult<Json<Vec<CompanionNudge>>> {
    let nudges = state.intelligence.get_companion_nudges().await?;
    Ok(Json(nudges))
}

async fn handle_dismiss_nudge(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.intelligence.dismiss_companion_nudge(id).await;
    Ok(Json(json!({
        "id": id,
        "status": "dismissed",
        "dismissed": true,
        "acknowledged": true,
    })))
}

async fn handle_list_companion_phrases(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<Vec<CompanionOfflinePhrase>>> {
    let ctx = params
        .get("trigger_context")
        .or_else(|| params.get("category"))
        .and_then(|s| serde_json::from_value::<TriggerContext>(Value::String(s.clone())).ok());
    let phrases = state.intelligence.list_companion_phrases(ctx).await?;
    Ok(Json(phrases))
}

async fn handle_create_companion_phrase(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<CompanionOfflinePhrase>)> {
    let req: CreateCompanionPhraseRequest = parse_json_bytes(&body)?;
    let created = state.intelligence.create_companion_phrase(req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_update_companion_phrase(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<CompanionOfflinePhrase>> {
    let req: Value = parse_json_bytes(&body)?;
    let updated = state.intelligence.update_companion_phrase(id, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_companion_phrase(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.intelligence.delete_companion_phrase(id).await?;
    Ok(Json(json!({ "id": id, "deleted": true })))
}

// =============================================================================
// 12. Domain 7 — Todos, Projects & Focus Timer (F13)
// =============================================================================

async fn handle_list_projects(
    State(state): State<AppState>,
) -> ServerResult<Json<Vec<Project>>> {
    let projects = state.life_ops.list_projects().await?;
    Ok(Json(projects))
}

async fn handle_create_project(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<Project>)> {
    let req: CreateProjectRequest = parse_json_bytes(&body)?;
    let created = state.life_ops.create_project(req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_get_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Project>> {
    let project = state.life_ops.get_project(id).await?;
    Ok(Json(project))
}

async fn handle_update_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<Project>> {
    let req: UpdateProjectRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.update_project(id, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.life_ops.delete_project(id).await?;
    Ok(Json(json!({ "id": id, "deleted": true })))
}

async fn handle_list_tasks(
    State(state): State<AppState>,
    Query(filter): Query<TaskListFilter>,
) -> ServerResult<Json<Vec<Task>>> {
    let tasks = state.life_ops.list_tasks(filter).await?;
    Ok(Json(tasks))
}

async fn handle_list_tasks_by_perspective(
    State(state): State<AppState>,
    AxumPath(perspective): AxumPath<String>,
    Query(mut filter): Query<TaskListFilter>,
) -> ServerResult<Json<Vec<Task>>> {
    filter.perspective = Some(perspective);
    let tasks = state.life_ops.list_tasks(filter).await?;
    Ok(Json(tasks))
}

async fn handle_project_flow_by_id(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<Uuid>,
) -> ServerResult<Json<ProjectFlowTopologyResponse>> {
    let flow = state.life_ops.get_task_flow(Some(project_id)).await?;
    Ok(Json(flow))
}

async fn handle_create_task(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<Task>)> {
    let req: CreateTaskRequest = parse_json_bytes(&body)?;
    let created = state.life_ops.create_task(req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_parse_task(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Json<QuickCaptureParsed>> {
    let req: QuickCaptureParseRequest = parse_json_bytes(&body)?;
    let parsed = state.life_ops.parse_quick_capture(&req.raw_input)?;
    Ok(Json(parsed))
}

async fn handle_bulk_tasks(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Json<Vec<Task>>> {
    let req: BulkUpdateTasksRequest = parse_json_bytes(&body)?;
    let tasks = state.life_ops.bulk_update_tasks(req).await?;
    Ok(Json(tasks))
}

async fn handle_task_flow(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<ProjectFlowTopologyResponse>> {
    let project_id = params
        .get("project_id")
        .and_then(|s| Uuid::parse_str(s.trim()).ok());
    let flow = state.life_ops.get_task_flow(project_id).await?;
    Ok(Json(flow))
}

async fn handle_task_capacity(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<TodayCapacityMeter>> {
    let cap_minutes = params
        .get("cap_minutes")
        .or_else(|| params.get("capacity_minutes"))
        .and_then(|s| s.parse::<i32>().ok());
    let cap = state.life_ops.get_today_capacity(cap_minutes).await?;
    Ok(Json(cap))
}

async fn handle_get_task(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Task>> {
    let task = state.life_ops.get_task(id).await?;
    Ok(Json(task))
}

async fn handle_update_task(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<Task>> {
    let req: UpdateTaskRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.update_task(id, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_task(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.life_ops.delete_task(id).await?;
    Ok(Json(json!({ "id": id, "deleted": true })))
}

async fn handle_patch_task_status(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<Task>> {
    let req: UpdateTaskStatusRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.patch_task_status(id, req.status).await?;
    Ok(Json(updated))
}

async fn handle_complete_task(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Task>> {
    let completed = state.life_ops.complete_task(id).await?;
    Ok(Json(completed))
}

async fn handle_get_active_timer(
    State(state): State<AppState>,
) -> ServerResult<Json<ActiveTimerResponse>> {
    let active = state.life_ops.get_active_timer().await?;
    Ok(Json(active))
}

async fn handle_start_timer(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Json<ActiveTimerResponse>> {
    let req: StartTimerRequest = parse_optional_json_bytes(&body)?;
    let started = state.life_ops.start_timer(req).await?;
    Ok(Json(started))
}

async fn handle_stop_timer(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Json<TimeSession>> {
    let req: StopTimerRequest = parse_optional_json_bytes(&body)?;
    let stopped = state.life_ops.stop_timer(req).await?;
    Ok(Json(stopped))
}

async fn handle_discard_timer(
    State(state): State<AppState>,
) -> ServerResult<Json<ActiveTimerResponse>> {
    let discarded = state.life_ops.discard_timer().await?;
    Ok(Json(discarded))
}

async fn handle_list_time_sessions(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<Vec<TimeSession>>> {
    let task_id = params
        .get("task_id")
        .and_then(|s| Uuid::parse_str(s.trim()).ok());
    let limit = params.get("limit").and_then(|s| s.parse::<i64>().ok());
    let sessions = state.life_ops.list_time_sessions(task_id, limit).await?;
    Ok(Json(sessions))
}

async fn handle_create_time_session(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<TimeSession>)> {
    let req: CreateTimeSessionRequest = parse_json_bytes(&body)?;
    let created = state.life_ops.create_time_session(req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_delete_time_session(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.life_ops.delete_time_session(id).await?;
    Ok(Json(json!({ "id": id, "deleted": true })))
}

async fn handle_get_time_stats(
    State(state): State<AppState>,
) -> ServerResult<Json<TimeStatsResponse>> {
    let stats = state.life_ops.get_time_stats().await?;
    Ok(Json(stats))
}

// =============================================================================
// 13. Domain 8 — Routines, Habit Engine, Ideal Week & Weekly Review (F14)
// =============================================================================

async fn handle_list_routines(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<Vec<RoutineStackWithItems>>> {
    let day_profile = params
        .get("day_profile")
        .or_else(|| params.get("profile"))
        .and_then(|s| serde_json::from_value::<DayProfile>(Value::String(s.clone())).ok());
    let log_date = params
        .get("date")
        .or_else(|| params.get("log_date"))
        .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok());
    let stacks = state.life_ops.list_routines(day_profile, log_date).await?;
    Ok(Json(stacks))
}

async fn handle_create_routine(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<RoutineStackWithItems>)> {
    let req: CreateRoutineRequest = parse_json_bytes(&body)?;
    let created = state.life_ops.create_routine(req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_routines_analytics(
    State(state): State<AppState>,
) -> ServerResult<Json<RoutineAnalyticsResponse>> {
    let analytics = state.life_ops.get_routines_analytics().await?;
    Ok(Json(analytics))
}

async fn handle_get_ideal_week(
    State(state): State<AppState>,
) -> ServerResult<Json<IdealWeekResponse>> {
    let ideal = state.life_ops.get_ideal_week().await?;
    Ok(Json(ideal))
}

async fn handle_replace_ideal_week(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Json<IdealWeekResponse>> {
    let req: UpsertIdealWeekRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.replace_ideal_week(req).await?;
    Ok(Json(updated))
}

async fn handle_set_day_profile(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Json<DailyCheckin>> {
    let val: Value = parse_json_bytes(&body)?;
    let profile_str = val
        .get("day_profile")
        .or_else(|| val.get("profile"))
        .or_else(|| val.get("day_profile_used"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| ApiError::bad_request("Missing 'day_profile'"))?;
    let day_profile: DayProfile =
        serde_json::from_value(Value::String(profile_str.to_string()))
            .map_err(|e| ApiError::bad_request(format!("Invalid day_profile '{profile_str}': {e}")))?;
    let date = val
        .get("date")
        .or_else(|| val.get("log_date"))
        .and_then(|v| v.as_str())
        .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok())
        .unwrap_or_else(|| Utc::now().date_naive());
    let checkin = state.life_ops.set_day_profile(date, day_profile).await?;
    Ok(Json(checkin))
}

async fn handle_list_routine_logs(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<Vec<RoutineLog>>> {
    let log_date = params
        .get("date")
        .or_else(|| params.get("log_date"))
        .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok())
        .or_else(|| Some(Utc::now().date_naive()));
    let routines = state.life_ops.list_routines(None, log_date).await?;
    let logs: Vec<RoutineLog> = routines
        .into_iter()
        .flat_map(|r| r.today_logs)
        .collect();
    Ok(Json(logs))
}

async fn handle_log_routine_item(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Json<RoutineLog>> {
    let req: LogRoutineItemRequest = parse_json_bytes(&body)?;
    let logged = state.life_ops.log_routine_item(req).await?;
    Ok(Json(logged))
}

async fn handle_log_routine_item_by_path(
    State(state): State<AppState>,
    AxumPath(item_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<RoutineLog>> {
    let mut val: Value = if body.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&body)
            .map_err(|e| ServerError(ApiError::bad_request(format!("Malformed JSON: {e}"))))?
    };
    normalize_json_payload(&mut val);
    if let Some(obj) = val.as_object_mut() {
        obj.insert(
            "routine_item_id".to_string(),
            Value::String(item_id.to_string()),
        );
    }
    let req: LogRoutineItemRequest = serde_json::from_value(val)?;
    let logged = state.life_ops.log_routine_item(req).await?;
    Ok(Json(logged))
}

async fn handle_get_checkin(
    State(state): State<AppState>,
    AxumPath(date_str): AxumPath<String>,
) -> ServerResult<Json<DailyCheckin>> {
    let date = NaiveDate::parse_from_str(date_str.trim(), "%Y-%m-%d").map_err(|_| {
        ApiError::bad_request(format!("Invalid YYYY-MM-DD date '{}'", date_str.trim()))
    })?;
    let checkin = state.life_ops.get_checkin(date).await?;
    Ok(Json(checkin))
}

async fn handle_upsert_checkin(
    State(state): State<AppState>,
    AxumPath(date_str): AxumPath<String>,
    body: Bytes,
) -> ServerResult<Json<DailyCheckin>> {
    let date = NaiveDate::parse_from_str(date_str.trim(), "%Y-%m-%d").map_err(|_| {
        ApiError::bad_request(format!("Invalid YYYY-MM-DD date '{}'", date_str.trim()))
    })?;
    let req: UpsertDailyCheckinRequest = parse_json_bytes(&body)?;
    let checkin = state.life_ops.upsert_checkin(date, req).await?;
    Ok(Json(checkin))
}

async fn handle_weekly_review(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<WeeklyReviewSummaryResponse>> {
    let week_or_date = params
        .get("week")
        .or_else(|| params.get("date"))
        .map(String::as_str);
    let summary = state
        .life_ops
        .get_weekly_review_summary(week_or_date)
        .await?;
    Ok(Json(summary))
}

fn build_weekly_review_by_key_json(
    summary: &WeeklyReviewSummaryResponse,
    review_json: Option<&Value>,
) -> Value {
    let mut base = serde_json::to_value(summary).unwrap_or_else(|_| json!({}));
    if let Some(obj) = base.as_object_mut() {
        obj.insert("week_key".to_string(), Value::String(summary.iso_week.clone()));
        if let Some(ref vp) = summary.vault_export_path {
            obj.insert("vault_note_path".to_string(), Value::String(vp.clone()));
            obj.insert("export_path".to_string(), Value::String(vp.clone()));
        }
        if let Some(Value::Object(extra)) = review_json {
            for (k, v) in extra {
                obj.insert(k.clone(), v.clone());
            }
        }
    }
    base
}

async fn handle_get_weekly_review_by_key(
    State(state): State<AppState>,
    AxumPath(week_key): AxumPath<String>,
) -> ServerResult<Json<Value>> {
    let (summary, stored) = state
        .life_ops
        .get_weekly_review_json(Some(&week_key))
        .await?;
    Ok(Json(build_weekly_review_by_key_json(&summary, stored.as_ref())))
}

async fn handle_upsert_weekly_review_by_key(
    State(state): State<AppState>,
    AxumPath(week_key): AxumPath<String>,
    body: Bytes,
) -> ServerResult<Json<Value>> {
    let payload: Value = if body.is_empty() {
        json!({})
    } else {
        let mut val: Value = serde_json::from_slice(&body)
            .map_err(|e| ServerError(ApiError::bad_request(format!("Malformed JSON: {e}"))))?;
        normalize_json_payload(&mut val);
        val
    };
    let (summary, saved_json) = state
        .life_ops
        .upsert_weekly_review_by_key(&week_key, Some(payload))
        .await?;
    Ok(Json(build_weekly_review_by_key_json(&summary, Some(&saved_json))))
}

async fn handle_export_weekly_review_by_key(
    State(state): State<AppState>,
    AxumPath(week_key): AxumPath<String>,
    body: Bytes,
) -> ServerResult<Json<Value>> {
    let payload: Option<Value> = if body.is_empty() {
        None
    } else {
        let mut val: Value = serde_json::from_slice(&body)
            .map_err(|e| ServerError(ApiError::bad_request(format!("Malformed JSON: {e}"))))?;
        normalize_json_payload(&mut val);
        Some(val)
    };
    let (summary, saved_json) = state
        .life_ops
        .upsert_weekly_review_by_key(&week_key, payload)
        .await?;
    let mut out = build_weekly_review_by_key_json(&summary, Some(&saved_json));
    if let Some(obj) = out.as_object_mut() {
        obj.insert("status".to_string(), Value::String("exported".to_string()));
    }
    Ok(Json(out))
}

async fn handle_get_routine(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<RoutineStackWithItems>> {
    let log_date = params
        .get("date")
        .or_else(|| params.get("log_date"))
        .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok());
    let stack = state.life_ops.get_routine(id, log_date).await?;
    Ok(Json(stack))
}

async fn handle_update_routine(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<RoutineStackWithItems>> {
    let req: UpdateRoutineRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.update_routine(id, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_routine(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.life_ops.delete_routine(id).await?;
    Ok(Json(json!({ "id": id, "deleted": true })))
}

async fn handle_create_routine_item(
    State(state): State<AppState>,
    AxumPath(routine_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<RoutineItem>)> {
    let req: CreateRoutineItemRequest = parse_json_bytes(&body)?;
    let created = state.life_ops.create_routine_item(routine_id, req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_update_routine_item(
    State(state): State<AppState>,
    AxumPath(item_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<RoutineItem>> {
    let req: UpdateRoutineItemRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.update_routine_item(item_id, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_routine_item(
    State(state): State<AppState>,
    AxumPath(item_id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.life_ops.delete_routine_item(item_id).await?;
    Ok(Json(json!({ "id": item_id, "deleted": true })))
}

// =============================================================================
// 14. Domain 9 — Goals, OKRs & Q1–Q4 Yearly Blueprint (F15)
// =============================================================================

async fn handle_list_yearly_cycles(
    State(state): State<AppState>,
) -> ServerResult<Json<Vec<YearlyCycle>>> {
    let cycles = state.life_ops.list_yearly_cycles().await?;
    Ok(Json(cycles))
}

async fn handle_upsert_yearly_cycle(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Json<YearlyCycle>> {
    let req: UpsertYearlyCycleRequest = parse_json_bytes(&body)?;
    let cycle = state.life_ops.create_yearly_cycle(req).await?;
    Ok(Json(cycle))
}

async fn handle_get_yearly_cycle(
    State(state): State<AppState>,
    AxumPath(year): AxumPath<i32>,
) -> ServerResult<Json<YearlyCycle>> {
    let cycle = state.life_ops.get_yearly_cycle(year).await?;
    Ok(Json(cycle))
}

async fn handle_update_yearly_cycle(
    State(state): State<AppState>,
    AxumPath(year): AxumPath<i32>,
    body: Bytes,
) -> ServerResult<Json<YearlyCycle>> {
    let req: UpdateYearlyCycleRequest = parse_json_bytes(&body)?;
    match state.life_ops.update_yearly_cycle(year, req.clone()).await {
        Ok(updated) => Ok(Json(updated)),
        Err(err) if err.status_code() == 404 => {
            let upserted = state
                .life_ops
                .upsert_yearly_cycle(
                    year,
                    UpsertYearlyCycleRequest {
                        year,
                        theme: req.theme.unwrap_or_else(|| format!("Year {year}")),
                        vision_md: req.vision_md.unwrap_or_default(),
                        anti_goals_md: req.anti_goals_md.unwrap_or_default(),
                        focus_cap_limit: req.focus_cap_limit.unwrap_or(6),
                        status: req.status.unwrap_or_default(),
                    },
                )
                .await?;
            Ok(Json(upserted))
        }
        Err(err) => Err(ServerError(err)),
    }
}

async fn handle_list_goals(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<Vec<GoalWithDetails>>> {
    let year = params.get("year").and_then(|s| s.parse::<i32>().ok());
    let pillar = params
        .get("pillar")
        .and_then(|s| serde_json::from_value::<GoalPillar>(Value::String(s.clone())).ok());
    let status = params
        .get("status")
        .and_then(|s| serde_json::from_value::<GoalStatus>(Value::String(s.clone())).ok());
    let goals = state.life_ops.list_goals(year, pillar, status).await?;
    Ok(Json(goals))
}

async fn handle_create_goal(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<GoalWithDetails>)> {
    let req: CreateGoalRequest = parse_json_bytes(&body)?;
    let created = state.life_ops.create_goal(req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_get_goal_blueprint_query(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<BlueprintLayoutResponse>> {
    let year = params
        .get("year")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(2026);
    let bp = state.life_ops.get_goal_blueprint(year).await?;
    Ok(Json(bp))
}

async fn handle_get_goal_blueprint_by_year(
    State(state): State<AppState>,
    AxumPath(year): AxumPath<i32>,
) -> ServerResult<Json<BlueprintLayoutResponse>> {
    let bp = state.life_ops.get_goal_blueprint(year).await?;
    Ok(Json(bp))
}

async fn handle_get_goals_pace_drift(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<Vec<GoalWithDetails>>> {
    let year = params.get("year").and_then(|s| s.parse::<i32>().ok());
    let goals = state.life_ops.get_goals_pace_drift(year).await?;
    Ok(Json(goals))
}

async fn handle_get_goal(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<GoalWithDetails>> {
    let goal = state.life_ops.get_goal(id).await?;
    Ok(Json(goal))
}

async fn handle_update_goal(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<GoalWithDetails>> {
    let req: UpdateGoalRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.update_goal(id, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_goal(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.life_ops.delete_goal(id).await?;
    Ok(Json(json!({ "id": id, "deleted": true })))
}

async fn handle_update_goal_blueprint_pos(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<GoalWithDetails>> {
    let req: UpdateGoalBlueprintPosRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.update_goal_blueprint_pos(id, req).await?;
    Ok(Json(updated))
}

async fn handle_create_key_result(
    State(state): State<AppState>,
    AxumPath(goal_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<GoalKeyResult>)> {
    let req: CreateKeyResultRequest = parse_json_bytes(&body)?;
    let created = state.life_ops.create_key_result(goal_id, req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_update_key_result(
    State(state): State<AppState>,
    AxumPath(kr_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<GoalKeyResult>> {
    let req: UpdateKeyResultRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.update_key_result(kr_id, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_key_result(
    State(state): State<AppState>,
    AxumPath(kr_id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.life_ops.delete_key_result(kr_id).await?;
    Ok(Json(json!({ "id": kr_id, "deleted": true })))
}

async fn handle_list_goal_checkins(
    State(state): State<AppState>,
    AxumPath(goal_id): AxumPath<Uuid>,
) -> ServerResult<Json<Vec<GoalCheckin>>> {
    let checkins = state.life_ops.list_goal_checkins(goal_id).await?;
    Ok(Json(checkins))
}

async fn handle_create_goal_checkin(
    State(state): State<AppState>,
    AxumPath(goal_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<GoalCheckin>)> {
    let req: CreateGoalCheckinRequest = parse_json_bytes(&body)?;
    let created = state.life_ops.create_goal_checkin(goal_id, req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

// =============================================================================
// 15. Domain 10 — Courses, Syllabus, Read-Only YouTube Import & Reviews (F16)
// =============================================================================

async fn handle_list_courses(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<Vec<Course>>> {
    let status = params
        .get("status")
        .and_then(|s| serde_json::from_value::<CourseStatus>(Value::String(s.clone())).ok());
    let provider = params
        .get("provider")
        .and_then(|s| serde_json::from_value::<CourseProvider>(Value::String(s.clone())).ok());
    let goal_id = params
        .get("goal_id")
        .and_then(|s| Uuid::parse_str(s.trim()).ok());
    let courses = state
        .life_ops
        .list_courses(status, provider, goal_id)
        .await?;
    Ok(Json(courses))
}

async fn handle_create_course(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<CourseSyllabusResponse>)> {
    let req: CreateCourseRequest = parse_json_bytes(&body)?;
    let created = state.life_ops.create_course(req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_list_youtube_playlists(
    State(state): State<AppState>,
) -> ServerResult<Json<YoutubePlaylistsResponse>> {
    let playlists = state.life_ops.list_youtube_playlists().await?;
    Ok(Json(playlists))
}

async fn handle_import_youtube_playlist(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<CourseSyllabusResponse>)> {
    let req: ImportYoutubePlaylistRequest = parse_json_bytes(&body)?;
    let imported = state.life_ops.import_youtube_playlist(req).await?;
    Ok((StatusCode::CREATED, Json(imported)))
}

async fn handle_list_due_reviews(
    State(state): State<AppState>,
) -> ServerResult<Json<Vec<SpacedReviewDueItem>>> {
    let due = state.life_ops.list_due_spaced_reviews().await?;
    Ok(Json(due))
}

async fn handle_complete_lesson_review(
    State(state): State<AppState>,
    AxumPath(lesson_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<CourseLesson>> {
    let req: ReviewLessonRequest = parse_optional_json_bytes(&body)?;
    let lesson = state.life_ops.complete_lesson_review(lesson_id, req).await?;
    Ok(Json(lesson))
}

async fn handle_get_course(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<CourseSyllabusResponse>> {
    let course = state.life_ops.get_course(id).await?;
    Ok(Json(course))
}

async fn handle_update_course(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<CourseSyllabusResponse>> {
    let req: UpdateCourseRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.update_course(id, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_course(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.life_ops.delete_course(id).await?;
    Ok(Json(json!({ "id": id, "deleted": true })))
}

async fn handle_sync_youtube_course(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<CourseSyllabusResponse>> {
    let synced = state.life_ops.sync_youtube_course(id).await?;
    Ok(Json(synced))
}

async fn handle_import_course_outline(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<CourseSyllabusResponse>> {
    let req: ImportOutlineRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.import_course_outline(id, req).await?;
    Ok(Json(updated))
}

async fn handle_create_course_module(
    State(state): State<AppState>,
    AxumPath(course_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<CourseModule>)> {
    let req: CreateCourseModuleRequest = parse_json_bytes(&body)?;
    let created = state.life_ops.create_course_module(course_id, req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_update_course_module(
    State(state): State<AppState>,
    AxumPath(module_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<CourseModule>> {
    let req: UpdateCourseModuleRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.update_course_module(module_id, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_course_module(
    State(state): State<AppState>,
    AxumPath(module_id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.life_ops.delete_course_module(module_id).await?;
    Ok(Json(json!({ "id": module_id, "deleted": true })))
}

async fn handle_create_course_lesson(
    State(state): State<AppState>,
    AxumPath(module_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<CourseLesson>)> {
    let req: CreateCourseLessonRequest = parse_json_bytes(&body)?;
    let created = state.life_ops.create_course_lesson(module_id, req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_update_course_lesson(
    State(state): State<AppState>,
    AxumPath(lesson_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<CourseLesson>> {
    let req: UpdateCourseLessonRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.update_course_lesson(lesson_id, req).await?;
    Ok(Json(updated))
}

async fn handle_patch_course_lesson_status(
    State(state): State<AppState>,
    AxumPath(lesson_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<CourseLesson>> {
    let req: UpdateLessonStatusRequest = parse_json_bytes(&body)?;
    let updated = state
        .life_ops
        .patch_course_lesson_status(lesson_id, req)
        .await?;
    Ok(Json(updated))
}

async fn handle_delete_course_lesson(
    State(state): State<AppState>,
    AxumPath(lesson_id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.life_ops.delete_course_lesson(lesson_id).await?;
    Ok(Json(json!({ "id": lesson_id, "deleted": true })))
}

async fn handle_list_course_quizzes(
    State(state): State<AppState>,
    AxumPath(course_id): AxumPath<Uuid>,
) -> ServerResult<Json<Vec<CourseQuizResponse>>> {
    let quizzes = state.life_ops.list_course_quizzes(course_id).await?;
    Ok(Json(quizzes))
}

async fn handle_create_course_quiz(
    State(state): State<AppState>,
    AxumPath(course_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<CourseQuizResponse>)> {
    let req: CourseQuizRequest = parse_optional_json_bytes(&body)?;
    let created = state.life_ops.create_course_quiz(course_id, req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_spawn_course_todo(
    State(state): State<AppState>,
    AxumPath(course_id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<Task>)> {
    let req: SpawnCourseTodoRequest = parse_json_bytes(&body)?;
    let task = state.life_ops.spawn_course_todo(course_id, req).await?;
    Ok((StatusCode::CREATED, Json(task)))
}

// =============================================================================
// 16. Domain 11 — Multi-Market Finance, Allocation & FIRE Simulator (F17)
// =============================================================================

async fn handle_list_assets(
    State(state): State<AppState>,
    Query(filter): Query<AssetListFilter>,
) -> ServerResult<Json<Vec<PortfolioAsset>>> {
    let assets = state.life_ops.list_assets(filter).await?;
    Ok(Json(assets))
}

async fn handle_create_asset(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<PortfolioAsset>)> {
    let req: CreatePortfolioAssetRequest = parse_json_bytes(&body)?;
    let created = state.life_ops.create_asset(req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn handle_get_asset(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<PortfolioAsset>> {
    let asset = state.life_ops.get_asset(id).await?;
    Ok(Json(asset))
}

async fn handle_update_asset(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    body: Bytes,
) -> ServerResult<Json<PortfolioAsset>> {
    let req: UpdatePortfolioAssetRequest = parse_json_bytes(&body)?;
    let updated = state.life_ops.update_asset(id, req).await?;
    Ok(Json(updated))
}

async fn handle_delete_asset(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
) -> ServerResult<Json<Value>> {
    state.life_ops.delete_asset(id).await?;
    Ok(Json(json!({ "id": id, "deleted": true })))
}

async fn handle_get_asset_candles(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<Uuid>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<AssetCandlesResponse>> {
    let range = params
        .get("range")
        .or_else(|| params.get("timeframe"))
        .map(String::as_str)
        .unwrap_or("1M");
    let candles = state.life_ops.get_asset_candles(id, range).await?;
    Ok(Json(candles))
}

async fn handle_refresh_quotes(
    State(state): State<AppState>,
) -> ServerResult<Json<QuoteRefreshResponse>> {
    let refreshed = state.life_ops.refresh_quotes_and_fx().await?;
    Ok(Json(refreshed))
}

async fn handle_get_allocation(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<AllocationResponse>> {
    let base_currency = params
        .get("base_currency")
        .or_else(|| params.get("currency"))
        .and_then(|s| serde_json::from_value::<CurrencyCode>(Value::String(s.clone())).ok());
    let new_contribution_cents = params
        .get("new_contribution_cents")
        .or_else(|| params.get("contribution_cents"))
        .or_else(|| params.get("investable_surplus_cents"))
        .or_else(|| params.get("surplus_cents"))
        .and_then(|s| s.parse::<i64>().ok());
    let alloc = state
        .life_ops
        .get_portfolio_allocation(base_currency, new_contribution_cents)
        .await?;
    Ok(Json(alloc))
}

async fn handle_list_monthly_plans(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<Vec<MonthlyInvestmentPlan>>> {
    let limit = params.get("limit").and_then(|s| s.parse::<i64>().ok());
    let plans = state.life_ops.list_monthly_plans(limit).await?;
    Ok(Json(plans))
}

async fn handle_get_monthly_plan(
    State(state): State<AppState>,
    AxumPath(month): AxumPath<String>,
) -> ServerResult<Json<MonthlyInvestmentPlan>> {
    let plan = state.life_ops.get_monthly_plan(&month).await?;
    Ok(Json(plan))
}

async fn handle_upsert_monthly_plan(
    State(state): State<AppState>,
    AxumPath(month): AxumPath<String>,
    body: Bytes,
) -> ServerResult<Json<MonthlyInvestmentPlan>> {
    let req: UpsertMonthlyInvestmentPlanRequest = parse_json_bytes(&body)?;
    let plan = state.life_ops.upsert_monthly_plan(&month, req).await?;
    Ok(Json(plan))
}

async fn handle_get_retirement_config(
    State(state): State<AppState>,
) -> ServerResult<Json<RetirementConfig>> {
    let cfg = state.life_ops.get_retirement_config().await?;
    Ok(Json(cfg))
}

async fn handle_update_retirement_config(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Json<RetirementConfig>> {
    let req: UpdateRetirementConfigRequest = parse_json_bytes(&body)?;
    let cfg = state.life_ops.update_retirement_config(req).await?;
    Ok(Json(cfg))
}

async fn handle_get_retirement_projection(
    State(state): State<AppState>,
) -> ServerResult<Json<FireProjectionResponse>> {
    let proj = state.life_ops.get_retirement_projection().await?;
    Ok(Json(proj))
}

async fn handle_simulate_retirement(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<Json<FireProjectionResponse>> {
    let req: FireSimulationRequest = parse_optional_json_bytes(&body)?;
    let proj = state.life_ops.simulate_retirement(req).await?;
    Ok(Json(proj))
}

async fn handle_list_snapshots(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ServerResult<Json<Vec<PortfolioSnapshot>>> {
    let limit = params.get("limit").and_then(|s| s.parse::<i64>().ok());
    let snaps = state.life_ops.list_portfolio_snapshots(limit).await?;
    Ok(Json(snaps))
}

async fn handle_create_snapshot(
    State(state): State<AppState>,
    body: Bytes,
) -> ServerResult<(StatusCode, Json<PortfolioSnapshot>)> {
    let req: CreatePortfolioSnapshotRequest = parse_optional_json_bytes(&body)?;
    let created = state.life_ops.create_portfolio_snapshot(req).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adv_f04_f06_normalize_json_payload_aliases_dates_and_auth_extraction() {
        // 1. `archetype` alias alone (without `knight_archetype`) normalizes synonyms and casing
        let mut arch_only = json!({
            "name": "Strategist Knight",
            "archetype": "Strategist",
            "zone": "citadel"
        });
        normalize_json_payload(&mut arch_only);
        assert_eq!(arch_only["knight_archetype"], "lore_warden");
        assert!(arch_only.get("archetype").is_none());
        assert_eq!(arch_only["grid_pos"]["zone"], "citadel");

        // 2. Trigger top-level `cron_expr` and `event_name`, blueprint_pos, date normalization, and bulk delete
        let mut complex = json!({
            "origin": "Companion_Popover",
            "cron_expr": "0 9 * * 1-5",
            "event_name": "goal.pace_at_risk",
            "blueprint_pos": { "x": 380.0, "y": 120.0 },
            "due_date": "2026-11-20",
            "scheduled_date": "2026-11-20T14:30:00Z",
            "target_date": "2026-12-31T00:00:00Z",
            "action": "DELETE",
            "task_ids": ["01900000-0000-7000-8000-000000000001"],
            "ids": ["01900000-0000-7000-8000-000000000001"]
        });
        normalize_json_payload(&mut complex);
        assert_eq!(complex["origin"], "frieren_popover");
        assert_eq!(complex["config_json"]["cron"], "0 9 * * 1-5");
        assert_eq!(complex["config_json"]["event"], "goal.pace_at_risk");
        assert_eq!(complex["position_x"], 380.0);
        assert_eq!(complex["position_y"], 120.0);
        assert_eq!(complex["due_date"], "2026-11-20T12:00:00Z");
        assert_eq!(complex["scheduled_date"], "2026-11-20");
        assert_eq!(complex["target_date"], "2026-12-31");
        assert_eq!(complex["delete"], true);
        assert!(complex.get("ids").is_none());

        // 3. Empty bytes deserialize cleanly via `parse_json_bytes` / `parse_optional_json_bytes`
        let empty_val: Value = parse_json_bytes(b"").expect("empty bytes -> {}");
        assert!(empty_val.is_object());
        assert!(parse_json_bytes::<Value>(b"{malformed").is_err());
    }
}
