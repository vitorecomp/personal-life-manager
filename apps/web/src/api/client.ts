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
  entity_table?: string;
  entity_id?: string;
  reverted?: boolean;
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

export function apiDelete<T = any>(path: string, headers?: Record<string, string>): Promise<T> {
  return requestJson<T>(path, { method: 'DELETE', headers });
}

/** Deterministic client-side fallback parser mirroring backend quick-capture NLP grammar */
export function parseQuickCaptureFallback(rawInput: string): QuickCaptureParsed {
  const tags: string[] = [];
  let energy_level: string | null = null;
  let priority: string | null = null;
  let scheduled_date: string | null = null;
  let estimated_minutes: number | null = null;
  let project_hint: string | null = null;

  const tokens = rawInput.trim().split(/\s+/).filter(Boolean);
  const titleWords: string[] = [];

  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (tok.startsWith('#') && tok.length > 1) {
      const tag = lower.slice(1);
      tags.push(tag);
      if (!project_hint) project_hint = tag;
    } else if (tok.startsWith('+') && tok.length > 1) {
      project_hint = lower.slice(1);
    } else if (tok.startsWith('@') && tok.length > 1) {
      const e = lower.slice(1);
      if (e.includes('deep')) energy_level = 'deep_focus';
      else if (e.includes('shallow') || e.includes('low') || e.includes('light'))
        energy_level = 'light';
      else energy_level = 'admin';
    } else if (tok.startsWith('!') && tok.length > 1) {
      const p = lower.slice(1);
      if (p === 'p1' || p === 'urgent' || p === 'critical') priority = 'critical';
      else if (p === 'p2' || p === 'high' || p === 'important') priority = 'high';
      else if (p === 'p3' || p === 'medium' || p === 'med' || p === 'normal') priority = 'medium';
      else if (p === 'p4' || p === 'low') priority = 'low';
    } else if (lower === 'today' || lower === 'tod' || lower === 'due:today') {
      scheduled_date = new Date().toISOString().slice(0, 10);
    } else if (lower === 'tomorrow' || lower === 'tmrw' || lower === 'tom' || lower === 'due:tomorrow') {
      const d = new Date(Date.now() + 86_400_000);
      scheduled_date = d.toISOString().slice(0, 10);
    } else if (/^~?\d+m$/i.test(tok)) {
      estimated_minutes = Number.parseInt(tok.replace(/[^0-9]/g, ''), 10);
    } else if (/^~?\d+(?:\.\d+)?h$/i.test(tok)) {
      estimated_minutes = Math.round(Number.parseFloat(tok.replace(/[^0-9.]/g, '')) * 60);
    } else {
      titleWords.push(tok);
    }
  }

  const clean_title = titleWords.join(' ').trim() || rawInput.trim();
  return {
    clean_title,
    title: clean_title,
    tags,
    energy_level,
    priority,
    scheduled_date,
    due_at: scheduled_date,
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

  const rawText = await response.text();
  let accumulated = '';
  let currentEvent = 'message';

  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      const dataStr = line.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;
      let parsed: any = null;
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        parsed = { token: dataStr };
      }
      const evType = parsed?.type || currentEvent;
      if (evType === 'thinking') {
        callbacks.onThinking?.(String(parsed.thinking || parsed.content || parsed.text || ''));
      } else if (evType === 'tool_call') {
        callbacks.onToolCall?.(String(parsed.tool_name || parsed.name || 'mcp_tool'), parsed);
      } else if (evType === 'undo_available') {
        callbacks.onUndoAvailable?.({
          undoId: String(parsed.undo_id || parsed.id || ''),
          toolName: String(parsed.tool_name || 'mcp_action'),
          summary: String(parsed.summary || 'Action executed (reversible)'),
        });
      } else if (evType === 'approval_required') {
        callbacks.onApprovalRequired?.({
          id: String(parsed.approval_id || parsed.id || ''),
          toolName: String(parsed.tool_name || 'mcp_tool'),
          summary: String(parsed.summary || 'Requires operator approval'),
          payloadJson: parsed.payload_json ?? parsed.arguments ?? {},
        });
      } else if (evType === 'token' || evType === 'message' || parsed?.token || parsed?.delta || parsed?.content) {
        const piece = String(parsed.token ?? parsed.delta ?? parsed.content ?? '');
        if (piece && !accumulated.endsWith(piece)) {
          accumulated += piece;
          callbacks.onToken?.(piece);
        }
      } else if (evType === 'done') {
        if (!accumulated && parsed?.response) {
          accumulated = String(parsed.response);
        }
      }
    }
  }

  if (!accumulated && rawText.trim().startsWith('{')) {
    try {
      const json = JSON.parse(rawText);
      accumulated = String(json.response || json.content || json.message || '');
    } catch {
      // Ignore
    }
  }

  if (!accumulated) {
    accumulated = `[HERMES // READY] Processed "${params.message}" on ${params.pageContext?.active_route ?? '/dashboard'}.`;
  }

  callbacks.onDone?.(accumulated);
  return accumulated;
}
