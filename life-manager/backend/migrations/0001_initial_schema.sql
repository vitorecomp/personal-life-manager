-- =============================================================================
-- 0001_initial_schema.sql
-- Complete PostgreSQL 16 + pgvector schema for HERMES // OS (Modules 01 - 11)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- -----------------------------------------------------------------------------
-- 1. Semantic Second Brain Vector Store (01, 04, 06)
-- -----------------------------------------------------------------------------
CREATE TABLE vault_embeddings (
    id UUID PRIMARY KEY,
    vault_note_path TEXT NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    heading TEXT NOT NULL DEFAULT '',
    content_text TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    embedding vector(384) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (vault_note_path, chunk_index)
);

CREATE INDEX idx_vault_embeddings_hnsw
    ON vault_embeddings USING hnsw (embedding vector_cosine_ops);

-- -----------------------------------------------------------------------------
-- 2. Operator Auth, Web Sessions, SHA-256 PATs & Scoped Mobile Sync (01, 02, 06)
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id UUID PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT 'Operator',
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'operator', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE web_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token_sha256 TEXT NOT NULL UNIQUE,
    user_agent TEXT NULL,
    ip_addr TEXT NULL,
    last_used_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_web_sessions_active_token
    ON web_sessions (session_token_sha256)
    WHERE revoked_at IS NULL;

CREATE TABLE api_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_prefix TEXT NOT NULL,
    token_sha256 TEXT NOT NULL UNIQUE,
    scopes TEXT[] NOT NULL DEFAULT ARRAY['*']::TEXT[],
    last_used_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_tokens_active_sha256
    ON api_tokens (token_sha256)
    WHERE revoked_at IS NULL;

CREATE TABLE companion_offline_phrases (
    id UUID PRIMARY KEY,
    phrase_text TEXT NOT NULL,
    trigger_context TEXT NOT NULL DEFAULT 'any'
        CHECK (trigger_context IN ('any', 'tap', 'screen_open', 'todo_done', 'routine_done')),
    animation_hint TEXT NULL
        CHECK (animation_hint IS NULL OR animation_hint IN (
            'grimoire', 'stargazing', 'blue_flower_spell', 'tea', 'nod_off', 'mimic_gag', 'idle_gaze', 'wind_blink'
        )),
    is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE sync_change_log (
    server_seq BIGSERIAL PRIMARY KEY,
    entity_table TEXT NOT NULL CHECK (entity_table IN (
        'projects',
        'tasks',
        'time_sessions',
        'routines',
        'routine_items',
        'routine_logs',
        'daily_checkins',
        'companion_offline_phrases'
    )),
    entity_id TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    client_mutation_id TEXT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_change_log_entity
    ON sync_change_log (entity_table, entity_id);

CREATE UNIQUE INDEX idx_sync_change_log_mutation_id
    ON sync_change_log (client_mutation_id)
    WHERE client_mutation_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Module 03 — Multi-Dashboard Room Monitor & Server Infrastructure Prober
-- -----------------------------------------------------------------------------
CREATE TABLE dashboards (
    id UUID PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    cycle_seconds INTEGER NOT NULL DEFAULT 60 CHECK (cycle_seconds >= 5 AND cycle_seconds <= 86400),
    in_rotation BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    layout_cols INTEGER NOT NULL DEFAULT 12 CHECK (layout_cols >= 1 AND layout_cols <= 24),
    layout_rows INTEGER NOT NULL DEFAULT 8 CHECK (layout_rows >= 1 AND layout_rows <= 24),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dashboards_rotation_order
    ON dashboards (in_rotation, sort_order ASC);

CREATE TABLE dashboard_widgets (
    id UUID PRIMARY KEY,
    dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('builtin', 'command', 'http', 'sql', 'hermes')),
    renderer_kind TEXT NOT NULL CHECK (renderer_kind IN ('kpi', 'sparkline', 'waffle', 'bar', 'table', 'terminal', 'custom_module')),
    grid_rect JSONB NOT NULL DEFAULT '{"x":0,"y":0,"w":4,"h":2}'::jsonb,
    source_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    refresh_interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (refresh_interval_seconds >= 5),
    cached_payload JSONB NULL,
    last_refreshed_at TIMESTAMPTZ NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dashboard_widgets_dashboard
    ON dashboard_widgets (dashboard_id, sort_order ASC);

CREATE TABLE server_nodes (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22 CHECK (port >= 1 AND port <= 65535),
    check_type TEXT NOT NULL DEFAULT 'tcp' CHECK (check_type IN ('tcp', 'http')),
    http_url TEXT NULL,
    status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('online', 'degraded', 'offline', 'unknown')),
    last_latency_ms BIGINT NULL,
    last_message TEXT NULL,
    latency_history_ms BIGINT[] NOT NULL DEFAULT '{}'::BIGINT[],
    last_checked_at TIMESTAMPTZ NULL,
    tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. Modules 04, 05, 06 — Hermes Sessions, Agent Studio Knights & MCP Safety
-- -----------------------------------------------------------------------------
CREATE TABLE agents (
    id UUID PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    knight_archetype TEXT NOT NULL CHECK (knight_archetype IN ('paladin', 'vanguard', 'lore_warden', 'inquisitor', 'artificer')),
    crest_color TEXT NOT NULL DEFAULT '#F87C18',
    sprite_sheet_id TEXT NULL,
    grid_pos JSONB NOT NULL DEFAULT '{"x":0,"y":0,"zone":"cron_watchtower"}'::jsonb,
    hermes_profile TEXT NULL,
    system_prompt TEXT NOT NULL,
    model_config JSONB NOT NULL DEFAULT '{"model":"hermes-3-llama-3.1-70b","thinking_effort":"medium","max_context_tokens":128000}'::jsonb,
    tools_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
    monthly_budget_cents BIGINT NOT NULL DEFAULT 500 CHECK (monthly_budget_cents >= 0),
    is_mastermind_member BOOLEAN NOT NULL DEFAULT FALSE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_triggers (
    id UUID PRIMARY KEY,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('cron', 'event', 'webhook')),
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at TIMESTAMPTZ NULL,
    next_run_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_triggers_agent
    ON agent_triggers (agent_id, enabled);

CREATE TABLE hermes_sessions_index (
    session_key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'hermes_view' CHECK (origin IN ('hermes_view', 'frieren_popover', 'knight_run')),
    profile_slug TEXT NULL,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    folder_name TEXT NULL,
    parent_session_key TEXT NULL REFERENCES hermes_sessions_index(session_key) ON DELETE SET NULL,
    branched_at_turn INTEGER NULL,
    high_level_mode BOOLEAN NOT NULL DEFAULT FALSE,
    last_route_context JSONB NULL,
    messages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hermes_sessions_rail
    ON hermes_sessions_index (archived, pinned DESC, updated_at DESC);

CREATE TABLE agent_runs (
    id UUID PRIMARY KEY,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    trigger_id UUID NULL REFERENCES agent_triggers(id) ON DELETE SET NULL,
    hermes_session_key TEXT NULL,
    is_dry_run BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'awaiting_approval', 'succeeded', 'failed')),
    steps_trace JSONB NOT NULL DEFAULT '[]'::jsonb,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_agent_runs_agent_started
    ON agent_runs (agent_id, started_at DESC);

CREATE TABLE pending_mcp_approvals (
    id UUID PRIMARY KEY,
    session_key TEXT NOT NULL DEFAULT 'mcp-direct',
    agent_run_id UUID NULL REFERENCES agent_runs(id) ON DELETE SET NULL,
    tool_name TEXT NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    result_json JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_pending_mcp_approvals_status
    ON pending_mcp_approvals (status, created_at DESC);

CREATE TABLE mcp_undo_actions (
    id UUID PRIMARY KEY,
    session_key TEXT NOT NULL DEFAULT 'mcp-direct',
    tool_name TEXT NOT NULL,
    entity_table TEXT NULL,
    entity_id TEXT NULL,
    undo_kind TEXT NOT NULL DEFAULT 'restore_snapshot',
    undo_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    undone_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 5. Module 09 — Yearly Goals & REF-03 Orthogonal Blueprint
-- (Created before 07, 08, 10 so goal_id FKs resolve inline)
-- -----------------------------------------------------------------------------
CREATE TABLE yearly_cycles (
    year INTEGER PRIMARY KEY CHECK (year >= 2000 AND year <= 2100),
    theme TEXT NOT NULL,
    vision_md TEXT NOT NULL DEFAULT '',
    anti_goals_md TEXT NOT NULL DEFAULT '',
    focus_cap_limit INTEGER NOT NULL DEFAULT 6 CHECK (focus_cap_limit >= 1),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planning', 'active', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE goals (
    id UUID PRIMARY KEY,
    year INTEGER NOT NULL REFERENCES yearly_cycles(year) ON DELETE CASCADE,
    pillar TEXT NOT NULL CHECK (pillar IN (
        'career', 'health', 'learning', 'finance', 'personal', 'personal_project', 'relationships', 'systems'
    )),
    code TEXT NOT NULL DEFAULT 'G01',
    title TEXT NOT NULL,
    why_motivation_md TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
        'not_started', 'in_progress', 'completed', 'paused', 'dropped'
    )),
    priority_rank INTEGER NOT NULL DEFAULT 1,
    target_date DATE NULL,
    progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
    confidence_score SMALLINT NOT NULL DEFAULT 7 CHECK (confidence_score BETWEEN 1 AND 10),
    blueprint_pos JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_goals_year_pillar
    ON goals (year, pillar, priority_rank ASC);

CREATE TABLE goal_key_results (
    id UUID PRIMARY KEY,
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    quarter TEXT NOT NULL DEFAULT 'ANNUAL' CHECK (quarter IN ('Q1', 'Q2', 'Q3', 'Q4', 'ANNUAL')),
    code TEXT NOT NULL DEFAULT 'KR1.1',
    title TEXT NOT NULL,
    metric_type TEXT NOT NULL CHECK (metric_type IN (
        'numeric', 'milestones', 'binary', 'linked_course', 'linked_finance', 'linked_habit', 'linked_project'
    )),
    start_value NUMERIC(14,2) NOT NULL DEFAULT 0,
    current_value NUMERIC(14,2) NOT NULL DEFAULT 0,
    target_value NUMERIC(14,2) NOT NULL DEFAULT 100,
    unit TEXT NOT NULL DEFAULT '%',
    milestones_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    linked_entity_id UUID NULL,
    weight NUMERIC(5,2) NOT NULL DEFAULT 1.0 CHECK (weight >= 0),
    blueprint_pos JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_goal_key_results_goal
    ON goal_key_results (goal_id, quarter);

CREATE TABLE goal_checkins (
    id UUID PRIMARY KEY,
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    checkin_date DATE NOT NULL DEFAULT CURRENT_DATE,
    progress_snapshot NUMERIC(5,2) NOT NULL DEFAULT 0,
    confidence_score SMALLINT NOT NULL DEFAULT 7 CHECK (confidence_score BETWEEN 1 AND 10),
    wins_md TEXT NOT NULL DEFAULT '',
    blockers_md TEXT NOT NULL DEFAULT '',
    next_steps_md TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_goal_checkins_goal_date
    ON goal_checkins (goal_id, checkin_date DESC);

-- -----------------------------------------------------------------------------
-- 6. Module 10 — Course & Learning Tracker
-- (Created before 07 so course_id and lesson_id FKs resolve inline)
-- -----------------------------------------------------------------------------
CREATE TABLE courses (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'custom' CHECK (provider IN (
        'udemy', 'coursera', 'youtube', 'book', 'certification', 'university', 'frontend_masters', 'custom'
    )),
    instructor TEXT NOT NULL DEFAULT '',
    source_url TEXT NULL,
    status TEXT NOT NULL DEFAULT 'wishlist' CHECK (status IN (
        'wishlist', 'active', 'capstone', 'completed', 'paused', 'dropped'
    )),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    goal_id UUID NULL REFERENCES goals(id) ON DELETE SET NULL,
    youtube_playlist_id TEXT NULL UNIQUE,
    vault_folder_path TEXT NULL,
    certificate_url TEXT NULL,
    practice_scores_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    total_items INTEGER NOT NULL DEFAULT 0,
    completed_items INTEGER NOT NULL DEFAULT 0,
    progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
    estimated_total_minutes INTEGER NOT NULL DEFAULT 0,
    logged_study_seconds BIGINT NOT NULL DEFAULT 0,
    target_completion_date DATE NULL,
    started_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    rating SMALLINT NULL CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
    takeaways_md TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE course_modules (
    id UUID PRIMARY KEY,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_course_modules_course
    ON course_modules (course_id, sort_order ASC);

CREATE TABLE course_lessons (
    id UUID PRIMARY KEY,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'distilled', 'completed')),
    external_url TEXT NULL,
    youtube_video_id TEXT NULL,
    vault_note_path TEXT NULL,
    key_summary_md TEXT NOT NULL DEFAULT '',
    completed_at TIMESTAMPTZ NULL,
    review_stage SMALLINT NOT NULL DEFAULT 0 CHECK (review_stage BETWEEN 0 AND 3),
    next_review_date DATE NULL,
    last_reviewed_at TIMESTAMPTZ NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_course_lessons_course_module
    ON course_lessons (course_id, module_id, sort_order ASC);

CREATE INDEX idx_course_lessons_due_reviews
    ON course_lessons (next_review_date ASC)
    WHERE next_review_date IS NOT NULL AND review_stage < 3;

-- -----------------------------------------------------------------------------
-- 7. Module 07 — Todo List, Dependency Graph & Focus Timer
-- -----------------------------------------------------------------------------
CREATE TABLE projects (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT 'personal' CHECK (area IN (
        'career', 'health', 'learning', 'finance', 'personal', 'personal_project', 'relationships', 'systems'
    )),
    goal_id UUID NULL REFERENCES goals(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
    color TEXT NOT NULL DEFAULT '#F87C18',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE tasks (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    description_md TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN (
        'inbox', 'backlog', 'todo', 'in_progress', 'review', 'done', 'canceled'
    )),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
    goal_id UUID NULL REFERENCES goals(id) ON DELETE SET NULL,
    course_id UUID NULL REFERENCES courses(id) ON DELETE SET NULL,
    lesson_id UUID NULL REFERENCES course_lessons(id) ON DELETE SET NULL,
    parent_task_id UUID NULL REFERENCES tasks(id) ON DELETE CASCADE,
    blocked_by_task_ids UUID[] NOT NULL DEFAULT '{}'::UUID[],
    vault_note_path TEXT NULL,
    scheduled_date DATE NULL,
    due_date TIMESTAMPTZ NULL,
    estimated_minutes INTEGER NULL,
    actual_seconds BIGINT NOT NULL DEFAULT 0,
    energy_level TEXT NULL CHECK (energy_level IS NULL OR energy_level IN ('deep', 'shallow', 'quick')),
    tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    recurrence_rule TEXT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    completed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_tasks_status_scheduled
    ON tasks (status, scheduled_date)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_tasks_project
    ON tasks (project_id)
    WHERE deleted_at IS NULL;

CREATE TABLE time_sessions (
    id UUID PRIMARY KEY,
    task_id UUID NULL REFERENCES tasks(id) ON DELETE SET NULL,
    course_id UUID NULL REFERENCES courses(id) ON DELETE SET NULL,
    lesson_id UUID NULL REFERENCES course_lessons(id) ON DELETE SET NULL,
    category TEXT NOT NULL DEFAULT 'deep_work' CHECK (category IN (
        'deep_work', 'learning', 'maintenance', 'admin', 'health'
    )),
    timer_mode TEXT NOT NULL DEFAULT 'stopwatch' CHECK (timer_mode IN (
        'stopwatch', 'pomodoro', 'pomodoro_25_5', 'pomodoro_50_10', 'pomodoro_90_15', 'pomodoro_custom'
    )),
    work_minutes INTEGER NULL,
    break_minutes INTEGER NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ NULL,
    duration_seconds BIGINT NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX idx_time_sessions_single_active_timer
    ON time_sessions ((1))
    WHERE ended_at IS NULL AND deleted_at IS NULL;

CREATE INDEX idx_time_sessions_started_at
    ON time_sessions (started_at DESC)
    WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 8. Module 08 — Routine Planning, Habits, Check-Ins & Ideal Week
-- -----------------------------------------------------------------------------
CREATE TABLE routines (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    time_slot TEXT NOT NULL CHECK (time_slot IN ('morning', 'afternoon', 'shutdown', 'evening', 'custom')),
    day_profile TEXT NOT NULL DEFAULT 'workday' CHECK (day_profile IN (
        'workday', 'weekend', 'travel', 'minimum_viable', 'all'
    )),
    target_start_time TIME NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE routine_items (
    id UUID PRIMARY KEY,
    routine_id UUID NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    goal_id UUID NULL REFERENCES goals(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    tracking_type TEXT NOT NULL DEFAULT 'boolean' CHECK (tracking_type IN ('boolean', 'numeric', 'duration')),
    target_value NUMERIC(10,2) NULL,
    unit TEXT NULL,
    frequency_type TEXT NOT NULL DEFAULT 'daily' CHECK (frequency_type IN ('daily', 'weekdays', 'times_per_week')),
    frequency_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    estimated_minutes INTEGER NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_routine_items_routine
    ON routine_items (routine_id, sort_order ASC)
    WHERE deleted_at IS NULL;

CREATE TABLE routine_logs (
    id UUID PRIMARY KEY,
    routine_item_id UUID NOT NULL REFERENCES routine_items(id) ON DELETE CASCADE,
    log_date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('completed', 'partial', 'skipped')),
    numeric_value NUMERIC(10,2) NULL,
    completed_at TIMESTAMPTZ NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    UNIQUE (routine_item_id, log_date)
);

CREATE INDEX idx_routine_logs_date
    ON routine_logs (log_date DESC);

CREATE TABLE daily_checkins (
    log_date DATE PRIMARY KEY,
    day_profile_used TEXT NOT NULL DEFAULT 'workday' CHECK (day_profile_used IN (
        'workday', 'weekend', 'travel', 'minimum_viable'
    )),
    energy_score SMALLINT NULL CHECK (energy_score IS NULL OR (energy_score BETWEEN 1 AND 5)),
    mood_score SMALLINT NULL CHECK (mood_score IS NULL OR (mood_score BETWEEN 1 AND 5)),
    sleep_hours NUMERIC(4,2) NULL,
    highlight TEXT NOT NULL DEFAULT '',
    reflection_md TEXT NOT NULL DEFAULT '',
    weekly_review_json JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE ideal_week_blocks (
    id UUID PRIMARY KEY,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL CHECK (end_time > start_time),
    category TEXT NOT NULL CHECK (category IN (
        'deep_work', 'learning', 'health', 'exercise', 'admin', 'maintenance', 'rest'
    )),
    linked_goal_id UUID NULL REFERENCES goals(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 9. Module 11 — Finance Operator (Portfolio, Macro Spend Sheet & FIRE Engine)
-- -----------------------------------------------------------------------------
CREATE TABLE portfolio_assets (
    id UUID PRIMARY KEY,
    symbol TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    asset_class TEXT NOT NULL CHECK (asset_class IN (
        'br_equity', 'br_fii', 'br_fixed_income', 'us_equity', 'global_etf', 'crypto', 'cash'
    )),
    currency TEXT NOT NULL CHECK (currency IN ('BRL', 'USD')),
    in_portfolio BOOLEAN NOT NULL DEFAULT TRUE,
    quantity NUMERIC(18,8) NOT NULL DEFAULT 0,
    avg_cost_cents BIGINT NOT NULL DEFAULT 0,
    current_price_cents BIGINT NOT NULL DEFAULT 0,
    previous_close_cents BIGINT NULL,
    dividend_yield_pct NUMERIC(6,2) NULL,
    target_weight_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (target_weight_pct >= 0 AND target_weight_pct <= 100),
    alert_low_cents BIGINT NULL,
    alert_high_cents BIGINT NULL,
    thesis_md TEXT NOT NULL DEFAULT '',
    quote_source TEXT NOT NULL DEFAULT 'manual',
    last_quote_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE monthly_investment_plans (
    month TEXT PRIMARY KEY CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency IN ('BRL', 'USD')),
    fx_usd_brl NUMERIC(10,4) NOT NULL DEFAULT 5.0000 CHECK (fx_usd_brl > 0),
    salary_income_cents BIGINT NOT NULL DEFAULT 0,
    planned_spend_cents BIGINT NOT NULL DEFAULT 0,
    actual_spend_cents BIGINT NULL,
    planned_investment_cents BIGINT NOT NULL DEFAULT 0,
    actual_invested_cents BIGINT NOT NULL DEFAULT 0,
    allocations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes_md TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE retirement_config (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    expected_real_return_pct NUMERIC(5,2) NOT NULL DEFAULT 6.50,
    safe_withdrawal_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 4.00 CHECK (safe_withdrawal_rate_pct > 0),
    override_retirement_monthly_spend_cents BIGINT NULL,
    macro_class_targets_json JSONB NOT NULL DEFAULT '{"us_equity":40,"br_equity_fii":25,"fixed_income":25,"crypto":10}'::jsonb,
    current_age SMALLINT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE portfolio_snapshots (
    snapshot_date DATE PRIMARY KEY,
    total_brl_cents BIGINT NOT NULL DEFAULT 0,
    total_usd_cents BIGINT NOT NULL DEFAULT 0,
    fx_usd_brl NUMERIC(10,4) NOT NULL DEFAULT 5.0000,
    fi_target_brl_cents BIGINT NOT NULL DEFAULT 0,
    projected_years_to_fi NUMERIC(6,2) NULL,
    breakdown_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE asset_quote_history (
    symbol TEXT NOT NULL,
    range_key TEXT NOT NULL CHECK (range_key IN ('1D', '7D', '1M', '1Y', 'ALL')),
    candles_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    quote_source TEXT NOT NULL DEFAULT 'cached',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (symbol, range_key)
);

CREATE TABLE fx_rates_cache (
    pair TEXT PRIMARY KEY,
    rate NUMERIC(12,6) NOT NULL CHECK (rate > 0),
    source TEXT NOT NULL DEFAULT 'seeded',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
