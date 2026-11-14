//! OpenAPI 3.1 Specification (`utoipa::OpenApi`) for `HERMES // OS`.
//!
//! Exposes `ApiDoc` registering all 216 `hermes_domain` `ToSchema` types and
//! all REST & SSE endpoints across all 12 Life Ops & Intelligence domains.

#![allow(dead_code)]

use hermes_domain::*;
use utoipa::{
    Modify, OpenApi,
    openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme},
};

pub struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer_pat",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("PAT")
                    .description(Some(
                        "Personal Access Token (`plm_pat_...`) or web session bearer token",
                    ))
                    .build(),
            ),
        );
    }
}

// =============================================================================
// 1. Health & Auth (F07)
// =============================================================================

#[utoipa::path(
    get,
    path = "/api/health",
    operation_id = "getHealth",
    tag = "health",
    responses(
        (status = 200, description = "System health & subsystem status", body = HealthStatusResponse)
    )
)]
pub async fn doc_get_health() {}

#[utoipa::path(
    get,
    path = "/api/openapi.json",
    operation_id = "getOpenapiSpec",
    tag = "health",
    responses(
        (status = 200, description = "OpenAPI 3.1 JSON specification", body = Object)
    )
)]
pub async fn doc_get_openapi() {}

#[utoipa::path(
    get,
    path = "/api/auth/verify",
    operation_id = "verifyAuth",
    tag = "auth",
    security(("bearer_pat" = [])),
    responses(
        (status = 200, description = "Token verified", body = AuthVerifyResponse),
        (status = 401, description = "Missing, malformed, or revoked token", body = ApiErrorBody)
    )
)]
pub async fn doc_verify_auth() {}

#[utoipa::path(
    post,
    path = "/api/auth/login",
    operation_id = "login",
    tag = "auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Authenticated session", body = LoginResponse),
        (status = 401, description = "Invalid credentials", body = ApiErrorBody)
    )
)]
pub async fn doc_login() {}

#[utoipa::path(
    post,
    path = "/api/auth/logout",
    operation_id = "logout",
    tag = "auth",
    responses(
        (status = 200, description = "Session logged out", body = Value)
    )
)]
pub async fn doc_logout() {}

#[utoipa::path(
    get,
    path = "/api/auth/me",
    operation_id = "getMe",
    tag = "auth",
    responses(
        (status = 200, description = "Current operator profile", body = User)
    )
)]
pub async fn doc_get_me() {}

#[utoipa::path(
    get,
    path = "/api/auth/tokens",
    operation_id = "listPatTokens",
    tag = "auth",
    responses(
        (status = 200, description = "Active and revoked Personal Access Tokens", body = Vec<ApiTokenSummary>)
    )
)]
pub async fn doc_list_tokens() {}

#[utoipa::path(
    post,
    path = "/api/auth/tokens",
    operation_id = "createPatToken",
    tag = "auth",
    request_body = CreatePatRequest,
    responses(
        (status = 201, description = "Newly minted Personal Access Token", body = CreatedPatResponse)
    )
)]
pub async fn doc_create_token() {}

#[utoipa::path(
    delete,
    path = "/api/auth/tokens/{id}",
    operation_id = "revokePatToken",
    tag = "auth",
    params(
        ("id" = Uuid, Path, description = "PAT UUID")
    ),
    responses(
        (status = 200, description = "Token revoked", body = ApiTokenSummary),
        (status = 404, description = "Token not found", body = ApiErrorBody)
    )
)]
pub async fn doc_revoke_token() {}

#[utoipa::path(
    post,
    path = "/api/auth/pairing-qr",
    operation_id = "createPairingQr",
    tag = "auth",
    request_body = PairingQrRequest,
    responses(
        (status = 200, description = "Mobile Companion pairing QR payload", body = PairingQrResponse)
    )
)]
pub async fn doc_create_pairing_qr() {}

// =============================================================================
// 2. Scoped Mobile Delta Sync (F08)
// =============================================================================

#[utoipa::path(
    post,
    path = "/api/sync/push",
    operation_id = "syncPush",
    tag = "sync",
    security(("bearer_pat" = [])),
    request_body = SyncPushRequest,
    responses(
        (status = 200, description = "Mutations applied with LWW / set-union resolution", body = SyncPushResponse),
        (status = 400, description = "Forbidden table or invalid mutation", body = ApiErrorBody),
        (status = 401, description = "Unauthorized", body = ApiErrorBody)
    )
)]
pub async fn doc_sync_push() {}

#[utoipa::path(
    get,
    path = "/api/sync/pull",
    operation_id = "syncPull",
    tag = "sync",
    security(("bearer_pat" = [])),
    params(
        ("since" = Option<i64>, Query, description = "Last seen server_seq cursor (0 for bootstrap)"),
        ("limit" = Option<i64>, Query, description = "Maximum changes to return")
    ),
    responses(
        (status = 200, description = "Incremental delta changes", body = SyncPullResponse),
        (status = 401, description = "Unauthorized", body = ApiErrorBody)
    )
)]
pub async fn doc_sync_pull() {}

// =============================================================================
// 3. Multi-Dashboard Room Monitor, Life Score, Servers & SSE (F11)
// =============================================================================

#[utoipa::path(
    get,
    path = "/api/dashboards",
    operation_id = "listDashboards",
    tag = "dashboards",
    responses(
        (status = 200, description = "Ordered Room Monitor dashboards with widgets", body = Vec<DashboardWithWidgets>)
    )
)]
pub async fn doc_list_dashboards() {}

#[utoipa::path(
    post,
    path = "/api/dashboards",
    operation_id = "createDashboard",
    tag = "dashboards",
    request_body = CreateDashboardRequest,
    responses(
        (status = 201, description = "Created dashboard deck", body = DashboardWithWidgets)
    )
)]
pub async fn doc_create_dashboard() {}

#[utoipa::path(
    get,
    path = "/api/dashboards/{id}",
    operation_id = "getDashboard",
    tag = "dashboards",
    params(
        ("id" = String, Path, description = "Dashboard UUID or slug")
    ),
    responses(
        (status = 200, description = "Dashboard with widgets", body = DashboardWithWidgets),
        (status = 404, description = "Dashboard not found", body = ApiErrorBody)
    )
)]
pub async fn doc_get_dashboard() {}

#[utoipa::path(
    put,
    path = "/api/dashboards/{id}",
    operation_id = "updateDashboard",
    tag = "dashboards",
    params(
        ("id" = String, Path, description = "Dashboard UUID or slug")
    ),
    request_body = UpdateDashboardRequest,
    responses(
        (status = 200, description = "Updated dashboard", body = DashboardWithWidgets)
    )
)]
pub async fn doc_update_dashboard() {}

#[utoipa::path(
    delete,
    path = "/api/dashboards/{id}",
    operation_id = "deleteDashboard",
    tag = "dashboards",
    params(
        ("id" = String, Path, description = "Dashboard UUID or slug")
    ),
    responses(
        (status = 200, description = "Deleted dashboard", body = Value)
    )
)]
pub async fn doc_delete_dashboard() {}

#[utoipa::path(
    post,
    path = "/api/dashboards/{id}/clone",
    operation_id = "cloneDashboard",
    tag = "dashboards",
    params(
        ("id" = String, Path, description = "Source dashboard UUID or slug")
    ),
    request_body = CloneDashboardRequest,
    responses(
        (status = 201, description = "Cloned dashboard with widgets", body = DashboardWithWidgets)
    )
)]
pub async fn doc_clone_dashboard() {}

#[utoipa::path(
    post,
    path = "/api/dashboards/reorder",
    operation_id = "reorderDashboards",
    tag = "dashboards",
    request_body = ReorderDashboardsRequest,
    responses(
        (status = 200, description = "Reordered dashboards", body = Vec<Dashboard>)
    )
)]
pub async fn doc_reorder_dashboards() {}

#[utoipa::path(
    post,
    path = "/api/dashboards/{id}/widgets",
    operation_id = "createDashboardWidget",
    tag = "dashboards",
    params(
        ("id" = Uuid, Path, description = "Dashboard UUID")
    ),
    request_body = CreateWidgetRequest,
    responses(
        (status = 201, description = "Created widget", body = DashboardWidget)
    )
)]
pub async fn doc_create_widget() {}

#[utoipa::path(
    put,
    path = "/api/dashboards/{id}/widgets/{widget_id}",
    operation_id = "updateDashboardWidget",
    tag = "dashboards",
    params(
        ("id" = Uuid, Path, description = "Dashboard UUID"),
        ("widget_id" = Uuid, Path, description = "Widget UUID")
    ),
    request_body = UpdateWidgetRequest,
    responses(
        (status = 200, description = "Updated widget", body = DashboardWidget)
    )
)]
pub async fn doc_update_widget() {}

#[utoipa::path(
    delete,
    path = "/api/dashboards/{id}/widgets/{widget_id}",
    operation_id = "deleteDashboardWidget",
    tag = "dashboards",
    params(
        ("id" = Uuid, Path, description = "Dashboard UUID"),
        ("widget_id" = Uuid, Path, description = "Widget UUID")
    ),
    responses(
        (status = 200, description = "Deleted widget", body = Value)
    )
)]
pub async fn doc_delete_widget() {}

#[utoipa::path(
    post,
    path = "/api/widgets/{widget_id}/refresh",
    operation_id = "refreshWidget",
    tag = "dashboards",
    params(
        ("widget_id" = Uuid, Path, description = "Widget UUID")
    ),
    responses(
        (status = 200, description = "Refreshed widget payload", body = DashboardWidget)
    )
)]
pub async fn doc_refresh_widget() {}

#[utoipa::path(
    get,
    path = "/api/telemetry/life-score",
    operation_id = "getLifeScore",
    tag = "dashboards",
    responses(
        (status = 200, description = "5-Pillar composite Life Score (0..100)", body = LifeScoreResponse)
    )
)]
pub async fn doc_get_life_score() {}

#[utoipa::path(
    get,
    path = "/api/servers",
    operation_id = "listServers",
    tag = "servers",
    responses(
        (status = 200, description = "Monitored server nodes", body = Vec<ServerNode>)
    )
)]
pub async fn doc_list_servers() {}

#[utoipa::path(
    post,
    path = "/api/servers",
    operation_id = "createServer",
    tag = "servers",
    request_body = CreateServerRequest,
    responses(
        (status = 201, description = "Created server node", body = ServerNode)
    )
)]
pub async fn doc_create_server() {}

#[utoipa::path(
    get,
    path = "/api/servers/summary",
    operation_id = "getServersSummary",
    tag = "servers",
    responses(
        (status = 200, description = "Server fleet health summary", body = ServerSummaryResponse)
    )
)]
pub async fn doc_get_servers_summary() {}

#[utoipa::path(
    post,
    path = "/api/servers/check-all",
    operation_id = "checkAllServers",
    tag = "servers",
    responses(
        (status = 200, description = "Probed all server nodes", body = Vec<ServerNode>)
    )
)]
pub async fn doc_check_all_servers() {}

#[utoipa::path(
    get,
    path = "/api/servers/{id}",
    operation_id = "getServer",
    tag = "servers",
    params(
        ("id" = Uuid, Path, description = "Server UUID")
    ),
    responses(
        (status = 200, description = "Server node detail", body = ServerNode)
    )
)]
pub async fn doc_get_server() {}

#[utoipa::path(
    put,
    path = "/api/servers/{id}",
    operation_id = "updateServer",
    tag = "servers",
    params(
        ("id" = Uuid, Path, description = "Server UUID")
    ),
    request_body = UpdateServerRequest,
    responses(
        (status = 200, description = "Updated server node", body = ServerNode)
    )
)]
pub async fn doc_update_server() {}

#[utoipa::path(
    delete,
    path = "/api/servers/{id}",
    operation_id = "deleteServer",
    tag = "servers",
    params(
        ("id" = Uuid, Path, description = "Server UUID")
    ),
    responses(
        (status = 200, description = "Deleted server node", body = Value)
    )
)]
pub async fn doc_delete_server() {}

#[utoipa::path(
    post,
    path = "/api/servers/{id}/check",
    operation_id = "checkServer",
    tag = "servers",
    params(
        ("id" = Uuid, Path, description = "Server UUID")
    ),
    responses(
        (status = 200, description = "Server probe result", body = ServerNode)
    )
)]
pub async fn doc_check_server() {}

#[utoipa::path(
    get,
    path = "/api/events/stream",
    operation_id = "streamSystemEvents",
    tag = "events",
    responses(
        (status = 200, description = "Real-time SSE SystemEvent stream", body = SystemEvent)
    )
)]
pub async fn doc_stream_events() {}

// =============================================================================
// 4. Hermes Gateway, Sessions & Chat SSE (F09)
// =============================================================================

#[utoipa::path(
    get,
    path = "/api/hermes/health",
    operation_id = "getHermesGatewayHealth",
    tag = "hermes",
    responses(
        (status = 200, description = "Hermes gateway status", body = Value)
    )
)]
pub async fn doc_get_hermes_health() {}

#[utoipa::path(
    get,
    path = "/api/hermes/sessions",
    operation_id = "listHermesSessions",
    tag = "hermes",
    params(
        ("q" = Option<String>, Query, description = "Search query"),
        ("pinned" = Option<bool>, Query, description = "Filter by pinned status"),
        ("archived" = Option<bool>, Query, description = "Filter by archived status"),
        ("origin" = Option<String>, Query, description = "Filter by session origin")
    ),
    responses(
        (status = 200, description = "Hermes sessions list", body = Vec<HermesSession>)
    )
)]
pub async fn doc_list_hermes_sessions() {}

#[utoipa::path(
    post,
    path = "/api/hermes/sessions",
    operation_id = "createHermesSession",
    tag = "hermes",
    request_body = CreateHermesSessionRequest,
    responses(
        (status = 201, description = "Created or updated Hermes session", body = HermesSession)
    )
)]
pub async fn doc_create_hermes_session() {}

#[utoipa::path(
    get,
    path = "/api/hermes/sessions/{key}",
    operation_id = "getHermesSession",
    tag = "hermes",
    params(
        ("key" = String, Path, description = "X-Hermes-Session-Key")
    ),
    responses(
        (status = 200, description = "Hermes session detail", body = HermesSession)
    )
)]
pub async fn doc_get_hermes_session() {}

#[utoipa::path(
    patch,
    path = "/api/hermes/sessions/{key}",
    operation_id = "updateHermesSession",
    tag = "hermes",
    params(
        ("key" = String, Path, description = "X-Hermes-Session-Key")
    ),
    request_body = UpdateHermesSessionRequest,
    responses(
        (status = 200, description = "Updated Hermes session", body = HermesSession)
    )
)]
pub async fn doc_update_hermes_session() {}

#[utoipa::path(
    delete,
    path = "/api/hermes/sessions/{key}",
    operation_id = "deleteHermesSession",
    tag = "hermes",
    params(
        ("key" = String, Path, description = "X-Hermes-Session-Key")
    ),
    responses(
        (status = 200, description = "Deleted Hermes session", body = Value)
    )
)]
pub async fn doc_delete_hermes_session() {}

#[utoipa::path(
    post,
    path = "/api/hermes/sessions/{key}/fork",
    operation_id = "forkHermesSession",
    tag = "hermes",
    params(
        ("key" = String, Path, description = "Parent X-Hermes-Session-Key")
    ),
    request_body = ForkHermesSessionRequest,
    responses(
        (status = 201, description = "Forked child Hermes session", body = HermesSession)
    )
)]
pub async fn doc_fork_hermes_session() {}

#[utoipa::path(
    post,
    path = "/api/hermes/chat/stream",
    operation_id = "streamHermesChat",
    tag = "hermes",
    request_body = ChatStreamRequest,
    responses(
        (status = 200, description = "SSE stream of HermesStreamEvent frames", body = HermesStreamEvent)
    )
)]
pub async fn doc_stream_hermes_chat() {}

// =============================================================================
// 5. MCP Autonomy, Approvals & Undo (F10)
// =============================================================================

#[utoipa::path(
    get,
    path = "/api/mcp/tools",
    operation_id = "listMcpTools",
    tag = "mcp",
    responses(
        (status = 200, description = "Registered MCP tools across all 7 Life Ops domains", body = Vec<Value>)
    )
)]
pub async fn doc_list_mcp_tools() {}

#[utoipa::path(
    post,
    path = "/api/mcp/call",
    operation_id = "callMcpToolRest",
    tag = "mcp",
    request_body = Value,
    responses(
        (status = 200, description = "MCP tool execution or approval queue result", body = Value)
    )
)]
pub async fn doc_call_mcp_tool() {}

#[utoipa::path(
    get,
    path = "/api/mcp/approvals",
    operation_id = "listMcpApprovals",
    tag = "mcp",
    params(
        ("session_key" = Option<String>, Query, description = "Optional session key filter"),
        ("status" = Option<String>, Query, description = "Optional approval status filter")
    ),
    responses(
        (status = 200, description = "Pending and resolved MCP approvals", body = Vec<PendingMcpApproval>)
    )
)]
pub async fn doc_list_mcp_approvals() {}

#[utoipa::path(
    post,
    path = "/api/mcp/approvals/{id}/approve",
    operation_id = "approveMcpAction",
    tag = "mcp",
    params(
        ("id" = Uuid, Path, description = "Pending approval UUID")
    ),
    request_body = ResolveMcpApprovalRequest,
    responses(
        (status = 200, description = "Approved and executed MCP tool call", body = Value)
    )
)]
pub async fn doc_approve_mcp_action() {}

#[utoipa::path(
    post,
    path = "/api/mcp/approvals/{id}/reject",
    operation_id = "rejectMcpAction",
    tag = "mcp",
    params(
        ("id" = Uuid, Path, description = "Pending approval UUID")
    ),
    request_body = Value,
    responses(
        (status = 200, description = "Rejected pending MCP tool call", body = PendingMcpApproval)
    )
)]
pub async fn doc_reject_mcp_action() {}

#[utoipa::path(
    get,
    path = "/api/mcp/undo",
    operation_id = "listMcpUndoActions",
    tag = "mcp",
    params(
        ("session_key" = Option<String>, Query, description = "Optional session key filter")
    ),
    responses(
        (status = 200, description = "Available 15-minute MCP undo actions", body = Vec<McpUndoAction>)
    )
)]
pub async fn doc_list_mcp_undo() {}

#[utoipa::path(
    post,
    path = "/api/mcp/undo/{id}",
    operation_id = "undoMcpAction",
    tag = "mcp",
    params(
        ("id" = Uuid, Path, description = "Undo action UUID")
    ),
    responses(
        (status = 200, description = "Reverted immediate-undo MCP mutation", body = Value)
    )
)]
pub async fn doc_undo_mcp_action() {}

// =============================================================================
// 6. Agent Studio Knights, Vault Inspector & Companion (F12)
// =============================================================================

#[utoipa::path(
    get,
    path = "/api/agents",
    operation_id = "listAgents",
    tag = "agents",
    responses(
        (status = 200, description = "Order of Knights with HP/EP telemetry", body = Vec<AgentWithTelemetry>)
    )
)]
pub async fn doc_list_agents() {}

#[utoipa::path(
    post,
    path = "/api/agents",
    operation_id = "createAgent",
    tag = "agents",
    request_body = CreateAgentRequest,
    responses(
        (status = 201, description = "Created Knight agent", body = AgentWithTelemetry)
    )
)]
pub async fn doc_create_agent() {}

#[utoipa::path(
    get,
    path = "/api/agents/queue",
    operation_id = "getAgentQueue",
    tag = "agents",
    responses(
        (status = 200, description = "Upcoming Knight turn-order queue", body = AgentQueueResponse)
    )
)]
pub async fn doc_get_agent_queue() {}

#[utoipa::path(
    get,
    path = "/api/agent-runs",
    operation_id = "listAgentRuns",
    tag = "agents",
    params(
        ("agent_id" = Option<Uuid>, Query, description = "Optional Knight UUID filter"),
        ("limit" = Option<i64>, Query, description = "Max runs to return")
    ),
    responses(
        (status = 200, description = "Knight run history", body = Vec<AgentRun>)
    )
)]
pub async fn doc_list_agent_runs() {}

#[utoipa::path(
    get,
    path = "/api/agent-runs/{run_id}",
    operation_id = "getAgentRun",
    tag = "agents",
    params(
        ("run_id" = Uuid, Path, description = "Agent run UUID")
    ),
    responses(
        (status = 200, description = "Knight run detail with steps trace", body = AgentRun)
    )
)]
pub async fn doc_get_agent_run() {}

#[utoipa::path(
    get,
    path = "/api/agents/{id}",
    operation_id = "getAgent",
    tag = "agents",
    params(
        ("id" = String, Path, description = "Knight UUID or slug")
    ),
    responses(
        (status = 200, description = "Knight detail with telemetry", body = AgentWithTelemetry)
    )
)]
pub async fn doc_get_agent() {}

#[utoipa::path(
    put,
    path = "/api/agents/{id}",
    operation_id = "updateAgent",
    tag = "agents",
    params(
        ("id" = String, Path, description = "Knight UUID or slug")
    ),
    request_body = UpdateAgentRequest,
    responses(
        (status = 200, description = "Updated Knight agent", body = AgentWithTelemetry)
    )
)]
pub async fn doc_update_agent() {}

#[utoipa::path(
    delete,
    path = "/api/agents/{id}",
    operation_id = "deleteAgent",
    tag = "agents",
    params(
        ("id" = String, Path, description = "Knight UUID or slug")
    ),
    responses(
        (status = 200, description = "Deleted Knight agent", body = Value)
    )
)]
pub async fn doc_delete_agent() {}

#[utoipa::path(
    get,
    path = "/api/agents/{id}/runs",
    operation_id = "listRunsForAgent",
    tag = "agents",
    params(
        ("id" = String, Path, description = "Knight UUID or slug")
    ),
    responses(
        (status = 200, description = "Runs for specific Knight", body = Vec<AgentRun>)
    )
)]
pub async fn doc_list_runs_for_agent() {}

#[utoipa::path(
    post,
    path = "/api/agents/{id}/dispatch",
    operation_id = "dispatchAgent",
    tag = "agents",
    params(
        ("id" = String, Path, description = "Knight UUID or slug")
    ),
    request_body = DispatchAgentRequest,
    responses(
        (status = 200, description = "Executed live or dry-run Knight dispatch", body = AgentRun)
    )
)]
pub async fn doc_dispatch_agent() {}

#[utoipa::path(
    get,
    path = "/api/agents/{id}/triggers",
    operation_id = "listAgentTriggers",
    tag = "agents",
    params(
        ("id" = String, Path, description = "Knight UUID or slug")
    ),
    responses(
        (status = 200, description = "Triggers configured on Knight", body = Vec<AgentTrigger>)
    )
)]
pub async fn doc_list_agent_triggers() {}

#[utoipa::path(
    post,
    path = "/api/agents/{id}/triggers",
    operation_id = "createAgentTrigger",
    tag = "agents",
    params(
        ("id" = String, Path, description = "Knight UUID or slug")
    ),
    request_body = CreateAgentTriggerRequest,
    responses(
        (status = 201, description = "Created Knight trigger", body = AgentTrigger)
    )
)]
pub async fn doc_create_agent_trigger() {}

#[utoipa::path(
    put,
    path = "/api/agents/{id}/triggers/{tid}",
    operation_id = "updateAgentTrigger",
    tag = "agents",
    params(
        ("id" = String, Path, description = "Knight UUID or slug"),
        ("tid" = Uuid, Path, description = "Trigger UUID")
    ),
    request_body = UpdateAgentTriggerRequest,
    responses(
        (status = 200, description = "Updated Knight trigger", body = AgentTrigger)
    )
)]
pub async fn doc_update_agent_trigger() {}

#[utoipa::path(
    delete,
    path = "/api/agents/{id}/triggers/{tid}",
    operation_id = "deleteAgentTrigger",
    tag = "agents",
    params(
        ("id" = String, Path, description = "Knight UUID or slug"),
        ("tid" = Uuid, Path, description = "Trigger UUID")
    ),
    responses(
        (status = 200, description = "Deleted Knight trigger", body = Value)
    )
)]
pub async fn doc_delete_agent_trigger() {}

#[utoipa::path(
    get,
    path = "/api/vault/notes",
    operation_id = "listVaultNotes",
    tag = "vault",
    params(
        ("q" = Option<String>, Query, description = "Optional search query")
    ),
    responses(
        (status = 200, description = "Second Brain Markdown notes", body = Vec<VaultNoteSummary>)
    )
)]
pub async fn doc_list_vault_notes() {}

#[utoipa::path(
    get,
    path = "/api/vault/note",
    operation_id = "getVaultNote",
    tag = "vault",
    params(
        ("path" = String, Query, description = "Relative path inside Second Brain vault")
    ),
    responses(
        (status = 200, description = "Markdown note content", body = VaultNoteDetail)
    )
)]
pub async fn doc_get_vault_note() {}

#[utoipa::path(
    post,
    path = "/api/vault/distill",
    operation_id = "distillToVault",
    tag = "vault",
    request_body = DistillVaultRequest,
    responses(
        (status = 201, description = "Distilled Markdown note into Vault Inbox", body = DistillVaultResponse)
    )
)]
pub async fn doc_distill_to_vault() {}

#[utoipa::path(
    get,
    path = "/api/companion/nudges",
    operation_id = "getCompanionNudges",
    tag = "companion",
    responses(
        (status = 200, description = "Proactive Frieren companion nudges", body = Vec<CompanionNudge>)
    )
)]
pub async fn doc_get_companion_nudges() {}

#[utoipa::path(
    get,
    path = "/api/companion/phrases",
    operation_id = "listCompanionPhrases",
    tag = "companion",
    params(
        ("trigger_context" = Option<String>, Query, description = "Optional trigger context filter")
    ),
    responses(
        (status = 200, description = "Offline Frieren companion phrases", body = Vec<CompanionOfflinePhrase>)
    )
)]
pub async fn doc_list_companion_phrases() {}

#[utoipa::path(
    post,
    path = "/api/companion/phrases",
    operation_id = "createCompanionPhrase",
    tag = "companion",
    request_body = CreateCompanionPhraseRequest,
    responses(
        (status = 201, description = "Created companion offline phrase", body = CompanionOfflinePhrase)
    )
)]
pub async fn doc_create_companion_phrase() {}

#[utoipa::path(
    delete,
    path = "/api/companion/phrases/{id}",
    operation_id = "deleteCompanionPhrase",
    tag = "companion",
    params(
        ("id" = Uuid, Path, description = "Companion phrase UUID")
    ),
    responses(
        (status = 200, description = "Soft-deleted companion phrase", body = Value)
    )
)]
pub async fn doc_delete_companion_phrase() {}

// =============================================================================
// 7. Todos, Projects & Focus Timer (F13)
// =============================================================================

#[utoipa::path(
    get,
    path = "/api/projects",
    operation_id = "listProjects",
    tag = "todos",
    responses(
        (status = 200, description = "Projects list", body = Vec<Project>)
    )
)]
pub async fn doc_list_projects() {}

#[utoipa::path(
    post,
    path = "/api/projects",
    operation_id = "createProject",
    tag = "todos",
    request_body = CreateProjectRequest,
    responses(
        (status = 201, description = "Created project", body = Project)
    )
)]
pub async fn doc_create_project() {}

#[utoipa::path(
    get,
    path = "/api/projects/{id}",
    operation_id = "getProject",
    tag = "todos",
    params(
        ("id" = Uuid, Path, description = "Project UUID")
    ),
    responses(
        (status = 200, description = "Project detail", body = Project)
    )
)]
pub async fn doc_get_project() {}

#[utoipa::path(
    put,
    path = "/api/projects/{id}",
    operation_id = "updateProject",
    tag = "todos",
    params(
        ("id" = Uuid, Path, description = "Project UUID")
    ),
    request_body = UpdateProjectRequest,
    responses(
        (status = 200, description = "Updated project", body = Project)
    )
)]
pub async fn doc_update_project() {}

#[utoipa::path(
    delete,
    path = "/api/projects/{id}",
    operation_id = "deleteProject",
    tag = "todos",
    params(
        ("id" = Uuid, Path, description = "Project UUID")
    ),
    responses(
        (status = 200, description = "Soft-deleted project", body = Value)
    )
)]
pub async fn doc_delete_project() {}

#[utoipa::path(
    get,
    path = "/api/tasks",
    operation_id = "listTasks",
    tag = "todos",
    params(
        ("status" = Option<String>, Query, description = "Filter by TaskStatus"),
        ("priority" = Option<String>, Query, description = "Filter by TaskPriority"),
        ("project_id" = Option<Uuid>, Query, description = "Filter by project UUID"),
        ("goal_id" = Option<Uuid>, Query, description = "Filter by goal UUID"),
        ("course_id" = Option<Uuid>, Query, description = "Filter by course UUID"),
        ("tag" = Option<String>, Query, description = "Filter by tag"),
        ("search" = Option<String>, Query, description = "Search title/description")
    ),
    responses(
        (status = 200, description = "Tasks list", body = Vec<Task>)
    )
)]
pub async fn doc_list_tasks() {}

#[utoipa::path(
    post,
    path = "/api/tasks",
    operation_id = "createTask",
    tag = "todos",
    request_body = CreateTaskRequest,
    responses(
        (status = 201, description = "Created task", body = Task)
    )
)]
pub async fn doc_create_task() {}

#[utoipa::path(
    post,
    path = "/api/tasks/parse",
    operation_id = "parseQuickCaptureTask",
    tag = "todos",
    request_body = QuickCaptureParseRequest,
    responses(
        (status = 200, description = "Parsed quick-capture tokens", body = QuickCaptureParsed)
    )
)]
pub async fn doc_parse_task() {}

#[utoipa::path(
    post,
    path = "/api/tasks/bulk",
    operation_id = "bulkUpdateTasks",
    tag = "todos",
    request_body = BulkUpdateTasksRequest,
    responses(
        (status = 200, description = "Bulk update result", body = Value)
    )
)]
pub async fn doc_bulk_update_tasks() {}

#[utoipa::path(
    get,
    path = "/api/tasks/flow",
    operation_id = "getTaskFlowGraph",
    tag = "todos",
    params(
        ("project_id" = Option<Uuid>, Query, description = "Optional project UUID filter")
    ),
    responses(
        (status = 200, description = "DAG dependency graph with critical path", body = ProjectFlowTopologyResponse)
    )
)]
pub async fn doc_get_task_flow() {}

#[utoipa::path(
    get,
    path = "/api/tasks/capacity",
    operation_id = "getTodayCapacity",
    tag = "todos",
    params(
        ("cap_minutes" = Option<i32>, Query, description = "Optional capacity cap in minutes (default 360)")
    ),
    responses(
        (status = 200, description = "Today's 6h capacity gauge", body = TodayCapacityMeter)
    )
)]
pub async fn doc_get_task_capacity() {}

#[utoipa::path(
    get,
    path = "/api/tasks/{id}",
    operation_id = "getTask",
    tag = "todos",
    params(
        ("id" = Uuid, Path, description = "Task UUID")
    ),
    responses(
        (status = 200, description = "Task detail", body = Task)
    )
)]
pub async fn doc_get_task() {}

#[utoipa::path(
    put,
    path = "/api/tasks/{id}",
    operation_id = "updateTask",
    tag = "todos",
    params(
        ("id" = Uuid, Path, description = "Task UUID")
    ),
    request_body = UpdateTaskRequest,
    responses(
        (status = 200, description = "Updated task", body = Task)
    )
)]
pub async fn doc_update_task() {}

#[utoipa::path(
    delete,
    path = "/api/tasks/{id}",
    operation_id = "deleteTask",
    tag = "todos",
    params(
        ("id" = Uuid, Path, description = "Task UUID")
    ),
    responses(
        (status = 200, description = "Soft-deleted task", body = Value)
    )
)]
pub async fn doc_delete_task() {}

#[utoipa::path(
    patch,
    path = "/api/tasks/{id}/status",
    operation_id = "patchTaskStatus",
    tag = "todos",
    params(
        ("id" = Uuid, Path, description = "Task UUID")
    ),
    request_body = UpdateTaskStatusRequest,
    responses(
        (status = 200, description = "Updated task status", body = Task)
    )
)]
pub async fn doc_patch_task_status() {}

#[utoipa::path(
    post,
    path = "/api/tasks/{id}/complete",
    operation_id = "completeTask",
    tag = "todos",
    params(
        ("id" = Uuid, Path, description = "Task UUID")
    ),
    responses(
        (status = 200, description = "Completed task (spawning next recurring instance if configured)", body = Task)
    )
)]
pub async fn doc_complete_task() {}

#[utoipa::path(
    get,
    path = "/api/time/timer",
    operation_id = "getActiveTimer",
    tag = "todos",
    responses(
        (status = 200, description = "Active focus timer state", body = ActiveTimerResponse)
    )
)]
pub async fn doc_get_active_timer() {}

#[utoipa::path(
    post,
    path = "/api/time/timer/start",
    operation_id = "startTimer",
    tag = "todos",
    request_body = StartTimerRequest,
    responses(
        (status = 200, description = "Started focus timer session", body = ActiveTimerResponse)
    )
)]
pub async fn doc_start_timer() {}

#[utoipa::path(
    post,
    path = "/api/time/timer/stop",
    operation_id = "stopTimer",
    tag = "todos",
    request_body = StopTimerRequest,
    responses(
        (status = 200, description = "Stopped focus timer session and rolled up seconds", body = TimeSession)
    )
)]
pub async fn doc_stop_timer() {}

#[utoipa::path(
    post,
    path = "/api/time/timer/discard",
    operation_id = "discardTimer",
    tag = "todos",
    responses(
        (status = 200, description = "Discarded active focus timer", body = ActiveTimerResponse)
    )
)]
pub async fn doc_discard_timer() {}

#[utoipa::path(
    get,
    path = "/api/time/sessions",
    operation_id = "listTimeSessions",
    tag = "todos",
    params(
        ("task_id" = Option<Uuid>, Query, description = "Optional task UUID filter"),
        ("limit" = Option<i64>, Query, description = "Maximum sessions to return")
    ),
    responses(
        (status = 200, description = "Focus time sessions", body = Vec<TimeSession>)
    )
)]
pub async fn doc_list_time_sessions() {}

#[utoipa::path(
    post,
    path = "/api/time/sessions",
    operation_id = "createTimeSession",
    tag = "todos",
    request_body = CreateTimeSessionRequest,
    responses(
        (status = 201, description = "Logged manual focus time session", body = TimeSession)
    )
)]
pub async fn doc_create_time_session() {}

#[utoipa::path(
    delete,
    path = "/api/time/sessions/{id}",
    operation_id = "deleteTimeSession",
    tag = "todos",
    params(
        ("id" = Uuid, Path, description = "Time session UUID")
    ),
    responses(
        (status = 200, description = "Deleted time session", body = Value)
    )
)]
pub async fn doc_delete_time_session() {}

#[utoipa::path(
    get,
    path = "/api/time/stats",
    operation_id = "getTimeStats",
    tag = "todos",
    responses(
        (status = 200, description = "Focus time statistics by category and day", body = TimeStatsResponse)
    )
)]
pub async fn doc_get_time_stats() {}

// =============================================================================
// 8. Routines, Habit Engine, Ideal Week & Weekly Review (F14)
// =============================================================================

#[utoipa::path(
    get,
    path = "/api/routines",
    operation_id = "listRoutines",
    tag = "routines",
    params(
        ("day_profile" = Option<String>, Query, description = "Filter by DayProfile"),
        ("date" = Option<String>, Query, description = "Target log date (YYYY-MM-DD)")
    ),
    responses(
        (status = 200, description = "Routine stacks with habits, streaks, and logs", body = Vec<RoutineStackWithItems>)
    )
)]
pub async fn doc_list_routines() {}

#[utoipa::path(
    post,
    path = "/api/routines",
    operation_id = "createRoutine",
    tag = "routines",
    request_body = CreateRoutineRequest,
    responses(
        (status = 201, description = "Created routine stack", body = RoutineStackWithItems)
    )
)]
pub async fn doc_create_routine() {}

#[utoipa::path(
    get,
    path = "/api/routines/analytics",
    operation_id = "getRoutinesAnalytics",
    tag = "routines",
    responses(
        (status = 200, description = "365-day heatmap, streaks, and recovery analytics", body = RoutineAnalyticsResponse)
    )
)]
pub async fn doc_get_routines_analytics() {}

#[utoipa::path(
    get,
    path = "/api/ideal-week",
    operation_id = "getIdealWeek",
    tag = "routines",
    responses(
        (status = 200, description = "Ideal Week blocks and actual vs planned adherence", body = IdealWeekResponse)
    )
)]
pub async fn doc_get_ideal_week() {}

#[utoipa::path(
    put,
    path = "/api/ideal-week",
    operation_id = "replaceIdealWeek",
    tag = "routines",
    request_body = UpsertIdealWeekRequest,
    responses(
        (status = 200, description = "Updated Ideal Week template", body = IdealWeekResponse)
    )
)]
pub async fn doc_replace_ideal_week() {}

#[utoipa::path(
    get,
    path = "/api/routines/ideal-week",
    operation_id = "getRoutinesIdealWeek",
    tag = "routines",
    responses(
        (status = 200, description = "Ideal Week blocks and actual vs planned adherence", body = IdealWeekResponse)
    )
)]
pub async fn doc_get_routines_ideal_week() {}

#[utoipa::path(
    post,
    path = "/api/routines/day-profile",
    operation_id = "setDayProfile",
    tag = "routines",
    request_body = Value,
    responses(
        (status = 200, description = "Updated active day profile", body = DailyCheckin)
    )
)]
pub async fn doc_set_day_profile() {}

#[utoipa::path(
    post,
    path = "/api/routines/logs",
    operation_id = "logRoutineItem",
    tag = "routines",
    request_body = LogRoutineItemRequest,
    responses(
        (status = 200, description = "Logged habit completion or skip", body = RoutineLog)
    )
)]
pub async fn doc_log_routine_item() {}

#[utoipa::path(
    get,
    path = "/api/routines/checkins/{date}",
    operation_id = "getDailyCheckin",
    tag = "routines",
    params(
        ("date" = String, Path, description = "Date (YYYY-MM-DD)")
    ),
    responses(
        (status = 200, description = "Daily bio/mood/energy check-in", body = DailyCheckin)
    )
)]
pub async fn doc_get_daily_checkin() {}

#[utoipa::path(
    put,
    path = "/api/routines/checkins/{date}",
    operation_id = "upsertDailyCheckin",
    tag = "routines",
    params(
        ("date" = String, Path, description = "Date (YYYY-MM-DD)")
    ),
    request_body = UpsertDailyCheckinRequest,
    responses(
        (status = 200, description = "Upserted daily check-in", body = DailyCheckin)
    )
)]
pub async fn doc_upsert_daily_checkin() {}

#[utoipa::path(
    get,
    path = "/api/weekly-review/summary",
    operation_id = "getWeeklyReviewSummary",
    tag = "routines",
    params(
        ("week" = Option<String>, Query, description = "ISO week (YYYY-Www) or date")
    ),
    responses(
        (status = 200, description = "Weekly Review summary and Markdown export", body = WeeklyReviewSummaryResponse)
    )
)]
pub async fn doc_get_weekly_review() {}

#[utoipa::path(
    get,
    path = "/api/reviews/weekly",
    operation_id = "getReviewsWeekly",
    tag = "routines",
    params(
        ("week" = Option<String>, Query, description = "ISO week (YYYY-Www) or date")
    ),
    responses(
        (status = 200, description = "Weekly Review summary and Markdown export", body = WeeklyReviewSummaryResponse)
    )
)]
pub async fn doc_get_reviews_weekly() {}

#[utoipa::path(
    get,
    path = "/api/routines/{id}",
    operation_id = "getRoutine",
    tag = "routines",
    params(
        ("id" = Uuid, Path, description = "Routine UUID")
    ),
    responses(
        (status = 200, description = "Routine stack with items", body = RoutineStackWithItems)
    )
)]
pub async fn doc_get_routine() {}

#[utoipa::path(
    put,
    path = "/api/routines/{id}",
    operation_id = "updateRoutine",
    tag = "routines",
    params(
        ("id" = Uuid, Path, description = "Routine UUID")
    ),
    request_body = UpdateRoutineRequest,
    responses(
        (status = 200, description = "Updated routine stack", body = RoutineStackWithItems)
    )
)]
pub async fn doc_update_routine() {}

#[utoipa::path(
    delete,
    path = "/api/routines/{id}",
    operation_id = "deleteRoutine",
    tag = "routines",
    params(
        ("id" = Uuid, Path, description = "Routine UUID")
    ),
    responses(
        (status = 200, description = "Soft-deleted routine stack", body = Value)
    )
)]
pub async fn doc_delete_routine() {}

#[utoipa::path(
    post,
    path = "/api/routines/{id}/items",
    operation_id = "createRoutineItem",
    tag = "routines",
    params(
        ("id" = Uuid, Path, description = "Routine UUID")
    ),
    request_body = CreateRoutineItemRequest,
    responses(
        (status = 201, description = "Created habit item", body = RoutineItem)
    )
)]
pub async fn doc_create_routine_item() {}

#[utoipa::path(
    put,
    path = "/api/routines/items/{item_id}",
    operation_id = "updateRoutineItem",
    tag = "routines",
    params(
        ("item_id" = Uuid, Path, description = "Routine item UUID")
    ),
    request_body = UpdateRoutineItemRequest,
    responses(
        (status = 200, description = "Updated habit item", body = RoutineItem)
    )
)]
pub async fn doc_update_routine_item() {}

#[utoipa::path(
    delete,
    path = "/api/routines/items/{item_id}",
    operation_id = "deleteRoutineItem",
    tag = "routines",
    params(
        ("item_id" = Uuid, Path, description = "Routine item UUID")
    ),
    responses(
        (status = 200, description = "Soft-deleted habit item", body = Value)
    )
)]
pub async fn doc_delete_routine_item() {}

// =============================================================================
// 9. Goals, OKRs & Q1–Q4 Yearly Blueprint (F15)
// =============================================================================

#[utoipa::path(
    get,
    path = "/api/goals/cycles",
    operation_id = "listYearlyCycles",
    tag = "goals",
    responses(
        (status = 200, description = "Yearly cycles", body = Vec<YearlyCycle>)
    )
)]
pub async fn doc_list_yearly_cycles() {}

#[utoipa::path(
    post,
    path = "/api/goals/cycles",
    operation_id = "upsertYearlyCycle",
    tag = "goals",
    request_body = UpsertYearlyCycleRequest,
    responses(
        (status = 200, description = "Upserted yearly cycle", body = YearlyCycle)
    )
)]
pub async fn doc_upsert_yearly_cycle() {}

#[utoipa::path(
    get,
    path = "/api/goals/cycles/{year}",
    operation_id = "getYearlyCycle",
    tag = "goals",
    params(
        ("year" = i32, Path, description = "Cycle year (e.g. 2026)")
    ),
    responses(
        (status = 200, description = "Yearly cycle detail", body = YearlyCycle)
    )
)]
pub async fn doc_get_yearly_cycle() {}

#[utoipa::path(
    get,
    path = "/api/goals",
    operation_id = "listGoals",
    tag = "goals",
    params(
        ("year" = Option<i32>, Query, description = "Filter by year"),
        ("pillar" = Option<String>, Query, description = "Filter by GoalPillar"),
        ("status" = Option<String>, Query, description = "Filter by GoalStatus")
    ),
    responses(
        (status = 200, description = "Goals with Key Results and pace drift", body = Vec<GoalWithDetails>)
    )
)]
pub async fn doc_list_goals() {}

#[utoipa::path(
    post,
    path = "/api/goals",
    operation_id = "createGoal",
    tag = "goals",
    request_body = CreateGoalRequest,
    responses(
        (status = 201, description = "Created goal", body = GoalWithDetails)
    )
)]
pub async fn doc_create_goal() {}

#[utoipa::path(
    get,
    path = "/api/goals/blueprint",
    operation_id = "getGoalBlueprint",
    tag = "goals",
    params(
        ("year" = Option<i32>, Query, description = "Blueprint year (default 2026)")
    ),
    responses(
        (status = 200, description = "Q1–Q4 Yearly Blueprint graph", body = BlueprintLayoutResponse)
    )
)]
pub async fn doc_get_goal_blueprint() {}

#[utoipa::path(
    get,
    path = "/api/goals/pace-drift",
    operation_id = "getGoalsPaceDrift",
    tag = "goals",
    params(
        ("year" = Option<i32>, Query, description = "Optional year filter")
    ),
    responses(
        (status = 200, description = "Goals pace drift report", body = Vec<GoalWithDetails>)
    )
)]
pub async fn doc_get_goals_pace_drift() {}

#[utoipa::path(
    get,
    path = "/api/goals/{id}",
    operation_id = "getGoal",
    tag = "goals",
    params(
        ("id" = Uuid, Path, description = "Goal UUID")
    ),
    responses(
        (status = 200, description = "Goal with Key Results, check-ins, and linked items", body = GoalWithDetails)
    )
)]
pub async fn doc_get_goal() {}

#[utoipa::path(
    put,
    path = "/api/goals/{id}",
    operation_id = "updateGoal",
    tag = "goals",
    params(
        ("id" = Uuid, Path, description = "Goal UUID")
    ),
    request_body = UpdateGoalRequest,
    responses(
        (status = 200, description = "Updated goal", body = GoalWithDetails)
    )
)]
pub async fn doc_update_goal() {}

#[utoipa::path(
    delete,
    path = "/api/goals/{id}",
    operation_id = "deleteGoal",
    tag = "goals",
    params(
        ("id" = Uuid, Path, description = "Goal UUID")
    ),
    responses(
        (status = 200, description = "Deleted goal", body = Value)
    )
)]
pub async fn doc_delete_goal() {}

#[utoipa::path(
    patch,
    path = "/api/goals/{id}/blueprint-pos",
    operation_id = "updateGoalBlueprintPos",
    tag = "goals",
    params(
        ("id" = Uuid, Path, description = "Goal UUID")
    ),
    request_body = UpdateGoalBlueprintPosRequest,
    responses(
        (status = 200, description = "Updated goal blueprint coordinates", body = GoalWithDetails)
    )
)]
pub async fn doc_update_goal_blueprint_pos() {}

#[utoipa::path(
    post,
    path = "/api/goals/{id}/key-results",
    operation_id = "createKeyResult",
    tag = "goals",
    params(
        ("id" = Uuid, Path, description = "Goal UUID")
    ),
    request_body = CreateKeyResultRequest,
    responses(
        (status = 201, description = "Created Key Result and recalculated goal progress", body = GoalKeyResult)
    )
)]
pub async fn doc_create_key_result() {}

#[utoipa::path(
    put,
    path = "/api/goals/key-results/{kr_id}",
    operation_id = "updateKeyResult",
    tag = "goals",
    params(
        ("kr_id" = Uuid, Path, description = "Key Result UUID")
    ),
    request_body = UpdateKeyResultRequest,
    responses(
        (status = 200, description = "Updated Key Result and recalculated goal progress", body = GoalKeyResult)
    )
)]
pub async fn doc_update_key_result() {}

#[utoipa::path(
    delete,
    path = "/api/goals/key-results/{kr_id}",
    operation_id = "deleteKeyResult",
    tag = "goals",
    params(
        ("kr_id" = Uuid, Path, description = "Key Result UUID")
    ),
    responses(
        (status = 200, description = "Deleted Key Result", body = Value)
    )
)]
pub async fn doc_delete_key_result() {}

#[utoipa::path(
    get,
    path = "/api/goals/{id}/checkins",
    operation_id = "listGoalCheckins",
    tag = "goals",
    params(
        ("id" = Uuid, Path, description = "Goal UUID")
    ),
    responses(
        (status = 200, description = "Goal confidence check-ins", body = Vec<GoalCheckin>)
    )
)]
pub async fn doc_list_goal_checkins() {}

#[utoipa::path(
    post,
    path = "/api/goals/{id}/checkins",
    operation_id = "createGoalCheckin",
    tag = "goals",
    params(
        ("id" = Uuid, Path, description = "Goal UUID")
    ),
    request_body = CreateGoalCheckinRequest,
    responses(
        (status = 201, description = "Logged goal confidence check-in", body = GoalCheckin)
    )
)]
pub async fn doc_create_goal_checkin() {}

// =============================================================================
// 10. Courses, Syllabus, Read-Only YouTube Import & Spaced Repetition (F16)
// =============================================================================

#[utoipa::path(
    get,
    path = "/api/courses",
    operation_id = "listCourses",
    tag = "courses",
    params(
        ("status" = Option<String>, Query, description = "Filter by CourseStatus"),
        ("provider" = Option<String>, Query, description = "Filter by CourseProvider"),
        ("goal_id" = Option<Uuid>, Query, description = "Filter by linked Goal UUID")
    ),
    responses(
        (status = 200, description = "Courses list", body = Vec<Course>)
    )
)]
pub async fn doc_list_courses() {}

#[utoipa::path(
    post,
    path = "/api/courses",
    operation_id = "createCourse",
    tag = "courses",
    request_body = CreateCourseRequest,
    responses(
        (status = 201, description = "Created course", body = CourseSyllabusResponse)
    )
)]
pub async fn doc_create_course() {}

#[utoipa::path(
    get,
    path = "/api/courses/youtube-playlists",
    operation_id = "listYoutubePlaylists",
    tag = "courses",
    responses(
        (status = 200, description = "Playlists discovered from read-only youtube-lists.sqlite", body = YoutubePlaylistsResponse)
    )
)]
pub async fn doc_list_youtube_playlists() {}

#[utoipa::path(
    post,
    path = "/api/courses/import-youtube",
    operation_id = "importYoutubePlaylist",
    tag = "courses",
    request_body = ImportYoutubePlaylistRequest,
    responses(
        (status = 201, description = "Imported YouTube playlist as course", body = CourseSyllabusResponse)
    )
)]
pub async fn doc_import_youtube_playlist() {}

#[utoipa::path(
    get,
    path = "/api/courses/spaced-reviews/due",
    operation_id = "listDueSpacedReviews",
    tag = "courses",
    responses(
        (status = 200, description = "Lessons due for 1d/7d/30d spaced repetition review", body = Vec<SpacedReviewDueItem>)
    )
)]
pub async fn doc_list_due_reviews() {}

#[utoipa::path(
    get,
    path = "/api/courses/reviews/due",
    operation_id = "listDueCourseReviews",
    tag = "courses",
    responses(
        (status = 200, description = "Lessons due for 1d/7d/30d spaced repetition review", body = Vec<SpacedReviewDueItem>)
    )
)]
pub async fn doc_list_due_course_reviews() {}

#[utoipa::path(
    post,
    path = "/api/courses/lessons/{lesson_id}/review",
    operation_id = "completeLessonReview",
    tag = "courses",
    params(
        ("lesson_id" = Uuid, Path, description = "Lesson UUID")
    ),
    request_body = ReviewLessonRequest,
    responses(
        (status = 200, description = "Advanced spaced repetition stage", body = CourseLesson)
    )
)]
pub async fn doc_complete_lesson_review() {}

#[utoipa::path(
    get,
    path = "/api/courses/{id}",
    operation_id = "getCourse",
    tag = "courses",
    params(
        ("id" = Uuid, Path, description = "Course UUID")
    ),
    responses(
        (status = 200, description = "Course with modules, lessons, and quizzes", body = CourseSyllabusResponse)
    )
)]
pub async fn doc_get_course() {}

#[utoipa::path(
    put,
    path = "/api/courses/{id}",
    operation_id = "updateCourse",
    tag = "courses",
    params(
        ("id" = Uuid, Path, description = "Course UUID")
    ),
    request_body = UpdateCourseRequest,
    responses(
        (status = 200, description = "Updated course", body = CourseSyllabusResponse)
    )
)]
pub async fn doc_update_course() {}

#[utoipa::path(
    delete,
    path = "/api/courses/{id}",
    operation_id = "deleteCourse",
    tag = "courses",
    params(
        ("id" = Uuid, Path, description = "Course UUID")
    ),
    responses(
        (status = 200, description = "Deleted course", body = Value)
    )
)]
pub async fn doc_delete_course() {}

#[utoipa::path(
    post,
    path = "/api/courses/{id}/sync-youtube",
    operation_id = "syncYoutubeCourse",
    tag = "courses",
    params(
        ("id" = Uuid, Path, description = "Course UUID")
    ),
    responses(
        (status = 200, description = "Re-synchronized YouTube playlist course", body = CourseSyllabusResponse)
    )
)]
pub async fn doc_sync_youtube_course() {}

#[utoipa::path(
    post,
    path = "/api/courses/{id}/import-outline",
    operation_id = "importCourseOutline",
    tag = "courses",
    params(
        ("id" = Uuid, Path, description = "Course UUID")
    ),
    request_body = ImportOutlineRequest,
    responses(
        (status = 200, description = "Imported Markdown syllabus outline", body = CourseSyllabusResponse)
    )
)]
pub async fn doc_import_course_outline() {}

#[utoipa::path(
    post,
    path = "/api/courses/{id}/modules",
    operation_id = "createCourseModule",
    tag = "courses",
    params(
        ("id" = Uuid, Path, description = "Course UUID")
    ),
    request_body = CreateCourseModuleRequest,
    responses(
        (status = 201, description = "Created syllabus module", body = CourseModule)
    )
)]
pub async fn doc_create_course_module() {}

#[utoipa::path(
    put,
    path = "/api/courses/modules/{module_id}",
    operation_id = "updateCourseModule",
    tag = "courses",
    params(
        ("module_id" = Uuid, Path, description = "Module UUID")
    ),
    request_body = UpdateCourseModuleRequest,
    responses(
        (status = 200, description = "Updated syllabus module", body = CourseModule)
    )
)]
pub async fn doc_update_course_module() {}

#[utoipa::path(
    delete,
    path = "/api/courses/modules/{module_id}",
    operation_id = "deleteCourseModule",
    tag = "courses",
    params(
        ("module_id" = Uuid, Path, description = "Module UUID")
    ),
    responses(
        (status = 200, description = "Deleted syllabus module", body = Value)
    )
)]
pub async fn doc_delete_course_module() {}

#[utoipa::path(
    post,
    path = "/api/courses/modules/{module_id}/lessons",
    operation_id = "createCourseLesson",
    tag = "courses",
    params(
        ("module_id" = Uuid, Path, description = "Module UUID")
    ),
    request_body = CreateCourseLessonRequest,
    responses(
        (status = 201, description = "Created course lesson", body = CourseLesson)
    )
)]
pub async fn doc_create_course_lesson() {}

#[utoipa::path(
    put,
    path = "/api/courses/lessons/{lesson_id}",
    operation_id = "updateCourseLesson",
    tag = "courses",
    params(
        ("lesson_id" = Uuid, Path, description = "Lesson UUID")
    ),
    request_body = UpdateCourseLessonRequest,
    responses(
        (status = 200, description = "Updated course lesson and recalculated rollups", body = CourseLesson)
    )
)]
pub async fn doc_update_course_lesson() {}

#[utoipa::path(
    patch,
    path = "/api/courses/lessons/{lesson_id}/status",
    operation_id = "patchCourseLessonStatus",
    tag = "courses",
    params(
        ("lesson_id" = Uuid, Path, description = "Lesson UUID")
    ),
    request_body = UpdateLessonStatusRequest,
    responses(
        (status = 200, description = "Patched lesson status and recalculated rollups", body = CourseLesson)
    )
)]
pub async fn doc_patch_course_lesson_status() {}

#[utoipa::path(
    delete,
    path = "/api/courses/lessons/{lesson_id}",
    operation_id = "deleteCourseLesson",
    tag = "courses",
    params(
        ("lesson_id" = Uuid, Path, description = "Lesson UUID")
    ),
    responses(
        (status = 200, description = "Deleted course lesson", body = Value)
    )
)]
pub async fn doc_delete_course_lesson() {}

#[utoipa::path(
    post,
    path = "/api/courses/{id}/quizzes",
    operation_id = "createCourseQuiz",
    tag = "courses",
    params(
        ("id" = Uuid, Path, description = "Course UUID")
    ),
    request_body = CourseQuizRequest,
    responses(
        (status = 201, description = "Created course quiz", body = CourseQuizResponse)
    )
)]
pub async fn doc_create_course_quiz() {}

#[utoipa::path(
    post,
    path = "/api/courses/{id}/spawn-todo",
    operation_id = "spawnCourseTodo",
    tag = "courses",
    params(
        ("id" = Uuid, Path, description = "Course UUID")
    ),
    request_body = SpawnCourseTodoRequest,
    responses(
        (status = 201, description = "Spawned study/practice task linked to course", body = Task)
    )
)]
pub async fn doc_spawn_course_todo() {}

// =============================================================================
// 11. Multi-Market Finance, Allocation & FIRE Simulator (F17)
// =============================================================================

#[utoipa::path(
    get,
    path = "/api/finance/assets",
    operation_id = "listFinanceAssets",
    tag = "finance",
    params(
        ("in_portfolio" = Option<bool>, Query, description = "Filter by portfolio holdings"),
        ("is_watchlist" = Option<bool>, Query, description = "Filter by watchlist items"),
        ("asset_class" = Option<String>, Query, description = "Filter by AssetClass"),
        ("currency" = Option<String>, Query, description = "Filter by CurrencyCode")
    ),
    responses(
        (status = 200, description = "Portfolio and watchlist assets", body = Vec<PortfolioAsset>)
    )
)]
pub async fn doc_list_finance_assets() {}

#[utoipa::path(
    post,
    path = "/api/finance/assets",
    operation_id = "createFinanceAsset",
    tag = "finance",
    request_body = CreatePortfolioAssetRequest,
    responses(
        (status = 201, description = "Created or upserted portfolio/watchlist asset", body = PortfolioAsset)
    )
)]
pub async fn doc_create_finance_asset() {}

#[utoipa::path(
    get,
    path = "/api/finance/assets/{id}",
    operation_id = "getFinanceAsset",
    tag = "finance",
    params(
        ("id" = Uuid, Path, description = "Asset UUID")
    ),
    responses(
        (status = 200, description = "Portfolio asset detail", body = PortfolioAsset)
    )
)]
pub async fn doc_get_finance_asset() {}

#[utoipa::path(
    put,
    path = "/api/finance/assets/{id}",
    operation_id = "updateFinanceAsset",
    tag = "finance",
    params(
        ("id" = Uuid, Path, description = "Asset UUID")
    ),
    request_body = UpdatePortfolioAssetRequest,
    responses(
        (status = 200, description = "Updated portfolio asset", body = PortfolioAsset)
    )
)]
pub async fn doc_update_finance_asset() {}

#[utoipa::path(
    delete,
    path = "/api/finance/assets/{id}",
    operation_id = "deleteFinanceAsset",
    tag = "finance",
    params(
        ("id" = Uuid, Path, description = "Asset UUID")
    ),
    responses(
        (status = 200, description = "Deleted portfolio asset", body = Value)
    )
)]
pub async fn doc_delete_finance_asset() {}

#[utoipa::path(
    get,
    path = "/api/finance/assets/{id}/candles",
    operation_id = "getFinanceAssetCandles",
    tag = "finance",
    params(
        ("id" = Uuid, Path, description = "Asset UUID"),
        ("range" = Option<String>, Query, description = "Timeframe range (1M, 3M, 6M, 1Y)")
    ),
    responses(
        (status = 200, description = "OHLCV candlestick series", body = AssetCandlesResponse)
    )
)]
pub async fn doc_get_finance_asset_candles() {}

#[utoipa::path(
    post,
    path = "/api/finance/quotes/refresh",
    operation_id = "refreshFinanceQuotes",
    tag = "finance",
    responses(
        (status = 200, description = "Refreshed market quotes and USD/BRL FX rate", body = QuoteRefreshResponse)
    )
)]
pub async fn doc_refresh_finance_quotes() {}

#[utoipa::path(
    get,
    path = "/api/finance/allocation",
    operation_id = "getPortfolioAllocation",
    tag = "finance",
    params(
        ("base_currency" = Option<String>, Query, description = "Base currency (BRL or USD)"),
        ("new_contribution_cents" = Option<i64>, Query, description = "New cash contribution in cents for buy-only rebalance")
    ),
    responses(
        (status = 200, description = "200-tile waffle allocation and buy-only rebalance recommendations", body = AllocationResponse)
    )
)]
pub async fn doc_get_portfolio_allocation() {}

#[utoipa::path(
    get,
    path = "/api/finance/monthly-plans",
    operation_id = "listMonthlyPlans",
    tag = "finance",
    params(
        ("limit" = Option<i64>, Query, description = "Maximum monthly plans to return")
    ),
    responses(
        (status = 200, description = "Monthly budget plans", body = Vec<MonthlyInvestmentPlan>)
    )
)]
pub async fn doc_list_monthly_plans() {}

#[utoipa::path(
    get,
    path = "/api/finance/monthly-plans/{month}",
    operation_id = "getMonthlyPlan",
    tag = "finance",
    params(
        ("month" = String, Path, description = "Month key (YYYY-MM)")
    ),
    responses(
        (status = 200, description = "Monthly plan detail", body = MonthlyInvestmentPlan)
    )
)]
pub async fn doc_get_monthly_plan() {}

#[utoipa::path(
    put,
    path = "/api/finance/monthly-plans/{month}",
    operation_id = "upsertMonthlyPlan",
    tag = "finance",
    params(
        ("month" = String, Path, description = "Month key (YYYY-MM)")
    ),
    request_body = UpsertMonthlyInvestmentPlanRequest,
    responses(
        (status = 200, description = "Upserted monthly plan", body = MonthlyInvestmentPlan)
    )
)]
pub async fn doc_upsert_monthly_plan() {}

#[utoipa::path(
    get,
    path = "/api/finance/retirement",
    operation_id = "getRetirementConfig",
    tag = "finance",
    responses(
        (status = 200, description = "Singleton FIRE retirement configuration", body = RetirementConfig)
    )
)]
pub async fn doc_get_retirement_config() {}

#[utoipa::path(
    put,
    path = "/api/finance/retirement",
    operation_id = "updateRetirementConfig",
    tag = "finance",
    request_body = UpdateRetirementConfigRequest,
    responses(
        (status = 200, description = "Updated FIRE retirement configuration", body = RetirementConfig)
    )
)]
pub async fn doc_update_retirement_config() {}

#[utoipa::path(
    get,
    path = "/api/finance/retirement/projection",
    operation_id = "getRetirementProjection",
    tag = "finance",
    responses(
        (status = 200, description = "Deterministic Lean/Base/Fat FIRE trajectory", body = FireProjectionResponse)
    )
)]
pub async fn doc_get_retirement_projection() {}

#[utoipa::path(
    post,
    path = "/api/finance/retirement/simulate",
    operation_id = "simulateRetirement",
    tag = "finance",
    request_body = FireSimulationRequest,
    responses(
        (status = 200, description = "Ad-hoc FIRE trajectory simulation", body = FireProjectionResponse)
    )
)]
pub async fn doc_simulate_retirement() {}

#[utoipa::path(
    get,
    path = "/api/finance/snapshots",
    operation_id = "listPortfolioSnapshots",
    tag = "finance",
    params(
        ("limit" = Option<i64>, Query, description = "Maximum snapshots to return")
    ),
    responses(
        (status = 200, description = "Historical net-worth snapshots", body = Vec<PortfolioSnapshot>)
    )
)]
pub async fn doc_list_portfolio_snapshots() {}

#[utoipa::path(
    post,
    path = "/api/finance/snapshots",
    operation_id = "createPortfolioSnapshot",
    tag = "finance",
    request_body = CreatePortfolioSnapshotRequest,
    responses(
        (status = 201, description = "Captured net-worth snapshot", body = PortfolioSnapshot)
    )
)]
pub async fn doc_create_portfolio_snapshot() {}

// =============================================================================
// Unified OpenAPI 3.1 Document
// =============================================================================

#[derive(OpenApi)]
#[openapi(
    info(
        title = "HERMES // OS API",
        version = "1.0.0",
        description = "Unified Rust 2024 REST + SSE + /mcp API for HERMES // OS (Personal Life Manager & Second Brain)"
    ),
    modifiers(&SecurityAddon),
    paths(
        // 1. Health & Auth
        doc_get_health,
        doc_get_openapi,
        doc_verify_auth,
        doc_login,
        doc_logout,
        doc_get_me,
        doc_list_tokens,
        doc_create_token,
        doc_revoke_token,
        doc_create_pairing_qr,
        // 2. Sync
        doc_sync_push,
        doc_sync_pull,
        // 3. Dashboards, Life Score, Servers & SSE
        doc_list_dashboards,
        doc_create_dashboard,
        doc_get_dashboard,
        doc_update_dashboard,
        doc_delete_dashboard,
        doc_clone_dashboard,
        doc_reorder_dashboards,
        doc_create_widget,
        doc_update_widget,
        doc_delete_widget,
        doc_refresh_widget,
        doc_get_life_score,
        doc_list_servers,
        doc_create_server,
        doc_get_servers_summary,
        doc_check_all_servers,
        doc_get_server,
        doc_update_server,
        doc_delete_server,
        doc_check_server,
        doc_stream_events,
        // 4. Hermes Gateway & Sessions
        doc_get_hermes_health,
        doc_list_hermes_sessions,
        doc_create_hermes_session,
        doc_get_hermes_session,
        doc_update_hermes_session,
        doc_delete_hermes_session,
        doc_fork_hermes_session,
        doc_stream_hermes_chat,
        // 5. MCP Autonomy, Approvals & Undo
        doc_list_mcp_tools,
        doc_call_mcp_tool,
        doc_list_mcp_approvals,
        doc_approve_mcp_action,
        doc_reject_mcp_action,
        doc_list_mcp_undo,
        doc_undo_mcp_action,
        // 6. Agent Studio Knights, Vault & Companion
        doc_list_agents,
        doc_create_agent,
        doc_get_agent_queue,
        doc_list_agent_runs,
        doc_get_agent_run,
        doc_get_agent,
        doc_update_agent,
        doc_delete_agent,
        doc_list_runs_for_agent,
        doc_dispatch_agent,
        doc_list_agent_triggers,
        doc_create_agent_trigger,
        doc_update_agent_trigger,
        doc_delete_agent_trigger,
        doc_list_vault_notes,
        doc_get_vault_note,
        doc_distill_to_vault,
        doc_get_companion_nudges,
        doc_list_companion_phrases,
        doc_create_companion_phrase,
        doc_delete_companion_phrase,
        // 7. Todos, Projects & Focus Timer
        doc_list_projects,
        doc_create_project,
        doc_get_project,
        doc_update_project,
        doc_delete_project,
        doc_list_tasks,
        doc_create_task,
        doc_parse_task,
        doc_bulk_update_tasks,
        doc_get_task_flow,
        doc_get_task_capacity,
        doc_get_task,
        doc_update_task,
        doc_delete_task,
        doc_patch_task_status,
        doc_complete_task,
        doc_get_active_timer,
        doc_start_timer,
        doc_stop_timer,
        doc_discard_timer,
        doc_list_time_sessions,
        doc_create_time_session,
        doc_delete_time_session,
        doc_get_time_stats,
        // 8. Routines, Habit Engine & Ideal Week
        doc_list_routines,
        doc_create_routine,
        doc_get_routines_analytics,
        doc_get_ideal_week,
        doc_replace_ideal_week,
        doc_get_routines_ideal_week,
        doc_set_day_profile,
        doc_log_routine_item,
        doc_get_daily_checkin,
        doc_upsert_daily_checkin,
        doc_get_weekly_review,
        doc_get_reviews_weekly,
        doc_get_routine,
        doc_update_routine,
        doc_delete_routine,
        doc_create_routine_item,
        doc_update_routine_item,
        doc_delete_routine_item,
        // 9. Goals, OKRs & Blueprint
        doc_list_yearly_cycles,
        doc_upsert_yearly_cycle,
        doc_get_yearly_cycle,
        doc_list_goals,
        doc_create_goal,
        doc_get_goal_blueprint,
        doc_get_goals_pace_drift,
        doc_get_goal,
        doc_update_goal,
        doc_delete_goal,
        doc_update_goal_blueprint_pos,
        doc_create_key_result,
        doc_update_key_result,
        doc_delete_key_result,
        doc_list_goal_checkins,
        doc_create_goal_checkin,
        // 10. Courses, Syllabus, YouTube & Spaced Repetition
        doc_list_courses,
        doc_create_course,
        doc_list_youtube_playlists,
        doc_import_youtube_playlist,
        doc_list_due_reviews,
        doc_list_due_course_reviews,
        doc_complete_lesson_review,
        doc_get_course,
        doc_update_course,
        doc_delete_course,
        doc_sync_youtube_course,
        doc_import_course_outline,
        doc_create_course_module,
        doc_update_course_module,
        doc_delete_course_module,
        doc_create_course_lesson,
        doc_update_course_lesson,
        doc_patch_course_lesson_status,
        doc_delete_course_lesson,
        doc_create_course_quiz,
        doc_spawn_course_todo,
        // 11. Finance, Allocation & FIRE Simulator
        doc_list_finance_assets,
        doc_create_finance_asset,
        doc_get_finance_asset,
        doc_update_finance_asset,
        doc_delete_finance_asset,
        doc_get_finance_asset_candles,
        doc_refresh_finance_quotes,
        doc_get_portfolio_allocation,
        doc_list_monthly_plans,
        doc_get_monthly_plan,
        doc_upsert_monthly_plan,
        doc_get_retirement_config,
        doc_update_retirement_config,
        doc_get_retirement_projection,
        doc_simulate_retirement,
        doc_list_portfolio_snapshots,
        doc_create_portfolio_snapshot
    ),
    components(
        schemas(
            // agents.rs (18)
            KnightArchetype,
            ArenaZone,
            SkillPolicyMode,
            KnightGridPos,
            AgentTriggerType,
            AgentRunStatus,
            Agent,
            AgentWithTelemetry,
            CreateAgentRequest,
            UpdateAgentRequest,
            AgentTrigger,
            CreateAgentTriggerRequest,
            UpdateAgentTriggerRequest,
            AgentRun,
            DispatchAgentRequest,
            AgentRunFilter,
            TurnOrderQueueItem,
            AgentQueueResponse,
            // auth.rs (12)
            GatewayHealthMode,
            HealthStatusResponse,
            UserRole,
            User,
            LoginRequest,
            LoginResponse,
            AuthVerifyResponse,
            ApiTokenSummary,
            CreatePatRequest,
            CreatedPatResponse,
            PairingQrRequest,
            PairingQrResponse,
            // courses.rs (25)
            CourseProvider,
            CourseStatus,
            LessonStatus,
            SpacedReviewAction,
            Course,
            CreateCourseRequest,
            UpdateCourseRequest,
            CourseModule,
            CreateCourseModuleRequest,
            UpdateCourseModuleRequest,
            CourseLesson,
            CreateCourseLessonRequest,
            UpdateCourseLessonRequest,
            UpdateLessonStatusRequest,
            CourseModuleWithLessons,
            CourseSyllabusResponse,
            ImportOutlineRequest,
            YoutubePlaylistCandidate,
            YoutubePlaylistsResponse,
            ImportYoutubePlaylistRequest,
            CourseQuizRequest,
            CourseQuizResponse,
            SpawnCourseTodoRequest,
            SpacedReviewDueItem,
            ReviewLessonRequest,
            // dashboards.rs (16)
            WidgetSourceKind,
            WidgetRendererKind,
            BuiltinWidgetType,
            GridRect,
            Dashboard,
            DashboardWidget,
            DashboardWithWidgets,
            CreateDashboardRequest,
            UpdateDashboardRequest,
            CloneDashboardRequest,
            ReorderDashboardsRequest,
            CreateWidgetRequest,
            UpdateWidgetRequest,
            LifeScorePillars,
            PillarWeights,
            LifeScoreResponse,
            // error.rs (2)
            ApiErrorBody,
            ApiError,
            // events.rs (1)
            SystemEvent,
            // finance.rs (21)
            AssetClass,
            CurrencyCode,
            AssetListFilter,
            PortfolioAsset,
            CreatePortfolioAssetRequest,
            UpdatePortfolioAssetRequest,
            CandlestickBar,
            AssetCandlesResponse,
            QuoteRefreshResponse,
            WaffleTile,
            RebalanceRecommendation,
            AllocationResponse,
            MonthlyInvestmentPlan,
            UpsertMonthlyInvestmentPlanRequest,
            RetirementConfig,
            UpdateRetirementConfigRequest,
            FireTrajectoryPoint,
            FireProjectionResponse,
            FireSimulationRequest,
            PortfolioSnapshot,
            CreatePortfolioSnapshotRequest,
            // goals.rs (26)
            CycleStatus,
            GoalPillar,
            GoalStatus,
            OkrQuarter,
            KrMetricType,
            PaceHealthStatus,
            BlueprintPos,
            YearlyCycle,
            UpsertYearlyCycleRequest,
            UpdateYearlyCycleRequest,
            Goal,
            CreateGoalRequest,
            UpdateGoalRequest,
            UpdateGoalBlueprintPosRequest,
            GoalKeyResult,
            CreateKeyResultRequest,
            UpdateKeyResultRequest,
            GoalCheckin,
            CreateGoalCheckinRequest,
            GoalWithDetails,
            BlueprintTitleBlock,
            BlueprintQuarterMatrixCell,
            BlueprintPillarZone,
            BlueprintNode,
            BlueprintCorridor,
            BlueprintLayoutResponse,
            // hermes.rs (28)
            SessionOrigin,
            McpAutonomyTier,
            ApprovalStatus,
            TriggerContext,
            CompanionAnimationHint,
            ListHermesSessionsQuery,
            HermesChatMessage,
            HermesSession,
            CreateHermesSessionRequest,
            UpdateHermesSessionRequest,
            ForkHermesSessionRequest,
            PageContextPayload,
            ChatToolCallDirective,
            ChatStreamRequest,
            ThinkingOrbState,
            HermesStreamEvent,
            PendingMcpApproval,
            ResolveMcpApprovalRequest,
            McpUndoAction,
            VaultNoteListQuery,
            VaultNoteSummary,
            VaultNoteDetail,
            DistillVaultRequest,
            DistillVaultResponse,
            VaultEmbeddingRecord,
            CompanionOfflinePhrase,
            CreateCompanionPhraseRequest,
            CompanionNudge,
            // routines.rs (25)
            RoutineTimeSlot,
            DayProfile,
            HabitTrackingType,
            HabitFrequencyType,
            RoutineLogStatus,
            Routine,
            CreateRoutineRequest,
            UpdateRoutineRequest,
            RoutineItem,
            CreateRoutineItemRequest,
            UpdateRoutineItemRequest,
            RoutineLog,
            LogRoutineItemRequest,
            DailyCheckin,
            UpsertDailyCheckinRequest,
            IdealWeekBlock,
            UpsertIdealWeekRequest,
            IdealWeekCategoryVariance,
            IdealWeekResponse,
            RoutineStackWithItems,
            HabitStreakSummary,
            RoutineHeatmapDay,
            RoutineStackAdherence,
            RoutineAnalyticsResponse,
            WeeklyReviewSummaryResponse,
            // servers.rs (6)
            ServerCheckType,
            ServerStatus,
            ServerNode,
            CreateServerRequest,
            UpdateServerRequest,
            ServerSummaryResponse,
            // sync.rs (7)
            SyncOp,
            SyncMutationInput,
            SyncPushRequest,
            SyncPushResponse,
            SyncChangeEntry,
            SyncPullQuery,
            SyncPullResponse,
            // todos.rs (29)
            ProjectArea,
            ProjectStatus,
            TaskStatus,
            TaskPriority,
            TaskEnergyLevel,
            TimeCategory,
            TimerMode,
            Project,
            CreateProjectRequest,
            UpdateProjectRequest,
            Task,
            CreateTaskRequest,
            UpdateTaskRequest,
            UpdateTaskStatusRequest,
            TaskListFilter,
            BulkUpdateTasksRequest,
            TodayCapacityMeter,
            TimeSession,
            CreateTimeSessionRequest,
            ActiveTimerResponse,
            StartTimerRequest,
            StopTimerRequest,
            QuickCaptureParseRequest,
            QuickCaptureParsed,
            TimeStatsResponse,
            FlowNode,
            FlowEdge,
            FlowStageSummary,
            ProjectFlowTopologyResponse
        )
    )
)]
pub struct ApiDoc;

pub fn openapi_pretty_json() -> String {
    let mut json = ApiDoc::openapi()
        .to_pretty_json()
        .expect("Failed to serialize OpenAPI 3.1 document");
    if !json.ends_with('\n') {
        json.push('\n');
    }
    json
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn openapi_31_contract_and_export() {
        let json_str = openapi_pretty_json();
        let val: serde_json::Value =
            serde_json::from_str(&json_str).expect("OpenAPI JSON must parse");

        let version = val["openapi"].as_str().unwrap_or("");
        assert!(
            version.starts_with("3.1"),
            "Expected OpenAPI 3.1.x, got {version}"
        );
        assert!(
            !json_str.contains("pgvector::Vector"),
            "OpenAPI spec must not leak pgvector::Vector"
        );

        let schemas = val["components"]["schemas"]
            .as_object()
            .expect("components.schemas must exist");
        assert!(
            schemas.len() >= 200,
            "Expected >= 200 schemas, got {}",
            schemas.len()
        );
        for key in schemas.keys() {
            assert!(
                !key.contains("::"),
                "Schema key '{key}' must not contain Rust module path separator '::'"
            );
        }

        let paths = val["paths"].as_object().expect("paths must exist");
        let required_paths = [
            "/api/health",
            "/api/openapi.json",
            "/api/auth/verify",
            "/api/auth/login",
            "/api/auth/tokens",
            "/api/auth/pairing-qr",
            "/api/sync/push",
            "/api/sync/pull",
            "/api/dashboards",
            "/api/telemetry/life-score",
            "/api/servers",
            "/api/events/stream",
            "/api/hermes/sessions",
            "/api/hermes/chat/stream",
            "/api/companion/phrases",
            "/api/mcp/approvals",
            "/api/mcp/undo",
            "/api/vault/notes",
            "/api/agents",
            "/api/agent-runs",
            "/api/projects",
            "/api/tasks",
            "/api/time/timer",
            "/api/routines",
            "/api/ideal-week",
            "/api/weekly-review/summary",
            "/api/goals",
            "/api/goals/cycles",
            "/api/courses",
            "/api/courses/spaced-reviews/due",
            "/api/finance/assets",
            "/api/finance/allocation",
            "/api/finance/monthly-plans",
            "/api/finance/retirement",
        ];
        for req_path in required_paths {
            assert!(
                paths.contains_key(req_path),
                "Missing required OpenAPI path: {req_path}"
            );
        }

        let sdk_openapi_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/api-client/openapi.json");
        if std::env::var("WRITE_OPENAPI_JSON").ok().as_deref() == Some("1")
            || !sdk_openapi_path.exists()
        {
            std::fs::write(&sdk_openapi_path, &json_str)
                .expect("Failed to write packages/api-client/openapi.json");
        }

        let on_disk = std::fs::read_to_string(&sdk_openapi_path)
            .expect("packages/api-client/openapi.json must exist");
        assert_eq!(
            on_disk, json_str,
            "packages/api-client/openapi.json must match ApiDoc::openapi() byte-for-byte"
        );
    }
}

