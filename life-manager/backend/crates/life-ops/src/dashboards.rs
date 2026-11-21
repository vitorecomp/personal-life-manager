//! Feature F11 — Multi-Dashboard Room Monitor (`03`), 5-Pillar Life Score Engine (`0..100`),
//! and Custom Telemetry Widget Executors (`builtin`, `command`, `http`, `sql`, `hermes`).

use std::process::Stdio;
use std::time::Duration;

use chrono::Utc;
use hermes_domain::{
    dashboards::{
        CloneDashboardRequest, CreateDashboardRequest, CreateWidgetRequest, Dashboard,
        DashboardWidget, DashboardWithWidgets, GridRect, LifeScorePillars, LifeScoreResponse,
        PillarWeights, ReorderDashboardsRequest, UpdateDashboardRequest, UpdateWidgetRequest,
        WidgetSourceKind,
    },
    error::ApiError,
    events::SystemEvent,
    id::new_uuid_v7,
};
use sqlx::Row;
use uuid::Uuid;

use crate::service::LifeOpsService;

const MAX_COMMAND_OUTPUT_BYTES: usize = 65_536; // 64 KB
const DEFAULT_COMMAND_TIMEOUT_MS: u64 = 10_000; // 10s
const MAX_SQL_WIDGET_ROWS: usize = 200;

/// Returns `true` if configuring or mutating a widget of `source_kind` via `/mcp` requires
/// explicit human `[Approve]` confirmation (`command` and `sql` widgets).
pub fn widget_requires_mcp_approval(source_kind: &WidgetSourceKind) -> bool {
    matches!(
        source_kind,
        WidgetSourceKind::Command | WidgetSourceKind::Sql
    )
}

/// Validates that a custom widget SQL query is a single read-only `SELECT` or `WITH` statement
/// with zero DDL/DML keywords and zero references to sensitive auth/credential tables.
pub fn validate_custom_sql_query(raw_sql: &str) -> Result<String, ApiError> {
    let trimmed = raw_sql.trim();
    if trimmed.is_empty() {
        return Err(ApiError::bad_request("SQL query must not be empty"));
    }

    if trimmed.contains("--") || trimmed.contains("/*") || trimmed.contains("*/") {
        return Err(ApiError::bad_request(
            "SQL comments are not allowed in custom widget queries",
        ));
    }

    let without_trailing_semi = trimmed.strip_suffix(';').unwrap_or(trimmed).trim();
    if without_trailing_semi.is_empty() {
        return Err(ApiError::bad_request("SQL query must not be empty"));
    }
    if without_trailing_semi.contains(';') {
        return Err(ApiError::bad_request(
            "Multi-statement SQL queries are forbidden",
        ));
    }

    let tokens: Vec<String> = without_trailing_semi
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_uppercase())
        .collect();

    let Some(first) = tokens.first() else {
        return Err(ApiError::bad_request("SQL query must start with SELECT or WITH"));
    };

    if first != "SELECT" && first != "WITH" {
        return Err(ApiError::bad_request(
            "Only read-only SELECT or WITH queries are allowed",
        ));
    }

    const FORBIDDEN_KEYWORDS: &[&str] = &[
        "INSERT",
        "UPDATE",
        "DELETE",
        "DROP",
        "ALTER",
        "TRUNCATE",
        "CREATE",
        "REPLACE",
        "GRANT",
        "REVOKE",
        "COPY",
        "CALL",
        "DO",
        "EXECUTE",
        "PREPARE",
        "VACUUM",
        "ANALYZE",
        "LOCK",
        "SET",
        "RESET",
        "BEGIN",
        "COMMIT",
        "ROLLBACK",
        "SAVEPOINT",
        "PG_SLEEP",
        "PG_READ_FILE",
        "PG_LS_DIR",
        "LO_IMPORT",
        "LO_EXPORT",
        "PG_TERMINATE_BACKEND",
        "PG_CANCEL_BACKEND",
    ];

    const SENSITIVE_TABLES: &[&str] = &[
        "API_TOKENS",
        "USERS",
        "WEB_SESSIONS",
        "PG_SHADOW",
        "PG_AUTHID",
        "PG_ROLES",
        "PG_USER",
        "INFORMATION_SCHEMA",
        "PG_CATALOG",
        "PG_STAT_ACTIVITY",
    ];

    for tok in &tokens {
        if SENSITIVE_TABLES.contains(&tok.as_str()) {
            return Err(ApiError::forbidden(format!(
                "Query references restricted security table or catalog '{tok}'"
            )));
        }
        if FORBIDDEN_KEYWORDS.contains(&tok.as_str()) {
            return Err(ApiError::bad_request(format!(
                "Query contains forbidden SQL keyword '{tok}'"
            )));
        }
    }

    Ok(without_trailing_semi.to_string())
}

pub fn validate_dashboard_fields(
    title: &str,
    slug: &str,
    cycle_seconds: i32,
    layout_cols: i32,
    layout_rows: i32,
) -> Result<(), ApiError> {
    if title.trim().is_empty() {
        return Err(ApiError::bad_request("Dashboard title must not be empty"));
    }
    if slug.trim().is_empty() {
        return Err(ApiError::bad_request("Dashboard slug must not be empty"));
    }
    if !(5..=86_400).contains(&cycle_seconds) {
        return Err(ApiError::bad_request(
            "Dashboard cycle_seconds must be between 5 and 86400",
        ));
    }
    if !(1..=24).contains(&layout_cols) || !(1..=24).contains(&layout_rows) {
        return Err(ApiError::bad_request(
            "Dashboard layout_cols and layout_rows must be between 1 and 24",
        ));
    }
    Ok(())
}

pub fn validate_grid_rect(
    rect: &GridRect,
    layout_cols: i32,
    layout_rows: i32,
) -> Result<(), ApiError> {
    if rect.x < 0
        || rect.y < 0
        || rect.w < 1
        || rect.h < 1
        || rect.x + rect.w > layout_cols
        || rect.y + rect.h > layout_rows
    {
        return Err(ApiError::bad_request(format!(
            "Widget grid_rect (x={}, y={}, w={}, h={}) exceeds dashboard {}x{} bounds",
            rect.x, rect.y, rect.w, rect.h, layout_cols, layout_rows
        )));
    }
    Ok(())
}

fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        format!("deck-{}", &new_uuid_v7().simple().to_string()[24..])
    } else {
        trimmed
    }
}

impl LifeOpsService {
    /// List all Room Monitor dashboards ordered by `sort_order ASC, created_at ASC`, with widgets attached.
    pub async fn list_dashboards(&self) -> Result<Vec<DashboardWithWidgets>, ApiError> {
        let dashboards = sqlx::query_as::<_, Dashboard>(
            "SELECT id, slug, title, cycle_seconds, in_rotation, sort_order, layout_cols, layout_rows, created_at, updated_at \
             FROM dashboards \
             ORDER BY sort_order ASC, created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let all_widgets = sqlx::query_as::<_, DashboardWidget>(
            "SELECT id, dashboard_id, title, source_kind, renderer_kind, grid_rect, source_config, \
                    refresh_interval_seconds, cached_payload, last_refreshed_at, sort_order, created_at, updated_at \
             FROM dashboard_widgets \
             ORDER BY sort_order ASC, created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut result = Vec::with_capacity(dashboards.len());
        for dashboard in dashboards {
            let widgets = all_widgets
                .iter()
                .filter(|w| w.dashboard_id == dashboard.id)
                .cloned()
                .collect();
            result.push(DashboardWithWidgets { dashboard, widgets });
        }
        Ok(result)
    }

    /// Fetch a single dashboard by UUID or `slug` (`404 Not Found` if absent).
    pub async fn get_dashboard(&self, id_or_slug: &str) -> Result<DashboardWithWidgets, ApiError> {
        let trimmed = id_or_slug.trim();
        let dashboard = if let Ok(uuid) = Uuid::parse_str(trimmed) {
            sqlx::query_as::<_, Dashboard>(
                "SELECT id, slug, title, cycle_seconds, in_rotation, sort_order, layout_cols, layout_rows, created_at, updated_at \
                 FROM dashboards WHERE id = $1",
            )
            .bind(uuid)
            .fetch_optional(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, Dashboard>(
                "SELECT id, slug, title, cycle_seconds, in_rotation, sort_order, layout_cols, layout_rows, created_at, updated_at \
                 FROM dashboards WHERE slug = $1",
            )
            .bind(trimmed)
            .fetch_optional(&self.pool)
            .await?
        };

        let Some(dashboard) = dashboard else {
            return Err(ApiError::not_found(format!(
                "Dashboard '{trimmed}' not found"
            )));
        };

        let widgets = sqlx::query_as::<_, DashboardWidget>(
            "SELECT id, dashboard_id, title, source_kind, renderer_kind, grid_rect, source_config, \
                    refresh_interval_seconds, cached_payload, last_refreshed_at, sort_order, created_at, updated_at \
             FROM dashboard_widgets \
             WHERE dashboard_id = $1 \
             ORDER BY sort_order ASC, created_at ASC",
        )
        .bind(dashboard.id)
        .fetch_all(&self.pool)
        .await?;

        Ok(DashboardWithWidgets { dashboard, widgets })
    }

    /// Create a new Room Monitor dashboard ("Deck").
    pub async fn create_dashboard(
        &self,
        req: CreateDashboardRequest,
    ) -> Result<DashboardWithWidgets, ApiError> {
        let title = req.title.trim().to_string();
        let slug = req
            .slug
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| slugify(&title));

        validate_dashboard_fields(
            &title,
            &slug,
            req.cycle_seconds,
            req.layout_cols,
            req.layout_rows,
        )?;

        let sort_order = match req.sort_order {
            Some(order) => order,
            None => {
                let max_order: i32 = sqlx::query_scalar(
                    "SELECT COALESCE(MAX(sort_order), 0) FROM dashboards",
                )
                .fetch_one(&self.pool)
                .await?;
                max_order + 1
            }
        };

        let id = new_uuid_v7();
        let dashboard = sqlx::query_as::<_, Dashboard>(
            "INSERT INTO dashboards (id, slug, title, cycle_seconds, in_rotation, sort_order, layout_cols, layout_rows) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
             RETURNING id, slug, title, cycle_seconds, in_rotation, sort_order, layout_cols, layout_rows, created_at, updated_at",
        )
        .bind(id)
        .bind(&slug)
        .bind(&title)
        .bind(req.cycle_seconds)
        .bind(req.in_rotation)
        .bind(sort_order)
        .bind(req.layout_cols)
        .bind(req.layout_rows)
        .fetch_one(&self.pool)
        .await?;

        self.emit_event(SystemEvent::DashboardUpdated {
            dashboard_id: dashboard.id,
            action: "created".to_string(),
            timestamp: Utc::now(),
        });

        Ok(DashboardWithWidgets {
            dashboard,
            widgets: Vec::new(),
        })
    }

    /// Update an existing dashboard's configuration.
    pub async fn update_dashboard(
        &self,
        id: Uuid,
        req: UpdateDashboardRequest,
    ) -> Result<DashboardWithWidgets, ApiError> {
        let existing = self.get_dashboard(&id.to_string()).await?;
        let d = existing.dashboard;

        let title = req
            .title
            .as_deref()
            .map(str::trim)
            .unwrap_or(&d.title)
            .to_string();
        let slug = req
            .slug
            .as_deref()
            .map(str::trim)
            .unwrap_or(&d.slug)
            .to_string();
        let cycle_seconds = req.cycle_seconds.unwrap_or(d.cycle_seconds);
        let in_rotation = req.in_rotation.unwrap_or(d.in_rotation);
        let sort_order = req.sort_order.unwrap_or(d.sort_order);
        let layout_cols = req.layout_cols.unwrap_or(d.layout_cols);
        let layout_rows = req.layout_rows.unwrap_or(d.layout_rows);

        validate_dashboard_fields(&title, &slug, cycle_seconds, layout_cols, layout_rows)?;

        let updated = sqlx::query_as::<_, Dashboard>(
            "UPDATE dashboards SET \
                slug = $2, \
                title = $3, \
                cycle_seconds = $4, \
                in_rotation = $5, \
                sort_order = $6, \
                layout_cols = $7, \
                layout_rows = $8, \
                updated_at = NOW() \
             WHERE id = $1 \
             RETURNING id, slug, title, cycle_seconds, in_rotation, sort_order, layout_cols, layout_rows, created_at, updated_at",
        )
        .bind(id)
        .bind(&slug)
        .bind(&title)
        .bind(cycle_seconds)
        .bind(in_rotation)
        .bind(sort_order)
        .bind(layout_cols)
        .bind(layout_rows)
        .fetch_one(&self.pool)
        .await?;

        self.emit_event(SystemEvent::DashboardUpdated {
            dashboard_id: id,
            action: "updated".to_string(),
            timestamp: Utc::now(),
        });

        Ok(DashboardWithWidgets {
            dashboard: updated,
            widgets: existing.widgets,
        })
    }

    /// Delete a dashboard (cascading to its widgets).
    pub async fn delete_dashboard(&self, id: Uuid) -> Result<(), ApiError> {
        let res = sqlx::query("DELETE FROM dashboards WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(ApiError::not_found(format!("Dashboard '{id}' not found")));
        }
        self.emit_event(SystemEvent::DashboardUpdated {
            dashboard_id: id,
            action: "deleted".to_string(),
            timestamp: Utc::now(),
        });
        Ok(())
    }

    /// Deep-clone a dashboard and all of its widgets with fresh UUIDv7 identifiers.
    pub async fn clone_dashboard(
        &self,
        id: Uuid,
        req: CloneDashboardRequest,
    ) -> Result<DashboardWithWidgets, ApiError> {
        let source = self.get_dashboard(&id.to_string()).await?;
        let new_id = new_uuid_v7();
        let short_suffix = &new_id.simple().to_string()[24..];

        let new_title = req
            .title
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| format!("{} (Copy)", source.dashboard.title));

        let new_slug = req
            .slug
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| format!("{}-copy-{}", source.dashboard.slug, short_suffix));

        let mut tx = self.pool.begin().await?;
        let max_order: i32 =
            sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), 0) FROM dashboards")
                .fetch_one(&mut *tx)
                .await?;

        let cloned_dashboard = sqlx::query_as::<_, Dashboard>(
            "INSERT INTO dashboards (id, slug, title, cycle_seconds, in_rotation, sort_order, layout_cols, layout_rows) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
             RETURNING id, slug, title, cycle_seconds, in_rotation, sort_order, layout_cols, layout_rows, created_at, updated_at",
        )
        .bind(new_id)
        .bind(&new_slug)
        .bind(&new_title)
        .bind(source.dashboard.cycle_seconds)
        .bind(source.dashboard.in_rotation)
        .bind(max_order + 1)
        .bind(source.dashboard.layout_cols)
        .bind(source.dashboard.layout_rows)
        .fetch_one(&mut *tx)
        .await?;

        let mut cloned_widgets = Vec::with_capacity(source.widgets.len());
        for w in &source.widgets {
            let wid = new_uuid_v7();
            let rect_json = serde_json::to_value(w.grid_rect)?;
            let cw = sqlx::query_as::<_, DashboardWidget>(
                "INSERT INTO dashboard_widgets ( \
                    id, dashboard_id, title, source_kind, renderer_kind, grid_rect, source_config, \
                    refresh_interval_seconds, cached_payload, last_refreshed_at, sort_order \
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
                 RETURNING id, dashboard_id, title, source_kind, renderer_kind, grid_rect, source_config, \
                           refresh_interval_seconds, cached_payload, last_refreshed_at, sort_order, created_at, updated_at",
            )
            .bind(wid)
            .bind(new_id)
            .bind(&w.title)
            .bind(w.source_kind)
            .bind(w.renderer_kind)
            .bind(rect_json)
            .bind(&w.source_config)
            .bind(w.refresh_interval_seconds)
            .bind(&w.cached_payload)
            .bind(w.last_refreshed_at)
            .bind(w.sort_order)
            .fetch_one(&mut *tx)
            .await?;
            cloned_widgets.push(cw);
        }

        tx.commit().await?;

        self.emit_event(SystemEvent::DashboardUpdated {
            dashboard_id: new_id,
            action: "cloned".to_string(),
            timestamp: Utc::now(),
        });

        Ok(DashboardWithWidgets {
            dashboard: cloned_dashboard,
            widgets: cloned_widgets,
        })
    }

    /// Reorder dashboards by updating `sort_order` according to `req.dashboard_ids`.
    pub async fn reorder_dashboards(
        &self,
        req: ReorderDashboardsRequest,
    ) -> Result<Vec<Dashboard>, ApiError> {
        let mut tx = self.pool.begin().await?;
        for (idx, dashboard_id) in req.dashboard_ids.iter().enumerate() {
            sqlx::query("UPDATE dashboards SET sort_order = $2, updated_at = NOW() WHERE id = $1")
                .bind(dashboard_id)
                .bind((idx + 1) as i32)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;

        if let Some(&first_id) = req.dashboard_ids.first() {
            self.emit_event(SystemEvent::DashboardUpdated {
                dashboard_id: first_id,
                action: "reordered".to_string(),
                timestamp: Utc::now(),
            });
        }

        let ordered = sqlx::query_as::<_, Dashboard>(
            "SELECT id, slug, title, cycle_seconds, in_rotation, sort_order, layout_cols, layout_rows, created_at, updated_at \
             FROM dashboards ORDER BY sort_order ASC, created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(ordered)
    }

    /// Create a widget on a dashboard after validating its `grid_rect` against the dashboard's layout bounds (`12×8`).
    pub async fn create_widget(
        &self,
        dashboard_id: Uuid,
        req: CreateWidgetRequest,
    ) -> Result<DashboardWidget, ApiError> {
        let parent = self.get_dashboard(&dashboard_id.to_string()).await?;
        if req.title.trim().is_empty() {
            return Err(ApiError::bad_request("Widget title must not be empty"));
        }
        if req.refresh_interval_seconds < 5 {
            return Err(ApiError::bad_request(
                "Widget refresh_interval_seconds must be >= 5",
            ));
        }
        validate_grid_rect(
            &req.grid_rect,
            parent.dashboard.layout_cols,
            parent.dashboard.layout_rows,
        )?;

        if req.source_kind == WidgetSourceKind::Sql {
            if let Some(q) = req.source_config.get("query").and_then(|v| v.as_str()) {
                validate_custom_sql_query(q)?;
            }
        }

        let sort_order = match req.sort_order {
            Some(s) => s,
            None => parent.widgets.len() as i32 + 1,
        };

        let id = new_uuid_v7();
        let rect_json = serde_json::to_value(req.grid_rect)?;
        let widget = sqlx::query_as::<_, DashboardWidget>(
            "INSERT INTO dashboard_widgets ( \
                id, dashboard_id, title, source_kind, renderer_kind, grid_rect, source_config, \
                refresh_interval_seconds, sort_order \
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
             RETURNING id, dashboard_id, title, source_kind, renderer_kind, grid_rect, source_config, \
                       refresh_interval_seconds, cached_payload, last_refreshed_at, sort_order, created_at, updated_at",
        )
        .bind(id)
        .bind(dashboard_id)
        .bind(req.title.trim())
        .bind(req.source_kind)
        .bind(req.renderer_kind)
        .bind(rect_json)
        .bind(&req.source_config)
        .bind(req.refresh_interval_seconds)
        .bind(sort_order)
        .fetch_one(&self.pool)
        .await?;

        self.emit_event(SystemEvent::DashboardUpdated {
            dashboard_id,
            action: "widget_created".to_string(),
            timestamp: Utc::now(),
        });

        Ok(widget)
    }

    /// Update a widget on a dashboard after validating its `grid_rect` and `source_config`.
    pub async fn update_widget(
        &self,
        dashboard_id: Uuid,
        widget_id: Uuid,
        req: UpdateWidgetRequest,
    ) -> Result<DashboardWidget, ApiError> {
        let parent = self.get_dashboard(&dashboard_id.to_string()).await?;
        let existing = parent
            .widgets
            .into_iter()
            .find(|w| w.id == widget_id)
            .ok_or_else(|| ApiError::not_found(format!("Widget '{widget_id}' not found")))?;

        let title = req
            .title
            .as_deref()
            .map(str::trim)
            .unwrap_or(&existing.title)
            .to_string();
        if title.is_empty() {
            return Err(ApiError::bad_request("Widget title must not be empty"));
        }
        let source_kind = req.source_kind.unwrap_or(existing.source_kind);
        let renderer_kind = req.renderer_kind.unwrap_or(existing.renderer_kind);
        let grid_rect = req.grid_rect.unwrap_or(existing.grid_rect);
        let source_config = req.source_config.unwrap_or(existing.source_config);
        let refresh_interval_seconds = req
            .refresh_interval_seconds
            .unwrap_or(existing.refresh_interval_seconds);
        let sort_order = req.sort_order.unwrap_or(existing.sort_order);

        if refresh_interval_seconds < 5 {
            return Err(ApiError::bad_request(
                "Widget refresh_interval_seconds must be >= 5",
            ));
        }

        validate_grid_rect(
            &grid_rect,
            parent.dashboard.layout_cols,
            parent.dashboard.layout_rows,
        )?;

        if source_kind == WidgetSourceKind::Sql {
            if let Some(q) = source_config.get("query").and_then(|v| v.as_str()) {
                validate_custom_sql_query(q)?;
            }
        }

        let rect_json = serde_json::to_value(grid_rect)?;
        let updated = sqlx::query_as::<_, DashboardWidget>(
            "UPDATE dashboard_widgets SET \
                title = $3, \
                source_kind = $4, \
                renderer_kind = $5, \
                grid_rect = $6, \
                source_config = $7, \
                refresh_interval_seconds = $8, \
                sort_order = $9, \
                updated_at = NOW() \
             WHERE id = $1 AND dashboard_id = $2 \
             RETURNING id, dashboard_id, title, source_kind, renderer_kind, grid_rect, source_config, \
                       refresh_interval_seconds, cached_payload, last_refreshed_at, sort_order, created_at, updated_at",
        )
        .bind(widget_id)
        .bind(dashboard_id)
        .bind(&title)
        .bind(source_kind)
        .bind(renderer_kind)
        .bind(rect_json)
        .bind(&source_config)
        .bind(refresh_interval_seconds)
        .bind(sort_order)
        .fetch_one(&self.pool)
        .await?;

        self.emit_event(SystemEvent::DashboardUpdated {
            dashboard_id,
            action: "widget_updated".to_string(),
            timestamp: Utc::now(),
        });

        Ok(updated)
    }

    /// Delete a widget from a dashboard.
    pub async fn delete_widget(
        &self,
        dashboard_id: Uuid,
        widget_id: Uuid,
    ) -> Result<(), ApiError> {
        let res = sqlx::query(
            "DELETE FROM dashboard_widgets WHERE id = $1 AND dashboard_id = $2",
        )
        .bind(widget_id)
        .bind(dashboard_id)
        .execute(&self.pool)
        .await?;

        if res.rows_affected() == 0 {
            return Err(ApiError::not_found(format!(
                "Widget '{widget_id}' on dashboard '{dashboard_id}' not found"
            )));
        }

        self.emit_event(SystemEvent::DashboardUpdated {
            dashboard_id,
            action: "widget_deleted".to_string(),
            timestamp: Utc::now(),
        });
        Ok(())
    }

    /// Resolve the parent `dashboard_id` for a given `widget_id` (`404 Not Found` if absent).
    pub async fn find_widget_dashboard_id(&self, widget_id: Uuid) -> Result<Uuid, ApiError> {
        let dashboard_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT dashboard_id FROM dashboard_widgets WHERE id = $1",
        )
        .bind(widget_id)
        .fetch_optional(&self.pool)
        .await?;

        dashboard_id.ok_or_else(|| ApiError::not_found(format!("Widget '{widget_id}' not found")))
    }

    /// Compute the 5-pillar composite Life Score (`0.0..=100.0`, equal default weights `0.20 × 5`,
    /// returning neutral `50.0` for any pillar with zero underlying records and zero `NaN`s).
    pub async fn compute_life_score(&self) -> Result<LifeScoreResponse, ApiError> {
        let focus = self.compute_focus_pillar().await?;
        let routines = self.compute_routines_pillar().await?;
        let goals = self.compute_goals_pillar().await?;
        let learning = self.compute_learning_pillar().await?;
        let wealth = self.compute_wealth_pillar().await?;

        let weights = PillarWeights::default();
        let raw = weights.focus * focus
            + weights.routines * routines
            + weights.goals * goals
            + weights.learning * learning
            + weights.wealth * wealth;

        let composite_score = sanitize_score(raw);
        let score = composite_score.round() as i32;

        Ok(LifeScoreResponse {
            composite_score,
            score,
            pillars: LifeScorePillars {
                focus: sanitize_score(focus),
                routines: sanitize_score(routines),
                goals: sanitize_score(goals),
                learning: sanitize_score(learning),
                wealth: sanitize_score(wealth),
            },
            weights,
            computed_at: Utc::now(),
        })
    }

    async fn compute_focus_pillar(&self) -> Result<f64, ApiError> {
        let row = sqlx::query(
            "SELECT \
                COUNT(*) FILTER (WHERE status != 'canceled') AS total_tasks, \
                COUNT(*) FILTER (WHERE status = 'done') AS done_tasks \
             FROM tasks WHERE deleted_at IS NULL",
        )
        .fetch_one(&self.pool)
        .await?;

        let total_tasks: i64 = row.try_get("total_tasks")?;
        let done_tasks: i64 = row.try_get("done_tasks")?;

        let session_row = sqlx::query(
            "SELECT COUNT(*) AS session_count, COALESCE(SUM(duration_seconds), 0)::BIGINT AS total_secs \
             FROM time_sessions \
             WHERE deleted_at IS NULL AND started_at >= NOW() - INTERVAL '7 days'",
        )
        .fetch_one(&self.pool)
        .await?;

        let session_count: i64 = session_row.try_get("session_count")?;
        let total_secs: i64 = session_row.try_get("total_secs")?;

        if total_tasks == 0 && session_count == 0 {
            return Ok(50.0);
        }

        let task_score = if total_tasks > 0 {
            (done_tasks as f64 / total_tasks as f64) * 100.0
        } else {
            50.0
        };

        // 7-day target: 420 minutes (25,200 seconds = 1h/day)
        let timer_score = if session_count > 0 {
            ((total_secs as f64 / 25_200.0) * 100.0).clamp(0.0, 100.0)
        } else {
            task_score
        };

        let blended = if total_tasks > 0 && session_count > 0 {
            0.5 * task_score + 0.5 * timer_score
        } else if total_tasks > 0 {
            task_score
        } else {
            timer_score
        };

        Ok(sanitize_score(blended))
    }

    async fn compute_routines_pillar(&self) -> Result<f64, ApiError> {
        let row = sqlx::query(
            "SELECT \
                COUNT(*) AS total_logs, \
                COALESCE(SUM(CASE \
                    WHEN status = 'completed' THEN 1.0 \
                    WHEN status = 'partial' THEN 0.5 \
                    ELSE 0.0 \
                END), 0.0)::FLOAT8 AS weighted_completed \
             FROM routine_logs \
             WHERE deleted_at IS NULL AND log_date >= CURRENT_DATE - 7",
        )
        .fetch_one(&self.pool)
        .await?;

        let total_logs: i64 = row.try_get("total_logs")?;
        let weighted_completed: f64 = row.try_get("weighted_completed")?;

        if total_logs == 0 {
            return Ok(50.0);
        }

        Ok(sanitize_score(
            (weighted_completed / total_logs as f64) * 100.0,
        ))
    }

    async fn compute_goals_pillar(&self) -> Result<f64, ApiError> {
        let row = sqlx::query(
            "SELECT COUNT(*) AS goal_count, COALESCE(AVG(progress_pct::FLOAT8), 50.0)::FLOAT8 AS avg_pct \
             FROM goals \
             WHERE status IN ('not_started', 'in_progress', 'completed')",
        )
        .fetch_one(&self.pool)
        .await?;

        let goal_count: i64 = row.try_get("goal_count")?;
        let avg_pct: f64 = row.try_get("avg_pct")?;

        if goal_count == 0 {
            return Ok(50.0);
        }

        Ok(sanitize_score(avg_pct))
    }

    async fn compute_learning_pillar(&self) -> Result<f64, ApiError> {
        let row = sqlx::query(
            "SELECT COUNT(*) AS course_count, COALESCE(AVG(progress_pct::FLOAT8), 50.0)::FLOAT8 AS avg_pct \
             FROM courses \
             WHERE status IN ('active', 'capstone', 'completed')",
        )
        .fetch_one(&self.pool)
        .await?;

        let course_count: i64 = row.try_get("course_count")?;
        let avg_pct: f64 = row.try_get("avg_pct")?;

        let study_secs: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(duration_seconds), 0)::BIGINT FROM time_sessions \
             WHERE deleted_at IS NULL AND category = 'learning' AND started_at >= NOW() - INTERVAL '7 days'",
        )
        .fetch_one(&self.pool)
        .await?;

        if course_count == 0 && study_secs == 0 {
            return Ok(50.0);
        }

        let study_score = ((study_secs as f64 / 10_800.0) * 100.0).clamp(0.0, 100.0); // 3h/week
        let blended = if course_count > 0 && study_secs > 0 {
            0.6 * avg_pct + 0.4 * study_score
        } else if course_count > 0 {
            avg_pct
        } else {
            study_score
        };

        Ok(sanitize_score(blended))
    }

    async fn compute_wealth_pillar(&self) -> Result<f64, ApiError> {
        let asset_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM portfolio_assets WHERE in_portfolio = TRUE",
        )
        .fetch_one(&self.pool)
        .await?;

        let plan_row = sqlx::query(
            "SELECT salary_income_cents, planned_spend_cents, actual_spend_cents, \
                    planned_investment_cents, actual_invested_cents \
             FROM monthly_investment_plans \
             ORDER BY month DESC LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await?;

        if asset_count == 0 && plan_row.is_none() {
            return Ok(50.0);
        }

        if let Some(plan) = plan_row {
            let salary: i64 = plan.try_get("salary_income_cents")?;
            let planned_spend: i64 = plan.try_get("planned_spend_cents")?;
            let actual_spend: Option<i64> = plan.try_get("actual_spend_cents")?;
            let planned_inv: i64 = plan.try_get("planned_investment_cents")?;
            let actual_inv: i64 = plan.try_get("actual_invested_cents")?;

            if salary > 0 {
                let spend = actual_spend.unwrap_or(planned_spend);
                let savings_rate = ((salary - spend).max(0) as f64 / salary as f64) * 100.0;
                // 30%+ savings rate maps to 100
                let savings_score = (savings_rate / 30.0 * 100.0).clamp(0.0, 100.0);
                let inv_score = if planned_inv > 0 {
                    (actual_inv as f64 / planned_inv as f64 * 100.0).clamp(0.0, 100.0)
                } else {
                    savings_score
                };
                return Ok(sanitize_score(0.6 * savings_score + 0.4 * inv_score));
            }
        }

        // If portfolio assets exist without a monthly plan yet, score based on positive asset valuation
        let total_val_cents: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM((quantity * current_price_cents)::BIGINT), 0)::BIGINT \
             FROM portfolio_assets WHERE in_portfolio = TRUE",
        )
        .fetch_one(&self.pool)
        .await?;

        if total_val_cents > 0 {
            Ok(75.0)
        } else {
            Ok(50.0)
        }
    }

    /// Execute a widget's data source (`builtin`, `command`, `http`, `sql`, `hermes`),
    /// update `cached_payload` and `last_refreshed_at`, emit `SystemEvent::WidgetRefreshed`,
    /// and return the updated `DashboardWidget`.
    pub async fn refresh_widget(&self, widget_id: Uuid) -> Result<DashboardWidget, ApiError> {
        let widget = sqlx::query_as::<_, DashboardWidget>(
            "SELECT id, dashboard_id, title, source_kind, renderer_kind, grid_rect, source_config, \
                    refresh_interval_seconds, cached_payload, last_refreshed_at, sort_order, created_at, updated_at \
             FROM dashboard_widgets WHERE id = $1",
        )
        .bind(widget_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| ApiError::not_found(format!("Widget '{widget_id}' not found")))?;

        let payload = match widget.source_kind {
            WidgetSourceKind::Builtin => self.execute_builtin_widget(&widget.source_config).await?,
            WidgetSourceKind::Command => self.execute_command_widget(&widget.source_config).await?,
            WidgetSourceKind::Http => self.execute_http_widget(&widget.source_config).await?,
            WidgetSourceKind::Sql => self.execute_sql_widget(&widget.source_config).await?,
            WidgetSourceKind::Hermes => self.execute_hermes_widget(&widget.source_config).await?,
        };

        let updated = sqlx::query_as::<_, DashboardWidget>(
            "UPDATE dashboard_widgets \
             SET cached_payload = $2, last_refreshed_at = NOW(), updated_at = NOW() \
             WHERE id = $1 \
             RETURNING id, dashboard_id, title, source_kind, renderer_kind, grid_rect, source_config, \
                       refresh_interval_seconds, cached_payload, last_refreshed_at, sort_order, created_at, updated_at",
        )
        .bind(widget_id)
        .bind(&payload)
        .fetch_one(&self.pool)
        .await?;

        self.emit_event(SystemEvent::WidgetRefreshed {
            dashboard_id: updated.dashboard_id,
            widget_id: updated.id,
            refreshed_at: updated.last_refreshed_at.unwrap_or_else(Utc::now),
        });

        Ok(updated)
    }

    async fn execute_builtin_widget(
        &self,
        cfg: &serde_json::Value,
    ) -> Result<serde_json::Value, ApiError> {
        let key = cfg
            .get("builtin_key")
            .or_else(|| cfg.get("widget_type"))
            .or_else(|| cfg.get("builtin_type"))
            .or_else(|| cfg.get("module"))
            .and_then(|v| v.as_str())
            .unwrap_or("life_score");

        match key {
            "life_score" | "life_radar" => {
                let score = self.compute_life_score().await?;
                Ok(serde_json::to_value(score)?)
            }
            "focus_velocity" | "focus_todos" | "focus_barcode" => {
                let row = sqlx::query(
                    "SELECT \
                        COUNT(*) FILTER (WHERE status = 'done') AS completed_tasks, \
                        COUNT(*) FILTER (WHERE status != 'canceled') AS total_tasks \
                     FROM tasks WHERE deleted_at IS NULL",
                )
                .fetch_one(&self.pool)
                .await?;
                let completed_tasks: i64 = row.try_get("completed_tasks")?;
                let total_tasks: i64 = row.try_get("total_tasks")?;

                let focus_secs: i64 = sqlx::query_scalar(
                    "SELECT COALESCE(SUM(duration_seconds), 0)::BIGINT FROM time_sessions \
                     WHERE deleted_at IS NULL AND started_at >= NOW() - INTERVAL '24 hours'",
                )
                .fetch_one(&self.pool)
                .await?;

                Ok(serde_json::json!({
                    "builtin_key": key,
                    "completed_tasks": completed_tasks,
                    "total_tasks": total_tasks,
                    "focus_seconds_24h": focus_secs,
                }))
            }
            "routine_consistency" | "routines_bio" => {
                let total_items: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM routine_items WHERE deleted_at IS NULL",
                )
                .fetch_one(&self.pool)
                .await?;
                let logs_7d: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM routine_logs WHERE deleted_at IS NULL AND log_date >= CURRENT_DATE - 7",
                )
                .fetch_one(&self.pool)
                .await?;

                Ok(serde_json::json!({
                    "builtin_key": key,
                    "active_habits": total_items,
                    "logs_7d": logs_7d,
                }))
            }
            "portfolio_fire" | "portfolio_waffle" | "fire_gauge" | "monthly_surplus" => {
                let asset_count: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM portfolio_assets WHERE in_portfolio = TRUE",
                )
                .fetch_one(&self.pool)
                .await?;
                let allocation = self.get_portfolio_allocation(None, None).await?;
                let fire = self.get_retirement_projection().await?;
                Ok(serde_json::json!({
                    "builtin_key": key,
                    "portfolio_asset_count": asset_count,
                    "total_brl_cents": allocation.total_brl_cents,
                    "total_usd_cents": allocation.total_usd_cents,
                    "fx_usd_brl": allocation.fx_usd_brl,
                    "waffle_tiles": allocation.waffle_tiles,
                    "fire_projection": fire,
                }))
            }
            "goals_courses" | "goals_blueprint" | "courses_momentum" | "second_brain_constellation" => {
                let active_goals: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM goals WHERE status IN ('not_started', 'in_progress')",
                )
                .fetch_one(&self.pool)
                .await?;
                let active_courses: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM courses WHERE status IN ('active', 'capstone')",
                )
                .fetch_one(&self.pool)
                .await?;
                let vault_chunks: i64 =
                    sqlx::query_scalar("SELECT COUNT(*) FROM vault_embeddings")
                        .fetch_one(&self.pool)
                        .await?;
                Ok(serde_json::json!({
                    "builtin_key": key,
                    "active_goals": active_goals,
                    "active_courses": active_courses,
                    "vault_chunks": vault_chunks,
                }))
            }
            "server_prober" => {
                let summary = self.get_servers_summary().await?;
                let servers = self.list_servers().await?;
                Ok(serde_json::json!({
                    "builtin_key": "server_prober",
                    "summary": summary,
                    "servers": servers,
                }))
            }
            "knight_pulse" | "knights_pulse" => {
                let knights: i64 =
                    sqlx::query_scalar("SELECT COUNT(*) FROM agents WHERE enabled = TRUE")
                        .fetch_one(&self.pool)
                        .await?;
                let pending_approvals: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM pending_mcp_approvals WHERE status = 'pending'",
                )
                .fetch_one(&self.pool)
                .await?;
                Ok(serde_json::json!({
                    "builtin_key": key,
                    "enabled_knights": knights,
                    "pending_approvals": pending_approvals,
                }))
            }
            other => {
                let score = self.compute_life_score().await?;
                Ok(serde_json::json!({
                    "builtin_key": other,
                    "life_score": score,
                }))
            }
        }
    }

    async fn execute_command_widget(
        &self,
        cfg: &serde_json::Value,
    ) -> Result<serde_json::Value, ApiError> {
        let cmd_str = cfg
            .get("command")
            .or_else(|| cfg.get("cmd"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                ApiError::bad_request("Command widget requires non-empty source_config.command")
            })?;

        let timeout_ms = cfg
            .get("timeout_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_COMMAND_TIMEOUT_MS)
            .clamp(50, DEFAULT_COMMAND_TIMEOUT_MS);

        let child = tokio::process::Command::new("sh")
            .arg("-c")
            .arg(cmd_str)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| ApiError::internal(format!("Failed to spawn command widget: {e}")))?;

        match tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait_with_output())
            .await
        {
            Ok(Ok(output)) => {
                let stdout_truncated = output.stdout.len() > MAX_COMMAND_OUTPUT_BYTES;
                let stderr_truncated = output.stderr.len() > MAX_COMMAND_OUTPUT_BYTES;
                let stdout_slice =
                    &output.stdout[..output.stdout.len().min(MAX_COMMAND_OUTPUT_BYTES)];
                let stderr_slice =
                    &output.stderr[..output.stderr.len().min(MAX_COMMAND_OUTPUT_BYTES)];
                let stdout_str = String::from_utf8_lossy(stdout_slice).into_owned();
                let stderr_str = String::from_utf8_lossy(stderr_slice).into_owned();
                let parsed_json: Option<serde_json::Value> =
                    serde_json::from_str(stdout_str.trim()).ok();

                Ok(serde_json::json!({
                    "status": if output.status.success() { "ok" } else { "error" },
                    "timed_out": false,
                    "exit_code": output.status.code().unwrap_or(-1),
                    "stdout": stdout_str,
                    "stderr": stderr_str,
                    "parsed_json": parsed_json,
                    "truncated": stdout_truncated || stderr_truncated,
                }))
            }
            Ok(Err(e)) => Err(ApiError::internal(format!(
                "Command execution failed: {e}"
            ))),
            Err(_) => Ok(serde_json::json!({
                "status": "timeout",
                "timed_out": true,
                "timeout_ms": timeout_ms,
                "stdout": "",
                "stderr": format!("Command timed out after {timeout_ms}ms"),
            })),
        }
    }

    async fn execute_http_widget(
        &self,
        cfg: &serde_json::Value,
    ) -> Result<serde_json::Value, ApiError> {
        let url = cfg
            .get("url")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
            .ok_or_else(|| {
                ApiError::bad_request(
                    "HTTP widget requires valid http:// or https:// source_config.url",
                )
            })?;

        let mut req_builder = self.http_client.get(url).timeout(Duration::from_secs(5));
        if let Some(headers) = cfg.get("headers").and_then(|v| v.as_object()) {
            for (k, v) in headers {
                if let Some(val_str) = v.as_str() {
                    req_builder = req_builder.header(k, val_str);
                }
            }
        }

        let resp = req_builder.send().await.map_err(|e| {
            ApiError::bad_gateway(format!("HTTP widget request to '{url}' failed: {e}"))
        })?;
        let status_code = resp.status().as_u16();
        let body_text = resp.text().await.unwrap_or_default();
        let json_val: serde_json::Value = serde_json::from_str(&body_text)
            .unwrap_or_else(|_| serde_json::Value::String(body_text));

        let pointer_cfg = cfg
            .get("json_pointer")
            .or_else(|| cfg.get("json_path"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());

        let extracted = match pointer_cfg {
            Some(ptr) => extract_json_pointer(&json_val, ptr),
            None => Some(json_val.clone()),
        };

        Ok(serde_json::json!({
            "status": status_code,
            "url": url,
            "extracted": extracted,
            "raw": json_val,
        }))
    }

    async fn execute_sql_widget(
        &self,
        cfg: &serde_json::Value,
    ) -> Result<serde_json::Value, ApiError> {
        let raw_query = cfg
            .get("query")
            .or_else(|| cfg.get("sql"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                ApiError::bad_request("SQL widget requires non-empty source_config.query")
            })?;

        let clean_sql = validate_custom_sql_query(raw_query)?;

        let mut tx = self.pool.begin().await?;
        sqlx::query("SET TRANSACTION READ ONLY")
            .execute(&mut *tx)
            .await?;
        sqlx::query("SET LOCAL statement_timeout = '5000ms'")
            .execute(&mut *tx)
            .await?;

        let wrapped_sql = format!(
            "SELECT COALESCE(jsonb_agg(row_to_json(_q)), '[]'::jsonb) \
             FROM (SELECT * FROM ({clean_sql}) _inner LIMIT {MAX_SQL_WIDGET_ROWS}) _q"
        );

        let rows_json: serde_json::Value = sqlx::query_scalar(&wrapped_sql)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| ApiError::bad_request(format!("SQL widget query failed: {e}")))?;

        let _ = tx.rollback().await;

        let row_count = rows_json.as_array().map(|a| a.len()).unwrap_or(0);
        Ok(serde_json::json!({
            "rows": rows_json,
            "row_count": row_count,
            "max_rows": MAX_SQL_WIDGET_ROWS,
        }))
    }

    async fn execute_hermes_widget(
        &self,
        cfg: &serde_json::Value,
    ) -> Result<serde_json::Value, ApiError> {
        let prompt = cfg
            .get("prompt")
            .and_then(|v| v.as_str())
            .unwrap_or("Summarize today's tactical priorities.");
        let life_score = self.compute_life_score().await?;

        Ok(serde_json::json!({
            "prompt": prompt,
            "response": format!(
                "[HERMES // TELEMETRY] Composite Life Score is {:.1}/100 (Focus {:.0}, Routines {:.0}, Goals {:.0}, Learning {:.0}, Wealth {:.0}).",
                life_score.composite_score,
                life_score.pillars.focus,
                life_score.pillars.routines,
                life_score.pillars.goals,
                life_score.pillars.learning,
                life_score.pillars.wealth,
            ),
            "gateway_mode": "offline_mock",
            "generated_at": Utc::now(),
        }))
    }
}

fn sanitize_score(val: f64) -> f64 {
    if val.is_nan() || !val.is_finite() {
        return 50.0;
    }
    ((val.clamp(0.0, 100.0)) * 10.0).round() / 10.0
}

fn extract_json_pointer(root: &serde_json::Value, path: &str) -> Option<serde_json::Value> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "/" || trimmed == "$" {
        return Some(root.clone());
    }
    if trimmed.starts_with('/') {
        return root.pointer(trimmed).cloned();
    }
    let normalized = format!(
        "/{}",
        trimmed
            .trim_start_matches("$.")
            .trim_start_matches('$')
            .replace('.', "/")
    );
    root.pointer(&normalized).cloned()
}
