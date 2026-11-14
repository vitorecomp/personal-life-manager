//! Pure domain models, reconciled enums, and OpenAPI schemas for `HERMES // OS`.

pub mod agents;
pub mod auth;
pub mod courses;
pub mod dashboards;
pub mod error;
pub mod events;
pub mod finance;
pub mod goals;
pub mod hermes;
pub mod id;
pub mod routines;
pub mod servers;
pub mod sync;
pub mod todos;

pub use error::{ApiError, ApiErrorBody};
pub use events::SystemEvent;
pub use id::{
    MOBILE_SYNC_TABLES, SYSTEM_VERSION, cents_to_decimal, is_mobile_sync_table, is_uuid_v7,
    new_uuid_v7,
};

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use rust_decimal::Decimal;
    use schemars::schema_for;
    use utoipa::PartialSchema;

    #[test]
    fn system_version_matches_contract() {
        assert_eq!(SYSTEM_VERSION, "1.0.0");
        assert_eq!(MOBILE_SYNC_TABLES.len(), 8);
    }

    #[test]
    fn uuid_v7_is_monotonic_and_version_7() {
        let mut ids = Vec::with_capacity(100);
        for _ in 0..100 {
            let id = new_uuid_v7();
            assert!(is_uuid_v7(&id), "Expected version 7 UUID, got {id}");
            ids.push(id);
        }
        for pair in ids.windows(2) {
            assert!(
                pair[0] < pair[1],
                "UUIDv7 must be monotonically increasing within process: {} >= {}",
                pair[0],
                pair[1]
            );
        }
    }

    #[test]
    fn api_error_status_and_json_contract() {
        let cases = [
            (ApiError::bad_request("bad input"), 400, "bad_request"),
            (ApiError::invalid_sync_table("users"), 400, "invalid_sync_table"),
            (ApiError::unauthorized("Unauthorized"), 401, "unauthorized"),
            (ApiError::forbidden("denied"), 403, "forbidden"),
            (ApiError::not_found("missing"), 404, "not_found"),
            (ApiError::conflict("duplicate"), 409, "conflict"),
            (ApiError::cycle_detected("A -> B -> A"), 422, "CYCLE_DETECTED"),
            (ApiError::unprocessable("invalid state"), 422, "unprocessable_entity"),
            (ApiError::internal("db error"), 500, "internal_error"),
            (ApiError::bad_gateway("upstream down"), 502, "bad_gateway"),
        ];

        for (err, expected_status, expected_code) in cases {
            assert_eq!(err.status_code(), expected_status);
            assert_eq!(err.code(), expected_code);
            let body = err.to_body();
            let json_val = serde_json::to_value(&body).expect("serialize ApiErrorBody");
            assert_eq!(json_val["error"], expected_code);
            assert_eq!(json_val["message"], err.message());
        }
    }

    #[test]
    fn system_event_serde_tag_and_trigger_names() {
        let now = Utc::now();
        let id = new_uuid_v7();
        let events = vec![
            (
                SystemEvent::DashboardUpdated {
                    dashboard_id: id,
                    action: "created".into(),
                    timestamp: now,
                },
                "dashboard_updated",
                None,
            ),
            (
                SystemEvent::WidgetRefreshed {
                    dashboard_id: id,
                    widget_id: id,
                    refreshed_at: now,
                },
                "widget_refreshed",
                None,
            ),
            (
                SystemEvent::ServerStatusChanged {
                    server_id: id,
                    name: "node-1".into(),
                    previous_status: servers::ServerStatus::Unknown,
                    status: servers::ServerStatus::Online,
                    latency_ms: Some(12),
                    checked_at: now,
                },
                "server_status_changed",
                None,
            ),
            (
                SystemEvent::TimerUpdated {
                    session_id: Some(id),
                    task_id: Some(id),
                    course_id: None,
                    running: true,
                    elapsed_seconds: 60,
                    timestamp: now,
                },
                "timer_updated",
                None,
            ),
            (
                SystemEvent::TaskMutated {
                    task_id: id,
                    action: "updated".into(),
                    status: "done".into(),
                    timestamp: now,
                },
                "task_mutated",
                None,
            ),
            (
                SystemEvent::RoutineLogged {
                    routine_item_id: id,
                    log_date: "2026-11-14".into(),
                    status: "completed".into(),
                    current_streak: 5,
                    timestamp: now,
                },
                "routine_logged",
                None,
            ),
            (
                SystemEvent::YoutubeCrawlerSynced {
                    playlist_id: "PL123".into(),
                    course_id: Some(id),
                    lessons_synced: 10,
                    timestamp: now,
                },
                "youtube_crawler_synced",
                Some("YoutubeCrawlerSynced"),
            ),
            (
                SystemEvent::PortfolioPriceAlert {
                    asset_id: id,
                    symbol: "PETR4".into(),
                    current_price_cents: 3850,
                    alert_low_cents: Some(3500),
                    alert_high_cents: Some(4200),
                    direction: "high".into(),
                    timestamp: now,
                },
                "portfolio_price_alert",
                Some("PortfolioPriceAlert"),
            ),
            (
                SystemEvent::GoalPaceAtRisk {
                    goal_id: id,
                    title: "Ship HERMES // OS".into(),
                    pace_status: "at_risk".into(),
                    progress_pct: Decimal::new(40, 0),
                    elapsed_pct: Decimal::new(60, 0),
                    timestamp: now,
                },
                "goal_pace_at_risk",
                Some("GoalPaceAtRisk"),
            ),
            (
                SystemEvent::KnightRunUpdated {
                    run_id: id,
                    agent_id: id,
                    agent_slug: "sir-chronos".into(),
                    status: "succeeded".into(),
                    timestamp: now,
                },
                "knight_run_updated",
                None,
            ),
            (
                SystemEvent::McpApprovalRequired {
                    approval_id: id,
                    session_key: "default".into(),
                    tool_name: "finance_upsert_asset".into(),
                    timestamp: now,
                },
                "mcp_approval_required",
                None,
            ),
            (
                SystemEvent::McpUndoAvailable {
                    undo_id: id,
                    session_key: "default".into(),
                    tool_name: "todos_create_task".into(),
                    timestamp: now,
                },
                "mcp_undo_available",
                None,
            ),
            (
                SystemEvent::CompanionNudge {
                    nudge_id: id,
                    category: "routines".into(),
                    message: "Morning stack ready".into(),
                    entity_id: None,
                    timestamp: now,
                },
                "companion_nudge",
                None,
            ),
        ];

        assert_eq!(events.len(), 13);
        for (ev, expected_tag, expected_trigger) in events {
            assert_eq!(ev.trigger_event_name(), expected_trigger);
            let serialized = serde_json::to_value(&ev).expect("serialize SystemEvent");
            assert_eq!(serialized["type"], expected_tag);
            let roundtrip: SystemEvent =
                serde_json::from_value(serialized).expect("deserialize SystemEvent");
            assert_eq!(roundtrip, ev);
        }
    }

    #[test]
    fn task_and_sync_enum_reconciliation_and_schemas() {
        let statuses = [
            "inbox",
            "backlog",
            "todo",
            "in_progress",
            "review",
            "done",
            "canceled",
        ];
        for s in statuses {
            let parsed: todos::TaskStatus =
                serde_json::from_value(serde_json::Value::String(s.to_string())).unwrap();
            let back = serde_json::to_value(parsed).unwrap();
            assert_eq!(back, s);
        }

        // Verify energy aliases
        let deep: todos::TaskEnergyLevel = serde_json::from_str("\"deep_focus\"").unwrap();
        assert_eq!(deep, todos::TaskEnergyLevel::Deep);
        let shallow: todos::TaskEnergyLevel = serde_json::from_str("\"low_energy\"").unwrap();
        assert_eq!(shallow, todos::TaskEnergyLevel::Shallow);
        let quick: todos::TaskEnergyLevel = serde_json::from_str("\"quick_win\"").unwrap();
        assert_eq!(quick, todos::TaskEnergyLevel::Quick);

        // Verify SyncPushRequest supports both `mutations` (`entity_table`) and `operations` (`entity_type`)
        let push_alias: sync::SyncPushRequest = serde_json::from_value(serde_json::json!({
            "operations": [
                {
                    "entity_type": "tasks",
                    "entity_id": new_uuid_v7().to_string(),
                    "op": "upsert",
                    "payload": { "title": "Test" }
                }
            ]
        }))
        .unwrap();
        assert_eq!(push_alias.mutations.len(), 1);
        assert_eq!(push_alias.mutations[0].entity_table, "tasks");

        // Verify utoipa::ToSchema and schemars::JsonSchema generation on pgvector-containing & domain structs
        let _vault_utoipa = hermes::VaultEmbeddingRecord::schema();
        let _vault_schemars = schema_for!(hermes::VaultEmbeddingRecord);
        let _life_score_utoipa = dashboards::LifeScoreResponse::schema();
        let _life_score_schemars = schema_for!(dashboards::LifeScoreResponse);
    }
}
