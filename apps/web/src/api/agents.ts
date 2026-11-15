/**
 * Typed REST client bindings for Module 05 — Agent Studio Isometric Knight Arena (`/agents`):
 * - `/api/agents` CRUD + zone deployment + `/mcp` skill policies (`tools_policy`)
 * - `/api/agents/{id}/triggers` cron & Rust domain event hooks
 * - `/api/agents/{id}/dispatch` live execution & Dry-Run Sandbox (`dry_run: true`)
 * - `/api/agents/queue` Tokio turn-order timeline
 * - `/api/agent-runs` & `/api/agent-runs/{run_id}` Battle Logs & step trace inspector
 *
 * Uses `./client` (`apiGet`, `apiPost`, `apiPut`, `apiDelete`, `unwrapList`) so Vitest spies on
 * `globalThis.fetch(url, init)` work identically to production.
 */
import type {
  AgentRun,
  AgentRunStatus,
  AgentTrigger,
  AgentTriggerType,
  AgentWithTelemetry,
  ArenaZone,
  KnightArchetype,
  KnightGridPos,
  SkillPolicyMode,
  TurnOrderQueueItem,
} from '@hermes/api-client';
import { apiDelete, apiGet, apiPost, apiPut, unwrapList } from './client';

export type {
  AgentRun,
  AgentRunStatus,
  AgentTrigger,
  AgentTriggerType,
  AgentWithTelemetry,
  ArenaZone,
  KnightArchetype,
  KnightGridPos,
  SkillPolicyMode,
  TurnOrderQueueItem,
};

export type DomainEventName =
  | 'YoutubeCrawlerSynced'
  | 'PortfolioPriceAlert'
  | 'GoalPaceAtRisk';

export const CANONICAL_ARCHETYPES: readonly KnightArchetype[] = [
  'paladin',
  'vanguard',
  'lore_warden',
  'inquisitor',
  'artificer',
];

export const CANONICAL_ZONES: readonly ArenaZone[] = [
  'cron_watchtower',
  'event_ambush',
  'mastermind_council',
  'standby_barracks',
];

/**
 * Normalizes any raw archetype string (including capitalized or alias strings like
 * `'Ranger'` -> `'vanguard'`, `'Scholar'` -> `'lore_warden'`, `'Lore-Warden'` -> `'lore_warden'`)
 * into a strict lowercase Rust `KnightArchetype` enum variant.
 */
export function normalizeKnightArchetype(raw: unknown): KnightArchetype {
  const cleaned = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  if (cleaned === 'ranger') return 'vanguard';
  if (cleaned === 'scholar' || cleaned === 'lorewarden') return 'lore_warden';
  if ((CANONICAL_ARCHETYPES as readonly string[]).includes(cleaned)) {
    return cleaned as KnightArchetype;
  }
  return 'paladin';
}

/**
 * Normalizes any raw zone identifier or legacy alias into a strict Rust `ArenaZone` variant.
 */
export function normalizeArenaZone(raw: unknown): ArenaZone {
  const cleaned = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  if (
    cleaned === 'cron_watchtower' ||
    cleaned === 'watchtower' ||
    cleaned === 'frontline'
  ) {
    return 'cron_watchtower';
  }
  if (
    cleaned === 'event_ambush' ||
    cleaned === 'ambush' ||
    cleaned === 'scriptorium'
  ) {
    return 'event_ambush';
  }
  if (
    cleaned === 'mastermind_council' ||
    cleaned === 'council' ||
    cleaned === 'command_citadel' ||
    cleaned === 'citadel'
  ) {
    return 'mastermind_council';
  }
  if (
    cleaned === 'standby_barracks' ||
    cleaned === 'barracks' ||
    cleaned === 'standby'
  ) {
    return 'standby_barracks';
  }
  return 'cron_watchtower';
}

/**
 * Normalizes a skill slot policy mode (`READ`, `APPROVE` / `REQUIRE_APPROVAL`, `AUTO` / `IMMEDIATE_UNDO`, or `NONE`).
 */
export type UiSkillPolicyMode = SkillPolicyMode | 'NONE';

export function normalizeSkillPolicyMode(raw: unknown): UiSkillPolicyMode {
  const upper = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (upper === 'READ') return 'READ';
  if (upper === 'APPROVE' || upper === 'REQUIRE_APPROVAL') return 'APPROVE';
  if (upper === 'AUTO' || upper === 'IMMEDIATE_UNDO') return 'AUTO';
  return 'NONE';
}

function withQuery(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

function unwrapAgent(raw: any): AgentWithTelemetry {
  const obj = raw && typeof raw === 'object' && raw.agent && !raw.id ? raw.agent : raw?.data && !raw.id ? raw.data : raw;
  return obj as AgentWithTelemetry;
}

export async function listAgents(): Promise<AgentWithTelemetry[]> {
  const res = await apiGet<unknown>('/api/agents');
  return unwrapList<AgentWithTelemetry>(res, ['agents']).filter(
    (a) => a && typeof a === 'object' && typeof a.name === 'string',
  );
}

export async function getAgent(idOrSlug: string): Promise<AgentWithTelemetry> {
  const res = await apiGet<unknown>(`/api/agents/${encodeURIComponent(idOrSlug)}`);
  return unwrapAgent(res);
}

export interface CreateAgentPayload {
  slug?: string;
  name: string;
  knight_archetype: KnightArchetype | string;
  crest_color?: string;
  sprite_sheet_id?: string;
  zone?: ArenaZone;
  grid_pos?: { x: number; y: number; zone?: ArenaZone };
  hermes_profile?: string | null;
  system_prompt: string;
  model_config?: Record<string, unknown>;
  tools_policy?: Record<string, SkillPolicyMode>;
  monthly_budget_cents?: number;
  is_mastermind_member?: boolean;
  enabled?: boolean;
  is_paused?: boolean;
}

/**
 * Creates a new Knight via `POST /api/agents`.
 * Enforces W1: always sends BOTH top-level `zone` and `grid_pos: { x, y, zone }`,
 * and sends lowercase `knight_archetype`.
 */
export async function createAgent(body: CreateAgentPayload): Promise<AgentWithTelemetry> {
  const archetype = normalizeKnightArchetype(body.knight_archetype);
  const targetZone = normalizeArenaZone(body.zone ?? body.grid_pos?.zone ?? 'cron_watchtower');
  const x = Number.isFinite(body.grid_pos?.x) ? Math.max(0, Math.round(Number(body.grid_pos?.x))) : 0;
  const y = Number.isFinite(body.grid_pos?.y) ? Math.max(0, Math.round(Number(body.grid_pos?.y))) : 0;
  const isStandby = targetZone === 'standby_barracks';
  const enabled = body.enabled !== undefined ? body.enabled : !isStandby;

  const payload: Record<string, unknown> = {
    ...(body.slug ? { slug: body.slug.trim() } : {}),
    name: body.name.trim(),
    knight_archetype: archetype,
    crest_color: body.crest_color || '#F87C18',
    ...(body.sprite_sheet_id ? { sprite_sheet_id: body.sprite_sheet_id } : {}),
    zone: targetZone,
    grid_pos: { x, y, zone: targetZone },
    ...(body.hermes_profile !== undefined ? { hermes_profile: body.hermes_profile } : {}),
    system_prompt: body.system_prompt,
    ...(body.model_config ? { model_config: body.model_config } : {}),
    ...(body.tools_policy ? { tools_policy: body.tools_policy } : {}),
    monthly_budget_cents:
      body.monthly_budget_cents !== undefined ? Math.round(body.monthly_budget_cents) : 500,
    is_mastermind_member:
      body.is_mastermind_member !== undefined
        ? body.is_mastermind_member
        : targetZone === 'mastermind_council',
    enabled,
    is_paused: body.is_paused !== undefined ? body.is_paused : !enabled || isStandby,
  };

  const res = await apiPost<unknown>('/api/agents', payload);
  return unwrapAgent(res);
}

export interface UpdateAgentPayload {
  name?: string;
  knight_archetype?: KnightArchetype | string;
  crest_color?: string;
  sprite_sheet_id?: string;
  zone?: ArenaZone;
  grid_pos?: { x: number; y: number; zone?: ArenaZone };
  hermes_profile?: string | null;
  system_prompt?: string;
  model_config?: Record<string, unknown>;
  tools_policy?: Record<string, SkillPolicyMode>;
  monthly_budget_cents?: number;
  is_mastermind_member?: boolean;
  enabled?: boolean;
  is_paused?: boolean;
}

/**
 * Updates a Knight via `PUT /api/agents/{id}`.
 * Enforces W1 & W2: whenever `zone` or `grid_pos` is provided, sends BOTH top-level `zone`
 * and `grid_pos: { x, y, zone }`.
 */
export async function updateAgent(
  idOrSlug: string,
  patch: UpdateAgentPayload,
): Promise<AgentWithTelemetry> {
  const payload: Record<string, unknown> = {};

  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.knight_archetype !== undefined) {
    payload.knight_archetype = normalizeKnightArchetype(patch.knight_archetype);
  }
  if (patch.crest_color !== undefined) payload.crest_color = patch.crest_color;
  if (patch.sprite_sheet_id !== undefined) payload.sprite_sheet_id = patch.sprite_sheet_id;
  if (patch.hermes_profile !== undefined) payload.hermes_profile = patch.hermes_profile;
  if (patch.system_prompt !== undefined) payload.system_prompt = patch.system_prompt;
  if (patch.model_config !== undefined) payload.model_config = patch.model_config;
  if (patch.tools_policy !== undefined) payload.tools_policy = patch.tools_policy;
  if (patch.monthly_budget_cents !== undefined) {
    payload.monthly_budget_cents = Math.round(patch.monthly_budget_cents);
  }
  if (patch.is_mastermind_member !== undefined) {
    payload.is_mastermind_member = patch.is_mastermind_member;
  }

  if (patch.zone !== undefined || patch.grid_pos !== undefined) {
    const targetZone = normalizeArenaZone(patch.zone ?? patch.grid_pos?.zone ?? 'cron_watchtower');
    const x = Number.isFinite(patch.grid_pos?.x) ? Math.max(0, Math.round(Number(patch.grid_pos?.x))) : 0;
    const y = Number.isFinite(patch.grid_pos?.y) ? Math.max(0, Math.round(Number(patch.grid_pos?.y))) : 0;
    payload.zone = targetZone;
    payload.grid_pos = { x, y, zone: targetZone };
  }

  if (patch.enabled !== undefined) payload.enabled = patch.enabled;
  if (patch.is_paused !== undefined) payload.is_paused = patch.is_paused;

  const res = await apiPut<unknown>(`/api/agents/${encodeURIComponent(idOrSlug)}`, payload);
  return unwrapAgent(res);
}

export function deleteAgent(idOrSlug: string): Promise<{ id: string; deleted: boolean }> {
  return apiDelete(`/api/agents/${encodeURIComponent(idOrSlug)}`);
}

// ---------------------------------------------------------------------------
// Triggers (`/api/agents/{id}/triggers`)
// ---------------------------------------------------------------------------

export interface CreateAgentTriggerPayload {
  type: AgentTriggerType;
  config_json: {
    cron?: string;
    event?: DomainEventName | string;
    description?: string;
    webhook_secret?: string;
  };
  enabled?: boolean;
}

export async function listAgentTriggers(idOrSlug: string): Promise<AgentTrigger[]> {
  const res = await apiGet<unknown>(`/api/agents/${encodeURIComponent(idOrSlug)}/triggers`);
  return unwrapList<AgentTrigger>(res, ['triggers']);
}

export async function createAgentTrigger(
  idOrSlug: string,
  body: CreateAgentTriggerPayload,
): Promise<AgentTrigger> {
  const payload: Record<string, unknown> = {
    type: body.type,
    config_json: body.config_json,
    enabled: body.enabled ?? true,
  };
  return apiPost<AgentTrigger>(`/api/agents/${encodeURIComponent(idOrSlug)}/triggers`, payload);
}

export function deleteAgentTrigger(
  idOrSlug: string,
  triggerId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiDelete(
    `/api/agents/${encodeURIComponent(idOrSlug)}/triggers/${encodeURIComponent(triggerId)}`,
  );
}

// ---------------------------------------------------------------------------
// Turn-Order Queue, Dispatch & Battle Logs (`/api/agents/queue`, `/api/agent-runs`)
// ---------------------------------------------------------------------------

export async function getAgentTurnQueue(limit = 20): Promise<TurnOrderQueueItem[]> {
  const res = await apiGet<unknown>(withQuery('/api/agents/queue', { limit }));
  return unwrapList<TurnOrderQueueItem>(res, ['queue', 'items', 'triggers']);
}

export interface DispatchAgentPayload {
  dry_run?: boolean;
  sample_input?: string;
  input?: string;
  trigger_id?: string;
  tool_call?: {
    name: string;
    arguments?: Record<string, unknown>;
  };
  estimated_cost_cents?: number;
}

export async function dispatchAgent(
  idOrSlug: string,
  body: DispatchAgentPayload = {},
): Promise<AgentRun> {
  const promptText = (body.sample_input ?? body.input ?? '').trim();
  const payload: Record<string, unknown> = {
    dry_run: Boolean(body.dry_run),
    ...(promptText ? { sample_input: promptText, input: promptText } : {}),
    ...(body.trigger_id ? { trigger_id: body.trigger_id } : {}),
    ...(body.tool_call ? { tool_call: body.tool_call } : {}),
    ...(body.estimated_cost_cents !== undefined
      ? { estimated_cost_cents: body.estimated_cost_cents }
      : {}),
  };
  const res = await apiPost<any>(
    `/api/agents/${encodeURIComponent(idOrSlug)}/dispatch`,
    payload,
  );
  return (res && typeof res === 'object' && res.run && !res.id ? res.run : res) as AgentRun;
}

export interface ListAgentRunsParams {
  agent_id?: string;
  status?: AgentRunStatus;
  is_dry_run?: boolean;
  limit?: number;
}

export async function listAgentRuns(params: ListAgentRunsParams = {}): Promise<AgentRun[]> {
  const res = await apiGet<unknown>(
    withQuery('/api/agent-runs', {
      agent_id: params.agent_id,
      status: params.status,
      is_dry_run: params.is_dry_run,
      limit: params.limit ?? 50,
    }),
  );
  return unwrapList<AgentRun>(res, ['agent_runs', 'runs']);
}

export async function getAgentRun(runId: string): Promise<AgentRun> {
  const res = await apiGet<any>(`/api/agent-runs/${encodeURIComponent(runId)}`);
  return (res && typeof res === 'object' && res.run && !res.id ? res.run : res) as AgentRun;
}
