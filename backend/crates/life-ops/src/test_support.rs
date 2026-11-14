//! Public isolated PostgreSQL test harness (`TestDb`) for `hermes-life-ops`,
//! `hermes-intelligence`, and `hermes-server` integration tests.

use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

use sqlx::{
    Connection, Executor, PgConnection, PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use uuid::Uuid;

const TEST_DB_ADVISORY_LOCK_KEY: i64 = 8_642_001;

/// Run all workspace SQLx migrations (`backend/migrations/*.sql`) on the given `PgPool`.
pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("../../migrations").run(pool).await
}

pub struct TestDb {
    pub pool: PgPool,
    pub db_name: String,
    pub temp_dir: PathBuf,
    pub second_brain_dir: PathBuf,
    pub youtube_lists_db: PathBuf,
    pub youtube_lists_notes_dir: PathBuf,
    admin_opts: PgConnectOptions,
    dropped: bool,
}

impl TestDb {
    /// Provisions a fresh isolated PostgreSQL database `hermes_test_<uuid_v7>`,
    /// runs all `backend/migrations/*.sql`, and creates isolated temp directories
    /// so `data/` is never touched.
    pub async fn new() -> Self {
        let base_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://hermes:hermes@127.0.0.1:5432/hermes_os".to_string());
        let base_opts =
            PgConnectOptions::from_str(&base_url).expect("Invalid DATABASE_URL for TestDb");
        let admin_opts = base_opts.clone().database("postgres");

        let suffix = Uuid::now_v7().simple().to_string();
        let db_name = format!("hermes_test_{suffix}");

        // 1. Short-lived admin connection serialized via Postgres advisory lock
        // so concurrent test threads/binaries never collide on `template1`.
        let mut admin_conn = PgConnection::connect_with(&admin_opts)
            .await
            .expect("Failed to connect to postgres admin database");
        sqlx::query("SELECT pg_advisory_lock($1)")
            .bind(TEST_DB_ADVISORY_LOCK_KEY)
            .execute(&mut admin_conn)
            .await
            .expect("Failed to acquire TestDb advisory lock");

        let create_res = admin_conn
            .execute(format!("CREATE DATABASE \"{db_name}\"").as_str())
            .await;

        let _ = sqlx::query("SELECT pg_advisory_unlock($1)")
            .bind(TEST_DB_ADVISORY_LOCK_KEY)
            .execute(&mut admin_conn)
            .await;
        let _ = admin_conn.close().await;
        create_res.expect("Failed to CREATE DATABASE for TestDb");

        // 2. Connect bounded test pool (`max_connections(2)` stays well below `max_connections = 100`)
        let test_opts = base_opts.database(&db_name);
        let pool = PgPoolOptions::new()
            .max_connections(2)
            .min_connections(0)
            .acquire_timeout(Duration::from_secs(15))
            .idle_timeout(Duration::from_secs(5))
            .connect_with(test_opts)
            .await
            .expect("Failed to connect PgPool to isolated TestDb");

        // 3. Run all workspace migrations (`CREATE EXTENSION IF NOT EXISTS vector`, DDL, triggers, seeds)
        run_migrations(&pool)
            .await
            .expect("Failed to run SQLx migrations on TestDb");

        // 4. Create isolated temp directories for Vault/Crawler paths (never touching repo `data/`)
        let temp_dir = std::env::temp_dir().join(&db_name);
        let second_brain_dir = temp_dir.join("second-brain");
        let youtube_lists_notes_dir = temp_dir.join("knowledge-data/lists/youtube");
        let youtube_lists_db = temp_dir.join("database/youtube-lists.sqlite");
        std::fs::create_dir_all(&second_brain_dir).expect("create temp second_brain_dir");
        std::fs::create_dir_all(&youtube_lists_notes_dir)
            .expect("create temp youtube_lists_notes_dir");
        if let Some(parent) = youtube_lists_db.parent() {
            std::fs::create_dir_all(parent).expect("create temp database parent dir");
        }

        Self {
            pool,
            db_name,
            temp_dir,
            second_brain_dir,
            youtube_lists_db,
            youtube_lists_notes_dir,
            admin_opts,
            dropped: false,
        }
    }

    /// Explicitly closes the pool, drops the temporary database, and removes temp dirs.
    pub async fn teardown(mut self) {
        self.dropped = true;
        self.pool.close().await;
        Self::drop_database(&self.admin_opts, &self.db_name).await;
        let _ = std::fs::remove_dir_all(&self.temp_dir);
    }

    async fn drop_database(admin_opts: &PgConnectOptions, db_name: &str) {
        if let Ok(mut conn) = PgConnection::connect_with(admin_opts).await {
            let _ = sqlx::query("SELECT pg_advisory_lock($1)")
                .bind(TEST_DB_ADVISORY_LOCK_KEY)
                .execute(&mut conn)
                .await;
            let _ = conn
                .execute(format!("DROP DATABASE IF EXISTS \"{db_name}\" WITH (FORCE)").as_str())
                .await;
            let _ = sqlx::query("SELECT pg_advisory_unlock($1)")
                .bind(TEST_DB_ADVISORY_LOCK_KEY)
                .execute(&mut conn)
                .await;
            let _ = conn.close().await;
        }
    }
}

impl Drop for TestDb {
    fn drop(&mut self) {
        if self.dropped {
            return;
        }
        self.dropped = true;
        let pool = self.pool.clone();
        let admin_opts = self.admin_opts.clone();
        let db_name = self.db_name.clone();
        let temp_dir = self.temp_dir.clone();
        let handle = std::thread::spawn(move || {
            if let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                rt.block_on(async move {
                    pool.close().await;
                    TestDb::drop_database(&admin_opts, &db_name).await;
                });
            }
            let _ = std::fs::remove_dir_all(&temp_dir);
        });
        let _ = handle.join();
    }
}
