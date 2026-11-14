//! Feature F08 — Scoped 8-Table `UUIDv7` Mobile Delta Sync Engine (`sync_push` & `sync_pull`).

use std::collections::HashSet;
use std::str::FromStr;

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use hermes_domain::{
    error::ApiError,
    events::SystemEvent,
    id::{MOBILE_SYNC_TABLES, is_mobile_sync_table, new_uuid_v7},
    sync::{
        SyncChangeEntry, SyncMutationInput, SyncOp, SyncPullResponse, SyncPushRequest,
        SyncPushResponse,
    },
};
use rust_decimal::Decimal;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::service::LifeOpsService;

impl LifeOpsService {
    /// Apply a batch of mobile outbox mutations strictly scoped to the 8 mobile sync tables.
    pub async fn sync_push(&self, req: SyncPushRequest) -> Result<SyncPushResponse, ApiError> {
        // 1. Validate all table names up front before any database write.
        for mutation in &req.mutations {
            let table = mutation.entity_table.trim();
            if !is_mobile_sync_table(table) {
                return Err(ApiError::invalid_sync_table(table));
            }
        }

        let mut tx = self.pool.begin().await?;
        let mut applied_count = 0usize;
        let mut conflicts_resolved = 0usize;
        let mut pending_events: Vec<SystemEvent> = Vec::new();

        for mutation in &req.mutations {
            let mut_id_str = mutation.mutation_id.to_string();

            // 2. Idempotency check: if `client_mutation_id` already exists in `sync_change_log`, skip cleanly.
            let already_recorded: Option<i64> = sqlx::query_scalar(
                "SELECT server_seq FROM sync_change_log WHERE client_mutation_id = $1",
            )
            .bind(&mut_id_str)
            .fetch_optional(&mut *tx)
            .await?;

            if already_recorded.is_some() {
                continue;
            }

            let client_ts = resolve_client_timestamp(mutation);
            let table = mutation.entity_table.trim();

            match table {
                "projects" => {
                    let outcome = apply_project_mutation(&mut tx, mutation, client_ts).await?;
                    handle_outcome(
                        &mut tx,
                        outcome,
                        &mut_id_str,
                        &mut applied_count,
                        &mut conflicts_resolved,
                    )
                    .await?;
                }
                "tasks" => {
                    let outcome =
                        apply_task_mutation(&mut tx, mutation, client_ts, &mut pending_events)
                            .await?;
                    handle_outcome(
                        &mut tx,
                        outcome,
                        &mut_id_str,
                        &mut applied_count,
                        &mut conflicts_resolved,
                    )
                    .await?;
                }
                "time_sessions" => {
                    let outcome = apply_time_session_mutation(
                        &mut tx,
                        mutation,
                        client_ts,
                        &mut pending_events,
                    )
                    .await?;
                    handle_outcome(
                        &mut tx,
                        outcome,
                        &mut_id_str,
                        &mut applied_count,
                        &mut conflicts_resolved,
                    )
                    .await?;
                }
                "routines" => {
                    let outcome = apply_routine_mutation(&mut tx, mutation, client_ts).await?;
                    handle_outcome(
                        &mut tx,
                        outcome,
                        &mut_id_str,
                        &mut applied_count,
                        &mut conflicts_resolved,
                    )
                    .await?;
                }
                "routine_items" => {
                    let outcome = apply_routine_item_mutation(&mut tx, mutation, client_ts).await?;
                    handle_outcome(
                        &mut tx,
                        outcome,
                        &mut_id_str,
                        &mut applied_count,
                        &mut conflicts_resolved,
                    )
                    .await?;
                }
                "routine_logs" => {
                    let outcome = apply_routine_log_mutation(
                        &mut tx,
                        mutation,
                        client_ts,
                        &mut pending_events,
                    )
                    .await?;
                    handle_outcome(
                        &mut tx,
                        outcome,
                        &mut_id_str,
                        &mut applied_count,
                        &mut conflicts_resolved,
                    )
                    .await?;
                }
                "daily_checkins" => {
                    let outcome =
                        apply_daily_checkin_mutation(&mut tx, mutation, client_ts).await?;
                    handle_outcome(
                        &mut tx,
                        outcome,
                        &mut_id_str,
                        &mut applied_count,
                        &mut conflicts_resolved,
                    )
                    .await?;
                }
                "companion_offline_phrases" => {
                    let outcome =
                        apply_companion_phrase_mutation(&mut tx, mutation, client_ts).await?;
                    handle_outcome(
                        &mut tx,
                        outcome,
                        &mut_id_str,
                        &mut applied_count,
                        &mut conflicts_resolved,
                    )
                    .await?;
                }
                other => return Err(ApiError::invalid_sync_table(other)),
            }
        }

        let server_seq: i64 =
            sqlx::query_scalar("SELECT COALESCE(MAX(server_seq), 0) FROM sync_change_log")
                .fetch_one(&mut *tx)
                .await?;

        tx.commit().await?;

        for ev in pending_events {
            self.emit_event(ev);
        }

        Ok(SyncPushResponse {
            applied_count,
            conflicts_resolved,
            server_seq,
            current_server_seq: server_seq,
        })
    }

    /// Pull delta changes across the 8 mobile sync tables after `since`.
    /// When `since == 0`, returns a full bootstrap snapshot in topological FK order plus tombstones.
    /// When `since > 0`, returns ordered `sync_change_log` entries with `server_seq > since`.
    pub async fn sync_pull(&self, since: i64, limit: usize) -> Result<SyncPullResponse, ApiError> {
        if since < 0 {
            return Err(ApiError::bad_request("since must be >= 0"));
        }
        let clamped_limit = if limit == 0 { 500 } else { limit.clamp(1, 2000) };
        let latest_server_seq = self.latest_server_seq().await?;

        if since == 0 {
            let mut changes = Vec::new();
            let mut seen_entities: HashSet<(String, String)> = HashSet::new();

            for &table in &MOBILE_SYNC_TABLES {
                let order_col = if table == "daily_checkins" {
                    "log_date ASC"
                } else {
                    "created_at ASC"
                };
                let query = format!(
                    "SELECT to_jsonb(t) AS row_json, updated_at, deleted_at FROM {table} t ORDER BY {order_col}"
                );
                let rows = sqlx::query(&query).fetch_all(&self.pool).await?;

                for row in rows {
                    let mut payload: serde_json::Value = row.try_get("row_json")?;
                    let updated_at: DateTime<Utc> = row.try_get("updated_at")?;
                    let deleted_at: Option<DateTime<Utc>> = row.try_get("deleted_at")?;

                    let entity_id = payload
                        .get("id")
                        .and_then(|v| v.as_str())
                        .or_else(|| payload.get("log_date").and_then(|v| v.as_str()))
                        .unwrap_or_default()
                        .to_string();

                    if table == "daily_checkins" && payload.get("id").is_none() {
                        if let Some(obj) = payload.as_object_mut() {
                            obj.insert(
                                "id".to_string(),
                                serde_json::Value::String(entity_id.clone()),
                            );
                        }
                    }

                    let op = if deleted_at.is_some() {
                        SyncOp::Delete
                    } else {
                        SyncOp::Upsert
                    };

                    seen_entities.insert((table.to_string(), entity_id.clone()));
                    changes.push(SyncChangeEntry {
                        server_seq: latest_server_seq,
                        entity_table: table.to_string(),
                        entity_id,
                        op,
                        payload,
                        changed_at: deleted_at.unwrap_or(updated_at),
                    });
                }
            }

            // Include any hard-deleted tombstones from sync_change_log not present in the tables
            let tombstone_rows = sqlx::query(
                "SELECT DISTINCT ON (entity_table, entity_id) \
                 server_seq, entity_table, entity_id, payload, changed_at \
                 FROM sync_change_log \
                 WHERE op = 'delete' \
                 ORDER BY entity_table, entity_id, server_seq DESC",
            )
            .fetch_all(&self.pool)
            .await?;

            for row in tombstone_rows {
                let entity_table: String = row.try_get("entity_table")?;
                let entity_id: String = row.try_get("entity_id")?;
                if seen_entities.contains(&(entity_table.clone(), entity_id.clone())) {
                    continue;
                }
                let server_seq: i64 = row.try_get("server_seq")?;
                let payload: serde_json::Value = row.try_get("payload")?;
                let changed_at: DateTime<Utc> = row.try_get("changed_at")?;
                changes.push(SyncChangeEntry {
                    server_seq,
                    entity_table,
                    entity_id,
                    op: SyncOp::Delete,
                    payload,
                    changed_at,
                });
            }

            let has_more = changes.len() > clamped_limit;
            if has_more {
                changes.truncate(clamped_limit);
            }

            return Ok(SyncPullResponse {
                changes,
                latest_server_seq,
                next_seq: latest_server_seq,
                has_more,
            });
        }

        let fetch_limit = (clamped_limit + 1) as i64;
        let rows = sqlx::query(
            "SELECT server_seq, entity_table, entity_id, op, payload, changed_at \
             FROM sync_change_log \
             WHERE server_seq > $1 \
             ORDER BY server_seq ASC \
             LIMIT $2",
        )
        .bind(since)
        .bind(fetch_limit)
        .fetch_all(&self.pool)
        .await?;

        let has_more = rows.len() > clamped_limit;
        let mut changes = Vec::with_capacity(rows.len().min(clamped_limit));
        for row in rows.into_iter().take(clamped_limit) {
            let server_seq: i64 = row.try_get("server_seq")?;
            let entity_table: String = row.try_get("entity_table")?;
            let entity_id: String = row.try_get("entity_id")?;
            let op_str: String = row.try_get("op")?;
            let op = if op_str == "delete" {
                SyncOp::Delete
            } else {
                SyncOp::Upsert
            };
            let payload: serde_json::Value = row.try_get("payload")?;
            let changed_at: DateTime<Utc> = row.try_get("changed_at")?;

            changes.push(SyncChangeEntry {
                server_seq,
                entity_table,
                entity_id,
                op,
                payload,
                changed_at,
            });
        }

        let next_seq = changes.last().map(|c| c.server_seq).unwrap_or(since);
        Ok(SyncPullResponse {
            changes,
            latest_server_seq: latest_server_seq.max(next_seq),
            next_seq,
            has_more,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MutationOutcome {
    AppliedTriggerFired,
    AppliedDirectLog,
    ConflictServerNewer,
}

async fn handle_outcome(
    tx: &mut Transaction<'_, Postgres>,
    outcome: MutationOutcome,
    mutation_id: &str,
    applied_count: &mut usize,
    conflicts_resolved: &mut usize,
) -> Result<(), ApiError> {
    match outcome {
        MutationOutcome::AppliedTriggerFired => {
            *applied_count += 1;
            sqlx::query(
                "UPDATE sync_change_log \
                 SET client_mutation_id = $1 \
                 WHERE server_seq = currval(pg_get_serial_sequence('sync_change_log', 'server_seq')) \
                   AND client_mutation_id IS NULL",
            )
            .bind(mutation_id)
            .execute(&mut **tx)
            .await?;
        }
        MutationOutcome::AppliedDirectLog => {
            *applied_count += 1;
        }
        MutationOutcome::ConflictServerNewer => {
            *conflicts_resolved += 1;
        }
    }
    Ok(())
}

fn resolve_client_timestamp(mutation: &SyncMutationInput) -> DateTime<Utc> {
    if let Some(ts) = mutation.client_updated_at {
        return ts;
    }
    if let Some(s) = mutation.payload.get("updated_at").and_then(|v| v.as_str()) {
        if let Ok(parsed) = DateTime::parse_from_rfc3339(s) {
            return parsed.with_timezone(&Utc);
        }
    }
    Utc::now()
}

fn parse_entity_uuid(mutation: &SyncMutationInput) -> Result<Uuid, ApiError> {
    let raw = if !mutation.entity_id.trim().is_empty() {
        mutation.entity_id.trim()
    } else if let Some(s) = mutation.payload.get("id").and_then(|v| v.as_str()) {
        s.trim()
    } else {
        return Err(ApiError::bad_request("Missing UUID entity_id for sync mutation"));
    };
    Uuid::parse_str(raw).map_err(|e| ApiError::bad_request(format!("Invalid UUID '{raw}': {e}")))
}

fn json_str<'a>(payload: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    payload.get(key).and_then(|v| v.as_str())
}

fn json_uuid(payload: &serde_json::Value, key: &str) -> Option<Uuid> {
    json_str(payload, key).and_then(|s| Uuid::parse_str(s).ok())
}

fn json_i32(payload: &serde_json::Value, key: &str) -> Option<i32> {
    payload
        .get(key)
        .and_then(|v| v.as_i64())
        .map(|n| n as i32)
}

fn json_i64(payload: &serde_json::Value, key: &str) -> Option<i64> {
    payload.get(key).and_then(|v| v.as_i64())
}

fn json_bool(payload: &serde_json::Value, key: &str) -> Option<bool> {
    payload.get(key).and_then(|v| v.as_bool())
}

fn json_date(payload: &serde_json::Value, key: &str) -> Option<NaiveDate> {
    json_str(payload, key).and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
}

fn json_datetime(payload: &serde_json::Value, key: &str) -> Option<DateTime<Utc>> {
    json_str(payload, key)
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
}

fn json_time(payload: &serde_json::Value, key: &str) -> Option<NaiveTime> {
    json_str(payload, key).and_then(|s| {
        NaiveTime::parse_from_str(s, "%H:%M:%S")
            .or_else(|_| NaiveTime::parse_from_str(s, "%H:%M"))
            .ok()
    })
}

fn json_decimal(payload: &serde_json::Value, key: &str) -> Option<Decimal> {
    let val = payload.get(key)?;
    if let Some(s) = val.as_str() {
        Decimal::from_str(s).ok()
    } else if let Some(f) = val.as_f64() {
        Decimal::from_str(&format!("{f}")).ok()
    } else {
        val.as_i64().map(|n| Decimal::new(n, 0))
    }
}

async fn insert_missing_delete_tombstone(
    tx: &mut Transaction<'_, Postgres>,
    entity_table: &str,
    entity_id: &str,
    mutation_id: &str,
    client_ts: DateTime<Utc>,
) -> Result<MutationOutcome, ApiError> {
    let payload = serde_json::json!({
        "id": entity_id,
        "deleted_at": client_ts,
    });
    sqlx::query(
        "INSERT INTO sync_change_log (entity_table, entity_id, op, payload, client_mutation_id, changed_at) \
         VALUES ($1, $2, 'delete', $3, $4, $5)",
    )
    .bind(entity_table)
    .bind(entity_id)
    .bind(payload)
    .bind(mutation_id)
    .bind(client_ts)
    .execute(&mut **tx)
    .await?;
    Ok(MutationOutcome::AppliedDirectLog)
}

async fn apply_project_mutation(
    tx: &mut Transaction<'_, Postgres>,
    mutation: &SyncMutationInput,
    client_ts: DateTime<Utc>,
) -> Result<MutationOutcome, ApiError> {
    let id = parse_entity_uuid(mutation)?;
    let existing: Option<DateTime<Utc>> =
        sqlx::query_scalar("SELECT updated_at FROM projects WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?;

    if let Some(existing_ts) = existing {
        if client_ts < existing_ts {
            return Ok(MutationOutcome::ConflictServerNewer);
        }
        if mutation.op == SyncOp::Delete {
            sqlx::query("UPDATE projects SET deleted_at = $2, updated_at = $2 WHERE id = $1")
                .bind(id)
                .bind(client_ts)
                .execute(&mut **tx)
                .await?;
            return Ok(MutationOutcome::AppliedTriggerFired);
        }

        sqlx::query(
            "UPDATE projects SET \
                name = COALESCE($2, name), \
                area = COALESCE($3, area), \
                goal_id = COALESCE($4, goal_id), \
                status = COALESCE($5, status), \
                color = COALESCE($6, color), \
                updated_at = $7, \
                deleted_at = NULL \
             WHERE id = $1",
        )
        .bind(id)
        .bind(json_str(&mutation.payload, "name"))
        .bind(json_str(&mutation.payload, "area"))
        .bind(json_uuid(&mutation.payload, "goal_id"))
        .bind(json_str(&mutation.payload, "status"))
        .bind(json_str(&mutation.payload, "color"))
        .bind(client_ts)
        .execute(&mut **tx)
        .await?;
        return Ok(MutationOutcome::AppliedTriggerFired);
    }

    if mutation.op == SyncOp::Delete {
        return insert_missing_delete_tombstone(
            tx,
            "projects",
            &id.to_string(),
            &mutation.mutation_id.to_string(),
            client_ts,
        )
        .await;
    }

    let name = json_str(&mutation.payload, "name").unwrap_or("Untitled Project");
    let area = json_str(&mutation.payload, "area").unwrap_or("personal");
    let goal_id = json_uuid(&mutation.payload, "goal_id");
    let status = json_str(&mutation.payload, "status").unwrap_or("active");
    let color = json_str(&mutation.payload, "color").unwrap_or("#F87C18");

    sqlx::query(
        "INSERT INTO projects (id, name, area, goal_id, status, color, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
    )
    .bind(id)
    .bind(name)
    .bind(area)
    .bind(goal_id)
    .bind(status)
    .bind(color)
    .bind(client_ts)
    .execute(&mut **tx)
    .await?;

    Ok(MutationOutcome::AppliedTriggerFired)
}

async fn apply_task_mutation(
    tx: &mut Transaction<'_, Postgres>,
    mutation: &SyncMutationInput,
    client_ts: DateTime<Utc>,
    pending_events: &mut Vec<SystemEvent>,
) -> Result<MutationOutcome, ApiError> {
    let id = parse_entity_uuid(mutation)?;
    let existing: Option<DateTime<Utc>> =
        sqlx::query_scalar("SELECT updated_at FROM tasks WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?;

    let tags: Option<Vec<String>> = mutation.payload.get("tags").and_then(|v| {
        v.as_array().map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(ToString::to_string))
                .collect()
        })
    });

    let blocked_by: Option<Vec<Uuid>> =
        mutation.payload.get("blocked_by_task_ids").and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().and_then(|s| Uuid::parse_str(s).ok()))
                    .collect()
            })
        });

    let energy_level = json_str(&mutation.payload, "energy_level").map(|e| match e {
        "deep_focus" | "deep_work" => "deep",
        "low_energy" => "shallow",
        "quick_win" => "quick",
        other => other,
    });

    if let Some(existing_ts) = existing {
        if client_ts < existing_ts {
            return Ok(MutationOutcome::ConflictServerNewer);
        }
        if mutation.op == SyncOp::Delete {
            sqlx::query("UPDATE tasks SET deleted_at = $2, updated_at = $2 WHERE id = $1")
                .bind(id)
                .bind(client_ts)
                .execute(&mut **tx)
                .await?;
            pending_events.push(SystemEvent::TaskMutated {
                task_id: id,
                action: "deleted".to_string(),
                status: "canceled".to_string(),
                timestamp: client_ts,
            });
            return Ok(MutationOutcome::AppliedTriggerFired);
        }

        let status = json_str(&mutation.payload, "status");
        let completed_at = if status == Some("done") {
            Some(json_datetime(&mutation.payload, "completed_at").unwrap_or(client_ts))
        } else {
            json_datetime(&mutation.payload, "completed_at")
        };

        let row = sqlx::query(
            "UPDATE tasks SET \
                title = COALESCE($2, title), \
                description_md = COALESCE($3, description_md), \
                status = COALESCE($4, status), \
                priority = COALESCE($5, priority), \
                project_id = COALESCE($6, project_id), \
                goal_id = COALESCE($7, goal_id), \
                course_id = COALESCE($8, course_id), \
                lesson_id = COALESCE($9, lesson_id), \
                parent_task_id = COALESCE($10, parent_task_id), \
                blocked_by_task_ids = COALESCE($11, blocked_by_task_ids), \
                vault_note_path = COALESCE($12, vault_note_path), \
                scheduled_date = COALESCE($13, scheduled_date), \
                due_date = COALESCE($14, due_date), \
                estimated_minutes = COALESCE($15, estimated_minutes), \
                actual_seconds = COALESCE($16, actual_seconds), \
                energy_level = COALESCE($17, energy_level), \
                tags = COALESCE($18, tags), \
                recurrence_rule = COALESCE($19, recurrence_rule), \
                sort_order = COALESCE($20, sort_order), \
                completed_at = COALESCE($21, completed_at), \
                updated_at = $22, \
                deleted_at = NULL \
             WHERE id = $1 \
             RETURNING status",
        )
        .bind(id)
        .bind(json_str(&mutation.payload, "title"))
        .bind(json_str(&mutation.payload, "description_md"))
        .bind(status)
        .bind(json_str(&mutation.payload, "priority"))
        .bind(json_uuid(&mutation.payload, "project_id"))
        .bind(json_uuid(&mutation.payload, "goal_id"))
        .bind(json_uuid(&mutation.payload, "course_id"))
        .bind(json_uuid(&mutation.payload, "lesson_id"))
        .bind(json_uuid(&mutation.payload, "parent_task_id"))
        .bind(blocked_by)
        .bind(json_str(&mutation.payload, "vault_note_path"))
        .bind(json_date(&mutation.payload, "scheduled_date"))
        .bind(json_datetime(&mutation.payload, "due_date"))
        .bind(json_i32(&mutation.payload, "estimated_minutes"))
        .bind(json_i64(&mutation.payload, "actual_seconds"))
        .bind(energy_level)
        .bind(tags)
        .bind(json_str(&mutation.payload, "recurrence_rule"))
        .bind(json_i32(&mutation.payload, "sort_order"))
        .bind(completed_at)
        .bind(client_ts)
        .fetch_one(&mut **tx)
        .await?;

        let final_status: String = row.try_get("status")?;
        pending_events.push(SystemEvent::TaskMutated {
            task_id: id,
            action: "updated".to_string(),
            status: final_status,
            timestamp: client_ts,
        });
        return Ok(MutationOutcome::AppliedTriggerFired);
    }

    if mutation.op == SyncOp::Delete {
        return insert_missing_delete_tombstone(
            tx,
            "tasks",
            &id.to_string(),
            &mutation.mutation_id.to_string(),
            client_ts,
        )
        .await;
    }

    let title = json_str(&mutation.payload, "title").unwrap_or("Untitled Task");
    let description_md = json_str(&mutation.payload, "description_md").unwrap_or("");
    let status = json_str(&mutation.payload, "status").unwrap_or("inbox");
    let priority = json_str(&mutation.payload, "priority").unwrap_or("medium");
    let completed_at = if status == "done" {
        Some(json_datetime(&mutation.payload, "completed_at").unwrap_or(client_ts))
    } else {
        json_datetime(&mutation.payload, "completed_at")
    };

    sqlx::query(
        "INSERT INTO tasks ( \
            id, title, description_md, status, priority, project_id, goal_id, course_id, lesson_id, \
            parent_task_id, blocked_by_task_ids, vault_note_path, scheduled_date, due_date, \
            estimated_minutes, actual_seconds, energy_level, tags, recurrence_rule, sort_order, \
            completed_at, created_at, updated_at \
         ) VALUES ( \
            $1, $2, $3, $4, $5, $6, $7, $8, $9, \
            $10, $11, $12, $13, $14, \
            $15, $16, $17, $18, $19, $20, \
            $21, $22, $22 \
         )",
    )
    .bind(id)
    .bind(title)
    .bind(description_md)
    .bind(status)
    .bind(priority)
    .bind(json_uuid(&mutation.payload, "project_id"))
    .bind(json_uuid(&mutation.payload, "goal_id"))
    .bind(json_uuid(&mutation.payload, "course_id"))
    .bind(json_uuid(&mutation.payload, "lesson_id"))
    .bind(json_uuid(&mutation.payload, "parent_task_id"))
    .bind(blocked_by.unwrap_or_default())
    .bind(json_str(&mutation.payload, "vault_note_path"))
    .bind(json_date(&mutation.payload, "scheduled_date"))
    .bind(json_datetime(&mutation.payload, "due_date"))
    .bind(json_i32(&mutation.payload, "estimated_minutes"))
    .bind(json_i64(&mutation.payload, "actual_seconds").unwrap_or(0))
    .bind(energy_level)
    .bind(tags.unwrap_or_default())
    .bind(json_str(&mutation.payload, "recurrence_rule"))
    .bind(json_i32(&mutation.payload, "sort_order").unwrap_or(0))
    .bind(completed_at)
    .bind(client_ts)
    .execute(&mut **tx)
    .await?;

    pending_events.push(SystemEvent::TaskMutated {
        task_id: id,
        action: "created".to_string(),
        status: status.to_string(),
        timestamp: client_ts,
    });
    Ok(MutationOutcome::AppliedTriggerFired)
}

async fn apply_time_session_mutation(
    tx: &mut Transaction<'_, Postgres>,
    mutation: &SyncMutationInput,
    client_ts: DateTime<Utc>,
    pending_events: &mut Vec<SystemEvent>,
) -> Result<MutationOutcome, ApiError> {
    let id = parse_entity_uuid(mutation)?;
    let existing: Option<DateTime<Utc>> =
        sqlx::query_scalar("SELECT updated_at FROM time_sessions WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?;

    let ended_at = json_datetime(&mutation.payload, "ended_at");

    if let Some(existing_ts) = existing {
        if client_ts < existing_ts {
            return Ok(MutationOutcome::ConflictServerNewer);
        }
        if mutation.op == SyncOp::Delete {
            sqlx::query("UPDATE time_sessions SET deleted_at = $2, updated_at = $2 WHERE id = $1")
                .bind(id)
                .bind(client_ts)
                .execute(&mut **tx)
                .await?;
            return Ok(MutationOutcome::AppliedTriggerFired);
        }

        if ended_at.is_none() {
            // Stop any other active timer to respect idx_time_sessions_single_active_timer
            sqlx::query(
                "UPDATE time_sessions \
                 SET ended_at = $2, \
                     duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM ($2 - started_at))::BIGINT), \
                     updated_at = $2 \
                 WHERE id != $1 AND ended_at IS NULL AND deleted_at IS NULL",
            )
            .bind(id)
            .bind(client_ts)
            .execute(&mut **tx)
            .await?;
        }

        sqlx::query(
            "UPDATE time_sessions SET \
                task_id = COALESCE($2, task_id), \
                course_id = COALESCE($3, course_id), \
                lesson_id = COALESCE($4, lesson_id), \
                category = COALESCE($5, category), \
                timer_mode = COALESCE($6, timer_mode), \
                work_minutes = COALESCE($7, work_minutes), \
                break_minutes = COALESCE($8, break_minutes), \
                started_at = COALESCE($9, started_at), \
                ended_at = $10, \
                duration_seconds = COALESCE($11, duration_seconds), \
                notes = COALESCE($12, notes), \
                updated_at = $13, \
                deleted_at = NULL \
             WHERE id = $1",
        )
        .bind(id)
        .bind(json_uuid(&mutation.payload, "task_id"))
        .bind(json_uuid(&mutation.payload, "course_id"))
        .bind(json_uuid(&mutation.payload, "lesson_id"))
        .bind(json_str(&mutation.payload, "category"))
        .bind(json_str(&mutation.payload, "timer_mode"))
        .bind(json_i32(&mutation.payload, "work_minutes"))
        .bind(json_i32(&mutation.payload, "break_minutes"))
        .bind(json_datetime(&mutation.payload, "started_at"))
        .bind(ended_at)
        .bind(json_i64(&mutation.payload, "duration_seconds"))
        .bind(json_str(&mutation.payload, "notes"))
        .bind(client_ts)
        .execute(&mut **tx)
        .await?;

        pending_events.push(SystemEvent::TimerUpdated {
            session_id: Some(id),
            task_id: json_uuid(&mutation.payload, "task_id"),
            course_id: json_uuid(&mutation.payload, "course_id"),
            running: ended_at.is_none(),
            elapsed_seconds: json_i64(&mutation.payload, "duration_seconds").unwrap_or(0),
            timestamp: client_ts,
        });
        return Ok(MutationOutcome::AppliedTriggerFired);
    }

    if mutation.op == SyncOp::Delete {
        return insert_missing_delete_tombstone(
            tx,
            "time_sessions",
            &id.to_string(),
            &mutation.mutation_id.to_string(),
            client_ts,
        )
        .await;
    }

    if ended_at.is_none() {
        sqlx::query(
            "UPDATE time_sessions \
             SET ended_at = $2, \
                 duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM ($2 - started_at))::BIGINT), \
                 updated_at = $2 \
             WHERE id != $1 AND ended_at IS NULL AND deleted_at IS NULL",
        )
        .bind(id)
        .bind(client_ts)
        .execute(&mut **tx)
        .await?;
    }

    let started_at = json_datetime(&mutation.payload, "started_at").unwrap_or(client_ts);
    let duration_seconds = json_i64(&mutation.payload, "duration_seconds")
        .unwrap_or(0)
        .max(0);
    let category = json_str(&mutation.payload, "category").unwrap_or("deep_work");
    let timer_mode = json_str(&mutation.payload, "timer_mode").unwrap_or("stopwatch");
    let notes = json_str(&mutation.payload, "notes").unwrap_or("");

    sqlx::query(
        "INSERT INTO time_sessions ( \
            id, task_id, course_id, lesson_id, category, timer_mode, \
            work_minutes, break_minutes, started_at, ended_at, duration_seconds, notes, \
            created_at, updated_at \
         ) VALUES ( \
            $1, $2, $3, $4, $5, $6, \
            $7, $8, $9, $10, $11, $12, \
            $13, $13 \
         )",
    )
    .bind(id)
    .bind(json_uuid(&mutation.payload, "task_id"))
    .bind(json_uuid(&mutation.payload, "course_id"))
    .bind(json_uuid(&mutation.payload, "lesson_id"))
    .bind(category)
    .bind(timer_mode)
    .bind(json_i32(&mutation.payload, "work_minutes"))
    .bind(json_i32(&mutation.payload, "break_minutes"))
    .bind(started_at)
    .bind(ended_at)
    .bind(duration_seconds)
    .bind(notes)
    .bind(client_ts)
    .execute(&mut **tx)
    .await?;

    pending_events.push(SystemEvent::TimerUpdated {
        session_id: Some(id),
        task_id: json_uuid(&mutation.payload, "task_id"),
        course_id: json_uuid(&mutation.payload, "course_id"),
        running: ended_at.is_none(),
        elapsed_seconds: duration_seconds,
        timestamp: client_ts,
    });
    Ok(MutationOutcome::AppliedTriggerFired)
}

async fn apply_routine_mutation(
    tx: &mut Transaction<'_, Postgres>,
    mutation: &SyncMutationInput,
    client_ts: DateTime<Utc>,
) -> Result<MutationOutcome, ApiError> {
    let id = parse_entity_uuid(mutation)?;
    let existing: Option<DateTime<Utc>> =
        sqlx::query_scalar("SELECT updated_at FROM routines WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?;

    if let Some(existing_ts) = existing {
        if client_ts < existing_ts {
            return Ok(MutationOutcome::ConflictServerNewer);
        }
        if mutation.op == SyncOp::Delete {
            sqlx::query("UPDATE routines SET deleted_at = $2, updated_at = $2 WHERE id = $1")
                .bind(id)
                .bind(client_ts)
                .execute(&mut **tx)
                .await?;
            return Ok(MutationOutcome::AppliedTriggerFired);
        }

        sqlx::query(
            "UPDATE routines SET \
                name = COALESCE($2, name), \
                time_slot = COALESCE($3, time_slot), \
                day_profile = COALESCE($4, day_profile), \
                target_start_time = COALESCE($5, target_start_time), \
                sort_order = COALESCE($6, sort_order), \
                active = COALESCE($7, active), \
                updated_at = $8, \
                deleted_at = NULL \
             WHERE id = $1",
        )
        .bind(id)
        .bind(json_str(&mutation.payload, "name"))
        .bind(json_str(&mutation.payload, "time_slot"))
        .bind(json_str(&mutation.payload, "day_profile"))
        .bind(json_time(&mutation.payload, "target_start_time"))
        .bind(json_i32(&mutation.payload, "sort_order"))
        .bind(json_bool(&mutation.payload, "active"))
        .bind(client_ts)
        .execute(&mut **tx)
        .await?;
        return Ok(MutationOutcome::AppliedTriggerFired);
    }

    if mutation.op == SyncOp::Delete {
        return insert_missing_delete_tombstone(
            tx,
            "routines",
            &id.to_string(),
            &mutation.mutation_id.to_string(),
            client_ts,
        )
        .await;
    }

    let name = json_str(&mutation.payload, "name").unwrap_or("Morning Routine");
    let time_slot = json_str(&mutation.payload, "time_slot").unwrap_or("morning");
    let day_profile = json_str(&mutation.payload, "day_profile").unwrap_or("workday");
    let target_start_time = json_time(&mutation.payload, "target_start_time");
    let sort_order = json_i32(&mutation.payload, "sort_order").unwrap_or(0);
    let active = json_bool(&mutation.payload, "active").unwrap_or(true);

    sqlx::query(
        "INSERT INTO routines ( \
            id, name, time_slot, day_profile, target_start_time, sort_order, active, \
            created_at, updated_at \
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)",
    )
    .bind(id)
    .bind(name)
    .bind(time_slot)
    .bind(day_profile)
    .bind(target_start_time)
    .bind(sort_order)
    .bind(active)
    .bind(client_ts)
    .execute(&mut **tx)
    .await?;

    Ok(MutationOutcome::AppliedTriggerFired)
}

async fn apply_routine_item_mutation(
    tx: &mut Transaction<'_, Postgres>,
    mutation: &SyncMutationInput,
    client_ts: DateTime<Utc>,
) -> Result<MutationOutcome, ApiError> {
    let id = parse_entity_uuid(mutation)?;
    let existing: Option<DateTime<Utc>> =
        sqlx::query_scalar("SELECT updated_at FROM routine_items WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?;

    let freq_cfg = mutation.payload.get("frequency_config").cloned();

    if let Some(existing_ts) = existing {
        if client_ts < existing_ts {
            return Ok(MutationOutcome::ConflictServerNewer);
        }
        if mutation.op == SyncOp::Delete {
            sqlx::query("UPDATE routine_items SET deleted_at = $2, updated_at = $2 WHERE id = $1")
                .bind(id)
                .bind(client_ts)
                .execute(&mut **tx)
                .await?;
            return Ok(MutationOutcome::AppliedTriggerFired);
        }

        sqlx::query(
            "UPDATE routine_items SET \
                routine_id = COALESCE($2, routine_id), \
                goal_id = COALESCE($3, goal_id), \
                title = COALESCE($4, title), \
                tracking_type = COALESCE($5, tracking_type), \
                target_value = COALESCE($6, target_value), \
                unit = COALESCE($7, unit), \
                frequency_type = COALESCE($8, frequency_type), \
                frequency_config = COALESCE($9, frequency_config), \
                estimated_minutes = COALESCE($10, estimated_minutes), \
                sort_order = COALESCE($11, sort_order), \
                updated_at = $12, \
                deleted_at = NULL \
             WHERE id = $1",
        )
        .bind(id)
        .bind(json_uuid(&mutation.payload, "routine_id"))
        .bind(json_uuid(&mutation.payload, "goal_id"))
        .bind(json_str(&mutation.payload, "title"))
        .bind(json_str(&mutation.payload, "tracking_type"))
        .bind(json_decimal(&mutation.payload, "target_value"))
        .bind(json_str(&mutation.payload, "unit"))
        .bind(json_str(&mutation.payload, "frequency_type"))
        .bind(freq_cfg)
        .bind(json_i32(&mutation.payload, "estimated_minutes"))
        .bind(json_i32(&mutation.payload, "sort_order"))
        .bind(client_ts)
        .execute(&mut **tx)
        .await?;
        return Ok(MutationOutcome::AppliedTriggerFired);
    }

    if mutation.op == SyncOp::Delete {
        return insert_missing_delete_tombstone(
            tx,
            "routine_items",
            &id.to_string(),
            &mutation.mutation_id.to_string(),
            client_ts,
        )
        .await;
    }

    let Some(routine_id) = json_uuid(&mutation.payload, "routine_id") else {
        return Err(ApiError::bad_request(
            "routine_items sync upsert requires routine_id",
        ));
    };
    let title = json_str(&mutation.payload, "title").unwrap_or("Habit Item");
    let tracking_type = json_str(&mutation.payload, "tracking_type").unwrap_or("boolean");
    let frequency_type = json_str(&mutation.payload, "frequency_type").unwrap_or("daily");
    let sort_order = json_i32(&mutation.payload, "sort_order").unwrap_or(0);

    sqlx::query(
        "INSERT INTO routine_items ( \
            id, routine_id, goal_id, title, tracking_type, target_value, unit, \
            frequency_type, frequency_config, estimated_minutes, sort_order, \
            created_at, updated_at \
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)",
    )
    .bind(id)
    .bind(routine_id)
    .bind(json_uuid(&mutation.payload, "goal_id"))
    .bind(title)
    .bind(tracking_type)
    .bind(json_decimal(&mutation.payload, "target_value"))
    .bind(json_str(&mutation.payload, "unit"))
    .bind(frequency_type)
    .bind(freq_cfg.unwrap_or_else(|| serde_json::json!({})))
    .bind(json_i32(&mutation.payload, "estimated_minutes"))
    .bind(sort_order)
    .bind(client_ts)
    .execute(&mut **tx)
    .await?;

    Ok(MutationOutcome::AppliedTriggerFired)
}

async fn apply_routine_log_mutation(
    tx: &mut Transaction<'_, Postgres>,
    mutation: &SyncMutationInput,
    client_ts: DateTime<Utc>,
    pending_events: &mut Vec<SystemEvent>,
) -> Result<MutationOutcome, ApiError> {
    let id = parse_entity_uuid(mutation)?;
    let routine_item_id = json_uuid(&mutation.payload, "routine_item_id");
    let log_date = json_date(&mutation.payload, "log_date");

    // Check by ID or by natural unique key (routine_item_id, log_date)
    let existing = if let (Some(item_id), Some(date)) = (routine_item_id, log_date) {
        sqlx::query(
            "SELECT id, updated_at FROM routine_logs \
             WHERE id = $1 OR (routine_item_id = $2 AND log_date = $3) \
             ORDER BY updated_at DESC LIMIT 1 FOR UPDATE",
        )
        .bind(id)
        .bind(item_id)
        .bind(date)
        .fetch_optional(&mut **tx)
        .await?
    } else {
        sqlx::query("SELECT id, updated_at FROM routine_logs WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?
    };

    if let Some(row) = existing {
        let target_id: Uuid = row.try_get("id")?;
        let existing_ts: DateTime<Utc> = row.try_get("updated_at")?;
        if client_ts < existing_ts {
            return Ok(MutationOutcome::ConflictServerNewer);
        }
        if mutation.op == SyncOp::Delete {
            sqlx::query("UPDATE routine_logs SET deleted_at = $2, updated_at = $2 WHERE id = $1")
                .bind(target_id)
                .bind(client_ts)
                .execute(&mut **tx)
                .await?;
            return Ok(MutationOutcome::AppliedTriggerFired);
        }

        let updated = sqlx::query(
            "UPDATE routine_logs SET \
                status = COALESCE($2, status), \
                numeric_value = COALESCE($3, numeric_value), \
                completed_at = COALESCE($4, completed_at), \
                notes = COALESCE($5, notes), \
                updated_at = $6, \
                deleted_at = NULL \
             WHERE id = $1 \
             RETURNING routine_item_id, log_date, status",
        )
        .bind(target_id)
        .bind(json_str(&mutation.payload, "status"))
        .bind(json_decimal(&mutation.payload, "numeric_value"))
        .bind(json_datetime(&mutation.payload, "completed_at"))
        .bind(json_str(&mutation.payload, "notes"))
        .bind(client_ts)
        .fetch_one(&mut **tx)
        .await?;

        let r_item_id: Uuid = updated.try_get("routine_item_id")?;
        let r_date: NaiveDate = updated.try_get("log_date")?;
        let r_status: String = updated.try_get("status")?;
        pending_events.push(SystemEvent::RoutineLogged {
            routine_item_id: r_item_id,
            log_date: r_date.to_string(),
            status: r_status,
            current_streak: 1,
            timestamp: client_ts,
        });
        return Ok(MutationOutcome::AppliedTriggerFired);
    }

    if mutation.op == SyncOp::Delete {
        return insert_missing_delete_tombstone(
            tx,
            "routine_logs",
            &id.to_string(),
            &mutation.mutation_id.to_string(),
            client_ts,
        )
        .await;
    }

    let Some(item_id) = routine_item_id else {
        return Err(ApiError::bad_request(
            "routine_logs sync upsert requires routine_item_id",
        ));
    };
    let date = log_date.unwrap_or_else(|| client_ts.date_naive());
    let status = json_str(&mutation.payload, "status").unwrap_or("completed");
    let completed_at = json_datetime(&mutation.payload, "completed_at").or(Some(client_ts));
    let notes = json_str(&mutation.payload, "notes").unwrap_or("");

    sqlx::query(
        "INSERT INTO routine_logs ( \
            id, routine_item_id, log_date, status, numeric_value, completed_at, notes, \
            created_at, updated_at \
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)",
    )
    .bind(id)
    .bind(item_id)
    .bind(date)
    .bind(status)
    .bind(json_decimal(&mutation.payload, "numeric_value"))
    .bind(completed_at)
    .bind(notes)
    .bind(client_ts)
    .execute(&mut **tx)
    .await?;

    pending_events.push(SystemEvent::RoutineLogged {
        routine_item_id: item_id,
        log_date: date.to_string(),
        status: status.to_string(),
        current_streak: 1,
        timestamp: client_ts,
    });
    Ok(MutationOutcome::AppliedTriggerFired)
}

async fn apply_daily_checkin_mutation(
    tx: &mut Transaction<'_, Postgres>,
    mutation: &SyncMutationInput,
    client_ts: DateTime<Utc>,
) -> Result<MutationOutcome, ApiError> {
    let raw_date = if !mutation.entity_id.trim().is_empty() {
        mutation.entity_id.trim()
    } else if let Some(s) = json_str(&mutation.payload, "log_date") {
        s.trim()
    } else if let Some(s) = json_str(&mutation.payload, "id") {
        s.trim()
    } else {
        return Err(ApiError::bad_request(
            "daily_checkins sync mutation requires log_date (YYYY-MM-DD)",
        ));
    };

    let log_date = NaiveDate::parse_from_str(raw_date, "%Y-%m-%d").map_err(|e| {
        ApiError::bad_request(format!(
            "Invalid daily_checkins log_date '{raw_date}': {e}"
        ))
    })?;

    let existing: Option<DateTime<Utc>> =
        sqlx::query_scalar("SELECT updated_at FROM daily_checkins WHERE log_date = $1 FOR UPDATE")
            .bind(log_date)
            .fetch_optional(&mut **tx)
            .await?;

    let energy_score = json_i32(&mutation.payload, "energy_score").map(|n| n as i16);
    let mood_score = json_i32(&mutation.payload, "mood_score").map(|n| n as i16);
    let sleep_hours = json_decimal(&mutation.payload, "sleep_hours");
    let weekly_review_json = mutation.payload.get("weekly_review_json").cloned();

    if let Some(existing_ts) = existing {
        if client_ts < existing_ts {
            return Ok(MutationOutcome::ConflictServerNewer);
        }
        if mutation.op == SyncOp::Delete {
            sqlx::query(
                "UPDATE daily_checkins SET deleted_at = $2, updated_at = $2 WHERE log_date = $1",
            )
            .bind(log_date)
            .bind(client_ts)
            .execute(&mut **tx)
            .await?;
            return Ok(MutationOutcome::AppliedTriggerFired);
        }

        sqlx::query(
            "UPDATE daily_checkins SET \
                day_profile_used = COALESCE($2, day_profile_used), \
                energy_score = COALESCE($3, energy_score), \
                mood_score = COALESCE($4, mood_score), \
                sleep_hours = COALESCE($5, sleep_hours), \
                highlight = COALESCE($6, highlight), \
                reflection_md = COALESCE($7, reflection_md), \
                weekly_review_json = COALESCE($8, weekly_review_json), \
                updated_at = $9, \
                deleted_at = NULL \
             WHERE log_date = $1",
        )
        .bind(log_date)
        .bind(json_str(&mutation.payload, "day_profile_used"))
        .bind(energy_score)
        .bind(mood_score)
        .bind(sleep_hours)
        .bind(json_str(&mutation.payload, "highlight"))
        .bind(json_str(&mutation.payload, "reflection_md"))
        .bind(weekly_review_json)
        .bind(client_ts)
        .execute(&mut **tx)
        .await?;
        return Ok(MutationOutcome::AppliedTriggerFired);
    }

    if mutation.op == SyncOp::Delete {
        return insert_missing_delete_tombstone(
            tx,
            "daily_checkins",
            &log_date.to_string(),
            &mutation.mutation_id.to_string(),
            client_ts,
        )
        .await;
    }

    let day_profile_used = json_str(&mutation.payload, "day_profile_used").unwrap_or("workday");
    let highlight = json_str(&mutation.payload, "highlight").unwrap_or("");
    let reflection_md = json_str(&mutation.payload, "reflection_md").unwrap_or("");

    sqlx::query(
        "INSERT INTO daily_checkins ( \
            log_date, day_profile_used, energy_score, mood_score, sleep_hours, \
            highlight, reflection_md, weekly_review_json, created_at, updated_at \
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)",
    )
    .bind(log_date)
    .bind(day_profile_used)
    .bind(energy_score)
    .bind(mood_score)
    .bind(sleep_hours)
    .bind(highlight)
    .bind(reflection_md)
    .bind(weekly_review_json)
    .bind(client_ts)
    .execute(&mut **tx)
    .await?;

    Ok(MutationOutcome::AppliedTriggerFired)
}

async fn apply_companion_phrase_mutation(
    tx: &mut Transaction<'_, Postgres>,
    mutation: &SyncMutationInput,
    client_ts: DateTime<Utc>,
) -> Result<MutationOutcome, ApiError> {
    let id = parse_entity_uuid(mutation).unwrap_or_else(|_| new_uuid_v7());
    let existing: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT updated_at FROM companion_offline_phrases WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?;

    if let Some(existing_ts) = existing {
        if client_ts < existing_ts {
            return Ok(MutationOutcome::ConflictServerNewer);
        }
        if mutation.op == SyncOp::Delete {
            sqlx::query(
                "UPDATE companion_offline_phrases \
                 SET active = FALSE, deleted_at = $2, updated_at = $2 \
                 WHERE id = $1",
            )
            .bind(id)
            .bind(client_ts)
            .execute(&mut **tx)
            .await?;
            return Ok(MutationOutcome::AppliedTriggerFired);
        }

        sqlx::query(
            "UPDATE companion_offline_phrases SET \
                phrase_text = COALESCE($2, phrase_text), \
                trigger_context = COALESCE($3, trigger_context), \
                animation_hint = COALESCE($4, animation_hint), \
                active = COALESCE($5, active), \
                updated_at = $6, \
                deleted_at = NULL \
             WHERE id = $1",
        )
        .bind(id)
        .bind(json_str(&mutation.payload, "phrase_text"))
        .bind(json_str(&mutation.payload, "trigger_context"))
        .bind(json_str(&mutation.payload, "animation_hint"))
        .bind(json_bool(&mutation.payload, "active"))
        .bind(client_ts)
        .execute(&mut **tx)
        .await?;
        return Ok(MutationOutcome::AppliedTriggerFired);
    }

    if mutation.op == SyncOp::Delete {
        return insert_missing_delete_tombstone(
            tx,
            "companion_offline_phrases",
            &id.to_string(),
            &mutation.mutation_id.to_string(),
            client_ts,
        )
        .await;
    }

    let phrase_text =
        json_str(&mutation.payload, "phrase_text").unwrap_or("Consistency is reliable magic.");
    let trigger_context = json_str(&mutation.payload, "trigger_context").unwrap_or("any");
    let animation_hint = json_str(&mutation.payload, "animation_hint");
    let is_builtin = json_bool(&mutation.payload, "is_builtin").unwrap_or(false);
    let active = json_bool(&mutation.payload, "active").unwrap_or(true);

    sqlx::query(
        "INSERT INTO companion_offline_phrases ( \
            id, phrase_text, trigger_context, animation_hint, is_builtin, active, \
            created_at, updated_at \
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
    )
    .bind(id)
    .bind(phrase_text)
    .bind(trigger_context)
    .bind(animation_hint)
    .bind(is_builtin)
    .bind(active)
    .bind(client_ts)
    .execute(&mut **tx)
    .await?;

    Ok(MutationOutcome::AppliedTriggerFired)
}
