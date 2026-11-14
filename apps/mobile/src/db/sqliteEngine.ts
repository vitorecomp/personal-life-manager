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

export type CanonicalPhraseTriggerContext =
  | 'any'
  | 'tap'
  | 'screen_open'
  | 'todo_done'
  | 'routine_done';

export type CanonicalPhraseAnimationHint =
  | 'grimoire'
  | 'stargazing'
  | 'blue_flower_spell'
  | 'tea'
  | 'nod_off'
  | 'mimic_gag'
  | 'idle_gaze'
  | 'wind_blink';

export interface MobileOfflinePhraseRow {
  id: string;
  phrase_text: string;
  trigger_context: CanonicalPhraseTriggerContext;
  animation_hint: CanonicalPhraseAnimationHint | null;
  is_builtin: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const VALID_TRIGGER_CONTEXTS = new Set<CanonicalPhraseTriggerContext>([
  'any',
  'tap',
  'screen_open',
  'todo_done',
  'routine_done',
]);

const VALID_ANIMATION_HINTS = new Set<CanonicalPhraseAnimationHint>([
  'grimoire',
  'stargazing',
  'blue_flower_spell',
  'tea',
  'nod_off',
  'mimic_gag',
  'idle_gaze',
  'wind_blink',
]);

export function normalizePhraseTriggerContext(
  raw: string | null | undefined,
): CanonicalPhraseTriggerContext {
  const clean = (raw ?? '').trim().toLowerCase();
  if (VALID_TRIGGER_CONTEXTS.has(clean as CanonicalPhraseTriggerContext)) {
    return clean as CanonicalPhraseTriggerContext;
  }
  // Map legacy/alias contexts ('evening_reflection', 'morning', 'evening', 'idle', etc.) -> 'any'
  return 'any';
}

export function normalizePhraseAnimationHint(
  raw: string | null | undefined,
): CanonicalPhraseAnimationHint | null {
  if (raw === null || raw === undefined) return null;
  const clean = raw.trim().toLowerCase();
  if (!clean) return null;
  if (VALID_ANIMATION_HINTS.has(clean as CanonicalPhraseAnimationHint)) {
    return clean as CanonicalPhraseAnimationHint;
  }
  switch (clean) {
    case 'read_grimoire':
    case 'reading_grimoire':
      return 'grimoire';
    case 'wind_blink_loop':
    case 'idle_breeze':
      return 'wind_blink';
    case 'cast_blue_flora':
    case 'cast_spell':
    case 'casting':
      return 'blue_flower_spell';
    case 'sip_tea':
    case 'drink_tea':
      return 'tea';
    case 'cozy_nap':
    case 'sleep_lean':
    case 'sleeping':
      return 'nod_off';
    case 'celebrate_sparkle':
      return 'mimic_gag';
    case 'idle_ledge_sit':
    case 'walk_ledge':
    case 'calm_gaze':
      return 'idle_gaze';
    default:
      return null;
  }
}

export function clampSleepHours(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const clamped = Math.min(24, Math.max(0, value));
  return Math.round(clamped * 100) / 100;
}

export function clampPulseScore(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(5, Math.max(1, Math.round(value)));
}

/**
 * Epoch- and nanosecond-aware RFC 3339 / ISO 8601 comparator.
 * Prevents stale whole-second `"2026-11-14T20:15:30Z"` or `"+00:00"` server strings
 * from clobbering newer `.950Z` local rows due to raw ASCII `'.'` (46) < `'Z'` (90).
 */
export function compareIsoTimestamps(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const strA = (a ?? '').trim();
  const strB = (b ?? '').trim();
  if (strA === strB) return 0;
  if (!strA) return -1;
  if (!strB) return 1;

  const parseEpochAndSubSecNanos = (
    raw: string,
  ): { secMs: number; nanos: number } | null => {
    const m = raw.match(
      /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/i,
    );
    if (m) {
      const datePart = m[1]!;
      const timePart = m[2]!;
      const frac = m[3] ?? '';
      const rawTz = m[4] ? m[4].toUpperCase() : 'Z';
      const tz =
        rawTz === 'Z' || rawTz.includes(':')
          ? rawTz
          : `${rawTz.slice(0, 3)}:${rawTz.slice(3)}`;
      const secMs = Date.parse(`${datePart}T${timePart}${tz}`);
      if (!Number.isNaN(secMs)) {
        const nanos = Number.parseInt(frac.padEnd(9, '0').slice(0, 9), 10) || 0;
        return { secMs, nanos };
      }
    }
    const fallbackMs = Date.parse(raw);
    if (!Number.isNaN(fallbackMs)) {
      return { secMs: fallbackMs, nanos: 0 };
    }
    return null;
  };

  const parsedA = parseEpochAndSubSecNanos(strA);
  const parsedB = parseEpochAndSubSecNanos(strB);
  if (parsedA && parsedB) {
    if (parsedA.secMs !== parsedB.secMs) {
      return parsedA.secMs > parsedB.secMs ? 1 : -1;
    }
    if (parsedA.nanos !== parsedB.nanos) {
      return parsedA.nanos > parsedB.nanos ? 1 : -1;
    }
    return 0;
  }

  return strA > strB ? 1 : strA < strB ? -1 : 0;
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
    id TEXT NOT NULL DEFAULT '',
    day_profile_used TEXT NOT NULL DEFAULT 'workday' CHECK (day_profile_used IN (
        'workday', 'weekend', 'travel', 'minimum_viable'
    )),
    energy_score INTEGER NULL CHECK (energy_score IS NULL OR (energy_score BETWEEN 1 AND 5)),
    mood_score INTEGER NULL CHECK (mood_score IS NULL OR (mood_score BETWEEN 1 AND 5)),
    sleep_hours REAL NULL CHECK (sleep_hours IS NULL OR (sleep_hours >= 0 AND sleep_hours <= 24)),
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
        'any', 'tap', 'screen_open', 'todo_done', 'routine_done'
    )),
    animation_hint TEXT NULL CHECK (animation_hint IS NULL OR animation_hint IN (
        'grimoire', 'stargazing', 'blue_flower_spell', 'tea', 'nod_off', 'mimic_gag', 'idle_gaze', 'wind_blink'
    )),
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
    synced_entities_json TEXT NOT NULL DEFAULT '[]',
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

function stepIsoDateBackward(baseIsoDate: string, daysBack: number): string {
  const parts = baseIsoDate.split('-').map((p) => Number.parseInt(p, 10));
  const year = parts[0] || 2026;
  const month = (parts[1] || 1) - 1;
  const day = parts[2] || 1;
  const dt = new Date(Date.UTC(year, month, day - daysBack));
  return dt.toISOString().slice(0, 10);
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
    this.db.run('PRAGMA foreign_keys = ON;');
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

  isForeignKeysEnabled(): boolean {
    const row = this.queryOne('PRAGMA foreign_keys;');
    return Number(row?.foreign_keys ?? 0) === 1;
  }

  initializeSchemaAndSeeds(): void {
    this.db.run('PRAGMA foreign_keys = ON;');
    this.db.run(MOBILE_SQLITE_SCHEMA_DDL);

    // Ensure reloaded snapshots created prior to synced_entities_json have the column
    const uplinkCols = this.queryAll('PRAGMA table_info(uplink_config);');
    const hasSyncedCol = uplinkCols.some((c) => String(c.name) === 'synced_entities_json');
    if (uplinkCols.length > 0 && !hasSyncedCol) {
      this.db.run(
        `ALTER TABLE uplink_config ADD COLUMN synced_entities_json TEXT NOT NULL DEFAULT '[]';`,
      );
    }

    // Ensure reloaded snapshots created prior to daily_checkins.id have the canonical id column
    const checkinCols = this.queryAll('PRAGMA table_info(daily_checkins);');
    const hasCheckinIdCol = checkinCols.some((c) => String(c.name) === 'id');
    if (checkinCols.length > 0 && !hasCheckinIdCol) {
      this.db.run(`ALTER TABLE daily_checkins ADD COLUMN id TEXT NOT NULL DEFAULT '';`);
    }
    this.db.run(`UPDATE daily_checkins SET id = log_date WHERE id = '' OR id IS NULL;`);

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
          last_latency_ms, uplink_status, session_key, synced_entities_json, updated_at
        ) VALUES (1, ?, 'http://127.0.0.1:8080', '', 'http://127.0.0.1:8080', '', '', 0, NULL, NULL, NULL, 'offline', 'mobile-companion-main', '[]', ?)`,
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

  private readSyncedEntitiesSet(): Set<string> {
    const row = this.queryOne(`SELECT synced_entities_json FROM uplink_config WHERE id = 1`);
    const list = parseJsonSafe<string[]>(row?.synced_entities_json, []);
    return new Set(list.filter((item) => typeof item === 'string' && item.length > 0));
  }

  private writeSyncedEntitiesSet(syncedSet: Set<string>): void {
    const serialized = JSON.stringify(Array.from(syncedSet));
    this.db.run(`UPDATE uplink_config SET synced_entities_json = ? WHERE id = 1`, [serialized]);
  }

  private hasPendingOutboxUpsert(entityTable: SyncEntityTable, entityId: string): boolean {
    const row = this.queryOne(
      `SELECT mutation_id FROM sync_outbox WHERE entity_table = ? AND entity_id = ? AND op = 'upsert' LIMIT 1`,
      [entityTable, entityId],
    );
    return Boolean(row);
  }

  private isEntitySyncedOrQueued(
    entityTable: SyncEntityTable,
    entityId: string,
    syncedSet: Set<string>,
  ): boolean {
    return (
      syncedSet.has(`${entityTable}:${entityId}`) ||
      this.hasPendingOutboxUpsert(entityTable, entityId)
    );
  }

  private sanitizeOutboxPayload(
    entityTable: SyncEntityTable,
    op: 'upsert' | 'delete',
    rawPayload: Record<string, unknown>,
  ): Record<string, unknown> {
    if (op === 'delete') {
      return { ...rawPayload };
    }
    const payload: Record<string, unknown> = { ...rawPayload };

    if (entityTable === 'tasks') {
      payload.tags = Array.isArray(payload.tags)
        ? payload.tags.map((t) => String(t))
        : parseJsonSafe<string[]>(payload.tags, []);
      payload.blocked_by_task_ids = Array.isArray(payload.blocked_by_task_ids)
        ? payload.blocked_by_task_ids.map((id) => String(id))
        : parseJsonSafe<string[]>(payload.blocked_by_task_ids, []);
    } else if (entityTable === 'routines') {
      payload.active =
        payload.active === undefined ? true : Boolean(payload.active);
    } else if (entityTable === 'routine_items') {
      if (typeof payload.frequency_config === 'string') {
        payload.frequency_config = parseJsonSafe<Record<string, unknown>>(
          payload.frequency_config,
          {},
        );
      } else if (
        typeof payload.frequency_config !== 'object' ||
        payload.frequency_config === null ||
        Array.isArray(payload.frequency_config)
      ) {
        payload.frequency_config = {};
      }
    } else if (entityTable === 'daily_checkins') {
      if (payload.energy_score !== undefined) {
        payload.energy_score = clampPulseScore(
          payload.energy_score === null ? null : Number(payload.energy_score),
        );
      }
      if (payload.mood_score !== undefined) {
        payload.mood_score = clampPulseScore(
          payload.mood_score === null ? null : Number(payload.mood_score),
        );
      }
      if (payload.sleep_hours !== undefined) {
        payload.sleep_hours = clampSleepHours(
          payload.sleep_hours === null ? null : Number(payload.sleep_hours),
        );
      }
    } else if (entityTable === 'companion_offline_phrases') {
      payload.trigger_context = normalizePhraseTriggerContext(
        payload.trigger_context ? String(payload.trigger_context) : 'any',
      );
      payload.animation_hint = normalizePhraseAnimationHint(
        payload.animation_hint !== null && payload.animation_hint !== undefined
          ? String(payload.animation_hint)
          : null,
      );
      payload.is_builtin = Boolean(payload.is_builtin);
      payload.active = payload.active === undefined ? true : Boolean(payload.active);
    }

    return payload;
  }

  /**
   * Idempotently enqueues any unsynced local FK ancestor rows into `sync_outbox`
   * before enqueuing a child `upsert` mutation so `POST /api/sync/push` never fails
   * with PostgreSQL `23503` (`Foreign key constraint failed`).
   */
  private ensureParentOutboxChain(
    entityTable: SyncEntityTable,
    payload: Record<string, unknown>,
    clientUpdatedAt: string,
    visited: Set<string>,
  ): void {
    const syncedSet = this.readSyncedEntitiesSet();

    if (entityTable === 'tasks') {
      const projId = typeof payload.project_id === 'string' ? payload.project_id.trim() : '';
      if (projId && !this.isEntitySyncedOrQueued('projects', projId, syncedSet)) {
        const proj = this.getProject(projId);
        if (proj) {
          this.enqueueOutbox(
            'projects',
            proj.id,
            'upsert',
            { ...proj },
            proj.updated_at || clientUpdatedAt,
            visited,
          );
        }
      }

      const parentTaskId =
        typeof payload.parent_task_id === 'string' ? payload.parent_task_id.trim() : '';
      if (parentTaskId && !this.isEntitySyncedOrQueued('tasks', parentTaskId, syncedSet)) {
        const parentTask = this.getTask(parentTaskId);
        if (parentTask) {
          this.enqueueOutbox(
            'tasks',
            parentTask.id,
            'upsert',
            { ...parentTask },
            parentTask.updated_at || clientUpdatedAt,
            visited,
          );
        }
      }
    } else if (entityTable === 'time_sessions') {
      const taskId = typeof payload.task_id === 'string' ? payload.task_id.trim() : '';
      if (taskId && !this.isEntitySyncedOrQueued('tasks', taskId, syncedSet)) {
        const parentTask = this.getTask(taskId);
        if (parentTask) {
          this.enqueueOutbox(
            'tasks',
            parentTask.id,
            'upsert',
            { ...parentTask },
            parentTask.updated_at || clientUpdatedAt,
            visited,
          );
        }
      }
    } else if (entityTable === 'routine_items') {
      const routineId = typeof payload.routine_id === 'string' ? payload.routine_id.trim() : '';
      if (routineId && !this.isEntitySyncedOrQueued('routines', routineId, syncedSet)) {
        const parentRoutine = this.getRoutine(routineId);
        if (parentRoutine) {
          this.enqueueOutbox(
            'routines',
            parentRoutine.id,
            'upsert',
            { ...parentRoutine },
            parentRoutine.updated_at || clientUpdatedAt,
            visited,
          );
        }
      }
    } else if (entityTable === 'routine_logs') {
      const itemId =
        typeof payload.routine_item_id === 'string' ? payload.routine_item_id.trim() : '';
      if (itemId && !this.isEntitySyncedOrQueued('routine_items', itemId, syncedSet)) {
        const parentItem = this.getRoutineItem(itemId);
        if (parentItem) {
          this.enqueueOutbox(
            'routine_items',
            parentItem.id,
            'upsert',
            { ...parentItem },
            parentItem.updated_at || clientUpdatedAt,
            visited,
          );
        }
      }
    }
  }

  private enqueueOutbox(
    entityTable: SyncEntityTable,
    entityId: string,
    op: 'upsert' | 'delete',
    rawPayload: Record<string, unknown>,
    clientUpdatedAt: string,
    visited: Set<string> = new Set(),
  ): MobileSyncOutboxRow {
    if (!ALLOWED_SYNC_TABLES.includes(entityTable)) {
      throw new Error(`Invalid sync table: ${entityTable}`);
    }

    const visitKey = `${entityTable}:${entityId}:${op}`;
    const payload = this.sanitizeOutboxPayload(entityTable, op, rawPayload);

    if (op === 'upsert' && !visited.has(visitKey)) {
      visited.add(visitKey);
      this.ensureParentOutboxChain(entityTable, payload, clientUpdatedAt, visited);
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

  private mapProjectRow(r: Record<string, unknown>): MobileProjectRow {
    return {
      id: String(r.id),
      name: String(r.name),
      area: String(r.area || 'personal'),
      goal_id: r.goal_id ? String(r.goal_id) : null,
      status: (r.status as MobileProjectRow['status']) || 'active',
      color: String(r.color || '#F87C18'),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      deleted_at: r.deleted_at ? String(r.deleted_at) : null,
    };
  }

  listProjects(): MobileProjectRow[] {
    const rows = this.queryAll(
      `SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY name ASC`,
    );
    return rows.map((r) => this.mapProjectRow(r));
  }

  getProject(projectId: string): MobileProjectRow | null {
    const row = this.queryOne(`SELECT * FROM projects WHERE id = ?`, [projectId]);
    return row ? this.mapProjectRow(row) : null;
  }

  createProject(input: {
    name: string;
    area?: string;
    status?: MobileProjectRow['status'];
    color?: string;
    goalId?: string | null;
  }): MobileProjectRow {
    const trimmed = (input.name ?? '').trim();
    if (!trimmed) {
      throw new Error('Project name cannot be blank');
    }
    const validAreas = new Set([
      'career',
      'health',
      'learning',
      'finance',
      'personal',
      'personal_project',
      'relationships',
      'systems',
    ]);
    const rawArea = (input.area ?? 'personal').trim().toLowerCase();
    const area = validAreas.has(rawArea) ? rawArea : 'personal';
    const validStatuses = new Set(['active', 'paused', 'completed', 'archived']);
    const status =
      input.status && validStatuses.has(input.status) ? input.status : 'active';
    const color = (input.color ?? '#F87C18').trim() || '#F87C18';
    const nowIso = new Date().toISOString();
    const id = generateUuidV7();

    const project: MobileProjectRow = {
      id,
      name: trimmed,
      area,
      goal_id: input.goalId ?? null,
      status,
      color,
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
    };

    this.db.run(
      `INSERT INTO projects (
        id, name, area, goal_id, status, color, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        project.id,
        project.name,
        project.area,
        project.goal_id,
        project.status,
        project.color,
        project.created_at,
        project.updated_at,
      ],
    );

    this.enqueueOutbox('projects', project.id, 'upsert', { ...project }, nowIso);
    this.persistSnapshot();
    return project;
  }

  deleteProject(projectId: string): boolean {
    const existing = this.getProject(projectId);
    if (!existing || existing.deleted_at) return false;

    const nowIso = new Date().toISOString();
    this.db.run(`UPDATE tasks SET project_id = NULL, updated_at = ? WHERE project_id = ?`, [
      nowIso,
      projectId,
    ]);
    this.db.run(`UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      nowIso,
      nowIso,
      projectId,
    ]);
    this.enqueueOutbox('projects', projectId, 'delete', { id: projectId, deleted_at: nowIso }, nowIso);
    this.persistSnapshot();
    return true;
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
    options?: { projectId?: string | null; parentTaskId?: string | null },
  ): { task: MobileTaskRow; mutation: MobileSyncOutboxRow } {
    const parsed = parseTodoQuickCapture(rawInput, todayIsoDate);
    if (!parsed.valid) {
      throw new Error(parsed.error || 'Task title cannot be blank');
    }

    let resolvedProjectId: string | null = null;
    if (options?.projectId) {
      const explicitProj = this.getProject(options.projectId);
      if (!explicitProj || explicitProj.deleted_at) {
        throw new Error(`Project not found: ${options.projectId}`);
      }
      resolvedProjectId = explicitProj.id;
    } else if (parsed.projectHint) {
      const hintSlug = parsed.projectHint.toLowerCase().replace(/[\s_]+/g, '-');
      const matched = this.listProjects().find((p) => {
        const nameLower = p.name.toLowerCase();
        const nameSlug = nameLower.replace(/[\s_]+/g, '-');
        return nameLower === parsed.projectHint!.toLowerCase() || nameSlug === hintSlug;
      });
      if (matched) {
        resolvedProjectId = matched.id;
      }
    }

    let resolvedParentTaskId: string | null = null;
    if (options?.parentTaskId) {
      const explicitParent = this.getTask(options.parentTaskId);
      if (!explicitParent || explicitParent.deleted_at) {
        throw new Error(`Parent task not found: ${options.parentTaskId}`);
      }
      resolvedParentTaskId = explicitParent.id;
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
      parent_task_id: resolvedParentTaskId,
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
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, '[]', NULL, ?, NULL, ?, 0, ?, ?, NULL, 0, NULL, ?, ?, NULL)`,
      [
        task.id,
        task.title,
        task.description_md,
        task.status,
        task.priority,
        task.project_id,
        task.parent_task_id,
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
    if (!existing || existing.deleted_at) return null;

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
    if (!existing || existing.deleted_at) return false;

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
    startedAtIso?: string;
  }): MobileTimeSessionRow {
    const requestedTaskId = options.taskId ? options.taskId.trim() : null;
    if (requestedTaskId) {
      const targetTask = this.getTask(requestedTaskId);
      if (!targetTask || targetTask.deleted_at) {
        throw new Error(`Task not found for focus timer: ${requestedTaskId}`);
      }
    }

    // Auto-stop any currently running timer using real elapsed duration (never hardcoded 60s!)
    const running = this.getActiveTimer();
    if (running) {
      this.stopFocusTimer();
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

    const nowIso = options.startedAtIso ?? new Date().toISOString();
    const id = generateUuidV7();
    this.db.run(
      `INSERT INTO time_sessions (
        id, task_id, course_id, lesson_id, category, timer_mode, work_minutes, break_minutes,
        started_at, ended_at, duration_seconds, notes, created_at, updated_at, deleted_at
      ) VALUES (?, ?, NULL, NULL, 'deep_work', ?, ?, ?, ?, NULL, 0, ?, ?, ?, NULL)`,
      [
        id,
        requestedTaskId,
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
    const startedMs = Date.parse(running.started_at);
    const rawElapsed = Number.isFinite(startedMs)
      ? Math.round((Date.now() - startedMs) / 1000)
      : 1;
    const elapsedSec =
      overrideDurationSeconds !== undefined
        ? Math.max(1, Math.floor(overrideDurationSeconds))
        : Math.max(1, rawElapsed);

    this.db.run(
      `UPDATE time_sessions SET ended_at = ?, duration_seconds = ?, updated_at = ? WHERE id = ?`,
      [nowIso, elapsedSec, nowIso, running.id],
    );

    const completedSession = this.mapTimeSessionRow(
      this.queryOne(`SELECT * FROM time_sessions WHERE id = ?`, [running.id])!,
    );

    if (completedSession.task_id) {
      const task = this.getTask(completedSession.task_id);
      if (task && !task.deleted_at) {
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

    this.enqueueOutbox(
      'time_sessions',
      completedSession.id,
      'upsert',
      { ...completedSession },
      nowIso,
    );

    this.persistSnapshot();
    return completedSession;
  }

  // =========================================================================
  // Routines, Habit Logs, Streaks & Daily Check-ins (Module 08)
  // =========================================================================

  private mapRoutineRow(r: Record<string, unknown>): MobileRoutineRow {
    return {
      id: String(r.id),
      name: String(r.name),
      time_slot: (r.time_slot as RoutineTimeSlot) || 'morning',
      day_profile: ((r.day_profile as DayProfile | 'all') || 'workday'),
      target_start_time: r.target_start_time ? String(r.target_start_time) : null,
      sort_order: Number(r.sort_order ?? 0),
      active: Boolean(r.active),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      deleted_at: r.deleted_at ? String(r.deleted_at) : null,
    };
  }

  private mapRoutineItemRow(ir: Record<string, unknown>): MobileRoutineItemRow {
    return {
      id: String(ir.id),
      routine_id: String(ir.routine_id),
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
      frequency_config: parseJsonSafe<Record<string, unknown>>(ir.frequency_config, {}),
      estimated_minutes:
        ir.estimated_minutes !== null && ir.estimated_minutes !== undefined
          ? Number(ir.estimated_minutes)
          : null,
      sort_order: Number(ir.sort_order ?? 0),
      created_at: String(ir.created_at),
      updated_at: String(ir.updated_at),
      deleted_at: ir.deleted_at ? String(ir.deleted_at) : null,
    };
  }

  listRoutines(): MobileRoutineRow[] {
    const rows = this.queryAll(
      `SELECT * FROM routines WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC`,
    );
    return rows.map((r) => this.mapRoutineRow(r));
  }

  getRoutine(routineId: string): MobileRoutineRow | null {
    const row = this.queryOne(`SELECT * FROM routines WHERE id = ?`, [routineId]);
    return row ? this.mapRoutineRow(row) : null;
  }

  getRoutineItem(routineItemId: string): MobileRoutineItemRow | null {
    const row = this.queryOne(`SELECT * FROM routine_items WHERE id = ?`, [routineItemId]);
    return row ? this.mapRoutineItemRow(row) : null;
  }

  createRoutine(input: {
    name: string;
    timeSlot?: RoutineTimeSlot;
    dayProfile?: DayProfile | 'all';
    targetStartTime?: string | null;
    sortOrder?: number;
    active?: boolean;
  }): MobileRoutineRow {
    const trimmed = (input.name ?? '').trim();
    if (!trimmed) {
      throw new Error('Routine name cannot be blank');
    }
    const validSlots = new Set<RoutineTimeSlot>([
      'morning',
      'afternoon',
      'shutdown',
      'evening',
      'custom',
    ]);
    const timeSlot: RoutineTimeSlot =
      input.timeSlot && validSlots.has(input.timeSlot) ? input.timeSlot : 'morning';
    const validProfiles = new Set<DayProfile | 'all'>([
      'workday',
      'weekend',
      'travel',
      'minimum_viable',
      'all',
    ]);
    const dayProfile: DayProfile | 'all' =
      input.dayProfile && validProfiles.has(input.dayProfile) ? input.dayProfile : 'workday';
    const targetStartTime = input.targetStartTime ? input.targetStartTime.trim() : null;
    const sortOrder = input.sortOrder ?? 0;
    const active = input.active ?? true;
    const nowIso = new Date().toISOString();
    const id = generateUuidV7();

    const routine: MobileRoutineRow = {
      id,
      name: trimmed,
      time_slot: timeSlot,
      day_profile: dayProfile,
      target_start_time: targetStartTime,
      sort_order: sortOrder,
      active,
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
    };

    this.db.run(
      `INSERT INTO routines (
        id, name, time_slot, day_profile, target_start_time, sort_order, active, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        routine.id,
        routine.name,
        routine.time_slot,
        routine.day_profile,
        routine.target_start_time,
        routine.sort_order,
        routine.active ? 1 : 0,
        routine.created_at,
        routine.updated_at,
      ],
    );

    this.enqueueOutbox('routines', routine.id, 'upsert', { ...routine }, nowIso);
    this.persistSnapshot();
    return routine;
  }

  deleteRoutine(routineId: string): boolean {
    const existing = this.getRoutine(routineId);
    if (!existing || existing.deleted_at) return false;

    const nowIso = new Date().toISOString();
    this.db.run(
      `UPDATE routine_logs SET deleted_at = ?, updated_at = ?
       WHERE routine_item_id IN (SELECT id FROM routine_items WHERE routine_id = ?)`,
      [nowIso, nowIso, routineId],
    );
    this.db.run(
      `UPDATE routine_items SET deleted_at = ?, updated_at = ? WHERE routine_id = ?`,
      [nowIso, nowIso, routineId],
    );
    this.db.run(
      `UPDATE routines SET deleted_at = ?, active = 0, updated_at = ? WHERE id = ?`,
      [nowIso, nowIso, routineId],
    );

    this.enqueueOutbox(
      'routines',
      routineId,
      'delete',
      { id: routineId, deleted_at: nowIso },
      nowIso,
    );
    this.persistSnapshot();
    return true;
  }

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

    /**
     * Counts consecutive `'completed'` calendar days walking backward from `logDate`.
     * Allows `logDate` itself to be unlogged (or in-progress `'partial'`) if `logDate - 1`
     * was `'completed'`, and breaks immediately to `0` on `'skipped'` or missing days.
     */
    const computeItemStreak = (itemId: string): number => {
      const itemLogs = logsByItem.get(itemId) ?? [];
      if (itemLogs.length === 0) return 0;

      const statusByDate = new Map<string, MobileRoutineLogRow['status']>();
      for (const log of itemLogs) {
        if (!statusByDate.has(log.log_date)) {
          statusByDate.set(log.log_date, log.status);
        }
      }

      const todayStatus = statusByDate.get(logDate);
      if (todayStatus === 'skipped') {
        return 0;
      }

      let streak = 0;
      let offset = 0;
      if (todayStatus === 'completed') {
        streak = 1;
        offset = 1;
      } else {
        // Unlogged or partial on logDate: check consecutive completions starting yesterday
        offset = 1;
      }

      for (let guard = 0; guard < 3660; guard += 1) {
        const checkDate = stepIsoDateBackward(logDate, offset);
        if (statusByDate.get(checkDate) === 'completed') {
          streak += 1;
          offset += 1;
        } else {
          break;
        }
      }

      return streak;
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
        const mappedBase = this.mapRoutineItemRow(ir);
        const itemLogs = logsByItem.get(mappedBase.id) ?? [];
        const todayLog = itemLogs.find((l) => l.log_date === logDate) ?? null;

        if (
          dayProfile === 'minimum_viable' &&
          mappedBase.frequency_config.mvd_included === false &&
          !todayLog
        ) {
          continue;
        }

        mappedItems.push({
          ...mappedBase,
          todayLog,
          streakDays: computeItemStreak(mappedBase.id),
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
    const itemRow = this.queryOne(
      `SELECT * FROM routine_items WHERE id = ? AND deleted_at IS NULL`,
      [routineItemId],
    );
    if (!itemRow) {
      throw new Error(`Parent routine_item not found: ${routineItemId}`);
    }

    const existing = this.queryOne(
      `SELECT * FROM routine_logs WHERE routine_item_id = ? AND log_date = ?`,
      [routineItemId, logDate],
    );
    const targetVal =
      itemRow.target_value !== null && itemRow.target_value !== undefined
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
    const itemRow = this.queryOne(
      `SELECT * FROM routine_items WHERE id = ? AND deleted_at IS NULL`,
      [routineItemId],
    );
    if (!itemRow) {
      throw new Error(`Parent routine_item not found: ${routineItemId}`);
    }
    const targetVal =
      itemRow.target_value !== null && itemRow.target_value !== undefined
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
    const parentRoutine = this.getRoutine(input.routineId);
    if (!parentRoutine || parentRoutine.deleted_at) {
      throw new Error(`Parent routine not found: ${input.routineId}`);
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
    const existingRaw = this.queryOne(
      `SELECT id, created_at, day_profile_used FROM daily_checkins WHERE log_date = ? AND deleted_at IS NULL`,
      [logDate],
    );
    const existing = this.getDailyCheckin(logDate);
    const nowIso = new Date().toISOString();
    const canonicalId =
      existingRaw?.id && String(existingRaw.id).trim() ? String(existingRaw.id).trim() : logDate;
    const createdAt = existing?.created_at ?? nowIso;
    const dayProfileUsed = input.dayProfileUsed ?? existing?.day_profile_used ?? 'workday';
    const energy = clampPulseScore(input.energyScore);
    const mood = clampPulseScore(input.moodScore);
    const sleepHours = clampSleepHours(input.sleepHours);

    this.db.run(
      `INSERT INTO daily_checkins (
        log_date, id, day_profile_used, energy_score, mood_score, sleep_hours,
        highlight, reflection_md, weekly_review_json, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
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
        canonicalId,
        dayProfileUsed,
        energy,
        mood,
        sleepHours,
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
      trigger_context: normalizePhraseTriggerContext(
        r.trigger_context ? String(r.trigger_context) : 'any',
      ),
      animation_hint: normalizePhraseAnimationHint(
        r.animation_hint ? String(r.animation_hint) : null,
      ),
      is_builtin: Boolean(r.is_builtin),
      active: Boolean(r.active),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      deleted_at: r.deleted_at ? String(r.deleted_at) : null,
    }));
  }

  createOfflinePhrase(input: {
    phraseText: string;
    triggerContext?: CanonicalPhraseTriggerContext | 'evening_reflection' | string | null;
    animationHint?: string | null;
  }): MobileOfflinePhraseRow {
    const text = input.phraseText.trim();
    if (!text) {
      throw new Error('Phrase text cannot be blank');
    }
    const nowIso = new Date().toISOString();
    const id = generateUuidV7();
    const triggerContext = normalizePhraseTriggerContext(input.triggerContext ?? 'any');
    const animationHint =
      input.animationHint === undefined
        ? 'grimoire'
        : normalizePhraseAnimationHint(input.animationHint);

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
    const rows = this.queryAll(`SELECT rowid AS _seq, * FROM sync_outbox ORDER BY rowid ASC`);
    const withSeq = rows.map((r) => ({
      _seq: Number(r._seq ?? 0),
      row: {
        mutation_id: String(r.mutation_id),
        entity_table: r.entity_table as SyncEntityTable,
        entity_id: String(r.entity_id),
        op: (r.op as 'upsert' | 'delete') || 'upsert',
        payload: parseJsonSafe<Record<string, unknown>>(r.payload_json, {}),
        client_updated_at: String(r.client_updated_at),
        retry_count: Number(r.retry_count ?? 0),
        last_error: r.last_error ? String(r.last_error) : null,
        created_at: String(r.created_at),
      } satisfies MobileSyncOutboxRow,
    }));

    // Group by table topological priority first (preserving ascending _seq order)
    withSeq.sort((a, b) => {
      const pa = TABLE_TOPOLOGICAL_PRIORITY[a.row.entity_table] ?? 99;
      const pb = TABLE_TOPOLOGICAL_PRIORITY[b.row.entity_table] ?? 99;
      if (pa !== pb) return pa - pb;
      return a._seq - b._seq;
    });

    // Apply transitive topological sort (Kahn's algorithm) over `tasks.parent_task_id`
    // while preserving ascending `_seq` tie-breaking and gracefully handling cycles.
    const result: MobileSyncOutboxRow[] = [];
    let idx = 0;
    while (idx < withSeq.length) {
      const currentTable = withSeq[idx]!.row.entity_table;
      if (currentTable !== 'tasks') {
        result.push(withSeq[idx]!.row);
        idx += 1;
        continue;
      }

      const taskSlice: typeof withSeq = [];
      while (idx < withSeq.length && withSeq[idx]!.row.entity_table === 'tasks') {
        taskSlice.push(withSeq[idx]!);
        idx += 1;
      }

      const n = taskSlice.length;
      if (n <= 1) {
        for (const item of taskSlice) {
          result.push(item.row);
        }
        continue;
      }

      const adj: Array<Set<number>> = Array.from({ length: n }, () => new Set<number>());
      const inDegree = new Int32Array(n);
      const addEdge = (from: number, to: number) => {
        if (from === to || adj[from]!.has(to)) return;
        adj[from]!.add(to);
        inDegree[to] = (inDegree[to] ?? 0) + 1;
      };

      // Preserve chronological mutation order for repeated mutations on the same task entity_id
      const prevIdxByEntity = new Map<string, number>();
      const upsertIndicesByEntity = new Map<string, number[]>();
      for (let i = 0; i < n; i += 1) {
        const entityId = taskSlice[i]!.row.entity_id;
        const prevIdx = prevIdxByEntity.get(entityId);
        if (prevIdx !== undefined) {
          addEdge(prevIdx, i);
        }
        prevIdxByEntity.set(entityId, i);

        if (taskSlice[i]!.row.op === 'upsert') {
          const list = upsertIndicesByEntity.get(entityId) ?? [];
          list.push(i);
          upsertIndicesByEntity.set(entityId, list);
        }
      }

      // Add transitive parent_task_id -> child edges across queued task upserts
      for (let i = 0; i < n; i += 1) {
        const row = taskSlice[i]!.row;
        const rawParent = row.payload.parent_task_id;
        const parentId = typeof rawParent === 'string' ? rawParent.trim() : '';
        if (parentId && parentId !== row.entity_id) {
          const parentUpserts = upsertIndicesByEntity.get(parentId);
          if (parentUpserts) {
            for (const pIdx of parentUpserts) {
              addEdge(pIdx, i);
            }
          }
        }
      }

      const emitted = new Uint8Array(n);
      const ready: number[] = [];
      for (let i = 0; i < n; i += 1) {
        if (inDegree[i] === 0) {
          ready.push(i);
        }
      }

      while (ready.length > 0) {
        // Pick the ready node with the smallest _seq
        let bestPos = 0;
        for (let r = 1; r < ready.length; r += 1) {
          if (taskSlice[ready[r]!]!._seq < taskSlice[ready[bestPos]!]!._seq) {
            bestPos = r;
          }
        }
        const u = ready[bestPos]!;
        ready.splice(bestPos, 1);
        if (emitted[u]) continue;
        emitted[u] = 1;
        result.push(taskSlice[u]!.row);

        for (const v of adj[u]!) {
          inDegree[v] = (inDegree[v] ?? 0) - 1;
          if (inDegree[v] === 0 && !emitted[v]) {
            ready.push(v);
          }
        }
      }

      // Cycle fallback: emit any remaining task mutations in ascending _seq order
      for (let i = 0; i < n; i += 1) {
        if (!emitted[i]) {
          result.push(taskSlice[i]!.row);
        }
      }
    }

    return result;
  }

  acknowledgeOutboxMutations(mutationIds: string[], serverSeq?: number): void {
    if (mutationIds.length > 0) {
      const syncedSet = this.readSyncedEntitiesSet();
      for (const id of mutationIds) {
        const existing = this.queryOne(
          `SELECT entity_table, entity_id, op FROM sync_outbox WHERE mutation_id = ?`,
          [id],
        );
        if (existing) {
          const key = `${String(existing.entity_table)}:${String(existing.entity_id)}`;
          if (String(existing.op) === 'delete') {
            syncedSet.delete(key);
          } else {
            syncedSet.add(key);
          }
        }
        this.db.run(`DELETE FROM sync_outbox WHERE mutation_id = ?`, [id]);
      }
      this.writeSyncedEntitiesSet(syncedSet);
    }
    if (serverSeq !== undefined && Number.isFinite(serverSeq)) {
      const current = this.getUplinkConfig();
      const nextSeq = Math.max(current.last_server_seq, serverSeq);
      const nowIso = new Date().toISOString();
      this.db.run(
        `UPDATE uplink_config SET last_server_seq = ?, last_sync_at = ?, updated_at = ? WHERE id = 1`,
        [nextSeq, nowIso, nowIso],
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
   * using deterministic epoch-aware `updated_at` Last-Write-Wins (LWW) and tombstone deletion
   * without queuing duplicate `sync_outbox` mutations.
   */
  applyPulledChanges(changes: SyncPullChangeEntry[], latestServerSeq: number): number {
    let appliedCount = 0;
    const unpushedOutbox = this.getOutboxMutations();
    const syncedSet = this.readSyncedEntitiesSet();

    // Order distinct tables topologically while preserving chronological order per entity
    const indexedChanges = changes.map((change, idx) => ({ change, idx }));
    indexedChanges.sort((a, b) => {
      const tableA = a.change.entity_table as SyncEntityTable;
      const tableB = b.change.entity_table as SyncEntityTable;
      if (tableA === tableB) return a.idx - b.idx;
      const pa = TABLE_TOPOLOGICAL_PRIORITY[tableA] ?? 99;
      const pb = TABLE_TOPOLOGICAL_PRIORITY[tableB] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.idx - b.idx;
    });

    for (const { change } of indexedChanges) {
      const table = change.entity_table as SyncEntityTable;
      if (!ALLOWED_SYNC_TABLES.includes(table)) {
        continue;
      }

      const payload = change.payload ?? {};
      const entityId = String(
        change.entity_id ||
          payload.id ||
          payload.log_date ||
          payload.checkin_date ||
          '',
      ).trim();
      if (!entityId) continue;

      const isDeleteOp = change.op === 'delete' || Boolean(payload.deleted_at);
      const incomingTs = isDeleteOp
        ? String(
            payload.deleted_at ??
              change.changed_at ??
              payload.updated_at ??
              new Date().toISOString(),
          )
        : String(
            payload.updated_at ?? change.changed_at ?? new Date().toISOString(),
          );

      // Extract composite / natural unique keys for routine_logs and daily_checkins
      const rItemId =
        table === 'routine_logs' && payload.routine_item_id
          ? String(payload.routine_item_id).trim()
          : null;
      const rLogDate =
        table === 'routine_logs' && payload.log_date
          ? String(payload.log_date).trim().slice(0, 10)
          : null;

      const rawCheckinDate =
        table === 'daily_checkins'
          ? String(
              payload.checkin_date ??
                payload.log_date ??
                (/^\d{4}-\d{2}-\d{2}/.test(entityId) ? entityId : ''),
            )
              .trim()
              .slice(0, 10)
          : '';
      const cDate = /^\d{4}-\d{2}-\d{2}$/.test(rawCheckinDate) ? rawCheckinDate : null;

      // Check if there is a newer unpushed local mutation in sync_outbox (epoch-aware RFC 3339 LWW + natural keys)
      const newerPendingOutbox = unpushedOutbox.find((m) => {
        if (m.entity_table !== table) return false;
        let matchesTarget = m.entity_id === entityId;
        if (!matchesTarget && table === 'routine_logs' && rItemId && rLogDate) {
          matchesTarget =
            String(m.payload.routine_item_id ?? '').trim() === rItemId &&
            String(m.payload.log_date ?? '').trim().slice(0, 10) === rLogDate;
        } else if (!matchesTarget && table === 'daily_checkins' && cDate) {
          const mDate = String(
            m.payload.checkin_date ?? m.payload.log_date ?? m.entity_id ?? '',
          )
            .trim()
            .slice(0, 10);
          matchesTarget = m.entity_id === cDate || mDate === cDate;
        }
        return matchesTarget && compareIsoTimestamps(m.client_updated_at, incomingTs) > 0;
      });
      if (newerPendingOutbox) {
        continue;
      }

      let existingRows: Record<string, unknown>[];
      if (table === 'routine_logs') {
        existingRows = this.queryAll(
          `SELECT id, updated_at FROM routine_logs
           WHERE id = ? OR (? IS NOT NULL AND ? IS NOT NULL AND routine_item_id = ? AND log_date = ?)`,
          [entityId, rItemId, rLogDate, rItemId, rLogDate],
        );
      } else if (table === 'daily_checkins') {
        existingRows = this.queryAll(
          `SELECT id, log_date, updated_at FROM daily_checkins
           WHERE id = ? OR log_date = ? OR (? IS NOT NULL AND log_date = ?)`,
          [entityId, entityId.slice(0, 10), cDate, cDate],
        );
      } else {
        existingRows = this.queryAll(
          `SELECT id, updated_at FROM ${table} WHERE id = ?`,
          [entityId],
        );
      }

      const hasNewerLocalRow = existingRows.some(
        (row) =>
          row.updated_at &&
          compareIsoTimestamps(String(row.updated_at), incomingTs) > 0,
      );
      if (hasNewerLocalRow) {
        continue;
      }

      if (isDeleteOp) {
        const delTs = String(payload.deleted_at ?? incomingTs);
        syncedSet.delete(`${table}:${entityId}`);
        for (const oldRow of existingRows) {
          if (oldRow.id) {
            syncedSet.delete(`${table}:${String(oldRow.id)}`);
          }
          if (oldRow.log_date) {
            syncedSet.delete(`${table}:${String(oldRow.log_date)}`);
          }
        }
        if (table === 'routine_logs') {
          this.db.run(
            `UPDATE routine_logs SET deleted_at = ?, updated_at = ?
             WHERE id = ? OR (? IS NOT NULL AND ? IS NOT NULL AND routine_item_id = ? AND log_date = ?)`,
            [delTs, delTs, entityId, rItemId, rLogDate, rItemId, rLogDate],
          );
        } else if (table === 'daily_checkins') {
          if (cDate) {
            syncedSet.delete(`daily_checkins:${cDate}`);
          }
          this.db.run(
            `UPDATE daily_checkins SET deleted_at = ?, updated_at = ?
             WHERE id = ? OR log_date = ? OR (? IS NOT NULL AND log_date = ?)`,
            [delTs, delTs, entityId, entityId.slice(0, 10), cDate, cDate],
          );
        } else {
          this.db.run(
            `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
            [delTs, delTs, entityId],
          );
        }
        appliedCount += 1;
        continue;
      }

      syncedSet.add(`${table}:${entityId}`);

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
          const rawProjectId = payload.project_id ? String(payload.project_id) : null;
          const safeProjectId =
            rawProjectId && this.queryOne(`SELECT id FROM projects WHERE id = ?`, [rawProjectId])
              ? rawProjectId
              : null;
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
              safeProjectId,
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
          const rawTaskId = payload.task_id ? String(payload.task_id) : null;
          const safeTaskId =
            rawTaskId && this.queryOne(`SELECT id FROM tasks WHERE id = ?`, [rawTaskId])
              ? rawTaskId
              : null;
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
              safeTaskId,
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
          if (!routineId || !this.queryOne(`SELECT id FROM routines WHERE id = ?`, [routineId])) {
            break;
          }
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
          const routineItemId = String(payload.routine_item_id ?? '').trim();
          const logDate = String(payload.log_date ?? '').trim().slice(0, 10);
          if (
            !routineItemId ||
            !logDate ||
            !this.queryOne(`SELECT id FROM routine_items WHERE id = ?`, [routineItemId])
          ) {
            break;
          }

          // Clean up superseded local natural-key IDs and remap any outbox references
          for (const oldRow of existingRows) {
            const oldId = String(oldRow.id ?? '');
            if (oldId && oldId !== entityId) {
              syncedSet.delete(`routine_logs:${oldId}`);
              const outboxToRemap = this.queryAll(
                `SELECT mutation_id, payload_json FROM sync_outbox WHERE entity_table = 'routine_logs' AND entity_id = ?`,
                [oldId],
              );
              for (const ob of outboxToRemap) {
                const obPayload = parseJsonSafe<Record<string, unknown>>(ob.payload_json, {});
                obPayload.id = entityId;
                this.db.run(
                  `UPDATE sync_outbox SET entity_id = ?, payload_json = ? WHERE mutation_id = ?`,
                  [entityId, JSON.stringify(obPayload), String(ob.mutation_id)],
                );
              }
              for (const memOb of unpushedOutbox) {
                if (memOb.entity_table === 'routine_logs' && memOb.entity_id === oldId) {
                  memOb.entity_id = entityId;
                  memOb.payload.id = entityId;
                }
              }
            }
          }

          // Remove any stale duplicate row if both id = entityId and a distinct (routine_item_id, log_date) row coexist
          const conflictingIdRow = this.queryOne(
            `SELECT routine_item_id, log_date FROM routine_logs WHERE id = ?`,
            [entityId],
          );
          if (
            conflictingIdRow &&
            (String(conflictingIdRow.routine_item_id) !== routineItemId ||
              String(conflictingIdRow.log_date) !== logDate)
          ) {
            this.db.run(`DELETE FROM routine_logs WHERE id = ?`, [entityId]);
          }

          this.db.run(
            `INSERT INTO routine_logs (
              id, routine_item_id, log_date, status, numeric_value, completed_at, notes, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(routine_item_id, log_date) DO UPDATE SET
              id = excluded.id,
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
          const logDate =
            cDate ??
            String(payload.checkin_date ?? payload.log_date ?? entityId)
              .trim()
              .slice(0, 10);
          if (!logDate) {
            break;
          }
          for (const oldRow of existingRows) {
            const oldId = String(oldRow.id ?? '');
            if (oldId && oldId !== entityId) {
              syncedSet.delete(`daily_checkins:${oldId}`);
            }
          }
          syncedSet.add(`daily_checkins:${logDate}`);

          // Clear any stale duplicate row if id = entityId existed on a different log_date
          this.db.run(`DELETE FROM daily_checkins WHERE id = ? AND log_date != ?`, [
            entityId,
            logDate,
          ]);

          const safeEnergy =
            payload.energy_score !== null && payload.energy_score !== undefined
              ? clampPulseScore(Number(payload.energy_score))
              : null;
          const safeMood =
            payload.mood_score !== null && payload.mood_score !== undefined
              ? clampPulseScore(Number(payload.mood_score))
              : null;
          const safeSleep =
            payload.sleep_hours !== null && payload.sleep_hours !== undefined
              ? clampSleepHours(Number(payload.sleep_hours))
              : null;
          this.db.run(
            `INSERT INTO daily_checkins (
              log_date, id, day_profile_used, energy_score, mood_score, sleep_hours,
              highlight, reflection_md, weekly_review_json, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(log_date) DO UPDATE SET
              id = excluded.id,
              day_profile_used = excluded.day_profile_used,
              energy_score = excluded.energy_score,
              mood_score = excluded.mood_score,
              sleep_hours = excluded.sleep_hours,
              highlight = excluded.highlight,
              reflection_md = excluded.reflection_md,
              weekly_review_json = COALESCE(excluded.weekly_review_json, daily_checkins.weekly_review_json),
              updated_at = excluded.updated_at,
              deleted_at = NULL`,
            [
              logDate,
              entityId,
              String(payload.day_profile_used ?? 'workday'),
              safeEnergy,
              safeMood,
              safeSleep,
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
          const safeTriggerCtx = normalizePhraseTriggerContext(
            payload.trigger_context ? String(payload.trigger_context) : 'any',
          );
          const safeAnimHint = normalizePhraseAnimationHint(
            payload.animation_hint ? String(payload.animation_hint) : null,
          );
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
              safeTriggerCtx,
              safeAnimHint,
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

    this.writeSyncedEntitiesSet(syncedSet);

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
