//! Native Rust `/mcp` (`rmcp = "3.10.0"`) Streamable HTTP server exposing all 7 Life Ops
//! domains (`61` tools across `dashboards`, `todos`, `routines`, `goals`, `courses`, `finance`, `servers`)
//! and enforcing the 3-Tier Write Autonomy Gate (`READ`, `IMMEDIATE_UNDO`, `REQUIRE_APPROVAL`).

use std::{borrow::Cow, collections::HashSet, sync::Arc};

use axum::{
    Router,
    body::Body,
    extract::State,
    http::{HeaderValue, Request, StatusCode, header},
    response::{IntoResponse, Response},
    routing::any,
};
use chrono::{Duration as ChronoDuration, NaiveDate, Utc};
use hermes_domain::{
    agents::SkillPolicyMode,
    courses::{
        CourseLesson, CourseProvider, CourseStatus, CourseSyllabusResponse,
        ImportYoutubePlaylistRequest, LessonStatus, ReviewLessonRequest, SpacedReviewAction,
        SpawnCourseTodoRequest, UpdateLessonStatusRequest,
    },
    dashboards::{
        CreateDashboardRequest, CreateWidgetRequest, DashboardWidget, DashboardWithWidgets,
        GridRect, ReorderDashboardsRequest, UpdateDashboardRequest, UpdateWidgetRequest,
        WidgetRendererKind, WidgetSourceKind,
    },
    error::ApiError,
    events::SystemEvent,
    finance::{
        AssetClass, AssetListFilter, CreatePortfolioAssetRequest, CurrencyCode,
        FireSimulationRequest, PortfolioAsset, RetirementConfig, UpdateRetirementConfigRequest,
        UpsertMonthlyInvestmentPlanRequest,
    },
    goals::{
        CreateGoalCheckinRequest, CreateGoalRequest, GoalKeyResult, GoalPillar, GoalStatus,
        GoalWithDetails, UpdateGoalRequest, UpdateKeyResultRequest,
    },
    hermes::{
        ApprovalStatus, McpAutonomyTier, McpUndoAction, PendingMcpApproval,
        ResolveMcpApprovalRequest,
    },
    id::new_uuid_v7,
    routines::{
        CreateRoutineItemRequest, CreateRoutineRequest, DailyCheckin, DayProfile,
        LogRoutineItemRequest, RoutineLog, RoutineStackWithItems, RoutineTimeSlot,
        UpsertDailyCheckinRequest,
    },
    servers::{CreateServerRequest, ServerNode, UpdateServerRequest},
    todos::{
        BulkUpdateTasksRequest, CreateTaskRequest, Project, StartTimerRequest, StopTimerRequest,
        Task, TaskListFilter, TimeSession, UpdateTaskRequest,
    },
};
use hermes_life_ops::dashboards::{validate_custom_sql_query, widget_requires_mcp_approval};
use rmcp::{
    ErrorData, RoleServer, ServerHandler,
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, ErrorCode, Implementation,
        JsonObject, ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig,
        Tool, ToolAnnotations,
    },
    service::RequestContext,
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    },
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use crate::service::IntelligenceService;

pub const MCP_UNDO_TTL_MINUTES: i64 = 15;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolSpec {
    pub name: &'static str,
    pub domain: &'static str,
    pub tier: McpAutonomyTier,
    pub description: &'static str,
    pub schema: Value,
}

#[derive(Debug, Clone, Default)]
pub struct McpCallContext {
    pub session_key: String,
    pub agent_run_id: Option<Uuid>,
    pub knight_policy: Option<Value>,
    pub allowed_tools: Option<Vec<String>>,
    pub bypass_approval_gate: bool,
}

impl McpCallContext {
    pub fn direct(session_key: impl Into<String>) -> Self {
        let key = session_key.into();
        Self {
            session_key: if key.trim().is_empty() {
                "mcp-direct".to_string()
            } else {
                key
            },
            agent_run_id: None,
            knight_policy: None,
            allowed_tools: None,
            bypass_approval_gate: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum McpToolExecutionOutcome {
    ExecutedRead {
        tool_name: String,
        autonomy_tier: McpAutonomyTier,
        result: Value,
    },
    ExecutedWithUndo {
        tool_name: String,
        autonomy_tier: McpAutonomyTier,
        undo_action: McpUndoAction,
        result: Value,
    },
    PendingApproval {
        tool_name: String,
        autonomy_tier: McpAutonomyTier,
        approval: PendingMcpApproval,
    },
}

impl McpToolExecutionOutcome {
    pub fn to_json_value(&self) -> Value {
        match self {
            Self::ExecutedRead {
                tool_name,
                autonomy_tier,
                result,
            } => json!({
                "status": "executed",
                "tool_name": tool_name,
                "autonomy_tier": autonomy_tier,
                "result": result,
            }),
            Self::ExecutedWithUndo {
                tool_name,
                autonomy_tier,
                undo_action,
                result,
            } => json!({
                "status": "executed",
                "tool_name": tool_name,
                "autonomy_tier": autonomy_tier,
                "undo_id": undo_action.id,
                "expires_at": undo_action.expires_at,
                "result": result,
            }),
            Self::PendingApproval {
                tool_name,
                autonomy_tier,
                approval,
            } => json!({
                "status": "pending_approval",
                "tool_name": tool_name,
                "autonomy_tier": autonomy_tier,
                "approval_id": approval.id,
                "payload_json": approval.payload_json,
                "message": format!("Tool '{tool_name}' requires human operator approval before execution."),
            }),
        }
    }
}

struct MutationRecord {
    entity_table: Option<String>,
    entity_id: Option<String>,
    undo_kind: String,
    undo_payload: Value,
    result: Value,
}

/// Complete catalog of all 61 `/mcp` tools across the 7 Life Ops domains (`PROJECT.md §5`).
pub fn mcp_tool_catalog() -> Vec<McpToolSpec> {
    vec![
        // ---------------------------------------------------------------------
        // 1. dashboards (10 tools)
        // ---------------------------------------------------------------------
        McpToolSpec {
            name: "dashboards_list",
            domain: "dashboards",
            tier: McpAutonomyTier::Read,
            description: "List all Room Monitor dashboards and their widgets.",
            schema: json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "dashboards_get",
            domain: "dashboards",
            tier: McpAutonomyTier::Read,
            description: "Get a Room Monitor dashboard and its widgets by UUID or slug.",
            schema: json!({
                "type": "object",
                "properties": {
                    "id_or_slug": { "type": "string", "description": "Dashboard UUID or slug" }
                },
                "required": ["id_or_slug"]
            }),
        },
        McpToolSpec {
            name: "dashboards_get_life_score",
            domain: "dashboards",
            tier: McpAutonomyTier::Read,
            description: "Compute the 5-pillar Life Score (0-100) across Focus, Routines, Goals, Learning, and Wealth.",
            schema: json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "dashboards_create",
            domain: "dashboards",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Create a new Room Monitor dashboard deck.",
            schema: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "slug": { "type": "string" },
                    "cycle_seconds": { "type": "integer", "default": 60 },
                    "in_rotation": { "type": "boolean", "default": true },
                    "layout_cols": { "type": "integer", "default": 12 },
                    "layout_rows": { "type": "integer", "default": 8 }
                },
                "required": ["title"]
            }),
        },
        McpToolSpec {
            name: "dashboards_switch_deck",
            domain: "dashboards",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Promote a dashboard deck to the front of the Room Monitor rotation.",
            schema: json!({
                "type": "object",
                "properties": {
                    "id_or_slug": { "type": "string" }
                },
                "required": ["id_or_slug"]
            }),
        },
        McpToolSpec {
            name: "dashboards_add_widget",
            domain: "dashboards",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Add a widget to a dashboard (command/sql widgets automatically escalate to REQUIRE_APPROVAL).",
            schema: json!({
                "type": "object",
                "properties": {
                    "dashboard_id": { "type": "string", "format": "uuid" },
                    "title": { "type": "string" },
                    "source_kind": { "type": "string", "enum": ["builtin", "command", "http", "sql", "hermes"] },
                    "renderer_kind": { "type": "string", "enum": ["kpi", "sparkline", "waffle", "bar", "table", "terminal", "custom_module"] },
                    "grid_rect": { "type": "object" },
                    "source_config": { "type": "object" },
                    "refresh_interval_seconds": { "type": "integer", "default": 60 }
                },
                "required": ["dashboard_id", "title"]
            }),
        },
        McpToolSpec {
            name: "dashboards_update_layout",
            domain: "dashboards",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Update a dashboard's layout/cycle settings or reposition a widget's grid_rect.",
            schema: json!({
                "type": "object",
                "properties": {
                    "dashboard_id": { "type": "string", "format": "uuid" },
                    "title": { "type": "string" },
                    "cycle_seconds": { "type": "integer" },
                    "in_rotation": { "type": "boolean" },
                    "layout_cols": { "type": "integer" },
                    "layout_rows": { "type": "integer" },
                    "widget_id": { "type": "string", "format": "uuid" },
                    "grid_rect": { "type": "object" }
                },
                "required": ["dashboard_id"]
            }),
        },
        McpToolSpec {
            name: "dashboards_delete",
            domain: "dashboards",
            tier: McpAutonomyTier::RequireApproval,
            description: "Delete a Room Monitor dashboard and its widgets (requires operator approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "dashboard_id": { "type": "string", "format": "uuid" }
                },
                "required": ["dashboard_id"]
            }),
        },
        McpToolSpec {
            name: "dashboards_configure_command_widget",
            domain: "dashboards",
            tier: McpAutonomyTier::RequireApproval,
            description: "Create or update a shell command telemetry widget (requires operator approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "dashboard_id": { "type": "string", "format": "uuid" },
                    "widget_id": { "type": "string", "format": "uuid" },
                    "title": { "type": "string" },
                    "command": { "type": "string" },
                    "grid_rect": { "type": "object" },
                    "refresh_interval_seconds": { "type": "integer", "default": 60 }
                },
                "required": ["dashboard_id", "command"]
            }),
        },
        McpToolSpec {
            name: "dashboards_configure_sql_widget",
            domain: "dashboards",
            tier: McpAutonomyTier::RequireApproval,
            description: "Create or update a read-only custom SQL telemetry widget (requires operator approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "dashboard_id": { "type": "string", "format": "uuid" },
                    "widget_id": { "type": "string", "format": "uuid" },
                    "title": { "type": "string" },
                    "query": { "type": "string" },
                    "grid_rect": { "type": "object" },
                    "refresh_interval_seconds": { "type": "integer", "default": 60 }
                },
                "required": ["dashboard_id", "query"]
            }),
        },
        // ---------------------------------------------------------------------
        // 2. todos (12 tools)
        // ---------------------------------------------------------------------
        McpToolSpec {
            name: "todos_list_tasks",
            domain: "todos",
            tier: McpAutonomyTier::Read,
            description: "List tasks filtered by perspective, status, project_id, goal_id, priority, or search query.",
            schema: json!({
                "type": "object",
                "properties": {
                    "perspective": { "type": "string" },
                    "status": { "type": "string" },
                    "project_id": { "type": "string", "format": "uuid" },
                    "goal_id": { "type": "string", "format": "uuid" },
                    "priority": { "type": "string" },
                    "search": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "todos_get_task",
            domain: "todos",
            tier: McpAutonomyTier::Read,
            description: "Get a single task by UUID.",
            schema: json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string", "format": "uuid" }
                },
                "required": ["task_id"]
            }),
        },
        McpToolSpec {
            name: "todos_list_projects",
            domain: "todos",
            tier: McpAutonomyTier::Read,
            description: "List all active Todo projects.",
            schema: json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "todos_get_active_timer",
            domain: "todos",
            tier: McpAutonomyTier::Read,
            description: "Get the currently running Stopwatch/Pomodoro focus timer session.",
            schema: json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "todos_create_task",
            domain: "todos",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Create a new task or quick-capture item with immediate 15-minute undo support.",
            schema: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "quick_capture": { "type": "string" },
                    "description_md": { "type": "string" },
                    "status": { "type": "string" },
                    "priority": { "type": "string" },
                    "project_id": { "type": "string", "format": "uuid" },
                    "goal_id": { "type": "string", "format": "uuid" },
                    "estimated_minutes": { "type": "integer" },
                    "tags": { "type": "array", "items": { "type": "string" } }
                }
            }),
        },
        McpToolSpec {
            name: "todos_complete_task",
            domain: "todos",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Mark a task as done with immediate undo support.",
            schema: json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string", "format": "uuid" }
                },
                "required": ["task_id"]
            }),
        },
        McpToolSpec {
            name: "todos_update_task",
            domain: "todos",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Update an existing task's fields with immediate undo support.",
            schema: json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string", "format": "uuid" },
                    "title": { "type": "string" },
                    "description_md": { "type": "string" },
                    "status": { "type": "string" },
                    "priority": { "type": "string" },
                    "project_id": { "type": "string", "format": "uuid" },
                    "goal_id": { "type": "string", "format": "uuid" },
                    "estimated_minutes": { "type": "integer" }
                },
                "required": ["task_id"]
            }),
        },
        McpToolSpec {
            name: "todos_start_timer",
            domain: "todos",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Start a Stopwatch or Pomodoro focus timer session.",
            schema: json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string", "format": "uuid" },
                    "course_id": { "type": "string", "format": "uuid" },
                    "category": { "type": "string" },
                    "timer_mode": { "type": "string" },
                    "notes": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "todos_stop_timer",
            domain: "todos",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Stop the active focus timer session and roll up elapsed seconds.",
            schema: json!({
                "type": "object",
                "properties": {
                    "notes": { "type": "string" },
                    "duration_seconds": { "type": "integer" }
                }
            }),
        },
        McpToolSpec {
            name: "todos_delete_task",
            domain: "todos",
            tier: McpAutonomyTier::RequireApproval,
            description: "Delete a task (requires operator approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string", "format": "uuid" }
                },
                "required": ["task_id"]
            }),
        },
        McpToolSpec {
            name: "todos_bulk_update_tasks",
            domain: "todos",
            tier: McpAutonomyTier::RequireApproval,
            description: "Bulk-update status, priority, project, or deletion across multiple tasks (requires approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "task_ids": { "type": "array", "items": { "type": "string", "format": "uuid" } },
                    "status": { "type": "string" },
                    "priority": { "type": "string" },
                    "delete": { "type": "boolean" }
                },
                "required": ["task_ids"]
            }),
        },
        McpToolSpec {
            name: "todos_delete_project",
            domain: "todos",
            tier: McpAutonomyTier::RequireApproval,
            description: "Delete a project and unlink its tasks (requires operator approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "project_id": { "type": "string", "format": "uuid" }
                },
                "required": ["project_id"]
            }),
        },
        // ---------------------------------------------------------------------
        // 3. routines (9 tools)
        // ---------------------------------------------------------------------
        McpToolSpec {
            name: "routines_list",
            domain: "routines",
            tier: McpAutonomyTier::Read,
            description: "List routine stacks and their habit items.",
            schema: json!({
                "type": "object",
                "properties": {
                    "day_profile": { "type": "string" },
                    "log_date": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "routines_get_today",
            domain: "routines",
            tier: McpAutonomyTier::Read,
            description: "Get today's active routine stacks, items, and completion logs.",
            schema: json!({
                "type": "object",
                "properties": {
                    "day_profile": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "routines_get_streaks",
            domain: "routines",
            tier: McpAutonomyTier::Read,
            description: "Get habit streaks, 8x12 consistency matrix, and 365d analytics.",
            schema: json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "routines_get_checkin",
            domain: "routines",
            tier: McpAutonomyTier::Read,
            description: "Get the daily bio/reflection check-in for a date (defaults to today).",
            schema: json!({
                "type": "object",
                "properties": {
                    "log_date": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "routines_log_item",
            domain: "routines",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Log a habit item completion, partial, or skip for a date.",
            schema: json!({
                "type": "object",
                "properties": {
                    "routine_item_id": { "type": "string", "format": "uuid" },
                    "log_date": { "type": "string" },
                    "status": { "type": "string", "enum": ["completed", "partial", "skipped"] },
                    "numeric_value": { "type": "number" },
                    "notes": { "type": "string" }
                },
                "required": ["routine_item_id"]
            }),
        },
        McpToolSpec {
            name: "routines_upsert_checkin",
            domain: "routines",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Upsert a daily check-in (energy, mood, sleep, highlight, reflection) and export to Vault.",
            schema: json!({
                "type": "object",
                "properties": {
                    "log_date": { "type": "string" },
                    "day_profile_used": { "type": "string" },
                    "energy_score": { "type": "integer" },
                    "mood_score": { "type": "integer" },
                    "sleep_hours": { "type": "number" },
                    "highlight": { "type": "string" },
                    "reflection_md": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "routines_set_day_profile",
            domain: "routines",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Switch the active Day Profile (workday, weekend, travel, minimum_viable) for a date.",
            schema: json!({
                "type": "object",
                "properties": {
                    "log_date": { "type": "string" },
                    "day_profile": { "type": "string", "enum": ["workday", "weekend", "travel", "minimum_viable", "all"] }
                },
                "required": ["day_profile"]
            }),
        },
        McpToolSpec {
            name: "routines_save_template",
            domain: "routines",
            tier: McpAutonomyTier::RequireApproval,
            description: "Create or update a routine stack template and its habit items (requires approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "routine_id": { "type": "string", "format": "uuid" },
                    "name": { "type": "string" },
                    "time_slot": { "type": "string" },
                    "day_profile": { "type": "string" },
                    "items": { "type": "array", "items": { "type": "object" } }
                },
                "required": ["name"]
            }),
        },
        McpToolSpec {
            name: "routines_delete",
            domain: "routines",
            tier: McpAutonomyTier::RequireApproval,
            description: "Delete a routine stack and its items (requires operator approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "routine_id": { "type": "string", "format": "uuid" }
                },
                "required": ["routine_id"]
            }),
        },
        // ---------------------------------------------------------------------
        // 4. goals (7 tools)
        // ---------------------------------------------------------------------
        McpToolSpec {
            name: "goals_list",
            domain: "goals",
            tier: McpAutonomyTier::Read,
            description: "List Yearly Goals and their Q1-Q4 Key Results.",
            schema: json!({
                "type": "object",
                "properties": {
                    "year": { "type": "integer" },
                    "pillar": { "type": "string" },
                    "status": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "goals_get_blueprint",
            domain: "goals",
            tier: McpAutonomyTier::Read,
            description: "Get the REF-03 90-degree Manhattan orthogonal Yearly Goal Blueprint layout.",
            schema: json!({
                "type": "object",
                "properties": {
                    "year": { "type": "integer", "default": 2026 }
                }
            }),
        },
        McpToolSpec {
            name: "goals_get_pace_drift",
            domain: "goals",
            tier: McpAutonomyTier::Read,
            description: "Get pace drift health (on_track, at_risk, off_track) across Yearly Goals.",
            schema: json!({
                "type": "object",
                "properties": {
                    "year": { "type": "integer" }
                }
            }),
        },
        McpToolSpec {
            name: "goals_log_checkin",
            domain: "goals",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Log a progress/confidence check-in on a Yearly Goal.",
            schema: json!({
                "type": "object",
                "properties": {
                    "goal_id": { "type": "string", "format": "uuid" },
                    "confidence_score": { "type": "integer", "default": 80 },
                    "progress_snapshot": { "type": "number" },
                    "wins_md": { "type": "string" },
                    "blockers_md": { "type": "string" },
                    "next_steps_md": { "type": "string" }
                },
                "required": ["goal_id"]
            }),
        },
        McpToolSpec {
            name: "goals_update_kr_progress",
            domain: "goals",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Update a Key Result's current_value or milestones_json and recalculate parent Goal rollups.",
            schema: json!({
                "type": "object",
                "properties": {
                    "kr_id": { "type": "string", "format": "uuid" },
                    "current_value": { "type": "number" },
                    "milestones_json": { "type": "array" }
                },
                "required": ["kr_id"]
            }),
        },
        McpToolSpec {
            name: "goals_create_or_update",
            domain: "goals",
            tier: McpAutonomyTier::RequireApproval,
            description: "Create or update a Yearly Goal (requires operator approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "goal_id": { "type": "string", "format": "uuid" },
                    "year": { "type": "integer", "default": 2026 },
                    "pillar": { "type": "string" },
                    "title": { "type": "string" },
                    "why_motivation_md": { "type": "string" },
                    "status": { "type": "string" }
                },
                "required": ["title"]
            }),
        },
        McpToolSpec {
            name: "goals_delete",
            domain: "goals",
            tier: McpAutonomyTier::RequireApproval,
            description: "Delete a Yearly Goal and its Key Results (requires operator approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "goal_id": { "type": "string", "format": "uuid" }
                },
                "required": ["goal_id"]
            }),
        },
        // ---------------------------------------------------------------------
        // 5. courses (9 tools)
        // ---------------------------------------------------------------------
        McpToolSpec {
            name: "courses_list",
            domain: "courses",
            tier: McpAutonomyTier::Read,
            description: "List courses with optional status, provider, or goal_id filters.",
            schema: json!({
                "type": "object",
                "properties": {
                    "status": { "type": "string" },
                    "provider": { "type": "string" },
                    "goal_id": { "type": "string", "format": "uuid" }
                }
            }),
        },
        McpToolSpec {
            name: "courses_get_syllabus",
            domain: "courses",
            tier: McpAutonomyTier::Read,
            description: "Get a course's full 2-level module/lesson syllabus and velocity forecast.",
            schema: json!({
                "type": "object",
                "properties": {
                    "course_id": { "type": "string", "format": "uuid" }
                },
                "required": ["course_id"]
            }),
        },
        McpToolSpec {
            name: "courses_list_youtube_playlists",
            domain: "courses",
            tier: McpAutonomyTier::Read,
            description: "List candidate playlists from the read-only youtube-lists.sqlite crawler database.",
            schema: json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "courses_get_due_reviews",
            domain: "courses",
            tier: McpAutonomyTier::Read,
            description: "List due 7d/30d/90d spaced-repetition lesson reviews.",
            schema: json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "courses_update_lesson_status",
            domain: "courses",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Update a course lesson's completion status and key summary.",
            schema: json!({
                "type": "object",
                "properties": {
                    "lesson_id": { "type": "string", "format": "uuid" },
                    "status": { "type": "string", "enum": ["todo", "in_progress", "distilled", "completed"] },
                    "key_summary_md": { "type": "string" }
                },
                "required": ["lesson_id", "status"]
            }),
        },
        McpToolSpec {
            name: "courses_complete_review",
            domain: "courses",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Advance, snooze, or reset a spaced-repetition review stage on a lesson.",
            schema: json!({
                "type": "object",
                "properties": {
                    "lesson_id": { "type": "string", "format": "uuid" },
                    "action": { "type": "string", "enum": ["complete", "snooze", "again"] },
                    "rating": { "type": "string" },
                    "snooze_days": { "type": "integer" }
                },
                "required": ["lesson_id"]
            }),
        },
        McpToolSpec {
            name: "courses_spawn_lab_todo",
            domain: "courses",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Spawn a hands-on lab Todo task linked to a course and optional lesson.",
            schema: json!({
                "type": "object",
                "properties": {
                    "course_id": { "type": "string", "format": "uuid" },
                    "title": { "type": "string" },
                    "lesson_id": { "type": "string", "format": "uuid" },
                    "scheduled_date": { "type": "string" }
                },
                "required": ["course_id", "title"]
            }),
        },
        McpToolSpec {
            name: "courses_import_youtube_playlist",
            domain: "courses",
            tier: McpAutonomyTier::RequireApproval,
            description: "Import a YouTube playlist from youtube-lists.sqlite as a tracked Course (requires approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "playlist_id": { "type": "string" },
                    "goal_id": { "type": "string", "format": "uuid" },
                    "title_override": { "type": "string" }
                },
                "required": ["playlist_id"]
            }),
        },
        McpToolSpec {
            name: "courses_delete",
            domain: "courses",
            tier: McpAutonomyTier::RequireApproval,
            description: "Delete a course and its modules/lessons (requires operator approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "course_id": { "type": "string", "format": "uuid" }
                },
                "required": ["course_id"]
            }),
        },
        // ---------------------------------------------------------------------
        // 6. finance (9 tools — ALL writes require approval!)
        // ---------------------------------------------------------------------
        McpToolSpec {
            name: "finance_get_portfolio",
            domain: "finance",
            tier: McpAutonomyTier::Read,
            description: "List active portfolio holdings across BRL and USD markets.",
            schema: json!({
                "type": "object",
                "properties": {
                    "asset_class": { "type": "string" },
                    "currency": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "finance_get_watchlist",
            domain: "finance",
            tier: McpAutonomyTier::Read,
            description: "List watchlist assets not currently held in the portfolio.",
            schema: json!({
                "type": "object",
                "properties": {
                    "asset_class": { "type": "string" },
                    "currency": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "finance_get_rebalance_plan",
            domain: "finance",
            tier: McpAutonomyTier::Read,
            description: "Get the 200-tile Hare-Niemeyer Waffle allocation and buy-only rebalancing recommendations.",
            schema: json!({
                "type": "object",
                "properties": {
                    "base_currency": { "type": "string", "enum": ["BRL", "USD"] },
                    "new_contribution_cents": { "type": "integer" }
                }
            }),
        },
        McpToolSpec {
            name: "finance_get_fire_projection",
            domain: "finance",
            tier: McpAutonomyTier::Read,
            description: "Run or retrieve the Years-to-Retirement (FIRE) projection and trajectory.",
            schema: json!({
                "type": "object",
                "properties": {
                    "current_net_worth_brl_cents": { "type": "integer" },
                    "monthly_contribution_brl_cents": { "type": "integer" },
                    "monthly_retirement_spend_brl_cents": { "type": "integer" },
                    "expected_real_return_pct": { "type": "number" },
                    "safe_withdrawal_rate_pct": { "type": "number" }
                }
            }),
        },
        McpToolSpec {
            name: "finance_get_monthly_plan",
            domain: "finance",
            tier: McpAutonomyTier::Read,
            description: "Get the macro YYYY-MM Monthly Salary vs Planned/Actual Spend & Investment sheet.",
            schema: json!({
                "type": "object",
                "properties": {
                    "month": { "type": "string", "description": "YYYY-MM month key" }
                }
            }),
        },
        McpToolSpec {
            name: "finance_upsert_asset",
            domain: "finance",
            tier: McpAutonomyTier::RequireApproval,
            description: "Create or update a portfolio/watchlist asset (ALWAYS requires human approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "format": "uuid" },
                    "symbol": { "type": "string" },
                    "name": { "type": "string" },
                    "asset_class": { "type": "string" },
                    "currency": { "type": "string" },
                    "in_portfolio": { "type": "boolean" },
                    "quantity": { "type": "number" },
                    "avg_cost_cents": { "type": "integer" },
                    "current_price_cents": { "type": "integer" },
                    "target_weight_pct": { "type": "number" },
                    "thesis_md": { "type": "string" }
                },
                "required": ["symbol", "name", "asset_class"]
            }),
        },
        McpToolSpec {
            name: "finance_delete_asset",
            domain: "finance",
            tier: McpAutonomyTier::RequireApproval,
            description: "Delete a portfolio or watchlist asset (ALWAYS requires human approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "asset_id": { "type": "string", "format": "uuid" }
                },
                "required": ["asset_id"]
            }),
        },
        McpToolSpec {
            name: "finance_upsert_monthly_plan",
            domain: "finance",
            tier: McpAutonomyTier::RequireApproval,
            description: "Upsert the macro YYYY-MM Monthly Salary/Spend/Investment plan (ALWAYS requires human approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "month": { "type": "string" },
                    "currency": { "type": "string" },
                    "salary_income_cents": { "type": "integer" },
                    "planned_spend_cents": { "type": "integer" },
                    "actual_spend_cents": { "type": "integer" },
                    "planned_investment_cents": { "type": "integer" },
                    "actual_invested_cents": { "type": "integer" },
                    "notes_md": { "type": "string" }
                },
                "required": ["month"]
            }),
        },
        McpToolSpec {
            name: "finance_update_retirement_config",
            domain: "finance",
            tier: McpAutonomyTier::RequireApproval,
            description: "Update the singleton FIRE retirement configuration (ALWAYS requires human approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "expected_real_return_pct": { "type": "number" },
                    "safe_withdrawal_rate_pct": { "type": "number" },
                    "override_retirement_monthly_spend_cents": { "type": "integer" },
                    "current_age": { "type": "integer" }
                }
            }),
        },
        // ---------------------------------------------------------------------
        // 7. servers (5 tools)
        // ---------------------------------------------------------------------
        McpToolSpec {
            name: "servers_list",
            domain: "servers",
            tier: McpAutonomyTier::Read,
            description: "List all monitored server infrastructure nodes and their latency history.",
            schema: json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "servers_get_summary",
            domain: "servers",
            tier: McpAutonomyTier::Read,
            description: "Get aggregated server fleet health counts (online, degraded, offline) and average latency.",
            schema: json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "servers_probe_now",
            domain: "servers",
            tier: McpAutonomyTier::Read,
            description: "Run an immediate TCP/HTTP health probe on a specific server or all servers.",
            schema: json!({
                "type": "object",
                "properties": {
                    "server_id": { "type": "string", "format": "uuid" }
                }
            }),
        },
        McpToolSpec {
            name: "servers_create_or_update",
            domain: "servers",
            tier: McpAutonomyTier::ImmediateUndo,
            description: "Create or update a monitored server node with immediate undo support.",
            schema: json!({
                "type": "object",
                "properties": {
                    "server_id": { "type": "string", "format": "uuid" },
                    "name": { "type": "string" },
                    "host": { "type": "string" },
                    "port": { "type": "integer", "default": 22 },
                    "check_type": { "type": "string", "enum": ["tcp", "http"] },
                    "http_url": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["name", "host"]
            }),
        },
        McpToolSpec {
            name: "servers_delete",
            domain: "servers",
            tier: McpAutonomyTier::RequireApproval,
            description: "Delete a monitored server node (requires operator approval).",
            schema: json!({
                "type": "object",
                "properties": {
                    "server_id": { "type": "string", "format": "uuid" }
                },
                "required": ["server_id"]
            }),
        },
    ]
}

pub fn build_rmcp_tools() -> Vec<Tool> {
    mcp_tool_catalog()
        .into_iter()
        .map(|spec| {
            let schema_map: JsonObject =
                serde_json::from_value(spec.schema).unwrap_or_default();
            let is_read_only = spec.tier == McpAutonomyTier::Read;
            let is_destructive = spec.tier == McpAutonomyTier::RequireApproval;
            Tool::new(spec.name, spec.description, Arc::new(schema_map)).with_annotations(
                ToolAnnotations::new()
                    .read_only(is_read_only)
                    .destructive(is_destructive)
                    .idempotent(is_read_only),
            )
        })
        .collect()
}

fn parse_uuid_arg(args: &Value, keys: &[&str]) -> Result<Uuid, ApiError> {
    for key in keys {
        if let Some(raw) = args.get(*key).and_then(|v| v.as_str()) {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                return Uuid::parse_str(trimmed).map_err(|_| {
                    ApiError::bad_request(format!("Invalid UUID for field '{key}': {trimmed}"))
                });
            }
        }
    }
    Err(ApiError::bad_request(format!(
        "Missing required UUID argument (expected one of: {})",
        keys.join(", ")
    )))
}

fn parse_opt_uuid_arg(args: &Value, keys: &[&str]) -> Result<Option<Uuid>, ApiError> {
    for key in keys {
        if let Some(val) = args.get(*key) {
            if val.is_null() {
                continue;
            }
            if let Some(raw) = val.as_str() {
                let trimmed = raw.trim();
                if !trimmed.is_empty() {
                    let parsed = Uuid::parse_str(trimmed).map_err(|_| {
                        ApiError::bad_request(format!("Invalid UUID for field '{key}': {trimmed}"))
                    })?;
                    return Ok(Some(parsed));
                }
            }
        }
    }
    Ok(None)
}

fn parse_str_arg<'a>(args: &'a Value, keys: &[&str]) -> Result<&'a str, ApiError> {
    for key in keys {
        if let Some(s) = args.get(*key).and_then(|v| v.as_str()) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed);
            }
        }
    }
    Err(ApiError::bad_request(format!(
        "Missing required string argument (expected one of: {})",
        keys.join(", ")
    )))
}

fn parse_opt_date_arg(args: &Value, key: &str) -> Result<Option<NaiveDate>, ApiError> {
    let Some(raw) = args.get(key).and_then(|v| v.as_str()) else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map(Some)
        .map_err(|_| ApiError::bad_request(format!("Invalid YYYY-MM-DD date for '{key}': {trimmed}")))
}

fn parse_skill_policy_mode(val: &Value) -> Option<SkillPolicyMode> {
    let s = val.as_str()?.trim().to_ascii_uppercase();
    match s.as_str() {
        "READ" => Some(SkillPolicyMode::Read),
        "APPROVE" | "REQUIRE_APPROVAL" => Some(SkillPolicyMode::Approve),
        "AUTO" | "IMMEDIATE_UNDO" => Some(SkillPolicyMode::Auto),
        _ => None,
    }
}

fn resolve_knight_policy_for_tool(
    tool_name: &str,
    domain: &str,
    policy_val: &Value,
) -> Result<Option<SkillPolicyMode>, ApiError> {
    if policy_val.is_null() {
        return Ok(None);
    }
    if let Some(mode) = parse_skill_policy_mode(policy_val) {
        return Ok(Some(mode));
    }
    let Some(map) = policy_val.as_object() else {
        return Ok(None);
    };
    if map.is_empty() {
        return Ok(None);
    }

    let dot_name = tool_name.replacen('_', ".", 1);
    let domain_dot_star = format!("{domain}.*");
    let domain_under_star = format!("{domain}_*");

    for candidate in [
        tool_name,
        dot_name.as_str(),
        domain_dot_star.as_str(),
        domain_under_star.as_str(),
        domain,
        "*",
    ] {
        if let Some(v) = map.get(candidate) {
            if let Some(mode) = parse_skill_policy_mode(v) {
                return Ok(Some(mode));
            }
        }
    }

    Err(ApiError::forbidden(format!(
        "Knight tools_policy does not authorize tool '{tool_name}'"
    )))
}

pub fn evaluate_effective_autonomy_tier(
    spec: &McpToolSpec,
    args: &Value,
    ctx: &McpCallContext,
) -> Result<McpAutonomyTier, ApiError> {
    // 1. Check explicit allowed_tools whitelist if present
    if let Some(ref allowed) = ctx.allowed_tools {
        let domain_dot_star = format!("{}.*", spec.domain);
        let domain_under_star = format!("{}_*", spec.domain);
        let permitted = allowed.iter().any(|pattern| {
            let p = pattern.trim();
            p == "*"
                || p == spec.name
                || p == spec.domain
                || p == domain_dot_star
                || p == domain_under_star
                || p == spec.name.replacen('_', ".", 1)
        });
        if !permitted {
            return Err(ApiError::forbidden(format!(
                "Knight is not authorized to invoke tool '{}'",
                spec.name
            )));
        }
    }

    // 2. Determine intrinsic tier (with dynamic widget escalation for dashboards_add_widget)
    let mut intrinsic_tier = spec.tier;
    if spec.name == "dashboards_add_widget" {
        if let Some(sk_str) = args.get("source_kind").and_then(|v| v.as_str()) {
            if let Ok(sk) = serde_json::from_value::<WidgetSourceKind>(Value::String(sk_str.to_string())) {
                if widget_requires_mcp_approval(&sk) {
                    intrinsic_tier = McpAutonomyTier::RequireApproval;
                }
            }
        }
    }

    // 3. If operator explicitly approved this action via `approve_mcp_action`, execute via ImmediateUndo
    if ctx.bypass_approval_gate {
        return Ok(if intrinsic_tier == McpAutonomyTier::Read {
            McpAutonomyTier::Read
        } else {
            McpAutonomyTier::ImmediateUndo
        });
    }

    // 4. Evaluate Knight tools_policy override if present
    if let Some(ref policy_val) = ctx.knight_policy {
        if let Some(mode) = resolve_knight_policy_for_tool(spec.name, spec.domain, policy_val)? {
            if intrinsic_tier == McpAutonomyTier::Read {
                return Ok(McpAutonomyTier::Read);
            }
            if mode == SkillPolicyMode::Read {
                return Err(ApiError::forbidden(format!(
                    "Knight policy is READ-only for tool '{}'",
                    spec.name
                )));
            }
            // HARD INVARIANT: All finance_* writes ALWAYS require human approval, even under AUTO!
            if spec.domain == "finance" {
                return Ok(McpAutonomyTier::RequireApproval);
            }
            return match mode {
                SkillPolicyMode::Read => Err(ApiError::forbidden(format!(
                    "Knight policy is READ-only for tool '{}'",
                    spec.name
                ))),
                SkillPolicyMode::Approve => Ok(McpAutonomyTier::RequireApproval),
                SkillPolicyMode::Auto => {
                    if matches!(
                        spec.name,
                        "dashboards_configure_command_widget" | "dashboards_configure_sql_widget"
                    ) {
                        Ok(McpAutonomyTier::RequireApproval)
                    } else {
                        Ok(McpAutonomyTier::ImmediateUndo)
                    }
                }
            };
        }
    }

    // 5. Enforce Finance Write-Gate invariant on standard calls
    if spec.domain == "finance" && intrinsic_tier != McpAutonomyTier::Read {
        return Ok(McpAutonomyTier::RequireApproval);
    }

    Ok(intrinsic_tier)
}

impl IntelligenceService {
    pub fn list_mcp_tool_specs(&self) -> Vec<McpToolSpec> {
        mcp_tool_catalog()
    }

    pub async fn execute_mcp_tool_with_autonomy(
        &self,
        tool_name: &str,
        arguments: Value,
        ctx: McpCallContext,
    ) -> Result<McpToolExecutionOutcome, ApiError> {
        let catalog = mcp_tool_catalog();
        let spec = catalog
            .iter()
            .find(|t| t.name == tool_name)
            .ok_or_else(|| ApiError::not_found(format!("Unknown MCP tool '{tool_name}'")))?;

        let args = if arguments.is_null() {
            json!({})
        } else {
            arguments
        };

        let effective_tier = evaluate_effective_autonomy_tier(spec, &args, &ctx)?;

        match effective_tier {
            McpAutonomyTier::Read => {
                let result = self.execute_read_tool(spec.name, &args).await?;
                Ok(McpToolExecutionOutcome::ExecutedRead {
                    tool_name: spec.name.to_string(),
                    autonomy_tier: McpAutonomyTier::Read,
                    result,
                })
            }
            McpAutonomyTier::ImmediateUndo => {
                let mutation = self.execute_mutating_tool_with_snapshot(spec.name, &args).await?;
                let undo_id = new_uuid_v7();
                let now = Utc::now();
                let expires_at = now + ChronoDuration::minutes(MCP_UNDO_TTL_MINUTES);
                let session_key = if ctx.session_key.trim().is_empty() {
                    "mcp-direct".to_string()
                } else {
                    ctx.session_key.clone()
                };

                let undo_action: McpUndoAction = sqlx::query_as(
                    "INSERT INTO mcp_undo_actions \
                        (id, session_key, tool_name, entity_table, entity_id, undo_kind, undo_payload, expires_at, created_at) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
                     RETURNING id, session_key, tool_name, entity_table, entity_id, undo_kind, undo_payload, undone_at, expires_at, created_at",
                )
                .bind(undo_id)
                .bind(&session_key)
                .bind(spec.name)
                .bind(&mutation.entity_table)
                .bind(&mutation.entity_id)
                .bind(&mutation.undo_kind)
                .bind(&mutation.undo_payload)
                .bind(expires_at)
                .bind(now)
                .fetch_one(&self.pool)
                .await?;

                self.emit_event(SystemEvent::McpUndoAvailable {
                    undo_id: undo_action.id,
                    session_key,
                    tool_name: spec.name.to_string(),
                    timestamp: now,
                });

                Ok(McpToolExecutionOutcome::ExecutedWithUndo {
                    tool_name: spec.name.to_string(),
                    autonomy_tier: McpAutonomyTier::ImmediateUndo,
                    undo_action,
                    result: mutation.result,
                })
            }
            McpAutonomyTier::RequireApproval => {
                // Pre-validate arguments before queueing approval
                self.prevalidate_approval_tool_args(spec.name, &args).await?;

                let approval_id = new_uuid_v7();
                let now = Utc::now();
                let session_key = if ctx.session_key.trim().is_empty() {
                    "mcp-direct".to_string()
                } else {
                    ctx.session_key.clone()
                };

                let approval: PendingMcpApproval = sqlx::query_as(
                    "INSERT INTO pending_mcp_approvals \
                        (id, session_key, agent_run_id, tool_name, payload_json, status, created_at) \
                     VALUES ($1, $2, $3, $4, $5, 'pending', $6) \
                     RETURNING id, session_key, agent_run_id, tool_name, payload_json, status, result_json, created_at, resolved_at",
                )
                .bind(approval_id)
                .bind(&session_key)
                .bind(ctx.agent_run_id)
                .bind(spec.name)
                .bind(&args)
                .bind(now)
                .fetch_one(&self.pool)
                .await?;

                self.emit_event(SystemEvent::McpApprovalRequired {
                    approval_id: approval.id,
                    session_key,
                    tool_name: spec.name.to_string(),
                    timestamp: now,
                });

                Ok(McpToolExecutionOutcome::PendingApproval {
                    tool_name: spec.name.to_string(),
                    autonomy_tier: McpAutonomyTier::RequireApproval,
                    approval,
                })
            }
        }
    }

    async fn prevalidate_approval_tool_args(
        &self,
        tool_name: &str,
        args: &Value,
    ) -> Result<(), ApiError> {
        match tool_name {
            "dashboards_configure_sql_widget" => {
                let query = parse_str_arg(args, &["query", "sql"])?;
                validate_custom_sql_query(query)?;
                let _ = parse_uuid_arg(args, &["dashboard_id", "id"])?;
            }
            "dashboards_configure_command_widget" => {
                let _ = parse_str_arg(args, &["command", "cmd"])?;
                let _ = parse_uuid_arg(args, &["dashboard_id", "id"])?;
            }
            "dashboards_delete" => {
                let _ = parse_uuid_arg(args, &["dashboard_id", "id"])?;
            }
            "todos_delete_task" => {
                let _ = parse_uuid_arg(args, &["task_id", "id"])?;
            }
            "todos_delete_project" => {
                let _ = parse_uuid_arg(args, &["project_id", "id"])?;
            }
            "routines_delete" => {
                let _ = parse_uuid_arg(args, &["routine_id", "id"])?;
            }
            "goals_delete" => {
                let _ = parse_uuid_arg(args, &["goal_id", "id"])?;
            }
            "courses_delete" => {
                let _ = parse_uuid_arg(args, &["course_id", "id"])?;
            }
            "finance_delete_asset" => {
                let _ = parse_uuid_arg(args, &["asset_id", "id"])?;
            }
            "finance_upsert_monthly_plan" => {
                let month = parse_str_arg(args, &["month"])?;
                if month.len() != 7
                    || month.as_bytes().get(4) != Some(&b'-')
                    || !month[..4].chars().all(|c| c.is_ascii_digit())
                    || !month[5..]
                        .parse::<u32>()
                        .is_ok_and(|m| (1..=12).contains(&m))
                {
                    return Err(ApiError::bad_request(
                        "month must be formatted as YYYY-MM",
                    ));
                }
            }
            "servers_delete" => {
                let _ = parse_uuid_arg(args, &["server_id", "id"])?;
            }
            _ => {}
        }
        Ok(())
    }

    async fn execute_read_tool(&self, tool_name: &str, args: &Value) -> Result<Value, ApiError> {
        let svc = &self.life_ops;
        match tool_name {
            // Dashboards READ
            "dashboards_list" => {
                let res = svc.list_dashboards().await?;
                Ok(serde_json::to_value(res)?)
            }
            "dashboards_get" => {
                let id_or_slug = args
                    .get("id_or_slug")
                    .or_else(|| args.get("id"))
                    .or_else(|| args.get("slug"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("tactical-ops");
                let res = svc.get_dashboard(id_or_slug).await?;
                Ok(serde_json::to_value(res)?)
            }
            "dashboards_get_life_score" => {
                let res = svc.compute_life_score().await?;
                Ok(serde_json::to_value(res)?)
            }
            // Todos READ
            "todos_list_tasks" => {
                let filter: TaskListFilter =
                    serde_json::from_value(args.clone()).unwrap_or_default();
                let res = svc.list_tasks(filter).await?;
                Ok(serde_json::to_value(res)?)
            }
            "todos_get_task" => {
                let id = parse_uuid_arg(args, &["task_id", "id"])?;
                let res = svc.get_task(id).await?;
                Ok(serde_json::to_value(res)?)
            }
            "todos_list_projects" => {
                let res = svc.list_projects().await?;
                Ok(serde_json::to_value(res)?)
            }
            "todos_get_active_timer" => {
                let res = svc.get_active_timer().await?;
                Ok(serde_json::to_value(res)?)
            }
            // Routines READ
            "routines_list" => {
                let day_profile = args
                    .get("day_profile")
                    .and_then(|v| serde_json::from_value::<DayProfile>(v.clone()).ok());
                let log_date = parse_opt_date_arg(args, "log_date")?;
                let res = svc.list_routines(day_profile, log_date).await?;
                Ok(serde_json::to_value(res)?)
            }
            "routines_get_today" => {
                let day_profile = args
                    .get("day_profile")
                    .and_then(|v| serde_json::from_value::<DayProfile>(v.clone()).ok());
                let res = svc
                    .list_routines(day_profile, Some(Utc::now().date_naive()))
                    .await?;
                Ok(serde_json::to_value(res)?)
            }
            "routines_get_streaks" => {
                let res = svc.get_routines_analytics().await?;
                Ok(serde_json::to_value(res)?)
            }
            "routines_get_checkin" => {
                let date = parse_opt_date_arg(args, "log_date")?
                    .or_else(|| parse_opt_date_arg(args, "date").ok().flatten())
                    .unwrap_or_else(|| Utc::now().date_naive());
                let res = svc.get_checkin(date).await?;
                Ok(serde_json::to_value(res)?)
            }
            // Goals READ
            "goals_list" => {
                let year = args.get("year").and_then(|v| v.as_i64()).map(|y| y as i32);
                let pillar = args
                    .get("pillar")
                    .and_then(|v| serde_json::from_value::<GoalPillar>(v.clone()).ok());
                let status = args
                    .get("status")
                    .and_then(|v| serde_json::from_value::<GoalStatus>(v.clone()).ok());
                let res = svc.list_goals(year, pillar, status).await?;
                Ok(serde_json::to_value(res)?)
            }
            "goals_get_blueprint" => {
                let year = args
                    .get("year")
                    .and_then(|v| v.as_i64())
                    .map(|y| y as i32)
                    .unwrap_or(2026);
                let res = svc.get_goal_blueprint(year).await?;
                Ok(serde_json::to_value(res)?)
            }
            "goals_get_pace_drift" => {
                let year = args.get("year").and_then(|v| v.as_i64()).map(|y| y as i32);
                let res = svc.get_goals_pace_drift(year).await?;
                Ok(serde_json::to_value(res)?)
            }
            // Courses READ
            "courses_list" => {
                let status = args
                    .get("status")
                    .and_then(|v| serde_json::from_value::<CourseStatus>(v.clone()).ok());
                let provider = args
                    .get("provider")
                    .and_then(|v| serde_json::from_value::<CourseProvider>(v.clone()).ok());
                let goal_id = parse_opt_uuid_arg(args, &["goal_id"])?;
                let res = svc.list_courses(status, provider, goal_id).await?;
                Ok(serde_json::to_value(res)?)
            }
            "courses_get_syllabus" => {
                let id = parse_uuid_arg(args, &["course_id", "id"])?;
                let res = svc.get_course(id).await?;
                Ok(serde_json::to_value(res)?)
            }
            "courses_list_youtube_playlists" => {
                let res = svc.list_youtube_playlists().await?;
                Ok(serde_json::to_value(res)?)
            }
            "courses_get_due_reviews" => {
                let res = svc.list_due_spaced_reviews().await?;
                Ok(serde_json::to_value(res)?)
            }
            // Finance READ
            "finance_get_portfolio" => {
                let asset_class = args
                    .get("asset_class")
                    .and_then(|v| serde_json::from_value::<AssetClass>(v.clone()).ok());
                let currency = args
                    .get("currency")
                    .and_then(|v| serde_json::from_value::<CurrencyCode>(v.clone()).ok());
                let res = svc
                    .list_assets(AssetListFilter {
                        in_portfolio: Some(true),
                        is_watchlist: None,
                        asset_class,
                        currency,
                    })
                    .await?;
                Ok(serde_json::to_value(res)?)
            }
            "finance_get_watchlist" => {
                let asset_class = args
                    .get("asset_class")
                    .and_then(|v| serde_json::from_value::<AssetClass>(v.clone()).ok());
                let currency = args
                    .get("currency")
                    .and_then(|v| serde_json::from_value::<CurrencyCode>(v.clone()).ok());
                let res = svc
                    .list_assets(AssetListFilter {
                        in_portfolio: Some(false),
                        is_watchlist: Some(true),
                        asset_class,
                        currency,
                    })
                    .await?;
                Ok(serde_json::to_value(res)?)
            }
            "finance_get_rebalance_plan" => {
                let base_currency = args
                    .get("base_currency")
                    .and_then(|v| serde_json::from_value::<CurrencyCode>(v.clone()).ok());
                let new_contribution_cents = args
                    .get("new_contribution_cents")
                    .or_else(|| args.get("contribution_cents"))
                    .and_then(|v| v.as_i64());
                let res = svc
                    .get_portfolio_allocation(base_currency, new_contribution_cents)
                    .await?;
                Ok(serde_json::to_value(res)?)
            }
            "finance_get_fire_projection" => {
                let req: FireSimulationRequest =
                    serde_json::from_value(args.clone()).unwrap_or_default();
                let res = svc.simulate_retirement(req).await?;
                Ok(serde_json::to_value(res)?)
            }
            "finance_get_monthly_plan" => {
                if let Some(month) = args.get("month").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()) {
                    let res = svc.get_monthly_plan(month.trim()).await?;
                    Ok(serde_json::to_value(res)?)
                } else {
                    let plans = svc.list_monthly_plans(Some(1)).await?;
                    if let Some(first) = plans.into_iter().next() {
                        Ok(serde_json::to_value(first)?)
                    } else {
                        let current_month = Utc::now().format("%Y-%m").to_string();
                        let res = svc.get_monthly_plan(&current_month).await?;
                        Ok(serde_json::to_value(res)?)
                    }
                }
            }
            // Servers READ
            "servers_list" => {
                let res = svc.list_servers().await?;
                Ok(serde_json::to_value(res)?)
            }
            "servers_get_summary" => {
                let res = svc.get_servers_summary().await?;
                Ok(serde_json::to_value(res)?)
            }
            "servers_probe_now" => {
                if let Some(server_id) = parse_opt_uuid_arg(args, &["server_id", "id"])? {
                    let res = svc.check_server(server_id).await?;
                    Ok(serde_json::to_value(res)?)
                } else {
                    let res = svc.check_all_servers().await?;
                    Ok(serde_json::to_value(res)?)
                }
            }
            other => Err(ApiError::not_found(format!(
                "Tool '{other}' is not a READ tool"
            ))),
        }
    }

    async fn execute_mutating_tool_with_snapshot(
        &self,
        tool_name: &str,
        args: &Value,
    ) -> Result<MutationRecord, ApiError> {
        let svc = &self.life_ops;

        match tool_name {
            // =================================================================
            // 1. dashboards mutations
            // =================================================================
            "dashboards_create" => {
                let req: CreateDashboardRequest = serde_json::from_value(args.clone())?;
                let created = svc.create_dashboard(req).await?;
                let id = created.dashboard.id;
                Ok(MutationRecord {
                    entity_table: Some("dashboards".to_string()),
                    entity_id: Some(id.to_string()),
                    undo_kind: "delete_created_dashboard".to_string(),
                    undo_payload: json!({ "dashboard_id": id }),
                    result: serde_json::to_value(created)?,
                })
            }
            "dashboards_switch_deck" => {
                let id_or_slug = parse_str_arg(args, &["id_or_slug", "dashboard_id", "id", "slug"])?;
                let all_before = svc.list_dashboards().await?;
                let prev_ids: Vec<Uuid> = all_before.iter().map(|d| d.dashboard.id).collect();
                let target = svc.get_dashboard(id_or_slug).await?;
                let target_id = target.dashboard.id;

                let mut new_order = vec![target_id];
                for id in &prev_ids {
                    if *id != target_id {
                        new_order.push(*id);
                    }
                }
                if !target.dashboard.in_rotation {
                    svc.update_dashboard(
                        target_id,
                        UpdateDashboardRequest {
                            in_rotation: Some(true),
                            ..Default::default()
                        },
                    )
                    .await?;
                }
                let reordered = svc
                    .reorder_dashboards(ReorderDashboardsRequest {
                        dashboard_ids: new_order,
                    })
                    .await?;
                Ok(MutationRecord {
                    entity_table: Some("dashboards".to_string()),
                    entity_id: Some(target_id.to_string()),
                    undo_kind: "restore_dashboard_order".to_string(),
                    undo_payload: json!({
                        "previous_order": prev_ids,
                        "target_id": target_id,
                        "previous_in_rotation": target.dashboard.in_rotation
                    }),
                    result: serde_json::to_value(reordered)?,
                })
            }
            "dashboards_add_widget" => {
                let dashboard_id = parse_uuid_arg(args, &["dashboard_id", "id"])?;
                let title = args
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("New Widget")
                    .to_string();
                let source_kind = args
                    .get("source_kind")
                    .and_then(|v| serde_json::from_value::<WidgetSourceKind>(v.clone()).ok())
                    .unwrap_or(WidgetSourceKind::Builtin);
                let renderer_kind = args
                    .get("renderer_kind")
                    .and_then(|v| serde_json::from_value::<WidgetRendererKind>(v.clone()).ok())
                    .unwrap_or(WidgetRendererKind::Kpi);
                let grid_rect = args
                    .get("grid_rect")
                    .and_then(|v| serde_json::from_value::<GridRect>(v.clone()).ok())
                    .unwrap_or_default();
                let source_config = args
                    .get("source_config")
                    .cloned()
                    .unwrap_or_else(|| json!({"builtin_key": "life_score"}));
                let refresh_interval_seconds = args
                    .get("refresh_interval_seconds")
                    .and_then(|v| v.as_i64())
                    .map(|n| n as i32)
                    .unwrap_or(60);

                let widget = svc
                    .create_widget(
                        dashboard_id,
                        CreateWidgetRequest {
                            title,
                            source_kind,
                            renderer_kind,
                            grid_rect,
                            source_config,
                            refresh_interval_seconds,
                            sort_order: None,
                        },
                    )
                    .await?;
                Ok(MutationRecord {
                    entity_table: Some("dashboard_widgets".to_string()),
                    entity_id: Some(widget.id.to_string()),
                    undo_kind: "delete_created_widget".to_string(),
                    undo_payload: json!({
                        "dashboard_id": widget.dashboard_id,
                        "widget_id": widget.id
                    }),
                    result: serde_json::to_value(widget)?,
                })
            }
            "dashboards_update_layout" => {
                let dashboard_id = parse_uuid_arg(args, &["dashboard_id", "id"])?;
                let snapshot = svc.get_dashboard(&dashboard_id.to_string()).await?;

                let upd_req = UpdateDashboardRequest {
                    slug: args.get("slug").and_then(|v| v.as_str()).map(str::to_string),
                    title: args.get("title").and_then(|v| v.as_str()).map(str::to_string),
                    cycle_seconds: args.get("cycle_seconds").and_then(|v| v.as_i64()).map(|n| n as i32),
                    in_rotation: args.get("in_rotation").and_then(|v| v.as_bool()),
                    sort_order: args.get("sort_order").and_then(|v| v.as_i64()).map(|n| n as i32),
                    layout_cols: args.get("layout_cols").and_then(|v| v.as_i64()).map(|n| n as i32),
                    layout_rows: args.get("layout_rows").and_then(|v| v.as_i64()).map(|n| n as i32),
                };
                if upd_req != UpdateDashboardRequest::default() {
                    svc.update_dashboard(dashboard_id, upd_req).await?;
                }

                if let Some(widget_id) = parse_opt_uuid_arg(args, &["widget_id"])? {
                    let grid_rect = args
                        .get("grid_rect")
                        .and_then(|v| serde_json::from_value::<GridRect>(v.clone()).ok());
                    svc.update_widget(
                        dashboard_id,
                        widget_id,
                        UpdateWidgetRequest {
                            grid_rect,
                            ..Default::default()
                        },
                    )
                    .await?;
                }

                let updated = svc.get_dashboard(&dashboard_id.to_string()).await?;
                Ok(MutationRecord {
                    entity_table: Some("dashboards".to_string()),
                    entity_id: Some(dashboard_id.to_string()),
                    undo_kind: "restore_dashboard_snapshot".to_string(),
                    undo_payload: serde_json::to_value(&snapshot)?,
                    result: serde_json::to_value(updated)?,
                })
            }
            "dashboards_delete" => {
                let dashboard_id = parse_uuid_arg(args, &["dashboard_id", "id"])?;
                let snapshot = svc.get_dashboard(&dashboard_id.to_string()).await?;
                svc.delete_dashboard(dashboard_id).await?;
                Ok(MutationRecord {
                    entity_table: Some("dashboards".to_string()),
                    entity_id: Some(dashboard_id.to_string()),
                    undo_kind: "restore_deleted_dashboard".to_string(),
                    undo_payload: serde_json::to_value(&snapshot)?,
                    result: json!({ "deleted": true, "dashboard_id": dashboard_id }),
                })
            }
            "dashboards_configure_command_widget" => {
                let dashboard_id = parse_uuid_arg(args, &["dashboard_id", "id"])?;
                let command = parse_str_arg(args, &["command", "cmd"])?.to_string();
                let title = args
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Command Telemetry")
                    .to_string();
                let grid_rect = args
                    .get("grid_rect")
                    .and_then(|v| serde_json::from_value::<GridRect>(v.clone()).ok())
                    .unwrap_or_default();
                let refresh_interval_seconds = args
                    .get("refresh_interval_seconds")
                    .and_then(|v| v.as_i64())
                    .map(|n| n as i32)
                    .unwrap_or(60);

                if let Some(widget_id) = parse_opt_uuid_arg(args, &["widget_id"])? {
                    let deck = svc.get_dashboard(&dashboard_id.to_string()).await?;
                    let prev_widget = deck
                        .widgets
                        .into_iter()
                        .find(|w| w.id == widget_id)
                        .ok_or_else(|| ApiError::not_found("Widget not found on dashboard"))?;
                    let updated = svc
                        .update_widget(
                            dashboard_id,
                            widget_id,
                            UpdateWidgetRequest {
                                title: Some(title),
                                source_kind: Some(WidgetSourceKind::Command),
                                renderer_kind: Some(WidgetRendererKind::Terminal),
                                grid_rect: Some(grid_rect),
                                source_config: Some(json!({ "command": command })),
                                refresh_interval_seconds: Some(refresh_interval_seconds),
                                sort_order: None,
                            },
                        )
                        .await?;
                    Ok(MutationRecord {
                        entity_table: Some("dashboard_widgets".to_string()),
                        entity_id: Some(widget_id.to_string()),
                        undo_kind: "restore_widget_snapshot".to_string(),
                        undo_payload: serde_json::to_value(&prev_widget)?,
                        result: serde_json::to_value(updated)?,
                    })
                } else {
                    let created = svc
                        .create_widget(
                            dashboard_id,
                            CreateWidgetRequest {
                                title,
                                source_kind: WidgetSourceKind::Command,
                                renderer_kind: WidgetRendererKind::Terminal,
                                grid_rect,
                                source_config: json!({ "command": command }),
                                refresh_interval_seconds,
                                sort_order: None,
                            },
                        )
                        .await?;
                    Ok(MutationRecord {
                        entity_table: Some("dashboard_widgets".to_string()),
                        entity_id: Some(created.id.to_string()),
                        undo_kind: "delete_created_widget".to_string(),
                        undo_payload: json!({
                            "dashboard_id": created.dashboard_id,
                            "widget_id": created.id
                        }),
                        result: serde_json::to_value(created)?,
                    })
                }
            }
            "dashboards_configure_sql_widget" => {
                let dashboard_id = parse_uuid_arg(args, &["dashboard_id", "id"])?;
                let query = parse_str_arg(args, &["query", "sql"])?;
                let validated_sql = validate_custom_sql_query(query)?;
                let title = args
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("SQL Telemetry")
                    .to_string();
                let grid_rect = args
                    .get("grid_rect")
                    .and_then(|v| serde_json::from_value::<GridRect>(v.clone()).ok())
                    .unwrap_or_default();
                let refresh_interval_seconds = args
                    .get("refresh_interval_seconds")
                    .and_then(|v| v.as_i64())
                    .map(|n| n as i32)
                    .unwrap_or(60);

                if let Some(widget_id) = parse_opt_uuid_arg(args, &["widget_id"])? {
                    let deck = svc.get_dashboard(&dashboard_id.to_string()).await?;
                    let prev_widget = deck
                        .widgets
                        .into_iter()
                        .find(|w| w.id == widget_id)
                        .ok_or_else(|| ApiError::not_found("Widget not found on dashboard"))?;
                    let updated = svc
                        .update_widget(
                            dashboard_id,
                            widget_id,
                            UpdateWidgetRequest {
                                title: Some(title),
                                source_kind: Some(WidgetSourceKind::Sql),
                                renderer_kind: Some(WidgetRendererKind::Table),
                                grid_rect: Some(grid_rect),
                                source_config: Some(json!({ "query": validated_sql })),
                                refresh_interval_seconds: Some(refresh_interval_seconds),
                                sort_order: None,
                            },
                        )
                        .await?;
                    Ok(MutationRecord {
                        entity_table: Some("dashboard_widgets".to_string()),
                        entity_id: Some(widget_id.to_string()),
                        undo_kind: "restore_widget_snapshot".to_string(),
                        undo_payload: serde_json::to_value(&prev_widget)?,
                        result: serde_json::to_value(updated)?,
                    })
                } else {
                    let created = svc
                        .create_widget(
                            dashboard_id,
                            CreateWidgetRequest {
                                title,
                                source_kind: WidgetSourceKind::Sql,
                                renderer_kind: WidgetRendererKind::Table,
                                grid_rect,
                                source_config: json!({ "query": validated_sql }),
                                refresh_interval_seconds,
                                sort_order: None,
                            },
                        )
                        .await?;
                    Ok(MutationRecord {
                        entity_table: Some("dashboard_widgets".to_string()),
                        entity_id: Some(created.id.to_string()),
                        undo_kind: "delete_created_widget".to_string(),
                        undo_payload: json!({
                            "dashboard_id": created.dashboard_id,
                            "widget_id": created.id
                        }),
                        result: serde_json::to_value(created)?,
                    })
                }
            }

            // =================================================================
            // 2. todos mutations
            // =================================================================
            "todos_create_task" => {
                let req: CreateTaskRequest = serde_json::from_value(args.clone())?;
                let task = svc.create_task(req).await?;
                Ok(MutationRecord {
                    entity_table: Some("tasks".to_string()),
                    entity_id: Some(task.id.to_string()),
                    undo_kind: "delete_created_task".to_string(),
                    undo_payload: json!({ "task_id": task.id }),
                    result: serde_json::to_value(task)?,
                })
            }
            "todos_complete_task" => {
                let task_id = parse_uuid_arg(args, &["task_id", "id"])?;
                let prev = svc.get_task(task_id).await?;
                let completed = svc.complete_task(task_id).await?;
                Ok(MutationRecord {
                    entity_table: Some("tasks".to_string()),
                    entity_id: Some(task_id.to_string()),
                    undo_kind: "restore_task_snapshot".to_string(),
                    undo_payload: serde_json::to_value(&prev)?,
                    result: serde_json::to_value(completed)?,
                })
            }
            "todos_update_task" => {
                let task_id = parse_uuid_arg(args, &["task_id", "id"])?;
                let prev = svc.get_task(task_id).await?;
                let req: UpdateTaskRequest = serde_json::from_value(args.clone())?;
                let updated = svc.update_task(task_id, req).await?;
                Ok(MutationRecord {
                    entity_table: Some("tasks".to_string()),
                    entity_id: Some(task_id.to_string()),
                    undo_kind: "restore_task_snapshot".to_string(),
                    undo_payload: serde_json::to_value(&prev)?,
                    result: serde_json::to_value(updated)?,
                })
            }
            "todos_start_timer" => {
                let prev_active = svc.get_active_timer().await?;
                let req: StartTimerRequest = serde_json::from_value(args.clone()).unwrap_or_default();
                let started = svc.start_timer(req).await?;
                let started_id = started.session.as_ref().map(|s| s.id);
                Ok(MutationRecord {
                    entity_table: Some("time_sessions".to_string()),
                    entity_id: started_id.map(|id| id.to_string()),
                    undo_kind: "discard_started_timer".to_string(),
                    undo_payload: json!({
                        "started_session_id": started_id,
                        "prev_active_session": prev_active.session
                    }),
                    result: serde_json::to_value(started)?,
                })
            }
            "todos_stop_timer" => {
                let req: StopTimerRequest = serde_json::from_value(args.clone()).unwrap_or_default();
                let stopped = svc.stop_timer(req).await?;
                Ok(MutationRecord {
                    entity_table: Some("time_sessions".to_string()),
                    entity_id: Some(stopped.id.to_string()),
                    undo_kind: "reopen_stopped_timer".to_string(),
                    undo_payload: serde_json::to_value(&stopped)?,
                    result: serde_json::to_value(stopped)?,
                })
            }
            "todos_delete_task" => {
                let task_id = parse_uuid_arg(args, &["task_id", "id"])?;
                let prev = svc.get_task(task_id).await?;
                svc.delete_task(task_id).await?;
                Ok(MutationRecord {
                    entity_table: Some("tasks".to_string()),
                    entity_id: Some(task_id.to_string()),
                    undo_kind: "restore_task_snapshot".to_string(),
                    undo_payload: serde_json::to_value(&prev)?,
                    result: json!({ "deleted": true, "task_id": task_id }),
                })
            }
            "todos_bulk_update_tasks" => {
                let req: BulkUpdateTasksRequest = serde_json::from_value(args.clone())?;
                let mut prev_tasks = Vec::new();
                for tid in &req.task_ids {
                    if let Ok(t) = svc.get_task(*tid).await {
                        prev_tasks.push(t);
                    }
                }
                let updated = svc.bulk_update_tasks(req).await?;
                Ok(MutationRecord {
                    entity_table: Some("tasks".to_string()),
                    entity_id: Some("bulk".to_string()),
                    undo_kind: "restore_tasks_bulk".to_string(),
                    undo_payload: serde_json::to_value(&prev_tasks)?,
                    result: serde_json::to_value(updated)?,
                })
            }
            "todos_delete_project" => {
                let project_id = parse_uuid_arg(args, &["project_id", "id"])?;
                let prev_project = svc.get_project(project_id).await?;
                let linked_task_ids: Vec<Uuid> = sqlx::query_scalar(
                    "SELECT id FROM tasks WHERE project_id = $1 AND deleted_at IS NULL",
                )
                .bind(project_id)
                .fetch_all(&self.pool)
                .await?;
                svc.delete_project(project_id).await?;
                Ok(MutationRecord {
                    entity_table: Some("projects".to_string()),
                    entity_id: Some(project_id.to_string()),
                    undo_kind: "restore_deleted_project".to_string(),
                    undo_payload: json!({
                        "project": prev_project,
                        "task_ids": linked_task_ids
                    }),
                    result: json!({ "deleted": true, "project_id": project_id }),
                })
            }

            // =================================================================
            // 3. routines mutations
            // =================================================================
            "routines_log_item" => {
                let routine_item_id = parse_uuid_arg(args, &["routine_item_id", "item_id", "id"])?;
                let log_date = parse_opt_date_arg(args, "log_date")?
                    .unwrap_or_else(|| Utc::now().date_naive());
                let status = args
                    .get("status")
                    .and_then(|v| serde_json::from_value::< hermes_domain::routines::RoutineLogStatus>(v.clone()).ok())
                    .unwrap_or(hermes_domain::routines::RoutineLogStatus::Completed);
                let numeric_value = args
                    .get("numeric_value")
                    .and_then(|v| serde_json::from_value::<Decimal>(v.clone()).ok());
                let notes = args
                    .get("notes")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                let existing_log: Option<RoutineLog> = sqlx::query_as(
                    "SELECT * FROM routine_logs WHERE routine_item_id = $1 AND log_date = $2 AND deleted_at IS NULL",
                )
                .bind(routine_item_id)
                .bind(log_date)
                .fetch_optional(&self.pool)
                .await?;

                let logged = svc
                    .log_routine_item(LogRoutineItemRequest {
                        routine_item_id,
                        log_date: Some(log_date),
                        status,
                        numeric_value,
                        notes,
                    })
                    .await?;

                Ok(MutationRecord {
                    entity_table: Some("routine_logs".to_string()),
                    entity_id: Some(logged.id.to_string()),
                    undo_kind: "restore_routine_log".to_string(),
                    undo_payload: json!({
                        "log_id": logged.id,
                        "previous_log": existing_log
                    }),
                    result: serde_json::to_value(logged)?,
                })
            }
            "routines_upsert_checkin" => {
                let log_date = parse_opt_date_arg(args, "log_date")?
                    .or_else(|| parse_opt_date_arg(args, "date").ok().flatten())
                    .unwrap_or_else(|| Utc::now().date_naive());
                let existing: Option<DailyCheckin> = sqlx::query_as(
                    "SELECT * FROM daily_checkins WHERE log_date = $1 AND deleted_at IS NULL",
                )
                .bind(log_date)
                .fetch_optional(&self.pool)
                .await?;

                let req: UpsertDailyCheckinRequest = serde_json::from_value(args.clone())?;
                let checkin = svc.upsert_checkin(log_date, req).await?;
                Ok(MutationRecord {
                    entity_table: Some("daily_checkins".to_string()),
                    entity_id: Some(log_date.to_string()),
                    undo_kind: "restore_daily_checkin".to_string(),
                    undo_payload: json!({
                        "log_date": log_date,
                        "previous": existing
                    }),
                    result: serde_json::to_value(checkin)?,
                })
            }
            "routines_set_day_profile" => {
                let log_date = parse_opt_date_arg(args, "log_date")?
                    .or_else(|| parse_opt_date_arg(args, "date").ok().flatten())
                    .unwrap_or_else(|| Utc::now().date_naive());
                let day_profile: DayProfile = serde_json::from_value(
                    args.get("day_profile")
                        .cloned()
                        .unwrap_or_else(|| Value::String("workday".to_string())),
                )?;
                let existing: Option<DailyCheckin> = sqlx::query_as(
                    "SELECT * FROM daily_checkins WHERE log_date = $1 AND deleted_at IS NULL",
                )
                .bind(log_date)
                .fetch_optional(&self.pool)
                .await?;

                let checkin = svc.set_day_profile(log_date, day_profile).await?;
                Ok(MutationRecord {
                    entity_table: Some("daily_checkins".to_string()),
                    entity_id: Some(log_date.to_string()),
                    undo_kind: "restore_daily_checkin".to_string(),
                    undo_payload: json!({
                        "log_date": log_date,
                        "previous": existing
                    }),
                    result: serde_json::to_value(checkin)?,
                })
            }
            "routines_save_template" => {
                let name = parse_str_arg(args, &["name", "title"])?.to_string();
                let time_slot = args
                    .get("time_slot")
                    .and_then(|v| serde_json::from_value::<RoutineTimeSlot>(v.clone()).ok())
                    .unwrap_or_default();
                let day_profile = args
                    .get("day_profile")
                    .and_then(|v| serde_json::from_value::<DayProfile>(v.clone()).ok())
                    .unwrap_or_default();

                if let Some(routine_id) = parse_opt_uuid_arg(args, &["routine_id", "id"])? {
                    let prev = svc.get_routine(routine_id, None).await?;
                    let updated = svc
                        .update_routine(
                            routine_id,
                            hermes_domain::routines::UpdateRoutineRequest {
                                name: Some(name),
                                time_slot: Some(time_slot),
                                day_profile: Some(day_profile),
                                ..Default::default()
                            },
                        )
                        .await?;
                    Ok(MutationRecord {
                        entity_table: Some("routines".to_string()),
                        entity_id: Some(routine_id.to_string()),
                        undo_kind: "restore_routine_template".to_string(),
                        undo_payload: json!({
                            "created": false,
                            "routine_id": routine_id,
                            "previous": prev
                        }),
                        result: serde_json::to_value(updated)?,
                    })
                } else {
                    let created = svc
                        .create_routine(CreateRoutineRequest {
                            name,
                            time_slot,
                            day_profile,
                            target_start_time: None,
                            sort_order: None,
                            active: true,
                        })
                        .await?;
                    if let Some(items) = args.get("items").and_then(|v| v.as_array()) {
                        for item_val in items {
                            if let Ok(item_req) =
                                serde_json::from_value::<CreateRoutineItemRequest>(item_val.clone())
                            {
                                let _ = svc.create_routine_item(created.routine.id, item_req).await;
                            }
                        }
                    }
                    let full = svc.get_routine(created.routine.id, None).await?;
                    Ok(MutationRecord {
                        entity_table: Some("routines".to_string()),
                        entity_id: Some(created.routine.id.to_string()),
                        undo_kind: "restore_routine_template".to_string(),
                        undo_payload: json!({
                            "created": true,
                            "routine_id": created.routine.id
                        }),
                        result: serde_json::to_value(full)?,
                    })
                }
            }
            "routines_delete" => {
                let routine_id = parse_uuid_arg(args, &["routine_id", "id"])?;
                let prev = svc.get_routine(routine_id, None).await?;
                svc.delete_routine(routine_id).await?;
                Ok(MutationRecord {
                    entity_table: Some("routines".to_string()),
                    entity_id: Some(routine_id.to_string()),
                    undo_kind: "restore_deleted_routine".to_string(),
                    undo_payload: serde_json::to_value(&prev)?,
                    result: json!({ "deleted": true, "routine_id": routine_id }),
                })
            }

            // =================================================================
            // 4. goals mutations
            // =================================================================
            "goals_log_checkin" => {
                let goal_id = parse_uuid_arg(args, &["goal_id", "id"])?;
                let prev_goal = svc.get_goal(goal_id).await?;
                let confidence_score = args
                    .get("confidence_score")
                    .and_then(|v| v.as_i64())
                    .map(|n| n as i16)
                    .unwrap_or(prev_goal.goal.confidence_score);
                let progress_snapshot = args
                    .get("progress_snapshot")
                    .and_then(|v| serde_json::from_value::<Decimal>(v.clone()).ok());
                let checkin = svc
                    .create_goal_checkin(
                        goal_id,
                        CreateGoalCheckinRequest {
                            checkin_date: parse_opt_date_arg(args, "checkin_date")?,
                            progress_snapshot,
                            confidence_score,
                            wins_md: args
                                .get("wins_md")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string(),
                            blockers_md: args
                                .get("blockers_md")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string(),
                            next_steps_md: args
                                .get("next_steps_md")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string(),
                            kr_id: parse_opt_uuid_arg(args, &["kr_id"])?,
                            kr_current_value: args
                                .get("kr_current_value")
                                .or_else(|| args.get("current_value"))
                                .and_then(|v| serde_json::from_value::<Decimal>(v.clone()).ok()),
                        },
                    )
                    .await?;
                Ok(MutationRecord {
                    entity_table: Some("goal_checkins".to_string()),
                    entity_id: Some(checkin.id.to_string()),
                    undo_kind: "undo_goal_checkin".to_string(),
                    undo_payload: json!({
                        "checkin_id": checkin.id,
                        "previous_goal": prev_goal
                    }),
                    result: serde_json::to_value(checkin)?,
                })
            }
            "goals_update_kr_progress" => {
                let kr_id = parse_uuid_arg(args, &["kr_id", "id"])?;
                let prev_kr: GoalKeyResult =
                    sqlx::query_as("SELECT * FROM goal_key_results WHERE id = $1")
                        .bind(kr_id)
                        .fetch_one(&self.pool)
                        .await?;
                let current_value = args
                    .get("current_value")
                    .and_then(|v| serde_json::from_value::<Decimal>(v.clone()).ok());
                let milestones_json = args.get("milestones_json").cloned();
                let updated = svc
                    .update_key_result(
                        kr_id,
                        UpdateKeyResultRequest {
                            current_value,
                            milestones_json,
                            ..Default::default()
                        },
                    )
                    .await?;
                Ok(MutationRecord {
                    entity_table: Some("goal_key_results".to_string()),
                    entity_id: Some(kr_id.to_string()),
                    undo_kind: "restore_kr_snapshot".to_string(),
                    undo_payload: serde_json::to_value(&prev_kr)?,
                    result: serde_json::to_value(updated)?,
                })
            }
            "goals_create_or_update" => {
                if let Some(goal_id) = parse_opt_uuid_arg(args, &["goal_id", "id"])? {
                    let prev = svc.get_goal(goal_id).await?;
                    let req: UpdateGoalRequest = serde_json::from_value(args.clone())?;
                    let updated = svc.update_goal(goal_id, req).await?;
                    Ok(MutationRecord {
                        entity_table: Some("goals".to_string()),
                        entity_id: Some(goal_id.to_string()),
                        undo_kind: "restore_goal_snapshot".to_string(),
                        undo_payload: serde_json::to_value(&prev)?,
                        result: serde_json::to_value(updated)?,
                    })
                } else {
                    let title = parse_str_arg(args, &["title", "name"])?.to_string();
                    let pillar = args
                        .get("pillar")
                        .and_then(|v| serde_json::from_value::<GoalPillar>(v.clone()).ok())
                        .unwrap_or(GoalPillar::Systems);
                    let year = args
                        .get("year")
                        .and_then(|v| v.as_i64())
                        .map(|y| y as i32)
                        .unwrap_or(2026);
                    let status = args
                        .get("status")
                        .and_then(|v| serde_json::from_value::<GoalStatus>(v.clone()).ok())
                        .unwrap_or(GoalStatus::InProgress);
                    let created = svc
                        .create_goal(CreateGoalRequest {
                            year,
                            pillar,
                            code: args.get("code").and_then(|v| v.as_str()).map(str::to_string),
                            title,
                            why_motivation_md: args
                                .get("why_motivation_md")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string(),
                            status,
                            priority_rank: args
                                .get("priority_rank")
                                .and_then(|v| v.as_i64())
                                .map(|n| n as i32),
                            target_date: parse_opt_date_arg(args, "target_date")?,
                            confidence_score: args
                                .get("confidence_score")
                                .and_then(|v| v.as_i64())
                                .map(|n| n as i16),
                            blueprint_pos: None,
                        })
                        .await?;
                    Ok(MutationRecord {
                        entity_table: Some("goals".to_string()),
                        entity_id: Some(created.goal.id.to_string()),
                        undo_kind: "delete_created_goal".to_string(),
                        undo_payload: json!({ "goal_id": created.goal.id }),
                        result: serde_json::to_value(created)?,
                    })
                }
            }
            "goals_delete" => {
                let goal_id = parse_uuid_arg(args, &["goal_id", "id"])?;
                let prev = svc.get_goal(goal_id).await?;
                svc.delete_goal(goal_id).await?;
                Ok(MutationRecord {
                    entity_table: Some("goals".to_string()),
                    entity_id: Some(goal_id.to_string()),
                    undo_kind: "restore_deleted_goal".to_string(),
                    undo_payload: serde_json::to_value(&prev)?,
                    result: json!({ "deleted": true, "goal_id": goal_id }),
                })
            }

            // =================================================================
            // 5. courses mutations
            // =================================================================
            "courses_update_lesson_status" => {
                let lesson_id = parse_uuid_arg(args, &["lesson_id", "id"])?;
                let prev_lesson: CourseLesson =
                    sqlx::query_as("SELECT * FROM course_lessons WHERE id = $1")
                        .bind(lesson_id)
                        .fetch_one(&self.pool)
                        .await?;
                let status: LessonStatus = serde_json::from_value(
                    args.get("status")
                        .cloned()
                        .unwrap_or_else(|| Value::String("completed".to_string())),
                )?;
                let key_summary_md = args
                    .get("key_summary_md")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let updated = svc
                    .patch_course_lesson_status(
                        lesson_id,
                        UpdateLessonStatusRequest {
                            status,
                            key_summary_md,
                        },
                    )
                    .await?;
                Ok(MutationRecord {
                    entity_table: Some("course_lessons".to_string()),
                    entity_id: Some(lesson_id.to_string()),
                    undo_kind: "restore_lesson_snapshot".to_string(),
                    undo_payload: serde_json::to_value(&prev_lesson)?,
                    result: serde_json::to_value(updated)?,
                })
            }
            "courses_complete_review" => {
                let lesson_id = parse_uuid_arg(args, &["lesson_id", "id"])?;
                let prev_lesson: CourseLesson =
                    sqlx::query_as("SELECT * FROM course_lessons WHERE id = $1")
                        .bind(lesson_id)
                        .fetch_one(&self.pool)
                        .await?;
                let action = args
                    .get("action")
                    .and_then(|v| serde_json::from_value::<SpacedReviewAction>(v.clone()).ok())
                    .unwrap_or(SpacedReviewAction::Complete);
                let req = ReviewLessonRequest {
                    action,
                    rating: args.get("rating").and_then(|v| v.as_str()).map(str::to_string),
                    snooze_days: args.get("snooze_days").and_then(|v| v.as_i64()),
                };
                let updated = svc.complete_lesson_review(lesson_id, req).await?;
                Ok(MutationRecord {
                    entity_table: Some("course_lessons".to_string()),
                    entity_id: Some(lesson_id.to_string()),
                    undo_kind: "restore_lesson_snapshot".to_string(),
                    undo_payload: serde_json::to_value(&prev_lesson)?,
                    result: serde_json::to_value(updated)?,
                })
            }
            "courses_spawn_lab_todo" => {
                let course_id = parse_uuid_arg(args, &["course_id", "id"])?;
                let title = parse_str_arg(args, &["title"])?.to_string();
                let lesson_id = parse_opt_uuid_arg(args, &["lesson_id"])?;
                let scheduled_date = parse_opt_date_arg(args, "scheduled_date")?;
                let task = svc
                    .spawn_course_todo(
                        course_id,
                        SpawnCourseTodoRequest {
                            title,
                            lesson_id,
                            scheduled_date,
                        },
                    )
                    .await?;
                Ok(MutationRecord {
                    entity_table: Some("tasks".to_string()),
                    entity_id: Some(task.id.to_string()),
                    undo_kind: "delete_created_task".to_string(),
                    undo_payload: json!({ "task_id": task.id }),
                    result: serde_json::to_value(task)?,
                })
            }
            "courses_import_youtube_playlist" => {
                let playlist_id = parse_str_arg(args, &["playlist_id", "id"])?.to_string();
                let existed: Option<Uuid> = sqlx::query_scalar(
                    "SELECT id FROM courses WHERE youtube_playlist_id = $1 LIMIT 1",
                )
                .bind(&playlist_id)
                .fetch_optional(&self.pool)
                .await?;
                let req = ImportYoutubePlaylistRequest {
                    playlist_id,
                    goal_id: parse_opt_uuid_arg(args, &["goal_id"])?,
                    title_override: args
                        .get("title_override")
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                };
                let res = svc.import_youtube_playlist(req).await?;
                Ok(MutationRecord {
                    entity_table: Some("courses".to_string()),
                    entity_id: Some(res.course.id.to_string()),
                    undo_kind: "delete_created_course".to_string(),
                    undo_payload: json!({
                        "course_id": res.course.id,
                        "existed_before": existed.is_some()
                    }),
                    result: serde_json::to_value(res)?,
                })
            }
            "courses_delete" => {
                let course_id = parse_uuid_arg(args, &["course_id", "id"])?;
                let prev = svc.get_course(course_id).await?;
                svc.delete_course(course_id).await?;
                Ok(MutationRecord {
                    entity_table: Some("courses".to_string()),
                    entity_id: Some(course_id.to_string()),
                    undo_kind: "restore_deleted_course".to_string(),
                    undo_payload: serde_json::to_value(&prev)?,
                    result: json!({ "deleted": true, "course_id": course_id }),
                })
            }

            // =================================================================
            // 6. finance mutations (executed after human approval!)
            // =================================================================
            "finance_upsert_asset" => {
                let req: CreatePortfolioAssetRequest = serde_json::from_value(args.clone())?;
                let prev_asset: Option<PortfolioAsset> = if let Some(id) = req.id {
                    svc.get_asset(id).await.ok()
                } else {
                    sqlx::query_as("SELECT * FROM portfolio_assets WHERE UPPER(symbol) = UPPER($1) LIMIT 1")
                        .bind(req.symbol.trim())
                        .fetch_optional(&self.pool)
                        .await?
                };
                let asset = svc.upsert_asset(req).await?;
                Ok(MutationRecord {
                    entity_table: Some("portfolio_assets".to_string()),
                    entity_id: Some(asset.id.to_string()),
                    undo_kind: "restore_asset_snapshot".to_string(),
                    undo_payload: json!({
                        "asset_id": asset.id,
                        "previous_asset": prev_asset
                    }),
                    result: serde_json::to_value(asset)?,
                })
            }
            "finance_delete_asset" => {
                let asset_id = parse_uuid_arg(args, &["asset_id", "id"])?;
                let prev = svc.get_asset(asset_id).await?;
                svc.delete_asset(asset_id).await?;
                Ok(MutationRecord {
                    entity_table: Some("portfolio_assets".to_string()),
                    entity_id: Some(asset_id.to_string()),
                    undo_kind: "restore_deleted_asset".to_string(),
                    undo_payload: serde_json::to_value(&prev)?,
                    result: json!({ "deleted": true, "asset_id": asset_id }),
                })
            }
            "finance_upsert_monthly_plan" => {
                let month = parse_str_arg(args, &["month"])?.to_string();
                let existing: Option<hermes_domain::finance::MonthlyInvestmentPlan> = sqlx::query_as(
                    "SELECT * FROM monthly_investment_plans WHERE month = $1",
                )
                .bind(&month)
                .fetch_optional(&self.pool)
                .await?;
                let req: UpsertMonthlyInvestmentPlanRequest = serde_json::from_value(args.clone())?;
                let plan = svc.upsert_monthly_plan(&month, req).await?;
                Ok(MutationRecord {
                    entity_table: Some("monthly_investment_plans".to_string()),
                    entity_id: Some(month.clone()),
                    undo_kind: "restore_monthly_plan".to_string(),
                    undo_payload: json!({
                        "month": month,
                        "previous": existing
                    }),
                    result: serde_json::to_value(plan)?,
                })
            }
            "finance_update_retirement_config" => {
                let prev = svc.get_retirement_config().await?;
                let req: UpdateRetirementConfigRequest = serde_json::from_value(args.clone())?;
                let updated = svc.update_retirement_config(req).await?;
                Ok(MutationRecord {
                    entity_table: Some("retirement_config".to_string()),
                    entity_id: Some("1".to_string()),
                    undo_kind: "restore_retirement_config".to_string(),
                    undo_payload: serde_json::to_value(&prev)?,
                    result: serde_json::to_value(updated)?,
                })
            }

            // =================================================================
            // 7. servers mutations
            // =================================================================
            "servers_create_or_update" => {
                if let Some(server_id) = parse_opt_uuid_arg(args, &["server_id", "id"])? {
                    let prev = svc.get_server(server_id).await?;
                    let req: UpdateServerRequest = serde_json::from_value(args.clone())?;
                    let updated = svc.update_server(server_id, req).await?;
                    Ok(MutationRecord {
                        entity_table: Some("server_nodes".to_string()),
                        entity_id: Some(server_id.to_string()),
                        undo_kind: "restore_server_snapshot".to_string(),
                        undo_payload: json!({
                            "server_id": server_id,
                            "previous": prev
                        }),
                        result: serde_json::to_value(updated)?,
                    })
                } else {
                    let req: CreateServerRequest = serde_json::from_value(args.clone())?;
                    let created = svc.create_server(req).await?;
                    Ok(MutationRecord {
                        entity_table: Some("server_nodes".to_string()),
                        entity_id: Some(created.id.to_string()),
                        undo_kind: "restore_server_snapshot".to_string(),
                        undo_payload: json!({
                            "server_id": created.id,
                            "previous": Value::Null
                        }),
                        result: serde_json::to_value(created)?,
                    })
                }
            }
            "servers_delete" => {
                let server_id = parse_uuid_arg(args, &["server_id", "id"])?;
                let prev = svc.get_server(server_id).await?;
                svc.delete_server(server_id).await?;
                Ok(MutationRecord {
                    entity_table: Some("server_nodes".to_string()),
                    entity_id: Some(server_id.to_string()),
                    undo_kind: "restore_deleted_server".to_string(),
                    undo_payload: serde_json::to_value(&prev)?,
                    result: json!({ "deleted": true, "server_id": server_id }),
                })
            }
            other => Err(ApiError::not_found(format!(
                "Unknown mutating MCP tool '{other}'"
            ))),
        }
    }

    // =========================================================================
    // Approvals & Undo Resolution API
    // =========================================================================

    pub async fn list_pending_approvals(
        &self,
        session_key: Option<&str>,
        status_filter: Option<ApprovalStatus>,
    ) -> Result<Vec<PendingMcpApproval>, ApiError> {
        let rows: Vec<PendingMcpApproval> = match (session_key, status_filter) {
            (Some(sk), Some(st)) => {
                sqlx::query_as(
                    "SELECT * FROM pending_mcp_approvals WHERE session_key = $1 AND status = $2 ORDER BY created_at DESC",
                )
                .bind(sk)
                .bind(st)
                .fetch_all(&self.pool)
                .await?
            }
            (Some(sk), None) => {
                sqlx::query_as(
                    "SELECT * FROM pending_mcp_approvals WHERE session_key = $1 ORDER BY created_at DESC",
                )
                .bind(sk)
                .fetch_all(&self.pool)
                .await?
            }
            (None, Some(st)) => {
                sqlx::query_as(
                    "SELECT * FROM pending_mcp_approvals WHERE status = $1 ORDER BY created_at DESC",
                )
                .bind(st)
                .fetch_all(&self.pool)
                .await?
            }
            (None, None) => {
                sqlx::query_as(
                    "SELECT * FROM pending_mcp_approvals WHERE status = 'pending' ORDER BY created_at DESC",
                )
                .fetch_all(&self.pool)
                .await?
            }
        };
        Ok(rows)
    }

    pub async fn get_pending_approval(
        &self,
        approval_id: Uuid,
    ) -> Result<PendingMcpApproval, ApiError> {
        let row: Option<PendingMcpApproval> =
            sqlx::query_as("SELECT * FROM pending_mcp_approvals WHERE id = $1")
                .bind(approval_id)
                .fetch_optional(&self.pool)
                .await?;
        row.ok_or_else(|| {
            ApiError::not_found(format!("Pending MCP approval '{approval_id}' not found"))
        })
    }

    pub async fn approve_mcp_action(
        &self,
        approval_id: Uuid,
        req: ResolveMcpApprovalRequest,
    ) -> Result<PendingMcpApproval, ApiError> {
        let existing = self.get_pending_approval(approval_id).await?;
        if existing.status != ApprovalStatus::Pending {
            return Err(ApiError::conflict(format!(
                "MCP approval '{approval_id}' has already been resolved ({:?})",
                existing.status
            )));
        }

        // Merge or replace payload_json if operator supplied edited arguments
        let effective_payload = match req.payload_json {
            Some(Value::Object(edited_map)) => {
                let mut base_map = existing
                    .payload_json
                    .as_object()
                    .cloned()
                    .unwrap_or_default();
                for (k, v) in edited_map {
                    base_map.insert(k, v);
                }
                Value::Object(base_map)
            }
            Some(other) if !other.is_null() => other,
            _ => existing.payload_json.clone(),
        };

        // Execute the approved mutation through the ImmediateUndo path so an undo snapshot is also recorded
        let outcome = self
            .execute_mcp_tool_with_autonomy(
                &existing.tool_name,
                effective_payload.clone(),
                McpCallContext {
                    session_key: existing.session_key.clone(),
                    agent_run_id: existing.agent_run_id,
                    knight_policy: None,
                    allowed_tools: None,
                    bypass_approval_gate: true,
                },
            )
            .await?;

        let result_json = outcome.to_json_value();

        let updated: PendingMcpApproval = sqlx::query_as(
            "UPDATE pending_mcp_approvals \
             SET status = 'approved', payload_json = $2, result_json = $3, resolved_at = NOW() \
             WHERE id = $1 \
             RETURNING id, session_key, agent_run_id, tool_name, payload_json, status, result_json, created_at, resolved_at",
        )
        .bind(approval_id)
        .bind(&effective_payload)
        .bind(&result_json)
        .fetch_one(&self.pool)
        .await?;

        // If this approval was linked to an Agent Studio Knight run in `awaiting_approval`, mark the run succeeded
        if let Some(run_id) = updated.agent_run_id {
            let _ = sqlx::query(
                "UPDATE agent_runs SET status = 'succeeded', finished_at = COALESCE(finished_at, NOW()) \
                 WHERE id = $1 AND status = 'awaiting_approval'",
            )
            .bind(run_id)
            .execute(&self.pool)
            .await;
        }

        Ok(updated)
    }

    pub async fn reject_mcp_action(
        &self,
        approval_id: Uuid,
    ) -> Result<PendingMcpApproval, ApiError> {
        let existing = self.get_pending_approval(approval_id).await?;
        if existing.status != ApprovalStatus::Pending {
            return Err(ApiError::conflict(format!(
                "MCP approval '{approval_id}' has already been resolved ({:?})",
                existing.status
            )));
        }

        let updated: PendingMcpApproval = sqlx::query_as(
            "UPDATE pending_mcp_approvals \
             SET status = 'rejected', resolved_at = NOW() \
             WHERE id = $1 \
             RETURNING id, session_key, agent_run_id, tool_name, payload_json, status, result_json, created_at, resolved_at",
        )
        .bind(approval_id)
        .fetch_one(&self.pool)
        .await?;

        if let Some(run_id) = updated.agent_run_id {
            let _ = sqlx::query(
                "UPDATE agent_runs SET status = 'failed', error_message = 'MCP approval rejected by operator', finished_at = COALESCE(finished_at, NOW()) \
                 WHERE id = $1 AND status = 'awaiting_approval'",
            )
            .bind(run_id)
            .execute(&self.pool)
            .await;
        }

        Ok(updated)
    }

    pub async fn list_undo_actions(
        &self,
        session_key: Option<&str>,
    ) -> Result<Vec<McpUndoAction>, ApiError> {
        let rows: Vec<McpUndoAction> = if let Some(sk) = session_key {
            sqlx::query_as(
                "SELECT * FROM mcp_undo_actions WHERE session_key = $1 ORDER BY created_at DESC",
            )
            .bind(sk)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as("SELECT * FROM mcp_undo_actions ORDER BY created_at DESC")
                .fetch_all(&self.pool)
                .await?
        };
        Ok(rows)
    }

    pub async fn undo_mcp_action(&self, undo_id: Uuid) -> Result<McpUndoAction, ApiError> {
        let action: Option<McpUndoAction> =
            sqlx::query_as("SELECT * FROM mcp_undo_actions WHERE id = $1")
                .bind(undo_id)
                .fetch_optional(&self.pool)
                .await?;
        let action = action
            .ok_or_else(|| ApiError::not_found(format!("MCP undo action '{undo_id}' not found")))?;

        if action.undone_at.is_some() {
            return Err(ApiError::conflict(format!(
                "MCP action '{undo_id}' has already been undone"
            )));
        }
        if Utc::now() > action.expires_at {
            return Err(ApiError::conflict(format!(
                "MCP undo window for '{undo_id}' has expired"
            )));
        }

        self.restore_undo_snapshot(&action).await?;

        let updated: McpUndoAction = sqlx::query_as(
            "UPDATE mcp_undo_actions SET undone_at = NOW() WHERE id = $1 \
             RETURNING id, session_key, tool_name, entity_table, entity_id, undo_kind, undo_payload, undone_at, expires_at, created_at",
        )
        .bind(undo_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(updated)
    }

    async fn restore_undo_snapshot(&self, action: &McpUndoAction) -> Result<(), ApiError> {
        let svc = &self.life_ops;
        let payload = &action.undo_payload;

        match action.undo_kind.as_str() {
            // Dashboards
            "delete_created_dashboard" => {
                let id = parse_uuid_arg(payload, &["dashboard_id"])?;
                svc.delete_dashboard(id).await?;
            }
            "restore_dashboard_order" => {
                let prev_ids: Vec<Uuid> = payload
                    .get("previous_order")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();
                if !prev_ids.is_empty() {
                    svc.reorder_dashboards(ReorderDashboardsRequest {
                        dashboard_ids: prev_ids,
                    })
                    .await?;
                }
                if let (Some(target_id), Some(prev_rot)) = (
                    parse_opt_uuid_arg(payload, &["target_id"])?,
                    payload.get("previous_in_rotation").and_then(|v| v.as_bool()),
                ) {
                    svc.update_dashboard(
                        target_id,
                        UpdateDashboardRequest {
                            in_rotation: Some(prev_rot),
                            ..Default::default()
                        },
                    )
                    .await?;
                }
            }
            "delete_created_widget" => {
                let dashboard_id = parse_uuid_arg(payload, &["dashboard_id"])?;
                let widget_id = parse_uuid_arg(payload, &["widget_id"])?;
                svc.delete_widget(dashboard_id, widget_id).await?;
            }
            "restore_widget_snapshot" => {
                let prev: DashboardWidget = serde_json::from_value(payload.clone())?;
                svc.update_widget(
                    prev.dashboard_id,
                    prev.id,
                    UpdateWidgetRequest {
                        title: Some(prev.title),
                        source_kind: Some(prev.source_kind),
                        renderer_kind: Some(prev.renderer_kind),
                        grid_rect: Some(prev.grid_rect),
                        source_config: Some(prev.source_config),
                        refresh_interval_seconds: Some(prev.refresh_interval_seconds),
                        sort_order: Some(prev.sort_order),
                    },
                )
                .await?;
            }
            "restore_dashboard_snapshot" => {
                let snap: DashboardWithWidgets = serde_json::from_value(payload.clone())?;
                svc.update_dashboard(
                    snap.dashboard.id,
                    UpdateDashboardRequest {
                        slug: Some(snap.dashboard.slug),
                        title: Some(snap.dashboard.title),
                        cycle_seconds: Some(snap.dashboard.cycle_seconds),
                        in_rotation: Some(snap.dashboard.in_rotation),
                        sort_order: Some(snap.dashboard.sort_order),
                        layout_cols: Some(snap.dashboard.layout_cols),
                        layout_rows: Some(snap.dashboard.layout_rows),
                    },
                )
                .await?;
                for w in snap.widgets {
                    let _ = svc
                        .update_widget(
                            snap.dashboard.id,
                            w.id,
                            UpdateWidgetRequest {
                                title: Some(w.title),
                                source_kind: Some(w.source_kind),
                                renderer_kind: Some(w.renderer_kind),
                                grid_rect: Some(w.grid_rect),
                                source_config: Some(w.source_config),
                                refresh_interval_seconds: Some(w.refresh_interval_seconds),
                                sort_order: Some(w.sort_order),
                            },
                        )
                        .await;
                }
            }
            "restore_deleted_dashboard" => {
                let snap: DashboardWithWidgets = serde_json::from_value(payload.clone())?;
                let d = snap.dashboard;
                sqlx::query(
                    "INSERT INTO dashboards (id, slug, title, cycle_seconds, in_rotation, sort_order, layout_cols, layout_rows, created_at, updated_at) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) \
                     ON CONFLICT (id) DO NOTHING",
                )
                .bind(d.id)
                .bind(&d.slug)
                .bind(&d.title)
                .bind(d.cycle_seconds)
                .bind(d.in_rotation)
                .bind(d.sort_order)
                .bind(d.layout_cols)
                .bind(d.layout_rows)
                .bind(d.created_at)
                .execute(&self.pool)
                .await?;

                for w in snap.widgets {
                    sqlx::query(
                        "INSERT INTO dashboard_widgets (id, dashboard_id, title, source_kind, renderer_kind, grid_rect, source_config, refresh_interval_seconds, cached_payload, last_refreshed_at, sort_order, created_at, updated_at) \
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()) \
                         ON CONFLICT (id) DO NOTHING",
                    )
                    .bind(w.id)
                    .bind(w.dashboard_id)
                    .bind(&w.title)
                    .bind(w.source_kind)
                    .bind(w.renderer_kind)
                    .bind(serde_json::to_value(w.grid_rect)?)
                    .bind(&w.source_config)
                    .bind(w.refresh_interval_seconds)
                    .bind(&w.cached_payload)
                    .bind(w.last_refreshed_at)
                    .bind(w.sort_order)
                    .bind(w.created_at)
                    .execute(&self.pool)
                    .await?;
                }
            }

            // Todos
            "delete_created_task" => {
                let task_id = parse_uuid_arg(payload, &["task_id"])?;
                svc.delete_task(task_id).await?;
            }
            "restore_task_snapshot" => {
                let prev: Task = serde_json::from_value(payload.clone())?;
                self.restore_single_task(&prev).await?;
            }
            "restore_tasks_bulk" => {
                let prev_tasks: Vec<Task> = serde_json::from_value(payload.clone())?;
                for prev in &prev_tasks {
                    self.restore_single_task(prev).await?;
                }
            }
            "discard_started_timer" => {
                if let Some(started_id) = parse_opt_uuid_arg(payload, &["started_session_id"])? {
                    sqlx::query(
                        "UPDATE time_sessions SET ended_at = NOW(), duration_seconds = 0, deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
                    )
                    .bind(started_id)
                    .execute(&self.pool)
                    .await?;
                }
                if let Some(prev_val) = payload.get("prev_active_session") {
                    if !prev_val.is_null() {
                        if let Ok(prev_sess) = serde_json::from_value::<TimeSession>(prev_val.clone()) {
                            sqlx::query(
                                "UPDATE time_sessions SET ended_at = NULL, deleted_at = NULL, updated_at = NOW() WHERE id = $1",
                            )
                            .bind(prev_sess.id)
                            .execute(&self.pool)
                            .await?;
                        }
                    }
                }
            }
            "reopen_stopped_timer" => {
                let stopped: TimeSession = serde_json::from_value(payload.clone())?;
                if let Some(task_id) = stopped.task_id {
                    sqlx::query(
                        "UPDATE tasks SET actual_seconds = GREATEST(0, actual_seconds - $2), updated_at = NOW() WHERE id = $1",
                    )
                    .bind(task_id)
                    .bind(stopped.duration_seconds)
                    .execute(&self.pool)
                    .await?;
                }
                // Stop any other running timer before reopening this one to satisfy partial unique index
                sqlx::query(
                    "UPDATE time_sessions SET ended_at = NOW(), updated_at = NOW() WHERE ended_at IS NULL AND deleted_at IS NULL AND id != $1",
                )
                .bind(stopped.id)
                .execute(&self.pool)
                .await?;
                sqlx::query(
                    "UPDATE time_sessions SET ended_at = NULL, duration_seconds = 0, deleted_at = NULL, updated_at = NOW() WHERE id = $1",
                )
                .bind(stopped.id)
                .execute(&self.pool)
                .await?;
            }
            "restore_deleted_project" => {
                let proj: Project = serde_json::from_value(
                    payload
                        .get("project")
                        .cloned()
                        .ok_or_else(|| ApiError::bad_request("Missing project in undo_payload"))?,
                )?;
                let task_ids: Vec<Uuid> = payload
                    .get("task_ids")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();
                sqlx::query(
                    "UPDATE projects SET deleted_at = NULL, status = $2, updated_at = NOW() WHERE id = $1",
                )
                .bind(proj.id)
                .bind(proj.status)
                .execute(&self.pool)
                .await?;
                if !task_ids.is_empty() {
                    sqlx::query(
                        "UPDATE tasks SET project_id = $1, updated_at = NOW() WHERE id = ANY($2)",
                    )
                    .bind(proj.id)
                    .bind(&task_ids)
                    .execute(&self.pool)
                    .await?;
                }
            }

            // Routines
            "restore_routine_log" => {
                let log_id = parse_uuid_arg(payload, &["log_id"])?;
                if let Some(prev_val) = payload.get("previous_log").filter(|v| !v.is_null()) {
                    let prev: RoutineLog = serde_json::from_value(prev_val.clone())?;
                    sqlx::query(
                        "UPDATE routine_logs SET status = $2, numeric_value = $3, notes = $4, deleted_at = NULL, updated_at = NOW() WHERE id = $1",
                    )
                    .bind(prev.id)
                    .bind(prev.status)
                    .bind(prev.numeric_value)
                    .bind(&prev.notes)
                    .execute(&self.pool)
                    .await?;
                } else {
                    sqlx::query(
                        "UPDATE routine_logs SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
                    )
                    .bind(log_id)
                    .execute(&self.pool)
                    .await?;
                }
            }
            "restore_daily_checkin" => {
                let log_date = parse_opt_date_arg(payload, "log_date")?
                    .ok_or_else(|| ApiError::bad_request("Missing log_date in undo_payload"))?;
                if let Some(prev_val) = payload.get("previous").filter(|v| !v.is_null()) {
                    let prev: DailyCheckin = serde_json::from_value(prev_val.clone())?;
                    sqlx::query(
                        "UPDATE daily_checkins \
                         SET day_profile_used = $2, energy_score = $3, mood_score = $4, sleep_hours = $5, highlight = $6, reflection_md = $7, weekly_review_json = $8, deleted_at = NULL, updated_at = NOW() \
                         WHERE log_date = $1",
                    )
                    .bind(log_date)
                    .bind(prev.day_profile_used)
                    .bind(prev.energy_score)
                    .bind(prev.mood_score)
                    .bind(prev.sleep_hours)
                    .bind(&prev.highlight)
                    .bind(&prev.reflection_md)
                    .bind(&prev.weekly_review_json)
                    .execute(&self.pool)
                    .await?;
                } else {
                    sqlx::query(
                        "UPDATE daily_checkins SET deleted_at = NOW(), updated_at = NOW() WHERE log_date = $1",
                    )
                    .bind(log_date)
                    .execute(&self.pool)
                    .await?;
                }
            }
            "restore_routine_template" => {
                let created = payload
                    .get("created")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let routine_id = parse_uuid_arg(payload, &["routine_id"])?;
                if created {
                    svc.delete_routine(routine_id).await?;
                } else if let Some(prev_val) = payload.get("previous").filter(|v| !v.is_null()) {
                    let prev: RoutineStackWithItems = serde_json::from_value(prev_val.clone())?;
                    svc.update_routine(
                        routine_id,
                        hermes_domain::routines::UpdateRoutineRequest {
                            name: Some(prev.routine.name),
                            time_slot: Some(prev.routine.time_slot),
                            day_profile: Some(prev.routine.day_profile),
                            target_start_time: prev.routine.target_start_time,
                            sort_order: Some(prev.routine.sort_order),
                            active: Some(prev.routine.active),
                        },
                    )
                    .await?;
                }
            }
            "restore_deleted_routine" => {
                let prev: RoutineStackWithItems = serde_json::from_value(payload.clone())?;
                sqlx::query(
                    "UPDATE routines SET deleted_at = NULL, active = $2, updated_at = NOW() WHERE id = $1",
                )
                .bind(prev.routine.id)
                .bind(prev.routine.active)
                .execute(&self.pool)
                .await?;
                sqlx::query(
                    "UPDATE routine_items SET deleted_at = NULL, updated_at = NOW() WHERE routine_id = $1",
                )
                .bind(prev.routine.id)
                .execute(&self.pool)
                .await?;
            }

            // Goals
            "undo_goal_checkin" => {
                let checkin_id = parse_uuid_arg(payload, &["checkin_id"])?;
                sqlx::query("DELETE FROM goal_checkins WHERE id = $1")
                    .bind(checkin_id)
                    .execute(&self.pool)
                    .await?;
                if let Some(prev_val) = payload.get("previous_goal").filter(|v| !v.is_null()) {
                    let prev: GoalWithDetails = serde_json::from_value(prev_val.clone())?;
                    sqlx::query(
                        "UPDATE goals SET progress_pct = $2, confidence_score = $3, updated_at = NOW() WHERE id = $1",
                    )
                    .bind(prev.goal.id)
                    .bind(prev.goal.progress_pct)
                    .bind(prev.goal.confidence_score)
                    .execute(&self.pool)
                    .await?;
                }
            }
            "restore_kr_snapshot" => {
                let prev_kr: GoalKeyResult = serde_json::from_value(payload.clone())?;
                svc.update_key_result(
                    prev_kr.id,
                    UpdateKeyResultRequest {
                        quarter: Some(prev_kr.quarter),
                        code: Some(prev_kr.code),
                        title: Some(prev_kr.title),
                        metric_type: Some(prev_kr.metric_type),
                        start_value: Some(prev_kr.start_value),
                        current_value: Some(prev_kr.current_value),
                        target_value: Some(prev_kr.target_value),
                        unit: Some(prev_kr.unit),
                        milestones_json: Some(prev_kr.milestones_json),
                        linked_entity_id: prev_kr.linked_entity_id,
                        weight: Some(prev_kr.weight),
                        blueprint_pos: prev_kr.blueprint_pos,
                    },
                )
                .await?;
            }
            "delete_created_goal" => {
                let goal_id = parse_uuid_arg(payload, &["goal_id"])?;
                svc.delete_goal(goal_id).await?;
            }
            "restore_goal_snapshot" => {
                let prev: GoalWithDetails = serde_json::from_value(payload.clone())?;
                svc.update_goal(
                    prev.goal.id,
                    UpdateGoalRequest {
                        pillar: Some(prev.goal.pillar),
                        code: Some(prev.goal.code),
                        title: Some(prev.goal.title),
                        why_motivation_md: Some(prev.goal.why_motivation_md),
                        status: Some(prev.goal.status),
                        priority_rank: Some(prev.goal.priority_rank),
                        target_date: prev.goal.target_date,
                        progress_pct: Some(prev.goal.progress_pct),
                        confidence_score: Some(prev.goal.confidence_score),
                        blueprint_pos: prev.goal.blueprint_pos,
                    },
                )
                .await?;
            }
            "restore_deleted_goal" => {
                let prev: GoalWithDetails = serde_json::from_value(payload.clone())?;
                let g = prev.goal;
                sqlx::query(
                    "INSERT INTO goals (id, year, pillar, code, title, why_motivation_md, status, priority_rank, target_date, progress_pct, confidence_score, blueprint_pos, created_at, updated_at) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW()) \
                     ON CONFLICT (id) DO NOTHING",
                )
                .bind(g.id)
                .bind(g.year)
                .bind(g.pillar)
                .bind(&g.code)
                .bind(&g.title)
                .bind(&g.why_motivation_md)
                .bind(g.status)
                .bind(g.priority_rank)
                .bind(g.target_date)
                .bind(g.progress_pct)
                .bind(g.confidence_score)
                .bind(g.blueprint_pos.map(|p| serde_json::to_value(p).unwrap_or(Value::Null)))
                .bind(g.created_at)
                .execute(&self.pool)
                .await?;

                for kr in prev.key_results {
                    sqlx::query(
                        "INSERT INTO goal_key_results (id, goal_id, quarter, code, title, metric_type, start_value, current_value, target_value, unit, milestones_json, linked_entity_id, weight, blueprint_pos, created_at, updated_at) \
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()) \
                         ON CONFLICT (id) DO NOTHING",
                    )
                    .bind(kr.id)
                    .bind(kr.goal_id)
                    .bind(kr.quarter)
                    .bind(&kr.code)
                    .bind(&kr.title)
                    .bind(kr.metric_type)
                    .bind(kr.start_value)
                    .bind(kr.current_value)
                    .bind(kr.target_value)
                    .bind(&kr.unit)
                    .bind(&kr.milestones_json)
                    .bind(kr.linked_entity_id)
                    .bind(kr.weight)
                    .bind(kr.blueprint_pos.map(|p| serde_json::to_value(p).unwrap_or(Value::Null)))
                    .bind(kr.created_at)
                    .execute(&self.pool)
                    .await?;
                }
            }

            // Courses
            "restore_lesson_snapshot" => {
                let prev: CourseLesson = serde_json::from_value(payload.clone())?;
                sqlx::query(
                    "UPDATE course_lessons \
                     SET status = $2, key_summary_md = $3, completed_at = $4, review_stage = $5, next_review_date = $6, last_reviewed_at = $7, updated_at = NOW() \
                     WHERE id = $1",
                )
                .bind(prev.id)
                .bind(prev.status)
                .bind(&prev.key_summary_md)
                .bind(prev.completed_at)
                .bind(prev.review_stage)
                .bind(prev.next_review_date)
                .bind(prev.last_reviewed_at)
                .execute(&self.pool)
                .await?;
                let _ = svc.recalculate_course_rollups(prev.course_id).await;
            }
            "delete_created_course" => {
                let existed = payload
                    .get("existed_before")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if !existed {
                    let course_id = parse_uuid_arg(payload, &["course_id"])?;
                    svc.delete_course(course_id).await?;
                }
            }
            "restore_deleted_course" => {
                let prev: CourseSyllabusResponse = serde_json::from_value(payload.clone())?;
                let c = prev.course;
                sqlx::query(
                    "INSERT INTO courses (id, title, provider, instructor, source_url, status, priority, goal_id, youtube_playlist_id, vault_folder_path, certificate_url, practice_scores_json, total_items, completed_items, progress_pct, estimated_total_minutes, logged_study_seconds, target_completion_date, started_at, completed_at, rating, takeaways_md, created_at, updated_at) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW()) \
                     ON CONFLICT (id) DO NOTHING",
                )
                .bind(c.id)
                .bind(&c.title)
                .bind(c.provider)
                .bind(&c.instructor)
                .bind(&c.source_url)
                .bind(c.status)
                .bind(c.priority)
                .bind(c.goal_id)
                .bind(&c.youtube_playlist_id)
                .bind(&c.vault_folder_path)
                .bind(&c.certificate_url)
                .bind(&c.practice_scores_json)
                .bind(c.total_items)
                .bind(c.completed_items)
                .bind(c.progress_pct)
                .bind(c.estimated_total_minutes)
                .bind(c.logged_study_seconds)
                .bind(c.target_completion_date)
                .bind(c.started_at)
                .bind(c.completed_at)
                .bind(c.rating)
                .bind(&c.takeaways_md)
                .bind(c.created_at)
                .execute(&self.pool)
                .await?;

                for m in prev.modules {
                    sqlx::query(
                        "INSERT INTO course_modules (id, course_id, title, sort_order, created_at, updated_at) \
                         VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (id) DO NOTHING",
                    )
                    .bind(m.module.id)
                    .bind(m.module.course_id)
                    .bind(&m.module.title)
                    .bind(m.module.sort_order)
                    .bind(m.module.created_at)
                    .execute(&self.pool)
                    .await?;

                    for l in m.lessons {
                        sqlx::query(
                            "INSERT INTO course_lessons (id, course_id, module_id, title, duration_minutes, status, external_url, youtube_video_id, vault_note_path, key_summary_md, completed_at, review_stage, next_review_date, last_reviewed_at, sort_order, created_at, updated_at) \
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW()) ON CONFLICT (id) DO NOTHING",
                        )
                        .bind(l.id)
                        .bind(l.course_id)
                        .bind(l.module_id)
                        .bind(&l.title)
                        .bind(l.duration_minutes)
                        .bind(l.status)
                        .bind(&l.external_url)
                        .bind(&l.youtube_video_id)
                        .bind(&l.vault_note_path)
                        .bind(&l.key_summary_md)
                        .bind(l.completed_at)
                        .bind(l.review_stage)
                        .bind(l.next_review_date)
                        .bind(l.last_reviewed_at)
                        .bind(l.sort_order)
                        .bind(l.created_at)
                        .execute(&self.pool)
                        .await?;
                    }
                }
            }

            // Finance
            "restore_asset_snapshot" => {
                let asset_id = parse_uuid_arg(payload, &["asset_id"])?;
                if let Some(prev_val) = payload.get("previous_asset").filter(|v| !v.is_null()) {
                    let prev: PortfolioAsset = serde_json::from_value(prev_val.clone())?;
                    sqlx::query(
                        "UPDATE portfolio_assets \
                         SET symbol = $2, name = $3, asset_class = $4, currency = $5, in_portfolio = $6, quantity = $7, avg_cost_cents = $8, current_price_cents = $9, previous_close_cents = $10, dividend_yield_pct = $11, target_weight_pct = $12, alert_low_cents = $13, alert_high_cents = $14, thesis_md = $15, updated_at = NOW() \
                         WHERE id = $1",
                    )
                    .bind(prev.id)
                    .bind(&prev.symbol)
                    .bind(&prev.name)
                    .bind(prev.asset_class)
                    .bind(prev.currency)
                    .bind(prev.in_portfolio)
                    .bind(prev.quantity)
                    .bind(prev.avg_cost_cents)
                    .bind(prev.current_price_cents)
                    .bind(prev.previous_close_cents)
                    .bind(prev.dividend_yield_pct)
                    .bind(prev.target_weight_pct)
                    .bind(prev.alert_low_cents)
                    .bind(prev.alert_high_cents)
                    .bind(&prev.thesis_md)
                    .execute(&self.pool)
                    .await?;
                } else {
                    svc.delete_asset(asset_id).await?;
                }
            }
            "restore_deleted_asset" => {
                let prev: PortfolioAsset = serde_json::from_value(payload.clone())?;
                sqlx::query(
                    "INSERT INTO portfolio_assets (id, symbol, name, asset_class, currency, in_portfolio, quantity, avg_cost_cents, current_price_cents, previous_close_cents, dividend_yield_pct, target_weight_pct, alert_low_cents, alert_high_cents, thesis_md, quote_source, last_quote_at, created_at, updated_at) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW()) \
                     ON CONFLICT (id) DO NOTHING",
                )
                .bind(prev.id)
                .bind(&prev.symbol)
                .bind(&prev.name)
                .bind(prev.asset_class)
                .bind(prev.currency)
                .bind(prev.in_portfolio)
                .bind(prev.quantity)
                .bind(prev.avg_cost_cents)
                .bind(prev.current_price_cents)
                .bind(prev.previous_close_cents)
                .bind(prev.dividend_yield_pct)
                .bind(prev.target_weight_pct)
                .bind(prev.alert_low_cents)
                .bind(prev.alert_high_cents)
                .bind(&prev.thesis_md)
                .bind(&prev.quote_source)
                .bind(prev.last_quote_at)
                .bind(prev.created_at)
                .execute(&self.pool)
                .await?;
            }
            "restore_monthly_plan" => {
                let month = parse_str_arg(payload, &["month"])?;
                if let Some(prev_val) = payload.get("previous").filter(|v| !v.is_null()) {
                    let prev: hermes_domain::finance::MonthlyInvestmentPlan =
                        serde_json::from_value(prev_val.clone())?;
                    sqlx::query(
                        "UPDATE monthly_investment_plans \
                         SET currency = $2, fx_usd_brl = $3, salary_income_cents = $4, planned_spend_cents = $5, actual_spend_cents = $6, planned_investment_cents = $7, actual_invested_cents = $8, allocations_json = $9, notes_md = $10, updated_at = NOW() \
                         WHERE month = $1",
                    )
                    .bind(month)
                    .bind(prev.currency)
                    .bind(prev.fx_usd_brl)
                    .bind(prev.salary_income_cents)
                    .bind(prev.planned_spend_cents)
                    .bind(prev.actual_spend_cents)
                    .bind(prev.planned_investment_cents)
                    .bind(prev.actual_invested_cents)
                    .bind(&prev.allocations_json)
                    .bind(&prev.notes_md)
                    .execute(&self.pool)
                    .await?;
                } else {
                    sqlx::query("DELETE FROM monthly_investment_plans WHERE month = $1")
                        .bind(month)
                        .execute(&self.pool)
                        .await?;
                }
            }
            "restore_retirement_config" => {
                let prev: RetirementConfig = serde_json::from_value(payload.clone())?;
                svc.update_retirement_config(UpdateRetirementConfigRequest {
                    expected_real_return_pct: Some(prev.expected_real_return_pct),
                    safe_withdrawal_rate_pct: Some(prev.safe_withdrawal_rate_pct),
                    override_retirement_monthly_spend_cents: prev
                        .override_retirement_monthly_spend_cents,
                    macro_class_targets_json: Some(prev.macro_class_targets_json),
                    current_age: prev.current_age,
                })
                .await?;
            }

            // Servers
            "restore_server_snapshot" => {
                let server_id = parse_uuid_arg(payload, &["server_id"])?;
                if let Some(prev_val) = payload.get("previous").filter(|v| !v.is_null()) {
                    let prev: ServerNode = serde_json::from_value(prev_val.clone())?;
                    svc.update_server(
                        server_id,
                        UpdateServerRequest {
                            name: Some(prev.name),
                            host: Some(prev.host),
                            port: Some(prev.port),
                            check_type: Some(prev.check_type),
                            http_url: prev.http_url,
                            tags: Some(prev.tags),
                        },
                    )
                    .await?;
                } else {
                    svc.delete_server(server_id).await?;
                }
            }
            "restore_deleted_server" => {
                let prev: ServerNode = serde_json::from_value(payload.clone())?;
                sqlx::query(
                    "INSERT INTO server_nodes (id, name, host, port, check_type, http_url, status, last_latency_ms, last_message, latency_history_ms, last_checked_at, tags, created_at, updated_at) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW()) \
                     ON CONFLICT (id) DO NOTHING",
                )
                .bind(prev.id)
                .bind(&prev.name)
                .bind(&prev.host)
                .bind(prev.port)
                .bind(prev.check_type)
                .bind(&prev.http_url)
                .bind(prev.status)
                .bind(prev.last_latency_ms)
                .bind(&prev.last_message)
                .bind(&prev.latency_history_ms)
                .bind(prev.last_checked_at)
                .bind(&prev.tags)
                .bind(prev.created_at)
                .execute(&self.pool)
                .await?;
            }
            other => {
                return Err(ApiError::internal(format!(
                    "Unsupported undo_kind '{other}'"
                )));
            }
        }

        Ok(())
    }

    async fn restore_single_task(&self, prev: &Task) -> Result<(), ApiError> {
        sqlx::query(
            "UPDATE tasks \
             SET title = $2, description_md = $3, status = $4, priority = $5, project_id = $6, goal_id = $7, course_id = $8, lesson_id = $9, parent_task_id = $10, blocked_by_task_ids = $11, vault_note_path = $12, scheduled_date = $13, due_date = $14, estimated_minutes = $15, actual_seconds = $16, energy_level = $17, tags = $18, recurrence_rule = $19, sort_order = $20, completed_at = $21, deleted_at = NULL, updated_at = NOW() \
             WHERE id = $1",
        )
        .bind(prev.id)
        .bind(&prev.title)
        .bind(&prev.description_md)
        .bind(prev.status)
        .bind(prev.priority)
        .bind(prev.project_id)
        .bind(prev.goal_id)
        .bind(prev.course_id)
        .bind(prev.lesson_id)
        .bind(prev.parent_task_id)
        .bind(&prev.blocked_by_task_ids)
        .bind(&prev.vault_note_path)
        .bind(prev.scheduled_date)
        .bind(prev.due_date)
        .bind(prev.estimated_minutes)
        .bind(prev.actual_seconds)
        .bind(prev.energy_level)
        .bind(&prev.tags)
        .bind(&prev.recurrence_rule)
        .bind(prev.sort_order)
        .bind(prev.completed_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

// =============================================================================
// `rmcp = "3.10.0"` ServerHandler Implementation & Hybrid Axum Router
// =============================================================================

#[derive(Clone)]
pub struct HermesMcpServer {
    pub service: Arc<IntelligenceService>,
}

impl HermesMcpServer {
    pub fn new(service: Arc<IntelligenceService>) -> Self {
        Self { service }
    }

    pub fn tools(&self) -> Vec<Tool> {
        build_rmcp_tools()
    }
}

impl ServerHandler for HermesMcpServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("hermes-os-mcp", "1.0.0"))
            .with_instructions(
                "HERMES // OS Life Operations MCP Server (7 domains: dashboards, todos, routines, goals, courses, finance, servers)",
            )
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, ErrorData>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult::with_all_items(self.tools())))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.tools().into_iter().find(|t| t.name == name)
    }

    fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResponse, ErrorData>> + Send + '_ {
        let svc = self.service.clone();
        let session_key = context
            .extensions
            .get::<axum::http::request::Parts>()
            .and_then(|parts| {
                parts
                    .headers
                    .get("x-hermes-session-key")
                    .or_else(|| parts.headers.get("mcp-session-id"))
                    .and_then(|v| v.to_str().ok())
            })
            .map(str::to_string)
            .unwrap_or_else(|| "mcp-direct".to_string());

        async move {
            let tool_name = request.name.as_ref();
            let args_val = request
                .arguments
                .map(Value::Object)
                .unwrap_or_else(|| json!({}));

            let ctx = McpCallContext::direct(session_key);
            match svc
                .execute_mcp_tool_with_autonomy(tool_name, args_val, ctx)
                .await
            {
                Ok(outcome) => {
                    let payload = outcome.to_json_value();
                    Ok(CallToolResult::structured(payload).into())
                }
                Err(api_err) => {
                    let code = match api_err.status_code() {
                        400 | 422 => ErrorCode::INVALID_PARAMS,
                        404 => ErrorCode::METHOD_NOT_FOUND,
                        _ => ErrorCode::INTERNAL_ERROR,
                    };
                    Err(ErrorData::new(
                        code,
                        Cow::Owned(api_err.message().to_string()),
                        Some(serde_json::to_value(api_err.to_body()).unwrap_or(Value::Null)),
                    ))
                }
            }
        }
    }
}

pub fn build_all_mcp_tools() -> Vec<McpToolSpec> {
    mcp_tool_catalog()
}

pub fn classify_tool_autonomy(tool_name: &str, args: &Value) -> McpAutonomyTier {
    if let Some(spec) = mcp_tool_catalog().into_iter().find(|t| t.name == tool_name) {
        evaluate_effective_autonomy_tier(&spec, args, &McpCallContext::default())
            .unwrap_or(spec.tier)
    } else {
        McpAutonomyTier::RequireApproval
    }
}

pub fn build_mcp_service(
    service: Arc<IntelligenceService>,
) -> StreamableHttpService<HermesMcpServer, LocalSessionManager> {
    let session_manager = Arc::new(LocalSessionManager::default());
    let config = StreamableHttpServerConfig::default()
        .disable_allowed_hosts()
        .with_json_response(true)
        .with_sse_keep_alive(None);

    StreamableHttpService::new(
        move || Ok(HermesMcpServer::new(service.clone())),
        session_manager,
        config,
    )
}

#[derive(Clone)]
struct HybridMcpState {
    service: Arc<IntelligenceService>,
    streamable: StreamableHttpService<HermesMcpServer, LocalSessionManager>,
}

/// Builds an Axum router mounted at `/mcp` that supports both stateful `rmcp`
/// `StreamableHttpService` sessions (`initialize` + `Mcp-Session-Id` + SSE/JSON)
/// AND direct stateless JSON-RPC 2.0 `POST /mcp` requests (`tools/list`, `tools/call`, `ping`).
pub fn mcp_router(service: Arc<IntelligenceService>) -> Router {
    let streamable = build_mcp_service(service.clone());
    let state = HybridMcpState {
        service,
        streamable,
    };

    Router::new()
        .route("/mcp", any(handle_hybrid_mcp_request))
        .with_state(state)
}

async fn handle_hybrid_mcp_request(
    State(state): State<HybridMcpState>,
    req: Request<Body>,
) -> Response {
    let method = req.method().clone();
    let has_session_id = req.headers().contains_key("mcp-session-id");

    // Extract session key header if present
    let session_key = req
        .headers()
        .get("x-hermes-session-key")
        .or_else(|| req.headers().get("mcp-session-id"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("mcp-direct")
        .to_string();

    // If POST without `Mcp-Session-Id`, inspect JSON-RPC method to support direct stateless calls
    if method == axum::http::Method::POST && !has_session_id {
        let (mut parts, body) = req.into_parts();
        let bytes = match axum::body::to_bytes(body, 4 * 1024 * 1024).await {
            Ok(b) => b,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(json!({
                        "jsonrpc": "2.0",
                        "id": null,
                        "error": { "code": -32700, "message": format!("Invalid request body: {e}") }
                    })),
                )
                    .into_response();
            }
        };

        if let Ok(rpc_val) = serde_json::from_slice::<Value>(&bytes) {
            let rpc_method = rpc_val.get("method").and_then(|v| v.as_str()).unwrap_or("");
            let rpc_id = rpc_val.get("id").cloned().unwrap_or(Value::Null);

            match rpc_method {
                "tools/list" => {
                    let tools = build_rmcp_tools();
                    return (
                        StatusCode::OK,
                        axum::Json(json!({
                            "jsonrpc": "2.0",
                            "id": rpc_id,
                            "result": {
                                "tools": tools
                            }
                        })),
                    )
                        .into_response();
                }
                "tools/call" => {
                    let params = rpc_val.get("params").cloned().unwrap_or_else(|| json!({}));
                    let tool_name = params
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    let arguments = params
                        .get("arguments")
                        .cloned()
                        .unwrap_or_else(|| json!({}));

                    // Optional Knight policy / allowed tools passed in params._meta or params
                    let knight_policy = params
                        .get("tools_policy")
                        .cloned()
                        .or_else(|| params.get("_meta").and_then(|m| m.get("tools_policy")).cloned());
                    let allowed_tools = params
                        .get("allowed_tools")
                        .and_then(|v| serde_json::from_value::<Vec<String>>(v.clone()).ok());

                    let ctx = McpCallContext {
                        session_key,
                        agent_run_id: None,
                        knight_policy,
                        allowed_tools,
                        bypass_approval_gate: false,
                    };

                    match state
                        .service
                        .execute_mcp_tool_with_autonomy(tool_name, arguments, ctx)
                        .await
                    {
                        Ok(outcome) => {
                            let val = outcome.to_json_value();
                            let call_result = CallToolResult::structured(val);
                            return (
                                StatusCode::OK,
                                axum::Json(json!({
                                    "jsonrpc": "2.0",
                                    "id": rpc_id,
                                    "result": call_result
                                })),
                            )
                                .into_response();
                        }
                        Err(err) => {
                            let code = match err.status_code() {
                                400 | 422 => -32602,
                                403 => -32003,
                                404 => -32601,
                                _ => -32603,
                            };
                            return (
                                StatusCode::OK,
                                axum::Json(json!({
                                    "jsonrpc": "2.0",
                                    "id": rpc_id,
                                    "error": {
                                        "code": code,
                                        "message": err.message(),
                                        "data": err.to_body()
                                    }
                                })),
                            )
                                .into_response();
                        }
                    }
                }
                "ping" => {
                    return (
                        StatusCode::OK,
                        axum::Json(json!({
                            "jsonrpc": "2.0",
                            "id": rpc_id,
                            "result": {}
                        })),
                    )
                        .into_response();
                }
                "notifications/initialized" => {
                    return StatusCode::ACCEPTED.into_response();
                }
                "initialize" => {
                    let mut normalized_rpc = rpc_val.clone();
                    if let Some(root_obj) = normalized_rpc.as_object_mut() {
                        let params_val = root_obj.entry("params").or_insert_with(|| json!({}));
                        if !params_val.is_object() {
                            *params_val = json!({});
                        }
                        if let Some(p) = params_val.as_object_mut() {
                            p.entry("protocolVersion")
                                .or_insert_with(|| json!("2025-03-26"));
                            p.entry("capabilities").or_insert_with(|| json!({}));
                            p.entry("clientInfo").or_insert_with(|| {
                                json!({
                                    "name": "hermes-client",
                                    "version": "1.0.0"
                                })
                            });
                        }
                    }
                    let normalized_bytes =
                        serde_json::to_vec(&normalized_rpc).unwrap_or_else(|_| bytes.to_vec());
                    parts
                        .headers
                        .insert(header::HOST, HeaderValue::from_static("localhost"));
                    parts.headers.insert(
                        header::ACCEPT,
                        HeaderValue::from_static("application/json, text/event-stream"),
                    );
                    let rebuilt = Request::from_parts(parts, Body::from(normalized_bytes));
                    return match state.streamable.clone().oneshot(rebuilt).await {
                        Ok(resp) => resp.into_response(),
                        Err(infallible) => match infallible {},
                    };
                }
                _ => {
                    // Fall through to `StreamableHttpService`
                }
            }
        }

        // Normalize `Host` and `Accept` headers for `StreamableHttpService`
        parts
            .headers
            .insert(header::HOST, HeaderValue::from_static("localhost"));
        parts.headers.insert(
            header::ACCEPT,
            HeaderValue::from_static("application/json, text/event-stream"),
        );
        let rebuilt = Request::from_parts(parts, Body::from(bytes));
        return match state.streamable.clone().oneshot(rebuilt).await {
            Ok(resp) => resp.into_response(),
            Err(infallible) => match infallible {},
        };
    }

    // Stateful request with `Mcp-Session-Id` or GET/DELETE SSE stream
    let (mut parts, body) = req.into_parts();
    parts
        .headers
        .insert(header::HOST, HeaderValue::from_static("localhost"));
    if method == axum::http::Method::POST {
        parts.headers.insert(
            header::ACCEPT,
            HeaderValue::from_static("application/json, text/event-stream"),
        );
    }
    let rebuilt = Request::from_parts(parts, body);
    match state.streamable.clone().oneshot(rebuilt).await {
        Ok(resp) => resp.into_response(),
        Err(infallible) => match infallible {},
    }
}

/// Validates that all 7 domains are represented in the catalog.
pub fn distinct_mcp_domains() -> HashSet<&'static str> {
    mcp_tool_catalog().into_iter().map(|t| t.domain).collect()
}
