//! `hermes gateway` SSE/runs client, `/mcp` (`rmcp`) tool server, Knights runner, and Vault watcher.

pub mod companion;
pub mod gateway;
pub mod knights;
pub mod mcp;
pub mod service;
pub mod sessions;
pub mod vault;

pub use gateway::*;
pub use knights::*;
pub use mcp::*;
pub use service::*;
pub use sessions::*;
pub use vault::*;

pub const DEFAULT_HERMES_GATEWAY_URL: &str = "http://127.0.0.1:8642/v1";

pub const MCP_DOMAINS: [&str; 7] = [
    "dashboards",
    "todos",
    "routines",
    "goals",
    "courses",
    "finance",
    "servers",
];

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{
        Json as AxumJson, Router,
        body::Body,
        http::{HeaderMap, Request, StatusCode, header},
        response::IntoResponse,
        routing::{get, post},
    };
    use chrono::{Duration, Utc};
    use hermes_domain::{
        AgentRunStatus, AgentTriggerType, ArenaZone, ChatStreamRequest, ChatToolCallDirective,
        CompanionAnimationHint, CreateAgentRequest, CreateAgentTriggerRequest,
        CreateCompanionPhraseRequest, CreateCourseLessonRequest, CreateCourseModuleRequest,
        CreateCourseRequest, CreateGoalRequest, CreateHermesSessionRequest,
        CreateRoutineItemRequest, CreateRoutineRequest, CreateServerRequest, CreateTaskRequest,
        DispatchAgentRequest, DistillVaultRequest, ForkHermesSessionRequest, HermesStreamEvent,
        KnightArchetype, KnightGridPos, ListHermesSessionsQuery, McpAutonomyTier,
        ResolveMcpApprovalRequest, ServerCheckType, SessionOrigin, SystemEvent, TaskPriority,
        TaskStatus, TriggerContext, UpdateAgentRequest, UpdateHermesSessionRequest,
        VaultNoteListQuery, new_uuid_v7,
    };
    use hermes_life_ops::test_support::TestDb;
    use rust_decimal::Decimal;
    use serde_json::{Value, json};
    use tokio::net::TcpListener;
    use tower::ServiceExt;

    use super::*;

    #[test]
    fn mcp_exposes_seven_life_ops_domains_and_all_61_tools() {
        assert_eq!(MCP_DOMAINS.len(), 7);
        let tools = build_all_mcp_tools();
        assert_eq!(tools.len(), 61);
        for domain in MCP_DOMAINS {
            let count = tools.iter().filter(|t| t.domain == domain).count();
            assert!(
                count >= 3,
                "Expected tools for domain '{domain}', got {count}"
            );
        }
    }

    #[tokio::test]
    async fn mcp_three_tier_autonomy_read_immediate_undo_and_approval_gate() {
        let test_db = TestDb::new().await;
        let svc = Arc::new(IntelligenceService::from_test_db(&test_db));
        let router = mcp_router(svc.clone());

        // 1. JSON-RPC initialize & tools/list over /mcp HTTP router
        let init_req = Request::builder()
            .method("POST")
            .uri("/mcp")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {}
                })
                .to_string(),
            ))
            .unwrap();
        let init_resp = router.clone().oneshot(init_req).await.unwrap();
        assert_eq!(init_resp.status(), StatusCode::OK);
        assert!(init_resp.headers().contains_key("mcp-session-id"));

        let list_req = Request::builder()
            .method("POST")
            .uri("/mcp")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/list",
                    "params": {}
                })
                .to_string(),
            ))
            .unwrap();
        let list_resp = router.clone().oneshot(list_req).await.unwrap();
        assert_eq!(list_resp.status(), StatusCode::OK);
        let list_bytes = axum::body::to_bytes(list_resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let list_json: Value = serde_json::from_slice(&list_bytes).unwrap();
        let tools_arr = list_json["result"]["tools"].as_array().unwrap();
        assert_eq!(tools_arr.len(), 61);

        // 2. READ tools across all 7 domains execute immediately without undo/approval records
        for read_tool in [
            "dashboards_list",
            "todos_list_tasks",
            "routines_list",
            "goals_list",
            "courses_list",
            "finance_get_portfolio",
            "servers_list",
        ] {
            let outcome = svc
                .execute_mcp_tool_with_autonomy(
                    read_tool,
                    json!({}),
                    McpCallContext::direct("sess_mcp_test"),
                )
                .await
                .unwrap_or_else(|e| panic!("READ tool {read_tool} failed: {e:?}"));
            assert!(matches!(
                outcome,
                McpToolExecutionOutcome::ExecutedRead {
                    autonomy_tier: McpAutonomyTier::Read,
                    ..
                }
            ));
        }

        // 3. IMMEDIATE_UNDO: todos_create_task -> executes + creates 15m undo snapshot -> undo_mcp_action restores state
        let create_outcome = svc
            .execute_mcp_tool_with_autonomy(
                "todos_create_task",
                json!({
                    "title": "MCP Created Tactical Task",
                    "priority": "high"
                }),
                McpCallContext::direct("sess_mcp_test"),
            )
            .await
            .expect("todos_create_task must succeed");

        let (undo_action, created_task_val) = match create_outcome {
            McpToolExecutionOutcome::ExecutedWithUndo {
                autonomy_tier,
                undo_action,
                result,
                ..
            } => {
                assert_eq!(autonomy_tier, McpAutonomyTier::ImmediateUndo);
                (undo_action, result)
            }
            other => panic!("Expected ExecutedWithUndo, got {other:?}"),
        };

        let created_task_id = created_task_val["id"].as_str().unwrap();
        let ttl_mins = (undo_action.expires_at - undo_action.created_at).num_minutes();
        assert!(
            (14..=16).contains(&ttl_mins),
            "Expected ~15m undo TTL, got {ttl_mins}m"
        );

        // Undo the task creation -> task is removed and undone_at is set
        let undone = svc
            .undo_mcp_action(undo_action.id)
            .await
            .expect("undo_mcp_action");
        assert!(undone.undone_at.is_some());

        let count_after_undo: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM tasks WHERE id = $1::uuid AND deleted_at IS NULL",
        )
        .bind(created_task_id)
        .fetch_one(&test_db.pool)
        .await
        .unwrap();
        assert_eq!(count_after_undo, 0);

        // Second undo call on already-undone action returns 409 Conflict
        let double_undo_err = svc
            .undo_mcp_action(undo_action.id)
            .await
            .expect_err("double undo must return 409");
        assert_eq!(double_undo_err.status_code(), 409);

        // 4. REQUIRE_APPROVAL + Finance Write-Gate Invariant (even when Knight policy is AUTO)
        let auto_knight_ctx = McpCallContext {
            session_key: "sess_knight_auto".to_string(),
            agent_run_id: None,
            knight_policy: Some(json!({
                "finance.*": "AUTO",
                "*": "AUTO"
            })),
            allowed_tools: None,
            bypass_approval_gate: false,
        };

        let finance_outcome = svc
            .execute_mcp_tool_with_autonomy(
                "finance_upsert_asset",
                json!({
                    "symbol": "WEGE3",
                    "name": "WEG S.A.",
                    "asset_class": "br_equity",
                    "currency": "BRL",
                    "quantity": "10",
                    "avg_cost_cents": 3800,
                    "current_price_cents": 4100,
                    "target_weight_pct": "15"
                }),
                auto_knight_ctx,
            )
            .await
            .expect("finance_upsert_asset must queue approval");

        let pending_approval = match finance_outcome {
            McpToolExecutionOutcome::PendingApproval {
                autonomy_tier,
                approval,
                ..
            } => {
                assert_eq!(autonomy_tier, McpAutonomyTier::RequireApproval);
                approval
            }
            other => panic!("Expected PendingApproval for finance write, got {other:?}"),
        };

        // Target table portfolio_assets must NOT have WEGE3 before approval
        let assets_before = svc
            .life_ops
            .list_assets(Default::default())
            .await
            .unwrap();
        assert!(!assets_before.iter().any(|a| a.symbol == "WEGE3"));

        // Approve with edited quantity ("25" instead of "10")
        let approved = svc
            .approve_mcp_action(
                pending_approval.id,
                ResolveMcpApprovalRequest {
                    payload_json: Some(json!({
                        "symbol": "WEGE3",
                        "name": "WEG S.A.",
                        "asset_class": "br_equity",
                        "currency": "BRL",
                        "quantity": "25",
                        "avg_cost_cents": 3800,
                        "current_price_cents": 4200,
                        "target_weight_pct": "15"
                    })),
                },
            )
            .await
            .expect("approve_mcp_action with edited payload");
        assert_eq!(
            approved.status,
            hermes_domain::ApprovalStatus::Approved
        );

        let assets_after = svc
            .life_ops
            .list_assets(Default::default())
            .await
            .unwrap();
        let wege = assets_after
            .iter()
            .find(|a| a.symbol == "WEGE3")
            .expect("WEGE3 created after approval");
        assert_eq!(wege.quantity, Decimal::from(25));
        assert_eq!(wege.current_price_cents, 4200);

        // Rejecting a pending approval does not mutate state
        let pending_2 = match svc
            .execute_mcp_tool_with_autonomy(
                "finance_delete_asset",
                json!({ "asset_id": wege.id }),
                McpCallContext::direct("sess_mcp_test"),
            )
            .await
            .unwrap()
        {
            McpToolExecutionOutcome::PendingApproval { approval, .. } => approval,
            other => panic!("Expected PendingApproval, got {other:?}"),
        };

        let rejected = svc
            .reject_mcp_action(pending_2.id)
            .await
            .expect("reject_mcp_action");
        assert_eq!(
            rejected.status,
            hermes_domain::ApprovalStatus::Rejected
        );
        // WEGE3 still exists
        let assets_after_reject = svc.life_ops.list_assets(Default::default()).await.unwrap();
        assert!(assets_after_reject.iter().any(|a| a.id == wege.id));

        drop(router);
        drop(svc);
        test_db.teardown().await;
    }

    #[tokio::test]
    async fn sessions_crud_search_rail_order_and_forking() {
        let test_db = TestDb::new().await;
        let svc = IntelligenceService::from_test_db(&test_db);

        let s1 = svc
            .create_session(CreateHermesSessionRequest {
                session_key: Some("sess_alpha".to_string()),
                title: Some("Alpha Architecture Review".to_string()),
                origin: SessionOrigin::HermesView,
                profile_slug: Some("hermes-architect".to_string()),
                model: None,
                high_level_mode: false,
                pinned: false,
                folder_name: Some("Engineering".to_string()),
                last_route_context: Some(json!({"active_route": "/hermes"})),
                messages_json: Some(json!([
                    {"role": "user", "content": "Review Rust workspace layout", "created_at": "2026-11-14T10:00:00Z"},
                    {"role": "assistant", "content": "Workspace layout has 4 crates.", "created_at": "2026-11-14T10:01:00Z"},
                    {"role": "user", "content": "Now check pgvector indexing", "created_at": "2026-11-14T10:02:00Z"},
                    {"role": "assistant", "content": "HNSW 384-d index is active.", "created_at": "2026-11-14T10:03:00Z"}
                ])),
            })
            .await
            .expect("create s1");
        assert_eq!(s1.message_count, 4);
        assert!(s1.token_count > 0);

        let s2 = svc
            .create_session(CreateHermesSessionRequest {
                session_key: Some("sess_pinned".to_string()),
                title: Some("Pinned Portfolio Strategy".to_string()),
                origin: SessionOrigin::FrierenPopover,
                profile_slug: Some("frieren-sage".to_string()),
                model: None,
                high_level_mode: true,
                pinned: true,
                folder_name: Some("Wealth".to_string()),
                last_route_context: Some(json!({"active_route": "/finance"})),
                messages_json: Some(json!([
                    {"role": "user", "content": "Rebalance SELIC vs S&P 500", "created_at": "2026-11-14T09:00:00Z"}
                ])),
            })
            .await
            .expect("create s2");

        // Rail order: pinned first (`sess_pinned` before `sess_alpha`)
        let all = svc
            .list_sessions(ListHermesSessionsQuery::default())
            .await
            .expect("list_sessions");
        assert!(all.len() >= 2);
        assert_eq!(all[0].session_key, s2.session_key);

        // Search query `?q=pgvector` finds `sess_alpha`
        let searched = svc
            .list_sessions(ListHermesSessionsQuery {
                q: Some("pgvector".to_string()),
                ..Default::default()
            })
            .await
            .expect("search sessions");
        assert_eq!(searched.len(), 1);
        assert_eq!(searched[0].session_key, "sess_alpha");

        // Update session
        let updated = svc
            .update_session(
                "sess_alpha",
                UpdateHermesSessionRequest {
                    title: Some("Alpha Architecture Deep Dive".to_string()),
                    pinned: Some(true),
                    archived: None,
                    folder_name: Some("Core".to_string()),
                    high_level_mode: Some(true),
                    last_route_context: None,
                    profile_slug: None,
                    model: None,
                },
            )
            .await
            .expect("update_session");
        assert_eq!(updated.title, "Alpha Architecture Deep Dive");
        assert!(updated.pinned);
        assert!(updated.high_level_mode);

        // Negative turn_index on fork returns 400
        let neg_fork = svc
            .fork_session(
                "sess_alpha",
                ForkHermesSessionRequest {
                    title: None,
                    turn_index: Some(-1),
                    new_session_key: None,
                },
            )
            .await
            .expect_err("negative turn_index must fail");
        assert_eq!(neg_fork.status_code(), 400);

        // Fork session at turn_index = 1 (first 2 messages: indices 0 and 1)
        let forked = svc
            .fork_session(
                "sess_alpha",
                ForkHermesSessionRequest {
                    title: Some("Branched Alpha".to_string()),
                    turn_index: Some(1),
                    new_session_key: Some("sess_alpha_fork".to_string()),
                },
            )
            .await
            .expect("fork_session");
        assert_eq!(forked.session_key, "sess_alpha_fork");
        assert_eq!(forked.parent_session_key.as_deref(), Some("sess_alpha"));
        assert_eq!(forked.forked_from.as_deref(), Some("sess_alpha"));
        assert_eq!(forked.branched_at_turn, Some(1));
        assert_eq!(forked.message_count, 2);

        // Delete parent session -> child fork survives with parent_session_key = NULL
        svc.delete_session("sess_alpha")
            .await
            .expect("delete parent session");
        let fork_after_parent_del = svc
            .get_session("sess_alpha_fork")
            .await
            .expect("child fork survives");
        assert!(fork_after_parent_del.parent_session_key.is_none());

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn gateway_health_online_sse_bridge_and_offline_mock_resilience() {
        let test_db = TestDb::new().await;

        // 1. Offline mock health and chat stream when gateway port is unreachable
        let mut offline_cfg = hermes_life_ops::LifeOpsConfig::from_test_db(&test_db);
        offline_cfg.hermes_gateway_url = "http://127.0.0.1:1/v1".to_string();
        let offline_life_ops =
            hermes_life_ops::LifeOpsService::new(test_db.pool.clone(), None, offline_cfg);
        let offline_svc = IntelligenceService::new(offline_life_ops, None, None);

        assert_eq!(offline_svc.check_gateway_health().await, "offline_mock");

        let offline_events = offline_svc
            .stream_chat(
                Some("sess_offline_chat"),
                ChatStreamRequest {
                    session_key: None,
                    message: "/deep-plan Synthesize @goals and @todos with @finance".to_string(),
                    high_level_mode: Some(true),
                    page_context: None,
                    mentions: Some(vec!["@servers".to_string()]),
                    slash_command: Some("/deep-plan".to_string()),
                    origin: Some(SessionOrigin::HermesView),
                    profile_slug: None,
                    model: None,
                    tool_call: Some(ChatToolCallDirective {
                        name: "todos_create_task".to_string(),
                        arguments: json!({
                            "title": "Action from offline_mock stream",
                            "priority": "urgent"
                        }),
                    }),
                },
            )
            .await
            .expect("offline_mock stream_chat");

        // Verify Thinking (with REF-08 thinking_orb_active = true), ToolCall, UndoAvailable, Token, Done
        assert!(offline_events.iter().any(|e| matches!(
            e,
            HermesStreamEvent::Thinking {
                thinking_orb_active: true,
                gateway_mode,
                ..
            } if gateway_mode == "offline_mock"
        )));
        assert!(offline_events.iter().any(|e| matches!(
            e,
            HermesStreamEvent::UndoAvailable { tool_name, .. } if tool_name == "todos_create_task"
        )));
        assert!(offline_events.iter().any(|e| matches!(
            e,
            HermesStreamEvent::Done {
                thinking_orb_active: true,
                gateway_mode,
                ..
            } if gateway_mode == "offline_mock"
        )));

        // Verify persisted transcript in hermes_sessions_index
        let persisted_offline = offline_svc
            .get_session("sess_offline_chat")
            .await
            .expect("persisted offline session");
        assert_eq!(persisted_offline.message_count, 2);

        // Verify @vault path-traversal attempt in chat mentions is rejected with 400
        let traversal_err = offline_svc
            .stream_chat(
                Some("sess_offline_chat"),
                ChatStreamRequest {
                    message: "Read @vault:../../etc/passwd".to_string(),
                    ..Default::default()
                },
            )
            .await
            .expect_err("path traversal mention must fail");
        assert!(traversal_err.status_code() == 400 || traversal_err.status_code() == 403);

        // 2. Spin up an ephemeral live mock HTTP/SSE gateway on 127.0.0.1:0
        let mock_app = Router::new()
            .route(
                "/v1/models",
                get(|| async { AxumJson(json!({"data": [{"id": "hermes-3-llama-3.1-70b"}]})) }),
            )
            .route(
                "/v1/chat/completions",
                post(|headers: HeaderMap, AxumJson(body): AxumJson<Value>| async move {
                    let sess_hdr = headers
                        .get("x-hermes-session-key")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("missing")
                        .to_string();
                    let model = body["model"].as_str().unwrap_or("unknown").to_string();
                    let sse_payload = format!(
                        "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
                        json!({
                            "choices": [{"delta": {"reasoning_content": format!("Online gateway reasoning for {sess_hdr}")}}]
                        }),
                        json!({
                            "choices": [{"delta": {"content": format!("Live online response from {model} for {sess_hdr}.")}}]
                        })
                    );
                    (
                        StatusCode::OK,
                        [(header::CONTENT_TYPE, "text/event-stream")],
                        sse_payload,
                    )
                        .into_response()
                }),
            );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, mock_app).await;
        });

        let mut online_cfg = hermes_life_ops::LifeOpsConfig::from_test_db(&test_db);
        online_cfg.hermes_gateway_url = format!("http://{addr}/v1");
        let online_life_ops =
            hermes_life_ops::LifeOpsService::new(test_db.pool.clone(), None, online_cfg);
        let online_svc =
            IntelligenceService::new(online_life_ops, None, Some("test-key".to_string()));

        assert_eq!(online_svc.check_gateway_health().await, "online");

        let online_events = online_svc
            .stream_chat(
                Some("sess_online_live"),
                ChatStreamRequest {
                    message: "Verify online gateway SSE bridge".to_string(),
                    high_level_mode: Some(false),
                    ..Default::default()
                },
            )
            .await
            .expect("online stream_chat");

        assert!(online_events.iter().any(|e| matches!(
            e,
            HermesStreamEvent::Done {
                gateway_mode,
                message,
                ..
            } if gateway_mode == "online" && message.contains("sess_online_live")
        )));

        let sse_wire = format_sse_events(&online_events);
        assert!(sse_wire.contains("event: thinking\n"));
        assert!(sse_wire.contains("event: token\n"));
        assert!(sse_wire.contains("event: done\n"));

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn knights_crud_soul_interpolation_dry_run_and_hp_circuit_breaker() {
        let test_db = TestDb::new().await;
        let svc = IntelligenceService::from_test_db(&test_db);

        // 1. Verify 4 Starter Knights are seeded
        let seeded = svc.list_agents().await.expect("list_agents");
        assert_eq!(seeded.len(), 4);
        let chronos = svc
            .get_agent("sir-chronos")
            .await
            .expect("get sir-chronos by slug");
        assert_eq!(chronos.agent.knight_archetype, KnightArchetype::Paladin);
        assert_eq!(chronos.hp_remaining_cents, 500);
        assert_eq!(chronos.hp_pct, 100.0);
        assert!(!chronos.is_paused);

        // Lookup by UUID works identically
        let chronos_by_id = svc
            .get_agent(chronos.agent.id)
            .await
            .expect("get sir-chronos by UUID");
        assert_eq!(chronos_by_id.agent.slug, "sir-chronos");

        // 2. SOUL.md variable interpolation replaces all 5 placeholders
        let rendered_soul = svc
            .render_soul_prompt(
                "Date={{today}} | Goals={{active_goals}} | Wealth={{portfolio_summary}} | Tasks={{due_tasks}} | Reviews={{due_reviews}}",
            )
            .await
            .expect("render_soul_prompt");
        assert!(!rendered_soul.contains("{{today}}"));
        assert!(!rendered_soul.contains("{{active_goals}}"));
        assert!(!rendered_soul.contains("{{portfolio_summary}}"));
        assert!(!rendered_soul.contains("{{due_tasks}}"));
        assert!(!rendered_soul.contains("{{due_reviews}}"));

        // 3. Create a custom Artificer Knight with 100 cents monthly budget
        let artificer = svc
            .create_agent(CreateAgentRequest {
                slug: Some("artificer-daedalus".to_string()),
                name: "Artificer Daedalus".to_string(),
                knight_archetype: KnightArchetype::Artificer,
                crest_color: "#2CE5F2".to_string(),
                sprite_sheet_id: None,
                grid_pos: KnightGridPos {
                    x: 3,
                    y: 2,
                    zone: ArenaZone::CronWatchtower,
                },
                hermes_profile: Some("hermes-artificer".to_string()),
                system_prompt: "Maintain infrastructure on {{today}}.".to_string(),
                model_config: json!({"model": "hermes-3-llama-3.1-70b", "ep_daily_tokens": 25000}),
                tools_policy: json!({"todos.*": "AUTO", "finance.*": "APPROVE"}),
                monthly_budget_cents: 100,
                is_mastermind_member: false,
                enabled: true,
            })
            .await
            .expect("create artificer");

        let _trig = svc
            .create_agent_trigger(
                artificer.agent.id,
                CreateAgentTriggerRequest {
                    trigger_type: AgentTriggerType::Cron,
                    config_json: json!({"cron": "0 8 * * *", "description": "08:00 Infra Audit"}),
                    enabled: true,
                    next_run_at: None,
                },
            )
            .await
            .expect("create_agent_trigger");

        let queue = svc
            .get_agent_queue(Some(20))
            .await
            .expect("get_agent_queue");
        assert!(!queue.queue.is_empty());

        // 4. Dry-Run Sandbox (`dry_run: true`) -> zero DB mutations, zero cost, zero HP deduction
        let dry_run = svc
            .dispatch_agent(
                "artificer-daedalus",
                DispatchAgentRequest {
                    dry_run: Some(true),
                    sample_input: Some("Simulate task creation".to_string()),
                    trigger_id: None,
                    tool_call: Some(ChatToolCallDirective {
                        name: "todos_create_task".to_string(),
                        arguments: json!({"title": "Dry run task should not persist"}),
                    }),
                    estimated_cost_cents: Some(500),
                },
            )
            .await
            .expect("dispatch_agent dry_run");
        assert!(dry_run.is_dry_run);
        assert_eq!(dry_run.status, AgentRunStatus::Succeeded);
        assert_eq!(dry_run.estimated_cost_usd, Decimal::ZERO);

        let after_dry = svc.get_agent("artificer-daedalus").await.unwrap();
        assert_eq!(after_dry.hp_remaining_cents, 100);
        assert!(!after_dry.is_paused);

        // 5. Live Run (`dry_run: false`) that consumes 100 cents -> triggers HP circuit breaker -> StandbyBarracks
        let live_run = svc
            .dispatch_agent(
                "artificer-daedalus",
                DispatchAgentRequest {
                    dry_run: Some(false),
                    sample_input: Some("Execute live morning check".to_string()),
                    trigger_id: None,
                    tool_call: Some(ChatToolCallDirective {
                        name: "todos_create_task".to_string(),
                        arguments: json!({"title": "Live Knight Task"}),
                    }),
                    estimated_cost_cents: Some(100),
                },
            )
            .await
            .expect("dispatch_agent live_run");
        assert!(!live_run.is_dry_run);
        assert_eq!(live_run.status, AgentRunStatus::Succeeded);
        assert!(live_run.estimated_cost_usd > Decimal::ZERO);

        let after_depletion = svc.get_agent("artificer-daedalus").await.unwrap();
        assert_eq!(after_depletion.hp_remaining_cents, 0);
        assert_eq!(after_depletion.hp_pct, 0.0);
        assert_eq!(
            after_depletion.agent.grid_pos.zone,
            ArenaZone::StandbyBarracks
        );
        assert!(after_depletion.is_paused);

        // Subsequent live run is blocked by HP circuit breaker with 409 Conflict
        let blocked_err = svc
            .dispatch_agent(
                "artificer-daedalus",
                DispatchAgentRequest {
                    dry_run: Some(false),
                    sample_input: Some("Should be blocked by circuit breaker".to_string()),
                    trigger_id: None,
                    tool_call: None,
                    estimated_cost_cents: Some(10),
                },
            )
            .await
            .expect_err("depleted Knight must reject live run with 409");
        assert_eq!(blocked_err.status_code(), 409);

        // Dry-run is STILL allowed even when Knight is in StandbyBarracks
        let dry_while_paused = svc
            .dispatch_agent(
                "artificer-daedalus",
                DispatchAgentRequest {
                    dry_run: Some(true),
                    sample_input: Some("Sandbox preview while paused".to_string()),
                    trigger_id: None,
                    tool_call: None,
                    estimated_cost_cents: None,
                },
            )
            .await
            .expect("dry_run must succeed even when HP is 0");
        assert!(dry_while_paused.is_dry_run);

        // 5b. Increasing monthly_budget_cents via update_agent unpauses Knight from StandbyBarracks
        // and live dispatch_agent(dry_run: false) calls POST /v1/runs with X-Hermes-Session-Key when online
        let unpaused = svc
            .update_agent(
                artificer.agent.id,
                UpdateAgentRequest {
                    monthly_budget_cents: Some(500),
                    ..Default::default()
                },
            )
            .await
            .expect("update_agent budget increase");
        assert_eq!(unpaused.hp_remaining_cents, 400);
        assert_ne!(unpaused.agent.grid_pos.zone, ArenaZone::StandbyBarracks);
        assert!(!unpaused.is_paused);

        let runs_hits = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let runs_hits_clone = runs_hits.clone();
        let mock_runs_app = Router::new()
            .route(
                "/v1/models",
                get(|| async { AxumJson(json!({"data": [{"id": "hermes-3-llama-3.1-70b"}]})) }),
            )
            .route(
                "/v1/runs",
                post(move |headers: HeaderMap, AxumJson(body): AxumJson<Value>| {
                    let hits = runs_hits_clone.clone();
                    async move {
                        let sess_hdr = headers
                            .get("x-hermes-session-key")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("");
                        assert!(
                            sess_hdr.starts_with("sess_knight_"),
                            "Expected X-Hermes-Session-Key header on /v1/runs, got '{sess_hdr}'"
                        );
                        assert_eq!(body["agent_slug"].as_str(), Some("artificer-daedalus"));
                        hits.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        AxumJson(json!({
                            "output": format!("Online /v1/runs report for {sess_hdr}"),
                            "usage": {
                                "input_tokens": 120,
                                "output_tokens": 80
                            }
                        }))
                    }
                }),
            );
        let runs_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let runs_addr = runs_listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(runs_listener, mock_runs_app).await;
        });

        let online_knight_svc = svc
            .clone()
            .with_gateway_url(format!("http://{runs_addr}/v1"));
        let online_run = online_knight_svc
            .dispatch_agent(
                "artificer-daedalus",
                DispatchAgentRequest {
                    dry_run: Some(false),
                    sample_input: Some("Verify /v1/runs after budget unpause".to_string()),
                    trigger_id: None,
                    tool_call: None,
                    estimated_cost_cents: Some(10),
                },
            )
            .await
            .expect("live dispatch after budget unpause must succeed");
        assert_eq!(runs_hits.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(online_run.status, AgentRunStatus::Succeeded);
        assert_eq!(online_run.input_tokens, 120);
        assert_eq!(online_run.output_tokens, 80);
        let steps_arr = online_run.steps_trace.as_array().unwrap();
        assert!(steps_arr.iter().any(|s| {
            s.get("kind").and_then(|v| v.as_str()) == Some("knight_synthesis")
                && s.get("gateway_mode").and_then(|v| v.as_str()) == Some("online")
                && s.get("output")
                    .and_then(|v| v.as_str())
                    .is_some_and(|o| o.contains("Online /v1/runs report"))
        }));

        // 6. Event-driven trigger (`PortfolioPriceAlert` -> dispatches `vanguard-aurum`)
        let event_runs = svc
            .handle_system_event(&SystemEvent::PortfolioPriceAlert {
                asset_id: new_uuid_v7(),
                symbol: "PETR4".to_string(),
                current_price_cents: 4250,
                alert_low_cents: Some(3500),
                alert_high_cents: Some(4200),
                direction: "high".to_string(),
                timestamp: Utc::now(),
            })
            .await
            .expect("handle_system_event");
        assert_eq!(event_runs.len(), 1);

        // Clean up custom agent
        svc.delete_agent(artificer.agent.id)
            .await
            .expect("delete_agent");

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn vault_inspector_path_traversal_guard_distill_and_pgvector_embeddings() {
        let test_db = TestDb::new().await;
        let svc = IntelligenceService::from_test_db(&test_db);

        // 1. Distill a note to `{second_brain_dir}/Inbox/{YYYY-MM-DD}-{slug}.md`
        let distilled = svc
            .distill_to_vault(DistillVaultRequest {
                title: "Distributed Consensus & Raft Notes".to_string(),
                content_md: "## Leader Election\nRaft uses randomized election timeouts.\n\n## Log Replication\nCommitted entries are durable across quorum.".to_string(),
                tags: vec!["distributed-systems".to_string(), "raft".to_string()],
                session_key: Some("sess_raft_study".to_string()),
            })
            .await
            .expect("distill_to_vault");

        assert!(distilled.vault_note_path.starts_with("Inbox/"));
        assert!(
            distilled
                .vault_note_path
                .ends_with("-distributed-consensus-raft-notes.md")
        );

        // Verify note can be read back via read_vault_note
        let detail = svc
            .read_vault_note(&distilled.vault_note_path)
            .await
            .expect("read_vault_note");
        assert_eq!(detail.title, "Distributed Consensus & Raft Notes");
        assert!(detail.content_md.contains("randomized election timeouts"));

        // Verify 384-d embeddings were upserted into vault_embeddings
        let hits = svc
            .search_vault_embeddings("randomized election timeouts quorum", 5)
            .await
            .expect("search_vault_embeddings");
        assert!(!hits.is_empty());
        assert_eq!(hits[0].0.vault_note_path, distilled.vault_note_path);
        assert_eq!(hits[0].0.embedding.as_slice().len(), 384);

        // Verify list_vault_notes with semantic query
        let notes = svc
            .list_vault_notes(VaultNoteListQuery {
                q: Some("quorum".to_string()),
                folder: Some("Inbox".to_string()),
                semantic: true,
                limit: Some(10),
            })
            .await
            .expect("list_vault_notes");
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].path, distilled.vault_note_path);

        // 2. Verify Path-Traversal Guard rejects `..`, `/etc/passwd`, non-.md, and escaping symlinks
        for bad_path in [
            "",
            "../secret.md",
            "../../etc/passwd",
            "/etc/passwd",
            "Inbox/../../outside.md",
            "Inbox/script.sh",
            ".obsidian/config.md",
        ] {
            let err = svc
                .read_vault_note(bad_path)
                .await
                .expect_err(&format!("bad vault path '{bad_path}' must be rejected"));
            assert!(
                err.status_code() == 400 || err.status_code() == 403,
                "Expected 400 or 403 for '{bad_path}', got {}",
                err.status_code()
            );
        }

        // Create a symlink inside second_brain_dir/Inbox pointing outside second_brain_dir
        #[cfg(unix)]
        {
            let outside_file = test_db.youtube_lists_notes_dir.join("outside_secret.md");
            std::fs::write(&outside_file, "# Secret Outside File\n").unwrap();
            let symlink_path = test_db.second_brain_dir.join("Inbox/escape_link.md");
            std::os::unix::fs::symlink(&outside_file, &symlink_path).unwrap();

            let sym_err = svc
                .read_vault_note("Inbox/escape_link.md")
                .await
                .expect_err("symlink escaping second_brain_dir must be rejected");
            assert!(sym_err.status_code() == 403 || sym_err.status_code() == 400);
        }

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn companion_proactive_nudges_and_offline_phrases_mobile_sync() {
        let test_db = TestDb::new().await;
        let svc = IntelligenceService::from_test_db(&test_db);
        let today = Utc::now().date_naive();

        // 1. Seed all 6 nudge conditions:
        // (a) Overdue task
        let _overdue_task = svc
            .life_ops
            .create_task(CreateTaskRequest {
                title: "Overdue Tax Filing".to_string(),
                status: TaskStatus::Todo,
                priority: TaskPriority::Urgent,
                scheduled_date: Some(today - Duration::days(2)),
                ..Default::default()
            })
            .await
            .expect("create overdue task");

        // (b) Off-track / at-risk goal (progress = 0%, confidence = 2)
        let create_goal_req: CreateGoalRequest = serde_json::from_value(json!({
            "year": 2026,
            "pillar": "systems",
            "code": "G99",
            "title": "Zero Latency Telemetry",
            "why_motivation_md": "Mission critical",
            "status": "in_progress",
            "priority_rank": 1,
            "target_date": (today + Duration::days(5)).to_string(),
            "confidence_score": 2
        }))
        .unwrap();
        let _at_risk_goal = svc
            .life_ops
            .create_goal(create_goal_req)
            .await
            .expect("create at-risk goal");

        // (c) Due spaced-repetition review (complete a lesson and set next_review_date <= today)
        let create_course_req: CreateCourseRequest = serde_json::from_value(json!({
            "title": "Rust Async Internals",
            "provider": "custom",
            "status": "active"
        }))
        .unwrap();
        let course = svc.life_ops.create_course(create_course_req).await.unwrap();
        let module = svc
            .life_ops
            .create_course_module(
                course.course.id,
                CreateCourseModuleRequest {
                    title: "Pin & Poll".to_string(),
                    sort_order: Some(1),
                },
            )
            .await
            .unwrap();
        let create_lesson_req: CreateCourseLessonRequest = serde_json::from_value(json!({
            "title": "Waker Mechanics",
            "duration_minutes": 30,
            "status": "completed"
        }))
        .unwrap();
        let lesson = svc
            .life_ops
            .create_course_lesson(module.id, create_lesson_req)
            .await
            .unwrap();
        sqlx::query("UPDATE course_lessons SET next_review_date = $2, review_stage = 0 WHERE id = $1")
            .bind(lesson.id)
            .bind(today)
            .execute(&test_db.pool)
            .await
            .unwrap();

        // (d) Unlogged daily routine + off-day custom routine item
        let create_routine_req: CreateRoutineRequest = serde_json::from_value(json!({
            "name": "Morning Tactical Stack",
            "time_slot": "morning",
            "day_profile": "workday"
        }))
        .unwrap();
        let routine = svc
            .life_ops
            .create_routine(create_routine_req)
            .await
            .unwrap();
        let create_item_req: CreateRoutineItemRequest = serde_json::from_value(json!({
            "title": "15m Mobility Protocol",
            "tracking_type": "boolean",
            "frequency_type": "daily"
        }))
        .unwrap();
        let routine_item = svc
            .life_ops
            .create_routine_item(routine.routine.id, create_item_req)
            .await
            .unwrap();

        let today_iso_day = {
            use chrono::Datelike;
            today.weekday().number_from_monday() as i64
        };
        let off_day = if today_iso_day == 1 { 2 } else { 1 };
        let off_day_item_req: CreateRoutineItemRequest = serde_json::from_value(json!({
            "title": "Off-Day Only Habit",
            "tracking_type": "boolean",
            "frequency_type": "custom",
            "frequency_config": { "days": [off_day] }
        }))
        .unwrap();
        let off_day_item = svc
            .life_ops
            .create_routine_item(routine.routine.id, off_day_item_req)
            .await
            .unwrap();

        // (e) Offline server node
        let server = svc
            .life_ops
            .create_server(CreateServerRequest {
                name: "edge-proxmox-01".to_string(),
                host: "10.0.0.99".to_string(),
                port: 22,
                check_type: ServerCheckType::Tcp,
                http_url: None,
                tags: vec!["lab".to_string()],
            })
            .await
            .unwrap();
        sqlx::query("UPDATE server_nodes SET status = 'offline' WHERE id = $1")
            .bind(server.id)
            .execute(&test_db.pool)
            .await
            .unwrap();

        // (f) Pending MCP approval
        let _ = svc
            .execute_mcp_tool_with_autonomy(
                "finance_upsert_asset",
                json!({
                    "symbol": "ITUB4",
                    "name": "Itau Unibanco",
                    "asset_class": "br_equities",
                    "currency": "BRL",
                    "quantity": "50",
                    "avg_cost_cents": 3200,
                    "current_price_cents": 3400,
                    "target_weight_pct": "10"
                }),
                McpCallContext::direct("sess_nudge_test"),
            )
            .await
            .unwrap();

        // Verify all 6 categories are present in get_companion_nudges(), and off_day_item is excluded
        let nudges = svc
            .get_companion_nudges()
            .await
            .expect("get_companion_nudges");
        for expected_cat in [
            "overdue_task",
            "goal_pace",
            "spaced_review",
            "unlogged_routine",
            "server_health",
            "pending_approval",
        ] {
            assert!(
                nudges.iter().any(|n| n.category == expected_cat),
                "Missing expected nudge category '{expected_cat}' in {nudges:?}"
            );
        }
        assert!(
            !nudges
                .iter()
                .any(|n| n.entity_id.as_deref() == Some(&off_day_item.id.to_string())),
            "Off-day routine item must NOT emit an unlogged_routine nudge today"
        );

        // Logging the scheduled routine item as Completed ('completed') clears its unlogged_routine nudge
        svc.life_ops
            .log_routine_item(hermes_domain::LogRoutineItemRequest {
                routine_item_id: routine_item.id,
                log_date: Some(today),
                status: hermes_domain::RoutineLogStatus::Completed,
                numeric_value: None,
                notes: String::new(),
            })
            .await
            .expect("log_routine_item as Completed");
        let nudges_after_log = svc
            .get_companion_nudges()
            .await
            .expect("get_companion_nudges after logging routine");
        assert!(
            !nudges_after_log
                .iter()
                .any(|n| n.category == "unlogged_routine"),
            "Expected unlogged_routine nudges to be cleared after Completed log, got {nudges_after_log:?}"
        );

        // 2. Verify Companion Offline Phrases CRUD & sync_change_log mobile delta sync
        let initial_phrases = svc
            .list_companion_phrases(None)
            .await
            .expect("list_companion_phrases");
        assert_eq!(initial_phrases.len(), 8);

        let seq_before = svc.life_ops.latest_server_seq().await.unwrap();
        let created_phrase = svc
            .create_companion_phrase(CreateCompanionPhraseRequest {
                phrase_text: "Even a 1% daily compounding trajectory reshapes a century.".to_string(),
                trigger_context: TriggerContext::TodoDone,
                animation_hint: Some(CompanionAnimationHint::BlueFlowerSpell),
                active: true,
            })
            .await
            .expect("create_companion_phrase");
        assert!(!created_phrase.is_builtin);

        svc.delete_companion_phrase(created_phrase.id)
            .await
            .expect("delete_companion_phrase");

        let pull_deltas = svc.life_ops.sync_pull(seq_before, 20).await.unwrap();
        assert!(pull_deltas.changes.iter().any(|c| {
            c.entity_table == "companion_offline_phrases"
                && c.entity_id == created_phrase.id.to_string()
                && c.op == hermes_domain::SyncOp::Upsert
        }));
        assert!(pull_deltas.changes.iter().any(|c| {
            c.entity_table == "companion_offline_phrases"
                && c.entity_id == created_phrase.id.to_string()
                && c.op == hermes_domain::SyncOp::Delete
        }));

        test_db.teardown().await;
    }
}
