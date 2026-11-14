//! Core `LifeOpsService` handle combining `PgPool`, `redis::Client`, `LifeOpsConfig`,
//! `broadcast::Sender<SystemEvent>`, and `reqwest::Client`.

use std::time::Duration;

use hermes_domain::{error::ApiError, events::SystemEvent};
use sqlx::PgPool;
use tokio::sync::broadcast;

use crate::{config::LifeOpsConfig, test_support::TestDb};

#[derive(Clone)]
pub struct LifeOpsService {
    pub pool: PgPool,
    pub redis: Option<redis::Client>,
    pub config: LifeOpsConfig,
    pub events_tx: broadcast::Sender<SystemEvent>,
    pub http_client: reqwest::Client,
}

impl LifeOpsService {
    pub fn new(pool: PgPool, redis: Option<redis::Client>, config: LifeOpsConfig) -> Self {
        let (events_tx, _) = broadcast::channel(256);
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            pool,
            redis,
            config,
            events_tx,
            http_client,
        }
    }

    pub fn from_test_db(test_db: &TestDb) -> Self {
        let config = LifeOpsConfig::from_test_db(test_db);
        let redis = config
            .redis_url
            .as_deref()
            .and_then(|u| redis::Client::open(u).ok());
        Self::new(test_db.pool.clone(), redis, config)
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<SystemEvent> {
        self.events_tx.subscribe()
    }

    pub fn emit_event(&self, event: SystemEvent) {
        let _ = self.events_tx.send(event);
    }

    pub async fn latest_server_seq(&self) -> Result<i64, ApiError> {
        let seq: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(server_seq), 0) FROM sync_change_log")
            .fetch_one(&self.pool)
            .await?;
        Ok(seq)
    }
}
