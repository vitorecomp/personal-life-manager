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

pub mod intelligence {
    pub use crate::agents::*;
    pub use crate::hermes::*;
}

pub use agents::*;
pub use auth::*;
pub use courses::*;
pub use dashboards::*;
pub use error::{ApiError, ApiErrorBody};
pub use events::SystemEvent;
pub use finance::*;
pub use goals::*;
pub use hermes::*;
pub use id::{
    MOBILE_SYNC_TABLES, SYSTEM_VERSION, cents_to_decimal, is_mobile_sync_table, is_uuid_v7,
    new_uuid_v7,
};
pub use routines::*;
pub use servers::*;
pub use sync::*;
pub use todos::*;

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

    #[test]
    fn adv_goal_key_result_computed_progress_binary_milestones_and_numeric_edge_cases() {
        let now = Utc::now();
        let mut kr = GoalKeyResult {
            id: new_uuid_v7(),
            goal_id: new_uuid_v7(),
            quarter: OkrQuarter::Q1,
            code: "KR-ADV-1".to_string(),
            title: "Adversarial KR".to_string(),
            metric_type: KrMetricType::Binary,
            start_value: Decimal::ZERO,
            current_value: Decimal::ZERO,
            target_value: Decimal::ZERO,
            unit: "bool".to_string(),
            milestones_json: serde_json::json!([]),
            linked_entity_id: None,
            weight: Decimal::ONE,
            blueprint_pos: None,
            created_at: now,
            updated_at: now,
        };

        // 1. Binary with target_value == 0 requires current_value >= 1
        assert_eq!(kr.computed_progress_pct(), Decimal::ZERO);
        kr.current_value = Decimal::ONE;
        assert_eq!(kr.computed_progress_pct(), Decimal::from(100));

        // Binary with target_value > 0: 0 is 0%, >= 1 is 100%
        kr.target_value = Decimal::ONE;
        kr.current_value = Decimal::ZERO;
        assert_eq!(kr.computed_progress_pct(), Decimal::ZERO);
        kr.current_value = Decimal::from(5);
        assert_eq!(kr.computed_progress_pct(), Decimal::from(100));

        // 2. Milestones with weighted items, `completed` alias, and negative weight clamped to 0
        kr.metric_type = KrMetricType::Milestones;
        kr.milestones_json = serde_json::json!([
            {"title": "M1", "weight": 3.0, "done": true},
            {"title": "M2", "weight": 1.0, "completed": false},
            {"title": "M3", "weight": -10.0, "done": true}
        ]);
        assert_eq!(kr.computed_progress_pct(), Decimal::from(75));

        // Milestones with all-zero weights returns 0% (no division-by-zero)
        kr.milestones_json = serde_json::json!([
            {"title": "Zero", "weight": 0.0, "done": true}
        ]);
        assert_eq!(kr.computed_progress_pct(), Decimal::ZERO);

        // Milestones with empty array falls back to linear start/target math
        kr.milestones_json = serde_json::json!([]);
        kr.start_value = Decimal::from(10);
        kr.target_value = Decimal::from(50);
        kr.current_value = Decimal::from(30);
        assert_eq!(kr.computed_progress_pct(), Decimal::from(50));

        // 3. Numeric with target_value == start_value (zero span guard) and clamping 0..=100
        kr.metric_type = KrMetricType::Numeric;
        kr.start_value = Decimal::from(100);
        kr.target_value = Decimal::from(100);
        kr.current_value = Decimal::from(99);
        assert_eq!(kr.computed_progress_pct(), Decimal::ZERO);
        kr.current_value = Decimal::from(100);
        assert_eq!(kr.computed_progress_pct(), Decimal::from(100));

        kr.start_value = Decimal::ZERO;
        kr.target_value = Decimal::from(100);
        kr.current_value = Decimal::from(-25);
        assert_eq!(kr.computed_progress_pct(), Decimal::ZERO);
        kr.current_value = Decimal::from(250);
        assert_eq!(kr.computed_progress_pct(), Decimal::from(100));
    }

    #[test]
    fn adv_hermes_session_computed_metadata_and_sse_frame_contracts() {
        let now = Utc::now();
        let long_text = "X".repeat(200);
        let session = HermesSession {
            session_key: "sess-adv".to_string(),
            title: "Adv Session".to_string(),
            origin: SessionOrigin::HermesView,
            profile_slug: Some("tactical-profile".to_string()),
            model: None,
            pinned: false,
            archived: false,
            folder_name: None,
            parent_session_key: Some("sess-parent".to_string()),
            forked_from: None,
            branched_at_turn: Some(2),
            high_level_mode: true,
            last_route_context: None,
            messages_json: serde_json::json!([
                {"role": "user", "content": long_text, "created_at": "2026-11-15T10:00:00Z"},
                {"role": "assistant", "content": "   "}
            ]),
            message_count: 0,
            token_count: 0,
            last_message_preview: None,
            last_message_at: None,
            created_at: now,
            updated_at: now,
        }
        .with_computed_metadata();

        assert_eq!(session.model.as_deref(), Some("tactical-profile"));
        assert_eq!(session.forked_from.as_deref(), Some("sess-parent"));
        assert_eq!(session.message_count, 2);
        assert_eq!(session.token_count, 51);
        assert_eq!(session.last_message_preview.as_deref().unwrap().len(), 140);

        // Non-array messages_json fallback and default model fallback
        let fallback_sess = HermesSession {
            profile_slug: None,
            model: None,
            messages_json: serde_json::json!({"invalid": true}),
            ..session
        }
        .with_computed_metadata();
        assert_eq!(
            fallback_sess.model.as_deref(),
            Some("hermes-3-llama-3.1-70b")
        );
        assert_eq!(fallback_sess.message_count, 0);
        assert_eq!(fallback_sess.token_count, 0);
        assert!(fallback_sess.last_message_preview.is_none());

        // SSE frame formatting across variants
        let thinking_ev = HermesStreamEvent::Thinking {
            session_key: "s1".to_string(),
            content: "Step 1".to_string(),
            step: 1,
            thinking_orb_active: true,
            orb_state: ThinkingOrbState {
                active: true,
                vertices_lit: 6,
                rings_locked: 2,
                phase: "reasoning".to_string(),
            },
            gateway_mode: "offline_mock".to_string(),
        };
        let frame = thinking_ev.to_sse_frame();
        assert!(frame.starts_with("event: thinking\ndata: "));
        assert!(frame.ends_with("\n\n"));
        assert!(frame.contains("\"type\":\"thinking\""));
    }

    #[test]
    fn adv_finance_portfolio_asset_and_monthly_plan_computed_metrics_edge_cases() {
        let now = Utc::now();
        let mut asset = PortfolioAsset {
            id: new_uuid_v7(),
            symbol: "BTC".to_string(),
            name: "Bitcoin".to_string(),
            asset_class: AssetClass::Crypto,
            currency: CurrencyCode::Usd,
            in_portfolio: true,
            quantity: Decimal::new(25, 2), // 0.25 BTC
            avg_cost_cents: 60_000_00,
            current_price_cents: 80_000_00,
            previous_close_cents: Some(78_000_00),
            dividend_yield_pct: Some(Decimal::ZERO),
            target_weight_pct: Decimal::from(15),
            alert_low_cents: None,
            alert_high_cents: None,
            thesis_md: String::new(),
            quote_source: "manual".to_string(),
            last_quote_at: None,
            created_at: now,
            updated_at: now,
        };
        assert!(!asset.is_watchlist());
        assert_eq!(asset.market_value_native_cents(), 20_000_00);
        assert_eq!(asset.cost_basis_native_cents(), 15_000_00);
        assert_eq!(asset.unrealized_pnl_native_cents(), 5_000_00);

        asset.in_portfolio = false;
        asset.quantity = Decimal::ZERO;
        assert!(asset.is_watchlist());

        // MonthlyInvestmentPlan with salary == 0 and overspend (negative cashflow clamped surplus to 0)
        let plan = MonthlyInvestmentPlan {
            month: "2026-11".to_string(),
            currency: CurrencyCode::Brl,
            fx_usd_brl: Decimal::from(5),
            salary_income_cents: 0,
            planned_spend_cents: 500_00,
            actual_spend_cents: Some(750_00),
            planned_investment_cents: 200_00,
            actual_invested_cents: 0,
            allocations_json: serde_json::json!({}),
            notes_md: String::new(),
            created_at: now,
            updated_at: now,
            net_cashflow_cents: 0,
            investable_surplus_cents: 0,
            savings_rate_pct: 0.0,
        }
        .with_computed_metrics();
        assert_eq!(plan.net_cashflow_cents, -750_00);
        assert_eq!(plan.investable_surplus_cents, 0);
        assert_eq!(plan.savings_rate_pct, 0.0);
    }

    #[test]
    fn adv_domain_enum_serde_aliases_and_custom_provider_fallback() {
        assert_eq!(
            serde_json::from_str::<KnightArchetype>("\"scholar\"").unwrap(),
            KnightArchetype::LoreWarden
        );
        assert_eq!(
            serde_json::from_str::<KnightArchetype>("\"ranger\"").unwrap(),
            KnightArchetype::Vanguard
        );
        assert_eq!(
            serde_json::from_str::<KnightArchetype>("\"sentinel\"").unwrap(),
            KnightArchetype::Inquisitor
        );
        assert_eq!(
            serde_json::from_str::<CourseProvider>("\"yt\"").unwrap(),
            CourseProvider::Youtube
        );
        assert_eq!(
            serde_json::from_str::<CourseProvider>("\"mit_ocw_custom\"").unwrap(),
            CourseProvider::Custom
        );
        assert_eq!(
            serde_json::from_str::<SpacedReviewAction>("\"advance\"").unwrap(),
            SpacedReviewAction::Complete
        );
        assert_eq!(
            serde_json::from_str::<SpacedReviewAction>("\"postpone\"").unwrap(),
            SpacedReviewAction::Snooze
        );
        assert_eq!(
            serde_json::from_str::<SpacedReviewAction>("\"fail\"").unwrap(),
            SpacedReviewAction::Again
        );
        assert_eq!(
            serde_json::from_str::<GoalPillar>("\"career_craft\"").unwrap(),
            GoalPillar::Career
        );
        assert_eq!(
            serde_json::from_str::<TriggerContext>("\"morning_briefing\"").unwrap(),
            TriggerContext::Any
        );
        assert_eq!(
            serde_json::from_str::<McpAutonomyTier>("\"IMMEDIATE_UNDO\"").unwrap(),
            McpAutonomyTier::ImmediateUndo
        );
        assert_eq!(
            serde_json::from_str::<DayProfile>("\"mvd\"").unwrap(),
            DayProfile::MinimumViable
        );
        assert_eq!(
            serde_json::from_str::<HabitFrequencyType>("\"custom\"").unwrap(),
            HabitFrequencyType::TimesPerWeek
        );
        assert_eq!(
            serde_json::from_str::<TimerMode>("\"pomodoro\"").unwrap(),
            TimerMode::Pomodoro25_5
        );
    }
}
