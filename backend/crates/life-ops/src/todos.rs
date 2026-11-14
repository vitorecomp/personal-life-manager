//! Feature F13 — Module `07` Todo List, Deterministic NLP Quick-Capture Parser,
//! DFS Dependency Cycle Detector, `REF-04` `TERMINAL-I/O` Flow Topology & Focus Timer Engine.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Datelike, Duration, NaiveDate, Timelike, Utc, Weekday};
use hermes_domain::{
    error::ApiError,
    events::SystemEvent,
    id::new_uuid_v7,
    todos::{
        ActiveTimerResponse, BulkUpdateTasksRequest, CreateProjectRequest, CreateTaskRequest,
        CreateTimeSessionRequest, FlowEdge, FlowNode, FlowStageSummary, Project,
        ProjectFlowTopologyResponse, QuickCaptureParsed, StartTimerRequest, StopTimerRequest, Task,
        TaskEnergyLevel, TaskListFilter, TaskPriority, TaskStatus, TimeCategory, TimeSession,
        TimeStatsResponse, TimerMode, TodayCapacityMeter, UpdateProjectRequest, UpdateTaskRequest,
    },
};
use sqlx::{QueryBuilder, Row};
use uuid::Uuid;

use crate::service::LifeOpsService;

const TIME_SESSION_SELECT: &str = "\
    SELECT id, task_id, course_id, lesson_id, category, \
           CASE WHEN timer_mode = 'pomodoro' THEN 'pomodoro_25_5' ELSE timer_mode END AS timer_mode, \
           work_minutes, break_minutes, started_at, ended_at, duration_seconds, notes, \
           created_at, updated_at, deleted_at \
    FROM time_sessions";

const TIME_SESSION_RETURNING: &str = "\
    RETURNING id, task_id, course_id, lesson_id, category, \
              CASE WHEN timer_mode = 'pomodoro' THEN 'pomodoro_25_5' ELSE timer_mode END AS timer_mode, \
              work_minutes, break_minutes, started_at, ended_at, duration_seconds, notes, \
              created_at, updated_at, deleted_at";

impl LifeOpsService {
    // =========================================================================
    // 1. Projects CRUD (`projects`)
    // =========================================================================

    pub async fn list_projects(&self) -> Result<Vec<Project>, ApiError> {
        let projects = sqlx::query_as::<_, Project>(
            "SELECT id, name, area, goal_id, status, color, created_at, updated_at, deleted_at \
             FROM projects \
             WHERE deleted_at IS NULL \
             ORDER BY created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(projects)
    }

    pub async fn get_project(&self, id: Uuid) -> Result<Project, ApiError> {
        sqlx::query_as::<_, Project>(
            "SELECT id, name, area, goal_id, status, color, created_at, updated_at, deleted_at \
             FROM projects \
             WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| ApiError::not_found(format!("Project '{id}' not found")))
    }

    pub async fn create_project(&self, req: CreateProjectRequest) -> Result<Project, ApiError> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(ApiError::bad_request("Project name must not be empty"));
        }
        let color = if req.color.trim().is_empty() {
            "#F87C18".to_string()
        } else {
            req.color.trim().to_string()
        };

        let id = new_uuid_v7();
        let project = sqlx::query_as::<_, Project>(
            "INSERT INTO projects (id, name, area, goal_id, status, color) \
             VALUES ($1, $2, $3, $4, $5, $6) \
             RETURNING id, name, area, goal_id, status, color, created_at, updated_at, deleted_at",
        )
        .bind(id)
        .bind(name)
        .bind(req.area)
        .bind(req.goal_id)
        .bind(req.status)
        .bind(color)
        .fetch_one(&self.pool)
        .await?;

        if let Some(goal_id) = project.goal_id {
            let _ = self.recalculate_goal_rollups(goal_id).await;
        }

        Ok(project)
    }

    pub async fn update_project(
        &self,
        id: Uuid,
        req: UpdateProjectRequest,
    ) -> Result<Project, ApiError> {
        let existing = self.get_project(id).await?;
        let name = match req.name {
            Some(n) => {
                let trimmed = n.trim();
                if trimmed.is_empty() {
                    return Err(ApiError::bad_request("Project name must not be empty"));
                }
                trimmed.to_string()
            }
            None => existing.name,
        };
        let area = req.area.unwrap_or(existing.area);
        let goal_id = req.goal_id.or(existing.goal_id);
        let status = req.status.unwrap_or(existing.status);
        let color = req
            .color
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty())
            .unwrap_or(existing.color);

        let updated = sqlx::query_as::<_, Project>(
            "UPDATE projects \
             SET name = $2, area = $3, goal_id = $4, status = $5, color = $6, updated_at = NOW() \
             WHERE id = $1 AND deleted_at IS NULL \
             RETURNING id, name, area, goal_id, status, color, created_at, updated_at, deleted_at",
        )
        .bind(id)
        .bind(name)
        .bind(area)
        .bind(goal_id)
        .bind(status)
        .bind(color)
        .fetch_one(&self.pool)
        .await?;

        if let Some(gid) = existing.goal_id {
            let _ = self.recalculate_goal_rollups(gid).await;
        }
        if let Some(gid) = updated.goal_id {
            let _ = self.recalculate_goal_rollups(gid).await;
        }

        Ok(updated)
    }

    pub async fn delete_project(&self, id: Uuid) -> Result<(), ApiError> {
        let existing = self.get_project(id).await?;
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "UPDATE tasks SET project_id = NULL, updated_at = NOW() \
             WHERE project_id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;

        let res = sqlx::query(
            "UPDATE projects SET deleted_at = NOW(), updated_at = NOW() \
             WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;

        if res.rows_affected() == 0 {
            return Err(ApiError::not_found(format!("Project '{id}' not found")));
        }

        tx.commit().await?;

        if let Some(gid) = existing.goal_id {
            let _ = self.recalculate_goal_rollups(gid).await;
        }
        self.recalculate_goals_linked_to_project(id).await;

        Ok(())
    }

    // =========================================================================
    // 2. Deterministic NLP Quick-Capture Parser (`parse_quick_capture`)
    // =========================================================================

    pub fn parse_quick_capture(&self, raw_input: &str) -> Result<QuickCaptureParsed, ApiError> {
        parse_quick_capture_with_today(raw_input, Utc::now().date_naive())
    }

    // =========================================================================
    // 3. Tasks CRUD, GTD Perspectives & DFS Cycle Guard (`tasks`)
    // =========================================================================

    pub async fn list_tasks(&self, filter: TaskListFilter) -> Result<Vec<Task>, ApiError> {
        let mut qb = QueryBuilder::new(
            "SELECT id, title, description_md, status, priority, project_id, goal_id, course_id, \
                    lesson_id, parent_task_id, blocked_by_task_ids, vault_note_path, scheduled_date, \
                    due_date, estimated_minutes, actual_seconds, energy_level, tags, recurrence_rule, \
                    sort_order, completed_at, created_at, updated_at, deleted_at \
             FROM tasks WHERE deleted_at IS NULL",
        );

        if let Some(ref perspective) = filter.perspective {
            match perspective.trim().to_ascii_lowercase().as_str() {
                "inbox" => {
                    qb.push(" AND status = 'inbox'");
                }
                "today" => {
                    qb.push(
                        " AND status NOT IN ('done', 'canceled') \
                          AND (scheduled_date <= CURRENT_DATE \
                               OR (due_date IS NOT NULL AND due_date::date <= CURRENT_DATE) \
                               OR status = 'in_progress')",
                    );
                }
                "upcoming" => {
                    qb.push(
                        " AND status NOT IN ('done', 'canceled') \
                          AND ((scheduled_date > CURRENT_DATE AND scheduled_date <= CURRENT_DATE + 7) \
                               OR (due_date IS NOT NULL AND due_date::date > CURRENT_DATE AND due_date::date <= CURRENT_DATE + 7))",
                    );
                }
                "someday" | "backlog" => {
                    qb.push(" AND status = 'backlog'");
                }
                "projects" => {
                    qb.push(" AND project_id IS NOT NULL AND status != 'canceled'");
                }
                _ => {}
            }
        }

        if let Some(status) = filter.status {
            qb.push(" AND status = ").push_bind(status);
        }
        if let Some(project_id) = filter.project_id {
            qb.push(" AND project_id = ").push_bind(project_id);
        }
        if let Some(goal_id) = filter.goal_id {
            qb.push(" AND goal_id = ").push_bind(goal_id);
        }
        if let Some(course_id) = filter.course_id {
            qb.push(" AND course_id = ").push_bind(course_id);
        }
        if let Some(parent_task_id) = filter.parent_task_id {
            qb.push(" AND parent_task_id = ").push_bind(parent_task_id);
        }
        if let Some(priority) = filter.priority {
            qb.push(" AND priority = ").push_bind(priority);
        }
        if let Some(energy) = filter.energy_level {
            qb.push(" AND energy_level = ").push_bind(energy);
        }
        if let Some(due_before) = filter.due_before {
            qb.push(" AND due_date <= ").push_bind(due_before);
        }
        if let Some(scheduled_date) = filter.scheduled_date {
            qb.push(" AND scheduled_date = ").push_bind(scheduled_date);
        }
        if let Some(ref tag) = filter.tag {
            let clean_tag = tag.trim().trim_start_matches('#').to_ascii_lowercase();
            if !clean_tag.is_empty() {
                qb.push(" AND ").push_bind(clean_tag).push(" = ANY(tags)");
            }
        }
        if let Some(ref search) = filter.search {
            let q = search.trim();
            if !q.is_empty() {
                let pattern = format!("%{q}%");
                qb.push(" AND (title ILIKE ")
                    .push_bind(pattern.clone())
                    .push(" OR description_md ILIKE ")
                    .push_bind(pattern)
                    .push(")");
            }
        }

        qb.push(" ORDER BY sort_order ASC, created_at ASC");

        let tasks = qb.build_query_as::<Task>().fetch_all(&self.pool).await?;
        Ok(tasks)
    }

    pub async fn get_task(&self, id: Uuid) -> Result<Task, ApiError> {
        sqlx::query_as::<_, Task>(
            "SELECT id, title, description_md, status, priority, project_id, goal_id, course_id, \
                    lesson_id, parent_task_id, blocked_by_task_ids, vault_note_path, scheduled_date, \
                    due_date, estimated_minutes, actual_seconds, energy_level, tags, recurrence_rule, \
                    sort_order, completed_at, created_at, updated_at, deleted_at \
             FROM tasks WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| ApiError::not_found(format!("Task '{id}' not found")))
    }

    pub async fn create_task(&self, mut req: CreateTaskRequest) -> Result<Task, ApiError> {
        if let Some(raw_qc) = req.quick_capture.take() {
            let parsed = self.parse_quick_capture(&raw_qc)?;
            if req.title.trim().is_empty() {
                req.title = parsed.clean_title;
            }
            if req.tags.is_empty() {
                req.tags = parsed.tags;
            }
            if req.energy_level.is_none() {
                req.energy_level = parsed.energy_level;
            }
            if req.priority == TaskPriority::Medium && parsed.priority != TaskPriority::Medium {
                req.priority = parsed.priority;
            }
            if req.scheduled_date.is_none() {
                req.scheduled_date = parsed.scheduled_date;
            }
            if req.due_date.is_none() {
                req.due_date = parsed.due_at;
            }
            if req.estimated_minutes.is_none() {
                req.estimated_minutes = parsed.estimated_minutes;
            }
            if req.status == TaskStatus::Inbox && parsed.status != TaskStatus::Inbox {
                req.status = parsed.status;
            }
            if req.project_id.is_none() {
                if let Some(ref hint) = parsed.project_hint {
                    let matched_project: Option<Uuid> = sqlx::query_scalar(
                        "SELECT id FROM projects \
                         WHERE deleted_at IS NULL AND LOWER(name) = LOWER($1) \
                         LIMIT 1",
                    )
                    .bind(hint)
                    .fetch_optional(&self.pool)
                    .await?;
                    req.project_id = matched_project;
                }
            }
        }

        let title = req.title.trim();
        if title.is_empty() {
            return Err(ApiError::bad_request("Task title must not be empty"));
        }
        if let Some(est) = req.estimated_minutes {
            if est < 0 {
                return Err(ApiError::bad_request("estimated_minutes must be >= 0"));
            }
        }
        if let Some(ref vp) = req.vault_note_path {
            validate_vault_relative_path(vp)?;
        }

        let id = new_uuid_v7();
        let blocked_by = dedup_uuids(&req.blocked_by_task_ids);
        self.validate_no_dependency_cycle(id, &blocked_by, req.parent_task_id)
            .await?;

        let tags = normalize_tags(&req.tags);
        let sort_order = match req.sort_order {
            Some(so) => so,
            None => {
                let max_order: i32 = sqlx::query_scalar(
                    "SELECT COALESCE(MAX(sort_order), 0) FROM tasks WHERE deleted_at IS NULL",
                )
                .fetch_one(&self.pool)
                .await?;
                max_order + 1
            }
        };
        let completed_at = if req.status == TaskStatus::Done {
            Some(Utc::now())
        } else {
            None
        };

        let task = sqlx::query_as::<_, Task>(
            "INSERT INTO tasks ( \
                id, title, description_md, status, priority, project_id, goal_id, course_id, \
                lesson_id, parent_task_id, blocked_by_task_ids, vault_note_path, scheduled_date, \
                due_date, estimated_minutes, energy_level, tags, recurrence_rule, sort_order, completed_at \
             ) VALUES ( \
                $1, $2, $3, $4, $5, $6, $7, $8, \
                $9, $10, $11, $12, $13, \
                $14, $15, $16, $17, $18, $19, $20 \
             ) RETURNING id, title, description_md, status, priority, project_id, goal_id, course_id, \
                         lesson_id, parent_task_id, blocked_by_task_ids, vault_note_path, scheduled_date, \
                         due_date, estimated_minutes, actual_seconds, energy_level, tags, recurrence_rule, \
                         sort_order, completed_at, created_at, updated_at, deleted_at",
        )
        .bind(id)
        .bind(title)
        .bind(&req.description_md)
        .bind(req.status)
        .bind(req.priority)
        .bind(req.project_id)
        .bind(req.goal_id)
        .bind(req.course_id)
        .bind(req.lesson_id)
        .bind(req.parent_task_id)
        .bind(&blocked_by)
        .bind(req.vault_note_path)
        .bind(req.scheduled_date)
        .bind(req.due_date)
        .bind(req.estimated_minutes)
        .bind(req.energy_level)
        .bind(&tags)
        .bind(req.recurrence_rule)
        .bind(sort_order)
        .bind(completed_at)
        .fetch_one(&self.pool)
        .await?;

        self.emit_event(SystemEvent::TaskMutated {
            task_id: task.id,
            action: "created".to_string(),
            status: task_status_str(task.status).to_string(),
            timestamp: Utc::now(),
        });

        self.refresh_task_linked_goals(task.project_id, task.goal_id)
            .await;

        Ok(task)
    }

    pub async fn update_task(&self, id: Uuid, req: UpdateTaskRequest) -> Result<Task, ApiError> {
        let existing = self.get_task(id).await?;

        let title = match req.title {
            Some(t) => {
                let trimmed = t.trim();
                if trimmed.is_empty() {
                    return Err(ApiError::bad_request("Task title must not be empty"));
                }
                trimmed.to_string()
            }
            None => existing.title.clone(),
        };
        if let Some(est) = req.estimated_minutes {
            if est < 0 {
                return Err(ApiError::bad_request("estimated_minutes must be >= 0"));
            }
        }
        if let Some(act) = req.actual_seconds {
            if act < 0 {
                return Err(ApiError::bad_request("actual_seconds must be >= 0"));
            }
        }
        if let Some(ref vp) = req.vault_note_path {
            validate_vault_relative_path(vp)?;
        }

        let blocked_by = match req.blocked_by_task_ids {
            Some(ref ids) => dedup_uuids(ids),
            None => existing.blocked_by_task_ids.clone(),
        };
        let parent_task_id = req.parent_task_id.or(existing.parent_task_id);
        self.validate_no_dependency_cycle(id, &blocked_by, parent_task_id)
            .await?;

        let status = req.status.unwrap_or(existing.status);
        let completed_at = if status == TaskStatus::Done {
            Some(existing.completed_at.unwrap_or_else(Utc::now))
        } else {
            None
        };

        let description_md = req.description_md.unwrap_or(existing.description_md);
        let priority = req.priority.unwrap_or(existing.priority);
        let project_id = req.project_id.or(existing.project_id);
        let goal_id = req.goal_id.or(existing.goal_id);
        let course_id = req.course_id.or(existing.course_id);
        let lesson_id = req.lesson_id.or(existing.lesson_id);
        let vault_note_path = req.vault_note_path.or(existing.vault_note_path);
        let scheduled_date = req.scheduled_date.or(existing.scheduled_date);
        let due_date = req.due_date.or(existing.due_date);
        let estimated_minutes = req.estimated_minutes.or(existing.estimated_minutes);
        let actual_seconds = req.actual_seconds.unwrap_or(existing.actual_seconds);
        let energy_level = req.energy_level.or(existing.energy_level);
        let tags = req
            .tags
            .as_ref()
            .map(|t| normalize_tags(t))
            .unwrap_or(existing.tags);
        let recurrence_rule = req.recurrence_rule.or(existing.recurrence_rule);
        let sort_order = req.sort_order.unwrap_or(existing.sort_order);

        let updated = sqlx::query_as::<_, Task>(
            "UPDATE tasks SET \
                title = $2, description_md = $3, status = $4, priority = $5, project_id = $6, \
                goal_id = $7, course_id = $8, lesson_id = $9, parent_task_id = $10, \
                blocked_by_task_ids = $11, vault_note_path = $12, scheduled_date = $13, \
                due_date = $14, estimated_minutes = $15, actual_seconds = $16, \
                energy_level = $17, tags = $18, recurrence_rule = $19, sort_order = $20, \
                completed_at = $21, updated_at = NOW() \
             WHERE id = $1 AND deleted_at IS NULL \
             RETURNING id, title, description_md, status, priority, project_id, goal_id, course_id, \
                       lesson_id, parent_task_id, blocked_by_task_ids, vault_note_path, scheduled_date, \
                       due_date, estimated_minutes, actual_seconds, energy_level, tags, recurrence_rule, \
                       sort_order, completed_at, created_at, updated_at, deleted_at",
        )
        .bind(id)
        .bind(title)
        .bind(description_md)
        .bind(status)
        .bind(priority)
        .bind(project_id)
        .bind(goal_id)
        .bind(course_id)
        .bind(lesson_id)
        .bind(parent_task_id)
        .bind(blocked_by)
        .bind(vault_note_path)
        .bind(scheduled_date)
        .bind(due_date)
        .bind(estimated_minutes)
        .bind(actual_seconds)
        .bind(energy_level)
        .bind(tags)
        .bind(recurrence_rule)
        .bind(sort_order)
        .bind(completed_at)
        .fetch_one(&self.pool)
        .await?;

        self.emit_event(SystemEvent::TaskMutated {
            task_id: updated.id,
            action: "updated".to_string(),
            status: task_status_str(updated.status).to_string(),
            timestamp: Utc::now(),
        });

        self.refresh_task_linked_goals(existing.project_id, existing.goal_id)
            .await;
        self.refresh_task_linked_goals(updated.project_id, updated.goal_id)
            .await;

        Ok(updated)
    }

    pub async fn patch_task_status(&self, id: Uuid, status: TaskStatus) -> Result<Task, ApiError> {
        self.update_task(
            id,
            UpdateTaskRequest {
                status: Some(status),
                ..Default::default()
            },
        )
        .await
    }

    pub async fn complete_task(&self, id: Uuid) -> Result<Task, ApiError> {
        self.patch_task_status(id, TaskStatus::Done).await
    }

    pub async fn bulk_update_tasks(
        &self,
        req: BulkUpdateTasksRequest,
    ) -> Result<Vec<Task>, ApiError> {
        if req.task_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut results = Vec::with_capacity(req.task_ids.len());
        for task_id in &req.task_ids {
            if req.delete {
                self.delete_task(*task_id).await?;
            } else {
                let updated = self
                    .update_task(
                        *task_id,
                        UpdateTaskRequest {
                            status: req.status,
                            priority: req.priority,
                            project_id: req.project_id,
                            goal_id: req.goal_id,
                            energy_level: req.energy_level,
                            scheduled_date: req.scheduled_date,
                            ..Default::default()
                        },
                    )
                    .await?;
                results.push(updated);
            }
        }
        Ok(results)
    }

    pub async fn delete_task(&self, id: Uuid) -> Result<(), ApiError> {
        let existing = self.get_task(id).await?;
        let mut tx = self.pool.begin().await?;

        // Remove deleted task from any other task's blocked_by_task_ids array
        sqlx::query(
            "UPDATE tasks \
             SET blocked_by_task_ids = array_remove(blocked_by_task_ids, $1), \
                 updated_at = NOW() \
             WHERE $1 = ANY(blocked_by_task_ids) AND deleted_at IS NULL",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE tasks \
             SET parent_task_id = NULL, updated_at = NOW() \
             WHERE parent_task_id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;

        let res = sqlx::query(
            "UPDATE tasks SET deleted_at = NOW(), updated_at = NOW() \
             WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;

        if res.rows_affected() == 0 {
            return Err(ApiError::not_found(format!("Task '{id}' not found")));
        }

        tx.commit().await?;

        self.emit_event(SystemEvent::TaskMutated {
            task_id: id,
            action: "deleted".to_string(),
            status: "canceled".to_string(),
            timestamp: Utc::now(),
        });

        self.refresh_task_linked_goals(existing.project_id, existing.goal_id)
            .await;

        Ok(())
    }

    async fn validate_no_dependency_cycle(
        &self,
        task_id: Uuid,
        blocked_by: &[Uuid],
        parent_task_id: Option<Uuid>,
    ) -> Result<(), ApiError> {
        if blocked_by.contains(&task_id) || parent_task_id == Some(task_id) {
            return Err(ApiError::cycle_detected(format!(
                "Task '{task_id}' cannot be blocked by or parented to itself"
            )));
        }
        if blocked_by.is_empty() && parent_task_id.is_none() {
            return Ok(());
        }

        let rows = sqlx::query(
            "SELECT id, blocked_by_task_ids, parent_task_id \
             FROM tasks WHERE deleted_at IS NULL",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut adj: HashMap<Uuid, Vec<Uuid>> = HashMap::with_capacity(rows.len() + 1);
        for row in rows {
            let id: Uuid = row.try_get("id")?;
            let mut deps: Vec<Uuid> = row.try_get("blocked_by_task_ids")?;
            if let Some(pid) = row.try_get::<Option<Uuid>, _>("parent_task_id")? {
                deps.push(pid);
            }
            adj.insert(id, deps);
        }

        let mut proposed = blocked_by.to_vec();
        if let Some(pid) = parent_task_id {
            proposed.push(pid);
        }
        adj.insert(task_id, proposed.clone());

        // DFS from each proposed dependency/parent to verify `task_id` is not reachable
        let mut stack = proposed;
        let mut visited = HashSet::new();
        while let Some(curr) = stack.pop() {
            if curr == task_id {
                return Err(ApiError::cycle_detected(format!(
                    "Circular dependency detected involving task '{task_id}'"
                )));
            }
            if !visited.insert(curr) {
                continue;
            }
            if let Some(neighbors) = adj.get(&curr) {
                for &next in neighbors {
                    stack.push(next);
                }
            }
        }

        Ok(())
    }

    async fn refresh_task_linked_goals(&self, project_id: Option<Uuid>, goal_id: Option<Uuid>) {
        if let Some(gid) = goal_id {
            let _ = self.recalculate_goal_rollups(gid).await;
        }
        if let Some(pid) = project_id {
            self.recalculate_goals_linked_to_project(pid).await;
        }
    }

    pub(crate) async fn recalculate_goals_linked_to_project(&self, project_id: Uuid) {
        let goal_ids: Vec<Uuid> = sqlx::query_scalar(
            "SELECT DISTINCT goal_id FROM ( \
                SELECT goal_id FROM projects WHERE id = $1 AND goal_id IS NOT NULL \
                UNION \
                SELECT goal_id FROM goal_key_results WHERE metric_type = 'linked_project' AND linked_entity_id = $1 \
             ) t",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default();

        for gid in goal_ids {
            let _ = self.recalculate_goal_rollups(gid).await;
        }
    }

    // =========================================================================
    // 4. `REF-04` `TERMINAL-I/O` Flow Topology & Today Capacity Meter
    // =========================================================================

    pub async fn get_today_capacity(
        &self,
        focus_capacity_minutes: Option<i32>,
    ) -> Result<TodayCapacityMeter, ApiError> {
        let today = Utc::now().date_naive();
        let dow = today.weekday().num_days_from_monday() as i16; // 0 = Mon .. 6 = Sun

        let capacity_minutes = match focus_capacity_minutes {
            Some(c) if c > 0 => c.max(15),
            _ => {
                let ideal_mins: Option<i64> = sqlx::query_scalar(
                    "SELECT (SUM(EXTRACT(EPOCH FROM (end_time - start_time))) / 60)::BIGINT \
                     FROM ideal_week_blocks \
                     WHERE day_of_week = $1 AND category IN ('deep_work', 'learning')",
                )
                .bind(dow)
                .fetch_optional(&self.pool)
                .await?
                .flatten();
                ideal_mins.map(|m| (m as i32).max(60)).unwrap_or(240)
            }
        };

        let planned_minutes: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(COALESCE(estimated_minutes, 30)), 0)::BIGINT \
             FROM tasks \
             WHERE deleted_at IS NULL \
               AND status NOT IN ('done', 'canceled') \
               AND (scheduled_date <= CURRENT_DATE \
                    OR (due_date IS NOT NULL AND due_date::date <= CURRENT_DATE) \
                    OR status = 'in_progress')",
        )
        .fetch_one(&self.pool)
        .await?;

        let completed_session_secs: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(duration_seconds), 0)::BIGINT \
             FROM time_sessions \
             WHERE deleted_at IS NULL AND started_at::date = CURRENT_DATE AND ended_at IS NOT NULL",
        )
        .fetch_one(&self.pool)
        .await?;

        let active_timer = self.get_active_timer().await?;
        let active_secs = if active_timer.running {
            active_timer.elapsed_seconds.max(0)
        } else {
            0
        };

        let actual_seconds = completed_session_secs + active_secs;
        let actual_minutes = (actual_seconds / 60) as i32;
        let planned_i32 = planned_minutes as i32;
        let remaining_minutes = (capacity_minutes - planned_i32).max(0);
        let utilization_pct = if capacity_minutes > 0 {
            (((planned_i32 as f64 / capacity_minutes as f64) * 100.0) * 10.0).round() / 10.0
        } else {
            0.0
        };

        Ok(TodayCapacityMeter {
            focus_capacity_minutes: capacity_minutes,
            planned_minutes: planned_i32,
            actual_minutes,
            actual_seconds,
            remaining_minutes,
            utilization_pct,
            overloaded: planned_i32 > capacity_minutes,
        })
    }

    pub async fn get_task_flow(
        &self,
        project_id: Option<Uuid>,
    ) -> Result<ProjectFlowTopologyResponse, ApiError> {
        let hub_title = if let Some(pid) = project_id {
            if let Ok(proj) = self.get_project(pid).await {
                format!("CENTRAL ATRIUM // {}", proj.name.to_ascii_uppercase())
            } else {
                "CENTRAL ATRIUM".to_string()
            }
        } else {
            "CENTRAL ATRIUM // ALL PROJECTS".to_string()
        };

        let tasks = self
            .list_tasks(TaskListFilter {
                project_id,
                ..Default::default()
            })
            .await?;

        // Also fetch global `done` task IDs so cross-project dependencies resolve accurately
        let done_ids_vec: Vec<Uuid> = sqlx::query_scalar(
            "SELECT id FROM tasks WHERE deleted_at IS NULL AND status = 'done'",
        )
        .fetch_all(&self.pool)
        .await?;
        let done_task_ids: HashSet<Uuid> = done_ids_vec.into_iter().collect();

        // Tasks that actively block other non-done tasks
        let mut blocking_other_ids: HashSet<Uuid> = HashSet::new();
        for t in &tasks {
            if t.status != TaskStatus::Done && t.status != TaskStatus::Canceled {
                for &bid in &t.blocked_by_task_ids {
                    if !done_task_ids.contains(&bid) {
                        blocking_other_ids.insert(bid);
                    }
                }
            }
        }

        let hub_id = project_id.unwrap_or_else(Uuid::nil);
        let hub_node = FlowNode {
            id: hub_id,
            title: hub_title,
            stage: 0,
            status: TaskStatus::InProgress,
            x: 120.0,
            y: 300.0,
            node_kind: "hub".to_string(),
            stage_label: "CENTRAL_ATRIUM".to_string(),
            is_blocked: false,
            is_critical_path: true,
            color: "#2CE5F2".to_string(),
            blocked_by_task_ids: Vec::new(),
            parent_task_id: None,
            estimated_minutes: None,
            actual_seconds: 0,
        };

        let mut nodes = Vec::with_capacity(tasks.len() + 1);
        nodes.push(hub_node.clone());

        let mut stage_counts = [0usize; 5];
        let mut stage_tasks: [Vec<Uuid>; 4] = [Vec::new(), Vec::new(), Vec::new(), Vec::new()];
        let mut stage_minutes = [0i32; 4];

        let mut edges = Vec::new();
        let mut dependency_arcs = Vec::new();
        let mut subtask_edges = Vec::new();

        for t in &tasks {
            if t.status == TaskStatus::Canceled {
                continue;
            }
            let (stage, stage_code, stage_label, x) = match t.status {
                TaskStatus::Inbox | TaskStatus::Backlog | TaskStatus::Todo => (
                    1,
                    "STAGE_01",
                    "STAGE // 01 BACKLOG",
                    360.0,
                ),
                TaskStatus::InProgress => (2, "STAGE_02", "STAGE // 02 ACTIVE", 600.0),
                TaskStatus::Review => (3, "STAGE_03", "STAGE // 03 REVIEW", 840.0),
                TaskStatus::Done | TaskStatus::Canceled => {
                    (4, "STAGE_04", "STAGE // 04 DONE", 1080.0)
                }
            };
            let _ = stage_code;

            let idx_in_stage = stage_counts[stage as usize];
            stage_counts[stage as usize] += 1;
            stage_tasks[(stage - 1) as usize].push(t.id);
            stage_minutes[(stage - 1) as usize] += t.estimated_minutes.unwrap_or(30);

            let y = 100.0 + (idx_in_stage as f64) * 90.0;
            let is_blocked = t
                .blocked_by_task_ids
                .iter()
                .any(|bid| !done_task_ids.contains(bid))
                && t.status != TaskStatus::Done;
            let is_critical_path = !is_blocked
                && (t.status == TaskStatus::InProgress || blocking_other_ids.contains(&t.id));
            let color = if is_blocked {
                "#EB4511".to_string()
            } else if is_critical_path {
                "#2CE5F2".to_string()
            } else {
                "#F6F6F4".to_string()
            };

            nodes.push(FlowNode {
                id: t.id,
                title: t.title.clone(),
                stage,
                status: t.status,
                x,
                y,
                node_kind: "task".to_string(),
                stage_label: stage_label.to_string(),
                is_blocked,
                is_critical_path,
                color,
                blocked_by_task_ids: t.blocked_by_task_ids.clone(),
                parent_task_id: t.parent_task_id,
                estimated_minutes: t.estimated_minutes,
                actual_seconds: t.actual_seconds,
            });

            if t.parent_task_id.is_none() && t.blocked_by_task_ids.is_empty() {
                edges.push(FlowEdge {
                    from_id: hub_id,
                    to_id: t.id,
                    edge_type: "hub_to_stage".to_string(),
                    is_blocked,
                });
            }

            for &blocker_id in &t.blocked_by_task_ids {
                let dep_blocked = !done_task_ids.contains(&blocker_id);
                let edge = FlowEdge {
                    from_id: blocker_id,
                    to_id: t.id,
                    edge_type: "dependency".to_string(),
                    is_blocked: dep_blocked,
                };
                edges.push(edge.clone());
                dependency_arcs.push(edge);
            }

            if let Some(parent_id) = t.parent_task_id {
                let edge = FlowEdge {
                    from_id: parent_id,
                    to_id: t.id,
                    edge_type: "subtask".to_string(),
                    is_blocked: false,
                };
                edges.push(edge.clone());
                subtask_edges.push(edge);
            }
        }

        let stages = vec![
            FlowStageSummary {
                stage: 1,
                code: "STAGE_01".to_string(),
                label: "STAGE // 01 BACKLOG".to_string(),
                task_ids: stage_tasks[0].clone(),
                total_estimated_minutes: stage_minutes[0],
            },
            FlowStageSummary {
                stage: 2,
                code: "STAGE_02".to_string(),
                label: "STAGE // 02 ACTIVE".to_string(),
                task_ids: stage_tasks[1].clone(),
                total_estimated_minutes: stage_minutes[1],
            },
            FlowStageSummary {
                stage: 3,
                code: "STAGE_03".to_string(),
                label: "STAGE // 03 REVIEW".to_string(),
                task_ids: stage_tasks[2].clone(),
                total_estimated_minutes: stage_minutes[2],
            },
            FlowStageSummary {
                stage: 4,
                code: "STAGE_04".to_string(),
                label: "STAGE // 04 DONE".to_string(),
                task_ids: stage_tasks[3].clone(),
                total_estimated_minutes: stage_minutes[3],
            },
        ];

        let capacity = self.get_today_capacity(None).await?;

        Ok(ProjectFlowTopologyResponse {
            project_id,
            hub_node,
            stages,
            nodes,
            edges,
            dependency_arcs,
            subtask_edges,
            capacity,
        })
    }

    // =========================================================================
    // 5. Stopwatch / Pomodoro `ActiveTimer` & `TimeSession` Engine
    // =========================================================================

    pub async fn get_active_timer(&self) -> Result<ActiveTimerResponse, ApiError> {
        let query = format!(
            "{TIME_SESSION_SELECT} WHERE ended_at IS NULL AND deleted_at IS NULL LIMIT 1"
        );
        let session = sqlx::query_as::<_, TimeSession>(&query)
            .fetch_optional(&self.pool)
            .await?;

        match session {
            Some(sess) => {
                let elapsed = (Utc::now() - sess.started_at).num_seconds().max(0);
                Ok(ActiveTimerResponse {
                    running: true,
                    session: Some(sess),
                    elapsed_seconds: elapsed,
                })
            }
            None => Ok(ActiveTimerResponse {
                running: false,
                session: None,
                elapsed_seconds: 0,
            }),
        }
    }

    pub async fn start_timer(&self, req: StartTimerRequest) -> Result<ActiveTimerResponse, ApiError> {
        let now = Utc::now();
        let mut tx = self.pool.begin().await?;

        // 1. Respect `idx_time_sessions_single_active_timer`: lock and auto-stop any existing running timer
        let existing_query = format!(
            "{TIME_SESSION_SELECT} WHERE ended_at IS NULL AND deleted_at IS NULL FOR UPDATE"
        );
        let existing_active = sqlx::query_as::<_, TimeSession>(&existing_query)
            .fetch_all(&mut *tx)
            .await?;

        for active in existing_active {
            let elapsed = (now - active.started_at).num_seconds().max(1);
            sqlx::query(
                "UPDATE time_sessions \
                 SET ended_at = $2, duration_seconds = $3, updated_at = $2 \
                 WHERE id = $1",
            )
            .bind(active.id)
            .bind(now)
            .bind(elapsed)
            .execute(&mut *tx)
            .await?;

            if let Some(tid) = active.task_id {
                sqlx::query(
                    "UPDATE tasks SET actual_seconds = actual_seconds + $2, updated_at = $3 \
                     WHERE id = $1 AND deleted_at IS NULL",
                )
                .bind(tid)
                .bind(elapsed)
                .bind(now)
                .execute(&mut *tx)
                .await?;
            }
            if let Some(cid) = active.course_id {
                sqlx::query(
                    "UPDATE courses SET logged_study_seconds = logged_study_seconds + $2, updated_at = $3 \
                     WHERE id = $1",
                )
                .bind(cid)
                .bind(elapsed)
                .bind(now)
                .execute(&mut *tx)
                .await?;
            }
        }

        // 2. Default work/break minutes for Pomodoro presets
        let (default_work, default_break) = match req.timer_mode {
            TimerMode::Stopwatch => (None, None),
            TimerMode::Pomodoro25_5 => (Some(25), Some(5)),
            TimerMode::Pomodoro50_10 => (Some(50), Some(10)),
            TimerMode::Pomodoro90_15 => (Some(90), Some(15)),
            TimerMode::PomodoroCustom => (Some(25), Some(5)),
        };
        let work_minutes = req.work_minutes.or(default_work);
        let break_minutes = req.break_minutes.or(default_break);
        let category = if req.course_id.is_some() && req.category == TimeCategory::DeepWork {
            TimeCategory::Learning
        } else {
            req.category
        };
        let notes = req.notes.unwrap_or_default();

        let id = new_uuid_v7();
        let insert_query = format!(
            "INSERT INTO time_sessions ( \
                id, task_id, course_id, lesson_id, category, timer_mode, \
                work_minutes, break_minutes, started_at, ended_at, duration_seconds, notes \
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, 0, $10) \
             {TIME_SESSION_RETURNING}"
        );

        let session = sqlx::query_as::<_, TimeSession>(&insert_query)
            .bind(id)
            .bind(req.task_id)
            .bind(req.course_id)
            .bind(req.lesson_id)
            .bind(category)
            .bind(req.timer_mode)
            .bind(work_minutes)
            .bind(break_minutes)
            .bind(now)
            .bind(notes)
            .fetch_one(&mut *tx)
            .await?;

        tx.commit().await?;

        self.emit_event(SystemEvent::TimerUpdated {
            session_id: Some(session.id),
            task_id: session.task_id,
            course_id: session.course_id,
            running: true,
            elapsed_seconds: 0,
            timestamp: now,
        });

        Ok(ActiveTimerResponse {
            running: true,
            session: Some(session),
            elapsed_seconds: 0,
        })
    }

    pub async fn stop_timer(&self, req: StopTimerRequest) -> Result<TimeSession, ApiError> {
        if let Some(dur) = req.duration_seconds {
            if dur < 0 {
                return Err(ApiError::bad_request("duration_seconds must be >= 0"));
            }
        }

        let now = Utc::now();
        let mut tx = self.pool.begin().await?;

        let find_query = format!(
            "{TIME_SESSION_SELECT} WHERE ended_at IS NULL AND deleted_at IS NULL FOR UPDATE LIMIT 1"
        );
        let active = sqlx::query_as::<_, TimeSession>(&find_query)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| ApiError::not_found("No active focus timer is currently running"))?;

        let duration_seconds = req
            .duration_seconds
            .unwrap_or_else(|| (now - active.started_at).num_seconds().max(1));
        let notes = req.notes.unwrap_or_else(|| active.notes.clone());

        let update_query = format!(
            "UPDATE time_sessions \
             SET ended_at = $2, duration_seconds = $3, notes = $4, updated_at = $2 \
             WHERE id = $1 \
             {TIME_SESSION_RETURNING}"
        );
        let stopped = sqlx::query_as::<_, TimeSession>(&update_query)
            .bind(active.id)
            .bind(now)
            .bind(duration_seconds)
            .bind(notes)
            .fetch_one(&mut *tx)
            .await?;

        if duration_seconds > 0 {
            if let Some(tid) = stopped.task_id {
                sqlx::query(
                    "UPDATE tasks SET actual_seconds = actual_seconds + $2, updated_at = $3 \
                     WHERE id = $1 AND deleted_at IS NULL",
                )
                .bind(tid)
                .bind(duration_seconds)
                .bind(now)
                .execute(&mut *tx)
                .await?;
            }
            if let Some(cid) = stopped.course_id {
                sqlx::query(
                    "UPDATE courses SET logged_study_seconds = logged_study_seconds + $2, updated_at = $3 \
                     WHERE id = $1",
                )
                .bind(cid)
                .bind(duration_seconds)
                .bind(now)
                .execute(&mut *tx)
                .await?;
            }
        }

        tx.commit().await?;

        self.emit_event(SystemEvent::TimerUpdated {
            session_id: Some(stopped.id),
            task_id: stopped.task_id,
            course_id: stopped.course_id,
            running: false,
            elapsed_seconds: stopped.duration_seconds,
            timestamp: now,
        });

        Ok(stopped)
    }

    pub async fn discard_timer(&self) -> Result<ActiveTimerResponse, ApiError> {
        let now = Utc::now();
        let find_query = format!(
            "{TIME_SESSION_SELECT} WHERE ended_at IS NULL AND deleted_at IS NULL LIMIT 1"
        );
        let active = sqlx::query_as::<_, TimeSession>(&find_query)
            .fetch_optional(&self.pool)
            .await?;

        if let Some(sess) = active {
            sqlx::query(
                "UPDATE time_sessions \
                 SET deleted_at = $2, ended_at = $2, duration_seconds = 0, updated_at = $2 \
                 WHERE id = $1",
            )
            .bind(sess.id)
            .bind(now)
            .execute(&self.pool)
            .await?;

            self.emit_event(SystemEvent::TimerUpdated {
                session_id: Some(sess.id),
                task_id: sess.task_id,
                course_id: sess.course_id,
                running: false,
                elapsed_seconds: 0,
                timestamp: now,
            });
        }

        Ok(ActiveTimerResponse {
            running: false,
            session: None,
            elapsed_seconds: 0,
        })
    }

    pub async fn list_time_sessions(
        &self,
        task_id: Option<Uuid>,
        limit: Option<i64>,
    ) -> Result<Vec<TimeSession>, ApiError> {
        let clamped_limit = limit.unwrap_or(100).clamp(1, 500);
        let sessions = match task_id {
            Some(tid) => {
                let q = format!(
                    "{TIME_SESSION_SELECT} \
                     WHERE deleted_at IS NULL AND task_id = $1 \
                     ORDER BY started_at DESC LIMIT $2"
                );
                sqlx::query_as::<_, TimeSession>(&q)
                    .bind(tid)
                    .bind(clamped_limit)
                    .fetch_all(&self.pool)
                    .await?
            }
            None => {
                let q = format!(
                    "{TIME_SESSION_SELECT} \
                     WHERE deleted_at IS NULL \
                     ORDER BY started_at DESC LIMIT $1"
                );
                sqlx::query_as::<_, TimeSession>(&q)
                    .bind(clamped_limit)
                    .fetch_all(&self.pool)
                    .await?
            }
        };
        Ok(sessions)
    }

    pub async fn create_time_session(
        &self,
        req: CreateTimeSessionRequest,
    ) -> Result<TimeSession, ApiError> {
        if req.duration_seconds < 0 {
            return Err(ApiError::bad_request("duration_seconds must be >= 0"));
        }
        let now = Utc::now();
        let ended_at = Some(req.ended_at.unwrap_or(now));
        let started_at = req
            .started_at
            .unwrap_or_else(|| ended_at.unwrap() - Duration::seconds(req.duration_seconds));

        let mut tx = self.pool.begin().await?;
        let id = new_uuid_v7();
        let insert_query = format!(
            "INSERT INTO time_sessions ( \
                id, task_id, course_id, lesson_id, category, timer_mode, \
                work_minutes, break_minutes, started_at, ended_at, duration_seconds, notes \
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) \
             {TIME_SESSION_RETURNING}"
        );

        let session = sqlx::query_as::<_, TimeSession>(&insert_query)
            .bind(id)
            .bind(req.task_id)
            .bind(req.course_id)
            .bind(req.lesson_id)
            .bind(req.category)
            .bind(req.timer_mode)
            .bind(req.work_minutes)
            .bind(req.break_minutes)
            .bind(started_at)
            .bind(ended_at)
            .bind(req.duration_seconds)
            .bind(&req.notes)
            .fetch_one(&mut *tx)
            .await?;

        if req.duration_seconds > 0 {
            if let Some(tid) = session.task_id {
                sqlx::query(
                    "UPDATE tasks SET actual_seconds = actual_seconds + $2, updated_at = NOW() \
                     WHERE id = $1 AND deleted_at IS NULL",
                )
                .bind(tid)
                .bind(req.duration_seconds)
                .execute(&mut *tx)
                .await?;
            }
            if let Some(cid) = session.course_id {
                sqlx::query(
                    "UPDATE courses SET logged_study_seconds = logged_study_seconds + $2, updated_at = NOW() \
                     WHERE id = $1",
                )
                .bind(cid)
                .bind(req.duration_seconds)
                .execute(&mut *tx)
                .await?;
            }
        }

        tx.commit().await?;
        Ok(session)
    }

    pub async fn delete_time_session(&self, id: Uuid) -> Result<(), ApiError> {
        let mut tx = self.pool.begin().await?;
        let find_q = format!(
            "{TIME_SESSION_SELECT} WHERE id = $1 AND deleted_at IS NULL FOR UPDATE"
        );
        let sess = sqlx::query_as::<_, TimeSession>(&find_q)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| ApiError::not_found(format!("TimeSession '{id}' not found")))?;

        sqlx::query(
            "UPDATE time_sessions SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;

        if sess.ended_at.is_some() && sess.duration_seconds > 0 {
            if let Some(tid) = sess.task_id {
                sqlx::query(
                    "UPDATE tasks \
                     SET actual_seconds = GREATEST(0, actual_seconds - $2), updated_at = NOW() \
                     WHERE id = $1 AND deleted_at IS NULL",
                )
                .bind(tid)
                .bind(sess.duration_seconds)
                .execute(&mut *tx)
                .await?;
            }
            if let Some(cid) = sess.course_id {
                sqlx::query(
                    "UPDATE courses \
                     SET logged_study_seconds = GREATEST(0, logged_study_seconds - $2), updated_at = NOW() \
                     WHERE id = $1",
                )
                .bind(cid)
                .bind(sess.duration_seconds)
                .execute(&mut *tx)
                .await?;
            }
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn get_time_stats(&self) -> Result<TimeStatsResponse, ApiError> {
        let row = sqlx::query(
            "SELECT \
                COALESCE(SUM(duration_seconds) FILTER (WHERE started_at::date = CURRENT_DATE), 0)::BIGINT AS today_seconds, \
                COALESCE(SUM(duration_seconds) FILTER (WHERE started_at >= NOW() - INTERVAL '7 days'), 0)::BIGINT AS week_seconds, \
                COALESCE(SUM(duration_seconds) FILTER (WHERE started_at >= NOW() - INTERVAL '7 days' AND category = 'deep_work'), 0)::BIGINT AS deep_work_week_seconds, \
                COALESCE(SUM(duration_seconds) FILTER (WHERE started_at >= NOW() - INTERVAL '7 days' AND category = 'learning'), 0)::BIGINT AS learning_week_seconds \
             FROM time_sessions \
             WHERE deleted_at IS NULL AND ended_at IS NOT NULL",
        )
        .fetch_one(&self.pool)
        .await?;

        let today_seconds: i64 = row.try_get("today_seconds")?;
        let week_seconds: i64 = row.try_get("week_seconds")?;
        let deep_work_week_seconds: i64 = row.try_get("deep_work_week_seconds")?;
        let learning_week_seconds: i64 = row.try_get("learning_week_seconds")?;

        // Build 24 hourly buckets and 96 15-minute barcode buckets for today / trailing 24h
        let recent_rows = sqlx::query(
            "SELECT started_at, duration_seconds \
             FROM time_sessions \
             WHERE deleted_at IS NULL AND ended_at IS NOT NULL \
               AND started_at >= NOW() - INTERVAL '24 hours'",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut hourly_buckets_24h = vec![0_i64; 24];
        let mut barcode_buckets_96 = vec![0_i64; 96];

        for r in recent_rows {
            let started_at: DateTime<Utc> = r.try_get("started_at")?;
            let duration_seconds: i64 = r.try_get("duration_seconds")?;
            let hour = started_at.hour() as usize;
            let minute = started_at.minute() as usize;
            if hour < 24 {
                hourly_buckets_24h[hour] += duration_seconds;
            }
            let slot_96 = (hour * 4 + (minute / 15)).min(95);
            barcode_buckets_96[slot_96] += duration_seconds;
        }

        let capacity = self.get_today_capacity(None).await?;

        Ok(TimeStatsResponse {
            today_seconds,
            week_seconds,
            deep_work_week_seconds,
            learning_week_seconds,
            hourly_buckets_24h,
            barcode_buckets_96,
            focus_capacity_minutes: capacity.focus_capacity_minutes,
            planned_today_minutes: capacity.planned_minutes,
            actual_today_minutes: capacity.actual_minutes,
            capacity,
        })
    }
}

// =============================================================================
// Pure Deterministic NLP Quick-Capture Parser & Helpers
// =============================================================================

pub fn parse_quick_capture_with_today(
    raw_input: &str,
    today: NaiveDate,
) -> Result<QuickCaptureParsed, ApiError> {
    let trimmed = raw_input.trim();
    if trimmed.is_empty() {
        return Err(ApiError::bad_request(
            "Quick capture input must not be empty",
        ));
    }

    let raw_tokens: Vec<&str> = trimmed.split_whitespace().collect();
    let mut consumed = vec![false; raw_tokens.len()];

    let mut tags: Vec<String> = Vec::new();
    let mut energy_level: Option<TaskEnergyLevel> = None;
    let mut priority = TaskPriority::Medium;
    let mut scheduled_date: Option<NaiveDate> = None;
    let mut estimated_minutes: Option<i32> = None;
    let mut project_hint: Option<String> = None;

    // 1. Pre-scan multi-word relative date phrases:
    //    - "next week"
    //    - "next <weekday>"
    //    - "in <N> day(s)"
    let mut idx = 0;
    while idx < raw_tokens.len() {
        let w0 = clean_token_punct(raw_tokens[idx]).to_ascii_lowercase();
        if w0 == "next" && idx + 1 < raw_tokens.len() {
            let w1 = clean_token_punct(raw_tokens[idx + 1]).to_ascii_lowercase();
            if w1 == "week" {
                scheduled_date = Some(today + Duration::days(7));
                consumed[idx] = true;
                consumed[idx + 1] = true;
                idx += 2;
                continue;
            }
            if let Some(target_wd) = parse_weekday(&w1) {
                let today_num = today.weekday().num_days_from_monday() as i64;
                let target_num = target_wd.num_days_from_monday() as i64;
                let diff = (target_num - today_num + 7) % 7;
                let delta = if diff == 0 { 7 } else { diff };
                scheduled_date = Some(today + Duration::days(delta));
                consumed[idx] = true;
                consumed[idx + 1] = true;
                idx += 2;
                continue;
            }
        } else if w0 == "in" && idx + 2 < raw_tokens.len() {
            let w1 = clean_token_punct(raw_tokens[idx + 1]);
            let w2 = clean_token_punct(raw_tokens[idx + 2]).to_ascii_lowercase();
            if let Ok(days) = w1.parse::<i64>() {
                if days >= 0 && (w2 == "day" || w2 == "days" || w2 == "d") {
                    scheduled_date = Some(today + Duration::days(days));
                    consumed[idx] = true;
                    consumed[idx + 1] = true;
                    consumed[idx + 2] = true;
                    idx += 3;
                    continue;
                }
            }
        }
        idx += 1;
    }

    // 2. Scan remaining single tokens
    let mut title_words: Vec<String> = Vec::new();
    for (i, &tok) in raw_tokens.iter().enumerate() {
        if consumed[i] {
            continue;
        }
        let cleaned = clean_token_punct(tok);
        let lower = cleaned.to_ascii_lowercase();

        // #tag
        if let Some(rest) = lower.strip_prefix('#') {
            let tag: String = rest
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            if !tag.is_empty() {
                if project_hint.is_none() {
                    project_hint = Some(tag.clone());
                }
                if !tags.contains(&tag) {
                    tags.push(tag);
                }
                continue;
            }
        }

        // +project_hint
        if let Some(rest) = lower.strip_prefix('+') {
            let proj: String = rest
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            if !proj.is_empty() {
                project_hint = Some(proj);
                continue;
            }
        }

        // @energy_level
        if let Some(rest) = lower.strip_prefix('@') {
            match rest {
                "deep" | "deep_work" | "deep_focus" | "deep-work" | "deep-focus" => {
                    energy_level = Some(TaskEnergyLevel::Deep);
                    continue;
                }
                "shallow" | "low_energy" | "low-energy" | "low" => {
                    energy_level = Some(TaskEnergyLevel::Shallow);
                    continue;
                }
                "quick" | "quick_win" | "quick-win" | "fast" => {
                    energy_level = Some(TaskEnergyLevel::Quick);
                    continue;
                }
                _ => {}
            }
        }

        // !priority
        if let Some(rest) = lower.strip_prefix('!') {
            match rest {
                "p1" | "urgent" | "critical" => {
                    priority = TaskPriority::Urgent;
                    continue;
                }
                "p2" | "high" | "important" => {
                    priority = TaskPriority::High;
                    continue;
                }
                "p3" | "medium" | "med" | "normal" => {
                    priority = TaskPriority::Medium;
                    continue;
                }
                "p4" | "low" => {
                    priority = TaskPriority::Low;
                    continue;
                }
                _ => {}
            }
        }

        // Relative or ISO Date
        if lower == "today" || lower == "tod" {
            scheduled_date = Some(today);
            continue;
        }
        if lower == "tomorrow" || lower == "tmrw" || lower == "tom" {
            scheduled_date = Some(today + Duration::days(1));
            continue;
        }
        if cleaned.len() == 10 {
            if let Ok(iso_date) = NaiveDate::parse_from_str(cleaned, "%Y-%m-%d") {
                scheduled_date = Some(iso_date);
                continue;
            }
        }

        // Duration token (`30m`, `90m`, `2h`, `1.5h`, `1h30m`)
        if let Some(mins) = parse_duration_token(&lower) {
            estimated_minutes = Some(mins);
            continue;
        }

        title_words.push(tok.to_string());
    }

    let clean_title = if title_words.is_empty() {
        "Untitled Task".to_string()
    } else {
        title_words.join(" ")
    };

    let due_at = scheduled_date
        .and_then(|d| d.and_hms_opt(23, 59, 59))
        .map(|dt| dt.and_utc());
    let status = if scheduled_date.is_some() {
        TaskStatus::Todo
    } else {
        TaskStatus::Inbox
    };

    Ok(QuickCaptureParsed {
        clean_title,
        tags,
        energy_level,
        priority,
        scheduled_date,
        due_at,
        estimated_minutes,
        estimate_minutes: estimated_minutes,
        status,
        project_hint,
    })
}

fn clean_token_punct(tok: &str) -> &str {
    tok.trim_end_matches([',', ';', '.'])
}

fn parse_weekday(s: &str) -> Option<Weekday> {
    match s {
        "monday" | "mon" => Some(Weekday::Mon),
        "tuesday" | "tue" | "tues" => Some(Weekday::Tue),
        "wednesday" | "wed" => Some(Weekday::Wed),
        "thursday" | "thu" | "thur" | "thurs" => Some(Weekday::Thu),
        "friday" | "fri" => Some(Weekday::Fri),
        "saturday" | "sat" => Some(Weekday::Sat),
        "sunday" | "sun" => Some(Weekday::Sun),
        _ => None,
    }
}

fn parse_duration_token(s: &str) -> Option<i32> {
    let s = s.strip_prefix('~').unwrap_or(s);
    // 1. Combined `<H>h<M>m` (e.g. `1h30m`)
    if let Some(h_idx) = s.find('h') {
        let h_part = &s[..h_idx];
        let rest = &s[h_idx + 1..];
        if let Some(m_part) = rest
            .strip_suffix("mins")
            .or_else(|| rest.strip_suffix("min"))
            .or_else(|| rest.strip_suffix('m'))
        {
            if let (Ok(h), Ok(m)) = (h_part.parse::<i32>(), m_part.parse::<i32>()) {
                if h >= 0 && m >= 0 && (h > 0 || m > 0) {
                    return Some(h * 60 + m);
                }
            }
        }
    }

    // 2. Hours `<F>h` / `<F>hr` / `<F>hrs` (e.g. `2h`, `1.5h`)
    if let Some(num_str) = s
        .strip_suffix("hrs")
        .or_else(|| s.strip_suffix("hr"))
        .or_else(|| s.strip_suffix('h'))
    {
        if let Ok(hours) = num_str.parse::<f64>() {
            if hours > 0.0 && hours <= 24.0 {
                return Some((hours * 60.0).round() as i32);
            }
        }
    }

    // 3. Minutes `<M>m` / `<M>min` / `<M>mins` (e.g. `15m`, `90m`)
    if let Some(num_str) = s
        .strip_suffix("mins")
        .or_else(|| s.strip_suffix("min"))
        .or_else(|| s.strip_suffix('m'))
    {
        if let Ok(mins) = num_str.parse::<i32>() {
            if mins > 0 && mins <= 1440 {
                return Some(mins);
            }
        }
    }

    None
}

fn dedup_uuids(ids: &[Uuid]) -> Vec<Uuid> {
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(ids.len());
    for &id in ids {
        if seen.insert(id) {
            out.push(id);
        }
    }
    out
}

fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(tags.len());
    for t in tags {
        let clean = t.trim().trim_start_matches('#').to_ascii_lowercase();
        if !clean.is_empty() && seen.insert(clean.clone()) {
            out.push(clean);
        }
    }
    out
}

fn validate_vault_relative_path(path: &str) -> Result<(), ApiError> {
    let trimmed = path.trim();
    if trimmed.starts_with('/') || trimmed.contains("..") || trimmed.contains('\\') {
        return Err(ApiError::bad_request(
            "vault_note_path must be a safe relative Vault path without '..'",
        ));
    }
    Ok(())
}

fn task_status_str(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Inbox => "inbox",
        TaskStatus::Backlog => "backlog",
        TaskStatus::Todo => "todo",
        TaskStatus::InProgress => "in_progress",
        TaskStatus::Review => "review",
        TaskStatus::Done => "done",
        TaskStatus::Canceled => "canceled",
    }
}
