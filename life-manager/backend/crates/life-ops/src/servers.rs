//! Feature F11 — Concurrent Tokio TCP (`3s`) & HTTP (`4s`) Server Infrastructure Prober (`server_nodes`).

use std::time::{Duration, Instant};

use chrono::Utc;
use futures::future::join_all;
use hermes_domain::{
    error::ApiError,
    events::SystemEvent,
    id::new_uuid_v7,
    servers::{
        CreateServerRequest, ServerCheckType, ServerNode, ServerStatus, ServerSummaryResponse,
        UpdateServerRequest,
    },
};
use uuid::Uuid;

use crate::service::LifeOpsService;

const MAX_LATENCY_HISTORY_SAMPLES: usize = 24;
const TCP_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const HTTP_PROBE_TIMEOUT: Duration = Duration::from_secs(4);

fn validate_server_fields(name: &str, host: &str, port: i32) -> Result<(), ApiError> {
    if name.trim().is_empty() {
        return Err(ApiError::bad_request("Server name must not be empty"));
    }
    if host.trim().is_empty() {
        return Err(ApiError::bad_request("Server host must not be empty"));
    }
    if !(1..=65_535).contains(&port) {
        return Err(ApiError::bad_request(
            "Server port must be between 1 and 65535",
        ));
    }
    Ok(())
}

impl LifeOpsService {
    /// List all configured server nodes ordered by `name ASC, created_at ASC`.
    pub async fn list_servers(&self) -> Result<Vec<ServerNode>, ApiError> {
        let servers = sqlx::query_as::<_, ServerNode>(
            "SELECT id, name, host, port, check_type, http_url, status, last_latency_ms, \
                    last_message, latency_history_ms, last_checked_at, tags, created_at, updated_at \
             FROM server_nodes \
             ORDER BY name ASC, created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(servers)
    }

    /// Get a single server node by ID (`404 Not Found` if missing).
    pub async fn get_server(&self, id: Uuid) -> Result<ServerNode, ApiError> {
        let server = sqlx::query_as::<_, ServerNode>(
            "SELECT id, name, host, port, check_type, http_url, status, last_latency_ms, \
                    last_message, latency_history_ms, last_checked_at, tags, created_at, updated_at \
             FROM server_nodes WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| ApiError::not_found(format!("Server '{id}' not found")))?;
        Ok(server)
    }

    /// Create a new monitored server node.
    pub async fn create_server(&self, req: CreateServerRequest) -> Result<ServerNode, ApiError> {
        validate_server_fields(&req.name, &req.host, req.port)?;
        let id = new_uuid_v7();
        let http_url = req
            .http_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string);

        let created = sqlx::query_as::<_, ServerNode>(
            "INSERT INTO server_nodes (id, name, host, port, check_type, http_url, tags) \
             VALUES ($1, $2, $3, $4, $5, $6, $7) \
             RETURNING id, name, host, port, check_type, http_url, status, last_latency_ms, \
                       last_message, latency_history_ms, last_checked_at, tags, created_at, updated_at",
        )
        .bind(id)
        .bind(req.name.trim())
        .bind(req.host.trim())
        .bind(req.port)
        .bind(req.check_type)
        .bind(http_url)
        .bind(&req.tags)
        .fetch_one(&self.pool)
        .await?;

        Ok(created)
    }

    /// Update an existing monitored server node.
    pub async fn update_server(
        &self,
        id: Uuid,
        req: UpdateServerRequest,
    ) -> Result<ServerNode, ApiError> {
        let existing = self.get_server(id).await?;
        let name = req
            .name
            .as_deref()
            .map(str::trim)
            .unwrap_or(&existing.name)
            .to_string();
        let host = req
            .host
            .as_deref()
            .map(str::trim)
            .unwrap_or(&existing.host)
            .to_string();
        let port = req.port.unwrap_or(existing.port);
        let check_type = req.check_type.unwrap_or(existing.check_type);
        let http_url = match req.http_url {
            Some(ref u) if u.trim().is_empty() => None,
            Some(u) => Some(u.trim().to_string()),
            None => existing.http_url,
        };
        let tags = req.tags.unwrap_or(existing.tags);

        validate_server_fields(&name, &host, port)?;

        let updated = sqlx::query_as::<_, ServerNode>(
            "UPDATE server_nodes SET \
                name = $2, \
                host = $3, \
                port = $4, \
                check_type = $5, \
                http_url = $6, \
                tags = $7, \
                updated_at = NOW() \
             WHERE id = $1 \
             RETURNING id, name, host, port, check_type, http_url, status, last_latency_ms, \
                       last_message, latency_history_ms, last_checked_at, tags, created_at, updated_at",
        )
        .bind(id)
        .bind(&name)
        .bind(&host)
        .bind(port)
        .bind(check_type)
        .bind(http_url)
        .bind(&tags)
        .fetch_one(&self.pool)
        .await?;

        Ok(updated)
    }

    /// Delete a monitored server node.
    pub async fn delete_server(&self, id: Uuid) -> Result<(), ApiError> {
        let res = sqlx::query("DELETE FROM server_nodes WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(ApiError::not_found(format!("Server '{id}' not found")));
        }
        Ok(())
    }

    /// Probe a single server node (`3s` TCP connect or `4s` HTTP GET), update its status and
    /// `latency_history_ms` ring buffer (`<= 24` items), and broadcast `SystemEvent::ServerStatusChanged`.
    pub async fn check_server(&self, id: Uuid) -> Result<ServerNode, ApiError> {
        let node = self.get_server(id).await?;
        let previous_status = node.status;

        let (status, latency_ms, message) = match node.check_type {
            ServerCheckType::Tcp => self.probe_tcp(&node.host, node.port).await,
            ServerCheckType::Http => {
                let url = node
                    .http_url
                    .clone()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| format!("http://{}:{}", node.host, node.port));
                self.probe_http(&url).await
            }
        };

        let mut history = node.latency_history_ms;
        history.push(latency_ms.unwrap_or(0));
        if history.len() > MAX_LATENCY_HISTORY_SAMPLES {
            let excess = history.len() - MAX_LATENCY_HISTORY_SAMPLES;
            history.drain(0..excess);
        }

        let updated = sqlx::query_as::<_, ServerNode>(
            "UPDATE server_nodes SET \
                status = $2, \
                last_latency_ms = $3, \
                last_message = $4, \
                latency_history_ms = $5, \
                last_checked_at = NOW(), \
                updated_at = NOW() \
             WHERE id = $1 \
             RETURNING id, name, host, port, check_type, http_url, status, last_latency_ms, \
                       last_message, latency_history_ms, last_checked_at, tags, created_at, updated_at",
        )
        .bind(id)
        .bind(status)
        .bind(latency_ms)
        .bind(&message)
        .bind(&history)
        .fetch_one(&self.pool)
        .await?;

        self.emit_event(SystemEvent::ServerStatusChanged {
            server_id: updated.id,
            name: updated.name.clone(),
            previous_status,
            status: updated.status,
            latency_ms: updated.last_latency_ms,
            checked_at: updated.last_checked_at.unwrap_or_else(Utc::now),
        });

        Ok(updated)
    }

    /// Concurrently probe all configured server nodes via Tokio tasks.
    pub async fn check_all_servers(&self) -> Result<Vec<ServerNode>, ApiError> {
        let nodes = self.list_servers().await?;
        let futures = nodes.into_iter().map(|n| self.check_server(n.id));
        let results = join_all(futures).await;

        let mut updated = Vec::with_capacity(results.len());
        for res in results {
            updated.push(res?);
        }
        Ok(updated)
    }

    /// Return aggregate health summary across all configured server nodes.
    pub async fn get_servers_summary(&self) -> Result<ServerSummaryResponse, ApiError> {
        let servers = self.list_servers().await?;
        let total = servers.len();
        let mut online = 0usize;
        let mut degraded = 0usize;
        let mut offline = 0usize;
        let mut unknown = 0usize;
        let mut latency_sum = 0i64;
        let mut latency_count = 0usize;

        for s in &servers {
            match s.status {
                ServerStatus::Online => online += 1,
                ServerStatus::Degraded => degraded += 1,
                ServerStatus::Offline => offline += 1,
                ServerStatus::Unknown => unknown += 1,
            }
            if let Some(lat) = s.last_latency_ms {
                latency_sum += lat;
                latency_count += 1;
            }
        }

        let avg_latency_ms = if latency_count > 0 {
            Some(latency_sum as f64 / latency_count as f64)
        } else {
            None
        };

        Ok(ServerSummaryResponse {
            total,
            online,
            degraded,
            offline,
            unknown,
            avg_latency_ms,
            checked_at: Utc::now(),
        })
    }

    async fn probe_tcp(&self, host: &str, port: i32) -> (ServerStatus, Option<i64>, Option<String>) {
        let addr = format!("{host}:{port}");
        let start = Instant::now();
        match tokio::time::timeout(TCP_PROBE_TIMEOUT, tokio::net::TcpStream::connect(&addr)).await {
            Ok(Ok(stream)) => {
                drop(stream);
                let latency_ms = start.elapsed().as_millis() as i64;
                (
                    ServerStatus::Online,
                    Some(latency_ms),
                    Some(format!("TCP connected ({latency_ms}ms)")),
                )
            }
            Ok(Err(e)) => (
                ServerStatus::Offline,
                None,
                Some(format!("TCP error: {e}")),
            ),
            Err(_) => (
                ServerStatus::Offline,
                None,
                Some("TCP connection timed out (3s)".to_string()),
            ),
        }
    }

    async fn probe_http(&self, url: &str) -> (ServerStatus, Option<i64>, Option<String>) {
        let start = Instant::now();
        let req = self.http_client.get(url).timeout(HTTP_PROBE_TIMEOUT);
        match tokio::time::timeout(HTTP_PROBE_TIMEOUT, req.send()).await {
            Ok(Ok(resp)) => {
                let latency_ms = start.elapsed().as_millis() as i64;
                let code = resp.status().as_u16();
                if (200..=399).contains(&code) {
                    (
                        ServerStatus::Online,
                        Some(latency_ms),
                        Some(format!("HTTP {code} OK ({latency_ms}ms)")),
                    )
                } else {
                    (
                        ServerStatus::Degraded,
                        Some(latency_ms),
                        Some(format!("HTTP {code} Degraded ({latency_ms}ms)")),
                    )
                }
            }
            Ok(Err(e)) => (
                ServerStatus::Offline,
                None,
                Some(format!("HTTP error: {e}")),
            ),
            Err(_) => (
                ServerStatus::Offline,
                None,
                Some("HTTP request timed out (4s)".to_string()),
            ),
        }
    }
}
