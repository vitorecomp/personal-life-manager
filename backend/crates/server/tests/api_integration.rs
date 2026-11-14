//! Comprehensive End-to-End Integration Suite for `hermes-server` (`F04`–`F17`).
//!
//! Exercises the unified Axum router (`build_router(state)`) over real ephemerally
//! isolated PostgreSQL 16 + `pgvector` schemas (`TestDb`) and isolated temporary
//! directories (`second_brain_dir`, `youtube_lists_db`, `youtube_lists_notes_dir`,
//! `static_dist_dir`).

use std::path::PathBuf;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode, header},
};
use futures::StreamExt;
use hermes_domain::SYSTEM_VERSION;
use hermes_life_ops::test_support::TestDb;
use hermes_server::{AppState, build_router, openapi};
use rusqlite::Connection;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tower::ServiceExt;

async fn send_req(
    app: &Router,
    method: Method,
    uri: &str,
    bearer: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, HeaderMapWrapper, Vec<u8>) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = bearer {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let req_body = if let Some(json_val) = body {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
        Body::from(serde_json::to_vec(&json_val).expect("serialize request body"))
    } else {
        Body::empty()
    };

    let req = builder.body(req_body).expect("build request");
    let resp = app.clone().oneshot(req).await.expect("oneshot response");
    let status = resp.status();
    let headers = HeaderMapWrapper(resp.headers().clone());
    let bytes = to_bytes(resp.into_body(), usize::MAX)
        .await
        .expect("collect response body")
        .to_vec();
    (status, headers, bytes)
}

struct HeaderMapWrapper(axum::http::HeaderMap);

impl HeaderMapWrapper {
    fn content_type(&self) -> String {
        self.0
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string()
    }
}

async fn send_json(
    app: &Router,
    method: Method,
    uri: &str,
    bearer: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let (status, _, bytes) = send_req(app, method, uri, bearer, body).await;
    let val = serde_json::from_slice::<Value>(&bytes).unwrap_or_else(|_| {
        json!({
            "_raw": String::from_utf8_lossy(&bytes).to_string()
        })
    });
    (status, val)
}

#[tokio::test]
async fn f04_f06_f07_csr_spa_openapi_and_auth_pat_contract() {
    let test_db = TestDb::new().await;
    let static_dir = test_db.temp_dir.join("dist");
    std::fs::create_dir_all(static_dir.join("assets")).expect("create dist/assets");
    std::fs::write(
        static_dir.join("index.html"),
        "<!DOCTYPE html><html><head><title>HERMES // OS</title></head><body><div id=\"root\"></div><script type=\"module\" src=\"/assets/app-test.js\"></script></body></html>",
    )
    .expect("write index.html");
    std::fs::write(
        static_dir.join("assets/app-test.js"),
        "console.log('HERMES_CSR_READY');",
    )
    .expect("write asset js");

    let state = AppState::from_test_db(&test_db).with_static_dir(static_dir);
    state
        .life_ops
        .ensure_admin_user()
        .await
        .expect("ensure admin user");
    let app = build_router(state.clone());

    // 1. F04: CSR SPA routes return 200 HTML shell, static assets return 200 JS
    for spa_route in [
        "/",
        "/dashboard",
        "/monitor",
        "/hermes",
        "/knights",
        "/frieren",
        "/todos",
        "/routines",
        "/goals",
        "/courses",
        "/finance",
    ] {
        let (status, headers, bytes) =
            send_req(&app, Method::GET, spa_route, None, None).await;
        assert_eq!(status, StatusCode::OK, "SPA route {spa_route} must be 200");
        assert!(headers.content_type().contains("text/html"));
        let html = String::from_utf8_lossy(&bytes);
        assert!(html.contains("<div id=\"root\"></div>"));
    }

    let (asset_status, _, asset_bytes) =
        send_req(&app, Method::GET, "/assets/app-test.js", None, None).await;
    assert_eq!(asset_status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&asset_bytes).contains("HERMES_CSR_READY"));

    // Missing asset & unknown /api/* must return 404 (never index.html)
    let (missing_asset_status, _, _) =
        send_req(&app, Method::GET, "/assets/does-not-exist.js", None, None).await;
    assert_eq!(missing_asset_status, StatusCode::NOT_FOUND);

    let (unknown_api_status, api_headers, unknown_api_bytes) =
        send_req(&app, Method::GET, "/api/nonexistent-route", None, None).await;
    assert_eq!(unknown_api_status, StatusCode::NOT_FOUND);
    assert!(api_headers.content_type().contains("application/json"));
    let err_json: Value = serde_json::from_slice(&unknown_api_bytes).unwrap();
    assert_eq!(err_json["error"], "not_found");

    // Path traversal probes must be rejected with 400 Bad Request
    for probe in [
        "/..%2f..%2fpackage.json",
        "/..%2F..%2Fpackage.json",
        "/../package.json",
    ] {
        let (probe_status, _, _) = send_req(&app, Method::GET, probe, None, None).await;
        assert_eq!(
            probe_status,
            StatusCode::BAD_REQUEST,
            "Traversal probe {probe} must be rejected"
        );
    }

    // 2. F06: OpenAPI 3.1 contract & byte-for-byte parity with packages/api-client/openapi.json
    let (oa_status, oa_headers, oa_bytes) =
        send_req(&app, Method::GET, "/api/openapi.json", None, None).await;
    assert_eq!(oa_status, StatusCode::OK);
    assert!(oa_headers.content_type().contains("application/json"));
    let oa_str = String::from_utf8(oa_bytes).expect("utf8 openapi");
    assert_eq!(oa_str, openapi::openapi_pretty_json());
    let sdk_openapi_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/api-client/openapi.json");
    let disk_oa = std::fs::read_to_string(sdk_openapi_path).expect("read openapi.json");
    assert_eq!(oa_str, disk_oa);

    // 3. F07: Health, Operator Login, PAT creation, verification, QR pairing & revocation
    let (health_status, health_val) =
        send_json(&app, Method::GET, "/api/health", None, None).await;
    assert_eq!(health_status, StatusCode::OK);
    assert_eq!(health_val["status"], "ok");
    assert_eq!(health_val["db_online"], true);
    assert_eq!(health_val["version"], SYSTEM_VERSION);

    // Unauthenticated /api/auth/verify must return 401
    let (unauth_verify, _) =
        send_json(&app, Method::GET, "/api/auth/verify", None, None).await;
    assert_eq!(unauth_verify, StatusCode::UNAUTHORIZED);

    // Login with invalid password returns 401
    let (bad_login, _) = send_json(
        &app,
        Method::POST,
        "/api/auth/login",
        None,
        Some(json!({ "username": "operator", "password": "wrong-password" })),
    )
    .await;
    assert_eq!(bad_login, StatusCode::UNAUTHORIZED);

    // Login with seeded default password succeeds
    let (ok_login, login_val) = send_json(
        &app,
        Method::POST,
        "/api/auth/login",
        None,
        Some(json!({ "username": "operator", "password": "hermes-os-local" })),
    )
    .await;
    assert_eq!(ok_login, StatusCode::OK);
    assert_eq!(login_val["authenticated"], true);
    assert!(login_val["token"].as_str().unwrap().starts_with("hermes_sess_"));

    // Create PAT
    let (pat_status, pat_val) = send_json(
        &app,
        Method::POST,
        "/api/auth/tokens",
        None,
        Some(json!({ "name": "Test Mobile PAT", "scopes": ["sync", "routines", "todos"] })),
    )
    .await;
    assert_eq!(pat_status, StatusCode::CREATED);
    let raw_pat = pat_val["token"].as_str().unwrap().to_string();
    let pat_id = pat_val["id"].as_str().unwrap().to_string();
    assert!(raw_pat.starts_with("plm_pat_"));

    // List PATs masks raw secret
    let (list_status, list_val) =
        send_json(&app, Method::GET, "/api/auth/tokens", None, None).await;
    assert_eq!(list_status, StatusCode::OK);
    let tokens_arr = list_val.as_array().expect("tokens array");
    assert!(!tokens_arr.is_empty());
    assert!(tokens_arr[0].get("token").is_none());

    // Verify with valid PAT
    let (ver_status, ver_val) = send_json(
        &app,
        Method::GET,
        "/api/auth/verify",
        Some(&raw_pat),
        None,
    )
    .await;
    assert_eq!(ver_status, StatusCode::OK);
    assert_eq!(ver_val["authenticated"], true);

    // Pairing QR generation
    let (qr_status, qr_val) = send_json(
        &app,
        Method::POST,
        "/api/auth/pairing-qr",
        Some(&raw_pat),
        Some(json!({
            "primary_url": "http://100.64.0.1:8080",
            "fallback_url": "http://192.168.1.10:8080",
            "token_name": "Pixel 9 Companion"
        })),
    )
    .await;
    assert_eq!(qr_status, StatusCode::OK);
    assert_eq!(qr_val["primary_url"], "http://100.64.0.1:8080");
    assert!(qr_val["token"].as_str().unwrap().starts_with("plm_pat_"));

    // Revoke PAT and confirm immediate 401 on /api/auth/verify and /api/tasks
    let (rev_status, _) = send_json(
        &app,
        Method::DELETE,
        &format!("/api/auth/tokens/{pat_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(rev_status, StatusCode::OK);

    let (rev_verify, _) = send_json(
        &app,
        Method::GET,
        "/api/auth/verify",
        Some(&raw_pat),
        None,
    )
    .await;
    assert_eq!(rev_verify, StatusCode::UNAUTHORIZED);

    let (rev_tasks, _) = send_json(
        &app,
        Method::GET,
        "/api/tasks",
        Some(&raw_pat),
        None,
    )
    .await;
    assert_eq!(rev_tasks, StatusCode::UNAUTHORIZED);

    test_db.teardown().await;
}

#[tokio::test]
async fn f08_mobile_delta_sync_push_pull_lww_and_scope_guard() {
    let test_db = TestDb::new().await;
    let state = AppState::from_test_db(&test_db);
    state.life_ops.ensure_admin_user().await.unwrap();
    let pat = state
        .life_ops
        .create_pat(hermes_domain::CreatePatRequest {
            name: "Sync Companion".to_string(),
            scopes: vec!["*".to_string()],
        })
        .await
        .unwrap()
        .token;
    let app = build_router(state);

    // Sync without PAT must be rejected with 401
    let (no_auth_status, _) =
        send_json(&app, Method::GET, "/api/sync/pull?since=0", None, None).await;
    assert_eq!(no_auth_status, StatusCode::UNAUTHORIZED);

    // Push a task upsert
    let task_id = hermes_domain::new_uuid_v7().to_string();
    let mutation_id = hermes_domain::new_uuid_v7().to_string();
    let (push_status, push_val) = send_json(
        &app,
        Method::POST,
        "/api/sync/push",
        Some(&pat),
        Some(json!({
            "client_id": "mobile-test",
            "mutations": [{
                "mutation_id": mutation_id,
                "entity_table": "tasks",
                "entity_id": task_id,
                "op": "upsert",
                "payload": {
                    "title": "Offline Mobile Task",
                    "status": "todo",
                    "priority": "p1",
                    "energy_level": "deep"
                },
                "client_updated_at": "2026-11-14T12:00:00Z"
            }]
        })),
    )
    .await;
    assert_eq!(push_status, StatusCode::OK);
    assert_eq!(push_val["applied_count"], 1);

    // Replay same mutation_id -> idempotent (applied_count == 0)
    let (replay_status, replay_val) = send_json(
        &app,
        Method::POST,
        "/api/sync/push",
        Some(&pat),
        Some(json!({
            "client_id": "mobile-test",
            "mutations": [{
                "mutation_id": mutation_id,
                "entity_table": "tasks",
                "entity_id": task_id,
                "op": "upsert",
                "payload": {
                    "title": "Offline Mobile Task",
                    "status": "todo",
                    "priority": "p1"
                },
                "client_updated_at": "2026-11-14T12:00:00Z"
            }]
        })),
    )
    .await;
    assert_eq!(replay_status, StatusCode::OK);
    assert_eq!(replay_val["applied_count"], 0);

    // Pull delta changes since 0
    let (pull_status, pull_val) = send_json(
        &app,
        Method::GET,
        "/api/sync/pull?since=0&limit=100",
        Some(&pat),
        None,
    )
    .await;
    assert_eq!(pull_status, StatusCode::OK);
    let changes = pull_val["changes"].as_array().expect("changes array");
    assert!(changes.iter().any(|c| c["entity_id"] == task_id));

    // Reject out-of-scope table (`portfolio_assets`)
    let (bad_scope_status, _) = send_json(
        &app,
        Method::POST,
        "/api/sync/push",
        Some(&pat),
        Some(json!({
            "client_id": "mobile-test",
            "mutations": [{
                "entity_table": "portfolio_assets",
                "entity_id": hermes_domain::new_uuid_v7().to_string(),
                "op": "upsert",
                "payload": { "ticker": "BTC" }
            }]
        })),
    )
    .await;
    assert!(
        bad_scope_status == StatusCode::BAD_REQUEST
            || bad_scope_status == StatusCode::FORBIDDEN
            || bad_scope_status == StatusCode::UNPROCESSABLE_ENTITY
    );

    test_db.teardown().await;
}

#[tokio::test]
async fn f09_f10_hermes_gateway_chat_sse_and_mcp_autonomy_gate() {
    let test_db = TestDb::new().await;
    let state = AppState::from_test_db(&test_db);
    let app = build_router(state.clone());

    // 1. Create Hermes session, fork it, and stream chat in offline_mock mode
    let (sess_status, sess_val) = send_json(
        &app,
        Method::POST,
        "/api/hermes/sessions",
        None,
        Some(json!({
            "title": "Tactical Briefing",
            "origin": "hermes_view",
            "high_level_mode": true
        })),
    )
    .await;
    assert_eq!(sess_status, StatusCode::CREATED);
    let session_key = sess_val["session_key"].as_str().unwrap().to_string();

    let (fork_status, fork_val) = send_json(
        &app,
        Method::POST,
        &format!("/api/hermes/sessions/{session_key}/fork"),
        None,
        Some(json!({ "title": "Forked Briefing" })),
    )
    .await;
    assert_eq!(fork_status, StatusCode::CREATED);
    assert_eq!(fork_val["parent_session_key"], session_key);

    let (chat_status, chat_headers, chat_bytes) = send_req(
        &app,
        Method::POST,
        "/api/hermes/chat/stream",
        None,
        Some(json!({
            "session_key": session_key,
            "message": "/plan-day Review @today and @goals",
            "high_level_mode": true,
            "mentions": ["@today", "@goals"],
            "slash_command": "/plan-day"
        })),
    )
    .await;
    assert_eq!(chat_status, StatusCode::OK);
    assert!(chat_headers.content_type().contains("text/event-stream"));
    let sse_text = String::from_utf8_lossy(&chat_bytes);
    assert!(sse_text.contains("event: thinking"));
    assert!(sse_text.contains("event: token"));
    assert!(sse_text.contains("event: done"));
    assert!(sse_text.contains("offline_mock"));

    // 2. Live mock hermes gateway listener test
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gw_addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        for _ in 0..4 {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = vec![0u8; 4096];
                let n = stream.read(&mut buf).await.unwrap_or(0);
                let req_str = String::from_utf8_lossy(&buf[..n]);
                if req_str.starts_with("GET /v1/models") || req_str.starts_with("GET /health") {
                    let body = r#"{"status":"ok","data":[{"id":"hermes-3"}]}"#;
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(resp.as_bytes()).await;
                } else {
                    let sse_body = concat!(
                        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"Analyzing live context...\"}}]}\n\n",
                        "data: {\"choices\":[{\"delta\":{\"content\":\"Live Gateway Nominal.\"}}]}\n\n",
                        "data: [DONE]\n\n"
                    );
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{}",
                        sse_body.len(),
                        sse_body
                    );
                    let _ = stream.write_all(resp.as_bytes()).await;
                }
            }
        }
    });

    let online_state = state
        .clone()
        .with_gateway_url(format!("http://{gw_addr}/v1"));
    let online_app = build_router(online_state);
    let (live_status, _, live_bytes) = send_req(
        &online_app,
        Method::POST,
        "/api/hermes/chat/stream",
        None,
        Some(json!({
            "session_key": session_key,
            "message": "Ping live gateway"
        })),
    )
    .await;
    assert_eq!(live_status, StatusCode::OK);
    let live_sse = String::from_utf8_lossy(&live_bytes);
    assert!(live_sse.contains("Live Gateway Nominal."));

    // 3. F10: Native /mcp JSON-RPC & 3-tier autonomy via /api/mcp/call, approvals & undo
    let (tools_status, tools_val) =
        send_json(&app, Method::GET, "/api/mcp/tools", None, None).await;
    assert_eq!(tools_status, StatusCode::OK);
    assert_eq!(tools_val.as_array().unwrap().len(), 61);

    // Tier 2 (IMMEDIATE_UNDO): todos_create_task -> undo via /api/mcp/undo/{id}
    let (call_status, call_val) = send_json(
        &app,
        Method::POST,
        "/api/mcp/call",
        None,
        Some(json!({
            "name": "todos_create_task",
            "arguments": {
                "title": "MCP Created Task",
                "priority": "p1"
            }
        })),
    )
    .await;
    assert_eq!(call_status, StatusCode::OK);
    assert_eq!(call_val["status"], "executed");
    let undo_id = call_val["undo_id"].as_str().unwrap().to_string();

    let (undo_status, undo_val) = send_json(
        &app,
        Method::POST,
        &format!("/api/mcp/undo/{undo_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(undo_status, StatusCode::OK);
    assert_eq!(undo_val["reverted"], true);

    // Second undo of the same action must fail with 400/409
    let (undo_again_status, _) = send_json(
        &app,
        Method::POST,
        &format!("/api/mcp/undo/{undo_id}"),
        None,
        None,
    )
    .await;
    assert!(
        undo_again_status == StatusCode::BAD_REQUEST || undo_again_status == StatusCode::CONFLICT
    );

    // Tier 3 (REQUIRE_APPROVAL): finance_add_asset ALWAYS requires approval
    let (fin_call_status, fin_call_val) = send_json(
        &app,
        Method::POST,
        "/api/mcp/call",
        None,
        Some(json!({
            "name": "finance_add_asset",
            "arguments": {
                "symbol": "NVDA",
                "name": "NVIDIA Corp",
                "asset_class": "us_equities",
                "currency": "USD",
                "quantity": "10",
                "avg_cost_cents": 10000,
                "current_price_cents": 12500
            }
        })),
    )
    .await;
    assert_eq!(fin_call_status, StatusCode::OK);
    assert_eq!(fin_call_val["status"], "pending_approval");
    let approval_id = fin_call_val["approval_id"].as_str().unwrap().to_string();

    // Approve pending action -> executes asset creation
    let (approve_status, approve_val) = send_json(
        &app,
        Method::POST,
        &format!("/api/mcp/approvals/{approval_id}/approve"),
        None,
        Some(json!({})),
    )
    .await;
    assert_eq!(approve_status, StatusCode::OK);
    assert_eq!(approve_val["status"], "approved");

    let (assets_status, assets_val) =
        send_json(&app, Method::GET, "/api/finance/assets", None, None).await;
    assert_eq!(assets_status, StatusCode::OK);
    assert!(
        assets_val
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["symbol"] == "NVDA")
    );

    test_db.teardown().await;
}

#[tokio::test]
async fn f11_f12_dashboards_sse_knights_vault_and_companion() {
    let test_db = TestDb::new().await;
    let state = AppState::from_test_db(&test_db);
    let app = build_router(state.clone());

    // 1. F11: Dashboards, Widgets, Life Score, Server Prober & SSE
    let (decks_status, decks_val) =
        send_json(&app, Method::GET, "/api/dashboards", None, None).await;
    assert_eq!(decks_status, StatusCode::OK);
    assert!(decks_val.as_array().unwrap().len() >= 3);

    // cycle_seconds: 1 is clamped to 5 and succeeds; cycle_seconds: 0 is rejected with 400
    let (create_deck_status, created_deck) = send_json(
        &app,
        Method::POST,
        "/api/dashboards",
        None,
        Some(json!({
            "title": "Custom Ops Deck",
            "cycle_seconds": 1
        })),
    )
    .await;
    assert_eq!(create_deck_status, StatusCode::CREATED);
    let deck_id = created_deck["id"].as_str().unwrap().to_string();
    assert_eq!(created_deck["cycle_seconds"], 5);

    let (bad_deck_status, _) = send_json(
        &app,
        Method::POST,
        "/api/dashboards",
        None,
        Some(json!({
            "title": "Bad Cycle Deck",
            "cycle_seconds": 0
        })),
    )
    .await;
    assert_eq!(bad_deck_status, StatusCode::BAD_REQUEST);

    // Add widget & update via flat /api/widgets/{widget_id}
    let (w_status, w_val) = send_json(
        &app,
        Method::POST,
        &format!("/api/dashboards/{deck_id}/widgets"),
        None,
        Some(json!({
            "title": "Active Tasks KPI",
            "source_kind": "builtin",
            "renderer_kind": "kpi",
            "grid_rect": { "x": 0, "y": 0, "w": 4, "h": 2 },
            "source_config": { "metric": "tasks_today" }
        })),
    )
    .await;
    assert_eq!(w_status, StatusCode::CREATED);
    let widget_id = w_val["id"].as_str().unwrap().to_string();

    let (flat_upd_status, flat_upd_val) = send_json(
        &app,
        Method::PUT,
        &format!("/api/widgets/{widget_id}"),
        None,
        Some(json!({
            "title": "Updated KPI Widget",
            "grid_rect": { "x": 2, "y": 0, "w": 4, "h": 2 }
        })),
    )
    .await;
    assert_eq!(flat_upd_status, StatusCode::OK);
    assert_eq!(flat_upd_val["title"], "Updated KPI Widget");

    // Life Score
    let (ls_status, ls_val) =
        send_json(&app, Method::GET, "/api/telemetry/life-score", None, None).await;
    assert_eq!(ls_status, StatusCode::OK);
    assert!(ls_val["score"].as_i64().is_some());
    assert!(ls_val["composite_score"].as_f64().is_some());

    // SSE stream emits immediate connected event
    let sse_req = Request::builder()
        .method(Method::GET)
        .uri("/api/events/stream")
        .body(Body::empty())
        .unwrap();
    let sse_resp = app.clone().oneshot(sse_req).await.unwrap();
    assert_eq!(sse_resp.status(), StatusCode::OK);
    let mut body_stream = sse_resp.into_body().into_data_stream();
    let first_chunk = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        body_stream.next(),
    )
    .await
    .expect("SSE chunk timeout")
    .expect("SSE stream item")
    .expect("SSE chunk bytes");
    let first_str = String::from_utf8_lossy(&first_chunk);
    assert!(first_str.contains("connected"));

    // 2. F12: Agent Studio Knights, Triggers, Dispatch, Vault & Companion
    let (agents_status, agents_val) =
        send_json(&app, Method::GET, "/api/agents", None, None).await;
    assert_eq!(agents_status, StatusCode::OK);
    let agents = agents_val.as_array().unwrap();
    assert!(agents.len() >= 4);
    let knight_id = agents[0]["id"].as_str().unwrap().to_string();

    // Invalid cron trigger must return 400
    let (bad_trig_status, _) = send_json(
        &app,
        Method::POST,
        &format!("/api/agents/{knight_id}/triggers"),
        None,
        Some(json!({
            "trigger_type": "cron",
            "cron_expr": "not-a-valid-cron"
        })),
    )
    .await;
    assert_eq!(bad_trig_status, StatusCode::BAD_REQUEST);

    // Dry-run dispatch
    let (disp_status, disp_val) = send_json(
        &app,
        Method::POST,
        &format!("/api/agents/{knight_id}/dispatch"),
        None,
        Some(json!({ "dry_run": true })),
    )
    .await;
    assert_eq!(disp_status, StatusCode::OK);
    assert_eq!(disp_val["is_dry_run"], true);

    // Distill note to Vault & read back
    let (dist_status, dist_val) = send_json(
        &app,
        Method::POST,
        "/api/vault/distill",
        None,
        Some(json!({
            "title": "Rust Axum Architecture",
            "content_md": "# Rust Axum\nZero-border-radius Tactical FUI backend.",
            "tags": ["rust", "axum"]
        })),
    )
    .await;
    assert_eq!(dist_status, StatusCode::CREATED);
    let rel_path = dist_val["vault_note_path"].as_str().unwrap().to_string();

    let (note_status, note_val) = send_json(
        &app,
        Method::GET,
        &format!("/api/vault/note?path={rel_path}"),
        None,
        None,
    )
    .await;
    assert_eq!(note_status, StatusCode::OK);
    assert!(note_val["content_md"].as_str().unwrap().contains("Rust Axum"));

    // Companion nudges & phrases (create a due-today task first so a proactive nudge is emitted)
    let (nudge_task_status, _) = send_json(
        &app,
        Method::POST,
        "/api/tasks",
        None,
        Some(json!({ "quick_capture": "Check Frieren telemetry today !p1" })),
    )
    .await;
    assert_eq!(nudge_task_status, StatusCode::CREATED);

    let (nudges_status, nudges_val) =
        send_json(&app, Method::GET, "/api/companion/nudges", None, None).await;
    assert_eq!(nudges_status, StatusCode::OK);
    assert!(!nudges_val.as_array().unwrap().is_empty());

    let (phrases_status, phrases_val) =
        send_json(&app, Method::GET, "/api/companion/phrases", None, None).await;
    assert_eq!(phrases_status, StatusCode::OK);
    assert!(phrases_val.as_array().unwrap().len() >= 6);

    let (create_phrase_status, created_phrase) = send_json(
        &app,
        Method::POST,
        "/api/companion/phrases",
        None,
        Some(json!({
            "phrase_text": "Even a 10-minute review compounds over a century.",
            "trigger_context": "tap"
        })),
    )
    .await;
    assert_eq!(create_phrase_status, StatusCode::CREATED);
    assert_eq!(created_phrase["trigger_context"], "tap");

    test_db.teardown().await;
}

#[tokio::test]
async fn f13_f14_f15_f16_f17_life_ops_domains_and_readonly_crawler_sqlite() {
    let test_db = TestDb::new().await;

    // Seed an isolated temporary YouTube crawler SQLite database + Markdown notes
    {
        let conn = Connection::open(&test_db.youtube_lists_db).expect("create temp sqlite");
        conn.execute_batch(
            r#"
            CREATE TABLE playlists (
                playlist_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                channel_title TEXT NOT NULL
            );
            CREATE TABLE videos (
                video_id TEXT PRIMARY KEY,
                playlist_id TEXT NOT NULL,
                title TEXT NOT NULL,
                position INTEGER NOT NULL,
                duration_seconds INTEGER NOT NULL,
                url TEXT NOT NULL
            );
            INSERT INTO playlists VALUES ('PL_RUST_101', 'Systems Programming in Rust', 'Jon Gjengset');
            INSERT INTO videos VALUES ('vid_01', 'PL_RUST_101', 'Crust of Rust: Lifetimes', 1, 3600, 'https://youtu.be/vid_01');
            INSERT INTO videos VALUES ('vid_02', 'PL_RUST_101', 'Crust of Rust: Channels', 2, 4200, 'https://youtu.be/vid_02');
            "#,
        )
        .expect("seed temp sqlite");
    }
    let playlist_notes_dir = test_db.youtube_lists_notes_dir.join("PL_RUST_101");
    std::fs::create_dir_all(&playlist_notes_dir).expect("create playlist notes dir");
    std::fs::write(
        playlist_notes_dir.join("vid_01.md"),
        "# Lifetimes Summary\nVariance and subtyping.",
    )
    .expect("write note");

    let sqlite_bytes_before =
        std::fs::read(&test_db.youtube_lists_db).expect("read sqlite before");
    let hash_before = hex::encode(Sha256::digest(&sqlite_bytes_before));

    let state = AppState::from_test_db(&test_db);
    let app = build_router(state);

    // 1. F13: Projects, Tasks, Quick Capture, DAG cycle rejection & Focus Timer
    let (parse_status, parse_val) = send_json(
        &app,
        Method::POST,
        "/api/tasks/parse",
        None,
        Some(json!({
            "raw_input": "Ship M2D server #hermes !urgent ~45m @deep tomorrow"
        })),
    )
    .await;
    assert_eq!(parse_status, StatusCode::OK);
    assert_eq!(parse_val["priority"], "urgent");
    assert_eq!(parse_val["estimated_minutes"], 45);

    let (t1_status, t1_val) = send_json(
        &app,
        Method::POST,
        "/api/tasks",
        None,
        Some(json!({ "title": "Task Alpha", "priority": "p1", "estimated_minutes": 30 })),
    )
    .await;
    assert_eq!(t1_status, StatusCode::CREATED);
    let t1_id = t1_val["id"].as_str().unwrap().to_string();

    let (t2_status, t2_val) = send_json(
        &app,
        Method::POST,
        "/api/tasks",
        None,
        Some(json!({
            "title": "Task Beta",
            "priority": "p1",
            "blocked_by": [t1_id]
        })),
    )
    .await;
    assert_eq!(t2_status, StatusCode::CREATED);
    let t2_id = t2_val["id"].as_str().unwrap().to_string();

    // Self-dependency or circular dependency must be rejected (422 CYCLE_DETECTED / 400 / 409)
    let (cycle_status, cycle_val) = send_json(
        &app,
        Method::PUT,
        &format!("/api/tasks/{t1_id}"),
        None,
        Some(json!({ "blocked_by": [t2_id] })),
    )
    .await;
    assert!(
        cycle_status == StatusCode::UNPROCESSABLE_ENTITY
            || cycle_status == StatusCode::BAD_REQUEST
            || cycle_status == StatusCode::CONFLICT
    );
    assert_eq!(cycle_val["error"], "CYCLE_DETECTED");

    // Start & stop focus timer
    let (start_status, _) = send_json(
        &app,
        Method::POST,
        "/api/time-sessions/start",
        None,
        Some(json!({ "task_id": t1_id, "mode": "pomodoro" })),
    )
    .await;
    assert_eq!(start_status, StatusCode::OK);

    let (stop_status, stop_val) = send_json(
        &app,
        Method::POST,
        "/api/time-sessions/stop",
        None,
        Some(json!({ "duration_seconds": 1500, "notes": "Completed Pomodoro" })),
    )
    .await;
    assert_eq!(stop_status, StatusCode::OK);
    assert_eq!(stop_val["duration_seconds"], 1500);

    // 2. F14: Routines, Day Profile, Checkins & Weekly Review Vault Export
    let (create_routine_status, created_routine) = send_json(
        &app,
        Method::POST,
        "/api/routines",
        None,
        Some(json!({
            "name": "Morning Tactical Stack",
            "time_slot": "morning",
            "day_profile": "all"
        })),
    )
    .await;
    assert_eq!(create_routine_status, StatusCode::CREATED);
    let routine_id = created_routine["id"].as_str().unwrap().to_string();

    let (create_item_status, created_item) = send_json(
        &app,
        Method::POST,
        &format!("/api/routines/{routine_id}/items"),
        None,
        Some(json!({
            "title": "Hydrate & Review OKRs",
            "tracking_type": "boolean",
            "frequency_type": "daily"
        })),
    )
    .await;
    assert_eq!(create_item_status, StatusCode::CREATED);
    let first_item_id = created_item["id"].as_str().unwrap().to_string();

    let (log_status, _) = send_json(
        &app,
        Method::POST,
        "/api/routines/logs",
        None,
        Some(json!({
            "routine_item_id": first_item_id,
            "status": "done",
            "day_profile_used": "weekday"
        })),
    )
    .await;
    assert_eq!(log_status, StatusCode::OK);

    let (rev_status, rev_val) =
        send_json(&app, Method::GET, "/api/reviews/weekly", None, None).await;
    assert_eq!(rev_status, StatusCode::OK);
    assert!(rev_val["vault_export_path"].as_str().is_some());

    // 3. F15: Goals, Key Results & Q1-Q4 Blueprint
    let (goal_status, goal_val) = send_json(
        &app,
        Method::POST,
        "/api/goals",
        None,
        Some(json!({
            "title": "Launch HERMES // OS v1.0",
            "pillar": "career_craft",
            "status": "active",
            "quarter": "Q4",
            "cycle_year": 2026
        })),
    )
    .await;
    assert_eq!(goal_status, StatusCode::CREATED);
    let goal_id = goal_val["id"].as_str().unwrap().to_string();

    let (kr_status, kr_val) = send_json(
        &app,
        Method::POST,
        &format!("/api/goals/{goal_id}/key-results"),
        None,
        Some(json!({
            "title": "Pass all E2E suites",
            "start_value": "0",
            "current_value": "50",
            "target_value": "100",
            "weight": "1.0"
        })),
    )
    .await;
    assert_eq!(kr_status, StatusCode::CREATED);
    assert!(kr_val["id"].as_str().is_some());

    let (bp_status, bp_val) = send_json(
        &app,
        Method::GET,
        "/api/goals/blueprint?year=2026",
        None,
        None,
    )
    .await;
    assert_eq!(bp_status, StatusCode::OK);
    assert_eq!(bp_val["year"], 2026);
    assert!(bp_val["nodes"].as_array().is_some());

    // 4. F16: Course Tracker & Strictly Read-Only YouTube Import + Spaced Review
    let (yt_status, yt_val) = send_json(
        &app,
        Method::GET,
        "/api/courses/youtube-playlists",
        None,
        None,
    )
    .await;
    assert_eq!(yt_status, StatusCode::OK);
    assert_eq!(yt_val["db_available"], true);
    assert_eq!(yt_val["playlists"][0]["playlist_id"], "PL_RUST_101");

    let (imp_status, imp_val) = send_json(
        &app,
        Method::POST,
        "/api/courses/import-youtube",
        None,
        Some(json!({
            "playlist_id": "PL_RUST_101",
            "goal_id": goal_id
        })),
    )
    .await;
    assert_eq!(imp_status, StatusCode::CREATED);
    let lesson_id = imp_val["modules"][0]["lessons"][1]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Complete lesson -> schedules spaced review (stage 0 -> 7d)
    let (done_lesson_status, done_lesson_val) = send_json(
        &app,
        Method::PATCH,
        &format!("/api/courses/lessons/{lesson_id}/status"),
        None,
        Some(json!({ "status": "done" })),
    )
    .await;
    assert_eq!(done_lesson_status, StatusCode::OK);
    assert_eq!(done_lesson_val["review_stage"], 0);
    assert!(done_lesson_val["next_review_date"].is_string());

    // Advance review stage (`advance` -> stage 1)
    let (rev_lesson_status, rev_lesson_val) = send_json(
        &app,
        Method::POST,
        &format!("/api/courses/reviews/{lesson_id}/complete"),
        None,
        Some(json!({ "action": "advance" })),
    )
    .await;
    assert_eq!(rev_lesson_status, StatusCode::OK);
    assert_eq!(rev_lesson_val["review_stage"], 1);

    // Verify SQLite file was NEVER modified (byte-for-byte SHA-256 match)
    let sqlite_bytes_after =
        std::fs::read(&test_db.youtube_lists_db).expect("read sqlite after");
    let hash_after = hex::encode(Sha256::digest(&sqlite_bytes_after));
    assert_eq!(
        hash_before, hash_after,
        "youtube-lists.sqlite must be opened strictly read-only and never mutated"
    );

    // 5. F17: Multi-Market Finance, Allocation, Monthly Plan & FIRE Simulator
    let (asset_status, asset_val) = send_json(
        &app,
        Method::POST,
        "/api/finance/assets",
        None,
        Some(json!({
            "ticker": "PETR4",
            "name": "Petrobras PN",
            "asset_class": "br_equities",
            "currency": "BRL",
            "quantity": "100",
            "avg_cost_cents": 3500,
            "current_price_cents": 3850
        })),
    )
    .await;
    assert_eq!(asset_status, StatusCode::CREATED);
    let asset_id = asset_val["id"].as_str().unwrap().to_string();

    // Negative quantity must be rejected with 400
    let (neg_qty_status, _) = send_json(
        &app,
        Method::POST,
        "/api/finance/assets",
        None,
        Some(json!({
            "ticker": "BAD",
            "name": "Bad Asset",
            "asset_class": "cash",
            "currency": "USD",
            "quantity": "-5",
            "avg_cost_cents": 100,
            "current_price_cents": 100
        })),
    )
    .await;
    assert_eq!(neg_qty_status, StatusCode::BAD_REQUEST);

    let (candles_status, candles_val) = send_json(
        &app,
        Method::GET,
        &format!("/api/finance/assets/{asset_id}/candles?range=30D"),
        None,
        None,
    )
    .await;
    assert_eq!(candles_status, StatusCode::OK);
    assert!(!candles_val["candles"].as_array().unwrap().is_empty());

    let (alloc_status, alloc_val) = send_json(
        &app,
        Method::GET,
        "/api/finance/allocation?base_currency=BRL",
        None,
        None,
    )
    .await;
    assert_eq!(alloc_status, StatusCode::OK);
    assert!(alloc_val["total_brl_cents"].as_i64().unwrap() > 0);

    // FIRE simulation: swr_pct == 0 rejected with 400; valid simulation returns 200
    let (bad_fire_status, _) = send_json(
        &app,
        Method::POST,
        "/api/finance/retirement/simulate",
        None,
        Some(json!({ "swr_pct": "0" })),
    )
    .await;
    assert_eq!(bad_fire_status, StatusCode::BAD_REQUEST);

    let (ok_fire_status, ok_fire_val) = send_json(
        &app,
        Method::POST,
        "/api/finance/retirement/simulate",
        None,
        Some(json!({ "swr_pct": "4.0" })),
    )
    .await;
    assert_eq!(ok_fire_status, StatusCode::OK);
    assert!(!ok_fire_val["trajectory"].as_array().unwrap().is_empty());

    test_db.teardown().await;
}

#[tokio::test]
async fn m2d_reviewer_and_challenger_regressions() {
    let test_db = TestDb::new().await;
    let state = AppState::from_test_db(&test_db);
    let app = build_router(state.clone());

    // -------------------------------------------------------------------------
    // Part A: m2d_reviewer_2 Findings 1–5
    // -------------------------------------------------------------------------

    // 1. Vault tree, reindex, and path-based note retrieval
    let (distill_status, distill_val) = send_json(
        &app,
        Method::POST,
        "/api/vault/distill",
        None,
        Some(json!({
            "title": "M2D Regression Note",
            "content_md": "# M2D\nVault tree and reindex verification.",
            "content": "# M2D\nVault tree and reindex verification.",
            "markdown": "# M2D\nVault tree and reindex verification."
        })),
    )
    .await;
    assert_eq!(distill_status, StatusCode::CREATED);
    let note_path = distill_val["vault_note_path"].as_str().unwrap();

    let (tree_status, tree_val) =
        send_json(&app, Method::GET, "/api/vault/tree", None, None).await;
    assert_eq!(tree_status, StatusCode::OK);
    assert!(tree_val["notes"].as_array().unwrap().len() >= 1);

    let (reindex_status, reindex_val) =
        send_json(&app, Method::POST, "/api/vault/reindex", None, Some(json!({}))).await;
    assert_eq!(reindex_status, StatusCode::OK);
    assert_eq!(reindex_val["status"], "ok");

    let encoded_path = note_path.replace('/', "%2F");
    let (note_by_path_status, note_by_path_val) = send_json(
        &app,
        Method::GET,
        &format!("/api/vault/notes/{encoded_path}"),
        None,
        None,
    )
    .await;
    assert_eq!(note_by_path_status, StatusCode::OK);
    assert!(note_by_path_val["content_md"]
        .as_str()
        .unwrap()
        .contains("Vault tree and reindex verification"));

    // 2. Companion state & nudge dismissal
    let (comp_state_status, comp_state_val) =
        send_json(&app, Method::GET, "/api/companion/state", None, None).await;
    assert_eq!(comp_state_status, StatusCode::OK);
    assert!(comp_state_val["mood"].as_str().is_some());
    assert!(comp_state_val["active_nudges"].is_array());

    // Create an overdue task so at least 1 nudge is guaranteed, then dismiss it
    let (_, overdue_task) = send_json(
        &app,
        Method::POST,
        "/api/tasks",
        None,
        Some(json!({
            "title": "Overdue Nudge Task",
            "scheduled_date": "2020-01-01"
        })),
    )
    .await;
    let overdue_task_id = overdue_task["id"].as_str().unwrap();

    let (nudges_status, nudges_val) =
        send_json(&app, Method::GET, "/api/companion/nudges", None, None).await;
    assert_eq!(nudges_status, StatusCode::OK);
    let nudges_arr = nudges_val.as_array().unwrap();
    assert!(nudges_arr.iter().any(|n| n["id"] == overdue_task_id));

    let (dismiss_status, dismiss_val) = send_json(
        &app,
        Method::POST,
        &format!("/api/companion/nudges/{overdue_task_id}/dismiss"),
        None,
        Some(json!({})),
    )
    .await;
    assert_eq!(dismiss_status, StatusCode::OK);
    assert_eq!(dismiss_val["dismissed"], true);

    let (_, nudges_after) =
        send_json(&app, Method::GET, "/api/companion/nudges", None, None).await;
    assert!(!nudges_after
        .as_array()
        .unwrap()
        .iter()
        .any(|n| n["id"] == overdue_task_id));

    // 3. Task perspectives & project flow by ID
    let (persp_status, persp_val) = send_json(
        &app,
        Method::GET,
        "/api/tasks/perspectives/today",
        None,
        None,
    )
    .await;
    assert_eq!(persp_status, StatusCode::OK);
    assert!(persp_val.is_array());

    let (_, proj_val) = send_json(
        &app,
        Method::POST,
        "/api/projects",
        None,
        Some(json!({ "name": "Flow Project" })),
    )
    .await;
    let proj_id = proj_val["id"].as_str().unwrap();

    let (proj_flow_status, proj_flow_val) = send_json(
        &app,
        Method::GET,
        &format!("/api/projects/{proj_id}/flow"),
        None,
        None,
    )
    .await;
    assert_eq!(proj_flow_status, StatusCode::OK);
    assert!(proj_flow_val["nodes"].is_array());

    // 4. Routine logs GET & Weekly Review by week_key (PUT/GET/POST export)
    let (rlogs_status, rlogs_val) = send_json(
        &app,
        Method::GET,
        "/api/routines/logs?date=2026-11-14",
        None,
        None,
    )
    .await;
    assert_eq!(rlogs_status, StatusCode::OK);
    assert!(rlogs_val.is_array());

    let (put_rev_status, put_rev_val) = send_json(
        &app,
        Method::PUT,
        "/api/reviews/2026-W46",
        None,
        Some(json!({
            "wins_md": "Completed 14 deep work blocks",
            "challenges_md": "Late-night context switching",
            "adjustments_md": "Enforce 21:30 shutdown ritual"
        })),
    )
    .await;
    assert_eq!(put_rev_status, StatusCode::OK);
    assert_eq!(put_rev_val["week_key"], "2026-W46");
    assert_eq!(put_rev_val["wins_md"], "Completed 14 deep work blocks");

    let (get_rev_status, get_rev_val) =
        send_json(&app, Method::GET, "/api/reviews/2026-W46", None, None).await;
    assert_eq!(get_rev_status, StatusCode::OK);
    assert_eq!(get_rev_val["wins_md"], "Completed 14 deep work blocks");

    let (exp_rev_status, exp_rev_val) = send_json(
        &app,
        Method::POST,
        "/api/reviews/2026-W46/export",
        None,
        Some(json!({})),
    )
    .await;
    assert_eq!(exp_rev_status, StatusCode::OK);
    assert_eq!(exp_rev_val["vault_export_path"], "Reviews/2026-W46.md");

    // 5. PUT /api/goals/cycles/{year} upserts on non-existent year & supports vision_markdown / anti_goals_markdown
    let (cycle_status, cycle_val) = send_json(
        &app,
        Method::PUT,
        "/api/goals/cycles/2031",
        None,
        Some(json!({
            "theme": "Year of Autonomous Systems",
            "vision_md": "Build resilient local-first life infrastructure.",
            "vision_markdown": "Build resilient local-first life infrastructure.",
            "anti_goals_md": "No unreviewed recurring subscriptions.",
            "anti_goals_markdown": "No unreviewed recurring subscriptions.",
            "focus_cap_limit": 3,
            "focus_cap": 3
        })),
    )
    .await;
    assert_eq!(cycle_status, StatusCode::OK);
    assert_eq!(cycle_val["year"], 2031);
    assert_eq!(cycle_val["theme"], "Year of Autonomous Systems");
    assert_eq!(
        cycle_val["vision_md"],
        "Build resilient local-first life infrastructure."
    );
    assert_eq!(
        cycle_val["anti_goals_md"],
        "No unreviewed recurring subscriptions."
    );
    assert_eq!(cycle_val["focus_cap_limit"], 3);

    // 6. GET /api/finance/retirement returns FireProjectionResponse & GET /api/finance/allocation accepts investable_surplus_cents
    let (ret_status, ret_val) =
        send_json(&app, Method::GET, "/api/finance/retirement", None, None).await;
    assert_eq!(ret_status, StatusCode::OK);
    assert!(ret_val["fire_number_cents"].as_i64().is_some());
    assert!(ret_val["trajectory"].is_array());
    assert!(ret_val["config"].is_object());

    // Seed an asset so allocation has a non-empty portfolio
    let _ = send_json(
        &app,
        Method::POST,
        "/api/finance/assets",
        None,
        Some(json!({
            "symbol": "ITUB4",
            "name": "Itau Unibanco",
            "asset_class": "br_equity",
            "currency": "BRL",
            "quantity": "50",
            "avg_cost_cents": 3000,
            "current_price_cents": 3200,
            "target_weight_pct": "100"
        })),
    )
    .await;

    let (alloc_surplus_status, alloc_surplus_val) = send_json(
        &app,
        Method::GET,
        "/api/finance/allocation?investable_surplus_cents=500000",
        None,
        None,
    )
    .await;
    assert_eq!(alloc_surplus_status, StatusCode::OK);
    assert_eq!(alloc_surplus_val["new_contribution_cents"], 500000);
    assert!(
        alloc_surplus_val["recommendations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["recommended_buy_cents"].as_i64().unwrap_or(0) > 0)
    );

    // -------------------------------------------------------------------------
    // Part B: m2d_challenger_2 11 Multi-Field Alias Deduplication Payloads
    // -------------------------------------------------------------------------

    // Challenger 1: POST /api/courses/youtube/import with playlist_id + youtube_playlist_id + title_override + course_title + title
    // (When SQLite DB is absent on disk, returns 404 NotFound rather than 400 duplicate field)
    let (yt_imp_status, yt_imp_val) = send_json(
        &app,
        Method::POST,
        "/api/courses/youtube/import",
        None,
        Some(json!({
            "playlist_id": "PL123",
            "youtube_playlist_id": "PL123",
            "title_override": "Rust",
            "course_title": "Rust",
            "title": "Rust"
        })),
    )
    .await;
    assert_ne!(
        yt_imp_status,
        StatusCode::BAD_REQUEST,
        "Must not fail with 400 duplicate field: {yt_imp_val}"
    );

    // Challenger 2 & GET /api/courses/{id}/quizzes: POST /api/courses/{id}/import-outline with outline_md + outline
    let (_, course_created) = send_json(
        &app,
        Method::POST,
        "/api/courses",
        None,
        Some(json!({ "title": "Alias Course", "provider": "custom" })),
    )
    .await;
    let cid = course_created["course"]["id"].as_str().unwrap();

    let (outline_status, _) = send_json(
        &app,
        Method::POST,
        &format!("/api/courses/{cid}/import-outline"),
        None,
        Some(json!({
            "outline_md": "# Mod 1\n- Lesson 1 (15m)",
            "outline": "# Mod 1\n- Lesson 1 (15m)"
        })),
    )
    .await;
    assert_eq!(outline_status, StatusCode::OK);

    let (quiz_post_status, _) = send_json(
        &app,
        Method::POST,
        &format!("/api/courses/{cid}/quizzes"),
        None,
        Some(json!({
            "questions_json": [{"q": "What is ownership?"}],
            "questions": [{"q": "What is ownership?"}]
        })),
    )
    .await;
    assert_eq!(quiz_post_status, StatusCode::CREATED);

    let (quiz_get_status, quiz_get_val) = send_json(
        &app,
        Method::GET,
        &format!("/api/courses/{cid}/quizzes"),
        None,
        None,
    )
    .await;
    assert_eq!(quiz_get_status, StatusCode::OK);
    assert_eq!(quiz_get_val.as_array().unwrap().len(), 1);

    // Challenger 3: POST /api/finance/assets with all canonical + alias pairs
    let (ch3_status, _) = send_json(
        &app,
        Method::POST,
        "/api/finance/assets",
        None,
        Some(json!({
            "symbol": "WEGE3",
            "ticker": "WEGE3",
            "name": "WEG",
            "asset_class": "br_equity",
            "currency": "BRL",
            "quantity": "10",
            "avg_cost_cents": 3500,
            "average_cost_cents": 3500,
            "current_price_cents": 4000,
            "last_price_cents": 4000,
            "target_weight_pct": "10",
            "target_pct": "10",
            "alert_low_cents": 3000,
            "alert_below_cents": 3000,
            "alert_high_cents": 5000,
            "alert_above_cents": 5000
        })),
    )
    .await;
    assert_eq!(ch3_status, StatusCode::CREATED);

    // Challenger 4: PUT /api/finance/sheets/2026-11 with all canonical + alias pairs
    let (ch4_status, _) = send_json(
        &app,
        Method::PUT,
        "/api/finance/sheets/2026-11",
        None,
        Some(json!({
            "salary_income_cents": 2000000,
            "net_salary_cents": 2000000,
            "planned_spend_cents": 1000000,
            "planned_living_spend_cents": 1000000,
            "actual_spend_cents": 950000,
            "actual_living_spend_cents": 950000,
            "planned_investment_cents": 1000000,
            "actual_invested_cents": 1050000,
            "actual_investment_cents": 1050000
        })),
    )
    .await;
    assert_eq!(ch4_status, StatusCode::OK);

    // Challenger 5: POST /api/finance/retirement/simulate with all canonical + alias pairs
    let (ch5_status, _) = send_json(
        &app,
        Method::POST,
        "/api/finance/retirement/simulate",
        None,
        Some(json!({
            "monthly_contribution_brl_cents": 800000,
            "monthly_investment_cents": 800000,
            "new_contribution_cents": 800000,
            "monthly_retirement_spend_brl_cents": 1500000,
            "monthly_spend_cents": 1500000,
            "expected_real_return_pct": "6.0",
            "real_return_pct": "6.0",
            "safe_withdrawal_rate_pct": "4.0",
            "swr_pct": "4.0"
        })),
    )
    .await;
    assert_eq!(ch5_status, StatusCode::OK);

    // Challenger 6: POST /api/routines/logs with routine_item_id + item_id and log_date + date
    let (_, created_routine) = send_json(
        &app,
        Method::POST,
        "/api/routines",
        None,
        Some(json!({
            "name": "Alias Routine",
            "time_slot": "morning",
            "day_profile": "all"
        })),
    )
    .await;
    let routine_id = created_routine["id"].as_str().unwrap();
    let (_, created_item) = send_json(
        &app,
        Method::POST,
        &format!("/api/routines/{routine_id}/items"),
        None,
        Some(json!({ "title": "Alias Habit" })),
    )
    .await;
    let first_item_id = created_item["id"].as_str().unwrap();

    let (ch6_status, _) = send_json(
        &app,
        Method::POST,
        "/api/routines/logs",
        None,
        Some(json!({
            "routine_item_id": first_item_id,
            "item_id": first_item_id,
            "log_date": "2026-11-14",
            "date": "2026-11-14",
            "status": "completed"
        })),
    )
    .await;
    assert_eq!(ch6_status, StatusCode::OK);

    // Challenger 7: PUT /api/routines/checkins/2026-11-14 with all canonical + alias pairs
    let (ch7_status, _) = send_json(
        &app,
        Method::PUT,
        "/api/routines/checkins/2026-11-14",
        None,
        Some(json!({
            "day_profile_used": "weekday",
            "day_profile": "weekday",
            "highlight": "Shipped M2D",
            "highlights_md": "Shipped M2D",
            "blocker": "None",
            "blockers_md": "None",
            "reflection_md": "Good pace",
            "notes_md": "Good pace"
        })),
    )
    .await;
    assert_eq!(ch7_status, StatusCode::OK);

    // Challenger 8: POST /api/tasks/quick-capture with raw + input + text (without raw_input)
    let (ch8_status, ch8_val) = send_json(
        &app,
        Method::POST,
        "/api/tasks/quick-capture",
        None,
        Some(json!({
            "raw": "Pay rent !p1 @finance tomorrow",
            "input": "Pay rent !p1 @finance tomorrow",
            "text": "Pay rent !p1 @finance tomorrow"
        })),
    )
    .await;
    assert_eq!(ch8_status, StatusCode::OK);
    assert_eq!(ch8_val["priority"], "urgent");
    assert!(ch8_val["clean_title"].as_str().unwrap().starts_with("Pay rent"));

    // Challenger 9: POST /api/hermes/chat with message+prompt+content, active_route+route, name+tool_name+tool, arguments+args+payload
    let ch9_req = Request::builder()
        .method(Method::POST)
        .uri("/api/hermes/chat")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "message": "Hello",
                "prompt": "Hello",
                "content": "Hello",
                "page_context": {"active_route": "/todos", "route": "/todos"},
                "tool_call": {
                    "name": "todos_list_tasks",
                    "tool_name": "todos_list_tasks",
                    "tool": "todos_list_tasks",
                    "arguments": {},
                    "args": {},
                    "payload": {}
                }
            }))
            .unwrap(),
        ))
        .unwrap();
    let ch9_resp = app.clone().oneshot(ch9_req).await.unwrap();
    assert_eq!(ch9_resp.status(), StatusCode::OK);

    // Challenger 10: POST /api/agents/{id}/dispatch with sample_input + input + prompt
    let (_, agents_list) =
        send_json(&app, Method::GET, "/api/agents", None, None).await;
    let agent_id = agents_list[0]["id"].as_str().unwrap();

    let (ch10_status, _) = send_json(
        &app,
        Method::POST,
        &format!("/api/agents/{agent_id}/dispatch"),
        None,
        Some(json!({
            "dry_run": true,
            "sample_input": "Audit vault",
            "input": "Audit vault",
            "prompt": "Audit vault"
        })),
    )
    .await;
    assert_eq!(ch10_status, StatusCode::OK);

    // Challenger 11: POST /api/hermes/sessions/{key}/fork with turn_index + message_index + up_to_turn + branched_at_turn
    let (_, sess_created) = send_json(
        &app,
        Method::POST,
        "/api/hermes/sessions",
        None,
        Some(json!({
            "title": "Parent Session",
            "messages_json": [{"role": "user", "content": "Hi"}],
            "initial_messages": [{"role": "user", "content": "Hi"}]
        })),
    )
    .await;
    let sess_key = sess_created["session_key"].as_str().unwrap();

    let (ch11_status, _) = send_json(
        &app,
        Method::POST,
        &format!("/api/hermes/sessions/{sess_key}/fork"),
        None,
        Some(json!({
            "title": "Forked Session",
            "turn_index": 0,
            "message_index": 0,
            "up_to_turn": 0,
            "branched_at_turn": 0
        })),
    )
    .await;
    assert_eq!(ch11_status, StatusCode::CREATED);

    test_db.teardown().await;
}
