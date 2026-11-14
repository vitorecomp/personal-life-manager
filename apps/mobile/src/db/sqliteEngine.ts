import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js/dist/sql-wasm-inline.js';
import { parseTodoQuickCapture, type TodoEnergyLevel, type TodoPriority } from './nlpParser';
import { decryptPat, encryptPat, maskPatPrefix } from './patCrypto';
import { generateUuidV7 } from './uuidv7';

export const MOBILE_SQLITE_STORAGE_KEY = 'hermes_mobile_sqlite_v1';

export const ALLOWED_SYNC_TABLES = [
  'projects',
  'tasks',
  'time_sessions',
  'routines',
  'routine_items',
  'routine_logs',
  'daily_checkins',
  'companion_offline_phrases',
] as const;

export type SyncEntityTable = (typeof ALLOWED_SYNC_TABLES)[number];

export const ALL_MOBILE_SQLITE_TABLES = [
  ...ALLOWED_SYNC_TABLES,
  'sync_outbox',
  'uplink_config',
] as const;

export type DayProfile = 'workday' | 'weekend' | 'travel' | 'minimum_viable';
export type RoutineTimeSlot = 'morning' | 'afternoon' | 'shutdown' | 'evening' | 'custom';
export type TimerMode =
  | 'stopwatch'
  | 'pomodoro'
  | 'pomodoro_25_5'
  | 'pomodoro_50_10'
  | 'pomodoro_90_15'
  | 'pomodoro_custom';

export interface MobileProjectRow {
  id: string;
  name: string;
  area: string;
  goal_id: string | null;
  status: 'active' | 'paused' | 'completed' | 'archived';
  color: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MobileTaskRow {
  id: string;
  title: string;
  description_md: string;
  status: 'inbox' | 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'canceled';
  priority: TodoPriority;
  project_id: string | null;
  goal_id: string | null;
  course_id: string | null;
  lesson_id: string | null;
  parent_task_id: string | null;
  blocked_by_task_ids: string[];
  vault_note_path: string | null;
  scheduled_date: string | null;
  due_date: string | null;
  estimated_minutes: number | null;
  actual_seconds: number;
  energy_level: TodoEnergyLevel | null;
  tags: string[];
  recurrence_rule: string | null;
  sort_order: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MobileTimeSessionRow {
  id: string;
  task_id: string | null;
  course_id: string | null;
  lesson_id: string | null;
  category: 'deep_work' | 'learning' | 'maintenance' | 'admin' | 'health';
  timer_mode: TimerMode;
  work_minutes: number | null;
  break_minutes: number | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  notes: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MobileRoutineRow {
  id: string;
  name: string;
  time_slot: RoutineTimeSlot;
  day_profile: DayProfile | 'all';
  target_start_time: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MobileRoutineItemRow {
  id: string;
  routine_id: string;
  goal_id: string | null;
  title: string;
  tracking_type: 'boolean' | 'numeric' | 'duration';
  target_value: number | null;
  unit: string | null;
  frequency_type: 'daily' | 'weekdays' | 'times_per_week';
  frequency_config: Record<string, unknown>;
  estimated_minutes: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MobileRoutineLogRow {
  id: string;
  routine_item_id: string;
  log_date: string;
  status: 'completed' | 'partial' | 'skipped';
  numeric_value: number | null;
  completed_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MobileRoutineItemWithLog extends MobileRoutineItemRow {
  todayLog: MobileRoutineLogRow | null;
  streakDays: number;
}

export interface MobileRoutineStackView extends MobileRoutineRow {
  items: MobileRoutineItemWithLog[];
  completedCount: number;
  totalCount: number;
  adherencePct: number;
  streakDays: number;
}

export interface MobileDailyCheckinRow {
  log_date: string;
  day_profile_used: DayProfile;
  energy_score: number | null;
  mood_score: number | null;
  sleep_hours: number | null;
  highlight: string;
  reflection_md: string;
  weekly_review_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MobileOfflinePhraseRow {
  id: string;
  phrase_text: string;
  trigger_context: 'any' | 'tap' | 'screen_open' | 'todo_done' | 'routine_done' | 'evening_reflection';
  animation_hint: string | null;
  is_builtin: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MobileSyncOutboxRow {
  mutation_id: string;
  entity_table: SyncEntityTable;
  entity_id: string;
  op: 'upsert' | 'delete';
  payload: Record<string, unknown>;
  client_updated_at: string;
  retry_count: number;
  last_error: string | null;
  created_at: string;
}

export interface MobileUplinkConfigRow {
  id: number;
  client_id: string;
  primary_server_url: string;
  fallback_server_url: string;
  active_server_url: string;
  encrypted_pat: string;
  token_prefix: string;
  last_server_seq: number;
  last_sync_at: string | null;
  last_verified_at: string | null;
  last_latency_ms: number | null;
  uplink_status: 'online' | 'offline' | 'syncing' | 'auth_error';
  session_key: string;
  updated_at: string;
}

export interface SyncPullChangeEntry {
  server_seq: number;
  entity_table: string;
  entity_id: string;
  op: 'upsert' | 'delete';
  payload?: Record<string, unknown> | null;
  changed_at?: string;
}

export const MOBILE_SQLITE_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT 'personal' CHECK (area IN (
        'career', 'health', 'learning', 'finance', 'personal', 'personal_project', 'relationships', 'systems'
    )),
    goal_id TEXT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
    color TEXT NOT NULL DEFAULT '#F87C18',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description_md TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN (
        'inbox', 'backlog', 'todo', 'in_progress', 'review', 'done', 'canceled'
    )),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    project_id TEXT NULL REFERENCES projects(id) ON DELETE SET NULL,
    goal_id TEXT NULL,
    course_id TEXT NULL,
    lesson_id TEXT NULL,
    parent_task_id TEXT NULL,
    blocked_by_task_ids TEXT NOT NULL DEFAULT '[]',
    vault_note_path TEXT NULL,
    scheduled_date TEXT NULL,
    due_date TEXT NULL,
    estimated_minutes INTEGER NULL,
    actual_seconds INTEGER NOT NULL DEFAULT 0,
    energy_level TEXT NULL CHECK (energy_level IS NULL OR energy_level IN ('deep', 'shallow', 'quick')),
    tags TEXT NOT NULL DEFAULT '[]',
    recurrence_rule TEXT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobile_tasks_status_sched
    ON tasks (status, scheduled_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS time_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT NULL REFERENCES tasks(id) ON DELETE SET NULL,
    course_id TEXT NULL,
    lesson_id TEXT NULL,
    category TEXT NOT NULL DEFAULT 'deep_work' CHECK (category IN (
        'deep_work', 'learning', 'maintenance', 'admin', 'health'
    )),
    timer_mode TEXT NOT NULL DEFAULT 'stopwatch' CHECK (timer_mode IN (
        'stopwatch', 'pomodoro', 'pomodoro_25_5', 'pomodoro_50_10', 'pomodoro_90_15', 'pomodoro_custom'
    )),
    work_minutes INTEGER NULL,
    break_minutes INTEGER NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL
);

CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    time_slot TEXT NOT NULL CHECK (time_slot IN ('morning', 'afternoon', 'shutdown', 'evening', 'custom')),
    day_profile TEXT NOT NULL DEFAULT 'workday' CHECK (day_profile IN (
        'workday', 'weekend', 'travel', 'minimum_viable', 'all'
    )),
    target_start_time TEXT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL
);

CREATE TABLE IF NOT EXISTS routine_items (
    id TEXT PRIMARY KEY,
    routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    goal_id TEXT NULL,
    title TEXT NOT NULL,
    tracking_type TEXT NOT NULL DEFAULT 'boolean' CHECK (tracking_type IN ('boolean', 'numeric', 'duration')),
    target_value REAL NULL,
    unit TEXT NULL,
    frequency_type TEXT NOT NULL DEFAULT 'daily' CHECK (frequency_type IN ('daily', 'weekdays', 'times_per_week')),
    frequency_config TEXT NOT NULL DEFAULT '{}',
    estimated_minutes INTEGER NOT NULL DEFAULT 10,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobile_routine_items_routine
    ON routine_items (routine_id, sort_order ASC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS routine_logs (
    id TEXT PRIMARY KEY,
    routine_item_id TEXT NOT NULL REFERENCES routine_items(id) ON DELETE CASCADE,
    log_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('completed', 'partial', 'skipped')),
    numeric_value REAL NULL,
    completed_at TEXT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    UNIQUE (routine_item_id, log_date)
);

CREATE TABLE IF NOT EXISTS daily_checkins (
    log_date TEXT PRIMARY KEY,
    day_profile_used TEXT NOT NULL DEFAULT 'workday' CHECK (day_profile_used IN (
        'workday', 'weekend', 'travel', 'minimum_viable'
    )),
    energy_score INTEGER NULL CHECK (energy_score IS NULL OR (energy_score BETWEEN 1 AND 5)),
    mood_score INTEGER NULL CHECK (mood_score IS NULL OR (mood_score BETWEEN 1 AND 5)),
    sleep_hours REAL NULL,
    highlight TEXT NOT NULL DEFAULT '',
    reflection_md TEXT NOT NULL DEFAULT '',
    weekly_review_json TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL
);

CREATE TABLE IF NOT EXISTS companion_offline_phrases (
    id TEXT PRIMARY KEY,
    phrase_text TEXT NOT NULL,
    trigger_context TEXT NOT NULL DEFAULT 'any' CHECK (trigger_context IN (
        'any', 'tap', 'screen_open', 'todo_done', 'routine_done', 'evening_reflection'
    )),
    animation_hint TEXT NULL,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL
);

CREATE TABLE IF NOT EXISTS sync_outbox (
    mutation_id TEXT PRIMARY KEY,
    entity_table TEXT NOT NULL CHECK (entity_table IN (
        'projects', 'tasks', 'time_sessions', 'routines', 'routine_items',
        'routine_logs', 'daily_checkins', 'companion_offline_phrases'
    )),
    entity_id TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
    payload_json TEXT NOT NULL,
    client_updated_at TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobile_sync_outbox_created
    ON sync_outbox (created_at ASC);

CREATE TABLE IF NOT EXISTS uplink_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    client_id TEXT NOT NULL,
    primary_server_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:8080',
    fallback_server_url TEXT NOT NULL DEFAULT '',
    active_server_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:8080',
    encrypted_pat TEXT NOT NULL DEFAULT '',
    token_prefix TEXT NOT NULL DEFAULT '',
    last_server_seq INTEGER NOT NULL DEFAULT 0,
    last_sync_at TEXT NULL,
    last_verified_at TEXT NULL,
    last_latency_ms INTEGER NULL,
    uplink_status TEXT NOT NULL DEFAULT 'offline' CHECK (uplink_status IN ('online', 'offline', 'syncing', 'auth_error')),
    session_key TEXT NOT NULL DEFAULT 'mobile-companion-main',
    updated_at TEXT NOT NULL
);
`;

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
}

function base64ToUint8(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const TABLE_TOPOLOGICAL_PRIORITY: Record<SyncEntityTable, number> = {
  projects: 1,
  tasks: 2,
  time_sessions: 3,
  routines: 4,
  routine_items: 5,
  routine_logs: 6,
  daily_checkins: 7,
  companion_offline_phrases: 8,
};

let cachedSqlStaticPromise: ReturnType<typeof initSqlJs> | null = null;

function getSqlStatic() {
  if (!cachedSqlStaticPromise) {
    cachedSqlStaticPromise = initSqlJs();
  }
  return cachedSqlStaticPromise;
}

export class MobileSqliteEngine {
  private db: SqlJsDatabase;
  private storageKey: string;
  private persistEnabled: boolean;

  constructor(db: SqlJsDatabase, storageKey = MOBILE_SQLITE_STORAGE_KEY, persistEnabled = true) {
    this.db = db;
    this.storageKey = storageKey;
    this.persistEnabled = persistEnabled;
  }

  static async create(options?: {
    storageKey?: string;
    persist?: boolean;
    fresh?: boolean;
  }): Promise<MobileSqliteEngine> {
    const storageKey = options?.storageKey ?? MOBILE_SQLITE_STORAGE_KEY;
    const persist = options?.persist ?? true;
    const SQL = await getSqlStatic();

    let restoredBytes: Uint8Array | null = null;
    if (persist && !options?.fresh && typeof localStorage !== 'undefined') {
      try {
        const rawB64 = localStorage.getItem(storageKey);
        if (rawB64 && rawB64.length > 16) {
          restoredBytes = base64ToUint8(rawB64);
        }
      } catch {
        restoredBytes = null;
      }
    }

    let sqlDb: SqlJsDatabase;
    if (restoredBytes) {
      try {
        sqlDb = new SQL.Database(restoredBytes);
      } catch {
        sqlDb = new SQL.Database();
      }
    } else {
      sqlDb = new SQL.Database();
    }

    const engine = new MobileSqliteEngine(sqlDb, storageKey, persist);
    engine.initializeSchemaAndSeeds();
    return engine;
  }

  getNativePlatformInfo(): { isNative: boolean; platform: string } {
    try {
      return {
        isNative: Capacitor.isNativePlatform(),
        platform: Capacitor.getPlatform(),
      };
    } catch {
      return { isNative: false, platform: 'web' };
    }
  }

  private persistSnapshot(): void {
    if (!this.persistEnabled) return;
    try {
      const exported = this.db.export();
      const b64 = uint8ToBase64(exported);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, b64);
      }
      if (this.getNativePlatformInfo().isNative) {
        void Preferences.set({ key: this.storageKey, value: b64 }).catch(() => {});
      }
    } catch {
      // Ignore storage quota errors in constrained environments
    }
  }

  private queryAll(sql: string, params?: unknown[]): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql);
    const rows: Record<string, unknown>[] = [];
    try {
      if (params && params.length > 0) {
        stmt.bind(params);
      }
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  private queryOne(sql: string, params?: unknown[]): Record<string, unknown> | null {
    const rows = this.queryAll(sql, params);
    return rows[0] ?? null;
  }

  initializeSchemaAndSeeds(): void {
    this.db.run(MOBILE_SQLITE_SCHEMA_DDL);

    const nowIso = '2026-11-14T08:00:00.000Z';
    const todayDate = new Date().toISOString().slice(0, 10);

    // 1. Singleton uplink_config row
    const existingUplink = this.queryOne('SELECT id FROM uplink_config WHERE id = 1');
    if (!existingUplink) {
      const clientId = generateUuidV7();
      this.db.run(
        `INSERT INTO uplink_config (
          id, client_id, primary_server_url, fallback_server_url, active_server_url,
          encrypted_pat, token_prefix, last_server_seq, last_sync_at, last_verified_at,
          last_latency_ms, uplink_status, session_key, updated_at
        ) VALUES (1, ?, 'http://127.0.0.1:8080', '', 'http://127.0.0.1:8080', '', '', 0, NULL, NULL, NULL, 'offline', 'mobile-companion-main', ?)`,
        [clientId, nowIso],
      );
    }

    // 2. Built-in companion_offline_phrases (8 starter quotes)
    const phraseCountRow = this.queryOne('SELECT COUNT(*) as cnt FROM companion_offline_phrases');
    if (Number(phraseCountRow?.cnt ?? 0) === 0) {
      const starterPhrases: Array<[string, string, string, string]> = [
        [
          '01932a00-0000-7000-8000-000000000501',
          'Consistency is the most reliable magic.',
          'any',
          'grimoire',
        ],
        [
          '01932a00-0000-7000-8000-000000000502',
          'Uplink is out of range—handle the task in front of you first.',
          'screen_open',
          'stargazing',
        ],
        [
          '01932a00-0000-7000-8000-000000000503',
          "Even a thousand-year journey is just today's routine repeated.",
          'routine_done',
          'blue_flower_spell',
        ],
        [
          '01932a00-0000-7000-8000-000000000504',
          'A small spell cast every morning outlasts grand plans left in the grimoire.',
          'todo_done',
          'tea',
        ],
        [
          '01932a00-0000-7000-8000-000000000505',
          'Himmel used to say clearing the inbox is half the battle. Take your time.',
          'tap',
          'grimoire',
        ],
        [
          '01932a00-0000-7000-8000-000000000506',
          'Ninety-nine percent of chests are mimics, yet we still inspect the backlog.',
          'tap',
          'mimic_gag',
        ],
        [
          '01932a00-0000-7000-8000-000000000507',
          'Rest is part of the expedition. Even an elf arch-mage naps when mana is low.',
          'any',
          'nod_off',
        ],
        [
          '01932a00-0000-7000-8000-000000000508',
          'Field link is quiet, so the focus is yours alone. Proceed step by step.',
          'any',
          'stargazing',
        ],
      ];

      for (const [id, text, ctx, hint] of starterPhrases) {
        this.db.run(
          `INSERT OR IGNORE INTO companion_offline_phrases (
            id, phrase_text, trigger_context, animation_hint, is_builtin, active, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, 1, 1, ?, ?, NULL)`,
          [id, text, ctx, hint, nowIso, nowIso],
        );
      }
    }

    // 3. Default Project & Starter Tasks
    const projCountRow = this.queryOne('SELECT COUNT(*) as cnt FROM projects');
    const defaultProjectId = '01932a00-0000-7000-8000-000000000601';
    if (Number(projCountRow?.cnt ?? 0) === 0) {
      this.db.run(
        `INSERT OR IGNORE INTO projects (
          id, name, area, goal_id, status, color, created_at, updated_at, deleted_at
        ) VALUES (?, 'Field Operations', 'systems', NULL, 'active', '#F87C18', ?, ?, NULL)`,
        [defaultProjectId, nowIso, nowIso],
      );
    }

    const taskCountRow = this.queryOne('SELECT COUNT(*) as cnt FROM tasks');
    if (Number(taskCountRow?.cnt ?? 0) === 0) {
      const starterTasks: Array<{
        id: string;
        title: string;
        status: string;
        priority: string;
        scheduled_date: string | null;
        estimated_minutes: number;
        energy_level: string;
        tags: string[];
      }> = [
        {
          id: '01932a00-0000-7000-8000-000000000611',
          title: 'Audit Tailscale uplink node & verify PAT key',
          status: 'todo',
          priority: 'high',
          scheduled_date: todayDate,
          estimated_minutes: 25,
          energy_level: 'deep',
          tags: ['ops', 'uplink'],
        },
        {
          id: '01932a00-0000-7000-8000-000000000612',
          title: 'Capture field research notes for Second Brain vault',
          status: 'inbox',
          priority: 'medium',
          scheduled_date: null,
          estimated_minutes: 15,
          energy_level: 'quick',
          tags: ['vault'],
        },
        {
          id: '01932a00-0000-7000-8000-000000000613',
          title: 'Prepare weekly routine adherence checkpoint',
          status: 'todo',
          priority: 'medium',
          scheduled_date: '2099-12-31',
          estimated_minutes: 30,
          energy_level: 'shallow',
          tags: ['routines'],
        },
      ];

      for (let idx = 0; idx < starterTasks.length; idx += 1) {
        const t = starterTasks[idx]!;
        this.db.run(
          `INSERT OR IGNORE INTO tasks (
            id, title, description_md, status, priority, project_id, goal_id, course_id, lesson_id,
            parent_task_id, blocked_by_task_ids, vault_note_path, scheduled_date, due_date,
            estimated_minutes, actual_seconds, energy_level, tags, recurrence_rule, sort_order,
            completed_at, created_at, updated_at, deleted_at
          ) VALUES (?, ?, '', ?, ?, ?, NULL, NULL, NULL, NULL, '[]', NULL, ?, NULL, ?, 0, ?, ?, NULL, ?, NULL, ?, ?, NULL)`,
          [
            t.id,
            t.title,
            t.status,
            t.priority,
            defaultProjectId,
            t.scheduled_date,
            t.estimated_minutes,
            t.energy_level,
            JSON.stringify(t.tags),
            idx,
            nowIso,
            nowIso,
          ],
        );
      }
    }

    // 4. Default Routines & Routine Items (4 stacks across Morning, Afternoon, Shutdown, Evening)
    const routineCountRow = this.queryOne('SELECT COUNT(*) as cnt FROM routines');
    if (Number(routineCountRow?.cnt ?? 0) === 0) {
      const stacks: Array<{
        id: string;
        name: string;
        time_slot: RoutineTimeSlot;
        day_profile: DayProfile | 'all';
        target_start_time: string;
        sort_order: number;
        items: Array<{
          id: string;
          title: string;
          tracking_type: 'boolean' | 'numeric' | 'duration';
          target_value: number | null;
          unit: string | null;
          frequency_type: 'daily' | 'weekdays' | 'times_per_week';
          frequency_config: Record<string, unknown>;
          estimated_minutes: number;
        }>;
      }> = [
        {
          id: '01932a00-0000-7000-8000-000000000701',
          name: 'Morning Launch',
          time_slot: 'morning',
          day_profile: 'all',
          target_start_time: '07:00',
          sort_order: 1,
          items: [
            {
              id: '01932a00-0000-7000-8000-000000000711',
              title: 'Hydrate 500ml + Electrolytes',
              tracking_type: 'boolean',
              target_value: 1,
              unit: null,
              frequency_type: 'daily',
              frequency_config: { mvd_included: true },
              estimated_minutes: 5,
            },
            {
              id: '01932a00-0000-7000-8000-000000000712',
              title: 'Mobility & Posture Flow',
              tracking_type: 'duration',
              target_value: 15,
              unit: 'min',
              frequency_type: 'daily',
              frequency_config: { mvd_included: true },
              estimated_minutes: 15,
            },
            {
              id: '01932a00-0000-7000-8000-000000000713',
              title: "Review Today's Top 3 Priorities",
              tracking_type: 'boolean',
              target_value: 1,
              unit: null,
              frequency_type: 'weekdays',
              frequency_config: { days: [1, 2, 3, 4, 5], mvd_included: true },
              estimated_minutes: 10,
            },
          ],
        },
        {
          id: '01932a00-0000-7000-8000-000000000702',
          name: 'Afternoon Reset',
          time_slot: 'afternoon',
          day_profile: 'workday',
          target_start_time: '13:30',
          sort_order: 2,
          items: [
            {
              id: '01932a00-0000-7000-8000-000000000714',
              title: '15m Sunlight Walk & Hydration',
              tracking_type: 'boolean',
              target_value: 1,
              unit: null,
              frequency_type: 'weekdays',
              frequency_config: { days: [1, 2, 3, 4, 5], mvd_included: false },
              estimated_minutes: 15,
            },
          ],
        },
        {
          id: '01932a00-0000-7000-8000-000000000703',
          name: 'Workday Shutdown',
          time_slot: 'shutdown',
          day_profile: 'workday',
          target_start_time: '18:00',
          sort_order: 3,
          items: [
            {
              id: '01932a00-0000-7000-8000-000000000715',
              title: 'Triage Todo Inbox & Stop Active Timers',
              tracking_type: 'boolean',
              target_value: 1,
              unit: null,
              frequency_type: 'weekdays',
              frequency_config: { days: [1, 2, 3, 4, 5], mvd_included: true },
              estimated_minutes: 10,
            },
          ],
        },
        {
          id: '01932a00-0000-7000-8000-000000000704',
          name: 'Evening Wind-Down',
          time_slot: 'evening',
          day_profile: 'all',
          target_start_time: '21:30',
          sort_order: 4,
          items: [
            {
              id: '01932a00-0000-7000-8000-000000000716',
              title: 'No Screens + Read 20 Pages',
              tracking_type: 'numeric',
              target_value: 20,
              unit: 'pages',
              frequency_type: 'daily',
              frequency_config: { mvd_included: true },
              estimated_minutes: 25,
            },
          ],
        },
      ];

      for (const stack of stacks) {
        this.db.run(
          `INSERT OR IGNORE INTO routines (
            id, name, time_slot, day_profile, target_start_time, sort_order, active, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`,
          [
            stack.id,
            stack.name,
            stack.time_slot,
            stack.day_profile,
            stack.target_start_time,
            stack.sort_order,
            nowIso,
            nowIso,
          ],
        );

        for (let idx = 0; idx < stack.items.length; idx += 1) {
          const item = stack.items[idx]!;
          this.db.run(
            `INSERT OR IGNORE INTO routine_items (
              id, routine_id, goal_id, title, tracking_type, target_value, unit,
              frequency_type, frequency_config, estimated_minutes, sort_order, created_at, updated_at, deleted_at
            ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            [
              item.id,
              stack.id,
              item.title,
              item.tracking_type,
              item.target_value,
              item.unit,
              item.frequency_type,
              JSON.stringify(item.frequency_config),
              item.estimated_minutes,
              idx + 1,
              nowIso,
              nowIso,
            ],
          );
        }
      }
    }

    this.persistSnapshot();
  }

  listTableNames(): string[] {
    const rows = this.queryAll(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC`,
    );
    return rows.map((r) => String(r.name));
  }

  private enqueueOutbox(
    entityTable: SyncEntityTable,
    entityId: string,
    op: 'upsert' | 'delete',
    payload: Record<string, unknown>,
    clientUpdatedAt: string,
  ): MobileSyncOutboxRow {
    if (!ALLOWED_SYNC_TABLES.includes(entityTable)) {
      throw new Error(`Invalid sync table: ${entityTable}`);
    }
    const mutationId = generateUuidV7();
    const createdAt = new Date().toISOString();
    const payloadJson = JSON.stringify(payload);

    this.db.run(
      `INSERT INTO sync_outbox (
        mutation_id, entity_table, entity_id, op, payload_json, client_updated_at, retry_count, last_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
      [mutationId, entityTable, entityId, op, payloadJson, clientUpdatedAt, createdAt],
    );

    return {
      mutation_id: mutationId,
      entity_table: entityTable,
      entity_id: entityId,
      op,
      payload,
      client_updated_at: clientUpdatedAt,
      retry_count: 0,
      last_error: null,
      created_at: createdAt,
    };
  }

  // =========================================================================
  // Projects & Tasks (Module 07)
  // =========================================================================

  listProjects(): MobileProjectRow[] {
    const rows = this.queryAll(
      `SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY name ASC`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      area: String(r.area || 'personal'),
      goal_id: r.goal_id ? String(r.goal_id) : null,
      status: (r.status as MobileProjectRow['status']) || 'active',
      color: String(r.color || '#F87C18'),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      deleted_at: r.deleted_at ? String(r.deleted_at) : null,
    }));
  }

  private mapTaskRow(r: Record<string, unknown>): MobileTaskRow {
    return {
      id: String(r.id),
      title: String(r.title),
      description_md: String(r.description_md ?? ''),
      status: (r.status as MobileTaskRow['status']) || 'todo',
      priority: (r.priority as TodoPriority) || 'medium',
      project_id: r.project_id ? String(r.project_id) : null,
      goal_id: r.goal_id ? String(r.goal_id) : null,
      course_id: r.course_id ? String(r.course_id) : null,
      lesson_id: r.lesson_id ? String(r.lesson_id) : null,
      parent_task_id: r.parent_task_id ? String(r.parent_task_id) : null,
      blocked_by_task_ids: parseJsonSafe<string[]>(r.blocked_by_task_ids, []),
      vault_note_path: r.vault_note_path ? String(r.vault_note_path) : null,
      scheduled_date: r.scheduled_date ? String(r.scheduled_date) : null,
      due_date: r.due_date ? String(r.due_date) : null,
      estimated_minutes:
        r.estimated_minutes !== null && r.estimated_minutes !== undefined
          ? Number(r.estimated_minutes)
          : null,
      actual_seconds: Number(r.actual_seconds ?? 0),
      energy_level: (r.energy_level as TodoEnergyLevel | null) ?? null,
      tags: parseJsonSafe<string[]>(r.tags, []),
      recurrence_rule: r.recurrence_rule ? String(r.recurrence_rule) : null,
      sort_order: Number(r.sort_order ?? 0),
      completed_at: r.completed_at ? String(r.completed_at) : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      deleted_at: r.deleted_at ? String(r.deleted_at) : null,
    };
  }

  listTasks(): MobileTaskRow[] {
    const rows = this.queryAll(
      `SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY
        CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
        created_at DESC`,
    );
    return rows.map((r) => this.mapTaskRow(r));
  }

  getTask(id: string): MobileTaskRow | null {
    const row = this.queryOne(`SELECT * FROM tasks WHERE id = ?`, [id]);
    return row ? this.mapTaskRow(row) : null;
  }

  createTaskFromQuickCapture(
    rawInput: string,
    todayIsoDate: string = new Date().toISOString().slice(0, 10),
  ): { task: MobileTaskRow; mutation: MobileSyncOutboxRow } {
    const parsed = parseTodoQuickCapture(rawInput, todayIsoDate);
    if (!parsed.valid) {
      throw new Error(parsed.error || 'Task title cannot be blank');
    }

    let resolvedProjectId: string | null = null;
    if (parsed.projectHint) {
      const hintLower = parsed.projectHint.toLowerCase();
      const matched = this.listProjects().find(
        (p) =>
          p.name.toLowerCase().includes(hintLower) ||
          p.name.toLowerCase().replace(/\s+/g, '-') === hintLower,
      );
      if (matched) {
        resolvedProjectId = matched.id;
      }
    }
    if (!resolvedProjectId) {
      const firstProj = this.listProjects()[0];
      resolvedProjectId = firstProj?.id ?? null;
    }

    const nowIso = new Date().toISOString();
    const id = generateUuidV7();
    const status: MobileTaskRow['status'] = parsed.scheduledDate ? 'todo' : 'inbox';

    const task: MobileTaskRow = {
      id,
      title: parsed.title,
      description_md: '',
      status,
      priority: parsed.priority,
      project_id: resolvedProjectId,
      goal_id: null,
      course_id: null,
      lesson_id: null,
      parent_task_id: null,
      blocked_by_task_ids: [],
      vault_note_path: null,
      scheduled_date: parsed.scheduledDate,
      due_date: null,
      estimated_minutes: parsed.estimatedMinutes,
      actual_seconds: 0,
      energy_level: parsed.energyLevel,
      tags: parsed.tags,
      recurrence_rule: null,
      sort_order: 0,
      completed_at: null,
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
    };

    this.db.run(
      `INSERT INTO tasks (
        id, title, description_md, status, priority, project_id, goal_id, course_id, lesson_id,
        parent_task_id, blocked_by_task_ids, vault_note_path, scheduled_date, due_date,
        estimated_minutes, actual_seconds, energy_level, tags, recurrence_rule, sort_order,
        completed_at, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, '[]', NULL, ?, NULL, ?, 0, ?, ?, NULL, 0, NULL, ?, ?, NULL)`,
      [
        task.id,
        task.title,
        task.description_md,
        task.status,
        task.priority,
        task.project_id,
        task.scheduled_date,
        task.estimated_minutes,
        task.energy_level,
        JSON.stringify(task.tags),
        task.created_at,
        task.updated_at,
      ],
    );

    const mutation = this.enqueueOutbox('tasks', task.id, 'upsert', { ...task }, nowIso);
    this.persistSnapshot();
    return { task, mutation };
  }

  toggleTaskCompletion(taskId: string): MobileTaskRow | null {
    const existing = this.getTask(taskId);
    if (!existing) return null;

    const nowIso = new Date().toISOString();
    const nextStatus: MobileTaskRow['status'] = existing.status === 'done' ? 'todo' : 'done';
    const nextCompletedAt = nextStatus === 'done' ? nowIso : null;

    this.db.run(
      `UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
      [nextStatus, nextCompletedAt, nowIso, taskId],
    );

    const updated = this.getTask(taskId)!;
    this.enqueueOutbox('tasks', taskId, 'upsert', { ...updated }, nowIso);
    this.persistSnapshot();
    return updated;
  }

  deleteTask(taskId: string): boolean {
    const existing = this.getTask(taskId);
    if (!existing) return false;

    const nowIso = new Date().toISOString();
    this.db.run(`UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      nowIso,
      nowIso,
      taskId,
    ]);
    this.enqueueOutbox('tasks', taskId, 'delete', { id: taskId, deleted_at: nowIso }, nowIso);
    this.persistSnapshot();
    return true;
  }

  // =========================================================================
  // Focus Timer & Time Sessions (Module 07)
  // =========================================================================

  private mapTimeSessionRow(r: Record<string, unknown>): MobileTimeSessionRow {
    return {
      id: String(r.id),
      task_id: r.task_id ? String(r.task_id) : null,
      course_id: r.course_id ? String(r.course_id) : null,
      lesson_id: r.lesson_id ? String(r.lesson_id) : null,
      category: (r.category as MobileTimeSessionRow['category']) || 'deep_work',
      timer_mode: (r.timer_mode as TimerMode) || 'stopwatch',
      work_minutes:
        r.work_minutes !== null && r.work_minutes !== undefined ? Number(r.work_minutes) : null,
      break_minutes:
        r.break_minutes !== null && r.break_minutes !== undefined ? Number(r.break_minutes) : null,
      started_at: String(r.started_at),
      ended_at: r.ended_at ? String(r.ended_at) : null,
      duration_seconds: Number(r.duration_seconds ?? 0),
      notes: String(r.notes ?? ''),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      deleted_at: r.deleted_at ? String(r.deleted_at) : null,
    };
  }

  getActiveTimer(): MobileTimeSessionRow | null {
    const row = this.queryOne(
      `SELECT * FROM time_sessions WHERE ended_at IS NULL AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    );
    return row ? this.mapTimeSessionRow(row) : null;
  }

  listTimeSessions(): MobileTimeSessionRow[] {
    const rows = this.queryAll(
      `SELECT * FROM time_sessions WHERE deleted_at IS NULL ORDER BY started_at DESC`,
    );
    return rows.map((r) => this.mapTimeSessionRow(r));
  }

  startFocusTimer(options: {
    taskId?: string | null;
    timerMode?: TimerMode;
    notes?: string;
  }): MobileTimeSessionRow {
    // Auto-stop any currently running timer first
    const running = this.getActiveTimer();
    if (running) {
      this.stopFocusTimer(60);
    }

    const mode = options.timerMode ?? 'pomodoro_25_5';
    let workMinutes: number | null = null;
    let breakMinutes: number | null = null;
    if (mode === 'pomodoro' || mode === 'pomodoro_25_5') {
      workMinutes = 25;
      breakMinutes = 5;
    } else if (mode === 'pomodoro_50_10') {
      workMinutes = 50;
      breakMinutes = 10;
    } else if (mode === 'pomodoro_90_15') {
      workMinutes = 90;
      breakMinutes = 15;
    }

    const nowIso = new Date().toISOString();
    const id = generateUuidV7();
    this.db.run(
      `INSERT INTO time_sessions (
        id, task_id, course_id, lesson_id, category, timer_mode, work_minutes, break_minutes,
        started_at, ended_at, duration_seconds, notes, created_at, updated_at, deleted_at
      ) VALUES (?, ?, NULL, NULL, 'deep_work', ?, ?, ?, ?, NULL, 0, ?, ?, ?, NULL)`,
      [
        id,
        options.taskId ?? null,
        mode,
        workMinutes,
        breakMinutes,
        nowIso,
        options.notes ?? '',
        nowIso,
        nowIso,
      ],
    );

    const created = this.mapTimeSessionRow(
      this.queryOne(`SELECT * FROM time_sessions WHERE id = ?`, [id])!,
    );
    this.persistSnapshot();
    return created;
  }

  stopFocusTimer(overrideDurationSeconds?: number): MobileTimeSessionRow | null {
    const running = this.getActiveTimer();
    if (!running) return null;

    const nowIso = new Date().toISOString();
    const elapsedSec =
      overrideDurationSeconds !== undefined
        ? Math.max(1, Math.floor(overrideDurationSeconds))
        : Math.max(
            60,
            Math.round((Date.now() - new Date(running.started_at).getTime()) / 1000),
          );

    this.db.run(
      `UPDATE time_sessions SET ended_at = ?, duration_seconds = ?, updated_at = ? WHERE id = ?`,
      [nowIso, elapsedSec, nowIso, running.id],
    );

    const completedSession = this.mapTimeSessionRow(
      this.queryOne(`SELECT * FROM time_sessions WHERE id = ?`, [running.id])!,
    );
    this.enqueueOutbox('time_sessions', completedSession.id, 'upsert', { ...completedSession }, nowIso);

    if (completedSession.task_id) {
      const task = this.getTask(completedSession.task_id);
      if (task) {
        const nextActual = task.actual_seconds + elapsedSec;
        this.db.run(`UPDATE tasks SET actual_seconds = ?, updated_at = ? WHERE id = ?`, [
          nextActual,
          nowIso,
          task.id,
        ]);
        const updatedTask = this.getTask(task.id)!;
        this.enqueueOutbox('tasks', updatedTask.id, 'upsert', { ...updatedTask }, nowIso);
      }
    }

    this.persistSnapshot();
    return completedSession;
  }

  // =========================================================================
  // Routines, Habit Logs, Streaks & Daily Check-ins (Module 08)
  // =========================================================================

  listRoutineStacks(
    dayProfile: DayProfile = 'workday',
    logDate: string = new Date().toISOString().slice(0, 10),
  ): MobileRoutineStackView[] {
    const routineRows = this.queryAll(
      `SELECT * FROM routines WHERE deleted_at IS NULL AND active = 1 ORDER BY sort_order ASC, name ASC`,
    );
    const itemRows = this.queryAll(
      `SELECT * FROM routine_items WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`,
    );
    const logRows = this.queryAll(
      `SELECT * FROM routine_logs WHERE deleted_at IS NULL ORDER BY log_date DESC`,
    );

    const logsByItem = new Map<string, MobileRoutineLogRow[]>();
    for (const r of logRows) {
      const mapped: MobileRoutineLogRow = {
        id: String(r.id),
        routine_item_id: String(r.routine_item_id),
        log_date: String(r.log_date),
        status: (r.status as MobileRoutineLogRow['status']) || 'completed',
        numeric_value:
          r.numeric_value !== null && r.numeric_value !== undefined ? Number(r.numeric_value) : null,
        completed_at: r.completed_at ? String(r.completed_at) : null,
        notes: String(r.notes ?? ''),
        created_at: String(r.created_at),
        updated_at: String(r.updated_at),
        deleted_at: r.deleted_at ? String(r.deleted_at) : null,
      };
      const arr = logsByItem.get(mapped.routine_item_id) ?? [];
      arr.push(mapped);
      logsByItem.set(mapped.routine_item_id, arr);
    }

    const computeItemStreak = (itemId: string): number => {
      const itemLogs = (logsByItem.get(itemId) ?? []).filter((l) => l.status === 'completed');
      return itemLogs.length;
    };

    const stacks: MobileRoutineStackView[] = [];
    for (const r of routineRows) {
      const rProfile = (r.day_profile as DayProfile | 'all') || 'workday';
      const matchesProfile =
        dayProfile === 'minimum_viable' || rProfile === 'all' || rProfile === dayProfile;
      if (!matchesProfile) continue;

      const routineId = String(r.id);
      const rawItemsForStack = itemRows.filter((i) => String(i.routine_id) === routineId);
      const mappedItems: MobileRoutineItemWithLog[] = [];

      for (const ir of rawItemsForStack) {
        const freqConfig = parseJsonSafe<Record<string, unknown>>(ir.frequency_config, {});
        const itemId = String(ir.id);
        const itemLogs = logsByItem.get(itemId) ?? [];
        const todayLog = itemLogs.find((l) => l.log_date === logDate) ?? null;

        if (dayProfile === 'minimum_viable' && freqConfig.mvd_included === false && !todayLog) {
          continue;
        }

        mappedItems.push({
          id: itemId,
          routine_id: routineId,
          goal_id: ir.goal_id ? String(ir.goal_id) : null,
          title: String(ir.title),
          tracking_type: (ir.tracking_type as MobileRoutineItemRow['tracking_type']) || 'boolean',
          target_value:
            ir.target_value !== null && ir.target_value !== undefined
              ? Number(ir.target_value)
              : null,
          unit: ir.unit ? String(ir.unit) : null,
          frequency_type:
            (ir.frequency_type as MobileRoutineItemRow['frequency_type']) || 'daily',
          frequency_config: freqConfig,
          estimated_minutes:
            ir.estimated_minutes !== null && ir.estimated_minutes !== undefined
              ? Number(ir.estimated_minutes)
              : null,
          sort_order: Number(ir.sort_order ?? 0),
          created_at: String(ir.created_at),
          updated_at: String(ir.updated_at),
          deleted_at: ir.deleted_at ? String(ir.deleted_at) : null,
          todayLog,
          streakDays: computeItemStreak(itemId),
        });
      }

      if (mappedItems.length === 0) continue;

      const completedCount = mappedItems.filter(
        (it) => it.todayLog?.status === 'completed',
      ).length;
      const totalCount = mappedItems.length;
      const adherencePct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
      const streakDays = Math.max(0, ...mappedItems.map((it) => it.streakDays));

      stacks.push({
        id: routineId,
        name: String(r.name),
        time_slot: (r.time_slot as RoutineTimeSlot) || 'morning',
        day_profile: rProfile,
        target_start_time: r.target_start_time ? String(r.target_start_time) : null,
        sort_order: Number(r.sort_order ?? 0),
        active: Boolean(r.active),
        created_at: String(r.created_at),
        updated_at: String(r.updated_at),
        deleted_at: r.deleted_at ? String(r.deleted_at) : null,
        items: mappedItems,
        completedCount,
        totalCount,
        adherencePct,
        streakDays,
      });
    }

    return stacks;
  }

  toggleRoutineItemLog(
    routineItemId: string,
    logDate: string = new Date().toISOString().slice(0, 10),
    overrideStatus?: 'completed' | 'partial' | 'skipped',
    overrideNumericValue?: number | null,
  ): MobileRoutineLogRow {
    const existing = this.queryOne(
      `SELECT * FROM routine_logs WHERE routine_item_id = ? AND log_date = ?`,
      [routineItemId, logDate],
    );
    const itemRow = this.queryOne(`SELECT * FROM routine_items WHERE id = ?`, [routineItemId]);
    const targetVal =
      itemRow?.target_value !== null && itemRow?.target_value !== undefined
        ? Number(itemRow.target_value)
        : 1;

    const nowIso = new Date().toISOString();
    const id = existing?.id ? String(existing.id) : generateUuidV7();
    const createdAt = existing?.created_at ? String(existing.created_at) : nowIso;

    const currentStatus = existing?.status ? String(existing.status) : null;
    const nextStatus: 'completed' | 'partial' | 'skipped' =
      overrideStatus ?? (currentStatus === 'completed' ? 'skipped' : 'completed');

    const numericVal =
      overrideNumericValue !== undefined
        ? overrideNumericValue
        : nextStatus === 'completed'
          ? targetVal
          : 0;

    const completedAt = nextStatus === 'completed' ? nowIso : null;

    this.db.run(
      `INSERT INTO routine_logs (
        id, routine_item_id, log_date, status, numeric_value, completed_at, notes, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, NULL)
      ON CONFLICT(routine_item_id, log_date) DO UPDATE SET
        status = excluded.status,
        numeric_value = excluded.numeric_value,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at,
        deleted_at = NULL`,
      [id, routineItemId, logDate, nextStatus, numericVal, completedAt, createdAt, nowIso],
    );

    const saved: MobileRoutineLogRow = {
      id,
      routine_item_id: routineItemId,
      log_date: logDate,
      status: nextStatus,
      numeric_value: numericVal,
      completed_at: completedAt,
      notes: '',
      created_at: createdAt,
      updated_at: nowIso,
      deleted_at: null,
    };

    this.enqueueOutbox('routine_logs', saved.id, 'upsert', { ...saved }, nowIso);
    this.persistSnapshot();
    return saved;
  }

  stepRoutineItemValue(
    routineItemId: string,
    delta: number,
    logDate: string = new Date().toISOString().slice(0, 10),
  ): MobileRoutineLogRow {
    const itemRow = this.queryOne(`SELECT * FROM routine_items WHERE id = ?`, [routineItemId]);
    const targetVal =
      itemRow?.target_value !== null && itemRow?.target_value !== undefined
        ? Number(itemRow.target_value)
        : 10;
    const existing = this.queryOne(
      `SELECT * FROM routine_logs WHERE routine_item_id = ? AND log_date = ?`,
      [routineItemId, logDate],
    );
    const currentVal =
      existing?.numeric_value !== null && existing?.numeric_value !== undefined
        ? Number(existing.numeric_value)
        : 0;
    const nextVal = Math.max(0, currentVal + delta);
    const nextStatus: 'completed' | 'partial' | 'skipped' =
      nextVal >= targetVal ? 'completed' : nextVal > 0 ? 'partial' : 'skipped';

    return this.toggleRoutineItemLog(routineItemId, logDate, nextStatus, nextVal);
  }

  createRoutineItem(input: {
    routineId: string;
    title: string;
    trackingType?: 'boolean' | 'numeric' | 'duration';
    targetValue?: number | null;
    unit?: string | null;
  }): MobileRoutineItemRow {
    const trimmed = input.title.trim();
    if (!trimmed) {
      throw new Error('Routine item title cannot be blank');
    }
    const nowIso = new Date().toISOString();
    const id = generateUuidV7();
    const trackingType = input.trackingType ?? 'boolean';
    const targetValue = input.targetValue ?? (trackingType === 'boolean' ? 1 : 15);
    const unit = input.unit ?? (trackingType === 'duration' ? 'min' : null);

    const item: MobileRoutineItemRow = {
      id,
      routine_id: input.routineId,
      goal_id: null,
      title: trimmed,
      tracking_type: trackingType,
      target_value: targetValue,
      unit,
      frequency_type: 'daily',
      frequency_config: { mvd_included: true },
      estimated_minutes: 10,
      sort_order: 99,
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
    };

    this.db.run(
      `INSERT INTO routine_items (
        id, routine_id, goal_id, title, tracking_type, target_value, unit,
        frequency_type, frequency_config, estimated_minutes, sort_order, created_at, updated_at, deleted_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'daily', ?, 10, 99, ?, ?, NULL)`,
      [
        item.id,
        item.routine_id,
        item.title,
        item.tracking_type,
        item.target_value,
        item.unit,
        JSON.stringify(item.frequency_config),
        item.created_at,
        item.updated_at,
      ],
    );

    this.enqueueOutbox('routine_items', item.id, 'upsert', { ...item }, nowIso);
    this.persistSnapshot();
    return item;
  }

  getDailyCheckin(
    logDate: string = new Date().toISOString().slice(0, 10),
  ): MobileDailyCheckinRow | null {
    const r = this.queryOne(
      `SELECT * FROM daily_checkins WHERE log_date = ? AND deleted_at IS NULL`,
      [logDate],
    );
    if (!r) return null;
    return {
      log_date: String(r.log_date),
      day_profile_used: (r.day_profile_used as DayProfile) || 'workday',
      energy_score:
        r.energy_score !== null && r.energy_score !== undefined ? Number(r.energy_score) : null,
      mood_score:
        r.mood_score !== null && r.mood_score !== undefined ? Number(r.mood_score) : null,
      sleep_hours:
        r.sleep_hours !== null && r.sleep_hours !== undefined ? Number(r.sleep_hours) : null,
      highlight: String(r.highlight ?? ''),
      reflection_md: String(r.reflection_md ?? ''),
      weekly_review_json: parseJsonSafe<Record<string, unknown> | null>(
        r.weekly_review_json,
        null,
      ),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      deleted_at: r.deleted_at ? String(r.deleted_at) : null,
    };
  }

  upsertDailyCheckin(input: {
    logDate?: string;
    dayProfileUsed?: DayProfile;
    energyScore: number | null;
    moodScore: number | null;
    sleepHours: number | null;
    highlight: string;
    reflectionMd?: string;
  }): MobileDailyCheckinRow {
    const logDate = input.logDate ?? new Date().toISOString().slice(0, 10);
    const existing = this.getDailyCheckin(logDate);
    const nowIso = new Date().toISOString();
    const createdAt = existing?.created_at ?? nowIso;
    const dayProfileUsed = input.dayProfileUsed ?? existing?.day_profile_used ?? 'workday';
    const energy =
      input.energyScore !== null ? Math.min(5, Math.max(1, Math.round(input.energyScore))) : null;
    const mood =
      input.moodScore !== null ? Math.min(5, Math.max(1, Math.round(input.moodScore))) : null;

    this.db.run(
      `INSERT INTO daily_checkins (
        log_date, day_profile_used, energy_score, mood_score, sleep_hours,
        highlight, reflection_md, weekly_review_json, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
      ON CONFLICT(log_date) DO UPDATE SET
        day_profile_used = excluded.day_profile_used,
        energy_score = excluded.energy_score,
        mood_score = excluded.mood_score,
        sleep_hours = excluded.sleep_hours,
        highlight = excluded.highlight,
        reflection_md = excluded.reflection_md,
        updated_at = excluded.updated_at,
        deleted_at = NULL`,
      [
        logDate,
        dayProfileUsed,
        energy,
        mood,
        input.sleepHours,
        input.highlight.trim(),
        (input.reflectionMd ?? '').trim(),
        createdAt,
        nowIso,
      ],
    );

    const saved = this.getDailyCheckin(logDate)!;
    this.enqueueOutbox(
      'daily_checkins',
      logDate,
      'upsert',
      { id: logDate, ...saved },
      nowIso,
    );
    this.persistSnapshot();
    return saved;
  }

  // =========================================================================
  // Companion Offline Phrases (Module 02 & 06)
  // =========================================================================

  listOfflinePhrases(): MobileOfflinePhraseRow[] {
    const rows = this.queryAll(
      `SELECT * FROM companion_offline_phrases WHERE deleted_at IS NULL AND active = 1 ORDER BY is_builtin DESC, created_at ASC`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      phrase_text: String(r.phrase_text),
      trigger_context:
        (r.trigger_context as MobileOfflinePhraseRow['trigger_context']) || 'any',
      animation_hint: r.animation_hint ? String(r.animation_hint) : null,
      is_builtin: Boolean(r.is_builtin),
      active: Boolean(r.active),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      deleted_at: r.deleted_at ? String(r.deleted_at) : null,
    }));
  }

  createOfflinePhrase(input: {
    phraseText: string;
    triggerContext?: MobileOfflinePhraseRow['trigger_context'];
    animationHint?: string | null;
  }): MobileOfflinePhraseRow {
    const text = input.phraseText.trim();
    if (!text) {
      throw new Error('Phrase text cannot be blank');
    }
    const nowIso = new Date().toISOString();
    const id = generateUuidV7();
    const triggerContext = input.triggerContext ?? 'any';
    const animationHint = input.animationHint ?? 'grimoire';

    const row: MobileOfflinePhraseRow = {
      id,
      phrase_text: text,
      trigger_context: triggerContext,
      animation_hint: animationHint,
      is_builtin: false,
      active: true,
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
    };

    this.db.run(
      `INSERT INTO companion_offline_phrases (
        id, phrase_text, trigger_context, animation_hint, is_builtin, active, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, 0, 1, ?, ?, NULL)`,
      [row.id, row.phrase_text, row.trigger_context, row.animation_hint, nowIso, nowIso],
    );

    this.enqueueOutbox('companion_offline_phrases', row.id, 'upsert', { ...row }, nowIso);
    this.persistSnapshot();
    return row;
  }

  deleteOfflinePhrase(id: string): boolean {
    const existing = this.queryOne(
      `SELECT * FROM companion_offline_phrases WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    if (!existing) return false;

    const nowIso = new Date().toISOString();
    this.db.run(
      `UPDATE companion_offline_phrases SET deleted_at = ?, active = 0, updated_at = ? WHERE id = ?`,
      [nowIso, nowIso, id],
    );
    this.enqueueOutbox(
      'companion_offline_phrases',
      id,
      'delete',
      { id, deleted_at: nowIso },
      nowIso,
    );
    this.persistSnapshot();
    return true;
  }

  // =========================================================================
  // Uplink Config, Encrypted PAT & Sync Outbox / Pull Reconciliation
  // =========================================================================

  getUplinkConfig(): MobileUplinkConfigRow {
    const r = this.queryOne(`SELECT * FROM uplink_config WHERE id = 1`);
    if (!r) {
      this.initializeSchemaAndSeeds();
      return this.getUplinkConfig();
    }
    return {
      id: 1,
      client_id: String(r.client_id),
      primary_server_url: String(r.primary_server_url ?? 'http://127.0.0.1:8080'),
      fallback_server_url: String(r.fallback_server_url ?? ''),
      active_server_url: String(r.active_server_url ?? 'http://127.0.0.1:8080'),
      encrypted_pat: String(r.encrypted_pat ?? ''),
      token_prefix: String(r.token_prefix ?? ''),
      last_server_seq: Number(r.last_server_seq ?? 0),
      last_sync_at: r.last_sync_at ? String(r.last_sync_at) : null,
      last_verified_at: r.last_verified_at ? String(r.last_verified_at) : null,
      last_latency_ms:
        r.last_latency_ms !== null && r.last_latency_ms !== undefined
          ? Number(r.last_latency_ms)
          : null,
      uplink_status: (r.uplink_status as MobileUplinkConfigRow['uplink_status']) || 'offline',
      session_key: String(r.session_key || 'mobile-companion-main'),
      updated_at: String(r.updated_at),
    };
  }

  getDecryptedPat(): string {
    const cfg = this.getUplinkConfig();
    if (!cfg.encrypted_pat) return '';
    return decryptPat(cfg.encrypted_pat, cfg.client_id);
  }

  saveUplinkConfig(input: {
    primaryServerUrl?: string;
    fallbackServerUrl?: string;
    rawPat?: string;
    activeServerUrl?: string;
    uplinkStatus?: MobileUplinkConfigRow['uplink_status'];
    lastLatencyMs?: number | null;
    lastVerifiedAt?: string | null;
    lastServerSeq?: number;
    lastSyncAt?: string | null;
    sessionKey?: string;
  }): MobileUplinkConfigRow {
    const current = this.getUplinkConfig();
    const nowIso = new Date().toISOString();

    const primaryUrl =
      input.primaryServerUrl !== undefined
        ? input.primaryServerUrl.trim()
        : current.primary_server_url;
    const fallbackUrl =
      input.fallbackServerUrl !== undefined
        ? input.fallbackServerUrl.trim()
        : current.fallback_server_url;
    const activeUrl =
      input.activeServerUrl !== undefined
        ? input.activeServerUrl.trim()
        : input.primaryServerUrl !== undefined
          ? primaryUrl || fallbackUrl || current.active_server_url
          : current.active_server_url || primaryUrl || fallbackUrl;

    let encryptedPat = current.encrypted_pat;
    let tokenPrefix = current.token_prefix;
    if (input.rawPat !== undefined) {
      const trimmedPat = input.rawPat.trim();
      if (trimmedPat.length > 0) {
        encryptedPat = encryptPat(trimmedPat, current.client_id);
        tokenPrefix = maskPatPrefix(trimmedPat);
      } else {
        encryptedPat = '';
        tokenPrefix = '';
      }
    }

    const uplinkStatus = input.uplinkStatus ?? current.uplink_status;
    const lastLatencyMs =
      input.lastLatencyMs !== undefined ? input.lastLatencyMs : current.last_latency_ms;
    const lastVerifiedAt =
      input.lastVerifiedAt !== undefined ? input.lastVerifiedAt : current.last_verified_at;
    const lastServerSeq =
      input.lastServerSeq !== undefined
        ? Math.max(current.last_server_seq, input.lastServerSeq)
        : current.last_server_seq;
    const lastSyncAt = input.lastSyncAt !== undefined ? input.lastSyncAt : current.last_sync_at;
    const sessionKey =
      input.sessionKey !== undefined && input.sessionKey.trim()
        ? input.sessionKey.trim()
        : current.session_key;

    this.db.run(
      `UPDATE uplink_config SET
        primary_server_url = ?,
        fallback_server_url = ?,
        active_server_url = ?,
        encrypted_pat = ?,
        token_prefix = ?,
        last_server_seq = ?,
        last_sync_at = ?,
        last_verified_at = ?,
        last_latency_ms = ?,
        uplink_status = ?,
        session_key = ?,
        updated_at = ?
      WHERE id = 1`,
      [
        primaryUrl,
        fallbackUrl,
        activeUrl,
        encryptedPat,
        tokenPrefix,
        lastServerSeq,
        lastSyncAt,
        lastVerifiedAt,
        lastLatencyMs,
        uplinkStatus,
        sessionKey,
        nowIso,
      ],
    );

    this.persistSnapshot();
    return this.getUplinkConfig();
  }

  getOutboxMutations(): MobileSyncOutboxRow[] {
    const rows = this.queryAll(`SELECT * FROM sync_outbox ORDER BY created_at ASC`);
    const mapped: MobileSyncOutboxRow[] = rows.map((r) => ({
      mutation_id: String(r.mutation_id),
      entity_table: r.entity_table as SyncEntityTable,
      entity_id: String(r.entity_id),
      op: (r.op as 'upsert' | 'delete') || 'upsert',
      payload: parseJsonSafe<Record<string, unknown>>(r.payload_json, {}),
      client_updated_at: String(r.client_updated_at),
      retry_count: Number(r.retry_count ?? 0),
      last_error: r.last_error ? String(r.last_error) : null,
      created_at: String(r.created_at),
    }));

    return mapped.sort((a, b) => {
      const pa = TABLE_TOPOLOGICAL_PRIORITY[a.entity_table] ?? 99;
      const pb = TABLE_TOPOLOGICAL_PRIORITY[b.entity_table] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.created_at.localeCompare(b.created_at);
    });
  }

  acknowledgeOutboxMutations(mutationIds: string[], serverSeq?: number): void {
    if (mutationIds.length > 0) {
      for (const id of mutationIds) {
        this.db.run(`DELETE FROM sync_outbox WHERE mutation_id = ?`, [id]);
      }
    }
    if (serverSeq !== undefined && Number.isFinite(serverSeq)) {
      const current = this.getUplinkConfig();
      const nextSeq = Math.max(current.last_server_seq, serverSeq);
      this.db.run(
        `UPDATE uplink_config SET last_server_seq = ?, last_sync_at = ?, updated_at = ? WHERE id = 1`,
        [nextSeq, new Date().toISOString(), new Date().toISOString()],
      );
    }
    this.persistSnapshot();
  }

  recordOutboxFailure(mutationIds: string[], errorMsg: string): void {
    for (const id of mutationIds) {
      this.db.run(
        `UPDATE sync_outbox SET retry_count = retry_count + 1, last_error = ? WHERE mutation_id = ?`,
        [errorMsg, id],
      );
    }
    this.persistSnapshot();
  }

  /**
   * Applies server delta changes (`GET /api/sync/pull?since=`) across all 8 synced tables
   * using deterministic `updated_at` Last-Write-Wins (LWW) and tombstone deletion without
   * queuing duplicate `sync_outbox` mutations.
   */
  applyPulledChanges(changes: SyncPullChangeEntry[], latestServerSeq: number): number {
    let appliedCount = 0;
    const unpushedOutbox = this.getOutboxMutations();

    for (const change of changes) {
      const table = change.entity_table as SyncEntityTable;
      if (!ALLOWED_SYNC_TABLES.includes(table)) {
        continue;
      }

      const payload = change.payload ?? {};
      const entityId = String(
        change.entity_id || payload.id || payload.log_date || '',
      ).trim();
      if (!entityId) continue;

      const incomingTs = String(
        payload.updated_at ?? change.changed_at ?? new Date().toISOString(),
      );

      // Check if there is a newer unpushed local mutation in sync_outbox
      const NewerPendingOutbox = unpushedOutbox.find(
        (m) =>
          m.entity_table === table &&
          m.entity_id === entityId &&
          m.client_updated_at > incomingTs,
      );
      if (NewerPendingOutbox) {
        continue;
      }

      const pkCol = table === 'daily_checkins' ? 'log_date' : 'id';
      const existingRow = this.queryOne(
        `SELECT updated_at FROM ${table} WHERE ${pkCol} = ?`,
        [entityId],
      );
      if (existingRow?.updated_at && String(existingRow.updated_at) > incomingTs) {
        continue;
      }

      if (change.op === 'delete' || payload.deleted_at) {
        const delTs = String(payload.deleted_at ?? incomingTs);
        this.db.run(
          `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE ${pkCol} = ?`,
          [delTs, delTs, entityId],
        );
        appliedCount += 1;
        continue;
      }

      const createdAt = String(payload.created_at ?? incomingTs);
      switch (table) {
        case 'projects': {
          this.db.run(
            `INSERT INTO projects (id, name, area, goal_id, status, color, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               area = excluded.area,
               goal_id = excluded.goal_id,
               status = excluded.status,
               color = excluded.color,
               updated_at = excluded.updated_at,
               deleted_at = NULL`,
            [
              entityId,
              String(payload.name ?? 'Project'),
              String(payload.area ?? 'personal'),
              payload.goal_id ? String(payload.goal_id) : null,
              String(payload.status ?? 'active'),
              String(payload.color ?? '#F87C18'),
              createdAt,
              incomingTs,
            ],
          );
          appliedCount += 1;
          break;
        }
        case 'tasks': {
          const tagsJson = Array.isArray(payload.tags)
            ? JSON.stringify(payload.tags)
            : typeof payload.tags === 'string'
              ? payload.tags
              : '[]';
          const blockedJson = Array.isArray(payload.blocked_by_task_ids)
            ? JSON.stringify(payload.blocked_by_task_ids)
            : typeof payload.blocked_by_task_ids === 'string'
              ? payload.blocked_by_task_ids
              : '[]';
          this.db.run(
            `INSERT INTO tasks (
              id, title, description_md, status, priority, project_id, goal_id, course_id, lesson_id,
              parent_task_id, blocked_by_task_ids, vault_note_path, scheduled_date, due_date,
              estimated_minutes, actual_seconds, energy_level, tags, recurrence_rule, sort_order,
              completed_at, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              description_md = excluded.description_md,
              status = excluded.status,
              priority = excluded.priority,
              project_id = excluded.project_id,
              scheduled_date = excluded.scheduled_date,
              due_date = excluded.due_date,
              estimated_minutes = excluded.estimated_minutes,
              actual_seconds = excluded.actual_seconds,
              energy_level = excluded.energy_level,
              tags = excluded.tags,
              completed_at = excluded.completed_at,
              updated_at = excluded.updated_at,
              deleted_at = NULL`,
            [
              entityId,
              String(payload.title ?? 'Untitled Task'),
              String(payload.description_md ?? ''),
              String(payload.status ?? 'todo'),
              String(payload.priority ?? 'medium'),
              payload.project_id ? String(payload.project_id) : null,
              payload.goal_id ? String(payload.goal_id) : null,
              payload.course_id ? String(payload.course_id) : null,
              payload.lesson_id ? String(payload.lesson_id) : null,
              payload.parent_task_id ? String(payload.parent_task_id) : null,
              blockedJson,
              payload.vault_note_path ? String(payload.vault_note_path) : null,
              payload.scheduled_date ? String(payload.scheduled_date).slice(0, 10) : null,
              payload.due_date ? String(payload.due_date) : null,
              payload.estimated_minutes !== null && payload.estimated_minutes !== undefined
                ? Number(payload.estimated_minutes)
                : null,
              Number(payload.actual_seconds ?? 0),
              payload.energy_level ? String(payload.energy_level) : null,
              tagsJson,
              payload.recurrence_rule ? String(payload.recurrence_rule) : null,
              Number(payload.sort_order ?? 0),
              payload.completed_at ? String(payload.completed_at) : null,
              createdAt,
              incomingTs,
            ],
          );
          appliedCount += 1;
          break;
        }
        case 'time_sessions': {
          this.db.run(
            `INSERT INTO time_sessions (
              id, task_id, course_id, lesson_id, category, timer_mode, work_minutes, break_minutes,
              started_at, ended_at, duration_seconds, notes, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET
              ended_at = excluded.ended_at,
              duration_seconds = excluded.duration_seconds,
              notes = excluded.notes,
              updated_at = excluded.updated_at,
              deleted_at = NULL`,
            [
              entityId,
              payload.task_id ? String(payload.task_id) : null,
              payload.course_id ? String(payload.course_id) : null,
              payload.lesson_id ? String(payload.lesson_id) : null,
              String(payload.category ?? 'deep_work'),
              String(payload.timer_mode ?? 'stopwatch'),
              payload.work_minutes !== null && payload.work_minutes !== undefined
                ? Number(payload.work_minutes)
                : null,
              payload.break_minutes !== null && payload.break_minutes !== undefined
                ? Number(payload.break_minutes)
                : null,
              String(payload.started_at ?? createdAt),
              payload.ended_at ? String(payload.ended_at) : null,
              Math.max(0, Number(payload.duration_seconds ?? 0)),
              String(payload.notes ?? ''),
              createdAt,
              incomingTs,
            ],
          );
          appliedCount += 1;
          break;
        }
        case 'routines': {
          this.db.run(
            `INSERT INTO routines (
              id, name, time_slot, day_profile, target_start_time, sort_order, active, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              time_slot = excluded.time_slot,
              day_profile = excluded.day_profile,
              target_start_time = excluded.target_start_time,
              sort_order = excluded.sort_order,
              active = excluded.active,
              updated_at = excluded.updated_at,
              deleted_at = NULL`,
            [
              entityId,
              String(payload.name ?? 'Routine'),
              String(payload.time_slot ?? 'morning'),
              String(payload.day_profile ?? 'workday'),
              payload.target_start_time ? String(payload.target_start_time) : null,
              Number(payload.sort_order ?? 0),
              payload.active === false || payload.active === 0 ? 0 : 1,
              createdAt,
              incomingTs,
            ],
          );
          appliedCount += 1;
          break;
        }
        case 'routine_items': {
          const routineId = String(payload.routine_id ?? '');
          if (!routineId) break;
          const freqJson =
            typeof payload.frequency_config === 'object' && payload.frequency_config !== null
              ? JSON.stringify(payload.frequency_config)
              : typeof payload.frequency_config === 'string'
                ? payload.frequency_config
                : '{}';
          this.db.run(
            `INSERT INTO routine_items (
              id, routine_id, goal_id, title, tracking_type, target_value, unit,
              frequency_type, frequency_config, estimated_minutes, sort_order, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              tracking_type = excluded.tracking_type,
              target_value = excluded.target_value,
              unit = excluded.unit,
              frequency_type = excluded.frequency_type,
              frequency_config = excluded.frequency_config,
              updated_at = excluded.updated_at,
              deleted_at = NULL`,
            [
              entityId,
              routineId,
              payload.goal_id ? String(payload.goal_id) : null,
              String(payload.title ?? 'Habit'),
              String(payload.tracking_type ?? 'boolean'),
              payload.target_value !== null && payload.target_value !== undefined
                ? Number(payload.target_value)
                : null,
              payload.unit ? String(payload.unit) : null,
              String(payload.frequency_type ?? 'daily'),
              freqJson,
              Number(payload.estimated_minutes ?? 10),
              Number(payload.sort_order ?? 0),
              createdAt,
              incomingTs,
            ],
          );
          appliedCount += 1;
          break;
        }
        case 'routine_logs': {
          const routineItemId = String(payload.routine_item_id ?? '');
          const logDate = String(payload.log_date ?? '').slice(0, 10);
          if (!routineItemId || !logDate) break;
          this.db.run(
            `INSERT INTO routine_logs (
              id, routine_item_id, log_date, status, numeric_value, completed_at, notes, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(routine_item_id, log_date) DO UPDATE SET
              status = excluded.status,
              numeric_value = excluded.numeric_value,
              completed_at = excluded.completed_at,
              notes = excluded.notes,
              updated_at = excluded.updated_at,
              deleted_at = NULL`,
            [
              entityId,
              routineItemId,
              logDate,
              String(payload.status ?? 'completed'),
              payload.numeric_value !== null && payload.numeric_value !== undefined
                ? Number(payload.numeric_value)
                : null,
              payload.completed_at ? String(payload.completed_at) : null,
              String(payload.notes ?? ''),
              createdAt,
              incomingTs,
            ],
          );
          appliedCount += 1;
          break;
        }
        case 'daily_checkins': {
          const logDate = String(payload.log_date ?? entityId).slice(0, 10);
          this.db.run(
            `INSERT INTO daily_checkins (
              log_date, day_profile_used, energy_score, mood_score, sleep_hours,
              highlight, reflection_md, weekly_review_json, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(log_date) DO UPDATE SET
              day_profile_used = excluded.day_profile_used,
              energy_score = excluded.energy_score,
              mood_score = excluded.mood_score,
              sleep_hours = excluded.sleep_hours,
              highlight = excluded.highlight,
              reflection_md = excluded.reflection_md,
              updated_at = excluded.updated_at,
              deleted_at = NULL`,
            [
              logDate,
              String(payload.day_profile_used ?? 'workday'),
              payload.energy_score !== null && payload.energy_score !== undefined
                ? Number(payload.energy_score)
                : null,
              payload.mood_score !== null && payload.mood_score !== undefined
                ? Number(payload.mood_score)
                : null,
              payload.sleep_hours !== null && payload.sleep_hours !== undefined
                ? Number(payload.sleep_hours)
                : null,
              String(payload.highlight ?? ''),
              String(payload.reflection_md ?? ''),
              payload.weekly_review_json ? JSON.stringify(payload.weekly_review_json) : null,
              createdAt,
              incomingTs,
            ],
          );
          appliedCount += 1;
          break;
        }
        case 'companion_offline_phrases': {
          this.db.run(
            `INSERT INTO companion_offline_phrases (
              id, phrase_text, trigger_context, animation_hint, is_builtin, active, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET
              phrase_text = excluded.phrase_text,
              trigger_context = excluded.trigger_context,
              animation_hint = excluded.animation_hint,
              active = excluded.active,
              updated_at = excluded.updated_at,
              deleted_at = NULL`,
            [
              entityId,
              String(payload.phrase_text ?? ''),
              String(payload.trigger_context ?? 'any'),
              payload.animation_hint ? String(payload.animation_hint) : null,
              payload.is_builtin ? 1 : 0,
              payload.active === false || payload.active === 0 ? 0 : 1,
              createdAt,
              incomingTs,
            ],
          );
          appliedCount += 1;
          break;
        }
      }
    }

    const currentCfg = this.getUplinkConfig();
    const nextSeq = Math.max(currentCfg.last_server_seq, Number(latestServerSeq || 0));
    const nowIso = new Date().toISOString();
    this.db.run(
      `UPDATE uplink_config SET last_server_seq = ?, last_sync_at = ?, updated_at = ? WHERE id = 1`,
      [nextSeq, nowIso, nowIso],
    );

    this.persistSnapshot();
    return appliedCount;
  }
}
