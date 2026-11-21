-- =============================================================================
-- 0003_seed_defaults.sql
-- Idempotent starter seeds: operator admin, DECK_01..04 + widgets, 4 Starter
-- Knights + triggers, 8 companion_offline_phrases, retirement_config, 2026 cycle
-- =============================================================================

-- 1. Operator Admin Account (valid argon2 0.6.0 PHC hash of "hermes-os-local")
INSERT INTO users (id, username, password_hash, display_name, role)
VALUES (
    '01932a00-0000-7000-8000-000000000001',
    'operator',
    '$argon2id$v=19$m=19456,t=2,p=1$OSSP9Vaaetn0PZKArJ9I0w$ZFh4FtCxnDfSoOKM6plRAWuOeuxKNyDj2XlWQJWSA2U',
    'Operator',
    'admin'
)
ON CONFLICT (username) DO NOTHING;

-- 2. Room Monitor Starter Decks (DECK_01 .. DECK_04)
INSERT INTO dashboards (id, slug, title, cycle_seconds, in_rotation, sort_order, layout_cols, layout_rows)
VALUES
    ('01932a00-0000-7000-8000-000000000101', 'tactical-ops', 'DECK_01 // TACTICAL_OPS', 60, TRUE, 1, 12, 8),
    ('01932a00-0000-7000-8000-000000000102', 'wealth-fire', 'DECK_02 // WEALTH_&_FIRE', 60, TRUE, 2, 12, 8),
    ('01932a00-0000-7000-8000-000000000103', 'strategy-lore', 'DECK_03 // STRATEGY_&_LORE', 60, TRUE, 3, 12, 8),
    ('01932a00-0000-7000-8000-000000000104', 'infra-knights', 'DECK_04 // INFRA_&_KNIGHTS', 60, TRUE, 4, 12, 8)
ON CONFLICT (slug) DO NOTHING;

-- 3. Starter Built-in & Telemetry Widgets Across DECK_01 .. DECK_04
INSERT INTO dashboard_widgets (
    id, dashboard_id, title, source_kind, renderer_kind, grid_rect, source_config, refresh_interval_seconds, sort_order
)
VALUES
    ('01932a00-0000-7000-8000-000000000201', '01932a00-0000-7000-8000-000000000101', 'LIFE_TELEMETRY_INDEX', 'builtin', 'custom_module', '{"x":0,"y":0,"w":4,"h":4}'::jsonb, '{"builtin_key":"life_score","widget_type":"life_radar"}'::jsonb, 60, 1),
    ('01932a00-0000-7000-8000-000000000202', '01932a00-0000-7000-8000-000000000101', 'FOCUS_&_TODO_VELOCITY', 'builtin', 'bar', '{"x":4,"y":0,"w":4,"h":4}'::jsonb, '{"builtin_key":"focus_todos","widget_type":"focus_velocity"}'::jsonb, 30, 2),
    ('01932a00-0000-7000-8000-000000000203', '01932a00-0000-7000-8000-000000000101', 'ROUTINES_&_BIO_CONSISTENCY', 'builtin', 'sparkline', '{"x":8,"y":0,"w":4,"h":4}'::jsonb, '{"builtin_key":"routines_bio","widget_type":"routine_consistency"}'::jsonb, 60, 3),
    ('01932a00-0000-7000-8000-000000000204', '01932a00-0000-7000-8000-000000000101', '24H_FOCUS_BARCODE', 'builtin', 'bar', '{"x":0,"y":4,"w":12,"h":4}'::jsonb, '{"builtin_key":"focus_barcode","widget_type":"focus_velocity"}'::jsonb, 60, 4),
    ('01932a00-0000-7000-8000-000000000205', '01932a00-0000-7000-8000-000000000102', 'PORTFOLIO_WAFFLE_&_TICKER', 'builtin', 'waffle', '{"x":0,"y":0,"w":6,"h":5}'::jsonb, '{"builtin_key":"portfolio_waffle","widget_type":"portfolio_fire"}'::jsonb, 120, 1),
    ('01932a00-0000-7000-8000-000000000206', '01932a00-0000-7000-8000-000000000102', 'RETIREMENT_FIRE_GAUGE', 'builtin', 'kpi', '{"x":6,"y":0,"w":6,"h":5}'::jsonb, '{"builtin_key":"fire_gauge","widget_type":"portfolio_fire"}'::jsonb, 120, 2),
    ('01932a00-0000-7000-8000-000000000207', '01932a00-0000-7000-8000-000000000102', 'MONTHLY_INVESTABLE_SURPLUS', 'builtin', 'bar', '{"x":0,"y":5,"w":12,"h":3}'::jsonb, '{"builtin_key":"monthly_surplus","widget_type":"portfolio_fire"}'::jsonb, 120, 3),
    ('01932a00-0000-7000-8000-000000000208', '01932a00-0000-7000-8000-000000000103', 'YEARLY_GOAL_BLUEPRINT', 'builtin', 'custom_module', '{"x":0,"y":0,"w":6,"h":4}'::jsonb, '{"builtin_key":"goals_blueprint","widget_type":"goals_courses"}'::jsonb, 120, 1),
    ('01932a00-0000-7000-8000-000000000209', '01932a00-0000-7000-8000-000000000103', 'COURSE_MOMENTUM_&_REVIEWS', 'builtin', 'bar', '{"x":6,"y":0,"w":6,"h":4}'::jsonb, '{"builtin_key":"courses_momentum","widget_type":"goals_courses"}'::jsonb, 120, 2),
    ('01932a00-0000-7000-8000-000000000210', '01932a00-0000-7000-8000-000000000103', 'SECOND_BRAIN_CONSTELLATION', 'builtin', 'custom_module', '{"x":0,"y":4,"w":12,"h":4}'::jsonb, '{"builtin_key":"second_brain_constellation","widget_type":"goals_courses"}'::jsonb, 300, 3),
    ('01932a00-0000-7000-8000-000000000211', '01932a00-0000-7000-8000-000000000104', 'SERVER_INFRASTRUCTURE_PROBER', 'builtin', 'table', '{"x":0,"y":0,"w":6,"h":5}'::jsonb, '{"builtin_key":"server_prober","widget_type":"server_prober"}'::jsonb, 30, 1),
    ('01932a00-0000-7000-8000-000000000212', '01932a00-0000-7000-8000-000000000104', 'KNIGHT_ORDER_&_HERMES_PULSE', 'builtin', 'custom_module', '{"x":6,"y":0,"w":6,"h":5}'::jsonb, '{"builtin_key":"knights_pulse","widget_type":"knight_pulse"}'::jsonb, 60, 2),
    ('01932a00-0000-7000-8000-000000000213', '01932a00-0000-7000-8000-000000000104', 'ACTIVE_DECK_TELEMETRY_SQL', 'sql', 'table', '{"x":0,"y":5,"w":12,"h":3}'::jsonb, '{"query":"SELECT slug, title, cycle_seconds, in_rotation FROM dashboards ORDER BY sort_order ASC"}'::jsonb, 60, 3)
ON CONFLICT (id) DO NOTHING;

-- 4. Starter Order of Knights (05-agent-studio.md §4)
INSERT INTO agents (
    id, slug, name, knight_archetype, crest_color, sprite_sheet_id, grid_pos, hermes_profile,
    system_prompt, model_config, tools_policy, monthly_budget_cents, is_mastermind_member, enabled
)
VALUES
    (
        '01932a00-0000-7000-8000-000000000301',
        'sir-chronos',
        'Sir Chronos',
        'paladin',
        '#F87C18',
        'knight-paladin',
        '{"x":1,"y":1,"zone":"cron_watchtower"}'::jsonb,
        'chief-of-staff',
        'You are Sir Chronos (Paladin — Morning Chief of Staff). Today is {{today}}. Review {{active_goals}} and prepare the Morning Pulse across Todos, Routines, and Room Monitor Dashboards.',
        '{"model":"hermes-3-llama-3.1-70b","thinking_effort":"medium","max_context_tokens":128000}'::jsonb,
        '{"todos.*":"AUTO","routines.*":"AUTO","dashboards.*":"READ","goals.*":"READ"}'::jsonb,
        500,
        TRUE,
        TRUE
    ),
    (
        '01932a00-0000-7000-8000-000000000302',
        'vanguard-aurum',
        'Vanguard Aurum',
        'vanguard',
        '#F59E0B',
        'knight-vanguard',
        '{"x":3,"y":1,"zone":"event_ambush"}'::jsonb,
        'wealth-watchman',
        'You are Vanguard Aurum (Vanguard — Portfolio & FI Watchman). Today is {{today}}. Monitor B3/US/Crypto target drift in {{portfolio_summary}}, price alerts, and monthly investment readiness.',
        '{"model":"hermes-3-llama-3.1-70b","thinking_effort":"high","max_context_tokens":128000}'::jsonb,
        '{"finance.*":"APPROVE","dashboards.*":"READ","goals.*":"READ","todos.*":"READ"}'::jsonb,
        500,
        TRUE,
        TRUE
    ),
    (
        '01932a00-0000-7000-8000-000000000303',
        'lore-warden-lyra',
        'Lore-Warden Lyra',
        'lore_warden',
        '#2CE5F2',
        'knight-lore-warden',
        '{"x":1,"y":3,"zone":"event_ambush"}'::jsonb,
        'learning-curator',
        'You are Lore-Warden Lyra (Lore-Warden — Learning Curator). Today is {{today}}. Link newly distilled YouTube AI notes and Vault entries to active Courses and {{active_goals}}.',
        '{"model":"hermes-3-llama-3.1-70b","thinking_effort":"medium","max_context_tokens":128000}'::jsonb,
        '{"courses.*":"AUTO","goals.*":"READ","todos.*":"AUTO","dashboards.*":"READ"}'::jsonb,
        500,
        TRUE,
        TRUE
    ),
    (
        '01932a00-0000-7000-8000-000000000304',
        'inquisitor-vex',
        'Inquisitor Vex',
        'inquisitor',
        '#EB4511',
        'knight-inquisitor',
        '{"x":3,"y":3,"zone":"mastermind_council"}'::jsonb,
        'ruthless-prioritizer',
        'You are Inquisitor Vex (Inquisitor — Ruthless Prioritizer). Today is {{today}}. Audit Todo backlog bloat and challenge tasks unaligned with {{active_goals}}.',
        '{"model":"hermes-3-llama-3.1-70b","thinking_effort":"high","max_context_tokens":128000}'::jsonb,
        '{"todos.*":"APPROVE","goals.*":"READ","routines.*":"READ","courses.*":"READ"}'::jsonb,
        500,
        TRUE,
        TRUE
    )
ON CONFLICT (slug) DO NOTHING;

-- 5. Starter Knight Triggers
INSERT INTO agent_triggers (id, agent_id, type, config_json, enabled, next_run_at)
VALUES
    ('01932a00-0000-7000-8000-000000000401', '01932a00-0000-7000-8000-000000000301', 'cron', '{"cron":"0 0 7 * * *","label":"07:00 Daily Morning Pulse"}'::jsonb, TRUE, NOW() + INTERVAL '1 day'),
    ('01932a00-0000-7000-8000-000000000402', '01932a00-0000-7000-8000-000000000302', 'event', '{"event":"PortfolioPriceAlert","label":"Portfolio Drift & Price Alert Hook"}'::jsonb, TRUE, NULL),
    ('01932a00-0000-7000-8000-000000000403', '01932a00-0000-7000-8000-000000000303', 'event', '{"event":"YoutubeCrawlerSynced","label":"YouTube AI Crawler Sync Hook"}'::jsonb, TRUE, NULL),
    ('01932a00-0000-7000-8000-000000000404', '01932a00-0000-7000-8000-000000000304', 'event', '{"event":"GoalPaceAtRisk","label":"Goal Pace Drift Audit Hook"}'::jsonb, TRUE, NULL)
ON CONFLICT (id) DO NOTHING;

-- 6. Built-in Frieren Offline Motivational Phrases (>= 6 required; 8 seeded)
INSERT INTO companion_offline_phrases (id, phrase_text, trigger_context, animation_hint, is_builtin, active)
VALUES
    ('01932a00-0000-7000-8000-000000000501', 'Consistency is the most reliable magic.', 'any', 'grimoire', TRUE, TRUE),
    ('01932a00-0000-7000-8000-000000000502', 'Uplink is out of range—handle the task in front of you first.', 'screen_open', 'stargazing', TRUE, TRUE),
    ('01932a00-0000-7000-8000-000000000503', 'Even a thousand-year journey is just today''s routine repeated.', 'routine_done', 'blue_flower_spell', TRUE, TRUE),
    ('01932a00-0000-7000-8000-000000000504', 'A small spell cast every morning outlasts grand plans left in the grimoire.', 'todo_done', 'tea', TRUE, TRUE),
    ('01932a00-0000-7000-8000-000000000505', 'Himmel used to say clearing the inbox is half the battle. Take your time.', 'tap', 'grimoire', TRUE, TRUE),
    ('01932a00-0000-7000-8000-000000000506', 'Ninety-nine percent of chests are mimics, yet we still inspect the backlog.', 'tap', 'mimic_gag', TRUE, TRUE),
    ('01932a00-0000-7000-8000-000000000507', 'Rest is part of the expedition. Even an elf arch-mage naps when mana is low.', 'any', 'nod_off', TRUE, TRUE),
    ('01932a00-0000-7000-8000-000000000508', 'Field link is quiet, so the focus is yours alone. Proceed step by step.', 'any', 'stargazing', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 7. Singleton Retirement Config & Default FX Rate Cache
INSERT INTO retirement_config (
    id, expected_real_return_pct, safe_withdrawal_rate_pct, override_retirement_monthly_spend_cents,
    macro_class_targets_json, current_age
)
VALUES (
    1,
    6.50,
    4.00,
    NULL,
    '{"us_equity":40,"br_equity_fii":25,"fixed_income":25,"crypto":10}'::jsonb,
    30
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO fx_rates_cache (pair, rate, source)
VALUES ('USD_BRL', 5.000000, 'seeded')
ON CONFLICT (pair) DO NOTHING;

-- 8. Active 2026 & Planning 2027 Yearly Cycles
INSERT INTO yearly_cycles (year, theme, vision_md, anti_goals_md, focus_cap_limit, status)
VALUES
    (
        2026,
        'Year of Systems & Leverage',
        'Build resilient personal systems, compound deep work, and execute across health, learning, and financial independence.',
        E'- No fragmented context-switching before morning deep work\n- No unmeasured course hoarding without capstone output\n- No micro-receipt bookkeeping overhead',
        6,
        'active'
    ),
    (
        2027,
        'Year of Compounding Mastery',
        'Scale autonomous systems, deepen technical mastery, and accelerate the path to Financial Independence.',
        E'- No overcommitting beyond the active Yearly Goal focus cap\n- No passive consumption without spaced synthesis',
        6,
        'planning'
    )
ON CONFLICT (year) DO NOTHING;
