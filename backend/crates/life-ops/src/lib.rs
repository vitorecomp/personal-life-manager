//! SQLx repositories and Life Operations engines (`03`, `07`–`11`, Auth, Sync, Server Prober).

pub mod auth;
pub mod config;
pub mod courses;
pub mod dashboards;
pub mod finance;
pub mod goals;
pub mod routines;
pub mod servers;
pub mod service;
pub mod sync;
pub mod test_support;
pub mod todos;

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

    // =========================================================================
    // M2B Tests: F13 Todos & Focus Timer, F14 Routines & Vault Export,
    //            F15 Yearly Goals & 90° Blueprint, F16 Courses & YouTube Import,
    //            F17 Multi-Market Finance & FIRE + Cross-Module Life Score
    // =========================================================================

    #[test]
    fn f13_nlp_quick_capture_parser_extracts_tokens_deterministically() {
        use chrono::NaiveDate;
        use hermes_domain::todos::{TaskEnergyLevel, TaskPriority, TaskStatus};

        let anchor = NaiveDate::from_ymd_opt(2026, 11, 14).unwrap();
        let parsed = crate::todos::parse_quick_capture_with_today(
            "Implement Raft consensus lab #distributed #rust +systems @deep !p1 tomorrow 1h30m",
            anchor,
        )
        .expect("parse quick capture");

        assert_eq!(parsed.clean_title, "Implement Raft consensus lab");
        assert_eq!(parsed.tags, vec!["distributed".to_string(), "rust".to_string()]);
        assert_eq!(parsed.project_hint.as_deref(), Some("systems"));
        assert_eq!(parsed.energy_level, Some(TaskEnergyLevel::Deep));
        assert_eq!(parsed.priority, TaskPriority::Urgent);
        assert_eq!(
            parsed.scheduled_date,
            Some(NaiveDate::from_ymd_opt(2026, 11, 15).unwrap())
        );
        assert_eq!(parsed.estimated_minutes, Some(90));
        assert_eq!(parsed.status, TaskStatus::Todo);

        let parsed_rel = crate::todos::parse_quick_capture_with_today(
            "Review quarterly portfolio @shallow !low in 5 days 45m",
            anchor,
        )
        .expect("parse relative days");
        assert_eq!(parsed_rel.clean_title, "Review quarterly portfolio");
        assert_eq!(parsed_rel.energy_level, Some(TaskEnergyLevel::Shallow));
        assert_eq!(parsed_rel.priority, TaskPriority::Low);
        assert_eq!(
            parsed_rel.scheduled_date,
            Some(NaiveDate::from_ymd_opt(2026, 11, 19).unwrap())
        );
        assert_eq!(parsed_rel.estimated_minutes, Some(45));
    }

    #[tokio::test]
    async fn f13_todos_cycle_detection_terminal_io_topology_and_single_active_timer() {
        use hermes_domain::courses::{CourseProvider, CourseStatus, CreateCourseRequest};
        use hermes_domain::todos::{
            CreateProjectRequest, CreateTaskRequest, ProjectArea, ProjectStatus, StartTimerRequest,
            StopTimerRequest, TaskListFilter, TaskPriority, TaskStatus, TimeCategory, TimerMode,
            UpdateTaskRequest,
        };

        let test_db = TestDb::new().await;
        let svc = LifeOpsService::from_test_db(&test_db);

        let project = svc
            .create_project(CreateProjectRequest {
                name: "HERMES Core".to_string(),
                area: ProjectArea::Systems,
                goal_id: None,
                status: ProjectStatus::Active,
                color: "#F87C18".to_string(),
            })
            .await
            .expect("create project");

        let task_a = svc
            .create_task(CreateTaskRequest {
                title: "Task A".to_string(),
                project_id: Some(project.id),
                status: TaskStatus::Todo,
                estimated_minutes: Some(60),
                scheduled_date: Some(Utc::now().date_naive()),
                ..Default::default()
            })
            .await
            .expect("create task A");

        let task_b = svc
            .create_task(CreateTaskRequest {
                title: "Task B".to_string(),
                project_id: Some(project.id),
                status: TaskStatus::InProgress,
                blocked_by_task_ids: vec![task_a.id],
                estimated_minutes: Some(45),
                scheduled_date: Some(Utc::now().date_naive()),
                ..Default::default()
            })
            .await
            .expect("create task B");

        let task_c = svc
            .create_task(CreateTaskRequest {
                title: "Task C".to_string(),
                project_id: Some(project.id),
                parent_task_id: Some(task_b.id),
                status: TaskStatus::Review,
                blocked_by_task_ids: vec![task_b.id],
                ..Default::default()
            })
            .await
            .expect("create task C");

        // 1. Self-dependency cycle A -> A must return 422 CYCLE_DETECTED
        let self_cycle_err = svc
            .update_task(
                task_a.id,
                UpdateTaskRequest {
                    blocked_by_task_ids: Some(vec![task_a.id]),
                    ..Default::default()
                },
            )
            .await
            .expect_err("self dependency must fail");
        assert_eq!(self_cycle_err.status_code(), 422);
        assert_eq!(self_cycle_err.code(), "CYCLE_DETECTED");

        // 2. Multi-hop cycle A -> C (when C -> B -> A) must return 422 CYCLE_DETECTED
        let hop_cycle_err = svc
            .update_task(
                task_a.id,
                UpdateTaskRequest {
                    blocked_by_task_ids: Some(vec![task_c.id]),
                    ..Default::default()
                },
            )
            .await
            .expect_err("multi-hop cycle must fail");
        assert_eq!(hop_cycle_err.status_code(), 422);
        assert_eq!(hop_cycle_err.code(), "CYCLE_DETECTED");

        // 3. Verify TERMINAL-I/O flow topology & Today capacity meter
        let flow = svc
            .get_task_flow(Some(project.id))
            .await
            .expect("get_task_flow");
        assert_eq!(flow.stages.len(), 4);
        assert!(flow.nodes.iter().any(|n| n.node_kind == "hub"));
        assert!(!flow.dependency_arcs.is_empty());
        assert!(!flow.subtask_edges.is_empty());

        let today_tasks = svc
            .list_tasks(TaskListFilter {
                perspective: Some("today".to_string()),
                ..Default::default()
            })
            .await
            .expect("list today perspective");
        assert!(today_tasks.len() >= 2);

        // 4. Verify single active timer auto-stop & rollup to tasks.actual_seconds and courses.logged_study_seconds
        let course = svc
            .create_course(CreateCourseRequest {
                title: "Distributed Systems".to_string(),
                provider: CourseProvider::University,
                instructor: "MIT".to_string(),
                source_url: None,
                status: CourseStatus::Active,
                priority: TaskPriority::High,
                goal_id: None,
                youtube_playlist_id: None,
                vault_folder_path: None,
                estimated_total_minutes: 120,
                target_completion_date: None,
            })
            .await
            .expect("create course")
            .course;

        let timer_1 = svc
            .start_timer(StartTimerRequest {
                task_id: Some(task_a.id),
                course_id: None,
                lesson_id: None,
                category: TimeCategory::DeepWork,
                timer_mode: TimerMode::Pomodoro25_5,
                work_minutes: Some(25),
                break_minutes: Some(5),
                notes: Some("First session".to_string()),
            })
            .await
            .expect("start timer 1");
        assert!(timer_1.running);
        let session_1_id = timer_1.session.as_ref().unwrap().id;

        // Backdate timer_1 by 120 seconds so auto-stop rolls up 120s onto task_a
        sqlx::query("UPDATE time_sessions SET started_at = NOW() - INTERVAL '120 seconds' WHERE id = $1")
            .bind(session_1_id)
            .execute(&test_db.pool)
            .await
            .unwrap();

        // Starting timer_2 on course must auto-stop timer_1 without violating idx_time_sessions_single_active_timer
        let timer_2 = svc
            .start_timer(StartTimerRequest {
                task_id: None,
                course_id: Some(course.id),
                lesson_id: None,
                category: TimeCategory::Learning,
                timer_mode: TimerMode::Stopwatch,
                work_minutes: None,
                break_minutes: None,
                notes: Some("Course study".to_string()),
            })
            .await
            .expect("start timer 2 auto-stopping timer 1");
        let session_2_id = timer_2.session.as_ref().unwrap().id;

        let refreshed_task_a = svc.get_task(task_a.id).await.unwrap();
        assert!(
            refreshed_task_a.actual_seconds >= 115,
            "Expected timer_1 auto-stop to roll up >= 115s onto task_a, got {}",
            refreshed_task_a.actual_seconds
        );

        // Backdate timer_2 by 300s and stop it explicitly
        sqlx::query("UPDATE time_sessions SET started_at = NOW() - INTERVAL '300 seconds' WHERE id = $1")
            .bind(session_2_id)
            .execute(&test_db.pool)
            .await
            .unwrap();

        let stopped = svc
            .stop_timer(StopTimerRequest {
                duration_seconds: None,
                notes: Some("Finished lecture".to_string()),
            })
            .await
            .expect("stop timer 2");
        assert!(stopped.duration_seconds >= 295);

        let refreshed_course = svc.get_course(course.id).await.unwrap().course;
        assert!(
            refreshed_course.logged_study_seconds >= 295,
            "Expected stop_timer to roll up >= 295s onto course, got {}",
            refreshed_course.logged_study_seconds
        );

        let stats = svc.get_time_stats().await.expect("get_time_stats");
        assert_eq!(stats.hourly_buckets_24h.len(), 24);
        assert_eq!(stats.barcode_buckets_96.len(), 96);
        assert!(stats.today_seconds >= 400);

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn f14_routines_streaks_8x12_matrix_ideal_week_and_atomic_vault_export() {
        use chrono::{Duration, NaiveTime};
        use hermes_domain::routines::{
            CreateRoutineItemRequest, CreateRoutineRequest, DayProfile, HabitFrequencyType,
            HabitTrackingType, IdealWeekBlock, LogRoutineItemRequest, RoutineLogStatus,
            RoutineTimeSlot, UpsertDailyCheckinRequest, UpsertIdealWeekRequest,
        };

        let test_db = TestDb::new().await;
        let svc = LifeOpsService::from_test_db(&test_db);

        let routine = svc
            .create_routine(CreateRoutineRequest {
                name: "Morning Tactical Stack".to_string(),
                time_slot: RoutineTimeSlot::Morning,
                day_profile: DayProfile::Workday,
                target_start_time: NaiveTime::from_hms_opt(7, 0, 0),
                sort_order: Some(1),
                active: true,
            })
            .await
            .expect("create routine");

        let item = svc
            .create_routine_item(
                routine.routine.id,
                CreateRoutineItemRequest {
                    goal_id: None,
                    title: "Mobility & Hydration".to_string(),
                    tracking_type: HabitTrackingType::Boolean,
                    target_value: None,
                    unit: None,
                    frequency_type: HabitFrequencyType::Daily,
                    frequency_config: serde_json::json!({}),
                    estimated_minutes: Some(15),
                    sort_order: Some(1),
                },
            )
            .await
            .expect("create routine item");

        let today = Utc::now().date_naive();
        for offset in (0..4).rev() {
            let d = today - Duration::days(offset);
            let _ = svc
                .log_routine_item(LogRoutineItemRequest {
                    routine_item_id: item.id,
                    log_date: Some(d),
                    status: RoutineLogStatus::Completed,
                    numeric_value: None,
                    notes: format!("Day -{offset}"),
                })
                .await
                .expect("log routine item");
        }

        let analytics = svc
            .get_routines_analytics()
            .await
            .expect("get_routines_analytics");
        assert_eq!(analytics.matrix_8x12.len(), 96);
        assert_eq!(analytics.heatmap_365d.len(), 365);
        let item_streak = analytics
            .streaks
            .iter()
            .find(|s| s.routine_item_id == item.id)
            .expect("streak summary for item");
        assert_eq!(item_streak.current_streak, 4);
        assert!(item_streak.longest_streak >= 4);

        // Ideal week blocks + variance
        let ideal = svc
            .replace_ideal_week(UpsertIdealWeekRequest {
                blocks: vec![
                    IdealWeekBlock {
                        id: new_uuid_v7(),
                        day_of_week: 1,
                        start_time: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
                        end_time: NaiveTime::from_hms_opt(11, 0, 0).unwrap(),
                        category: "deep_work".to_string(),
                        label: "Deep Architecture".to_string(),
                        linked_goal_id: None,
                        created_at: Utc::now(),
                        updated_at: Utc::now(),
                    },
                    IdealWeekBlock {
                        id: new_uuid_v7(),
                        day_of_week: 2,
                        start_time: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
                        end_time: NaiveTime::from_hms_opt(11, 0, 0).unwrap(),
                        category: "learning".to_string(),
                        label: "Systems Study".to_string(),
                        linked_goal_id: None,
                        created_at: Utc::now(),
                        updated_at: Utc::now(),
                    },
                ],
            })
            .await
            .expect("replace_ideal_week");
        assert_eq!(ideal.blocks.len(), 2);
        assert!(!ideal.variance_by_category.is_empty());

        // Atomic Obsidian Markdown export preserving <!-- keep --> blocks
        let daily_rel = format!("Daily/{}.md", today.format("%Y-%m-%d"));
        let daily_abs = test_db.second_brain_dir.join(&daily_rel);
        std::fs::create_dir_all(daily_abs.parent().unwrap()).unwrap();
        std::fs::write(
            &daily_abs,
            "# Existing Note\n\n<!-- keep -->\nCustom operator handwritten note!\n<!-- /keep -->\n",
        )
        .unwrap();

        let checkin = svc
            .upsert_checkin(
                today,
                UpsertDailyCheckinRequest {
                    day_profile_used: Some(DayProfile::Workday),
                    energy_score: Some(4),
                    mood_score: Some(5),
                    sleep_hours: Some(rust_decimal::Decimal::new(75, 1)),
                    highlight: Some("Ship M2B".to_string()),
                    reflection_md: Some("All tests green".to_string()),
                    weekly_review_json: Some(serde_json::json!({
                        "wins": "Completed all 5 domain engines",
                        "challenges": "None",
                        "next_week_priorities": "M2C & M2D"
                    })),
                },
            )
            .await
            .expect("upsert_checkin with vault export");

        assert_eq!(checkin.obsidian_vault_path.as_deref(), Some(daily_rel.as_str()));
        assert!(checkin.weekly_review_vault_path.is_some());

        let exported_daily = std::fs::read_to_string(&daily_abs).expect("read exported daily md");
        assert!(exported_daily.contains("Ship M2B"));
        assert!(
            exported_daily.contains("Custom operator handwritten note!"),
            "Atomic export must preserve <!-- keep -->...<!-- /keep --> blocks"
        );

        let weekly_rel = checkin.weekly_review_vault_path.unwrap();
        let weekly_abs = test_db.second_brain_dir.join(&weekly_rel);
        assert!(weekly_abs.is_file(), "Weekly review Markdown file must be written to temp Vault");

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn f15_goals_seven_metric_rollups_focus_cap_and_90_degree_manhattan_blueprint() {
        use hermes_domain::courses::{
            CourseProvider, CourseStatus, CreateCourseLessonRequest, CreateCourseModuleRequest,
            CreateCourseRequest, LessonStatus,
        };
        use hermes_domain::finance::{AssetClass, CreatePortfolioAssetRequest, CurrencyCode};
        use hermes_domain::goals::{
            BlueprintPos, CreateGoalRequest, CreateKeyResultRequest, GoalPillar, GoalStatus,
            KrMetricType, OkrQuarter, UpdateGoalBlueprintPosRequest,
        };
        use hermes_domain::routines::{
            CreateRoutineItemRequest, CreateRoutineRequest, DayProfile, HabitFrequencyType,
            HabitTrackingType, LogRoutineItemRequest, RoutineLogStatus, RoutineTimeSlot,
        };
        use hermes_domain::todos::{
            CreateProjectRequest, CreateTaskRequest, ProjectArea, ProjectStatus, TaskStatus,
        };
        use rust_decimal::Decimal;

        let test_db = TestDb::new().await;
        let svc = LifeOpsService::from_test_db(&test_db);

        // Create linked entities for linked_course, linked_finance, linked_habit, linked_project
        let course = svc
            .create_course(CreateCourseRequest {
                title: "Rust Async Internals".to_string(),
                provider: CourseProvider::Custom,
                instructor: "Jon".to_string(),
                source_url: None,
                status: CourseStatus::Active,
                priority: Default::default(),
                goal_id: None,
                youtube_playlist_id: None,
                vault_folder_path: None,
                estimated_total_minutes: 60,
                target_completion_date: None,
            })
            .await
            .unwrap()
            .course;
        let c_mod = svc
            .create_course_module(
                course.id,
                CreateCourseModuleRequest {
                    title: "Pin & Futures".to_string(),
                    sort_order: Some(0),
                },
            )
            .await
            .unwrap();
        svc.create_course_lesson(
            c_mod.id,
            CreateCourseLessonRequest {
                title: "Lesson 1".to_string(),
                duration_minutes: 30,
                status: LessonStatus::Completed,
                external_url: None,
                youtube_video_id: None,
                vault_note_path: None,
                key_summary_md: String::new(),
                sort_order: Some(0),
            },
        )
        .await
        .unwrap();
        svc.create_course_lesson(
            c_mod.id,
            CreateCourseLessonRequest {
                title: "Lesson 2".to_string(),
                duration_minutes: 30,
                status: LessonStatus::Todo,
                external_url: None,
                youtube_video_id: None,
                vault_note_path: None,
                key_summary_md: String::new(),
                sort_order: Some(1),
            },
        )
        .await
        .unwrap();

        let asset = svc
            .create_asset(CreatePortfolioAssetRequest {
                id: None,
                symbol: "WEGE3.SA".to_string(),
                name: "WEG S.A.".to_string(),
                asset_class: AssetClass::BrEquity,
                currency: CurrencyCode::Brl,
                in_portfolio: true,
                is_watchlist: None,
                quantity: Decimal::from(100),
                avg_cost_cents: 3500,
                current_price_cents: 4000, // 400_000 cents
                previous_close_cents: Some(3900),
                dividend_yield_pct: None,
                target_weight_pct: Decimal::from(50),
                alert_low_cents: None,
                alert_high_cents: None,
                thesis_md: String::new(),
            })
            .await
            .unwrap();

        let routine = svc
            .create_routine(CreateRoutineRequest {
                name: "Health Stack".to_string(),
                time_slot: RoutineTimeSlot::Morning,
                day_profile: DayProfile::Workday,
                target_start_time: None,
                sort_order: Some(0),
                active: true,
            })
            .await
            .unwrap();
        let habit = svc
            .create_routine_item(
                routine.routine.id,
                CreateRoutineItemRequest {
                    goal_id: None,
                    title: "Run 5km".to_string(),
                    tracking_type: HabitTrackingType::Boolean,
                    target_value: None,
                    unit: None,
                    frequency_type: HabitFrequencyType::Daily,
                    frequency_config: serde_json::json!({}),
                    estimated_minutes: Some(30),
                    sort_order: Some(0),
                },
            )
            .await
            .unwrap();
        svc.log_routine_item(LogRoutineItemRequest {
            routine_item_id: habit.id,
            log_date: Some(Utc::now().date_naive()),
            status: RoutineLogStatus::Completed,
            numeric_value: None,
            notes: String::new(),
        })
        .await
        .unwrap();

        let proj = svc
            .create_project(CreateProjectRequest {
                name: "Launch v1".to_string(),
                area: ProjectArea::Career,
                goal_id: None,
                status: ProjectStatus::Active,
                color: "#2CE5F2".to_string(),
            })
            .await
            .unwrap();
        svc.create_task(CreateTaskRequest {
            title: "Ship API".to_string(),
            project_id: Some(proj.id),
            status: TaskStatus::Done,
            ..Default::default()
        })
        .await
        .unwrap();

        let goal = svc
            .create_goal(CreateGoalRequest {
                year: 2026,
                pillar: GoalPillar::Systems,
                code: Some("G01".to_string()),
                title: "Master Full-Stack Life Ops".to_string(),
                why_motivation_md: "Unified execution".to_string(),
                status: GoalStatus::InProgress,
                priority_rank: Some(1),
                target_date: None,
                confidence_score: Some(9),
                blueprint_pos: None,
            })
            .await
            .unwrap();

        // Add all 7 KR metric types
        let _kr_num = svc
            .create_key_result(
                goal.goal.id,
                CreateKeyResultRequest {
                    quarter: OkrQuarter::Q1,
                    code: Some("KR1".to_string()),
                    title: "Numeric KR".to_string(),
                    metric_type: KrMetricType::Numeric,
                    start_value: Decimal::ZERO,
                    current_value: Decimal::from(50),
                    target_value: Decimal::from(100),
                    unit: "%".to_string(),
                    milestones_json: serde_json::json!([]),
                    linked_entity_id: None,
                    weight: Some(Decimal::ONE),
                    blueprint_pos: None,
                },
            )
            .await
            .unwrap();

        let _kr_mile = svc
            .create_key_result(
                goal.goal.id,
                CreateKeyResultRequest {
                    quarter: OkrQuarter::Q1,
                    code: Some("KR2".to_string()),
                    title: "Milestones KR".to_string(),
                    metric_type: KrMetricType::Milestones,
                    start_value: Decimal::ZERO,
                    current_value: Decimal::ZERO,
                    target_value: Decimal::from(100),
                    unit: "%".to_string(),
                    milestones_json: serde_json::json!([
                        {"title": "M1", "done": true, "weight": 1.0},
                        {"title": "M2", "done": false, "weight": 1.0}
                    ]),
                    linked_entity_id: None,
                    weight: Some(Decimal::ONE),
                    blueprint_pos: None,
                },
            )
            .await
            .unwrap();

        let _kr_bin = svc
            .create_key_result(
                goal.goal.id,
                CreateKeyResultRequest {
                    quarter: OkrQuarter::Q2,
                    code: Some("KR3".to_string()),
                    title: "Binary KR".to_string(),
                    metric_type: KrMetricType::Binary,
                    start_value: Decimal::ZERO,
                    current_value: Decimal::ONE,
                    target_value: Decimal::ONE,
                    unit: "bool".to_string(),
                    milestones_json: serde_json::json!([]),
                    linked_entity_id: None,
                    weight: Some(Decimal::ONE),
                    blueprint_pos: None,
                },
            )
            .await
            .unwrap();

        let _kr_course = svc
            .create_key_result(
                goal.goal.id,
                CreateKeyResultRequest {
                    quarter: OkrQuarter::Q2,
                    code: Some("KR4".to_string()),
                    title: "Linked Course KR".to_string(),
                    metric_type: KrMetricType::LinkedCourse,
                    start_value: Decimal::ZERO,
                    current_value: Decimal::ZERO,
                    target_value: Decimal::from(100),
                    unit: "%".to_string(),
                    milestones_json: serde_json::json!([]),
                    linked_entity_id: Some(course.id),
                    weight: Some(Decimal::ONE),
                    blueprint_pos: None,
                },
            )
            .await
            .unwrap();

        let _kr_fin = svc
            .create_key_result(
                goal.goal.id,
                CreateKeyResultRequest {
                    quarter: OkrQuarter::Q3,
                    code: Some("KR5".to_string()),
                    title: "Linked Finance KR".to_string(),
                    metric_type: KrMetricType::LinkedFinance,
                    start_value: Decimal::ZERO,
                    current_value: Decimal::ZERO,
                    target_value: Decimal::from(800_000),
                    unit: "BRL_cents".to_string(),
                    milestones_json: serde_json::json!([]),
                    linked_entity_id: Some(asset.id),
                    weight: Some(Decimal::ONE),
                    blueprint_pos: None,
                },
            )
            .await
            .unwrap();

        let _kr_habit = svc
            .create_key_result(
                goal.goal.id,
                CreateKeyResultRequest {
                    quarter: OkrQuarter::Q3,
                    code: Some("KR6".to_string()),
                    title: "Linked Habit KR".to_string(),
                    metric_type: KrMetricType::LinkedHabit,
                    start_value: Decimal::ZERO,
                    current_value: Decimal::ZERO,
                    target_value: Decimal::from(2),
                    unit: "sessions".to_string(),
                    milestones_json: serde_json::json!([]),
                    linked_entity_id: Some(habit.id),
                    weight: Some(Decimal::ONE),
                    blueprint_pos: None,
                },
            )
            .await
            .unwrap();

        let _kr_proj = svc
            .create_key_result(
                goal.goal.id,
                CreateKeyResultRequest {
                    quarter: OkrQuarter::Q4,
                    code: Some("KR7".to_string()),
                    title: "Linked Project KR".to_string(),
                    metric_type: KrMetricType::LinkedProject,
                    start_value: Decimal::ZERO,
                    current_value: Decimal::ZERO,
                    target_value: Decimal::from(100),
                    unit: "%".to_string(),
                    milestones_json: serde_json::json!([]),
                    linked_entity_id: Some(proj.id),
                    weight: Some(Decimal::ONE),
                    blueprint_pos: None,
                },
            )
            .await
            .unwrap();

        let refreshed_goal = svc.get_goal(goal.goal.id).await.unwrap();
        assert_eq!(refreshed_goal.key_results.len(), 7);
        // Progress is (50 + 50 + 100 + 50 + 50 + 50 + 100) / 7 = 450 / 7 = 64.29%
        assert!(refreshed_goal.goal.progress_pct > Decimal::from(60));

        // Pin goal to a custom blueprint position and verify 90° orthogonal corridor invariant
        svc.update_goal_blueprint_pos(
            goal.goal.id,
            UpdateGoalBlueprintPosRequest {
                blueprint_pos: BlueprintPos { x: 850.0, y: 240.0 },
            },
        )
        .await
        .unwrap();

        let bp = svc.get_goal_blueprint(2026).await.expect("get_goal_blueprint");
        assert!(!bp.nodes.is_empty());
        assert!(!bp.corridors.is_empty());
        for corridor in &bp.corridors {
            assert!(corridor.polyline.len() >= 2);
            for seg in corridor.polyline.windows(2) {
                let [x1, y1] = seg[0];
                let [x2, y2] = seg[1];
                assert!(
                    x1 == x2 || y1 == y2,
                    "Blueprint corridor segment must be strictly 90° orthogonal: ({x1},{y1}) -> ({x2},{y2})"
                );
            }
        }

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn f16_courses_readonly_youtube_sqlite_secret_redaction_quiz_and_spaced_review() {
        use hermes_domain::courses::{
            CourseProvider, CourseQuizRequest, CourseStatus, CreateCourseRequest,
            ImportOutlineRequest, ImportYoutubePlaylistRequest, ReviewLessonRequest,
            SpacedReviewAction, SpawnCourseTodoRequest,
        };

        let test_db = TestDb::new().await;
        let svc = LifeOpsService::from_test_db(&test_db);

        // 1. Missing youtube-lists.sqlite must return db_available = false and NEVER create a file on disk
        assert!(!test_db.youtube_lists_db.exists());
        let missing_resp = svc
            .list_youtube_playlists()
            .await
            .expect("list_youtube_playlists when missing");
        assert!(!missing_resp.db_available);
        assert!(missing_resp.playlists.is_empty());
        assert!(
            !test_db.youtube_lists_db.exists(),
            "list_youtube_playlists MUST NOT create an empty SQLite file when missing"
        );

        // 2. Populate a real SQLite database in test_db.youtube_lists_db + companion markdown notes
        {
            let conn = rusqlite::Connection::open(&test_db.youtube_lists_db).unwrap();
            conn.execute_batch(
                r#"
                CREATE TABLE playlist (
                    playlist_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    folder TEXT
                );
                CREATE TABLE video (
                    video_id TEXT PRIMARY KEY,
                    playlist_id TEXT NOT NULL,
                    title TEXT,
                    url TEXT,
                    position INTEGER
                );
                CREATE TABLE video_detail (
                    video_id TEXT PRIMARY KEY,
                    title TEXT,
                    duration TEXT,
                    description TEXT,
                    note_path TEXT,
                    note_file TEXT
                );
                CREATE TABLE ai_note (
                    video_id TEXT PRIMARY KEY,
                    output_text TEXT,
                    output_file TEXT
                );
                INSERT INTO playlist (playlist_id, title, folder)
                VALUES ('PL_RUST_SYS', 'Rust Systems Programming', 'rust-systems');

                INSERT INTO video (video_id, playlist_id, title, url, position)
                VALUES ('vid_01', 'PL_RUST_SYS', 'Memory Layout & Ownership', 'https://youtu.be/vid_01', 1),
                       ('vid_02', 'PL_RUST_SYS', 'Shared Ref Video', 'https://youtu.be/vid_02', 2);

                INSERT INTO video_detail (video_id, title, duration, description, note_path, note_file)
                VALUES ('vid_01', 'Memory Layout & Ownership', 'PT25M', 'Intro to ownership', 'rust-systems/videos/vid-01/vid-01.md', 'vid-01.md'),
                       ('vid_02', 'Zero-Copy Parsing', '18:00', 'Fallback description', NULL, 'vid-02.md');

                "#,
            )
            .unwrap();
            let fake_openai = format!("{}{}", "sk-proj-", "1234567890abcdefghijklmnop");
            let fake_gapi = format!("{}{}", "AIzaSyA", "12345678901234567890123456789012");
            conn.execute(
                "INSERT INTO ai_note (video_id, output_text, output_file) VALUES ('vid_01', ?1, NULL)",
                [format!("Summary with leaked key {fake_openai} and {fake_gapi}")],
            )
            .unwrap();
        }

        // Create a -ref.md pointer for vid-02 pointing to another playlist's folder + companion -ai-knowledge.md
        let ref_dir = test_db
            .youtube_lists_notes_dir
            .join("rust-systems/videos/vid-02");
        let owner_dir = test_db
            .youtube_lists_notes_dir
            .join("shared-parsers/videos/vid-02");
        std::fs::create_dir_all(&ref_dir).unwrap();
        std::fs::create_dir_all(&owner_dir).unwrap();
        std::fs::write(
            ref_dir.join("vid-02-ref.md"),
            "# Shared Ref\n- **Full note:** [Zero-Copy Parsing](../../../shared-parsers/videos/vid-02/vid-02.md)\n",
        )
        .unwrap();
        let fake_aws = format!("{}{}", "AKIA", "1234567890ABCDEF");
        std::fs::write(
            owner_dir.join("vid-02-ai-knowledge.md"),
            format!(
                "---\ntitle: Zero-Copy\n---\n> AI knowledge generated by gemini\n\nZero-copy slices with AWS key {fake_aws}!\n"
            ),
        )
        .unwrap();

        let avail_resp = svc.list_youtube_playlists().await.unwrap();
        assert!(avail_resp.db_available);
        assert_eq!(avail_resp.playlists.len(), 1);
        assert_eq!(avail_resp.playlists[0].video_count, 2);

        let imported = svc
            .import_youtube_playlist(ImportYoutubePlaylistRequest {
                playlist_id: "PL_RUST_SYS".to_string(),
                goal_id: None,
                title_override: None,
            })
            .await
            .expect("import_youtube_playlist");
        assert_eq!(imported.course.total_items, 2);
        assert_eq!(imported.course.completed_items, 2); // Both distilled!
        let lessons = &imported.modules[0].lessons;
        assert_eq!(lessons.len(), 2);
        assert!(
            lessons[0].key_summary_md.contains("[redacted API key]"),
            "Leaked OpenAI key must be redacted: {}",
            lessons[0].key_summary_md
        );
        assert!(
            lessons[0].key_summary_md.contains("[redacted Google API key]"),
            "Leaked Google API key must be redacted: {}",
            lessons[0].key_summary_md
        );
        assert_eq!(
            lessons[1].vault_note_path.as_deref(),
            Some("shared-parsers/videos/vid-02/vid-02.md")
        );
        assert!(
            lessons[1]
                .key_summary_md
                .contains("[redacted AWS access key]"),
            "Leaked AWS key must be redacted: {}",
            lessons[1].key_summary_md
        );

        // 3. Pasted syllabus outline parser, 1-Click Quiz & Lab Todo Spawner
        let outline_course = svc
            .create_course(CreateCourseRequest {
                title: "Compilers 101".to_string(),
                provider: CourseProvider::Custom,
                instructor: "Dragon".to_string(),
                source_url: None,
                status: CourseStatus::Active,
                priority: Default::default(),
                goal_id: None,
                youtube_playlist_id: None,
                vault_folder_path: None,
                estimated_total_minutes: 0,
                target_completion_date: None,
            })
            .await
            .unwrap()
            .course;

        let parsed_syllabus = svc
            .import_course_outline(
                outline_course.id,
                ImportOutlineRequest {
                    outline_text: "# Module 1: Lexing\n- Tokenizers (20m)\n- DFA Construction (40m)\n# Module 2: Parsing\n- Recursive Descent (1h 15m)\n".to_string(),
                },
            )
            .await
            .expect("import_course_outline");
        assert_eq!(parsed_syllabus.modules.len(), 2);
        assert_eq!(parsed_syllabus.course.total_items, 3);
        assert_eq!(parsed_syllabus.course.estimated_total_minutes, 135);

        let quiz = svc
            .create_course_quiz(
                imported.course.id,
                CourseQuizRequest {
                    lesson_id: Some(lessons[0].id),
                    module_id: None,
                },
            )
            .await
            .expect("create_course_quiz");
        assert!(quiz.session_key.starts_with("sess_quiz_"));

        let lab_todo = svc
            .spawn_course_todo(
                imported.course.id,
                SpawnCourseTodoRequest {
                    title: "Implement Arena Allocator Lab".to_string(),
                    lesson_id: Some(lessons[0].id),
                    scheduled_date: None,
                },
            )
            .await
            .expect("spawn_course_todo");
        assert_eq!(lab_todo.course_id, Some(imported.course.id));

        // 4. Spaced Review progression: 0 (7d) -> 1 (30d) -> 2 (90d) -> 3 (graduated, next_review_date = None)
        let l0_id = lessons[0].id;
        assert_eq!(lessons[0].review_stage, 0);

        let r1 = svc
            .complete_lesson_review(
                l0_id,
                ReviewLessonRequest {
                    action: SpacedReviewAction::Complete,
                    rating: None,
                    snooze_days: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(r1.review_stage, 1);
        assert!(r1.next_review_date.is_some());

        let r2 = svc
            .complete_lesson_review(
                l0_id,
                ReviewLessonRequest {
                    action: SpacedReviewAction::Complete,
                    rating: None,
                    snooze_days: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(r2.review_stage, 2);
        assert!(r2.next_review_date.is_some());

        let r3 = svc
            .complete_lesson_review(
                l0_id,
                ReviewLessonRequest {
                    action: SpacedReviewAction::Complete,
                    rating: None,
                    snooze_days: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(r3.review_stage, 3);
        assert!(r3.next_review_date.is_none());

        test_db.teardown().await;
    }

    #[tokio::test]
    async fn f17_finance_200_tile_waffle_buy_only_rebalancer_macro_spend_fire_and_5_pillar_life_score() {
        use hermes_domain::finance::{
            AssetClass, CreatePortfolioAssetRequest, CurrencyCode, FireSimulationRequest,
            UpsertMonthlyInvestmentPlanRequest,
        };
        use rust_decimal::Decimal;

        let test_db = TestDb::new().await;
        let svc = LifeOpsService::from_test_db(&test_db);
        let mut events_rx = svc.subscribe_events();

        // 1. Empty portfolio allocation has 0 waffle tiles
        let empty_alloc = svc.get_portfolio_allocation(None, None).await.unwrap();
        assert_eq!(empty_alloc.total_brl_cents, 0);
        assert!(empty_alloc.waffle_tiles.is_empty());

        // 2. Create 3 holdings with equal value (33.333% each) to verify Hare-Niemeyer largest-remainder -> 200 tiles
        let a1 = svc
            .create_asset(CreatePortfolioAssetRequest {
                id: None,
                symbol: "PETR4.SA".to_string(),
                name: "Petrobras".to_string(),
                asset_class: AssetClass::BrEquity,
                currency: CurrencyCode::Brl,
                in_portfolio: true,
                is_watchlist: None,
                quantity: Decimal::from(100),
                avg_cost_cents: 3000,
                current_price_cents: 4000, // R$ 4,000.00 (400,000 cents)
                previous_close_cents: Some(3900),
                dividend_yield_pct: None,
                target_weight_pct: Decimal::from(20), // Overweight (33.33% > 20%)
                alert_low_cents: Some(3500),
                alert_high_cents: Some(3950), // Trigger high alert!
                thesis_md: "Cash cow".to_string(),
            })
            .await
            .unwrap();

        let _a2 = svc
            .create_asset(CreatePortfolioAssetRequest {
                id: None,
                symbol: "VOO".to_string(),
                name: "Vanguard S&P 500".to_string(),
                asset_class: AssetClass::GlobalEtf,
                currency: CurrencyCode::Usd,
                in_portfolio: true,
                is_watchlist: None,
                quantity: Decimal::from(2),
                avg_cost_cents: 38000,
                current_price_cents: 40000, // $800.00 * 5.00 BRL/USD = R$ 4,000.00 (400,000 cents)
                previous_close_cents: Some(39500),
                dividend_yield_pct: None,
                target_weight_pct: Decimal::from(50), // Underweight (33.33% < 50%)
                alert_low_cents: None,
                alert_high_cents: None,
                thesis_md: "Core S&P 500".to_string(),
            })
            .await
            .unwrap();

        let _a3 = svc
            .create_asset(CreatePortfolioAssetRequest {
                id: None,
                symbol: "HGLG11.SA".to_string(),
                name: "CSHG Logistica".to_string(),
                asset_class: AssetClass::BrFii,
                currency: CurrencyCode::Brl,
                in_portfolio: true,
                is_watchlist: None,
                quantity: Decimal::from(25),
                avg_cost_cents: 15500,
                current_price_cents: 16000, // R$ 4,000.00 (400,000 cents)
                previous_close_cents: Some(15900),
                dividend_yield_pct: None,
                target_weight_pct: Decimal::from(30), // Underweight after deposit
                alert_low_cents: None,
                alert_high_cents: None,
                thesis_md: "Logistics FII".to_string(),
            })
            .await
            .unwrap();

        // Watchlist item (excluded from Waffle & Rebalancer)
        let _watch = svc
            .create_asset(CreatePortfolioAssetRequest {
                id: None,
                symbol: "BTC".to_string(),
                name: "Bitcoin".to_string(),
                asset_class: AssetClass::Crypto,
                currency: CurrencyCode::Usd,
                in_portfolio: false,
                is_watchlist: Some(true),
                quantity: Decimal::ZERO,
                avg_cost_cents: 0,
                current_price_cents: 9_000_000,
                previous_close_cents: None,
                dividend_yield_pct: None,
                target_weight_pct: Decimal::ZERO,
                alert_low_cents: None,
                alert_high_cents: None,
                thesis_md: "Watchlist only".to_string(),
            })
            .await
            .unwrap();

        // Verify PortfolioPriceAlert was emitted for PETR4.SA
        let mut saw_price_alert = false;
        while let Ok(ev) = events_rx.try_recv() {
            if matches!(ev, SystemEvent::PortfolioPriceAlert { ref symbol, .. } if symbol == "PETR4.SA") {
                saw_price_alert = true;
            }
        }
        assert!(saw_price_alert, "Expected SystemEvent::PortfolioPriceAlert for PETR4.SA");

        // 3. Verify 10x20 Waffle Grid has EXACTLY 200 tiles and Buy-Only Rebalancer has 0 sells
        let alloc = svc
            .get_portfolio_allocation(Some(CurrencyCode::Brl), Some(300_000))
            .await
            .expect("get_portfolio_allocation");
        assert_eq!(alloc.total_brl_cents, 1_200_000);
        assert_eq!(
            alloc.waffle_tiles.len(),
            200,
            "10x20 Waffle Grid must contain exactly 200 tiles when portfolio value > 0"
        );
        let buy_sum: i64 = alloc
            .recommendations
            .iter()
            .map(|r| {
                assert!(
                    r.recommended_buy_cents >= 0,
                    "Buy-only rebalancer must never produce negative/sell recommendations"
                );
                r.recommended_buy_cents
            })
            .sum();
        assert_eq!(buy_sum, 300_000);
        let petr_rec = alloc
            .recommendations
            .iter()
            .find(|r| r.symbol == "PETR4.SA")
            .unwrap();
        assert_eq!(
            petr_rec.recommended_buy_cents, 0,
            "Overweight holding PETR4.SA (33.33% > 20% target) must receive 0 buy cents"
        );

        // 4. Verify synthetic OHLCV candlesticks
        let candles = svc
            .get_asset_candles(a1.id, "1M")
            .await
            .expect("get_asset_candles");
        assert_eq!(candles.candles.len(), 30);
        for bar in &candles.candles {
            assert!(bar.high_cents >= bar.open_cents.max(bar.close_cents));
            assert!(bar.low_cents <= bar.open_cents.min(bar.close_cents));
            assert!(bar.low_cents > 0);
        }

        // 5. Verify Macro 'YYYY-MM' Monthly Plan validation & cashflow computation
        assert!(svc.get_monthly_plan("2026-13").await.is_err());
        let plan = svc
            .upsert_monthly_plan(
                "2026-11",
                UpsertMonthlyInvestmentPlanRequest {
                    currency: CurrencyCode::Brl,
                    fx_usd_brl: None,
                    salary_income_cents: 2_500_000,
                    other_income_cents: 0,
                    planned_spend_cents: 1_000_000,
                    actual_spend_cents: Some(900_000),
                    planned_investment_cents: 1_500_000,
                    actual_invested_cents: 1_600_000,
                    allocations_json: serde_json::json!([]),
                    notes_md: "November plan".to_string(),
                },
            )
            .await
            .expect("upsert_monthly_plan");
        assert_eq!(plan.investable_surplus_cents, 1_600_000);
        assert!(plan.savings_rate_pct > 60.0);

        // 6. Verify FIRE Projection & What-If Simulator boundary cases
        let fire = svc
            .get_retirement_projection()
            .await
            .expect("get_retirement_projection");
        assert!(fire.fi_target_brl_cents > 0);
        assert!(fire.years_to_fi.is_finite());
        assert!(!fire.unreachable);
        assert!(!fire.trajectory.is_empty());

        let unreachable_sim = svc
            .simulate_retirement(FireSimulationRequest {
                current_net_worth_brl_cents: Some(100_000),
                monthly_contribution_brl_cents: Some(0),
                monthly_retirement_spend_brl_cents: Some(1_000_000),
                expected_real_return_pct: Some(Decimal::ZERO),
                safe_withdrawal_rate_pct: Some(Decimal::from(4)),
                current_age: Some(30),
            })
            .await
            .expect("simulate unreachable FIRE");
        assert!(unreachable_sim.unreachable);
        assert_eq!(unreachable_sim.years_to_fi, 999.0);
        assert!(unreachable_sim.projected_fi_date.is_none());

        // 7. Verify 5-pillar Life Score rollup & enriched portfolio_fire widget refresh
        let life_score = svc.compute_life_score().await.expect("compute_life_score");
        assert!(life_score.composite_score > 0.0 && life_score.composite_score <= 100.0);
        assert!(life_score.pillars.wealth > 50.0);

        let dashboards = svc.list_dashboards().await.unwrap();
        let wealth_deck = dashboards
            .iter()
            .find(|d| d.dashboard.slug == "wealth-fire" || d.dashboard.slug.contains("wealth"))
            .unwrap_or(&dashboards[0]);
        let wealth_detail = svc.get_dashboard(&wealth_deck.dashboard.slug).await.unwrap();
        let waffle_widget = wealth_detail
            .widgets
            .iter()
            .find(|w| {
                w.source_config
                    .get("builtin_key")
                    .and_then(|v| v.as_str())
                    == Some("portfolio_waffle")
            })
            .expect("seeded portfolio_waffle widget");
        let refreshed_w = svc
            .refresh_widget(waffle_widget.id)
            .await
            .expect("refresh portfolio_waffle widget");
        let payload = refreshed_w.cached_payload.as_ref().expect("cached_payload");
        assert_eq!(payload["total_brl_cents"], serde_json::json!(1_200_000));
        assert_eq!(payload["waffle_tiles"].as_array().unwrap().len(), 200);

        test_db.teardown().await;
    }
}
