use chrono::Utc;
use hermes_domain::{
    ApiError, CompanionNudge, CompanionOfflinePhrase, CreateCompanionPhraseRequest,
    PaceHealthStatus, TriggerContext, new_uuid_v7,
};
use sqlx::Row;
use uuid::Uuid;

use crate::service::IntelligenceService;

impl IntelligenceService {
    /// Aggregates proactive `!` nudges across all 6 live PostgreSQL state sources:
    /// 1. Overdue / due-today tasks (`tasks`)
    /// 2. `at_risk` / `off_track` goals (`goals` via `get_goal_pace_drift`)
    /// 3. Due spaced-repetition reviews (`course_lessons` via `list_due_spaced_reviews`)
    /// 4. Unlogged daily routines (`routine_items` + `routine_logs`)
    /// 5. `offline` / `degraded` servers (`server_nodes`)
    /// 6. Pending MCP tool approvals (`pending_mcp_approvals`)
    pub async fn get_companion_nudges(&self) -> Result<Vec<CompanionNudge>, ApiError> {
        let mut nudges = Vec::new();
        let now = Utc::now();
        let today = now.date_naive();

        // 1. Overdue / Due-Today Tasks
        let task_rows = sqlx::query(
            r#"
            SELECT id, title, priority, COALESCE(due_date::date, scheduled_date) AS effective_due
            FROM tasks
            WHERE deleted_at IS NULL
              AND completed_at IS NULL
              AND status NOT IN ('done', 'canceled')
              AND (
                  (due_date IS NOT NULL AND due_date::date <= $1)
                  OR (scheduled_date IS NOT NULL AND scheduled_date <= $1)
              )
            ORDER BY COALESCE(due_date::date, scheduled_date) ASC, created_at ASC
            LIMIT 5
            "#,
        )
        .bind(today)
        .fetch_all(&self.pool)
        .await
        .map_err(ApiError::from)?;

        for row in task_rows {
            let task_id: Uuid = row.get("id");
            let title: String = row.get("title");
            let effective_due: chrono::NaiveDate =
                row.try_get("effective_due").unwrap_or(today);
            let is_overdue = effective_due < today;
            nudges.push(CompanionNudge {
                id: new_uuid_v7(),
                category: if is_overdue {
                    "overdue_task".to_string()
                } else {
                    "due_task".to_string()
                },
                title: if is_overdue {
                    format!("Overdue Task: {title}")
                } else {
                    format!("Task Due Today: {title}")
                },
                message: format!(
                    "Task '{}' is {} (target date {}).",
                    title,
                    if is_overdue { "overdue" } else { "due today" },
                    effective_due
                ),
                route: "/todos".to_string(),
                entity_id: Some(task_id.to_string()),
                created_at: now,
            });
        }

        // 2. At-Risk / Off-Track Goals
        if let Ok(drifts) = self.life_ops.get_goals_pace_drift(None).await {
            for d in drifts
                .into_iter()
                .filter(|d| {
                    matches!(
                        d.pace_status,
                        PaceHealthStatus::AtRisk | PaceHealthStatus::OffTrack
                    )
                })
                .take(5)
            {
                let status_label = match d.pace_status {
                    PaceHealthStatus::OffTrack => "off_track",
                    PaceHealthStatus::AtRisk => "at_risk",
                    PaceHealthStatus::OnTrack => "on_track",
                };
                nudges.push(CompanionNudge {
                    id: new_uuid_v7(),
                    category: "goal_pace".to_string(),
                    title: format!("Goal Pace Alert: {}", d.goal.title),
                    message: format!(
                        "Goal '{}' is {} ({:.1}% actual vs {:.1}% elapsed).",
                        d.goal.title, status_label, d.goal.progress_pct, d.elapsed_pct
                    ),
                    route: "/goals".to_string(),
                    entity_id: Some(d.goal.id.to_string()),
                    created_at: now,
                });
            }
        }

        // 3. Due Spaced-Repetition Reviews
        if let Ok(reviews) = self.life_ops.list_due_spaced_reviews().await {
            for r in reviews.into_iter().take(5) {
                nudges.push(CompanionNudge {
                    id: new_uuid_v7(),
                    category: "spaced_review".to_string(),
                    title: format!("Spaced Review Due: {}", r.lesson.title),
                    message: format!(
                        "Lesson '{}' in '{}' is due for {} active recall review (scheduled {:?}).",
                        r.lesson.title, r.course_title, r.interval_label, r.lesson.next_review_date
                    ),
                    route: "/courses".to_string(),
                    entity_id: Some(r.lesson.id.to_string()),
                    created_at: now,
                });
            }
        }

        // 4. Unlogged Daily Routines
        let routine_rows = sqlx::query(
            r#"
            SELECT ri.id, ri.title, r.name AS routine_name
            FROM routine_items ri
            JOIN routines r ON r.id = ri.routine_id
            WHERE ri.deleted_at IS NULL
              AND r.deleted_at IS NULL
              AND r.active = TRUE
              AND NOT EXISTS (
                  SELECT 1 FROM routine_logs rl
                  WHERE rl.routine_item_id = ri.id
                    AND rl.log_date = $1
                    AND rl.deleted_at IS NULL
                    AND rl.status IN ('done', 'skipped')
              )
            ORDER BY r.sort_order ASC, ri.sort_order ASC
            LIMIT 5
            "#,
        )
        .bind(today)
        .fetch_all(&self.pool)
        .await
        .map_err(ApiError::from)?;

        for row in routine_rows {
            let item_id: Uuid = row.get("id");
            let item_title: String = row.get("title");
            let routine_name: String = row.get("routine_name");
            nudges.push(CompanionNudge {
                id: new_uuid_v7(),
                category: "unlogged_routine".to_string(),
                title: format!("Unlogged Routine: {item_title}"),
                message: format!(
                    "Habit '{}' ({}) has not been logged yet for {}.",
                    item_title, routine_name, today
                ),
                route: "/routines".to_string(),
                entity_id: Some(item_id.to_string()),
                created_at: now,
            });
        }

        // 5. Offline / Degraded Servers
        let server_rows = sqlx::query(
            r#"
            SELECT id, name, host, status
            FROM server_nodes
            WHERE status IN ('offline', 'degraded')
            ORDER BY updated_at DESC
            LIMIT 5
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(ApiError::from)?;

        for row in server_rows {
            let srv_id: Uuid = row.get("id");
            let name: String = row.get("name");
            let host: String = row.get("host");
            let status: String = row.get("status");
            nudges.push(CompanionNudge {
                id: new_uuid_v7(),
                category: "server_health".to_string(),
                title: format!("Server Alert: {name} ({status})"),
                message: format!(
                    "Server node '{}' ({}) is reporting status '{}'.",
                    name, host, status
                ),
                route: "/dashboard".to_string(),
                entity_id: Some(srv_id.to_string()),
                created_at: now,
            });
        }

        // 6. Pending MCP Tool Approvals
        let approval_rows = sqlx::query(
            r#"
            SELECT id, session_key, tool_name
            FROM pending_mcp_approvals
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 5
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(ApiError::from)?;

        for row in approval_rows {
            let approval_id: Uuid = row.get("id");
            let session_key: String = row.get("session_key");
            let tool_name: String = row.get("tool_name");
            nudges.push(CompanionNudge {
                id: new_uuid_v7(),
                category: "pending_approval".to_string(),
                title: format!("Pending MCP Approval: {tool_name}"),
                message: format!(
                    "MCP tool '{}' is awaiting explicit approval in session '{}'.",
                    tool_name, session_key
                ),
                route: "/hermes".to_string(),
                entity_id: Some(approval_id.to_string()),
                created_at: now,
            });
        }

        Ok(nudges)
    }

    pub async fn list_companion_phrases(
        &self,
        trigger_context: Option<TriggerContext>,
    ) -> Result<Vec<CompanionOfflinePhrase>, ApiError> {
        let rows = sqlx::query_as::<_, CompanionOfflinePhrase>(
            r#"
            SELECT *
            FROM companion_offline_phrases
            WHERE deleted_at IS NULL
              AND active = TRUE
            ORDER BY is_builtin DESC, created_at ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(ApiError::from)?;

        let filtered = match trigger_context {
            Some(ctx) if ctx != TriggerContext::Any => rows
                .into_iter()
                .filter(|p| p.trigger_context == ctx || p.trigger_context == TriggerContext::Any)
                .collect(),
            _ => rows,
        };

        Ok(filtered)
    }

    pub async fn create_companion_phrase(
        &self,
        req: CreateCompanionPhraseRequest,
    ) -> Result<CompanionOfflinePhrase, ApiError> {
        let phrase_text = req.phrase_text.trim();
        if phrase_text.is_empty() {
            return Err(ApiError::bad_request("phrase_text must not be empty"));
        }

        let id = new_uuid_v7();
        let created = sqlx::query_as::<_, CompanionOfflinePhrase>(
            r#"
            INSERT INTO companion_offline_phrases (
                id, phrase_text, trigger_context, animation_hint,
                is_builtin, active, created_at, updated_at, deleted_at
            )
            VALUES ($1, $2, $3, $4, FALSE, $5, NOW(), NOW(), NULL)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(phrase_text)
        .bind(req.trigger_context)
        .bind(req.animation_hint)
        .bind(req.active)
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::from)?;

        Ok(created)
    }

    pub async fn delete_companion_phrase(&self, id: Uuid) -> Result<(), ApiError> {
        let res = sqlx::query(
            r#"
            UPDATE companion_offline_phrases
            SET deleted_at = NOW(),
                active = FALSE,
                updated_at = NOW()
            WHERE id = $1
              AND deleted_at IS NULL
            "#,
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(ApiError::from)?;

        if res.rows_affected() == 0 {
            return Err(ApiError::not_found(format!(
                "Companion offline phrase '{id}' not found"
            )));
        }
        Ok(())
    }
}
