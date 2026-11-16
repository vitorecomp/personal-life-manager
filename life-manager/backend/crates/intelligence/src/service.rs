//! Unified `IntelligenceService` facade combining `LifeOpsService`, `PgPool`,
//! `hermes gateway` configuration, `second_brain_dir`, and `SystemEvent` broadcast bus.

use std::{collections::HashSet, path::PathBuf, sync::Arc, time::Duration};

use hermes_domain::events::SystemEvent;
use hermes_life_ops::{LifeOpsService, test_support::TestDb};
use sqlx::PgPool;
use tokio::sync::{Mutex, RwLock, broadcast};
use tokio_cron_scheduler::JobScheduler;
use uuid::Uuid;

use crate::DEFAULT_HERMES_GATEWAY_URL;

#[derive(Clone)]
pub struct IntelligenceService {
    pub life_ops: LifeOpsService,
    pub pool: PgPool,
    pub gateway_url: String,
    pub gateway_api_key: Option<String>,
    pub second_brain_dir: PathBuf,
    pub events_tx: broadcast::Sender<SystemEvent>,
    pub http_client: reqwest::Client,
    pub dismissed_nudges: Arc<RwLock<HashSet<Uuid>>>,
    pub knight_scheduler: Arc<Mutex<Option<JobScheduler>>>,
}

impl IntelligenceService {
    pub fn new(
        life_ops: LifeOpsService,
        gateway_url: Option<String>,
        gateway_api_key: Option<String>,
    ) -> Self {
        let pool = life_ops.pool.clone();
        let second_brain_dir = life_ops.config.second_brain_dir.clone();
        let events_tx = life_ops.events_tx.clone();
        let resolved_gateway_url = gateway_url
            .filter(|u| !u.trim().is_empty())
            .unwrap_or_else(|| {
                if life_ops.config.hermes_gateway_url.trim().is_empty() {
                    DEFAULT_HERMES_GATEWAY_URL.to_string()
                } else {
                    life_ops.config.hermes_gateway_url.clone()
                }
            });
        let resolved_api_key = gateway_api_key.or_else(|| {
            std::env::var("HERMES_API_KEY")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        });
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| life_ops.http_client.clone());

        Self {
            life_ops,
            pool,
            gateway_url: resolved_gateway_url,
            gateway_api_key: resolved_api_key,
            second_brain_dir,
            events_tx,
            http_client,
            dismissed_nudges: Arc::new(RwLock::new(HashSet::new())),
            knight_scheduler: Arc::new(Mutex::new(None)),
        }
    }

    pub fn from_life_ops(life_ops: LifeOpsService) -> Self {
        Self::new(life_ops, None, None)
    }

    pub fn from_test_db(test_db: &TestDb) -> Self {
        let life_ops = LifeOpsService::from_test_db(test_db);
        Self::new(life_ops, None, None)
    }

    pub fn with_gateway_url(mut self, gateway_url: impl Into<String>) -> Self {
        let url = gateway_url.into();
        self.life_ops.config.hermes_gateway_url = url.clone();
        self.gateway_url = url;
        self
    }

    pub fn with_gateway_api_key(mut self, api_key: Option<String>) -> Self {
        self.gateway_api_key = api_key;
        self
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<SystemEvent> {
        self.events_tx.subscribe()
    }

    pub fn emit_event(&self, event: SystemEvent) {
        self.life_ops.emit_event(event);
    }
}
