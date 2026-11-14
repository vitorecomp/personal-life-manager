use chrono::Utc;
use hermes_domain::{
    Agent, AgentQueueResponse, AgentRun, AgentRunFilter, AgentRunStatus, AgentTrigger,
    AgentTriggerType, AgentWithTelemetry, ApiError, ArenaZone, CreateAgentRequest,
    CreateAgentTriggerRequest, DispatchAgentRequest, SessionOrigin, SystemEvent,
    TaskListFilter, TurnOrderQueueItem, UpdateAgentRequest, UpdateAgentTriggerRequest, new_uuid_v7,
};
use rust_decimal::Decimal;
use sqlx::{Row, types::Json};
use tokio_cron_scheduler::{Job, JobScheduler};
use uuid::Uuid;

use crate::mcp::{McpCallContext, McpToolExecutionOutcome};
use crate::service::IntelligenceService;

#[derive(Debug, Clone)]
pub enum AgentLookup {
    Id(Uuid),
    Slug(String),
}

pub trait IntoAgentLookup {
    fn into_agent_lookup(self) -> AgentLookup;
}

impl IntoAgentLookup for Uuid {
    fn into_agent_lookup(self) -> AgentLookup {
        AgentLookup::Id(self)
    }
}

impl IntoAgentLookup for &Uuid {
    fn into_agent_lookup(self) -> AgentLookup {
        AgentLookup::Id(*self)
    }
}

impl IntoAgentLookup for &str {
    fn into_agent_lookup(self) -> AgentLookup {
        if let Ok(id) = Uuid::parse_str(self.trim()) {
            AgentLookup::Id(id)
        } else {
            AgentLookup::Slug(self.trim().to_string())
        }
    }
}

impl IntoAgentLookup for String {
    fn into_agent_lookup(self) -> AgentLookup {
        self.as_str().into_agent_lookup()
    }
}

impl IntoAgentLookup for &String {
    fn into_agent_lookup(self) -> AgentLookup {
        self.as_str().into_agent_lookup()
    }
}

pub fn slugify_knight_name(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    let clean = out.trim_matches('-').to_string();
    if clean.is_empty() {
        format!("knight-{}", &new_uuid_v7().simple().to_string()[..8])
    } else {
        clean
    }
}

/// Normalizes 5-field cron strings (`0 7 * * *`) into 6-field cron strings
/// (`0 0 7 * * *`) expected by `tokio-cron-scheduler`.
pub fn normalize_cron_for_scheduler(expr: &str) -> String {
    let trimmed = expr.trim();
    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    if parts.len() == 5 {
        format!("0 {trimmed}")
    } else {
        trimmed.to_string()
    }
}

impl IntelligenceService {
    pub async fn fetch_raw_agent(&self, lookup: impl IntoAgentLookup) -> Result<Agent, ApiError> {
        match lookup.into_agent_lookup() {
            AgentLookup::Id(id) => sqlx::query_as::<_, Agent>("SELECT * FROM agents WHERE id = $1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await
                .map_err(ApiError::from)?
                .ok_or_else(|| ApiError::not_found(format!("Knight agent '{id}' not found"))),
            AgentLookup::Slug(slug) => {
                sqlx::query_as::<_, Agent>("SELECT * FROM agents WHERE slug = $1")
                    .bind(&slug)
                    .fetch_optional(&self.pool)
                    .await
                    .map_err(ApiError::from)?
                    .ok_or_else(|| ApiError::not_found(format!("Knight agent '{slug}' not found")))
            }
        }
    }

    pub async fn compute_agent_telemetry(
        &self,
        mut agent: Agent,
    ) -> Result<AgentWithTelemetry, ApiError> {
        let spend_row = sqlx::query(
            r#"
            SELECT
                COALESCE(ROUND(SUM(estimated_cost_usd) * 100.0)::BIGINT, 0) AS spent_month_cents
            FROM agent_runs
            WHERE agent_id = $1
              AND is_dry_run = FALSE
              AND started_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC')
            "#,
        )
        .bind(agent.id)
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::from)?;

        let spent_month_cents: i64 = spend_row.try_get("spent_month_cents").unwrap_or(0);
        let hp_remaining_cents = (agent.monthly_budget_cents - spent_month_cents).max(0);
        let hp_pct = if agent.monthly_budget_cents > 0 {
            ((hp_remaining_cents as f64) / (agent.monthly_budget_cents as f64) * 100.0)
                .clamp(0.0, 100.0)
        } else {
            0.0
        };

        // Auto-transition to StandbyBarracks when monthly HP is depleted
        if hp_remaining_cents <= 0 && agent.grid_pos.zone != ArenaZone::StandbyBarracks {
            agent.grid_pos.zone = ArenaZone::StandbyBarracks;
            let _ = sqlx::query(
                "UPDATE agents SET grid_pos = $2, updated_at = NOW() WHERE id = $1",
            )
            .bind(agent.id)
            .bind(Json(&agent.grid_pos))
            .execute(&self.pool)
            .await;
        }

        let ep_row = sqlx::query(
            r#"
            SELECT
                COALESCE(SUM(input_tokens + output_tokens)::INTEGER, 0) AS ep_used_tokens
            FROM agent_runs
            WHERE agent_id = $1
              AND is_dry_run = FALSE
              AND started_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
            "#,
        )
        .bind(agent.id)
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::from)?;

        let ep_used_tokens: i32 = ep_row.try_get("ep_used_tokens").unwrap_or(0);
        let ep_max_tokens = agent
            .model_config
            .get("ep_daily_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(50_000)
            .max(1) as i32;
        let ep_pct = (((ep_max_tokens - ep_used_tokens).max(0) as f64) / (ep_max_tokens as f64)
            * 100.0)
            .clamp(0.0, 100.0);

        let is_paused = !agent.enabled
            || agent.grid_pos.zone == ArenaZone::StandbyBarracks
            || hp_remaining_cents <= 0;

        let triggers = self.list_agent_triggers(agent.id).await.unwrap_or_default();

        Ok(AgentWithTelemetry {
            agent,
            hp_remaining_cents,
            hp_pct,
            spent_month_cents,
            ep_used_tokens,
            ep_max_tokens,
            ep_pct,
            is_paused,
            triggers,
        })
    }

    pub async fn list_agents(&self) -> Result<Vec<AgentWithTelemetry>, ApiError> {
        let rows = sqlx::query_as::<_, Agent>(
            "SELECT * FROM agents ORDER BY created_at ASC, slug ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(ApiError::from)?;

        let mut out = Vec::with_capacity(rows.len());
        for agent in rows {
            out.push(self.compute_agent_telemetry(agent).await?);
        }
        Ok(out)
    }

    pub async fn get_agent(
        &self,
        lookup: impl IntoAgentLookup,
    ) -> Result<AgentWithTelemetry, ApiError> {
        let agent = self.fetch_raw_agent(lookup).await?;
        self.compute_agent_telemetry(agent).await
    }

    pub async fn create_agent(
        &self,
        req: CreateAgentRequest,
    ) -> Result<AgentWithTelemetry, ApiError> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(ApiError::bad_request("Knight agent name must not be empty"));
        }
        let system_prompt = req.system_prompt.trim();
        if system_prompt.is_empty() {
            return Err(ApiError::bad_request(
                "Knight agent system_prompt (SOUL.md) must not be empty",
            ));
        }
        if req.monthly_budget_cents < 0 {
            return Err(ApiError::bad_request(
                "monthly_budget_cents must be non-negative",
            ));
        }

        let slug = req
            .slug
            .as_deref()
            .map(slugify_knight_name)
            .unwrap_or_else(|| slugify_knight_name(name));

        let crest_color = if req.crest_color.trim().is_empty() {
            "#F87C18".to_string()
        } else {
            req.crest_color.trim().to_string()
        };

        let grid_pos = req.grid_pos;

        let model_config = if req.model_config.is_null()
            || req
                .model_config
                .as_object()
                .is_some_and(|o| o.is_empty())
        {
            serde_json::json!({
                "model": "hermes-3-llama-3.1-70b",
                "temperature": 0.2,
                "ep_daily_tokens": 50000
            })
        } else {
            req.model_config
        };

        let tools_policy = if req.tools_policy.is_null() {
            serde_json::json!({})
        } else {
            req.tools_policy
        };
        let id = new_uuid_v7();

        let created = sqlx::query_as::<_, Agent>(
            r#"
            INSERT INTO agents (
                id, slug, name, knight_archetype, crest_color, sprite_sheet_id,
                grid_pos, hermes_profile, system_prompt, model_config, tools_policy,
                monthly_budget_cents, is_mastermind_member, enabled, version,
                created_at, updated_at
            )
            VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11,
                $12, $13, $14, 1,
                NOW(), NOW()
            )
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(&slug)
        .bind(name)
        .bind(req.knight_archetype)
        .bind(&crest_color)
        .bind(&req.sprite_sheet_id)
        .bind(Json(grid_pos))
        .bind(&req.hermes_profile)
        .bind(system_prompt)
        .bind(&model_config)
        .bind(&tools_policy)
        .bind(req.monthly_budget_cents)
        .bind(req.is_mastermind_member)
        .bind(req.enabled)
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::from)?;

        self.compute_agent_telemetry(created).await
    }

    pub async fn update_agent(
        &self,
        lookup: impl IntoAgentLookup,
        req: UpdateAgentRequest,
    ) -> Result<AgentWithTelemetry, ApiError> {
        let existing = self.fetch_raw_agent(lookup).await?;

        let name = if let Some(raw_name) = req.name {
            let t = raw_name.trim();
            if t.is_empty() {
                return Err(ApiError::bad_request("Knight agent name must not be empty"));
            }
            t.to_string()
        } else {
            existing.name
        };

        let knight_archetype = req.knight_archetype.unwrap_or(existing.knight_archetype);
        let crest_color = req.crest_color.unwrap_or(existing.crest_color);
        let sprite_sheet_id = req.sprite_sheet_id.or(existing.sprite_sheet_id);
        let req_grid_pos_is_none = req.grid_pos.is_none();
        let mut grid_pos = req.grid_pos.unwrap_or(existing.grid_pos);
        let hermes_profile = req.hermes_profile.or(existing.hermes_profile);
        let system_prompt = if let Some(sp) = req.system_prompt {
            let t = sp.trim();
            if t.is_empty() {
                return Err(ApiError::bad_request("system_prompt must not be empty"));
            }
            t.to_string()
        } else {
            existing.system_prompt
        };
        let model_config = req.model_config.unwrap_or(existing.model_config);
        let tools_policy = req.tools_policy.unwrap_or(existing.tools_policy);
        let monthly_budget_cents = req
            .monthly_budget_cents
            .unwrap_or(existing.monthly_budget_cents);
        if monthly_budget_cents < 0 {
            return Err(ApiError::bad_request(
                "monthly_budget_cents must be non-negative",
            ));
        }

        // If the Knight was in StandbyBarracks due to the HP circuit breaker and the caller
        // did not pass an explicit grid_pos, unpause back to CronWatchtower when monthly_budget_cents
        // exceeds current month's spend.
        if req_grid_pos_is_none && grid_pos.zone == ArenaZone::StandbyBarracks {
            let spend_row = sqlx::query(
                r#"
                SELECT
                    COALESCE(ROUND(SUM(estimated_cost_usd) * 100.0)::BIGINT, 0) AS spent_month_cents
                FROM agent_runs
                WHERE agent_id = $1
                  AND is_dry_run = FALSE
                  AND started_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC')
                "#,
            )
            .bind(existing.id)
            .fetch_one(&self.pool)
            .await
            .map_err(ApiError::from)?;
            let spent_month_cents: i64 = spend_row.try_get("spent_month_cents").unwrap_or(0);
            if monthly_budget_cents > spent_month_cents {
                grid_pos.zone = ArenaZone::CronWatchtower;
            }
        }

        let is_mastermind_member = req
            .is_mastermind_member
            .unwrap_or(existing.is_mastermind_member);
        let enabled = req.enabled.unwrap_or(existing.enabled);

        let updated = sqlx::query_as::<_, Agent>(
            r#"
            UPDATE agents
            SET name = $2,
                knight_archetype = $3,
                crest_color = $4,
                sprite_sheet_id = $5,
                grid_pos = $6,
                hermes_profile = $7,
                system_prompt = $8,
                model_config = $9,
                tools_policy = $10,
                monthly_budget_cents = $11,
                is_mastermind_member = $12,
                enabled = $13,
                version = version + 1,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(existing.id)
        .bind(&name)
        .bind(knight_archetype)
        .bind(&crest_color)
        .bind(&sprite_sheet_id)
        .bind(Json(grid_pos))
        .bind(&hermes_profile)
        .bind(&system_prompt)
        .bind(&model_config)
        .bind(&tools_policy)
        .bind(monthly_budget_cents)
        .bind(is_mastermind_member)
        .bind(enabled)
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::from)?;

        self.compute_agent_telemetry(updated).await
    }

    pub async fn delete_agent(&self, lookup: impl IntoAgentLookup) -> Result<(), ApiError> {
        let existing = self.fetch_raw_agent(lookup).await?;
        sqlx::query("DELETE FROM agents WHERE id = $1")
            .bind(existing.id)
            .execute(&self.pool)
            .await
            .map_err(ApiError::from)?;
        Ok(())
    }

    pub async fn list_agent_triggers(
        &self,
        lookup: impl IntoAgentLookup,
    ) -> Result<Vec<AgentTrigger>, ApiError> {
        let agent = self.fetch_raw_agent(lookup).await?;
        let triggers = sqlx::query_as::<_, AgentTrigger>(
            "SELECT * FROM agent_triggers WHERE agent_id = $1 ORDER BY created_at ASC",
        )
        .bind(agent.id)
        .fetch_all(&self.pool)
        .await
        .map_err(ApiError::from)?;
        Ok(triggers)
    }

    pub async fn create_agent_trigger(
        &self,
        lookup: impl IntoAgentLookup,
        req: CreateAgentTriggerRequest,
    ) -> Result<AgentTrigger, ApiError> {
        let agent = self.fetch_raw_agent(lookup).await?;
        if req.trigger_type == AgentTriggerType::Cron {
            let raw_cron = req
                .config_json
                .get("cron")
                .or_else(|| req.config_json.get("cron_expr"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if raw_cron.is_empty() {
                return Err(ApiError::bad_request(
                    "Cron trigger requires a non-empty cron expression in config_json.cron",
                ));
            }
            let normalized_cron = normalize_cron_for_scheduler(raw_cron);
            Job::new_async(normalized_cron.as_str(), |_uuid, _l| Box::pin(async {})).map_err(
                |e| ApiError::bad_request(format!("Invalid cron expression '{raw_cron}': {e}")),
            )?;
        }
        let id = new_uuid_v7();

        let next_run_at = req.next_run_at.or_else(|| {
            if req.trigger_type == AgentTriggerType::Cron {
                Some(Utc::now() + chrono::Duration::hours(1))
            } else {
                None
            }
        });

        let trigger = sqlx::query_as::<_, AgentTrigger>(
            r#"
            INSERT INTO agent_triggers (
                id, agent_id, type, config_json, enabled, last_run_at, next_run_at, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, NULL, $6, NOW(), NOW())
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(agent.id)
        .bind(req.trigger_type)
        .bind(&req.config_json)
        .bind(req.enabled)
        .bind(next_run_at)
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::from)?;

        Ok(trigger)
    }

    pub async fn update_agent_trigger(
        &self,
        trigger_id: Uuid,
        req: UpdateAgentTriggerRequest,
    ) -> Result<AgentTrigger, ApiError> {
        let existing = sqlx::query_as::<_, AgentTrigger>(
            "SELECT * FROM agent_triggers WHERE id = $1",
        )
        .bind(trigger_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("Agent trigger '{trigger_id}' not found")))?;

        let trigger_type = req.trigger_type.unwrap_or(existing.trigger_type);
        let config_json = req.config_json.unwrap_or(existing.config_json);
        if trigger_type == AgentTriggerType::Cron {
            if let Some(raw_cron) = config_json
                .get("cron")
                .or_else(|| config_json.get("cron_expr"))
                .and_then(|v| v.as_str())
            {
                let trimmed = raw_cron.trim();
                if trimmed.is_empty() {
                    return Err(ApiError::bad_request(
                        "Cron trigger requires a non-empty cron expression",
                    ));
                }
                let normalized_cron = normalize_cron_for_scheduler(trimmed);
                Job::new_async(normalized_cron.as_str(), |_uuid, _l| Box::pin(async {})).map_err(
                    |e| ApiError::bad_request(format!("Invalid cron expression '{trimmed}': {e}")),
                )?;
            }
        }
        let enabled = req.enabled.unwrap_or(existing.enabled);
        let next_run_at = req.next_run_at.or(existing.next_run_at);

        let updated = sqlx::query_as::<_, AgentTrigger>(
            r#"
            UPDATE agent_triggers
            SET type = $2,
                config_json = $3,
                enabled = $4,
                next_run_at = $5,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(trigger_id)
        .bind(trigger_type)
        .bind(&config_json)
        .bind(enabled)
        .bind(next_run_at)
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::from)?;

        Ok(updated)
    }

    pub async fn delete_agent_trigger(&self, trigger_id: Uuid) -> Result<(), ApiError> {
        let res = sqlx::query("DELETE FROM agent_triggers WHERE id = $1")
            .bind(trigger_id)
            .execute(&self.pool)
            .await
            .map_err(ApiError::from)?;

        if res.rows_affected() == 0 {
            return Err(ApiError::not_found(format!(
                "Agent trigger '{trigger_id}' not found"
            )));
        }
        Ok(())
    }

    pub async fn get_agent_queue(
        &self,
        limit: Option<usize>,
    ) -> Result<AgentQueueResponse, ApiError> {
        let agents = self.list_agents().await?;
        let mut queue = Vec::new();
        let now = Utc::now();

        for (idx, a) in agents.into_iter().enumerate() {
            if a.is_paused {
                continue;
            }
            for trig in a.triggers {
                if !trig.enabled {
                    continue;
                }
                let (label, scheduled_at) = match trig.trigger_type {
                    AgentTriggerType::Cron => {
                        let desc = trig
                            .config_json
                            .get("description")
                            .and_then(|v| v.as_str())
                            .or_else(|| trig.config_json.get("cron").and_then(|v| v.as_str()))
                            .unwrap_or("Scheduled Cron")
                            .to_string();
                        let sched = trig.next_run_at.unwrap_or_else(|| {
                            now + chrono::Duration::minutes(((idx as i64) + 1) * 15)
                        });
                        (desc, Some(sched))
                    }
                    AgentTriggerType::Event => {
                        let desc = trig
                            .config_json
                            .get("event")
                            .and_then(|v| v.as_str())
                            .or_else(|| {
                                trig.config_json.get("description").and_then(|v| v.as_str())
                            })
                            .unwrap_or("Event Ambush")
                            .to_string();
                        (desc, trig.next_run_at)
                    }
                    AgentTriggerType::Webhook => {
                        let desc = trig
                            .config_json
                            .get("description")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Webhook Trigger")
                            .to_string();
                        (desc, trig.next_run_at)
                    }
                };

                queue.push(TurnOrderQueueItem {
                    trigger_id: trig.id,
                    agent_id: a.agent.id,
                    agent_slug: a.agent.slug.clone(),
                    agent_name: a.agent.name.clone(),
                    trigger_type: trig.trigger_type,
                    label,
                    scheduled_at,
                });
            }
        }

        queue.sort_by(|a, b| match (a.scheduled_at, b.scheduled_at) {
            (Some(sa), Some(sb)) => sa.cmp(&sb),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.agent_slug.cmp(&b.agent_slug),
        });

        if let Some(lim) = limit {
            queue.truncate(lim);
        }

        Ok(AgentQueueResponse { queue })
    }

    /// Interpolates live `SOUL.md` template variables:
    /// `{{today}}`, `{{active_goals}}`, `{{portfolio_summary}}`, `{{due_tasks}}`, `{{due_reviews}}`
    pub async fn render_soul_prompt(&self, raw_prompt: &str) -> Result<String, ApiError> {
        let today = Utc::now().date_naive();
        let today_str = today.format("%Y-%m-%d").to_string();

        let active_goals_str = match self.life_ops.list_goals(None, None, None).await {
            Ok(goals) => {
                let items: Vec<String> = goals
                    .into_iter()
                    .take(5)
                    .map(|g| format!("{} ({:.1}%)", g.goal.title, g.goal.progress_pct))
                    .collect();
                if items.is_empty() {
                    "No active goals".to_string()
                } else {
                    items.join(", ")
                }
            }
            Err(_) => "No active goals".to_string(),
        };

        let portfolio_summary_str = match self.life_ops.get_portfolio_allocation(None, None).await {
            Ok(alloc) => format!(
                "BRL {:.2} / USD {:.2} (FX {:.4})",
                (alloc.total_brl_cents as f64) / 100.0,
                (alloc.total_usd_cents as f64) / 100.0,
                alloc.fx_usd_brl
            ),
            Err(_) => "BRL 0.00 / USD 0.00".to_string(),
        };

        let due_tasks_str = match self.life_ops.list_tasks(TaskListFilter::default()).await {
            Ok(tasks) => {
                let due: Vec<String> = tasks
                    .into_iter()
                    .filter(|t| {
                        t.completed_at.is_none()
                            && t.due_date.map(|d| d.date_naive() <= today).unwrap_or(true)
                    })
                    .take(5)
                    .map(|t| format!("{} [{:?}]", t.title, t.priority))
                    .collect();
                if due.is_empty() {
                    "No due tasks".to_string()
                } else {
                    due.join(", ")
                }
            }
            Err(_) => "No due tasks".to_string(),
        };

        let due_reviews_str = match self.life_ops.list_due_spaced_reviews().await {
            Ok(reviews) => {
                let items: Vec<String> = reviews
                    .into_iter()
                    .take(5)
                    .map(|r| format!("{} ({})", r.lesson.title, r.interval_label))
                    .collect();
                if items.is_empty() {
                    "No due reviews".to_string()
                } else {
                    items.join(", ")
                }
            }
            Err(_) => "No due reviews".to_string(),
        };

        let rendered = raw_prompt
            .replace("{{today}}", &today_str)
            .replace("{{active_goals}}", &active_goals_str)
            .replace("{{portfolio_summary}}", &portfolio_summary_str)
            .replace("{{due_tasks}}", &due_tasks_str)
            .replace("{{due_reviews}}", &due_reviews_str);

        Ok(rendered)
    }

    pub async fn dispatch_agent(
        &self,
        lookup: impl IntoAgentLookup,
        req: DispatchAgentRequest,
    ) -> Result<AgentRun, ApiError> {
        let mut agent_telemetry = self.get_agent(lookup).await?;
        let is_dry_run = req.dry_run.unwrap_or(false);

        if !is_dry_run {
            let would_exceed = agent_telemetry.hp_remaining_cents <= 0;

            if !agent_telemetry.agent.enabled
                || agent_telemetry.agent.grid_pos.zone == ArenaZone::StandbyBarracks
                || would_exceed
            {
                if agent_telemetry.hp_remaining_cents <= 0
                    && agent_telemetry.agent.grid_pos.zone != ArenaZone::StandbyBarracks
                {
                    agent_telemetry.agent.grid_pos.zone = ArenaZone::StandbyBarracks;
                    let _ = sqlx::query(
                        "UPDATE agents SET grid_pos = $2, updated_at = NOW() WHERE id = $1",
                    )
                    .bind(agent_telemetry.agent.id)
                    .bind(Json(&agent_telemetry.agent.grid_pos))
                    .execute(&self.pool)
                    .await;
                }
                return Err(ApiError::conflict(format!(
                    "Knight '{}' is paused in standby_barracks (HP circuit breaker: {} / {} cents spent)",
                    agent_telemetry.agent.slug,
                    agent_telemetry.spent_month_cents,
                    agent_telemetry.agent.monthly_budget_cents
                )));
            }
        }

        let rendered_soul = self
            .render_soul_prompt(&agent_telemetry.agent.system_prompt)
            .await?;

        let run_id = new_uuid_v7();
        let session_key = format!("sess_knight_{}", run_id.simple());

        // Create backing session in hermes_sessions_index
        let _ = self
            .create_session(hermes_domain::CreateHermesSessionRequest {
                session_key: Some(session_key.clone()),
                title: Some(format!("Knight Run // {}", agent_telemetry.agent.name)),
                origin: SessionOrigin::KnightRun,
                profile_slug: agent_telemetry.agent.hermes_profile.clone(),
                model: None,
                high_level_mode: false,
                pinned: false,
                folder_name: Some("Knight Runs".to_string()),
                last_route_context: Some(serde_json::json!({
                    "agent_id": agent_telemetry.agent.id,
                    "agent_slug": agent_telemetry.agent.slug,
                    "is_dry_run": is_dry_run,
                })),
                messages_json: Some(serde_json::json!([
                    {
                        "role": "system",
                        "content": rendered_soul,
                        "created_at": Utc::now().to_rfc3339(),
                    }
                ])),
            })
            .await;

        let initial_trace = serde_json::json!([
            {
                "step": 1,
                "kind": "soul_interpolation",
                "rendered_prompt": rendered_soul,
                "sample_input": req.sample_input,
                "is_dry_run": is_dry_run,
            }
        ]);

        sqlx::query(
            r#"
            INSERT INTO agent_runs (
                id, agent_id, trigger_id, hermes_session_key, is_dry_run, status,
                steps_trace, input_tokens, output_tokens, estimated_cost_usd,
                error_message, started_at, finished_at
            )
            VALUES ($1, $2, $3, $4, $5, 'running', $6, 0, 0, 0, NULL, NOW(), NULL)
            "#,
        )
        .bind(run_id)
        .bind(agent_telemetry.agent.id)
        .bind(req.trigger_id)
        .bind(&session_key)
        .bind(is_dry_run)
        .bind(&initial_trace)
        .execute(&self.pool)
        .await
        .map_err(ApiError::from)?;

        self.emit_event(SystemEvent::KnightRunUpdated {
            run_id,
            agent_id: agent_telemetry.agent.id,
            agent_slug: agent_telemetry.agent.slug.clone(),
            status: "running".to_string(),
            timestamp: Utc::now(),
        });

        let mut steps = initial_trace.as_array().cloned().unwrap_or_default();
        let mut final_status = AgentRunStatus::Succeeded;
        let mut error_message: Option<String> = None;
        let input_tokens: i32;
        let output_tokens: i32;
        let estimated_cost_usd: Decimal;

        if is_dry_run {
            let preview_tool = req.tool_call.as_ref().map(|tc| {
                serde_json::json!({
                    "tool_name": tc.name,
                    "arguments": tc.arguments,
                    "simulated": true,
                    "mutated_db": false,
                })
            });
            steps.push(serde_json::json!({
                "step": 2,
                "kind": "dry_run_tool_simulation",
                "tools_policy": agent_telemetry.agent.tools_policy,
                "preview_tool": preview_tool,
                "mutated_db": false,
                "summary": format!(
                    "Dry-Run Sandbox completed for Knight '{}' with zero database mutations and zero HP/EP deduction.",
                    agent_telemetry.agent.slug
                ),
            }));
            input_tokens = 0;
            output_tokens = 0;
            estimated_cost_usd = Decimal::ZERO;
        } else {
            // Live execution (with optional MCP tool call gated by Knight's tools_policy)
            if let Some(ref directive) = req.tool_call {
                match self
                    .execute_mcp_tool_with_autonomy(
                        &directive.name,
                        directive.arguments.clone(),
                        McpCallContext {
                            session_key: session_key.clone(),
                            agent_run_id: Some(run_id),
                            knight_policy: Some(agent_telemetry.agent.tools_policy.clone()),
                            allowed_tools: None,
                            bypass_approval_gate: false,
                        },
                    )
                    .await
                {
                    Ok(McpToolExecutionOutcome::ExecutedRead {
                        autonomy_tier,
                        result,
                        ..
                    }) => {
                        steps.push(serde_json::json!({
                            "step": steps.len() + 1,
                            "kind": "mcp_tool_executed",
                            "tool_name": directive.name,
                            "autonomy_tier": autonomy_tier,
                            "result": result,
                            "undo_id": serde_json::Value::Null,
                        }));
                    }
                    Ok(McpToolExecutionOutcome::ExecutedWithUndo {
                        autonomy_tier,
                        undo_action,
                        result,
                        ..
                    }) => {
                        steps.push(serde_json::json!({
                            "step": steps.len() + 1,
                            "kind": "mcp_tool_executed",
                            "tool_name": directive.name,
                            "autonomy_tier": autonomy_tier,
                            "result": result,
                            "undo_id": undo_action.id,
                        }));
                    }
                    Ok(McpToolExecutionOutcome::PendingApproval { approval, .. }) => {
                        final_status = AgentRunStatus::AwaitingApproval;
                        steps.push(serde_json::json!({
                            "step": steps.len() + 1,
                            "kind": "mcp_tool_awaiting_approval",
                            "tool_name": directive.name,
                            "approval_id": approval.id,
                            "status": "awaiting_approval",
                        }));
                    }
                    Err(err) => {
                        final_status = AgentRunStatus::Failed;
                        error_message = Some(err.message().to_string());
                        steps.push(serde_json::json!({
                            "step": steps.len() + 1,
                            "kind": "mcp_tool_denied_or_failed",
                            "tool_name": directive.name,
                            "error": err.message(),
                        }));
                    }
                }
            }

            let mut gateway_mode = "offline_mock".to_string();
            let mut report_text = format!(
                "Knight '{}' ({:?}) executed mission under `offline_mock`. Input: {:?}.",
                agent_telemetry.agent.name,
                agent_telemetry.agent.knight_archetype,
                req.sample_input
            );
            let mut resolved_in_tokens = ((rendered_soul.len() / 4).max(64)) as i32;
            let mut resolved_out_tokens = ((report_text.len() / 4).max(48)) as i32;
            let mut gateway_cost_cents: Option<i64> = None;

            let base = self.gateway_url.trim_end_matches('/');
            if !base.is_empty()
                && !base.eq_ignore_ascii_case("offline")
                && !base.eq_ignore_ascii_case("mock")
                && !base.eq_ignore_ascii_case("offline_mock")
            {
                let runs_url = format!("{base}/runs");
                let model = agent_telemetry
                    .agent
                    .model_config
                    .get("model")
                    .and_then(|v| v.as_str())
                    .unwrap_or("hermes-3-llama-3.1-70b");
                let runs_body = serde_json::json!({
                    "agent_id": agent_telemetry.agent.id,
                    "agent_slug": agent_telemetry.agent.slug,
                    "profile": agent_telemetry.agent.hermes_profile,
                    "model": model,
                    "system_prompt": rendered_soul,
                    "input": req.sample_input,
                    "session_key": session_key,
                    "tool_calls": req.tool_call,
                });

                let mut http_req = self
                    .http_client
                    .post(&runs_url)
                    .timeout(std::time::Duration::from_millis(2000))
                    .header("X-Hermes-Session-Key", &session_key)
                    .json(&runs_body);
                if let Some(ref key) = self.gateway_api_key {
                    http_req = http_req.bearer_auth(key);
                }

                if let Ok(resp) = http_req.send().await {
                    if resp.status().is_success() {
                        gateway_mode = "online".to_string();
                        let fallback_online_report = format!(
                            "Knight '{}' ({:?}) executed mission under `online`. Input: {:?}.",
                            agent_telemetry.agent.name,
                            agent_telemetry.agent.knight_archetype,
                            req.sample_input
                        );
                        let raw_text = resp.text().await.unwrap_or_default();
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw_text) {
                            let extracted = val
                                .get("output")
                                .and_then(|v| v.as_str())
                                .or_else(|| val.get("result").and_then(|v| v.as_str()))
                                .or_else(|| val.get("content").and_then(|v| v.as_str()))
                                .or_else(|| {
                                    val.pointer("/choices/0/message/content")
                                        .and_then(|v| v.as_str())
                                })
                                .filter(|s| !s.trim().is_empty());
                            report_text = extracted
                                .map(ToString::to_string)
                                .unwrap_or(fallback_online_report);

                            if let Some(in_tok) = val
                                .pointer("/usage/input_tokens")
                                .or_else(|| val.get("input_tokens"))
                                .or_else(|| val.pointer("/usage/prompt_tokens"))
                                .and_then(|v| v.as_i64())
                                .filter(|&n| n > 0)
                            {
                                resolved_in_tokens = in_tok as i32;
                            }
                            if let Some(out_tok) = val
                                .pointer("/usage/output_tokens")
                                .or_else(|| val.get("output_tokens"))
                                .or_else(|| val.pointer("/usage/completion_tokens"))
                                .and_then(|v| v.as_i64())
                                .filter(|&n| n > 0)
                            {
                                resolved_out_tokens = out_tok as i32;
                            } else {
                                resolved_out_tokens = ((report_text.len() / 4).max(48)) as i32;
                            }
                            if let Some(cc) = val
                                .get("cost_cents")
                                .and_then(|v| v.as_i64())
                                .filter(|&c| c > 0)
                            {
                                gateway_cost_cents = Some(cc);
                            }
                        } else if !raw_text.trim().is_empty() {
                            report_text = raw_text.trim().to_string();
                            resolved_out_tokens = ((report_text.len() / 4).max(48)) as i32;
                        } else {
                            report_text = fallback_online_report;
                        }
                    }
                }
            }

            steps.push(serde_json::json!({
                "step": steps.len() + 1,
                "kind": "knight_synthesis",
                "gateway_mode": gateway_mode,
                "output": report_text,
            }));

            input_tokens = resolved_in_tokens;
            output_tokens = resolved_out_tokens;

            let cost_cents = req
                .estimated_cost_cents
                .or(gateway_cost_cents)
                .unwrap_or(5)
                .max(1);
            // Convert cents -> USD (`100 cents = $1.000000`)
            estimated_cost_usd = Decimal::new(cost_cents * 10_000, 6);
        }

        let updated_run = sqlx::query_as::<_, AgentRun>(
            r#"
            UPDATE agent_runs
            SET status = $2,
                steps_trace = $3,
                input_tokens = $4,
                output_tokens = $5,
                estimated_cost_usd = $6,
                error_message = $7,
                finished_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(run_id)
        .bind(final_status)
        .bind(serde_json::Value::Array(steps))
        .bind(input_tokens)
        .bind(output_tokens)
        .bind(estimated_cost_usd)
        .bind(&error_message)
        .fetch_one(&self.pool)
        .await
        .map_err(ApiError::from)?;

        if let Some(trig_id) = req.trigger_id {
            let _ = sqlx::query(
                "UPDATE agent_triggers SET last_run_at = NOW(), updated_at = NOW() WHERE id = $1",
            )
            .bind(trig_id)
            .execute(&self.pool)
            .await;
        }

        // Re-evaluate HP circuit breaker after live run so depleted Knights immediately move to StandbyBarracks
        if !is_dry_run {
            let _ = self
                .compute_agent_telemetry(agent_telemetry.agent.clone())
                .await;
        }

        let status_str = match final_status {
            AgentRunStatus::Running => "running",
            AgentRunStatus::AwaitingApproval => "awaiting_approval",
            AgentRunStatus::Succeeded => "succeeded",
            AgentRunStatus::Failed => "failed",
        };
        self.emit_event(SystemEvent::KnightRunUpdated {
            run_id,
            agent_id: agent_telemetry.agent.id,
            agent_slug: agent_telemetry.agent.slug,
            status: status_str.to_string(),
            timestamp: Utc::now(),
        });

        Ok(updated_run)
    }

    pub async fn list_agent_runs(
        &self,
        filter: AgentRunFilter,
    ) -> Result<Vec<AgentRun>, ApiError> {
        let limit = filter.limit.unwrap_or(50).clamp(1, 500);
        let rows = if let Some(agent_id) = filter.agent_id {
            sqlx::query_as::<_, AgentRun>(
                "SELECT * FROM agent_runs WHERE agent_id = $1 ORDER BY started_at DESC LIMIT $2",
            )
            .bind(agent_id)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(ApiError::from)?
        } else {
            sqlx::query_as::<_, AgentRun>(
                "SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT $1",
            )
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(ApiError::from)?
        };

        let filtered = rows
            .into_iter()
            .filter(|r| {
                if let Some(st) = filter.status {
                    if r.status != st {
                        return false;
                    }
                }
                if let Some(dr) = filter.is_dry_run {
                    if r.is_dry_run != dr {
                        return false;
                    }
                }
                true
            })
            .collect();

        Ok(filtered)
    }

    pub async fn get_agent_run(&self, run_id: Uuid) -> Result<AgentRun, ApiError> {
        sqlx::query_as::<_, AgentRun>("SELECT * FROM agent_runs WHERE id = $1")
            .bind(run_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(ApiError::from)?
            .ok_or_else(|| ApiError::not_found(format!("Agent run '{run_id}' not found")))
    }

    /// Event-driven trigger handler for `YoutubeCrawlerSynced`, `PortfolioPriceAlert`, and `GoalPaceAtRisk`.
    pub async fn handle_system_event(
        &self,
        event: &SystemEvent,
    ) -> Result<Vec<AgentRun>, ApiError> {
        let Some(event_name) = event.trigger_event_name() else {
            return Ok(Vec::new());
        };

        let trigger_rows = sqlx::query_as::<_, AgentTrigger>(
            r#"
            SELECT t.*
            FROM agent_triggers t
            JOIN agents a ON a.id = t.agent_id
            WHERE t.enabled = TRUE
              AND a.enabled = TRUE
              AND t.type = 'event'
              AND t.config_json->>'event' = $1
            ORDER BY t.created_at ASC
            "#,
        )
        .bind(event_name)
        .fetch_all(&self.pool)
        .await
        .map_err(ApiError::from)?;

        let mut runs = Vec::new();
        let payload_str = serde_json::to_string(event).ok();

        for trig in trigger_rows {
            if let Ok(run) = self
                .dispatch_agent(
                    trig.agent_id,
                    DispatchAgentRequest {
                        dry_run: Some(false),
                        sample_input: payload_str.clone(),
                        trigger_id: Some(trig.id),
                        tool_call: None,
                        estimated_cost_cents: Some(2),
                    },
                )
                .await
            {
                runs.push(run);
            }
        }

        Ok(runs)
    }

    /// Starts the `tokio-cron-scheduler` background scheduler and `SystemEvent` listener for Knights.
    pub async fn spawn_knight_scheduler(&self) -> Result<JobScheduler, ApiError> {
        let scheduler = JobScheduler::new().await.map_err(|e| {
            ApiError::internal(format!("Failed to initialize JobScheduler: {e}"))
        })?;

        let cron_triggers = sqlx::query_as::<_, AgentTrigger>(
            r#"
            SELECT t.*
            FROM agent_triggers t
            JOIN agents a ON a.id = t.agent_id
            WHERE t.enabled = TRUE
              AND a.enabled = TRUE
              AND t.type = 'cron'
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(ApiError::from)?;

        for trig in cron_triggers {
            let raw_cron = trig
                .config_json
                .get("cron")
                .and_then(|v| v.as_str())
                .unwrap_or("0 0 7 * * *");
            let cron_expr = normalize_cron_for_scheduler(raw_cron);
            let svc = self.clone();
            let agent_id = trig.agent_id;
            let trig_id = trig.id;

            if let Ok(job) = Job::new_async(cron_expr.as_str(), move |_uuid, _l| {
                let svc_inner = svc.clone();
                Box::pin(async move {
                    let _ = svc_inner
                        .dispatch_agent(
                            agent_id,
                            DispatchAgentRequest {
                                dry_run: Some(false),
                                sample_input: Some("Scheduled Cron Execution".to_string()),
                                trigger_id: Some(trig_id),
                                tool_call: None,
                                estimated_cost_cents: Some(2),
                            },
                        )
                        .await;
                })
            }) {
                let _ = scheduler.add(job).await;
            }
        }

        scheduler.start().await.map_err(|e| {
            ApiError::internal(format!("Failed to start JobScheduler: {e}"))
        })?;

        // Subscribe to SystemEvent bus for event triggers
        let mut rx = self.life_ops.subscribe_events();
        let svc_events = self.clone();
        tokio::spawn(async move {
            while let Ok(ev) = rx.recv().await {
                if ev.trigger_event_name().is_some() {
                    let _ = svc_events.handle_system_event(&ev).await;
                }
            }
        });

        Ok(scheduler)
    }
}
