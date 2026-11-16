//! Typed real-time `SystemEvent` broadcast bus payloads (`tokio::sync::broadcast`).

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::servers::ServerStatus;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SystemEvent {
    DashboardUpdated {
        dashboard_id: Uuid,
        action: String,
        timestamp: DateTime<Utc>,
    },
    WidgetRefreshed {
        dashboard_id: Uuid,
        widget_id: Uuid,
        refreshed_at: DateTime<Utc>,
    },
    ServerStatusChanged {
        server_id: Uuid,
        name: String,
        previous_status: ServerStatus,
        status: ServerStatus,
        latency_ms: Option<i64>,
        checked_at: DateTime<Utc>,
    },
    TimerUpdated {
        session_id: Option<Uuid>,
        task_id: Option<Uuid>,
        course_id: Option<Uuid>,
        running: bool,
        elapsed_seconds: i64,
        timestamp: DateTime<Utc>,
    },
    TaskMutated {
        task_id: Uuid,
        action: String,
        status: String,
        timestamp: DateTime<Utc>,
    },
    RoutineLogged {
        routine_item_id: Uuid,
        log_date: String,
        status: String,
        current_streak: i32,
        timestamp: DateTime<Utc>,
    },
    YoutubeCrawlerSynced {
        playlist_id: String,
        course_id: Option<Uuid>,
        lessons_synced: usize,
        timestamp: DateTime<Utc>,
    },
    PortfolioPriceAlert {
        asset_id: Uuid,
        symbol: String,
        current_price_cents: i64,
        alert_low_cents: Option<i64>,
        alert_high_cents: Option<i64>,
        direction: String,
        timestamp: DateTime<Utc>,
    },
    GoalPaceAtRisk {
        goal_id: Uuid,
        title: String,
        pace_status: String,
        progress_pct: Decimal,
        elapsed_pct: Decimal,
        timestamp: DateTime<Utc>,
    },
    KnightRunUpdated {
        run_id: Uuid,
        agent_id: Uuid,
        agent_slug: String,
        status: String,
        timestamp: DateTime<Utc>,
    },
    McpApprovalRequired {
        approval_id: Uuid,
        session_key: String,
        tool_name: String,
        timestamp: DateTime<Utc>,
    },
    McpUndoAvailable {
        undo_id: Uuid,
        session_key: String,
        tool_name: String,
        timestamp: DateTime<Utc>,
    },
    CompanionNudge {
        nudge_id: Uuid,
        category: String,
        message: String,
        entity_id: Option<String>,
        timestamp: DateTime<Utc>,
    },
}

impl SystemEvent {
    /// Domain event trigger name matching `agent_triggers.config_json.event` (`05-agent-studio.md:38`).
    pub fn trigger_event_name(&self) -> Option<&'static str> {
        match self {
            Self::YoutubeCrawlerSynced { .. } => Some("YoutubeCrawlerSynced"),
            Self::PortfolioPriceAlert { .. } => Some("PortfolioPriceAlert"),
            Self::GoalPaceAtRisk { .. } => Some("GoalPaceAtRisk"),
            _ => None,
        }
    }
}
