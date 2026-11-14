//! SQLx repositories and Life Operations engines (`03`, `07`–`11`, Auth, Sync, Server Prober).

pub mod auth;
pub mod config;
pub mod dashboards;
pub mod servers;
pub mod service;
pub mod sync;
pub mod test_support;

pub use config::LifeOpsConfig;
pub use hermes_domain::{MOBILE_SYNC_TABLES, SYSTEM_VERSION};
pub use service::LifeOpsService;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        auth::{hash_password_argon2id, verify_password_argon2id},
        dashboards::{validate_custom_sql_query, widget_requires_mcp_approval},
        test_support::{TestDb, run_migrations},
    };
    use chrono::{Duration, Utc};
    use hermes_domain::{
        auth::{CreatePatRequest, PairingQrRequest},
        dashboards::{
            CloneDashboardRequest, CreateDashboardRequest, CreateWidgetRequest, GridRect,
            ReorderDashboardsRequest, UpdateDashboardRequest, UpdateWidgetRequest,
            WidgetRendererKind, WidgetSourceKind,
        },
        error::ApiError,
        events::SystemEvent,
        id::new_uuid_v7,
        servers::{CreateServerRequest, ServerCheckType, ServerStatus},
        sync::{SyncMutationInput, SyncOp, SyncPushRequest},
    };
    use pgvector::Vector;
    use sqlx::PgPool;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn mobile_sync_scope_has_eight_tables() {
        assert_eq!(MOBILE_SYNC_TABLES.len(), 8);
    }

    #[test]
    fn argon2id_hash_and_verify_roundtrip() {
        let phc = hash_password_argon2id("hermes-os-local").expect("hash");
        assert!(verify_password_argon2id("hermes-os-local", &phc).expect("verify"));
        assert!(!verify_password_argon2id("wrong-password", &phc).expect("verify wrong"));
        // Also verify the exact seeded PHC hash in 0003_seed_defaults.sql
        let seeded_phc = "$argon2id$v=19$m=19456,t=2,p=1$OSSP9Vaaetn0PZKArJ9I0w$ZFh4FtCxnDfSoOKM6plRAWuOeuxKNyDj2XlWQJWSA2U";
        assert!(
            verify_password_argon2id("hermes-os-local", seeded_phc)
                .expect("seeded PHC hash must verify"),
            "0003_seed_defaults.sql operator password_hash must verify against 'hermes-os-local'"
        );
    }

    #[tokio::test]
    async fn migrations_and_seeded_defaults_apply_and_verify_immediately() {
        let test_db = TestDb::new().await;

        // 1. Verify all 36 application tables exist in public schema
        let table_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM information_schema.tables \
             WHERE table_schema = 'public' AND table_name != '_sqlx_migrations'",
        )
        .fetch_one(&test_db.pool)
        .await
        .expect("count tables");
        assert_eq!(table_count, 36, "Expected 36 application tables in public schema");

        // 2. Verify seeded operator password hash works immediately right after migration (before ensure_admin_user)
        let seeded_hash: String =
            sqlx::query_scalar("SELECT password_hash FROM users WHERE username = 'operator'")
                .fetch_one(&test_db.pool)
                .await
                .expect("fetch seeded operator");
        assert!(
            verify_password_argon2id("hermes-os-local", &seeded_hash).expect("verify seeded hash"),
            "Seeded operator password hash must validate 'hermes-os-local' immediately after migration"
        );

        // 3. Verify pgvector HNSW cosine distance query on vault_embeddings (384-d)
        let mut vec_a = vec![0.0_f32; 384];
        vec_a[0] = 1.0;
        let mut vec_b = vec![0.0_f32; 384];
        vec_b[1] = 1.0;

        sqlx::query(
            "INSERT INTO vault_embeddings (id, vault_note_path, chunk_index, heading, content_text, content_sha256, embedding) \
             VALUES ($1, 'Inbox/note-a.md', 0, 'A', 'Alpha note', 'sha_a', $2), \
                    ($3, 'Inbox/note-b.md', 0, 'B', 'Beta note', 'sha_b', $4)",
        )
        .bind(new_uuid_v7())
        .bind(Vector::from(vec_a.clone()))
        .bind(new_uuid_v7())
        .bind(Vector::from(vec_b))
        .execute(&test_db.pool)
        .await
        .expect("insert vault_embeddings");

        let nearest_path: String = sqlx::query_scalar(
            "SELECT vault_note_path FROM vault_embeddings ORDER BY embedding <=> $1 LIMIT 1",
        )
        .bind(Vector::from(vec_a))
        .fetch_one(&test_db.pool)
        .await
        .expect("query nearest vector");
        assert_eq!(nearest_path, "Inbox/note-a.md");

        // 4. Verify starter seeds: 4 decks, 13 widgets, 4 knights, 4 triggers, 8 phrases, retirement_config, yearly_cycles
        let deck_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM dashboards")
            .fetch_one(&test_db.pool)
            .await
            .unwrap();
        assert_eq!(deck_count, 4);

        let widget_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM dashboard_widgets")
            .fetch_one(&test_db.pool)
            .await
            .unwrap();
        assert_eq!(widget_count, 13);

        let knight_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agents")
            .fetch_one(&test_db.pool)
            .await
            .unwrap();
        assert_eq!(knight_count, 4);

        let phrase_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM companion_offline_phrases WHERE is_builtin = TRUE")
                .fetch_one(&test_db.pool)
                .await
                .unwrap();
        assert_eq!(phrase_count, 8);

        // Trigger on companion_offline_phrases during 0003 seed must have populated 8 entries in sync_change_log
        let sync_log_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_change_log")
            .fetch_one(&test_db.pool)
            .await
            .unwrap();
        assert_eq!(sync_log_count, 8);

        // 5. Also ensure the main `hermes_os` database has all migrations applied idempotently
        let main_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://hermes:hermes@127.0.0.1:5432/hermes_os".to_string());
        let main_pool = PgPool::connect(&main_url).await.expect("connect hermes_os");
        run_migrations(&main_pool)
            .await
            .expect("apply migrations to main hermes_os database");
        // Refresh operator password hash on hermes_os if needed
        let mut main_cfg = LifeOpsConfig::from_env();
        main_cfg.database_url = main_url;
        let main_svc = LifeOpsService::new(main_pool.clone(), None, main_cfg);
        main_svc
            .ensure_admin_user()
            .await
            .expect("ensure_admin_user on main hermes_os");
        main_pool.close().await;

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn bootstrap_admin_and_argon2id_login_flow() {
        let test_db = TestDb::new().await;
        let svc = LifeOpsService::from_test_db(&test_db);

        // Login works immediately after migration even before ensure_admin_user()
        let initial_login = svc
            .login_password("operator", "hermes-os-local")
            .await
            .expect("login before ensure_admin_user");
        assert!(initial_login.authenticated);
        assert!(initial_login.session_token.starts_with("hermes_sess_"));

        // ensure_admin_user is idempotent and preserves the operator user
        let admin = svc.ensure_admin_user().await.expect("ensure_admin_user");
        assert_eq!(admin.username, "operator");

        // Wrong password and wrong username return 401 Unauthorized
        let bad_pw = svc
            .login_password("operator", "wrong-secret")
            .await
            .expect_err("wrong password must fail");
        assert_eq!(bad_pw.status_code(), 401);

        let bad_user = svc
            .login_password("unknown-operator", "hermes-os-local")
            .await
            .expect_err("unknown user must fail");
        assert_eq!(bad_user.status_code(), 401);

        // Verify session token works via verify_pat_or_session and get_me
        let verify_res = svc
            .verify_pat_or_session(Some(&format!("Bearer {}", initial_login.session_token)))
            .await
            .expect("verify session token");
        assert!(verify_res.authenticated);
        assert_eq!(verify_res.auth_type, "session");
        assert_eq!(verify_res.token_name.as_deref(), Some("operator"));

        // Verify DB stores ONLY 64-char SHA-256 hex, never plaintext session token
        let stored_hash: String =
            sqlx::query_scalar("SELECT session_token_sha256 FROM web_sessions LIMIT 1")
                .fetch_one(&test_db.pool)
                .await
                .unwrap();
        assert_eq!(stored_hash.len(), 64);
        assert_ne!(stored_hash, initial_login.session_token);

        let me = svc
            .get_me(Some(&initial_login.session_token))
            .await
            .expect("get_me");
        assert_eq!(me.username, "operator");

        // Logout revokes session -> subsequent verify returns 401
        svc.logout_session(&initial_login.session_token)
            .await
            .expect("logout");
        let after_logout = svc
            .verify_pat_or_session(Some(&initial_login.session_token))
            .await
            .expect_err("revoked session must fail");
        assert_eq!(after_logout.status_code(), 401);

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn pat_lifecycle_sha256_and_revocation() {
        let test_db = TestDb::new().await;
        let svc = LifeOpsService::from_test_db(&test_db);

        let created = svc
            .create_pat(CreatePatRequest {
                name: "Android Companion".to_string(),
                scopes: vec!["*".to_string()],
            })
            .await
            .expect("create PAT");

        assert!(created.token.starts_with("plm_pat_"));
        assert_eq!(created.token.len(), 40); // "plm_pat_" (8) + 32 hex chars

        // Verify DB stores ONLY 64-char SHA-256 hex digest
        let db_sha256: String =
            sqlx::query_scalar("SELECT token_sha256 FROM api_tokens WHERE id = $1")
                .bind(created.id)
                .fetch_one(&test_db.pool)
                .await
                .unwrap();
        assert_eq!(db_sha256.len(), 64);
        assert_ne!(db_sha256, created.token);

        // Verify list_pats returns summary without secret
        let pats = svc.list_pats().await.expect("list_pats");
        assert_eq!(pats.len(), 1);
        assert_eq!(pats[0].id, created.id);
        assert!(pats[0].last_used_at.is_none());

        // Verify valid PAT succeeds and updates last_used_at
        let verified = svc
            .verify_pat_or_session(Some(&format!("Bearer {}", created.token)))
            .await
            .expect("verify valid PAT");
        assert!(verified.authenticated);
        assert_eq!(verified.auth_type, "pat");
        assert_eq!(verified.token_name.as_deref(), Some("Android Companion"));
        assert!(verified.latest_server_seq >= 8);

        let pats_after = svc.list_pats().await.expect("list_pats after verify");
        assert!(pats_after[0].last_used_at.is_some());

        // Missing, empty, malformed, and unknown tokens all return 401
        for invalid in [
            None,
            Some(""),
            Some("   "),
            Some("Bearer "),
            Some("Bearer invalid_token"),
            Some("Bearer plm_pat_short"),
            Some("Bearer plm_pat_00000000000000000000000000000000"),
        ] {
            let err = svc
                .verify_pat_or_session(invalid)
                .await
                .expect_err("invalid credential must return 401");
            assert_eq!(err.status_code(), 401);
            assert_eq!(err.code(), "unauthorized");
        }

        // Revoke PAT -> immediate 401 on subsequent verify
        svc.revoke_pat(created.id).await.expect("revoke_pat");
        let revoked_err = svc
            .verify_pat_or_session(Some(&created.token))
            .await
            .expect_err("revoked PAT must return 401");
        assert_eq!(revoked_err.status_code(), 401);

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn bootstrap_pat_and_pairing_qr() {
        let test_db = TestDb::new().await;
        let mut cfg = LifeOpsConfig::from_test_db(&test_db);
        let raw_bootstrap = "plm_pat_11223344556677889900aabbccddeeff";
        cfg.bootstrap_pat = Some(raw_bootstrap.to_string());
        let svc = LifeOpsService::new(test_db.pool.clone(), None, cfg);

        let b1 = svc
            .ensure_bootstrap_pat()
            .await
            .expect("ensure_bootstrap_pat 1")
            .expect("some summary");
        let b2 = svc
            .ensure_bootstrap_pat()
            .await
            .expect("ensure_bootstrap_pat 2")
            .expect("some summary");
        assert_eq!(b1.id, b2.id);

        let verified = svc
            .verify_pat_or_session(Some(raw_bootstrap))
            .await
            .expect("verify bootstrap PAT");
        assert!(verified.authenticated);

        let qr = svc
            .build_pairing_qr(PairingQrRequest {
                primary_url: Some("http://192.168.1.50:8080".to_string()),
                fallback_url: Some("https://hermes.tailnet.ts.net".to_string()),
                token_name: Some("Pixel 9 Pro".to_string()),
            })
            .await
            .expect("build_pairing_qr");
        assert_eq!(qr.primary_url, "http://192.168.1.50:8080");
        assert_eq!(
            qr.fallback_url.as_deref(),
            Some("https://hermes.tailnet.ts.net")
        );
        assert!(qr.token.starts_with("plm_pat_"));
        let parsed_qr: serde_json::Value = serde_json::from_str(&qr.qr_payload_json).unwrap();
        assert_eq!(parsed_qr["token"], qr.token);

        let qr_verified = svc
            .verify_pat_or_session(Some(&qr.token))
            .await
            .expect("verify QR PAT");
        assert_eq!(qr_verified.token_name.as_deref(), Some("Pixel 9 Pro"));

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn sync_push_rejects_disallowed_tables_with_400() {
        let test_db = TestDb::new().await;
        let svc = LifeOpsService::from_test_db(&test_db);

        for forbidden_table in [
            "portfolio_assets",
            "users",
            "api_tokens",
            "dashboards",
            "goals",
            "courses",
            "tasks; DROP TABLE users;--",
        ] {
            let err = svc
                .sync_push(SyncPushRequest {
                    client_id: "test-mobile".to_string(),
                    mutations: vec![SyncMutationInput {
                        mutation_id: new_uuid_v7(),
                        entity_table: forbidden_table.to_string(),
                        entity_id: new_uuid_v7().to_string(),
                        op: SyncOp::Upsert,
                        payload: serde_json::json!({ "title": "bad" }),
                        client_updated_at: Some(Utc::now()),
                    }],
                })
                .await
                .expect_err("disallowed sync table must return 400");

            assert_eq!(err.status_code(), 400);
            assert!(matches!(err, ApiError::InvalidSyncTable(_)));
        }

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn sync_push_uuidv7_set_union_and_pull_delta() {
        let test_db = TestDb::new().await;
        let svc = LifeOpsService::from_test_db(&test_db);

        let initial_seq = svc.latest_server_seq().await.unwrap();
        assert_eq!(initial_seq, 8); // 8 seeded companion_offline_phrases

        let project_id = new_uuid_v7();
        let task_id = new_uuid_v7();
        let session_id = new_uuid_v7();
        let routine_id = new_uuid_v7();
        let item_id = new_uuid_v7();
        let log_id = new_uuid_v7();
        let phrase_id = new_uuid_v7();
        let mutation_1 = new_uuid_v7();
        let now = Utc::now();

        let push_req = SyncPushRequest {
            client_id: "mobile-device-1".to_string(),
            mutations: vec![
                SyncMutationInput {
                    mutation_id: mutation_1,
                    entity_table: "projects".to_string(),
                    entity_id: project_id.to_string(),
                    op: SyncOp::Upsert,
                    payload: serde_json::json!({
                        "name": "Mobile Field Ops",
                        "area": "systems",
                        "status": "active",
                    }),
                    client_updated_at: Some(now),
                },
                SyncMutationInput {
                    mutation_id: new_uuid_v7(),
                    entity_table: "tasks".to_string(),
                    entity_id: task_id.to_string(),
                    op: SyncOp::Upsert,
                    payload: serde_json::json!({
                        "title": "Calibrate field antenna",
                        "status": "todo",
                        "priority": "high",
                        "project_id": project_id,
                        "energy_level": "deep_focus",
                        "tags": ["field", "uplink"]
                    }),
                    client_updated_at: Some(now),
                },
                SyncMutationInput {
                    mutation_id: new_uuid_v7(),
                    entity_table: "time_sessions".to_string(),
                    entity_id: session_id.to_string(),
                    op: SyncOp::Upsert,
                    payload: serde_json::json!({
                        "task_id": task_id,
                        "category": "deep_work",
                        "timer_mode": "pomodoro_25_5",
                        "started_at": (now - Duration::minutes(25)).to_rfc3339(),
                        "ended_at": now.to_rfc3339(),
                        "duration_seconds": 1500,
                        "notes": "Completed first pomodoro"
                    }),
                    client_updated_at: Some(now),
                },
                SyncMutationInput {
                    mutation_id: new_uuid_v7(),
                    entity_table: "routines".to_string(),
                    entity_id: routine_id.to_string(),
                    op: SyncOp::Upsert,
                    payload: serde_json::json!({
                        "name": "Morning Expedition",
                        "time_slot": "morning",
                        "day_profile": "workday"
                    }),
                    client_updated_at: Some(now),
                },
                SyncMutationInput {
                    mutation_id: new_uuid_v7(),
                    entity_table: "routine_items".to_string(),
                    entity_id: item_id.to_string(),
                    op: SyncOp::Upsert,
                    payload: serde_json::json!({
                        "routine_id": routine_id,
                        "title": "Hydrate 500ml",
                        "tracking_type": "boolean",
                        "frequency_type": "daily"
                    }),
                    client_updated_at: Some(now),
                },
                SyncMutationInput {
                    mutation_id: new_uuid_v7(),
                    entity_table: "routine_logs".to_string(),
                    entity_id: log_id.to_string(),
                    op: SyncOp::Upsert,
                    payload: serde_json::json!({
                        "routine_item_id": item_id,
                        "log_date": "2026-11-14",
                        "status": "completed"
                    }),
                    client_updated_at: Some(now),
                },
                SyncMutationInput {
                    mutation_id: new_uuid_v7(),
                    entity_table: "daily_checkins".to_string(),
                    entity_id: "2026-11-14".to_string(),
                    op: SyncOp::Upsert,
                    payload: serde_json::json!({
                        "log_date": "2026-11-14",
                        "day_profile_used": "workday",
                        "energy_score": 4,
                        "mood_score": 5,
                        "sleep_hours": 7.5,
                        "highlight": "Shipped M2A sync engine"
                    }),
                    client_updated_at: Some(now),
                },
                SyncMutationInput {
                    mutation_id: new_uuid_v7(),
                    entity_table: "companion_offline_phrases".to_string(),
                    entity_id: phrase_id.to_string(),
                    op: SyncOp::Upsert,
                    payload: serde_json::json!({
                        "phrase_text": "Sync complete. Grimoire indexed.",
                        "trigger_context": "any",
                        "animation_hint": "grimoire"
                    }),
                    client_updated_at: Some(now),
                },
            ],
        };

        let push_res = svc.sync_push(push_req).await.expect("sync_push 8 tables");
        assert_eq!(push_res.applied_count, 8);
        assert_eq!(push_res.conflicts_resolved, 0);
        assert_eq!(push_res.server_seq, 16);

        // Re-sending mutation_1 idempotently skips without error or extra seq bump
        let retry_res = svc
            .sync_push(SyncPushRequest {
                client_id: "mobile-device-1".to_string(),
                mutations: vec![SyncMutationInput {
                    mutation_id: mutation_1,
                    entity_table: "projects".to_string(),
                    entity_id: project_id.to_string(),
                    op: SyncOp::Upsert,
                    payload: serde_json::json!({ "name": "Duplicate retry" }),
                    client_updated_at: Some(now + Duration::minutes(5)),
                }],
            })
            .await
            .expect("idempotent retry");
        assert_eq!(retry_res.applied_count, 0);
        assert_eq!(retry_res.server_seq, 16);

        // Cold bootstrap pull (`since = 0`) returns all 16 active rows across the 8 tables
        let full_pull = svc.sync_pull(0, 500).await.expect("sync_pull(0)");
        assert_eq!(full_pull.latest_server_seq, 16);
        assert!(!full_pull.has_more);
        assert_eq!(full_pull.changes.len(), 16);
        // Verify daily_checkins entry in snapshot has both `id` and `log_date`
        let checkin_entry = full_pull
            .changes
            .iter()
            .find(|c| c.entity_table == "daily_checkins")
            .expect("daily_checkins in snapshot");
        assert_eq!(checkin_entry.entity_id, "2026-11-14");
        assert_eq!(checkin_entry.payload["id"], "2026-11-14");

        // Incremental delta pull (`since = 8`, `limit = 3`) paginates with `has_more = true`
        let page1 = svc.sync_pull(8, 3).await.expect("sync_pull page 1");
        assert_eq!(page1.changes.len(), 3);
        assert!(page1.has_more);
        assert_eq!(page1.next_seq, 11);

        let page2 = svc
            .sync_pull(page1.next_seq, 10)
            .await
            .expect("sync_pull page 2");
        assert_eq!(page2.changes.len(), 5);
        assert!(!page2.has_more);
        assert_eq!(page2.next_seq, 16);

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn sync_push_lww_conflict_resolution_and_tombstones() {
        let test_db = TestDb::new().await;
        let svc = LifeOpsService::from_test_db(&test_db);

        let task_id = new_uuid_v7();
        let t2 = Utc::now();
        let t1 = t2 - Duration::minutes(10); // older than t2
        let t3 = t2 + Duration::minutes(10); // newer than t2
        let t4 = t3 + Duration::minutes(5); // delete timestamp

        // 1. Create task at T2
        let res1 = svc
            .sync_push(SyncPushRequest {
                client_id: "web".to_string(),
                mutations: vec![SyncMutationInput {
                    mutation_id: new_uuid_v7(),
                    entity_table: "tasks".to_string(),
                    entity_id: task_id.to_string(),
                    op: SyncOp::Upsert,
                    payload: serde_json::json!({ "title": "Server Newer Title", "status": "todo" }),
                    client_updated_at: Some(t2),
                }],
            })
            .await
            .unwrap();
        assert_eq!(res1.applied_count, 1);

        // 2. Push stale update at T1 < T2 -> conflict resolved in server's favor
        let res2 = svc
            .sync_push(SyncPushRequest {
                client_id: "mobile-stale".to_string(),
                mutations: vec![SyncMutationInput {
                    mutation_id: new_uuid_v7(),
                    entity_table: "tasks".to_string(),
                    entity_id: task_id.to_string(),
                    op: SyncOp::Upsert,
                    payload: serde_json::json!({ "title": "Stale Offline Title", "status": "in_progress" }),
                    client_updated_at: Some(t1),
                }],
            })
            .await
            .unwrap();
        assert_eq!(res2.applied_count, 0);
        assert_eq!(res2.conflicts_resolved, 1);

        let preserved_title: String =
            sqlx::query_scalar("SELECT title FROM tasks WHERE id = $1")
                .bind(task_id)
                .fetch_one(&test_db.pool)
                .await
                .unwrap();
        assert_eq!(preserved_title, "Server Newer Title");

        // 3. Push newer update at T3 > T2 -> overwrites server row
        let seq_before_t3 = svc.latest_server_seq().await.unwrap();
        let res3 = svc
            .sync_push(SyncPushRequest {
                client_id: "mobile-fresh".to_string(),
                mutations: vec![SyncMutationInput {
                    mutation_id: new_uuid_v7(),
                    entity_table: "tasks".to_string(),
                    entity_id: task_id.to_string(),
                    op: SyncOp::Upsert,
                    payload: serde_json::json!({ "title": "Fresh Winning Title", "status": "done" }),
                    client_updated_at: Some(t3),
                }],
            })
            .await
            .unwrap();
        assert_eq!(res3.applied_count, 1);
        assert_eq!(res3.conflicts_resolved, 0);

        // 4. Push delete at T4 > T3 -> soft-deletes row and emits delete tombstone in sync_pull
        let res4 = svc
            .sync_push(SyncPushRequest {
                client_id: "mobile-fresh".to_string(),
                mutations: vec![SyncMutationInput {
                    mutation_id: new_uuid_v7(),
                    entity_table: "tasks".to_string(),
                    entity_id: task_id.to_string(),
                    op: SyncOp::Delete,
                    payload: serde_json::json!({}),
                    client_updated_at: Some(t4),
                }],
            })
            .await
            .unwrap();
        assert_eq!(res4.applied_count, 1);

        let deltas = svc.sync_pull(seq_before_t3, 50).await.unwrap();
        assert_eq!(deltas.changes.len(), 2);
        assert_eq!(deltas.changes[0].op, SyncOp::Upsert);
        assert_eq!(deltas.changes[0].payload["title"], "Fresh Winning Title");
        assert_eq!(deltas.changes[1].op, SyncOp::Delete);
        assert!(deltas.changes[1].payload["deleted_at"].is_string());

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn seeded_decks_and_dashboard_crud_clone_reorder() {
        let test_db = TestDb::new().await;
        let svc = LifeOpsService::from_test_db(&test_db);

        let decks = svc.list_dashboards().await.expect("list_dashboards");
        assert_eq!(decks.len(), 4);
        assert_eq!(decks[0].dashboard.slug, "tactical-ops");
        assert_eq!(decks[0].widgets.len(), 4);

        let by_slug = svc
            .get_dashboard("wealth-fire")
            .await
            .expect("get_dashboard by slug");
        assert_eq!(by_slug.dashboard.title, "DECK_02 // WEALTH_&_FIRE");

        // Create a new deck
        let created = svc
            .create_dashboard(CreateDashboardRequest {
                slug: Some("custom-ops".to_string()),
                title: "DECK_05 // CUSTOM_OPS".to_string(),
                cycle_seconds: 45,
                in_rotation: true,
                sort_order: None,
                layout_cols: 12,
                layout_rows: 8,
            })
            .await
            .expect("create_dashboard");
        assert_eq!(created.dashboard.slug, "custom-ops");

        // Invalid cycle_seconds (< 5) rejected with 400
        let bad_cycle = svc
            .update_dashboard(
                created.dashboard.id,
                UpdateDashboardRequest {
                    cycle_seconds: Some(2),
                    ..Default::default()
                },
            )
            .await
            .expect_err("cycle_seconds < 5 must fail");
        assert_eq!(bad_cycle.status_code(), 400);

        // Out-of-bounds widget grid_rect (x + w > 12) rejected with 400
        let bad_rect = svc
            .create_widget(
                created.dashboard.id,
                CreateWidgetRequest {
                    title: "Too Wide".to_string(),
                    source_kind: WidgetSourceKind::Builtin,
                    renderer_kind: WidgetRendererKind::Kpi,
                    grid_rect: GridRect {
                        x: 8,
                        y: 0,
                        w: 6,
                        h: 2,
                    },
                    source_config: serde_json::json!({"builtin_key": "life_score"}),
                    refresh_interval_seconds: 60,
                    sort_order: None,
                },
            )
            .await
            .expect_err("out-of-bounds grid_rect must return 400");
        assert_eq!(bad_rect.status_code(), 400);

        // Clone DECK_01 and verify widgets are deep-copied with distinct UUIDs
        let cloned = svc
            .clone_dashboard(
                decks[0].dashboard.id,
                CloneDashboardRequest {
                    slug: Some("tactical-ops-clone".to_string()),
                    title: Some("Cloned Tactical Ops".to_string()),
                },
            )
            .await
            .expect("clone_dashboard");
        assert_ne!(cloned.dashboard.id, decks[0].dashboard.id);
        assert_eq!(cloned.widgets.len(), decks[0].widgets.len());
        assert_ne!(cloned.widgets[0].id, decks[0].widgets[0].id);

        // Reorder dashboards
        let reordered = svc
            .reorder_dashboards(ReorderDashboardsRequest {
                dashboard_ids: vec![cloned.dashboard.id, decks[0].dashboard.id],
            })
            .await
            .expect("reorder_dashboards");
        assert_eq!(reordered[0].id, cloned.dashboard.id);
        assert_eq!(reordered[0].sort_order, 1);

        // Delete cloned dashboard
        svc.delete_dashboard(cloned.dashboard.id)
            .await
            .expect("delete_dashboard");

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn life_score_neutral_baseline_and_populated_rollups() {
        let test_db = TestDb::new().await;
        let svc = LifeOpsService::from_test_db(&test_db);

        // 1. Fresh DB with zero records -> neutral 50.0 across all 5 pillars, zero NaNs
        let baseline = svc.compute_life_score().await.expect("baseline life score");
        assert_eq!(baseline.composite_score, 50.0);
        assert_eq!(baseline.score, 50);
        assert_eq!(baseline.pillars.focus, 50.0);
        assert_eq!(baseline.pillars.routines, 50.0);
        assert_eq!(baseline.pillars.goals, 50.0);
        assert_eq!(baseline.pillars.learning, 50.0);
        assert_eq!(baseline.pillars.wealth, 50.0);

        // 2. Populate all 5 pillars and verify real SQL rollups shift scores > 50.0
        sqlx::query("INSERT INTO tasks (id, title, status) VALUES ($1, 'Done task', 'done')")
            .bind(new_uuid_v7())
            .execute(&test_db.pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO time_sessions (id, category, timer_mode, started_at, ended_at, duration_seconds) \
             VALUES ($1, 'deep_work', 'stopwatch', NOW() - INTERVAL '2 hours', NOW(), 25200)",
        )
        .bind(new_uuid_v7())
        .execute(&test_db.pool)
        .await
        .unwrap();

        let routine_id = new_uuid_v7();
        let item_id = new_uuid_v7();
        sqlx::query("INSERT INTO routines (id, name, time_slot) VALUES ($1, 'Morning', 'morning')")
            .bind(routine_id)
            .execute(&test_db.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO routine_items (id, routine_id, title) VALUES ($1, $2, 'Meditate')")
            .bind(item_id)
            .bind(routine_id)
            .execute(&test_db.pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO routine_logs (id, routine_item_id, log_date, status) \
             VALUES ($1, $2, CURRENT_DATE, 'completed')",
        )
        .bind(new_uuid_v7())
        .bind(item_id)
        .execute(&test_db.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO goals (id, year, pillar, title, status, progress_pct) \
             VALUES ($1, 2026, 'systems', 'Master HERMES', 'in_progress', 85.0)",
        )
        .bind(new_uuid_v7())
        .execute(&test_db.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO courses (id, title, provider, status, progress_pct) \
             VALUES ($1, 'Rust Systems', 'custom', 'active', 90.0)",
        )
        .bind(new_uuid_v7())
        .execute(&test_db.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO monthly_investment_plans (month, salary_income_cents, planned_spend_cents, actual_spend_cents, planned_investment_cents, actual_invested_cents) \
             VALUES ('2026-11', 2000000, 1000000, 1000000, 1000000, 1000000)",
        )
        .execute(&test_db.pool)
        .await
        .unwrap();

        let populated = svc
            .compute_life_score()
            .await
            .expect("populated life score");
        assert!(populated.composite_score > 80.0);
        assert!(populated.pillars.focus >= 90.0);
        assert!(populated.pillars.routines >= 90.0);
        assert!(populated.pillars.goals >= 80.0);
        assert!(populated.pillars.learning >= 85.0);
        assert!(populated.pillars.wealth >= 90.0);

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn custom_widgets_command_http_sql_hermes_and_security() {
        let test_db = TestDb::new().await;
        let svc = LifeOpsService::from_test_db(&test_db);

        // 1. Verify MCP approval gate helper
        assert!(widget_requires_mcp_approval(&WidgetSourceKind::Command));
        assert!(widget_requires_mcp_approval(&WidgetSourceKind::Sql));
        assert!(!widget_requires_mcp_approval(&WidgetSourceKind::Builtin));
        assert!(!widget_requires_mcp_approval(&WidgetSourceKind::Http));
        assert!(!widget_requires_mcp_approval(&WidgetSourceKind::Hermes));

        // 2. Refresh all 13 seeded widgets (covers all 7 builtin types + seeded SQL widget)
        let decks = svc.list_dashboards().await.unwrap();
        for deck in &decks {
            for w in &deck.widgets {
                let refreshed = svc.refresh_widget(w.id).await.expect("refresh seeded widget");
                assert!(refreshed.cached_payload.is_some());
                assert!(refreshed.last_refreshed_at.is_some());
            }
        }

        let deck_id = decks[0].dashboard.id;

        // 3. Command widget: JSON stdout + timeout enforcement
        let cmd_widget = svc
            .create_widget(
                deck_id,
                CreateWidgetRequest {
                    title: "Echo JSON".to_string(),
                    source_kind: WidgetSourceKind::Command,
                    renderer_kind: WidgetRendererKind::Terminal,
                    grid_rect: GridRect {
                        x: 0,
                        y: 0,
                        w: 4,
                        h: 2,
                    },
                    source_config: serde_json::json!({ "command": "printf '{\"load\": 0.42}'" }),
                    refresh_interval_seconds: 60,
                    sort_order: None,
                },
            )
            .await
            .unwrap();
        let cmd_refreshed = svc.refresh_widget(cmd_widget.id).await.unwrap();
        let cmd_payload = cmd_refreshed.cached_payload.unwrap();
        assert_eq!(cmd_payload["status"], "ok");
        assert_eq!(cmd_payload["parsed_json"]["load"], 0.42);

        let timeout_widget = svc
            . update_widget(
                deck_id,
                cmd_widget.id,
                UpdateWidgetRequest {
                    source_config: Some(serde_json::json!({
                        "command": "sleep 5",
                        "timeout_ms": 100
                    })),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let timeout_refreshed = svc.refresh_widget(timeout_widget.id).await.unwrap();
        let timeout_payload = timeout_refreshed.cached_payload.unwrap();
        assert_eq!(timeout_payload["status"], "timeout");
        assert_eq!(timeout_payload["timed_out"], true);

        // 4. HTTP widget against ephemeral local TcpListener + JSON pointer extraction
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let _ = socket.read(&mut buf).await;
                let body = r#"{"telemetry":{"gpu_temp_c":58.5,"status":"nominal"}}"#;
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = socket.write_all(resp.as_bytes()).await;
            }
        });

        let http_widget = svc
            .create_widget(
                deck_id,
                CreateWidgetRequest {
                    title: "Local HTTP Telemetry".to_string(),
                    source_kind: WidgetSourceKind::Http,
                    renderer_kind: WidgetRendererKind::Kpi,
                    grid_rect: GridRect {
                        x: 4,
                        y: 0,
                        w: 4,
                        h: 2,
                    },
                    source_config: serde_json::json!({
                        "url": format!("http://{addr}/metrics"),
                        "json_pointer": "/telemetry/gpu_temp_c"
                    }),
                    refresh_interval_seconds: 30,
                    sort_order: None,
                },
            )
            .await
            .unwrap();
        let http_refreshed = svc.refresh_widget(http_widget.id).await.unwrap();
        let http_payload = http_refreshed.cached_payload.unwrap();
        assert_eq!(http_payload["status"], 200);
        assert_eq!(http_payload["extracted"], 58.5);

        // 5. SQL widget security validation (reject DDL, DML, multi-statement, comments, sensitive tables)
        for forbidden_sql in [
            "DROP TABLE tasks",
            "DELETE FROM tasks",
            "UPDATE tasks SET title = 'hacked'",
            "INSERT INTO tasks (id, title) VALUES (gen_random_uuid(), 'x')",
            "SELECT 1; SELECT 2",
            "SELECT * FROM tasks -- comment",
            "SELECT * FROM api_tokens",
            "SELECT password_hash FROM users",
            "SELECT * FROM web_sessions",
            "SELECT * FROM information_schema.tables",
            "SELECT pg_sleep(10)",
        ] {
            assert!(
                validate_custom_sql_query(forbidden_sql).is_err(),
                "Expected SQL validator to reject: {forbidden_sql}"
            );
        }

        // 6. Hermes widget offline_mock resilience
        let hermes_widget = svc
            .create_widget(
                deck_id,
                CreateWidgetRequest {
                    title: "Hermes Briefing".to_string(),
                    source_kind: WidgetSourceKind::Hermes,
                    renderer_kind: WidgetRendererKind::Terminal,
                    grid_rect: GridRect {
                        x: 8,
                        y: 0,
                        w: 4,
                        h: 2,
                    },
                    source_config: serde_json::json!({ "prompt": "Morning tactical pulse" }),
                    refresh_interval_seconds: 60,
                    sort_order: None,
                },
            )
            .await
            .unwrap();
        let hermes_refreshed = svc.refresh_widget(hermes_widget.id).await.unwrap();
        let hermes_payload = hermes_refreshed.cached_payload.unwrap();
        assert_eq!(hermes_payload["gateway_mode"], "offline_mock");

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn tokio_server_prober_tcp_http_and_latency_ring_buffer() {
        let test_db = TestDb::new().await;
        let svc = LifeOpsService::from_test_db(&test_db);
        let mut events_rx = svc.subscribe_events();

        // 1. Ephemeral TCP server (accepts connection)
        let tcp_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let tcp_port = tcp_listener.local_addr().unwrap().port() as i32;
        tokio::spawn(async move {
            while let Ok((socket, _)) = tcp_listener.accept().await {
                drop(socket);
            }
        });

        // 2. Ephemeral HTTP server (returns 200 on /health and 503 on /degraded)
        let http_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let http_port = http_listener.local_addr().unwrap().port() as i32;
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = http_listener.accept().await {
                let mut buf = [0u8; 1024];
                let n = socket.read(&mut buf).await.unwrap_or(0);
                let req_str = String::from_utf8_lossy(&buf[..n]);
                let resp = if req_str.contains("/degraded") {
                    "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 8\r\nConnection: close\r\n\r\ndegraded"
                } else {
                    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
                };
                let _ = socket.write_all(resp.as_bytes()).await;
            }
        });

        // 3. Closed TCP port (bind and drop immediately)
        let closed_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let closed_port = closed_listener.local_addr().unwrap().port() as i32;
        drop(closed_listener);

        let s_tcp_ok = svc
            .create_server(CreateServerRequest {
                name: "bastion-tcp".to_string(),
                host: "127.0.0.1".to_string(),
                port: tcp_port,
                check_type: ServerCheckType::Tcp,
                http_url: None,
                tags: vec!["core".to_string()],
            })
            .await
            .unwrap();

        let s_http_ok = svc
            .create_server(CreateServerRequest {
                name: "gateway-http-200".to_string(),
                host: "127.0.0.1".to_string(),
                port: http_port,
                check_type: ServerCheckType::Http,
                http_url: Some(format!("http://127.0.0.1:{http_port}/health")),
                tags: vec!["web".to_string()],
            })
            .await
            .unwrap();

        let s_http_deg = svc
            .create_server(CreateServerRequest {
                name: "worker-http-503".to_string(),
                host: "127.0.0.1".to_string(),
                port: http_port,
                check_type: ServerCheckType::Http,
                http_url: Some(format!("http://127.0.0.1:{http_port}/degraded")),
                tags: vec!["worker".to_string()],
            })
            .await
            .unwrap();

        let s_offline = svc
            .create_server(CreateServerRequest {
                name: "dead-node".to_string(),
                host: "127.0.0.1".to_string(),
                port: closed_port,
                check_type: ServerCheckType::Tcp,
                http_url: None,
                tags: vec!["edge".to_string()],
            })
            .await
            .unwrap();

        let probed = svc.check_all_servers().await.expect("check_all_servers");
        assert_eq!(probed.len(), 4);

        let tcp_node = svc.get_server(s_tcp_ok.id).await.unwrap();
        assert_eq!(tcp_node.status, ServerStatus::Online);
        assert!(tcp_node.last_latency_ms.is_some());

        let http_ok_node = svc.get_server(s_http_ok.id).await.unwrap();
        assert_eq!(http_ok_node.status, ServerStatus::Online);

        let http_deg_node = svc.get_server(s_http_deg.id).await.unwrap();
        assert_eq!(http_deg_node.status, ServerStatus::Degraded);

        let offline_node = svc.get_server(s_offline.id).await.unwrap();
        assert_eq!(offline_node.status, ServerStatus::Offline);

        let summary = svc.get_servers_summary().await.unwrap();
        assert_eq!(summary.total, 4);
        assert_eq!(summary.online, 2);
        assert_eq!(summary.degraded, 1);
        assert_eq!(summary.offline, 1);

        // Verify SystemEvent::ServerStatusChanged was broadcast
        let ev = events_rx.try_recv().expect("ServerStatusChanged event");
        assert!(matches!(ev, SystemEvent::ServerStatusChanged { .. }));

        // Probe tcp_node 28 times and verify latency_history_ms ring buffer is capped at 24 samples
        for _ in 0..28 {
            let _ = svc.check_server(s_tcp_ok.id).await.unwrap();
        }
        let capped_node = svc.get_server(s_tcp_ok.id).await.unwrap();
        assert_eq!(capped_node.latency_history_ms.len(), 24);

        test_db.teardown().await;
    }
}
