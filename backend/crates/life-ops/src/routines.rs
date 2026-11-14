//! Feature F14 — Module `08` Routines, Habit Streaks, Day Profiles, Ideal Week,
//! Weekly Review Aggregator & Atomic Obsidian Markdown Exporter.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use chrono::{Datelike, Duration, NaiveDate, Utc, Weekday};
use hermes_domain::{
    error::ApiError,
    events::SystemEvent,
    id::new_uuid_v7,
    routines::{
        CreateRoutineItemRequest, CreateRoutineRequest, DailyCheckin, DayProfile,
        HabitFrequencyType, HabitStreakSummary, IdealWeekBlock, IdealWeekCategoryVariance,
        IdealWeekResponse, LogRoutineItemRequest, Routine, RoutineAnalyticsResponse,
        RoutineHeatmapDay, RoutineItem, RoutineLog, RoutineLogStatus, RoutineStackAdherence,
        RoutineStackWithItems, UpdateRoutineItemRequest, UpdateRoutineRequest,
        UpsertDailyCheckinRequest, UpsertIdealWeekRequest, WeeklyReviewSummaryResponse,
    },
};
use sqlx::Row;
use uuid::Uuid;

use crate::service::LifeOpsService;

const ALLOWED_IDEAL_WEEK_CATEGORIES: [&str; 7] = [
    "deep_work",
    "learning",
    "health",
    "exercise",
    "admin",
    "maintenance",
    "rest",
];

impl LifeOpsService {
    // =========================================================================
    // 1. Routines & Habit Items CRUD + Day Profile Filtering
    // =========================================================================

    pub async fn list_routines(
        &self,
        day_profile: Option<DayProfile>,
        log_date: Option<NaiveDate>,
    ) -> Result<Vec<RoutineStackWithItems>, ApiError> {
        let target_date = log_date.unwrap_or_else(|| Utc::now().date_naive());

        let routines = sqlx::query_as::<_, Routine>(
            "SELECT id, name, time_slot, day_profile, target_start_time, sort_order, active, \
                    created_at, updated_at, deleted_at \
             FROM routines \
             WHERE deleted_at IS NULL \
             ORDER BY CASE time_slot \
                WHEN 'morning' THEN 1 \
                WHEN 'afternoon' THEN 2 \
                WHEN 'shutdown' THEN 3 \
                WHEN 'evening' THEN 4 \
                ELSE 5 \
             END ASC, sort_order ASC, created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let items = sqlx::query_as::<_, RoutineItem>(
            "SELECT id, routine_id, goal_id, title, tracking_type, target_value, unit, \
                    frequency_type, frequency_config, estimated_minutes, sort_order, \
                    created_at, updated_at, deleted_at \
             FROM routine_items \
             WHERE deleted_at IS NULL \
             ORDER BY sort_order ASC, created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let logs = sqlx::query_as::<_, RoutineLog>(
            "SELECT id, routine_item_id, log_date, status, numeric_value, completed_at, \
                    notes, created_at, updated_at, deleted_at \
             FROM routine_logs \
             WHERE deleted_at IS NULL AND log_date = $1",
        )
        .bind(target_date)
        .fetch_all(&self.pool)
        .await?;

        let mut items_by_routine: HashMap<Uuid, Vec<RoutineItem>> = HashMap::new();
        for item in items {
            items_by_routine
                .entry(item.routine_id)
                .or_default()
                .push(item);
        }

        let mut log_by_item: HashMap<Uuid, RoutineLog> = HashMap::new();
        for log in logs {
            log_by_item.insert(log.routine_item_id, log);
        }

        let mut out = Vec::new();
        for routine in routines {
            let mut r_items = items_by_routine.remove(&routine.id).unwrap_or_default();

            if let Some(profile) = day_profile {
                if profile != DayProfile::All {
                    let routine_matches =
                        routine.day_profile == profile || routine.day_profile == DayProfile::All;
                    if !routine_matches {
                        if profile == DayProfile::MinimumViable {
                            r_items.retain(is_item_mvd_included);
                            if r_items.is_empty() {
                                continue;
                            }
                        } else {
                            continue;
                        }
                    } else if profile == DayProfile::MinimumViable
                        && routine.day_profile == DayProfile::All
                        && r_items.iter().any(is_item_mvd_included)
                    {
                        r_items.retain(is_item_mvd_included);
                    }
                }
            }

            let mut today_logs = Vec::new();
            for it in &r_items {
                if let Some(lg) = log_by_item.get(&it.id) {
                    today_logs.push(lg.clone());
                }
            }

            out.push(RoutineStackWithItems {
                routine,
                items: r_items,
                today_logs,
            });
        }

        Ok(out)
    }

    pub async fn get_routine(
        &self,
        id: Uuid,
        log_date: Option<NaiveDate>,
    ) -> Result<RoutineStackWithItems, ApiError> {
        let target_date = log_date.unwrap_or_else(|| Utc::now().date_naive());
        let routine = sqlx::query_as::<_, Routine>(
            "SELECT id, name, time_slot, day_profile, target_start_time, sort_order, active, \
                    created_at, updated_at, deleted_at \
             FROM routines WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| ApiError::not_found(format!("Routine '{id}' not found")))?;

        let items = sqlx::query_as::<_, RoutineItem>(
            "SELECT id, routine_id, goal_id, title, tracking_type, target_value, unit, \
                    frequency_type, frequency_config, estimated_minutes, sort_order, \
                    created_at, updated_at, deleted_at \
             FROM routine_items \
             WHERE routine_id = $1 AND deleted_at IS NULL \
             ORDER BY sort_order ASC, created_at ASC",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;

        let item_ids: Vec<Uuid> = items.iter().map(|i| i.id).collect();
        let today_logs = if item_ids.is_empty() {
            Vec::new()
        } else {
            sqlx::query_as::<_, RoutineLog>(
                "SELECT id, routine_item_id, log_date, status, numeric_value, completed_at, \
                        notes, created_at, updated_at, deleted_at \
                 FROM routine_logs \
                 WHERE deleted_at IS NULL AND log_date = $1 AND routine_item_id = ANY($2)",
            )
            .bind(target_date)
            .bind(&item_ids)
            .fetch_all(&self.pool)
            .await?
        };

        Ok(RoutineStackWithItems {
            routine,
            items,
            today_logs,
        })
    }

    pub async fn create_routine(
        &self,
        req: CreateRoutineRequest,
    ) -> Result<RoutineStackWithItems, ApiError> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(ApiError::bad_request("Routine name must not be empty"));
        }
        let sort_order = match req.sort_order {
            Some(so) => so,
            None => {
                let max_order: i32 = sqlx::query_scalar(
                    "SELECT COALESCE(MAX(sort_order), 0) FROM routines WHERE deleted_at IS NULL",
                )
                .fetch_one(&self.pool)
                .await?;
                max_order + 1
            }
        };

        let id = new_uuid_v7();
        let routine = sqlx::query_as::<_, Routine>(
            "INSERT INTO routines (id, name, time_slot, day_profile, target_start_time, sort_order, active) \
             VALUES ($1, $2, $3, $4, $5, $6, $7) \
             RETURNING id, name, time_slot, day_profile, target_start_time, sort_order, active, \
                       created_at, updated_at, deleted_at",
        )
        .bind(id)
        .bind(name)
        .bind(req.time_slot)
        .bind(req.day_profile)
        .bind(req.target_start_time)
        .bind(sort_order)
        .bind(req.active)
        .fetch_one(&self.pool)
        .await?;

        Ok(RoutineStackWithItems {
            routine,
            items: Vec::new(),
            today_logs: Vec::new(),
        })
    }

    pub async fn update_routine(
        &self,
        id: Uuid,
        req: UpdateRoutineRequest,
    ) -> Result<RoutineStackWithItems, ApiError> {
        let existing = self.get_routine(id, None).await?.routine;
        let name = match req.name {
            Some(n) => {
                let trimmed = n.trim();
                if trimmed.is_empty() {
                    return Err(ApiError::bad_request("Routine name must not be empty"));
                }
                trimmed.to_string()
            }
            None => existing.name,
        };
        let time_slot = req.time_slot.unwrap_or(existing.time_slot);
        let day_profile = req.day_profile.unwrap_or(existing.day_profile);
        let target_start_time = req.target_start_time.or(existing.target_start_time);
        let sort_order = req.sort_order.unwrap_or(existing.sort_order);
        let active = req.active.unwrap_or(existing.active);

        sqlx::query(
            "UPDATE routines \
             SET name = $2, time_slot = $3, day_profile = $4, target_start_time = $5, \
                 sort_order = $6, active = $7, updated_at = NOW() \
             WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .bind(name)
        .bind(time_slot)
        .bind(day_profile)
        .bind(target_start_time)
        .bind(sort_order)
        .bind(active)
        .execute(&self.pool)
        .await?;

        self.get_routine(id, None).await
    }

    pub async fn delete_routine(&self, id: Uuid) -> Result<(), ApiError> {
        let mut tx = self.pool.begin().await?;
        let res = sqlx::query(
            "UPDATE routines SET deleted_at = NOW(), updated_at = NOW() \
             WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;

        if res.rows_affected() == 0 {
            return Err(ApiError::not_found(format!("Routine '{id}' not found")));
        }

        sqlx::query(
            "UPDATE routine_items SET deleted_at = NOW(), updated_at = NOW() \
             WHERE routine_id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    pub async fn create_routine_item(
        &self,
        routine_id: Uuid,
        req: CreateRoutineItemRequest,
    ) -> Result<RoutineItem, ApiError> {
        let _ = self.get_routine(routine_id, None).await?;
        let title = req.title.trim();
        if title.is_empty() {
            return Err(ApiError::bad_request("Routine item title must not be empty"));
        }
        if let Some(est) = req.estimated_minutes {
            if est < 0 {
                return Err(ApiError::bad_request("estimated_minutes must be >= 0"));
            }
        }

        let sort_order = match req.sort_order {
            Some(so) => so,
            None => {
                let max_order: i32 = sqlx::query_scalar(
                    "SELECT COALESCE(MAX(sort_order), 0) FROM routine_items \
                     WHERE routine_id = $1 AND deleted_at IS NULL",
                )
                .bind(routine_id)
                .fetch_one(&self.pool)
                .await?;
                max_order + 1
            }
        };
        let freq_cfg = if req.frequency_config.is_null() {
            serde_json::json!({})
        } else {
            req.frequency_config
        };

        let id = new_uuid_v7();
        let item = sqlx::query_as::<_, RoutineItem>(
            "INSERT INTO routine_items ( \
                id, routine_id, goal_id, title, tracking_type, target_value, unit, \
                frequency_type, frequency_config, estimated_minutes, sort_order \
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
             RETURNING id, routine_id, goal_id, title, tracking_type, target_value, unit, \
                       frequency_type, frequency_config, estimated_minutes, sort_order, \
                       created_at, updated_at, deleted_at",
        )
        .bind(id)
        .bind(routine_id)
        .bind(req.goal_id)
        .bind(title)
        .bind(req.tracking_type)
        .bind(req.target_value)
        .bind(req.unit)
        .bind(req.frequency_type)
        .bind(freq_cfg)
        .bind(req.estimated_minutes)
        .bind(sort_order)
        .fetch_one(&self.pool)
        .await?;

        Ok(item)
    }

    pub async fn get_routine_item(&self, item_id: Uuid) -> Result<RoutineItem, ApiError> {
        sqlx::query_as::<_, RoutineItem>(
            "SELECT id, routine_id, goal_id, title, tracking_type, target_value, unit, \
                    frequency_type, frequency_config, estimated_minutes, sort_order, \
                    created_at, updated_at, deleted_at \
             FROM routine_items WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(item_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| ApiError::not_found(format!("Routine item '{item_id}' not found")))
    }

    pub async fn update_routine_item(
        &self,
        item_id: Uuid,
        req: UpdateRoutineItemRequest,
    ) -> Result<RoutineItem, ApiError> {
        let existing = self.get_routine_item(item_id).await?;
        let title = match req.title {
            Some(t) => {
                let trimmed = t.trim();
                if trimmed.is_empty() {
                    return Err(ApiError::bad_request("Routine item title must not be empty"));
                }
                trimmed.to_string()
            }
            None => existing.title,
        };
        if let Some(est) = req.estimated_minutes {
            if est < 0 {
                return Err(ApiError::bad_request("estimated_minutes must be >= 0"));
            }
        }

        let goal_id = req.goal_id.or(existing.goal_id);
        let tracking_type = req.tracking_type.unwrap_or(existing.tracking_type);
        let target_value = req.target_value.or(existing.target_value);
        let unit = req.unit.or(existing.unit);
        let frequency_type = req.frequency_type.unwrap_or(existing.frequency_type);
        let frequency_config = req.frequency_config.unwrap_or(existing.frequency_config);
        let estimated_minutes = req.estimated_minutes.or(existing.estimated_minutes);
        let sort_order = req.sort_order.unwrap_or(existing.sort_order);

        let updated = sqlx::query_as::<_, RoutineItem>(
            "UPDATE routine_items SET \
                goal_id = $2, title = $3, tracking_type = $4, target_value = $5, unit = $6, \
                frequency_type = $7, frequency_config = $8, estimated_minutes = $9, \
                sort_order = $10, updated_at = NOW() \
             WHERE id = $1 AND deleted_at IS NULL \
             RETURNING id, routine_id, goal_id, title, tracking_type, target_value, unit, \
                       frequency_type, frequency_config, estimated_minutes, sort_order, \
                       created_at, updated_at, deleted_at",
        )
        .bind(item_id)
        .bind(goal_id)
        .bind(title)
        .bind(tracking_type)
        .bind(target_value)
        .bind(unit)
        .bind(frequency_type)
        .bind(frequency_config)
        .bind(estimated_minutes)
        .bind(sort_order)
        .fetch_one(&self.pool)
        .await?;

        Ok(updated)
    }

    pub async fn delete_routine_item(&self, item_id: Uuid) -> Result<(), ApiError> {
        let existing = self.get_routine_item(item_id).await?;
        let res = sqlx::query(
            "UPDATE routine_items SET deleted_at = NOW(), updated_at = NOW() \
             WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(item_id)
        .execute(&self.pool)
        .await?;

        if res.rows_affected() == 0 {
            return Err(ApiError::not_found(format!(
                "Routine item '{item_id}' not found"
            )));
        }

        self.recalculate_goals_linked_to_habit(item_id, existing.goal_id)
            .await;
        Ok(())
    }

    // =========================================================================
    // 2. Habit Logging & Cadence-Aware Streak Calculator (`routine_logs`)
    // =========================================================================

    pub async fn log_routine_item(
        &self,
        req: LogRoutineItemRequest,
    ) -> Result<RoutineLog, ApiError> {
        let item = self.get_routine_item(req.routine_item_id).await?;
        let log_date = req.log_date.unwrap_or_else(|| Utc::now().date_naive());
        let completed_at = if req.status == RoutineLogStatus::Completed {
            Some(Utc::now())
        } else {
            None
        };

        let id = new_uuid_v7();
        let log = sqlx::query_as::<_, RoutineLog>(
            "INSERT INTO routine_logs ( \
                id, routine_item_id, log_date, status, numeric_value, completed_at, notes \
             ) VALUES ($1, $2, $3, $4, $5, $6, $7) \
             ON CONFLICT (routine_item_id, log_date) DO UPDATE SET \
                status = EXCLUDED.status, \
                numeric_value = EXCLUDED.numeric_value, \
                completed_at = EXCLUDED.completed_at, \
                notes = EXCLUDED.notes, \
                deleted_at = NULL, \
                updated_at = NOW() \
             RETURNING id, routine_item_id, log_date, status, numeric_value, completed_at, \
                       notes, created_at, updated_at, deleted_at",
        )
        .bind(id)
        .bind(item.id)
        .bind(log_date)
        .bind(req.status)
        .bind(req.numeric_value)
        .bind(completed_at)
        .bind(&req.notes)
        .fetch_one(&self.pool)
        .await?;

        let parent_profile: DayProfile = sqlx::query_scalar(
            "SELECT day_profile FROM routines WHERE id = $1",
        )
        .bind(item.routine_id)
        .fetch_optional(&self.pool)
        .await?
        .unwrap_or(DayProfile::Workday);

        let checkins = self.load_checkin_profiles_map().await?;
        let item_logs = sqlx::query_as::<_, RoutineLog>(
            "SELECT id, routine_item_id, log_date, status, numeric_value, completed_at, \
                    notes, created_at, updated_at, deleted_at \
             FROM routine_logs \
             WHERE routine_item_id = $1 AND deleted_at IS NULL \
             ORDER BY log_date ASC",
        )
        .bind(item.id)
        .fetch_all(&self.pool)
        .await?;

        let streak = compute_item_streak_summary(
            &item,
            parent_profile,
            &item_logs,
            &checkins,
            Utc::now().date_naive(),
        );

        let status_str = match log.status {
            RoutineLogStatus::Completed => "completed",
            RoutineLogStatus::Partial => "partial",
            RoutineLogStatus::Skipped => "skipped",
        };

        self.emit_event(SystemEvent::RoutineLogged {
            routine_item_id: item.id,
            log_date: log.log_date.to_string(),
            status: status_str.to_string(),
            current_streak: streak.current_streak,
            timestamp: Utc::now(),
        });

        self.recalculate_goals_linked_to_habit(item.id, item.goal_id)
            .await;

        Ok(log)
    }

    pub async fn get_routines_analytics(&self) -> Result<RoutineAnalyticsResponse, ApiError> {
        let today = Utc::now().date_naive();

        let routines = sqlx::query_as::<_, Routine>(
            "SELECT id, name, time_slot, day_profile, target_start_time, sort_order, active, \
                    created_at, updated_at, deleted_at \
             FROM routines WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut routine_profile_map: HashMap<Uuid, DayProfile> = HashMap::new();
        for r in &routines {
            routine_profile_map.insert(r.id, r.day_profile);
        }

        let items = sqlx::query_as::<_, RoutineItem>(
            "SELECT id, routine_id, goal_id, title, tracking_type, target_value, unit, \
                    frequency_type, frequency_config, estimated_minutes, sort_order, \
                    created_at, updated_at, deleted_at \
             FROM routine_items WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let all_logs = sqlx::query_as::<_, RoutineLog>(
            "SELECT id, routine_item_id, log_date, status, numeric_value, completed_at, \
                    notes, created_at, updated_at, deleted_at \
             FROM routine_logs WHERE deleted_at IS NULL ORDER BY log_date ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let checkins = self.load_checkin_profiles_map().await?;

        let mut logs_by_item: HashMap<Uuid, Vec<RoutineLog>> = HashMap::new();
        let mut logs_by_date: HashMap<NaiveDate, Vec<RoutineLog>> = HashMap::new();
        for lg in all_logs {
            logs_by_item
                .entry(lg.routine_item_id)
                .or_default()
                .push(lg.clone());
            logs_by_date.entry(lg.log_date).or_default().push(lg);
        }

        let mut streaks = Vec::with_capacity(items.len());
        let mut items_by_routine: HashMap<Uuid, Vec<RoutineItem>> = HashMap::new();

        for item in &items {
            let parent_profile = routine_profile_map
                .get(&item.routine_id)
                .copied()
                .unwrap_or(DayProfile::Workday);
            let empty_logs = Vec::new();
            let item_logs = logs_by_item.get(&item.id).unwrap_or(&empty_logs);
            let summary =
                compute_item_streak_summary(item, parent_profile, item_logs, &checkins, today);
            streaks.push(summary);
            items_by_routine
                .entry(item.routine_id)
                .or_default()
                .push(item.clone());
        }

        // 8x12 = 96-day binary dot-matrix (`REF-06`)
        let mut matrix_8x12 = Vec::with_capacity(96);
        for offset in (0..96).rev() {
            let d = today - Duration::days(offset);
            let any_completed = logs_by_date
                .get(&d)
                .map(|day_logs| {
                    day_logs
                        .iter()
                        .any(|l| l.status == RoutineLogStatus::Completed)
                })
                .unwrap_or(false);
            matrix_8x12.push(any_completed);
        }

        // 365-day completion heatmap
        let total_items_count = items.len() as i32;
        let mut heatmap_365d = Vec::with_capacity(365);
        for offset in (0..365).rev() {
            let d = today - Duration::days(offset);
            let completed_count = logs_by_date
                .get(&d)
                .map(|day_logs| {
                    day_logs
                        .iter()
                        .filter(|l| l.status == RoutineLogStatus::Completed)
                        .count() as i32
                })
                .unwrap_or(0);
            let ratio = if total_items_count > 0 {
                ((completed_count as f64 / total_items_count as f64).clamp(0.0, 1.0) * 1000.0)
                    .round()
                    / 1000.0
            } else {
                0.0
            };
            heatmap_365d.push(RoutineHeatmapDay {
                date: d,
                completed_count,
                total_count: total_items_count,
                completion_ratio: ratio,
            });
        }

        // Per-routine adherence (30-day average)
        let mut routine_adherence = Vec::with_capacity(routines.len());
        for r in &routines {
            let r_items = items_by_routine.get(&r.id).cloned().unwrap_or_default();
            let pct = if r_items.is_empty() {
                0.0
            } else {
                let sum: i32 = streaks
                    .iter()
                    .filter(|s| r_items.iter().any(|it| it.id == s.routine_item_id))
                    .map(|s| s.completion_rate_30d_pct)
                    .sum();
                ((sum as f64 / r_items.len() as f64) * 10.0).round() / 10.0
            };
            routine_adherence.push(RoutineStackAdherence {
                routine_id: r.id,
                routine_name: r.name.clone(),
                adherence_pct: pct,
            });
        }

        let consistency_score_pct = if streaks.is_empty() {
            0.0
        } else {
            let avg = streaks
                .iter()
                .map(|s| s.completion_rate_30d_pct as f64)
                .sum::<f64>()
                / streaks.len() as f64;
            (avg * 10.0).round() / 10.0
        };

        Ok(RoutineAnalyticsResponse {
            streaks,
            matrix_8x12,
            consistency_score_pct,
            heatmap_365d,
            routine_adherence,
        })
    }

    async fn load_checkin_profiles_map(&self) -> Result<HashMap<NaiveDate, DayProfile>, ApiError> {
        let rows = sqlx::query(
            "SELECT log_date, day_profile_used FROM daily_checkins WHERE deleted_at IS NULL",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut map = HashMap::with_capacity(rows.len());
        for row in rows {
            let d: NaiveDate = row.try_get("log_date")?;
            let p: DayProfile = row.try_get("day_profile_used")?;
            map.insert(d, p);
        }
        Ok(map)
    }

    async fn recalculate_goals_linked_to_habit(&self, item_id: Uuid, direct_goal_id: Option<Uuid>) {
        if let Some(gid) = direct_goal_id {
            let _ = self.recalculate_goal_rollups(gid).await;
        }
        let goal_ids: Vec<Uuid> = sqlx::query_scalar(
            "SELECT DISTINCT goal_id FROM goal_key_results \
             WHERE metric_type = 'linked_habit' AND linked_entity_id = $1",
        )
        .bind(item_id)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default();

        for gid in goal_ids {
            let _ = self.recalculate_goal_rollups(gid).await;
        }
    }

    // =========================================================================
    // 3. Ideal Week Blueprint & Planned-vs-Actual Variance (`ideal_week_blocks`)
    // =========================================================================

    pub async fn get_ideal_week(&self) -> Result<IdealWeekResponse, ApiError> {
        let blocks = sqlx::query_as::<_, IdealWeekBlock>(
            "SELECT id, day_of_week, start_time, end_time, category, linked_goal_id, label, \
                    created_at, updated_at \
             FROM ideal_week_blocks \
             ORDER BY day_of_week ASC, start_time ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut planned_by_cat: BTreeMap<String, i64> = BTreeMap::new();
        for &cat in &ALLOWED_IDEAL_WEEK_CATEGORIES {
            planned_by_cat.insert(cat.to_string(), 0);
        }

        let mut total_planned_minutes = 0_i64;
        for b in &blocks {
            let mins = ((b.end_time - b.start_time).num_minutes()).max(0);
            total_planned_minutes += mins;
            *planned_by_cat.entry(b.category.clone()).or_insert(0) += mins;
        }

        // Actual minutes logged in the trailing 7 days from `time_sessions`
        let actual_rows = sqlx::query(
            "SELECT category, (COALESCE(SUM(duration_seconds), 0) / 60)::BIGINT AS actual_mins \
             FROM time_sessions \
             WHERE deleted_at IS NULL AND ended_at IS NOT NULL \
               AND started_at >= NOW() - INTERVAL '7 days' \
             GROUP BY category",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut actual_by_cat: HashMap<String, i64> = HashMap::new();
        let mut total_actual_minutes = 0_i64;
        for r in actual_rows {
            let cat: String = r.try_get("category")?;
            let mins: i64 = r.try_get("actual_mins")?;
            total_actual_minutes += mins;
            actual_by_cat.insert(cat, mins);
        }

        let mut variance_by_category = Vec::with_capacity(planned_by_cat.len());
        for (cat, planned_minutes) in planned_by_cat {
            let actual_minutes = actual_by_cat.get(&cat).copied().unwrap_or(0);
            if planned_minutes > 0 || actual_minutes > 0 {
                variance_by_category.push(IdealWeekCategoryVariance {
                    category: cat,
                    planned_minutes,
                    actual_minutes,
                    variance_minutes: actual_minutes - planned_minutes,
                });
            }
        }

        Ok(IdealWeekResponse {
            blocks,
            total_planned_minutes,
            total_actual_minutes,
            variance_by_category,
        })
    }

    pub async fn replace_ideal_week(
        &self,
        req: UpsertIdealWeekRequest,
    ) -> Result<IdealWeekResponse, ApiError> {
        // Validate every block and check for overlaps per day_of_week
        let mut sorted = req.blocks.clone();
        for b in &sorted {
            if !(0..=6).contains(&b.day_of_week) {
                return Err(ApiError::bad_request(
                    "day_of_week must be between 0 (Monday) and 6 (Sunday)",
                ));
            }
            if b.end_time <= b.start_time {
                return Err(ApiError::bad_request(
                    "Ideal week block end_time must be strictly after start_time",
                ));
            }
            if b.label.trim().is_empty() {
                return Err(ApiError::bad_request(
                    "Ideal week block label must not be empty",
                ));
            }
            if !ALLOWED_IDEAL_WEEK_CATEGORIES.contains(&b.category.as_str()) {
                return Err(ApiError::bad_request(format!(
                    "Invalid ideal week category '{}'",
                    b.category
                )));
            }
        }

        sorted.sort_by(|a, b| {
            a.day_of_week
                .cmp(&b.day_of_week)
                .then_with(|| a.start_time.cmp(&b.start_time))
        });

        for pair in sorted.windows(2) {
            let prev = &pair[0];
            let next = &pair[1];
            if prev.day_of_week == next.day_of_week && next.start_time < prev.end_time {
                return Err(ApiError::bad_request(format!(
                    "Overlapping ideal week blocks on day {}: '{}' and '{}'",
                    prev.day_of_week, prev.label, next.label
                )));
            }
        }

        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM ideal_week_blocks")
            .execute(&mut *tx)
            .await?;

        for b in sorted {
            let id = if b.id.is_nil() { new_uuid_v7() } else { b.id };
            sqlx::query(
                "INSERT INTO ideal_week_blocks ( \
                    id, day_of_week, start_time, end_time, category, linked_goal_id, label \
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            )
            .bind(id)
            .bind(b.day_of_week)
            .bind(b.start_time)
            .bind(b.end_time)
            .bind(b.category)
            .bind(b.linked_goal_id)
            .bind(b.label.trim())
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        self.get_ideal_week().await
    }

    // =========================================================================
    // 4. Daily Check-ins, Weekly Review & Atomic Obsidian Markdown Exporter
    // =========================================================================

    pub async fn set_day_profile(
        &self,
        log_date: NaiveDate,
        day_profile: DayProfile,
    ) -> Result<DailyCheckin, ApiError> {
        self.upsert_checkin(
            log_date,
            UpsertDailyCheckinRequest {
                day_profile_used: Some(day_profile),
                ..Default::default()
            },
        )
        .await
    }

    pub async fn get_checkin(&self, log_date: NaiveDate) -> Result<DailyCheckin, ApiError> {
        let existing = sqlx::query_as::<_, DailyCheckin>(
            "SELECT log_date, day_profile_used, energy_score, mood_score, sleep_hours, \
                    highlight, reflection_md, weekly_review_json, created_at, updated_at, deleted_at \
             FROM daily_checkins \
             WHERE log_date = $1 AND deleted_at IS NULL",
        )
        .bind(log_date)
        .fetch_optional(&self.pool)
        .await?;

        let now = Utc::now();
        let default_profile = match log_date.weekday() {
            Weekday::Sat | Weekday::Sun => DayProfile::Weekend,
            _ => DayProfile::Workday,
        };

        let mut checkin = existing.unwrap_or(DailyCheckin {
            log_date,
            day_profile_used: default_profile,
            energy_score: None,
            mood_score: None,
            sleep_hours: None,
            highlight: String::new(),
            reflection_md: String::new(),
            weekly_review_json: None,
            obsidian_vault_path: None,
            weekly_review_vault_path: None,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        });

        checkin.obsidian_vault_path = Some(format!("Daily/{log_date}.md"));
        if checkin.weekly_review_json.is_some() {
            let iso = log_date.iso_week();
            checkin.weekly_review_vault_path =
                Some(format!("Reviews/{:04}-W{:02}.md", iso.year(), iso.week()));
        }

        Ok(checkin)
    }

    pub async fn upsert_checkin(
        &self,
        log_date: NaiveDate,
        req: UpsertDailyCheckinRequest,
    ) -> Result<DailyCheckin, ApiError> {
        if let Some(energy) = req.energy_score {
            if !(1..=5).contains(&energy) {
                return Err(ApiError::bad_request(
                    "energy_score must be between 1 and 5",
                ));
            }
        }
        if let Some(mood) = req.mood_score {
            if !(1..=5).contains(&mood) {
                return Err(ApiError::bad_request("mood_score must be between 1 and 5"));
            }
        }

        let current = self.get_checkin(log_date).await?;
        let raw_profile = req.day_profile_used.unwrap_or(current.day_profile_used);
        let normalized_profile = match raw_profile {
            DayProfile::All => match log_date.weekday() {
                Weekday::Sat | Weekday::Sun => DayProfile::Weekend,
                _ => DayProfile::Workday,
            },
            other => other,
        };

        let energy_score = req.energy_score.or(current.energy_score);
        let mood_score = req.mood_score.or(current.mood_score);
        let sleep_hours = req.sleep_hours.or(current.sleep_hours);
        let highlight = req.highlight.unwrap_or(current.highlight);
        let reflection_md = req.reflection_md.unwrap_or(current.reflection_md);
        let weekly_review_json = req.weekly_review_json.or(current.weekly_review_json);

        let mut saved = sqlx::query_as::<_, DailyCheckin>(
            "INSERT INTO daily_checkins ( \
                log_date, day_profile_used, energy_score, mood_score, sleep_hours, \
                highlight, reflection_md, weekly_review_json \
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
             ON CONFLICT (log_date) DO UPDATE SET \
                day_profile_used = EXCLUDED.day_profile_used, \
                energy_score = EXCLUDED.energy_score, \
                mood_score = EXCLUDED.mood_score, \
                sleep_hours = EXCLUDED.sleep_hours, \
                highlight = EXCLUDED.highlight, \
                reflection_md = EXCLUDED.reflection_md, \
                weekly_review_json = EXCLUDED.weekly_review_json, \
                deleted_at = NULL, \
                updated_at = NOW() \
             RETURNING log_date, day_profile_used, energy_score, mood_score, sleep_hours, \
                       highlight, reflection_md, weekly_review_json, created_at, updated_at, deleted_at",
        )
        .bind(log_date)
        .bind(normalized_profile)
        .bind(energy_score)
        .bind(mood_score)
        .bind(sleep_hours)
        .bind(&highlight)
        .bind(&reflection_md)
        .bind(&weekly_review_json)
        .fetch_one(&self.pool)
        .await?;

        // 1. Render & atomically write Daily Obsidian Markdown note `{second_brain_dir}/Daily/YYYY-MM-DD.md`
        let daily_rel = format!("Daily/{log_date}.md");
        let daily_abs = self.config.second_brain_dir.join(&daily_rel);
        let daily_md = self.render_daily_checkin_markdown(&saved).await?;
        atomic_write_markdown(&daily_abs, &daily_md)?;
        saved.obsidian_vault_path = Some(daily_rel);

        // 2. If `weekly_review_json` is present, render & atomically write `{second_brain_dir}/Reviews/YYYY-Www.md`
        if let Some(ref wr_json) = saved.weekly_review_json {
            let iso = log_date.iso_week();
            let iso_str = format!("{:04}-W{:02}", iso.year(), iso.week());
            let review_rel = format!("Reviews/{iso_str}.md");
            let review_abs = self.config.second_brain_dir.join(&review_rel);
            let summary = self
                .get_weekly_review_summary(Some(&log_date.to_string()))
                .await?;
            let review_md = render_weekly_review_markdown(&iso_str, &summary, wr_json);
            atomic_write_markdown(&review_abs, &review_md)?;
            saved.weekly_review_vault_path = Some(review_rel);
        }

        Ok(saved)
    }

    pub async fn get_weekly_review_summary(
        &self,
        week_or_date: Option<&str>,
    ) -> Result<WeeklyReviewSummaryResponse, ApiError> {
        let anchor_date = parse_week_or_date_anchor(week_or_date)?;
        let days_from_mon = anchor_date.weekday().num_days_from_monday() as i64;
        let week_start = anchor_date - Duration::days(days_from_mon);
        let week_end = week_start + Duration::days(6);
        let iso = week_start.iso_week();
        let iso_week = format!("{:04}-W{:02}", iso.year(), iso.week());

        let completed_tasks_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM tasks \
             WHERE deleted_at IS NULL AND status = 'done' \
               AND (completed_at::date BETWEEN $1 AND $2 OR updated_at::date BETWEEN $1 AND $2)",
        )
        .bind(week_start)
        .bind(week_end)
        .fetch_one(&self.pool)
        .await?;

        let inbox_tasks_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND status = 'inbox'",
        )
        .fetch_one(&self.pool)
        .await?;

        let focus_seconds: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(duration_seconds), 0)::BIGINT FROM time_sessions \
             WHERE deleted_at IS NULL AND ended_at IS NOT NULL \
               AND started_at::date BETWEEN $1 AND $2",
        )
        .bind(week_start)
        .bind(week_end)
        .fetch_one(&self.pool)
        .await?;

        let focus_minutes = focus_seconds / 60;
        let focus_hours = ((focus_seconds as f64 / 3600.0) * 100.0).round() / 100.0;

        let routine_row = sqlx::query(
            "SELECT COUNT(*) AS total_logs, \
                    COUNT(*) FILTER (WHERE status = 'completed') AS completed_logs \
             FROM routine_logs \
             WHERE deleted_at IS NULL AND log_date BETWEEN $1 AND $2",
        )
        .bind(week_start)
        .bind(week_end)
        .fetch_one(&self.pool)
        .await?;
        let total_logs: i64 = routine_row.try_get("total_logs")?;
        let completed_logs: i64 = routine_row.try_get("completed_logs")?;
        let routine_consistency_pct = if total_logs > 0 {
            (((completed_logs as f64 / total_logs as f64) * 100.0) * 10.0).round() / 10.0
        } else {
            0.0
        };

        let completed_lessons_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM course_lessons \
             WHERE status IN ('distilled', 'completed') \
               AND (completed_at::date BETWEEN $1 AND $2 OR updated_at::date BETWEEN $1 AND $2)",
        )
        .bind(week_start)
        .bind(week_end)
        .fetch_one(&self.pool)
        .await?;

        let goals_avg_progress_pct: f64 = sqlx::query_scalar(
            "SELECT COALESCE(AVG(progress_pct::FLOAT8), 0.0)::FLOAT8 \
             FROM goals WHERE status IN ('not_started', 'in_progress', 'completed')",
        )
        .fetch_one(&self.pool)
        .await?;

        let investable_surplus_cents: i64 = sqlx::query_scalar(
            "SELECT COALESCE(GREATEST(0, salary_income_cents - COALESCE(actual_spend_cents, planned_spend_cents)), 0)::BIGINT \
             FROM monthly_investment_plans \
             ORDER BY month DESC LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await?
        .unwrap_or(0);

        let vault_rel = format!("Reviews/{iso_week}.md");

        Ok(WeeklyReviewSummaryResponse {
            week_start,
            week_end,
            iso_week,
            completed_tasks_count: completed_tasks_count as usize,
            inbox_tasks_count: inbox_tasks_count as usize,
            focus_hours,
            focus_minutes,
            routine_consistency_pct,
            completed_lessons_count: completed_lessons_count as usize,
            goals_avg_progress_pct: (goals_avg_progress_pct * 10.0).round() / 10.0,
            investable_surplus_cents,
            vault_export_path: Some(vault_rel),
        })
    }

    pub async fn get_weekly_review_json(
        &self,
        week_or_date: Option<&str>,
    ) -> Result<(WeeklyReviewSummaryResponse, Option<serde_json::Value>), ApiError> {
        let summary = self.get_weekly_review_summary(week_or_date).await?;
        let stored: Option<serde_json::Value> = sqlx::query_scalar(
            "SELECT weekly_review_json FROM daily_checkins \
             WHERE log_date BETWEEN $1 AND $2 \
               AND weekly_review_json IS NOT NULL \
               AND deleted_at IS NULL \
             ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(summary.week_start)
        .bind(summary.week_end)
        .fetch_optional(&self.pool)
        .await?;
        Ok((summary, stored))
    }

    pub async fn upsert_weekly_review_by_key(
        &self,
        week_key: &str,
        payload: Option<serde_json::Value>,
    ) -> Result<(WeeklyReviewSummaryResponse, serde_json::Value), ApiError> {
        let (summary, existing) = self.get_weekly_review_json(Some(week_key)).await?;
        let mut merged = match existing {
            Some(serde_json::Value::Object(m)) => m,
            _ => serde_json::Map::new(),
        };
        if let Some(serde_json::Value::Object(incoming)) = payload {
            for (k, v) in incoming {
                merged.insert(k, v);
            }
        }
        let review_val = serde_json::Value::Object(merged);
        let _ = self
            .upsert_checkin(
                summary.week_end,
                UpsertDailyCheckinRequest {
                    weekly_review_json: Some(review_val.clone()),
                    ..Default::default()
                },
            )
            .await?;
        let refreshed = self.get_weekly_review_summary(Some(week_key)).await?;
        Ok((refreshed, review_val))
    }

    async fn render_daily_checkin_markdown(
        &self,
        checkin: &DailyCheckin,
    ) -> Result<String, ApiError> {
        let log_rows = sqlx::query(
            "SELECT ri.title, rl.status, rl.numeric_value, ri.unit \
             FROM routine_logs rl \
             JOIN routine_items ri ON ri.id = rl.routine_item_id \
             WHERE rl.log_date = $1 AND rl.deleted_at IS NULL \
             ORDER BY ri.sort_order ASC",
        )
        .bind(checkin.log_date)
        .fetch_all(&self.pool)
        .await?;

        let profile_str = match checkin.day_profile_used {
            DayProfile::Workday => "workday",
            DayProfile::Weekend => "weekend",
            DayProfile::Travel => "travel",
            DayProfile::MinimumViable => "minimum_viable",
            DayProfile::All => "workday",
        };

        let mut md = String::new();
        md.push_str("---\n");
        md.push_str(&format!("date: \"{}\"\n", checkin.log_date));
        md.push_str(&format!("day_profile: \"{profile_str}\"\n"));
        if let Some(e) = checkin.energy_score {
            md.push_str(&format!("energy_score: {e}\n"));
        }
        if let Some(m) = checkin.mood_score {
            md.push_str(&format!("mood_score: {m}\n"));
        }
        if let Some(s) = checkin.sleep_hours {
            md.push_str(&format!("sleep_hours: {s}\n"));
        }
        md.push_str("tags:\n  - daily-checkin\n  - hermes-os\n---\n\n");
        md.push_str(&format!("# Daily Pulse — {}\n\n", checkin.log_date));
        md.push_str(&format!("- **Day Profile**: `{profile_str}`\n"));
        md.push_str(&format!(
            "- **Energy**: {}\n",
            checkin
                .energy_score
                .map(|v| format!("{v}/5"))
                .unwrap_or_else(|| "N/A".to_string())
        ));
        md.push_str(&format!(
            "- **Mood**: {}\n",
            checkin
                .mood_score
                .map(|v| format!("{v}/5"))
                .unwrap_or_else(|| "N/A".to_string())
        ));
        md.push_str(&format!(
            "- **Sleep**: {}\n\n",
            checkin
                .sleep_hours
                .map(|v| format!("{v}h"))
                .unwrap_or_else(|| "N/A".to_string())
        ));

        if !checkin.highlight.trim().is_empty() {
            md.push_str("## Highlight of the Day\n\n");
            md.push_str(checkin.highlight.trim());
            md.push_str("\n\n");
        }

        md.push_str("## Routine Checkoffs\n\n");
        if log_rows.is_empty() {
            md.push_str("_No routine items logged yet._\n\n");
        } else {
            for r in log_rows {
                let title: String = r.try_get("title")?;
                let status: String = r.try_get("status")?;
                let checkbox = if status == "completed" { "[x]" } else { "[ ]" };
                md.push_str(&format!("- {checkbox} {title} (`{status}`)\n"));
            }
            md.push('\n');
        }

        if !checkin.reflection_md.trim().is_empty() {
            md.push_str("## Evening Reflection\n\n");
            md.push_str(checkin.reflection_md.trim());
            md.push('\n');
        }

        Ok(md)
    }
}

// =============================================================================
// Cadence-Aware Habit Streak Engine & Atomic Markdown Helpers
// =============================================================================

fn is_item_mvd_included(item: &RoutineItem) -> bool {
    item.frequency_config
        .get("mvd_included")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn is_log_satisfied(item: &RoutineItem, log: &RoutineLog) -> bool {
    match log.status {
        RoutineLogStatus::Completed => true,
        RoutineLogStatus::Partial => {
            if let (Some(target), Some(actual)) = (item.target_value, log.numeric_value) {
                actual >= target
            } else {
                false
            }
        }
        RoutineLogStatus::Skipped => false,
    }
}

fn is_date_scheduled(
    item: &RoutineItem,
    parent_profile: DayProfile,
    date: NaiveDate,
    checkins: &HashMap<NaiveDate, DayProfile>,
) -> bool {
    // 1. Check if date had a Travel or MinimumViable check-in that exempts non-MVD / non-travel habits
    if let Some(&profile_used) = checkins.get(&date) {
        if profile_used == DayProfile::Travel && parent_profile != DayProfile::Travel {
            return false;
        }
        if profile_used == DayProfile::MinimumViable
            && parent_profile != DayProfile::MinimumViable
            && !is_item_mvd_included(item)
        {
            return false;
        }
    }

    // 2. Check explicit custom weekday list in `frequency_config.days`
    //    Supports ISO 1..=7 (Mon..Sun) or 0..=6 (0 = Sun or Mon)
    if let Some(days_arr) = item.frequency_config.get("days").and_then(|v| v.as_array()) {
        if !days_arr.is_empty() {
            let iso_day = date.weekday().number_from_monday() as i64; // 1 = Mon .. 7 = Sun
            let sun_zero = if iso_day == 7 { 0 } else { iso_day };
            return days_arr.iter().any(|v| {
                if let Some(n) = v.as_i64() {
                    n == iso_day || (n == 0 && sun_zero == 0)
                } else if let Some(s) = v.as_str() {
                    s.eq_ignore_ascii_case(&date.weekday().to_string())
                } else {
                    false
                }
            });
        }
    }

    // 3. Check `frequency_type`
    match item.frequency_type {
        HabitFrequencyType::Daily => true,
        HabitFrequencyType::Weekdays => date.weekday().number_from_monday() <= 5,
        HabitFrequencyType::TimesPerWeek => true,
    }
}

pub fn compute_item_streak_summary(
    item: &RoutineItem,
    parent_profile: DayProfile,
    logs: &[RoutineLog],
    checkins: &HashMap<NaiveDate, DayProfile>,
    today: NaiveDate,
) -> HabitStreakSummary {
    let mut log_map: BTreeMap<NaiveDate, &RoutineLog> = BTreeMap::new();
    for lg in logs {
        if lg.deleted_at.is_none() {
            log_map.insert(lg.log_date, lg);
        }
    }

    // 30-day completion rate
    let mut scheduled_30d = 0;
    let mut completed_30d = 0;
    for offset in 0..30 {
        let d = today - Duration::days(offset);
        let sched = is_date_scheduled(item, parent_profile, d, checkins);
        let sat = log_map
            .get(&d)
            .map(|l| is_log_satisfied(item, l))
            .unwrap_or(false);
        if sched {
            scheduled_30d += 1;
        }
        if sat {
            completed_30d += 1;
        }
    }

    let completion_rate_30d_pct = if item.frequency_type == HabitFrequencyType::TimesPerWeek
        && item.frequency_config.get("days").is_none()
    {
        let weekly_target = item
            .frequency_config
            .get("times")
            .or_else(|| item.frequency_config.get("times_per_week"))
            .and_then(|v| v.as_i64())
            .unwrap_or(3)
            .max(1) as f64;
        let target_30d = (weekly_target * (30.0 / 7.0)).max(1.0);
        (((completed_30d as f64 / target_30d) * 100.0).round() as i32).clamp(0, 100)
    } else if scheduled_30d > 0 {
        (((completed_30d as f64 / scheduled_30d as f64) * 100.0).round() as i32).clamp(0, 100)
    } else {
        0
    };

    if log_map.is_empty() {
        return HabitStreakSummary {
            routine_item_id: item.id,
            title: item.title.clone(),
            current_streak: 0,
            longest_streak: 0,
            best_streak: 0,
            frequency_type: item.frequency_type,
            completion_rate_30d_pct,
        };
    }

    let earliest = *log_map.keys().next().unwrap();
    let latest_log = *log_map.keys().next_back().unwrap();
    let anchor = latest_log.max(today);

    // Case A: `TimesPerWeek` without explicit `days` array (weekly quota cadence)
    if item.frequency_type == HabitFrequencyType::TimesPerWeek
        && item.frequency_config.get("days").is_none()
    {
        let target_k = item
            .frequency_config
            .get("times")
            .or_else(|| item.frequency_config.get("times_per_week"))
            .and_then(|v| v.as_i64())
            .unwrap_or(3)
            .max(1) as i32;

        let start_monday =
            earliest - Duration::days(earliest.weekday().num_days_from_monday() as i64);
        let end_monday = anchor - Duration::days(anchor.weekday().num_days_from_monday() as i64);

        let mut running = 0_i32;
        let mut longest = 0_i32;
        let mut week_mon = start_monday;
        while week_mon <= end_monday {
            let mut week_satisfied = 0_i32;
            let mut week_exempt_days = 0_i32;
            for d_off in 0..7 {
                let d = week_mon + Duration::days(d_off);
                if let Some(lg) = log_map.get(&d) {
                    if is_log_satisfied(item, lg) {
                        week_satisfied += 1;
                    }
                }
                if !is_date_scheduled(item, parent_profile, d, checkins) {
                    week_exempt_days += 1;
                }
            }

            let effective_target = (target_k - week_exempt_days).max(0);
            if week_mon < end_monday {
                if week_satisfied >= effective_target {
                    running += week_satisfied;
                } else {
                    running = 0;
                }
            } else {
                // Current week: add completed logs; only break if even remaining days in week can't reach target
                let remaining_days_in_week =
                    (6 - anchor.weekday().num_days_from_monday() as i32).max(0);
                if week_satisfied + remaining_days_in_week >= effective_target {
                    running += week_satisfied;
                } else {
                    running = week_satisfied;
                }
            }
            longest = longest.max(running);
            week_mon += Duration::days(7);
        }

        return HabitStreakSummary {
            routine_item_id: item.id,
            title: item.title.clone(),
            current_streak: running,
            longest_streak: longest,
            best_streak: longest,
            frequency_type: item.frequency_type,
            completion_rate_30d_pct,
        };
    }

    // Case B: `Daily`, `Weekdays`, or custom `days` array cadence
    let mut current_streak = 0_i32;
    let mut d = anchor;
    while d >= earliest {
        if d == today && !log_map.contains_key(&today) {
            if d == earliest {
                break;
            }
            d -= Duration::days(1);
            continue;
        }
        if let Some(lg) = log_map.get(&d) {
            if is_log_satisfied(item, lg) {
                current_streak += 1;
            } else if is_date_scheduled(item, parent_profile, d, checkins) {
                break;
            }
        } else if is_date_scheduled(item, parent_profile, d, checkins) {
            break;
        }
        if d == earliest {
            break;
        }
        d -= Duration::days(1);
    }

    let mut longest_streak = 0_i32;
    let mut running = 0_i32;
    let mut cursor = earliest;
    while cursor <= anchor {
        if cursor == today && !log_map.contains_key(&today) {
            cursor += Duration::days(1);
            continue;
        }
        if let Some(lg) = log_map.get(&cursor) {
            if is_log_satisfied(item, lg) {
                running += 1;
                longest_streak = longest_streak.max(running);
            } else if is_date_scheduled(item, parent_profile, cursor, checkins) {
                running = 0;
            }
        } else if is_date_scheduled(item, parent_profile, cursor, checkins) {
            running = 0;
        }
        cursor += Duration::days(1);
    }
    longest_streak = longest_streak.max(current_streak);

    HabitStreakSummary {
        routine_item_id: item.id,
        title: item.title.clone(),
        current_streak,
        longest_streak,
        best_streak: longest_streak,
        frequency_type: item.frequency_type,
        completion_rate_30d_pct,
    }
}

fn parse_week_or_date_anchor(input: Option<&str>) -> Result<NaiveDate, ApiError> {
    let Some(raw) = input.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(Utc::now().date_naive());
    };

    if let Ok(date) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        return Ok(date);
    }

    // Parse ISO week format "YYYY-Www" (e.g. "2026-W46")
    if let Some((y_str, w_str)) = raw.split_once("-W").or_else(|| raw.split_once("-w")) {
        if let (Ok(year), Ok(week)) = (y_str.parse::<i32>(), w_str.parse::<u32>()) {
            if let Some(d) = NaiveDate::from_isoywd_opt(year, week, Weekday::Mon) {
                return Ok(d);
            }
        }
    }

    Err(ApiError::bad_request(format!(
        "Invalid date or ISO week '{raw}'; expected 'YYYY-MM-DD' or 'YYYY-Www'"
    )))
}

fn render_weekly_review_markdown(
    iso_week: &str,
    summary: &WeeklyReviewSummaryResponse,
    review_json: &serde_json::Value,
) -> String {
    let wins = review_json
        .get("wins")
        .or_else(|| review_json.get("wins_md"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let challenges = review_json
        .get("challenges")
        .or_else(|| review_json.get("challenges_md"))
        .or_else(|| review_json.get("blockers_md"))
        .or_else(|| review_json.get("blockers"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let priorities = review_json
        .get("next_week_priorities")
        .or_else(|| review_json.get("next_steps_md"))
        .or_else(|| review_json.get("adjustments_md"))
        .or_else(|| review_json.get("adjustments"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let mut md = String::new();
    md.push_str("---\n");
    md.push_str(&format!("week: \"{iso_week}\"\n"));
    md.push_str(&format!("week_start: \"{}\"\n", summary.week_start));
    md.push_str(&format!("week_end: \"{}\"\n", summary.week_end));
    md.push_str(&format!(
        "completed_tasks: {}\n",
        summary.completed_tasks_count
    ));
    md.push_str(&format!("focus_hours: {}\n", summary.focus_hours));
    md.push_str(&format!(
        "routine_consistency_pct: {}\n",
        summary.routine_consistency_pct
    ));
    md.push_str("tags:\n  - weekly-review\n  - hermes-os\n---\n\n");
    md.push_str(&format!(
        "# Weekly Review — {iso_week} ({} to {})\n\n",
        summary.week_start, summary.week_end
    ));
    md.push_str("## Telemetry Snapshot\n\n");
    md.push_str(&format!(
        "- **Completed Tasks**: {}\n",
        summary.completed_tasks_count
    ));
    md.push_str(&format!(
        "- **Focus Logged**: {}h ({} mins)\n",
        summary.focus_hours, summary.focus_minutes
    ));
    md.push_str(&format!(
        "- **Routine Consistency**: {}%\n",
        summary.routine_consistency_pct
    ));
    md.push_str(&format!(
        "- **Completed Course Lessons**: {}\n",
        summary.completed_lessons_count
    ));
    md.push_str(&format!(
        "- **Goals Avg Progress**: {}%\n\n",
        summary.goals_avg_progress_pct
    ));

    if !wins.trim().is_empty() {
        md.push_str("## Wins & Highlights\n\n");
        md.push_str(wins.trim());
        md.push_str("\n\n");
    }
    if !challenges.trim().is_empty() {
        md.push_str("## Friction & Blockers\n\n");
        md.push_str(challenges.trim());
        md.push_str("\n\n");
    }
    if !priorities.trim().is_empty() {
        md.push_str("## Next Week Top Priorities\n\n");
        md.push_str(priorities.trim());
        md.push('\n');
    }

    md
}

fn extract_existing_keep_blocks(target_path: &Path) -> String {
    let Ok(existing) = std::fs::read_to_string(target_path) else {
        return String::new();
    };
    let mut kept = Vec::new();
    let mut search_from = 0;
    let open_tag = "<!-- keep -->";
    let close_tag = "<!-- /keep -->";
    while let Some(start_rel) = existing[search_from..].find(open_tag) {
        let abs_start = search_from + start_rel;
        if let Some(end_rel) = existing[abs_start..].find(close_tag) {
            let abs_end = abs_start + end_rel + close_tag.len();
            kept.push(existing[abs_start..abs_end].to_string());
            search_from = abs_end;
        } else {
            break;
        }
    }
    kept.join("\n\n")
}

pub(crate) fn atomic_write_markdown(target_path: &Path, content: &str) -> Result<(), ApiError> {
    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            ApiError::internal(format!(
                "Failed to create Vault directory '{}': {e}",
                parent.display()
            ))
        })?;
    }

    let preserved_keep = extract_existing_keep_blocks(target_path);
    let final_content = if preserved_keep.is_empty() || content.contains(&preserved_keep) {
        content.to_string()
    } else {
        format!("{}\n\n{}\n", content.trim_end(), preserved_keep)
    };

    let file_name = target_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("note.md");
    let tmp_path = target_path.with_file_name(format!(".{file_name}.tmp-{}", new_uuid_v7()));

    std::fs::write(&tmp_path, final_content.as_bytes()).map_err(|e| {
        ApiError::internal(format!(
            "Failed to write temporary Vault file '{}': {e}",
            tmp_path.display()
        ))
    })?;

    std::fs::rename(&tmp_path, target_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        ApiError::internal(format!(
            "Failed to atomically rename Vault file '{}': {e}",
            target_path.display()
        ))
    })?;

    Ok(())
}
