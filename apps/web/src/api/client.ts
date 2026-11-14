export interface HealthResponse {
  status: string;
  db_online: boolean;
  redis_online?: boolean;
  hermes_gateway: 'online' | 'offline_mock';
  version?: string;
}

export interface ApiTokenSummary {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
}

export interface CreatedPatResponse {
  id: string;
  name: string;
  token: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
}

export interface PairingQrResponse {
  primary_url: string;
  fallback_url?: string | null;
  token: string;
  token_id?: string;
  token_name: string;
  qr_payload_json: string;
  created_at?: string;
}

export interface TimeSessionRecord {
  id: string;
  task_id?: string | null;
  course_id?: string | null;
  lesson_id?: string | null;
  category?: string;
  timer_mode?: string;
  mode?: string;
  work_minutes?: number | null;
  break_minutes?: number | null;
  started_at?: string;
  ended_at?: string | null;
  duration_seconds?: number;
  notes?: string | null;
}

export interface ActiveTimerStatus {
  running: boolean;
  active?: boolean;
  session: TimeSessionRecord | null;
  elapsed_seconds: number;
  task_title?: string | null;
}

export interface QuickCaptureParsed {
  clean_title: string;
  title?: string;
  tags: string[];
  energy_level: string | null;
  priority: string | null;
  scheduled_date: string | null;
  due_at: string | null;
  estimated_minutes: number | null;
  estimate_minutes?: number | null;
  status?: string;
  project_hint?: string | null;
}

export interface TaskRecord {
  id: string;
  title: string;
  description_md?: string | null;
  status: string;
  priority: string;
  energy_level?: string | null;
  project_id?: string | null;
  goal_id?: string | null;
  scheduled_date?: string | null;
  due_date?: string | null;
  due_at?: string | null;
  estimated_minutes?: number | null;
  actual_seconds?: number;
  tags?: string[];
  created_at?: string;
}

export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardWidgetRecord {
  id: string;
  dashboard_id: string;
  title: string;
  source_kind: 'builtin' | 'command' | 'http' | 'sql' | 'hermes';
  renderer_kind: 'kpi' | 'sparkline' | 'waffle' | 'bar' | 'table' | 'terminal' | 'custom_module';
  grid_rect?: GridRect;
  grid_x?: number;
  grid_y?: number;
  grid_w?: number;
  grid_h?: number;
  source_config?: Record<string, any>;
  refresh_interval_seconds?: number;
  cached_payload?: any;
  last_refreshed_at?: string | null;
  sort_order?: number;
}

export interface DashboardDeckRecord {
  id: string;
  slug: string;
  title: string;
  cycle_seconds: number;
  in_rotation: boolean;
  sort_order: number;
  layout_cols: number;
  layout_rows: number;
  widgets?: DashboardWidgetRecord[];
}

export interface LifeScoreResponse {
  composite_score: number;
  score?: number;
  pillars: {
    focus: number;
    routines: number;
    goals: number;
    learning: number;
    wealth: number;
  };
  computed_at?: string;
}

export interface ServerNodeRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  check_type: 'tcp' | 'http';
  http_url?: string | null;
  status: 'online' | 'degraded' | 'offline' | 'unknown';
  last_latency_ms?: number | null;
  last_message?: string | null;
  latency_history_ms?: number[];
  last_checked_at?: string | null;
  tags?: string[];
}

export interface ServerSummaryResponse {
  total: number;
  online: number;
  degraded: number;
  offline: number;
  unknown: number;
  avg_latency_ms?: number | null;
}

export interface CompanionNudgeRecord {
  id: string;
  category?: string;
  title: string;
  message: string;
  route?: string;
  entity_id?: string | null;
}

export interface PendingApprovalRecord {
  id: string;
  session_key?: string | null;
  tool_name: string;
  payload_json: any;
  status: 'pending' | 'approved' | 'rejected';
  created_at?: string;
}

export interface McpUndoRecord {
  id: string;
  undo_id?: string;
  session_key?: string | null;
  tool_name: string;
  entity_table?: string | null;
  entity_id?: string | null;
  undo_kind?: string;
  undo_payload?: any;
  undone_at?: string | null;
  expires_at?: string | null;
  created_at?: string;
  reverted?: boolean;
}

export interface TimeStatsRecord {
  today_seconds: number;
  week_seconds?: number;
  deep_work_week_seconds?: number;
  learning_week_seconds?: number;
  hourly_buckets_24h?: number[];
  barcode_buckets_96?: number[];
  focus_capacity_minutes?: number;
  planned_today_minutes?: number;
  actual_today_minutes?: number;
}

export interface RoutineStreakRecord {
  routine_item_id: string;
  title: string;
  current_streak: number;
  longest_streak?: number;
  completion_rate_30d_pct?: number;
}

export interface RoutineHeatmapDayRecord {
  date: string;
  completed_count: number;
  total_count: number;
  completion_ratio: number;
}

export interface RoutineAnalyticsRecord {
  streaks?: RoutineStreakRecord[];
  matrix_8x12?: boolean[];
  consistency_score_pct?: number;
  heatmap_365d?: RoutineHeatmapDayRecord[];
  routine_adherence?: Array<{
    routine_id: string;
    routine_name: string;
    adherence_pct: number;
  }>;
}

export interface AllocationRecord {
  base_currency?: 'BRL' | 'USD' | string;
  total_brl_cents?: number;
  total_usd_cents?: number;
  fx_usd_brl?: number | string;
  waffle_tiles?: Array<{
    tile_index: number;
    symbol: string;
    asset_class?: string;
  }>;
  recommendations?: Array<{
    asset_id?: string;
    symbol: string;
    current_weight_pct?: number | string;
    target_weight_pct?: number | string;
  }>;
}

export interface FireProjectionRecord {
  current_net_worth_brl_cents?: number;
  fi_target_brl_cents?: number;
  fire_number_cents?: number;
  years_to_fi?: number;
  months_to_fi?: number;
  progress_pct?: number;
  fi_progress_pct?: number;
  passive_income_coverage_pct?: number;
  unreachable?: boolean;
}

export interface MonthlyPlanRecord {
  month: string;
  currency?: 'BRL' | 'USD' | string;
  salary_income_cents?: number;
  planned_spend_cents?: number;
  actual_spend_cents?: number | null;
  planned_investment_cents?: number;
  actual_invested_cents?: number;
  investable_surplus_cents?: number;
  savings_rate_pct?: number;
}

export interface GoalRecord {
  id: string;
  year?: number;
  pillar?: string;
  code?: string;
  title: string;
  status?: string;
  progress_pct?: number | string;
}

export interface CourseRecord {
  id: string;
  title: string;
  provider?: string;
  status?: string;
  total_items?: number;
  completed_items?: number;
  total_lessons?: number;
  completed_lessons?: number;
  progress_pct?: number | string;
}

export interface AgentRecord {
  id: string;
  slug?: string;
  name: string;
  knight_archetype?: 'paladin' | 'vanguard' | 'lore_warden' | 'inquisitor' | 'artificer' | string;
  crest_color?: string;
  enabled?: boolean;
  hp_pct?: number;
  ep_pct?: number;
  is_paused?: boolean;
}

export interface VaultNoteRecord {
  path: string;
  title: string;
  folder?: string;
  updated_at?: string | null;
}

export function formatBrlCents(cents: unknown): string {
  const raw = Number(cents ?? 0);
  const safeCents = Number.isFinite(raw) ? Math.round(raw) : 0;
  const sign = safeCents < 0 ? '-' : '';
  const abs = Math.abs(safeCents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const wholeFormatted = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}R$ ${wholeFormatted},${frac}`;
}

export function formatUsdCents(cents: unknown): string {
  const raw = Number(cents ?? 0);
  const safeCents = Number.isFinite(raw) ? Math.round(raw) : 0;
  const sign = safeCents < 0 ? '-' : '';
  const abs = Math.abs(safeCents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const wholeFormatted = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$ ${wholeFormatted}.${frac}`;
}

export function formatFireDuration(fire: FireProjectionRecord | null | undefined): string {
  if (!fire) return '0Y 0M';
  const monthsRaw = Number(fire.months_to_fi);
  if (Number.isFinite(monthsRaw) && monthsRaw > 0) {
    const totalMonths = Math.round(monthsRaw);
    const years = Math.floor(totalMonths / 12);
    const remMonths = totalMonths % 12;
    return `${years}Y ${remMonths}M`;
  }
  const yearsRaw = Number(fire.years_to_fi);
  if (Number.isFinite(yearsRaw) && yearsRaw > 0) {
    const totalMonths = Math.round(yearsRaw * 12);
    const years = Math.floor(totalMonths / 12);
    const remMonths = totalMonths % 12;
    return `${years}Y ${remMonths}M`;
  }
  return '0Y 0M';
}

export interface HermesMessageRecord {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  created_at?: string;
}

export interface HermesSessionRecord {
  id?: string;
  session_key: string;
  title?: string;
  origin?: string;
  high_level_mode?: boolean;
  page_context?: Record<string, any> | null;
  messages?: HermesMessageRecord[];
  messages_json?: HermesMessageRecord[];
  updated_at?: string;
}

export class ApiError extends Error {
  status: number;
  body: any;

  constructor(message: string, status: number, body?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function unwrapList<T = any>(payload: any, candidateKeys: string[] = []): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== 'object') return [];
  for (const key of [...candidateKeys, 'data', 'items', 'results', 'rows']) {
    if (Array.isArray(payload[key])) {
      return payload[key] as T[];
    }
  }
  if (payload.data && typeof payload.data === 'object') {
    for (const key of candidateKeys) {
      if (Array.isArray(payload.data[key])) {
        return payload.data[key] as T[];
      }
    }
  }
  return [];
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (typeof globalThis.fetch !== 'function') {
    throw new ApiError('Fetch unavailable', 503);
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...((init?.headers as Record<string, string>) || {}),
  };
  const response = await globalThis.fetch(path, {
    ...init,
    headers,
  });
  const text = await response.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    const errMsg =
      (parsed && typeof parsed === 'object' && (parsed.error || parsed.message || parsed.detail)) ||
      `HTTP ${response.status}`;
    throw new ApiError(String(errMsg), response.status, parsed);
  }
  return parsed as T;
}

export function apiGet<T = any>(path: string, headers?: Record<string, string>): Promise<T> {
  return requestJson<T>(path, { method: 'GET', headers });
}

export function apiPost<T = any>(
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : JSON.stringify({}),
    headers,
  });
}

export function apiPut<T = any>(
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  return requestJson<T>(path, {
    method: 'PUT',
    body: body !== undefined ? JSON.stringify(body) : JSON.stringify({}),
    headers,
  });
}

export function apiPatch<T = any>(
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  return requestJson<T>(path, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : JSON.stringify({}),
    headers,
  });
}

export function apiDelete<T = any>(path: string, headers?: Record<string, string>): Promise<T> {
  return requestJson<T>(path, { method: 'DELETE', headers });
}

export function normalizeTaskEnergyLevel(
  raw: string | null | undefined,
): 'deep' | 'shallow' | 'quick' | null {
  if (!raw) return null;
  const e = String(raw).trim().toLowerCase().replace(/^@/, '');
  if (!e) return null;
  if (e.startsWith('deep')) return 'deep';
  if (e === 'shallow' || e.startsWith('low') || e === 'light') return 'shallow';
  if (e.startsWith('quick') || e === 'fast' || e === 'admin') return 'quick';
  return null;
}

export function toRfc3339DueDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T23:59:59Z`;
  }
  return trimmed;
}

function addDaysIsoDate(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Deterministic client-side fallback parser mirroring backend quick-capture NLP grammar */
export function parseQuickCaptureFallback(rawInput: string): QuickCaptureParsed {
  const tags: string[] = [];
  let energy_level: 'deep' | 'shallow' | 'quick' | null = null;
  let priority: 'urgent' | 'high' | 'medium' | 'low' | null = null;
  let scheduled_date: string | null = null;
  let estimated_minutes: number | null = null;
  let project_hint: string | null = null;

  let workingInput = rawInput.trim();

  // Extract multi-word relative date phrases before tokenizing
  workingInput = workingInput.replace(
    /\bin\s+(\d+)\s+days?\b[,;.]*/gi,
    (_match, daysStr: string) => {
      const days = Number.parseInt(daysStr, 10);
      if (Number.isFinite(days) && days >= 0) {
        scheduled_date = addDaysIsoDate(days);
      }
      return ' ';
    },
  );

  workingInput = workingInput.replace(/\bnext\s+week\b[,;.]*/gi, () => {
    scheduled_date = addDaysIsoDate(7);
    return ' ';
  });

  const tokens = workingInput.trim().split(/\s+/).filter(Boolean);
  const titleWords: string[] = [];

  for (const rawTok of tokens) {
    const stripped = rawTok.replace(/[,;.]+$/, '');
    if (!stripped) {
      titleWords.push(rawTok);
      continue;
    }
    const lower = stripped.toLowerCase();

    if (stripped.startsWith('#') && stripped.length > 1) {
      const tag = lower.slice(1);
      if (tag && !tags.includes(tag)) {
        tags.push(tag);
      }
      if (tag && !project_hint) project_hint = tag;
    } else if (stripped.startsWith('+') && stripped.length > 1) {
      project_hint = lower.slice(1);
    } else if (stripped.startsWith('@') && stripped.length > 1) {
      const e = lower.slice(1);
      if (e.startsWith('deep')) {
        energy_level = 'deep';
      } else if (e === 'shallow' || e.startsWith('low')) {
        energy_level = 'shallow';
      } else if (e.startsWith('quick') || e === 'fast') {
        energy_level = 'quick';
      } else {
        // Unrecognized @mention (e.g. @alice) belongs in clean_title
        titleWords.push(rawTok);
      }
    } else if (stripped.startsWith('!') && stripped.length > 1) {
      const p = lower.slice(1);
      if (p === 'p0' || p === 'p1' || p === 'urgent' || p === 'critical') {
        priority = 'urgent';
      } else if (p === 'p2' || p === 'high' || p === 'important') {
        priority = 'high';
      } else if (p === 'p3' || p.startsWith('med') || p === 'normal') {
        priority = 'medium';
      } else if (p === 'p4' || p === 'low') {
        priority = 'low';
      } else {
        titleWords.push(rawTok);
      }
    } else if (lower === 'today' || lower === 'tod' || lower === 'due:today') {
      scheduled_date = addDaysIsoDate(0);
    } else if (
      lower === 'tomorrow' ||
      lower === 'tmrw' ||
      lower === 'tom' ||
      lower === 'due:tomorrow'
    ) {
      scheduled_date = addDaysIsoDate(1);
    } else if (/^(?:due:)?(\d{4}-\d{2}-\d{2})$/i.test(stripped)) {
      const iso = lower.replace(/^due:/, '');
      const parsedMs = Date.parse(`${iso}T00:00:00Z`);
      if (!Number.isNaN(parsedMs)) {
        scheduled_date = iso;
      } else {
        titleWords.push(rawTok);
      }
    } else if (/^~?(\d+)h(\d+)(?:m|min|mins)?$/i.test(stripped)) {
      const m = stripped.match(/^~?(\d+)h(\d+)(?:m|min|mins)?$/i);
      if (m) {
        estimated_minutes = Number.parseInt(m[1]!, 10) * 60 + Number.parseInt(m[2]!, 10);
      }
    } else if (/^~?(\d+)(?:m|min|mins)$/i.test(stripped)) {
      const m = stripped.match(/^~?(\d+)(?:m|min|mins)$/i);
      if (m) {
        estimated_minutes = Number.parseInt(m[1]!, 10);
      }
    } else if (/^~?(\d+(?:\.\d+)?)(?:h|hr|hrs)$/i.test(stripped)) {
      const m = stripped.match(/^~?(\d+(?:\.\d+)?)(?:h|hr|hrs)$/i);
      if (m) {
        estimated_minutes = Math.round(Number.parseFloat(m[1]!) * 60);
      }
    } else {
      titleWords.push(rawTok);
    }
  }

  const clean_title = titleWords.join(' ').trim() || rawInput.trim();
  const due_at = scheduled_date ? `${scheduled_date}T23:59:59Z` : null;
  return {
    clean_title,
    title: clean_title,
    tags,
    energy_level,
    priority,
    scheduled_date,
    due_at,
    estimated_minutes,
    estimate_minutes: estimated_minutes,
    status: scheduled_date ? 'todo' : 'inbox',
    project_hint,
  };
}

export interface StreamChatCallbacks {
  onThinking?: (thinkingText: string) => void;
  onToken?: (delta: string) => void;
  onToolCall?: (toolName: string, payload?: any) => void;
  onUndoAvailable?: (undo: { undoId: string; toolName: string; summary: string }) => void;
  onApprovalRequired?: (approval: { id: string; toolName: string; summary?: string; payloadJson: any }) => void;
  onDone?: (fullText: string) => void;
}

export async function streamHermesChat(
  params: {
    sessionKey: string;
    message: string;
    origin?: 'frieren_popover' | 'hermes_view' | 'knight_run';
    highLevelMode?: boolean;
    pageContext?: {
      active_route: string;
      active_dashboard_id?: string | null;
      selected_entity_id?: string | null;
    };
  },
  callbacks: StreamChatCallbacks = {},
): Promise<string> {
  if (typeof globalThis.fetch !== 'function') {
    const fallback = `[OFFLINE_MOCK] Tactical acknowledgement for: ${params.message}`;
    callbacks.onToken?.(fallback);
    callbacks.onDone?.(fallback);
    return fallback;
  }

  const response = await globalThis.fetch('/api/hermes/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hermes-Session-Key': params.sessionKey,
    },
    body: JSON.stringify({
      session_key: params.sessionKey,
      message: params.message,
      origin: params.origin ?? 'frieren_popover',
      high_level_mode: params.highLevelMode ?? false,
      page_context: params.pageContext,
    }),
  });

  if (!response.ok) {
    throw new ApiError(`Chat stream failed (${response.status})`, response.status);
  }

  let accumulated = '';
  let currentEvent = 'message';
  let fullRawCapture = '';

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') {
      currentEvent = 'message';
      return;
    }
    if (line.startsWith(':')) {
      return;
    }
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim() || 'message';
      return;
    }
    if (!line.startsWith('data:')) {
      return;
    }

    const afterColon = line.slice(5);
    const dataPayload = afterColon.startsWith(' ') ? afterColon.slice(1) : afterColon;
    const trimmed = dataPayload.trim();
    if (!trimmed || trimmed === '[DONE]') return;

    let parsed: any = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = { token: dataPayload };
    }

    const evType = String(parsed?.type || currentEvent || 'message').toLowerCase();

    if (evType === 'thinking') {
      callbacks.onThinking?.(
        String(parsed?.thinking ?? parsed?.delta ?? parsed?.content ?? parsed?.text ?? ''),
      );
    } else if (evType === 'tool_call') {
      callbacks.onToolCall?.(String(parsed?.tool_name ?? parsed?.name ?? 'mcp_tool'), parsed);
    } else if (evType === 'undo_available') {
      callbacks.onUndoAvailable?.({
        undoId: String(parsed?.undo_id ?? parsed?.id ?? ''),
        toolName: String(parsed?.tool_name ?? 'mcp_action'),
        summary: String(
          parsed?.summary ??
            (parsed?.entity_table ? `${parsed.entity_table} modified` : 'Action executed (reversible)'),
        ),
      });
    } else if (evType === 'approval_required') {
      callbacks.onApprovalRequired?.({
        id: String(parsed?.approval_id ?? parsed?.id ?? ''),
        toolName: String(parsed?.tool_name ?? 'mcp_tool'),
        summary: String(parsed?.summary ?? 'Requires operator approval'),
        payloadJson: parsed?.payload_json ?? parsed?.arguments ?? {},
      });
    } else if (evType === 'done') {
      const doneMessage = parsed?.message ?? parsed?.response ?? parsed?.content;
      if (!accumulated && typeof doneMessage === 'string' && doneMessage.length > 0) {
        accumulated = doneMessage;
        callbacks.onToken?.(doneMessage);
      }
    } else if (
      evType === 'token' ||
      evType === 'message' ||
      typeof parsed?.delta === 'string' ||
      typeof parsed?.token === 'string' ||
      typeof parsed?.content === 'string'
    ) {
      if (typeof parsed?.delta === 'string' || typeof parsed?.token === 'string') {
        const delta = typeof parsed.delta === 'string' ? parsed.delta : String(parsed.token);
        if (delta.length > 0) {
          accumulated += delta;
          callbacks.onToken?.(delta);
        }
      } else if (typeof parsed?.content === 'string') {
        const delta = parsed.content.startsWith(accumulated)
          ? parsed.content.slice(accumulated.length)
          : parsed.content;
        if (delta.length > 0) {
          accumulated += delta;
          callbacks.onToken?.(delta);
        }
      }
    }
  };

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let lineBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      fullRawCapture += chunk;
      lineBuffer += chunk;
      let newlineIdx = lineBuffer.indexOf('\n');
      while (newlineIdx !== -1) {
        const line = lineBuffer.slice(0, newlineIdx);
        lineBuffer = lineBuffer.slice(newlineIdx + 1);
        processLine(line);
        newlineIdx = lineBuffer.indexOf('\n');
      }
    }

    const tail = decoder.decode();
    if (tail) {
      fullRawCapture += tail;
      lineBuffer += tail;
    }
    if (lineBuffer.length > 0) {
      processLine(lineBuffer);
      lineBuffer = '';
    }
  } else {
    const rawText = await response.text();
    fullRawCapture = rawText;
    for (const line of rawText.split('\n')) {
      processLine(line);
    }
  }

  if (!accumulated && fullRawCapture.trim().startsWith('{')) {
    try {
      const json = JSON.parse(fullRawCapture);
      accumulated = String(json.message ?? json.response ?? json.content ?? '');
    } catch {
      // Ignore non-JSON body
    }
  }

  if (!accumulated) {
    accumulated = `[HERMES // READY] Processed "${params.message}" on ${params.pageContext?.active_route ?? '/dashboard'}.`;
  }

  callbacks.onDone?.(accumulated);
  return accumulated;
}
