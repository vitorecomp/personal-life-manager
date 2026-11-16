//! Module 09 — Yearly Goals, Quarterly OKR Rollups & `REF-03` `90°` Blueprint Engine (`F15`).

use std::collections::HashSet;

use chrono::{Datelike, NaiveDate, Utc};
use hermes_domain::error::ApiError;
use hermes_domain::events::SystemEvent;
use hermes_domain::goals::{
    BlueprintCorridor, BlueprintLayoutResponse, BlueprintNode, BlueprintPillarZone, BlueprintPos,
    BlueprintQuarterMatrixCell, BlueprintTitleBlock, CreateGoalCheckinRequest, CreateGoalRequest,
    CreateKeyResultRequest, CycleStatus, Goal, GoalCheckin, GoalKeyResult, GoalPillar, GoalStatus,
    GoalWithDetails, KrMetricType, OkrQuarter, PaceHealthStatus, UpdateGoalBlueprintPosRequest,
    UpdateGoalRequest, UpdateKeyResultRequest, UpdateYearlyCycleRequest, UpsertYearlyCycleRequest,
    YearlyCycle,
};
use hermes_domain::id::new_uuid_v7;
use rust_decimal::Decimal;
use sqlx::types::Json;
use uuid::Uuid;

use crate::service::LifeOpsService;

pub fn compute_linear_kr_progress_pct(
    start: Decimal,
    current: Decimal,
    target: Decimal,
) -> Decimal {
    if target == start {
        if current >= target {
            Decimal::from(100)
        } else {
            Decimal::ZERO
        }
    } else {
        (((current - start) / (target - start)) * Decimal::from(100))
            .clamp(Decimal::ZERO, Decimal::from(100))
            .round_dp(2)
    }
}

impl LifeOpsService {
    // =========================================================================
    // 1. Yearly Cycles CRUD
    // =========================================================================

    pub async fn list_yearly_cycles(&self) -> Result<Vec<YearlyCycle>, ApiError> {
        let cycles = sqlx::query_as::<_, YearlyCycle>(
            "SELECT * FROM yearly_cycles ORDER BY year DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(cycles)
    }

    pub async fn get_yearly_cycle(&self, year: i32) -> Result<YearlyCycle, ApiError> {
        validate_cycle_year(year)?;
        let cycle = sqlx::query_as::<_, YearlyCycle>(
            "SELECT * FROM yearly_cycles WHERE year = $1",
        )
        .bind(year)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| ApiError::not_found(format!("Yearly cycle {year} not found")))?;
        Ok(cycle)
    }

    pub async fn create_yearly_cycle(
        &self,
        req: UpsertYearlyCycleRequest,
    ) -> Result<YearlyCycle, ApiError> {
        let year = if req.year == 0 {
            Utc::now().date_naive().year()
        } else {
            req.year
        };
        self.upsert_yearly_cycle(year, req).await
    }

    pub async fn upsert_yearly_cycle(
        &self,
        year: i32,
        req: UpsertYearlyCycleRequest,
    ) -> Result<YearlyCycle, ApiError> {
        validate_cycle_year(year)?;
        let theme = req.theme.trim();
        if theme.is_empty() {
            return Err(ApiError::bad_request("Yearly cycle theme must not be empty"));
        }
        if req.focus_cap_limit < 1 {
            return Err(ApiError::bad_request(
                "focus_cap_limit must be at least 1",
            ));
        }

        let cycle = sqlx::query_as::<_, YearlyCycle>(
            r#"
            INSERT INTO yearly_cycles (
                year, theme, vision_md, anti_goals_md, focus_cap_limit, status
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (year) DO UPDATE SET
                theme = EXCLUDED.theme,
                vision_md = EXCLUDED.vision_md,
                anti_goals_md = EXCLUDED.anti_goals_md,
                focus_cap_limit = EXCLUDED.focus_cap_limit,
                status = EXCLUDED.status,
                updated_at = NOW()
            RETURNING *
            "#,
        )
        .bind(year)
        .bind(theme)
        .bind(&req.vision_md)
        .bind(&req.anti_goals_md)
        .bind(req.focus_cap_limit)
        .bind(req.status)
        .fetch_one(&self.pool)
        .await?;

        Ok(cycle)
    }

    pub async fn update_yearly_cycle(
        &self,
        year: i32,
        req: UpdateYearlyCycleRequest,
    ) -> Result<YearlyCycle, ApiError> {
        let existing = self.get_yearly_cycle(year).await?;
        let theme = req
            .theme
            .map(|t| t.trim().to_string())
            .unwrap_or(existing.theme);
        if theme.is_empty() {
            return Err(ApiError::bad_request("Yearly cycle theme must not be empty"));
        }
        let focus_cap_limit = req.focus_cap_limit.unwrap_or(existing.focus_cap_limit);
        if focus_cap_limit < 1 {
            return Err(ApiError::bad_request(
                "focus_cap_limit must be at least 1",
            ));
        }
        let vision_md = req.vision_md.unwrap_or(existing.vision_md);
        let anti_goals_md = req.anti_goals_md.unwrap_or(existing.anti_goals_md);
        let status = req.status.unwrap_or(existing.status);

        let cycle = sqlx::query_as::<_, YearlyCycle>(
            r#"
            UPDATE yearly_cycles
            SET theme = $2,
                vision_md = $3,
                anti_goals_md = $4,
                focus_cap_limit = $5,
                status = $6,
                updated_at = NOW()
            WHERE year = $1
            RETURNING *
            "#,
        )
        .bind(year)
        .bind(theme)
        .bind(vision_md)
        .bind(anti_goals_md)
        .bind(focus_cap_limit)
        .bind(status)
        .fetch_one(&self.pool)
        .await?;

        Ok(cycle)
    }

    async fn ensure_yearly_cycle_exists(&self, year: i32) -> Result<YearlyCycle, ApiError> {
        validate_cycle_year(year)?;
        if let Some(cycle) = sqlx::query_as::<_, YearlyCycle>(
            "SELECT * FROM yearly_cycles WHERE year = $1",
        )
        .bind(year)
        .fetch_optional(&self.pool)
        .await?
        {
            return Ok(cycle);
        }

        let cycle = sqlx::query_as::<_, YearlyCycle>(
            r#"
            INSERT INTO yearly_cycles (year, theme, vision_md, anti_goals_md, focus_cap_limit, status)
            VALUES ($1, $2, '', '', 6, 'planning')
            ON CONFLICT (year) DO UPDATE SET updated_at = yearly_cycles.updated_at
            RETURNING *
            "#,
        )
        .bind(year)
        .bind(format!("YEAR // {year} ARCHITECTURE"))
        .fetch_one(&self.pool)
        .await?;
        Ok(cycle)
    }

    // =========================================================================
    // 2. Goals CRUD & Focus Cap Check
    // =========================================================================

    pub async fn list_goals(
        &self,
        year: Option<i32>,
        pillar: Option<GoalPillar>,
        status: Option<GoalStatus>,
    ) -> Result<Vec<GoalWithDetails>, ApiError> {
        let mut goals = sqlx::query_as::<_, Goal>(
            "SELECT * FROM goals ORDER BY year DESC, priority_rank ASC, code ASC, created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        if let Some(y) = year {
            goals.retain(|g| g.year == y);
        }
        if let Some(p) = pillar {
            goals.retain(|g| g.pillar == p);
        }
        if let Some(s) = status {
            goals.retain(|g| g.status == s);
        }

        let mut results = Vec::with_capacity(goals.len());
        for g in goals {
            let detail = self.build_goal_with_details(g, false).await?;
            results.push(detail);
        }
        Ok(results)
    }

    pub async fn get_goal(&self, id: Uuid) -> Result<GoalWithDetails, ApiError> {
        let goal = self.fetch_goal_row(id).await?;
        self.build_goal_with_details(goal, false).await
    }

    async fn fetch_goal_row(&self, id: Uuid) -> Result<Goal, ApiError> {
        sqlx::query_as::<_, Goal>("SELECT * FROM goals WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| ApiError::not_found(format!("Goal {id} not found")))
    }

    pub async fn create_goal(&self, req: CreateGoalRequest) -> Result<GoalWithDetails, ApiError> {
        let title = req.title.trim();
        if title.is_empty() {
            return Err(ApiError::bad_request("Goal title must not be empty"));
        }
        let confidence_score = req.confidence_score.unwrap_or(7);
        if !(1..=10).contains(&confidence_score) {
            return Err(ApiError::bad_request(
                "Goal confidence_score must be between 1 and 10",
            ));
        }

        let year = if req.year == 0 { 2026 } else { req.year };
        self.ensure_yearly_cycle_exists(year).await?;

        let code = match req.code.as_deref().map(str::trim) {
            Some(c) if !c.is_empty() => c.to_string(),
            _ => {
                let count: i64 =
                    sqlx::query_scalar("SELECT COUNT(*) FROM goals WHERE year = $1")
                        .bind(year)
                        .fetch_one(&self.pool)
                        .await?;
                format!("G{:02}", count + 1)
            }
        };

        let priority_rank = req.priority_rank.unwrap_or(1);
        let blueprint_pos_json = req.blueprint_pos.map(Json);

        let id = new_uuid_v7();
        let goal = sqlx::query_as::<_, Goal>(
            r#"
            INSERT INTO goals (
                id, year, pillar, code, title, why_motivation_md, status,
                priority_rank, target_date, progress_pct, confidence_score, blueprint_pos
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(year)
        .bind(req.pillar)
        .bind(code)
        .bind(title)
        .bind(&req.why_motivation_md)
        .bind(req.status)
        .bind(priority_rank)
        .bind(req.target_date)
        .bind(confidence_score)
        .bind(blueprint_pos_json)
        .fetch_one(&self.pool)
        .await?;

        self.build_goal_with_details(goal, true).await
    }

    pub async fn update_goal(
        &self,
        id: Uuid,
        req: UpdateGoalRequest,
    ) -> Result<GoalWithDetails, ApiError> {
        let existing = self.fetch_goal_row(id).await?;
        let title = req
            .title
            .map(|t| t.trim().to_string())
            .unwrap_or(existing.title);
        if title.is_empty() {
            return Err(ApiError::bad_request("Goal title must not be empty"));
        }
        let confidence_score = req.confidence_score.unwrap_or(existing.confidence_score);
        if !(1..=10).contains(&confidence_score) {
            return Err(ApiError::bad_request(
                "Goal confidence_score must be between 1 and 10",
            ));
        }

        let pillar = req.pillar.unwrap_or(existing.pillar);
        let code = req.code.unwrap_or(existing.code);
        let why_motivation_md = req.why_motivation_md.unwrap_or(existing.why_motivation_md);
        let status = req.status.unwrap_or(existing.status);
        let priority_rank = req.priority_rank.unwrap_or(existing.priority_rank);
        let target_date = req.target_date.or(existing.target_date);
        let progress_pct = req
            .progress_pct
            .map(|p| p.clamp(Decimal::ZERO, Decimal::from(100)))
            .unwrap_or(existing.progress_pct);
        let blueprint_pos_json = req.blueprint_pos.or(existing.blueprint_pos).map(Json);

        let updated = sqlx::query_as::<_, Goal>(
            r#"
            UPDATE goals
            SET pillar = $2,
                code = $3,
                title = $4,
                why_motivation_md = $5,
                status = $6,
                priority_rank = $7,
                target_date = $8,
                progress_pct = $9,
                confidence_score = $10,
                blueprint_pos = $11,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(pillar)
        .bind(code)
        .bind(title)
        .bind(why_motivation_md)
        .bind(status)
        .bind(priority_rank)
        .bind(target_date)
        .bind(progress_pct)
        .bind(confidence_score)
        .bind(blueprint_pos_json)
        .fetch_one(&self.pool)
        .await?;

        self.build_goal_with_details(updated, true).await
    }

    pub async fn update_goal_blueprint_pos(
        &self,
        id: Uuid,
        req: UpdateGoalBlueprintPosRequest,
    ) -> Result<GoalWithDetails, ApiError> {
        if !req.blueprint_pos.x.is_finite() || !req.blueprint_pos.y.is_finite() {
            return Err(ApiError::bad_request(
                "Blueprint coordinates x and y must be finite numbers",
            ));
        }
        let _existing = self.fetch_goal_row(id).await?;

        let updated = sqlx::query_as::<_, Goal>(
            r#"
            UPDATE goals
            SET blueprint_pos = $2,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(Json(req.blueprint_pos))
        .fetch_one(&self.pool)
        .await?;

        self.build_goal_with_details(updated, false).await
    }

    pub async fn delete_goal(&self, id: Uuid) -> Result<(), ApiError> {
        let res = sqlx::query("DELETE FROM goals WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(ApiError::not_found(format!("Goal {id} not found")));
        }
        Ok(())
    }

    // =========================================================================
    // 3. Quarterly Key Results CRUD & 7-Type Live SQL Rollup Engine
    // =========================================================================

    pub async fn create_key_result(
        &self,
        goal_id: Uuid,
        req: CreateKeyResultRequest,
    ) -> Result<GoalKeyResult, ApiError> {
        let _goal = self.fetch_goal_row(goal_id).await?;
        let title = req.title.trim();
        if title.is_empty() {
            return Err(ApiError::bad_request("Key result title must not be empty"));
        }
        let weight = req.weight.unwrap_or(Decimal::ONE);
        if weight < Decimal::ZERO {
            return Err(ApiError::bad_request(
                "Key result weight must be non-negative",
            ));
        }

        let code = match req.code.as_deref().map(str::trim) {
            Some(c) if !c.is_empty() => c.to_string(),
            _ => {
                let count: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM goal_key_results WHERE goal_id = $1",
                )
                .bind(goal_id)
                .fetch_one(&self.pool)
                .await?;
                format!("KR{}", count + 1)
            }
        };

        let milestones_json = if req.milestones_json.is_null() {
            serde_json::json!([])
        } else {
            req.milestones_json
        };
        let unit = if req.unit.trim().is_empty() {
            "%".to_string()
        } else {
            req.unit
        };
        let blueprint_pos_json = req.blueprint_pos.map(Json);

        let id = new_uuid_v7();
        sqlx::query_as::<_, GoalKeyResult>(
            r#"
            INSERT INTO goal_key_results (
                id, goal_id, quarter, code, title, metric_type,
                start_value, current_value, target_value, unit,
                milestones_json, linked_entity_id, weight, blueprint_pos
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(goal_id)
        .bind(req.quarter)
        .bind(code)
        .bind(title)
        .bind(req.metric_type)
        .bind(req.start_value)
        .bind(req.current_value)
        .bind(req.target_value)
        .bind(unit)
        .bind(milestones_json)
        .bind(req.linked_entity_id)
        .bind(weight)
        .bind(blueprint_pos_json)
        .fetch_one(&self.pool)
        .await?;

        let _ = self.recalculate_goal_rollups(goal_id).await?;
        let refreshed = self.fetch_key_result_row(id).await?;
        Ok(refreshed)
    }

    async fn fetch_key_result_row(&self, kr_id: Uuid) -> Result<GoalKeyResult, ApiError> {
        sqlx::query_as::<_, GoalKeyResult>("SELECT * FROM goal_key_results WHERE id = $1")
            .bind(kr_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| ApiError::not_found(format!("Key result {kr_id} not found")))
    }

    pub async fn update_key_result(
        &self,
        kr_id: Uuid,
        req: UpdateKeyResultRequest,
    ) -> Result<GoalKeyResult, ApiError> {
        let existing = self.fetch_key_result_row(kr_id).await?;
        let title = req
            .title
            .map(|t| t.trim().to_string())
            .unwrap_or(existing.title);
        if title.is_empty() {
            return Err(ApiError::bad_request("Key result title must not be empty"));
        }
        let weight = req.weight.unwrap_or(existing.weight);
        if weight < Decimal::ZERO {
            return Err(ApiError::bad_request(
                "Key result weight must be non-negative",
            ));
        }

        let quarter = req.quarter.unwrap_or(existing.quarter);
        let code = req.code.unwrap_or(existing.code);
        let metric_type = req.metric_type.unwrap_or(existing.metric_type);
        let start_value = req.start_value.unwrap_or(existing.start_value);
        let current_value = req.current_value.unwrap_or(existing.current_value);
        let target_value = req.target_value.unwrap_or(existing.target_value);
        let unit = req.unit.unwrap_or(existing.unit);
        let milestones_json = req.milestones_json.unwrap_or(existing.milestones_json);
        let linked_entity_id = req.linked_entity_id.or(existing.linked_entity_id);
        let blueprint_pos_json = req.blueprint_pos.or(existing.blueprint_pos).map(Json);

        sqlx::query(
            r#"
            UPDATE goal_key_results
            SET quarter = $2,
                code = $3,
                title = $4,
                metric_type = $5,
                start_value = $6,
                current_value = $7,
                target_value = $8,
                unit = $9,
                milestones_json = $10,
                linked_entity_id = $11,
                weight = $12,
                blueprint_pos = $13,
                updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(kr_id)
        .bind(quarter)
        .bind(code)
        .bind(title)
        .bind(metric_type)
        .bind(start_value)
        .bind(current_value)
        .bind(target_value)
        .bind(unit)
        .bind(milestones_json)
        .bind(linked_entity_id)
        .bind(weight)
        .bind(blueprint_pos_json)
        .execute(&self.pool)
        .await?;

        let _ = self.recalculate_goal_rollups(existing.goal_id).await?;
        self.fetch_key_result_row(kr_id).await
    }

    pub async fn delete_key_result(&self, kr_id: Uuid) -> Result<(), ApiError> {
        let existing = self.fetch_key_result_row(kr_id).await?;
        sqlx::query("DELETE FROM goal_key_results WHERE id = $1")
            .bind(kr_id)
            .execute(&self.pool)
            .await?;

        let _ = self.recalculate_goal_rollups(existing.goal_id).await?;
        Ok(())
    }

    pub async fn recalculate_goal_rollups(&self, goal_id: Uuid) -> Result<GoalWithDetails, ApiError> {
        let goal = self.fetch_goal_row(goal_id).await?;
        self.build_goal_with_details(goal, true).await
    }

    async fn evaluate_kr_progress(&self, kr: &mut GoalKeyResult) -> Result<Decimal, ApiError> {
        let (new_current, pct) = match kr.metric_type {
            KrMetricType::Numeric => {
                let pct =
                    compute_linear_kr_progress_pct(kr.start_value, kr.current_value, kr.target_value);
                (kr.current_value, pct)
            }
            KrMetricType::Binary => {
                let done = if kr.target_value > Decimal::ZERO {
                    kr.current_value >= kr.target_value
                } else {
                    kr.current_value >= Decimal::ONE
                };
                let pct = if done {
                    Decimal::from(100)
                } else {
                    Decimal::ZERO
                };
                (kr.current_value, pct)
            }
            KrMetricType::Milestones => {
                if let Some(arr) = kr.milestones_json.as_array()
                    && !arr.is_empty()
                {
                    let mut total_w = 0.0_f64;
                    let mut done_w = 0.0_f64;
                    let mut done_count = 0_i64;
                    for item in arr {
                        let w = item
                            .get("weight")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(1.0)
                            .max(0.0);
                        let done = item
                            .get("done")
                            .and_then(|v| v.as_bool())
                            .or_else(|| item.get("completed").and_then(|v| v.as_bool()))
                            .unwrap_or(false);
                        total_w += w;
                        if done {
                            done_w += w;
                            done_count += 1;
                        }
                    }
                    let pct_f = if total_w > 0.0 {
                        ((done_w / total_w) * 100.0).clamp(0.0, 100.0)
                    } else {
                        0.0
                    };
                    let pct = Decimal::from_f64_retain(pct_f)
                        .unwrap_or(Decimal::ZERO)
                        .round_dp(2);
                    let new_cur = if kr.target_value == Decimal::from(100) {
                        pct
                    } else {
                        Decimal::from(done_count)
                    };
                    (new_cur, pct)
                } else {
                    let pct = compute_linear_kr_progress_pct(
                        kr.start_value,
                        kr.current_value,
                        kr.target_value,
                    );
                    (kr.current_value, pct)
                }
            }
            KrMetricType::LinkedCourse => {
                if let Some(course_id) = kr.linked_entity_id {
                    let lesson_counts: (i64, i64) = sqlx::query_as(
                        r#"
                        SELECT
                            COUNT(*)::bigint AS total,
                            COUNT(*) FILTER (WHERE status IN ('distilled', 'completed'))::bigint AS done
                        FROM course_lessons
                        WHERE course_id = $1
                        "#,
                    )
                    .bind(course_id)
                    .fetch_one(&self.pool)
                    .await?;

                    if lesson_counts.0 > 0 {
                        let pct = ((Decimal::from(lesson_counts.1)
                            / Decimal::from(lesson_counts.0))
                            * Decimal::from(100))
                        .clamp(Decimal::ZERO, Decimal::from(100))
                        .round_dp(2);
                        let new_cur = if kr.target_value == Decimal::from(100) {
                            pct
                        } else {
                            Decimal::from(lesson_counts.1)
                        };
                        (new_cur, pct)
                    } else if let Some((progress_pct, status)) = sqlx::query_as::<_, (Decimal, String)>(
                        "SELECT progress_pct, status FROM courses WHERE id = $1",
                    )
                    .bind(course_id)
                    .fetch_optional(&self.pool)
                    .await?
                    {
                        let pct = if status == "completed" {
                            Decimal::from(100)
                        } else {
                            progress_pct.clamp(Decimal::ZERO, Decimal::from(100))
                        };
                        (pct, pct)
                    } else {
                        let pct = compute_linear_kr_progress_pct(
                            kr.start_value,
                            kr.current_value,
                            kr.target_value,
                        );
                        (kr.current_value, pct)
                    }
                } else {
                    let pct = compute_linear_kr_progress_pct(
                        kr.start_value,
                        kr.current_value,
                        kr.target_value,
                    );
                    (kr.current_value, pct)
                }
            }
            KrMetricType::LinkedFinance => {
                let fx_usd_brl: Decimal = sqlx::query_scalar(
                    "SELECT rate FROM fx_rates_cache WHERE pair = 'USD_BRL'",
                )
                .fetch_optional(&self.pool)
                .await?
                .unwrap_or_else(|| Decimal::from(5));

                if let Some(asset_id) = kr.linked_entity_id {
                    if let Some((qty, price_cents)) = sqlx::query_as::<_, (Decimal, i64)>(
                        "SELECT quantity, current_price_cents FROM portfolio_assets WHERE id = $1",
                    )
                    .bind(asset_id)
                    .fetch_optional(&self.pool)
                    .await?
                    {
                        let val_cents = (qty * Decimal::from(price_cents)).round();
                        let pct = compute_linear_kr_progress_pct(
                            kr.start_value,
                            val_cents,
                            kr.target_value,
                        );
                        (val_cents, pct)
                    } else {
                        let pct = compute_linear_kr_progress_pct(
                            kr.start_value,
                            kr.current_value,
                            kr.target_value,
                        );
                        (kr.current_value, pct)
                    }
                } else {
                    let total_brl_cents: Decimal = sqlx::query_scalar(
                        r#"
                        SELECT COALESCE(SUM(
                            CASE
                                WHEN currency = 'USD' THEN quantity * current_price_cents * $1
                                ELSE quantity * current_price_cents
                            END
                        ), 0)
                        FROM portfolio_assets
                        WHERE in_portfolio = TRUE
                        "#,
                    )
                    .bind(fx_usd_brl)
                    .fetch_one(&self.pool)
                    .await?;
                    let rounded = total_brl_cents.round();
                    let pct =
                        compute_linear_kr_progress_pct(kr.start_value, rounded, kr.target_value);
                    (rounded, pct)
                }
            }
            KrMetricType::LinkedHabit => {
                if let Some(item_id) = kr.linked_entity_id {
                    let counts: (i64, i64) = sqlx::query_as(
                        r#"
                        SELECT
                            COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed_count,
                            COUNT(*)::bigint AS total_count
                        FROM routine_logs
                        WHERE routine_item_id = $1 AND deleted_at IS NULL
                        "#,
                    )
                    .bind(item_id)
                    .fetch_one(&self.pool)
                    .await?;

                    if kr.unit.trim() == "%" && kr.target_value == Decimal::from(100) {
                        let pct = if counts.1 > 0 {
                            ((Decimal::from(counts.0) / Decimal::from(counts.1))
                                * Decimal::from(100))
                            .clamp(Decimal::ZERO, Decimal::from(100))
                            .round_dp(2)
                        } else {
                            Decimal::ZERO
                        };
                        (pct, pct)
                    } else {
                        let cur = Decimal::from(counts.0);
                        let pct =
                            compute_linear_kr_progress_pct(kr.start_value, cur, kr.target_value);
                        (cur, pct)
                    }
                } else {
                    let pct = compute_linear_kr_progress_pct(
                        kr.start_value,
                        kr.current_value,
                        kr.target_value,
                    );
                    (kr.current_value, pct)
                }
            }
            KrMetricType::LinkedProject => {
                if let Some(project_id) = kr.linked_entity_id {
                    let counts: (i64, i64) = sqlx::query_as(
                        r#"
                        SELECT
                            COUNT(*) FILTER (WHERE status != 'canceled')::bigint AS total_tasks,
                            COUNT(*) FILTER (WHERE status = 'done')::bigint AS done_tasks
                        FROM tasks
                        WHERE project_id = $1 AND deleted_at IS NULL
                        "#,
                    )
                    .bind(project_id)
                    .fetch_one(&self.pool)
                    .await?;

                    if counts.0 > 0 {
                        let pct = ((Decimal::from(counts.1) / Decimal::from(counts.0))
                            * Decimal::from(100))
                        .clamp(Decimal::ZERO, Decimal::from(100))
                        .round_dp(2);
                        let cur = if kr.target_value == Decimal::from(100) {
                            pct
                        } else {
                            Decimal::from(counts.1)
                        };
                        (cur, pct)
                    } else {
                        (Decimal::ZERO, Decimal::ZERO)
                    }
                } else {
                    let pct = compute_linear_kr_progress_pct(
                        kr.start_value,
                        kr.current_value,
                        kr.target_value,
                    );
                    (kr.current_value, pct)
                }
            }
        };

        if new_current != kr.current_value {
            sqlx::query(
                "UPDATE goal_key_results SET current_value = $2, updated_at = NOW() WHERE id = $1",
            )
            .bind(kr.id)
            .bind(new_current)
            .execute(&self.pool)
            .await?;
            kr.current_value = new_current;
        }

        Ok(pct)
    }

    async fn build_goal_with_details(
        &self,
        mut goal: Goal,
        emit_risk_event: bool,
    ) -> Result<GoalWithDetails, ApiError> {
        let mut key_results = sqlx::query_as::<_, GoalKeyResult>(
            "SELECT * FROM goal_key_results WHERE goal_id = $1 ORDER BY quarter ASC, code ASC, created_at ASC",
        )
        .bind(goal.id)
        .fetch_all(&self.pool)
        .await?;

        if !key_results.is_empty() {
            let mut weighted_sum = Decimal::ZERO;
            let mut total_weight = Decimal::ZERO;
            for kr in &mut key_results {
                let pct = self.evaluate_kr_progress(kr).await?;
                let w = if kr.weight > Decimal::ZERO {
                    kr.weight
                } else {
                    Decimal::ONE
                };
                weighted_sum += pct * w;
                total_weight += w;
            }
            let new_progress = if total_weight > Decimal::ZERO {
                (weighted_sum / total_weight)
                    .clamp(Decimal::ZERO, Decimal::from(100))
                    .round_dp(2)
            } else {
                Decimal::ZERO
            };

            if new_progress != goal.progress_pct {
                goal = sqlx::query_as::<_, Goal>(
                    "UPDATE goals SET progress_pct = $2, updated_at = NOW() WHERE id = $1 RETURNING *",
                )
                .bind(goal.id)
                .bind(new_progress)
                .fetch_one(&self.pool)
                .await?;
            }
        }

        let cycle = self.ensure_yearly_cycle_exists(goal.year).await?;
        let active_goals_in_cycle: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM goals
            WHERE year = $1
              AND status IN ('not_started', 'in_progress')
            "#,
        )
        .bind(goal.year)
        .fetch_one(&self.pool)
        .await?;
        let active_goals_i32 = active_goals_in_cycle as i32;
        let focus_cap_exceeded = active_goals_i32 > cycle.focus_cap_limit;
        let focus_cap_warning = if focus_cap_exceeded {
            Some(format!(
                "Active goals ({active_goals_i32}) exceed cycle {} focus cap ({})",
                goal.year, cycle.focus_cap_limit
            ))
        } else {
            None
        };

        let elapsed_pct = compute_goal_elapsed_pct(&goal, Utc::now().date_naive());
        let (invested_seconds, invested_seconds_14d): (i64, i64) = sqlx::query_as(
            r#"
            SELECT
                COALESCE(SUM(duration_seconds), 0)::bigint AS total_sec,
                COALESCE(SUM(duration_seconds) FILTER (WHERE started_at >= NOW() - INTERVAL '14 days'), 0)::bigint AS recent_sec
            FROM time_sessions
            WHERE deleted_at IS NULL
              AND (
                  task_id IN (
                      SELECT id FROM tasks
                      WHERE deleted_at IS NULL
                        AND (
                            goal_id = $1
                            OR project_id IN (SELECT id FROM projects WHERE goal_id = $1 AND deleted_at IS NULL)
                        )
                  )
                  OR course_id IN (SELECT id FROM courses WHERE goal_id = $1)
              )
            "#,
        )
        .bind(goal.id)
        .fetch_one(&self.pool)
        .await?;

        let invested_hours = ((invested_seconds as f64 / 3600.0) * 100.0).round() / 100.0;
        let drift = elapsed_pct - goal.progress_pct;
        let pace_status = if goal.status == GoalStatus::Completed
            || goal.progress_pct >= Decimal::from(100)
        {
            PaceHealthStatus::OnTrack
        } else if drift > Decimal::from(25) {
            PaceHealthStatus::OffTrack
        } else if drift > Decimal::from(10)
            || (goal.status == GoalStatus::InProgress
                && elapsed_pct > Decimal::from(10)
                && invested_seconds_14d == 0
                && goal.progress_pct == Decimal::ZERO)
        {
            PaceHealthStatus::AtRisk
        } else {
            PaceHealthStatus::OnTrack
        };

        if emit_risk_event
            && matches!(
                pace_status,
                PaceHealthStatus::AtRisk | PaceHealthStatus::OffTrack
            )
        {
            let pace_label = match pace_status {
                PaceHealthStatus::OnTrack => "on_track",
                PaceHealthStatus::AtRisk => "at_risk",
                PaceHealthStatus::OffTrack => "off_track",
            };
            self.emit_event(SystemEvent::GoalPaceAtRisk {
                goal_id: goal.id,
                title: goal.title.clone(),
                pace_status: pace_label.to_string(),
                progress_pct: goal.progress_pct,
                elapsed_pct,
                timestamp: Utc::now(),
            });
        }

        Ok(GoalWithDetails {
            goal,
            pace_status,
            elapsed_pct,
            invested_seconds,
            invested_hours,
            focus_cap_limit: cycle.focus_cap_limit,
            active_goals_in_cycle: active_goals_i32,
            focus_cap_exceeded,
            focus_cap_warning,
            key_results,
        })
    }

    // =========================================================================
    // 4. Goal Check-Ins & Pace Drift
    // =========================================================================

    pub async fn list_goal_checkins(&self, goal_id: Uuid) -> Result<Vec<GoalCheckin>, ApiError> {
        let _goal = self.fetch_goal_row(goal_id).await?;
        let checkins = sqlx::query_as::<_, GoalCheckin>(
            "SELECT * FROM goal_checkins WHERE goal_id = $1 ORDER BY checkin_date DESC, created_at DESC",
        )
        .bind(goal_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(checkins)
    }

    pub async fn create_goal_checkin(
        &self,
        goal_id: Uuid,
        req: CreateGoalCheckinRequest,
    ) -> Result<GoalCheckin, ApiError> {
        let _goal = self.fetch_goal_row(goal_id).await?;
        if !(1..=10).contains(&req.confidence_score) {
            return Err(ApiError::bad_request(
                "confidence_score must be between 1 and 10",
            ));
        }

        if let (Some(kr_id), Some(kr_val)) = (req.kr_id, req.kr_current_value) {
            sqlx::query(
                "UPDATE goal_key_results SET current_value = $2, updated_at = NOW() WHERE id = $1 AND goal_id = $3",
            )
            .bind(kr_id)
            .bind(kr_val)
            .bind(goal_id)
            .execute(&self.pool)
            .await?;
        }

        sqlx::query(
            "UPDATE goals SET confidence_score = $2, updated_at = NOW() WHERE id = $1",
        )
        .bind(goal_id)
        .bind(req.confidence_score)
        .execute(&self.pool)
        .await?;

        let detail = self.recalculate_goal_rollups(goal_id).await?;
        let progress_snapshot = req
            .progress_snapshot
            .map(|p| p.clamp(Decimal::ZERO, Decimal::from(100)))
            .unwrap_or(detail.goal.progress_pct);

        if req.progress_snapshot.is_some() && detail.key_results.is_empty() {
            sqlx::query(
                "UPDATE goals SET progress_pct = $2, updated_at = NOW() WHERE id = $1",
            )
            .bind(goal_id)
            .bind(progress_snapshot)
            .execute(&self.pool)
            .await?;
        }

        let checkin_date = req
            .checkin_date
            .unwrap_or_else(|| Utc::now().date_naive());
        let id = new_uuid_v7();
        let checkin = sqlx::query_as::<_, GoalCheckin>(
            r#"
            INSERT INTO goal_checkins (
                id, goal_id, checkin_date, progress_snapshot,
                confidence_score, wins_md, blockers_md, next_steps_md
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(goal_id)
        .bind(checkin_date)
        .bind(progress_snapshot)
        .bind(req.confidence_score)
        .bind(&req.wins_md)
        .bind(&req.blockers_md)
        .bind(&req.next_steps_md)
        .fetch_one(&self.pool)
        .await?;

        Ok(checkin)
    }

    pub async fn get_goals_pace_drift(
        &self,
        year: Option<i32>,
    ) -> Result<Vec<GoalWithDetails>, ApiError> {
        let goals = self.list_goals(year, None, None).await?;
        for g in &goals {
            if matches!(
                g.pace_status,
                PaceHealthStatus::AtRisk | PaceHealthStatus::OffTrack
            ) {
                let pace_label = match g.pace_status {
                    PaceHealthStatus::OnTrack => "on_track",
                    PaceHealthStatus::AtRisk => "at_risk",
                    PaceHealthStatus::OffTrack => "off_track",
                };
                self.emit_event(SystemEvent::GoalPaceAtRisk {
                    goal_id: g.goal.id,
                    title: g.goal.title.clone(),
                    pace_status: pace_label.to_string(),
                    progress_pct: g.goal.progress_pct,
                    elapsed_pct: g.elapsed_pct,
                    timestamp: Utc::now(),
                });
            }
        }
        Ok(goals)
    }

    // =========================================================================
    // 5. REF-03 Collision-Free 90° Manhattan Orthogonal Blueprint Router
    // =========================================================================

    pub async fn get_goal_blueprint(&self, year: i32) -> Result<BlueprintLayoutResponse, ApiError> {
        validate_cycle_year(year)?;
        let cycle = match sqlx::query_as::<_, YearlyCycle>(
            "SELECT * FROM yearly_cycles WHERE year = $1",
        )
        .bind(year)
        .fetch_optional(&self.pool)
        .await?
        {
            Some(c) => c,
            None => YearlyCycle {
                year,
                theme: format!("YEAR // {year} ARCHITECTURE"),
                vision_md: String::new(),
                anti_goals_md: String::new(),
                focus_cap_limit: 6,
                status: CycleStatus::Planning,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
        };

        let goals = self.list_goals(Some(year), None, None).await?;
        let today = Utc::now().date_naive();
        let days_total = if is_leap_year(year) { 366 } else { 365 };
        let days_elapsed = if year < today.year() {
            days_total
        } else if year > today.year() {
            0
        } else {
            (today.ordinal() as i32).clamp(0, days_total)
        };

        let title_block = BlueprintTitleBlock {
            year,
            theme: cycle.theme.clone(),
            status: cycle.status,
            days_elapsed,
            days_total,
            revision: format!("REV // {year}.{:03}", days_elapsed.max(1)),
        };

        let mut nodes = Vec::new();
        let mut corridors = Vec::new();
        let mut occupied_cells: HashSet<(i32, i32)> = HashSet::new();

        // Cycle Root Node at (80, 360)
        let cycle_root_id =
            Uuid::from_u128(0x0190_0000_0000_7000_8000_0000_0000_0000 + year as u128);
        let avg_progress = if !goals.is_empty() {
            let sum: Decimal = goals.iter().map(|g| g.goal.progress_pct).sum();
            (sum / Decimal::from(goals.len() as i64)).round_dp(2)
        } else {
            Decimal::ZERO
        };
        nodes.push(BlueprintNode {
            id: cycle_root_id,
            node_kind: "cycle_root".to_string(),
            code: format!("CYCLE // {year}"),
            title: cycle.theme.clone(),
            quarter: Some(OkrQuarter::Annual),
            pillar: GoalPillar::Systems,
            status: format!("{:?}", cycle.status).to_ascii_lowercase(),
            x: 80.0,
            y: 360.0,
            width: 200.0,
            height: 80.0,
            progress_pct: avg_progress,
            is_north_star_beacon: true,
            pinned: true,
        });
        occupied_cells.insert((80 / 40, 360 / 40));

        // Build Pillar Zones & Goal / KR Nodes
        let mut pillar_zones = Vec::new();
        let mut quarter_matrix = Vec::new();
        let quarters = [
            OkrQuarter::Q1,
            OkrQuarter::Q2,
            OkrQuarter::Q3,
            OkrQuarter::Q4,
        ];

        for (g_idx, g_detail) in goals.iter().enumerate() {
            let base_y = 120.0 + (g_idx as f64) * 200.0;
            let (gx, gy, g_pinned) = extract_or_assign_pos(
                g_detail.goal.blueprint_pos,
                380.0,
                base_y,
                &mut occupied_cells,
            );

            nodes.push(BlueprintNode {
                id: g_detail.goal.id,
                node_kind: "goal".to_string(),
                code: g_detail.goal.code.clone(),
                title: g_detail.goal.title.clone(),
                quarter: Some(OkrQuarter::Annual),
                pillar: g_detail.goal.pillar,
                status: format!("{:?}", g_detail.goal.status).to_ascii_lowercase(),
                x: gx,
                y: gy,
                width: 220.0,
                height: 84.0,
                progress_pct: g_detail.goal.progress_pct,
                is_north_star_beacon: g_detail.goal.priority_rank <= 2,
                pinned: g_pinned,
            });

            pillar_zones.push(BlueprintPillarZone {
                pillar: g_detail.goal.pillar,
                label: format!("PILLAR // {:?}", g_detail.goal.pillar).to_ascii_uppercase(),
                x: 340.0,
                y: gy - 24.0,
                width: 980.0,
                height: 160.0,
            });

            // Route 90° corridor from cycle_root -> goal
            let root_corridor = build_orthogonal_corridor(
                cycle_root_id,
                g_detail.goal.id,
                (80.0 + 200.0, 360.0 + 40.0),
                (gx, gy + 42.0),
                (g_idx as i32) * 16,
                "solid",
            );
            corridors.push(root_corridor);

            // Key Result Nodes
            for (kr_idx, kr) in g_detail.key_results.iter().enumerate() {
                let default_kr_x = match kr.quarter {
                    OkrQuarter::Q1 => 700.0,
                    OkrQuarter::Q2 => 920.0,
                    OkrQuarter::Q3 => 1140.0,
                    OkrQuarter::Q4 => 1360.0,
                    OkrQuarter::Annual => 700.0 + (kr_idx as f64) * 220.0,
                };
                let default_kr_y = gy + (kr_idx as f64) * 96.0;
                let (kx, ky, k_pinned) = extract_or_assign_pos(
                    kr.blueprint_pos,
                    default_kr_x,
                    default_kr_y,
                    &mut occupied_cells,
                );

                let kr_pct = kr.computed_progress_pct();
                nodes.push(BlueprintNode {
                    id: kr.id,
                    node_kind: "key_result".to_string(),
                    code: kr.code.clone(),
                    title: kr.title.clone(),
                    quarter: Some(kr.quarter),
                    pillar: g_detail.goal.pillar,
                    status: if kr_pct >= Decimal::from(100) {
                        "completed".to_string()
                    } else {
                        "in_progress".to_string()
                    },
                    x: kx,
                    y: ky,
                    width: 190.0,
                    height: 68.0,
                    progress_pct: kr_pct,
                    is_north_star_beacon: kr_pct >= Decimal::from(100),
                    pinned: k_pinned,
                });

                let kr_style = if matches!(
                    kr.metric_type,
                    KrMetricType::LinkedCourse
                        | KrMetricType::LinkedFinance
                        | KrMetricType::LinkedHabit
                        | KrMetricType::LinkedProject
                ) {
                    "dashed"
                } else {
                    "solid"
                };
                let kr_corridor = build_orthogonal_corridor(
                    g_detail.goal.id,
                    kr.id,
                    (gx + 220.0, gy + 42.0),
                    (kx, ky + 34.0),
                    (kr_idx as i32) * 12,
                    kr_style,
                );
                corridors.push(kr_corridor);
            }

            for q in quarters {
                let deliverables: Vec<String> = g_detail
                    .key_results
                    .iter()
                    .filter(|kr| kr.quarter == q || kr.quarter == OkrQuarter::Annual)
                    .map(|kr| format!("{}: {}", kr.code, kr.title))
                    .collect();
                if !deliverables.is_empty() {
                    quarter_matrix.push(BlueprintQuarterMatrixCell {
                        quarter: q,
                        pillar: g_detail.goal.pillar,
                        deliverables,
                    });
                }
            }
        }

        let strategist_notes_md = if !cycle.vision_md.trim().is_empty() {
            cycle.vision_md.clone()
        } else {
            format!(
                "# {} — Strategic Schematic\n- Active Goals: {}\n- Focus Cap: {}",
                cycle.theme,
                goals.len(),
                cycle.focus_cap_limit
            )
        };

        Ok(BlueprintLayoutResponse {
            year,
            cycle,
            title_block,
            nodes,
            corridors,
            quarter_matrix,
            pillar_zones,
            strategist_notes_md,
        })
    }
}

fn validate_cycle_year(year: i32) -> Result<(), ApiError> {
    if !(2000..=2100).contains(&year) {
        return Err(ApiError::bad_request(
            "Cycle year must be between 2000 and 2100",
        ));
    }
    Ok(())
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn compute_goal_elapsed_pct(goal: &Goal, today: NaiveDate) -> Decimal {
    let start_of_year = NaiveDate::from_ymd_opt(goal.year, 1, 1).unwrap_or(today);
    if let Some(target_date) = goal.target_date {
        if today <= start_of_year {
            return Decimal::ZERO;
        }
        if today >= target_date {
            return Decimal::from(100);
        }
        let total_days = (target_date - start_of_year).num_days().max(1);
        let elapsed_days = (today - start_of_year).num_days().clamp(0, total_days);
        return ((Decimal::from(elapsed_days) / Decimal::from(total_days)) * Decimal::from(100))
            .round_dp(2);
    }

    if goal.year < today.year() {
        Decimal::from(100)
    } else if goal.year > today.year() {
        Decimal::ZERO
    } else {
        let total_days = if is_leap_year(goal.year) { 366 } else { 365 };
        let elapsed_days = (today.ordinal() as i64).clamp(0, total_days);
        ((Decimal::from(elapsed_days) / Decimal::from(total_days)) * Decimal::from(100))
            .round_dp(2)
    }
}

fn extract_or_assign_pos(
    pos: Option<BlueprintPos>,
    default_x: f64,
    default_y: f64,
    occupied_cells: &mut HashSet<(i32, i32)>,
) -> (f64, f64, bool) {
    if let Some(p) = pos
        && p.x.is_finite()
        && p.y.is_finite()
    {
        let cell = ((p.x / 40.0).round() as i32, (p.y / 40.0).round() as i32);
        occupied_cells.insert(cell);
        return (p.x.round(), p.y.round(), true);
    }

    let x = default_x.round();
    let mut y = default_y.round();
    loop {
        let cell = ((x / 40.0).round() as i32, (y / 40.0).round() as i32);
        if occupied_cells.insert(cell) {
            break;
        }
        y += 96.0;
    }
    (x, y, false)
}

/// Builds a strictly 90° Manhattan orthogonal corridor (`x1 == x2 || y1 == y2` for every segment).
pub fn build_orthogonal_corridor(
    from_id: Uuid,
    to_id: Uuid,
    from_port: (f64, f64),
    to_port: (f64, f64),
    channel_offset: i32,
    style: &str,
) -> BlueprintCorridor {
    let x1 = from_port.0.round() as i32;
    let y1 = from_port.1.round() as i32;
    let x2 = to_port.0.round() as i32;
    let y2 = to_port.1.round() as i32;

    let raw_points: Vec<[i32; 2]> = if x1 == x2 || y1 == y2 {
        vec![[x1, y1], [x2, y2]]
    } else if x2 > x1 + 24 {
        // Forward 3-segment Z-route: (x1, y1) -> (mid_x, y1) -> (mid_x, y2) -> (x2, y2)
        let mid_x = ((x1 + x2) / 2 + channel_offset).clamp(x1 + 12, x2 - 12);
        vec![[x1, y1], [mid_x, y1], [mid_x, y2], [x2, y2]]
    } else {
        // Backwards / overlapping 5-segment U-corridor routing around bounding boxes
        let exit_x = x1 + 28;
        let det_y = if y2 >= y1 {
            y1.max(y2) + 64 + channel_offset.abs()
        } else {
            (y1.min(y2) - 64 - channel_offset.abs()).max(16)
        };
        let entry_x = (x2 - 28).max(16);
        vec![
            [x1, y1],
            [exit_x, y1],
            [exit_x, det_y],
            [entry_x, det_y],
            [entry_x, y2],
            [x2, y2],
        ]
    };

    let mut polyline: Vec<[i32; 2]> = Vec::with_capacity(raw_points.len());
    for pt in raw_points {
        if polyline.last().copied() != Some(pt) {
            polyline.push(pt);
        }
    }
    if polyline.len() == 1 {
        let p = polyline[0];
        polyline.push([p[0] + 1, p[1]]);
    }

    let waypoints = polyline
        .iter()
        .map(|&[px, py]| BlueprintPos {
            x: px as f64,
            y: py as f64,
        })
        .collect();

    BlueprintCorridor {
        from_id,
        to_id,
        style: style.to_string(),
        waypoints,
        polyline,
    }
}
