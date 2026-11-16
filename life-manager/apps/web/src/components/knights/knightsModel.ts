/**
 * Pure domain model, telemetry calculators, skill-slot whitelisting helpers,
 * and Starter Order fallback definitions for Module 05 — Agent Studio (`/agents`).
 */
import type {
  AgentRun,
  AgentTrigger,
  AgentWithTelemetry,
  ArenaZone,
  KnightArchetype,
  SkillPolicyMode,
  TurnOrderQueueItem,
} from '@hermes/api-client';
import {
  normalizeArenaZone,
  normalizeKnightArchetype,
  normalizeSkillPolicyMode,
  type UiSkillPolicyMode,
} from '../../api/agents';

export interface ArenaZoneDescriptor {
  zone: ArenaZone;
  code: string;
  title: string;
  shortLabel: string;
  subtitle: string;
  accentHex: string;
  defaultCoords: ReadonlyArray<{ x: number; y: number }>;
}

export const ARENA_ZONES: readonly ArenaZoneDescriptor[] = [
  {
    zone: 'cron_watchtower',
    code: 'ZONE_01',
    title: 'CRON WATCHTOWER // FRONTLINE',
    shortLabel: 'Cron Watchtower',
    subtitle: 'Scheduled Tokio Cron Frontline Tiles',
    accentHex: '#F87C18',
    defaultCoords: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  },
  {
    zone: 'event_ambush',
    code: 'ZONE_02',
    title: 'EVENT AMBUSH TILE // REACTIVE',
    shortLabel: 'Event Ambush Tile',
    subtitle: 'Domain Event Hooks (YouTube, Portfolio, Goals)',
    accentHex: '#2CE5F2',
    defaultCoords: [
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ],
  },
  {
    zone: 'mastermind_council',
    code: 'ZONE_03',
    title: 'MASTERMIND COUNCIL SEAT',
    shortLabel: 'Mastermind Council Seat',
    subtitle: 'Arch-Mage Frieren Weekly & Quarterly Council',
    accentHex: '#A8F040',
    defaultCoords: [
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 0, y: 3 },
      { x: 1, y: 3 },
    ],
  },
  {
    zone: 'standby_barracks',
    code: 'ZONE_04',
    title: 'STANDBY BARRACKS // PAUSED',
    shortLabel: 'Standby Barracks',
    subtitle: 'Resting Units — Excluded from Active Queue',
    accentHex: '#8A909E',
    defaultCoords: [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ],
  },
];

export interface ArchetypeDescriptor {
  archetype: KnightArchetype;
  label: string;
  roleTitle: string;
  defaultCrest: string;
  defaultOath: string;
}

export const ARCHETYPE_DESCRIPTORS: readonly ArchetypeDescriptor[] = [
  {
    archetype: 'paladin',
    label: 'Paladin (Chief of Staff)',
    roleTitle: 'Morning Chief of Staff',
    defaultCrest: '#F87C18',
    defaultOath:
      '# SOUL.md — Paladin Oath\nDate: {{today}}\nSynthesize Morning Pulse across Todos, Routines, and Active Goals ({{active_goals}}).',
  },
  {
    archetype: 'vanguard',
    label: 'Vanguard / Ranger (Watchman)',
    roleTitle: 'Portfolio & FI Watchman',
    defaultCrest: '#F59E0B',
    defaultOath:
      '# SOUL.md — Vanguard Oath\nDate: {{today}}\nMonitor B3/US/Crypto target drift and price alerts for {{portfolio_summary}}.',
  },
  {
    archetype: 'lore_warden',
    label: 'Lore-Warden / Scholar (Curator)',
    roleTitle: 'Learning & Vault Curator',
    defaultCrest: '#2CE5F2',
    defaultOath:
      '# SOUL.md — Lore-Warden Oath\nDate: {{today}}\nLink new youtube-ai and Vault notes to active Courses and Yearly Goals ({{active_goals}}).',
  },
  {
    archetype: 'inquisitor',
    label: 'Inquisitor (Prioritizer)',
    roleTitle: 'Ruthless Backlog Prioritizer',
    defaultCrest: '#EB4511',
    defaultOath:
      '# SOUL.md — Inquisitor Oath\nDate: {{today}}\nAudit Todo backlog bloat and challenge tasks unaligned with {{active_goals}}.',
  },
  {
    archetype: 'artificer',
    label: 'Artificer (Specialist)',
    roleTitle: 'Tactical Systems Artificer',
    defaultCrest: '#A8F040',
    defaultOath:
      '# SOUL.md — Artificer Oath\nDate: {{today}}\nMaintain infrastructure telemetry, MCP automations, and Second Brain hygiene.',
  },
];

export const CREST_PALETTE = [
  '#F87C18',
  '#2CE5F2',
  '#A8F040',
  '#F59E0B',
  '#EB4511',
  '#F4F6C2',
] as const;

export const SOUL_TEMPLATE_VARIABLES = [
  { token: '{{today}}', label: '{{today}}', description: 'Current ISO date' },
  {
    token: '{{active_goals}}',
    label: '{{active_goals}}',
    description: 'Active Yearly Goals & Q1-Q4 OKR summary',
  },
  {
    token: '{{portfolio_summary}}',
    label: '{{portfolio_summary}}',
    description: 'BRL/USD portfolio allocation & FIRE snapshot',
  },
  {
    token: '{{due_tasks}}',
    label: '{{due_tasks}}',
    description: 'Due & overdue high-priority tasks',
  },
  {
    token: '{{due_reviews}}',
    label: '{{due_reviews}}',
    description: '7d/30d/90d spaced review prompts due',
  },
] as const;

export const DOMAIN_EVENT_TRIGGERS = [
  {
    event: 'YoutubeCrawlerSynced',
    label: 'YoutubeCrawlerSynced',
    description: 'Fires when youtube-lists / youtube-ai syncs new video notes',
  },
  {
    event: 'PortfolioPriceAlert',
    label: 'PortfolioPriceAlert',
    description: 'Fires when a B3/US/Crypto asset crosses alert thresholds',
  },
  {
    event: 'GoalPaceAtRisk',
    label: 'GoalPaceAtRisk',
    description: 'Fires when a Yearly Goal / Key Result falls behind quarterly pace',
  },
] as const;

export interface SkillSlotDescriptor {
  key: string;
  aliases: readonly string[];
  code: string;
  label: string;
  subtitle: string;
  enforcesFinanceApprovalGate?: boolean;
}

export const STANDARD_SKILL_SLOTS: readonly SkillSlotDescriptor[] = [
  {
    key: 'todos.*',
    aliases: ['todos.*', 'todos', 'todos_*', 'tasks.*'],
    code: 'SLOT_01',
    label: 'todos.*',
    subtitle: 'Tasks, Dependencies & Focus Timer (/mcp)',
  },
  {
    key: 'portfolio.*',
    aliases: ['portfolio.*', 'finance.*', 'finance', 'portfolio', 'finance_*'],
    code: 'SLOT_02',
    label: 'portfolio.* / finance.*',
    subtitle: 'BRL/USD Assets & FIRE (Writes Gate: APPROVE)',
    enforcesFinanceApprovalGate: true,
  },
  {
    key: 'vault.*',
    aliases: ['vault.*', 'vault', 'second_brain.*'],
    code: 'SLOT_03',
    label: 'vault.*',
    subtitle: 'Obsidian Second Brain & Note Distill',
  },
  {
    key: 'routines.*',
    aliases: ['routines.*', 'routines', 'routines_*'],
    code: 'SLOT_04',
    label: 'routines.*',
    subtitle: 'Day Profiles, Habit Streaks & Weekly Review',
  },
  {
    key: 'goals.*',
    aliases: ['goals.*', 'goals', 'goals_*'],
    code: 'SLOT_05',
    label: 'goals.*',
    subtitle: 'Yearly Goals & Q1-Q4 OKR Blueprint (/mcp)',
  },
  {
    key: 'courses.*',
    aliases: ['courses.*', 'courses', 'courses_*', 'youtube.*'],
    code: 'SLOT_06',
    label: 'courses.*',
    subtitle: 'Course Syllabus, Quizzes & Spaced Review',
  },
  {
    key: 'dashboards.*',
    aliases: ['dashboards.*', 'dashboards', 'dashboards_*'],
    code: 'SLOT_07',
    label: 'dashboards.*',
    subtitle: 'Room Monitor Decks & Custom Widgets',
  },
  {
    key: 'servers.*',
    aliases: ['servers.*', 'servers', 'servers_*'],
    code: 'SLOT_08',
    label: 'servers.*',
    subtitle: 'TCP/HTTP Infrastructure Server Prober',
  },
];

/**
 * Canonical 4 Starter Knights from `05-agent-studio.md:45-48` and `0003_seed_defaults.sql:47-126`.
 * Used ONLY as an offline fallback when `GET /api/agents` rejects in unmocked environments.
 */
export const FALLBACK_STARTER_KNIGHTS: readonly AgentWithTelemetry[] = [
  {
    id: '01932a00-0000-7000-8000-000000000301',
    slug: 'sir-chronos',
    name: 'Sir Chronos',
    knight_archetype: 'paladin',
    crest_color: '#F87C18',
    sprite_sheet_id: 'knight-paladin',
    grid_pos: { x: 1, y: 1, zone: 'cron_watchtower' },
    hermes_profile: 'chief-of-staff',
    system_prompt:
      '# SOUL.md — Sir Chronos (Morning Chief of Staff)\nDate: {{today}}\nPrepare the 07:00 Morning Pulse across Todos ({{due_tasks}}), Routines, and Active Goals ({{active_goals}}).',
    model_config: {
      model: 'nousresearch/hermes-3-llama-3.1-70b',
      thinking_effort: 'high',
      max_context_tokens: 128000,
    },
    tools_policy: {
      'todos.*': 'AUTO',
      'routines.*': 'AUTO',
      'dashboards.*': 'READ',
      'goals.*': 'READ',
    },
    monthly_budget_cents: 500,
    spent_month_cents: 160,
    hp_remaining_cents: 340,
    hp_pct: 68,
    ep_used_tokens: 14000,
    ep_max_tokens: 128000,
    ep_pct: 89,
    is_mastermind_member: true,
    enabled: true,
    is_paused: false,
    version: 1,
    created_at: '2026-01-01T07:00:00Z',
    updated_at: '2026-01-01T07:00:00Z',
    triggers: [
      {
        id: '01932a00-0000-7000-8000-000000000311',
        agent_id: '01932a00-0000-7000-8000-000000000301',
        type: 'cron',
        config_json: {
          cron: '0 0 7 * * *',
          description: '07:00 Daily Morning Pulse',
        },
        enabled: true,
        last_run_at: null,
        next_run_at: '2026-11-16T07:00:00Z',
        created_at: '2026-01-01T07:00:00Z',
        updated_at: '2026-01-01T07:00:00Z',
      },
    ],
  },
  {
    id: '01932a00-0000-7000-8000-000000000302',
    slug: 'vanguard-aurum',
    name: 'Vanguard Aurum',
    knight_archetype: 'vanguard',
    crest_color: '#F59E0B',
    sprite_sheet_id: 'knight-vanguard',
    grid_pos: { x: 3, y: 1, zone: 'event_ambush' },
    hermes_profile: 'wealth-watchman',
    system_prompt:
      '# SOUL.md — Vanguard Aurum (Portfolio & FI Watchman)\nDate: {{today}}\nMonitor B3/US/Crypto target drift, price alerts, and monthly investment readiness ({{portfolio_summary}}).',
    model_config: {
      model: 'nousresearch/hermes-3-llama-3.1-70b',
      thinking_effort: 'medium',
      max_context_tokens: 128000,
    },
    tools_policy: {
      'finance.*': 'APPROVE',
      'portfolio.*': 'APPROVE',
      'dashboards.*': 'READ',
      'goals.*': 'READ',
      'todos.*': 'READ',
    },
    monthly_budget_cents: 500,
    spent_month_cents: 0,
    hp_remaining_cents: 500,
    hp_pct: 100,
    ep_used_tokens: 18000,
    ep_max_tokens: 128000,
    ep_pct: 86,
    is_mastermind_member: true,
    enabled: true,
    is_paused: false,
    version: 1,
    created_at: '2026-01-01T07:00:00Z',
    updated_at: '2026-01-01T07:00:00Z',
    triggers: [
      {
        id: '01932a00-0000-7000-8000-000000000312',
        agent_id: '01932a00-0000-7000-8000-000000000302',
        type: 'event',
        config_json: {
          event: 'PortfolioPriceAlert',
          description: 'Portfolio & FI Watchman reactive price alert',
        },
        enabled: true,
        last_run_at: null,
        next_run_at: null,
        created_at: '2026-01-01T07:00:00Z',
        updated_at: '2026-01-01T07:00:00Z',
      },
    ],
  },
  {
    id: '01932a00-0000-7000-8000-000000000303',
    slug: 'lore-warden-lyra',
    name: 'Lore-Warden Lyra',
    knight_archetype: 'lore_warden',
    crest_color: '#2CE5F2',
    sprite_sheet_id: 'knight-lore-warden',
    grid_pos: { x: 1, y: 3, zone: 'event_ambush' },
    hermes_profile: 'learning-curator',
    system_prompt:
      '# SOUL.md — Lore-Warden Lyra (Learning Curator)\nDate: {{today}}\nReact to youtube-ai crawler runs and link new video notes to active Courses and Yearly Goals ({{active_goals}}).',
    model_config: {
      model: 'nousresearch/hermes-3-llama-3.1-70b',
      thinking_effort: 'medium',
      max_context_tokens: 128000,
    },
    tools_policy: {
      'courses.*': 'AUTO',
      'vault.*': 'AUTO',
      'goals.*': 'READ',
      'todos.*': 'AUTO',
      'dashboards.*': 'READ',
    },
    monthly_budget_cents: 500,
    spent_month_cents: 50,
    hp_remaining_cents: 450,
    hp_pct: 90,
    ep_used_tokens: 22000,
    ep_max_tokens: 128000,
    ep_pct: 83,
    is_mastermind_member: true,
    enabled: true,
    is_paused: false,
    version: 1,
    created_at: '2026-01-01T07:00:00Z',
    updated_at: '2026-01-01T07:00:00Z',
    triggers: [
      {
        id: '01932a00-0000-7000-8000-000000000313',
        agent_id: '01932a00-0000-7000-8000-000000000303',
        type: 'event',
        config_json: {
          event: 'YoutubeCrawlerSynced',
          description: 'Links youtube-ai notes to Courses & Yearly Goals',
        },
        enabled: true,
        last_run_at: null,
        next_run_at: null,
        created_at: '2026-01-01T07:00:00Z',
        updated_at: '2026-01-01T07:00:00Z',
      },
    ],
  },
  {
    id: '01932a00-0000-7000-8000-000000000304',
    slug: 'inquisitor-vex',
    name: 'Inquisitor Vex',
    knight_archetype: 'inquisitor',
    crest_color: '#EB4511',
    sprite_sheet_id: 'knight-inquisitor',
    grid_pos: { x: 3, y: 3, zone: 'mastermind_council' },
    hermes_profile: 'ruthless-prioritizer',
    system_prompt:
      '# SOUL.md — Inquisitor Vex (Ruthless Prioritizer)\nDate: {{today}}\nAudit Todo backlog bloat and challenge tasks unaligned with any Yearly Goal ({{active_goals}}).',
    model_config: {
      model: 'nousresearch/hermes-3-llama-3.1-70b',
      thinking_effort: 'high',
      max_context_tokens: 128000,
    },
    tools_policy: {
      'todos.*': 'APPROVE',
      'goals.*': 'READ',
      'routines.*': 'READ',
      'courses.*': 'READ',
    },
    monthly_budget_cents: 500,
    spent_month_cents: 0,
    hp_remaining_cents: 500,
    hp_pct: 100,
    ep_used_tokens: 9000,
    ep_max_tokens: 128000,
    ep_pct: 93,
    is_mastermind_member: true,
    enabled: true,
    is_paused: false,
    version: 1,
    created_at: '2026-01-01T07:00:00Z',
    updated_at: '2026-01-01T07:00:00Z',
    triggers: [
      {
        id: '01932a00-0000-7000-8000-000000000314',
        agent_id: '01932a00-0000-7000-8000-000000000304',
        type: 'event',
        config_json: {
          event: 'GoalPaceAtRisk',
          description: 'Challenges unaligned tasks when Goal pace is at risk',
        },
        enabled: true,
        last_run_at: null,
        next_run_at: null,
        created_at: '2026-01-01T07:00:00Z',
        updated_at: '2026-01-01T07:00:00Z',
      },
    ],
  },
];

export function formatUsdFromCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.max(0, cents) : 0;
  return `$${(safe / 100).toFixed(2)}`;
}

export function formatTokensK(tokens: number): string {
  const safe = Number.isFinite(tokens) ? Math.max(0, Math.round(tokens)) : 0;
  if (safe === 0) return '0k';
  if (safe < 1000) return `${safe}`;
  const k = safe / 1000;
  return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
}

export interface ComputedKnightTelemetry {
  id: string;
  slug: string;
  name: string;
  archetype: KnightArchetype;
  crestColor: string;
  zone: ArenaZone;
  gridX: number;
  gridY: number;
  budgetCents: number;
  spentCents: number;
  remainingCents: number;
  hpPct: number;
  /** Formatted remaining over budget, e.g. `$3.40 / $5.00` (W7). */
  hpLabel: string;
  epUsedTokens: number;
  epMaxTokens: number;
  epPct: number;
  /** Formatted token load over context cap, e.g. `14k / 128k ctx` (F26-R07). */
  epLabel: string;
  isPaused: boolean;
  isCircuitBroken: boolean;
  isMastermindMember: boolean;
  enabled: boolean;
  systemPrompt: string;
  model: string;
  thinkingEffort: 'low' | 'medium' | 'high';
  toolsPolicy: Record<string, SkillPolicyMode>;
  triggers: AgentTrigger[];
}

export function computeKnightTelemetry(
  raw: Record<string, any>,
  latestRun?: AgentRun | null,
): ComputedKnightTelemetry {
  const archetype = normalizeKnightArchetype(raw.knight_archetype ?? raw.archetype);
  const budgetCents = Math.max(
    0,
    Math.round(Number(raw.monthly_budget_cents ?? raw.hp_budget_cents ?? 500)),
  );
  const hasExplicitSpend =
    raw.spent_month_cents !== undefined ||
    raw.month_spent_cents !== undefined ||
    raw.hp_spent_cents !== undefined;
  const rawSpentCents = Math.max(
    0,
    Math.round(
      Number(raw.spent_month_cents ?? raw.month_spent_cents ?? raw.hp_spent_cents ?? 0),
    ),
  );
  const remainingCents = hasExplicitSpend
    ? Math.max(0, budgetCents - rawSpentCents)
    : raw.hp_remaining_cents !== undefined && Number.isFinite(Number(raw.hp_remaining_cents))
      ? Math.min(budgetCents, Math.max(0, Math.round(Number(raw.hp_remaining_cents))))
      : Math.max(0, budgetCents - rawSpentCents);
  const spentCents = hasExplicitSpend
    ? rawSpentCents
    : Math.max(0, budgetCents - remainingCents);

  const hpPct =
    budgetCents <= 0
      ? 0
      : Math.min(100, Math.max(0, Math.round((remainingCents / budgetCents) * 100)));

  const modelCfg =
    raw.model_config && typeof raw.model_config === 'object'
      ? (raw.model_config as Record<string, any>)
      : {};

  const runTokens = latestRun
    ? Math.max(0, Number(latestRun.input_tokens || 0) + Number(latestRun.output_tokens || 0))
    : 0;
  const rawEpUsed = Number(
    raw.ep_used_tokens ?? raw.tokens_today ?? raw.ep_Context_tokens_used ?? 0,
  );
  const epUsedTokens = rawEpUsed > 0 ? rawEpUsed : runTokens;

  const epMaxTokens = Math.max(
    1000,
    Math.round(
      Number(
        raw.ep_max_tokens ??
          modelCfg.max_context_tokens ??
          modelCfg.ep_daily_tokens ??
          128000,
      ),
    ),
  );

  // epPct for the bar: if epUsedTokens > 0, show either load or remaining quota consistently
  const epPct = Math.min(
    100,
    Math.max(0, Math.round(((epMaxTokens - epUsedTokens) / epMaxTokens) * 100)),
  );

  const rawZone =
    raw.grid_pos?.zone ??
    raw.zone ??
    (remainingCents <= 0 ? 'standby_barracks' : 'cron_watchtower');
  const zone = normalizeArenaZone(rawZone);
  const gridX = Number.isFinite(Number(raw.grid_pos?.x))
    ? Math.max(0, Math.round(Number(raw.grid_pos.x)))
    : 0;
  const gridY = Number.isFinite(Number(raw.grid_pos?.y))
    ? Math.max(0, Math.round(Number(raw.grid_pos.y)))
    : 0;

  const enabled = raw.enabled !== undefined ? Boolean(raw.enabled) : zone !== 'standby_barracks';
  const isCircuitBroken = remainingCents <= 0;
  const isPaused =
    Boolean(raw.is_paused) ||
    !enabled ||
    zone === 'standby_barracks' ||
    isCircuitBroken;

  const rawPolicy =
    raw.tools_policy && typeof raw.tools_policy === 'object'
      ? (raw.tools_policy as Record<string, unknown>)
      : {};
  const toolsPolicy: Record<string, SkillPolicyMode> = {};
  for (const [k, v] of Object.entries(rawPolicy)) {
    const mode = normalizeSkillPolicyMode(v);
    if (mode !== 'NONE') {
      toolsPolicy[k] = mode;
    }
  }

  const rawEffort = String(
    modelCfg.thinking_effort ?? modelCfg.reasoning_effort ?? 'medium',
  ).toLowerCase();
  const thinkingEffort: 'low' | 'medium' | 'high' =
    rawEffort === 'low' || rawEffort === 'high' ? rawEffort : 'medium';

  return {
    id: String(raw.id || raw.slug || 'knight'),
    slug: String(raw.slug || slugifyAgentName(String(raw.name || 'knight'))),
    name: String(raw.name || 'Unnamed Knight'),
    archetype,
    crestColor:
      typeof raw.crest_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.crest_color.trim())
        ? raw.crest_color.trim()
        : '#F87C18',
    zone,
    gridX,
    gridY,
    budgetCents,
    spentCents,
    remainingCents,
    hpPct,
    hpLabel: `${formatUsdFromCents(remainingCents)} / ${formatUsdFromCents(budgetCents)}`,
    epUsedTokens,
    epMaxTokens,
    epPct,
    epLabel: `${formatTokensK(epUsedTokens)} / ${formatTokensK(epMaxTokens)} ctx`,
    isPaused,
    isCircuitBroken,
    isMastermindMember: Boolean(raw.is_mastermind_member ?? zone === 'mastermind_council'),
    enabled,
    systemPrompt: String(raw.system_prompt || ''),
    model: String(modelCfg.model || 'nousresearch/hermes-3-llama-3.1-70b'),
    thinkingEffort,
    toolsPolicy,
    triggers: Array.isArray(raw.triggers) ? (raw.triggers as AgentTrigger[]) : [],
  };
}

export function resolveSkillSlotMode(
  toolsPolicy: Record<string, unknown> | undefined | null,
  slotOrKey: SkillSlotDescriptor | string,
): UiSkillPolicyMode {
  if (!toolsPolicy || typeof toolsPolicy !== 'object') return 'NONE';
  const slot: SkillSlotDescriptor =
    typeof slotOrKey === 'string'
      ? (STANDARD_SKILL_SLOTS.find(
          (s) => s.key === slotOrKey || s.aliases.includes(slotOrKey),
        ) ?? {
          key: slotOrKey,
          aliases: [slotOrKey, slotOrKey.replace(/\.\*$/, '')],
          code: 'SLOT_CUSTOM',
          label: slotOrKey,
          subtitle: '',
        })
      : slotOrKey;

  for (const alias of slot.aliases) {
    if (alias in toolsPolicy) {
      return normalizeSkillPolicyMode(toolsPolicy[alias]);
    }
  }

  // Check if any exact tool key starts with domain prefix (e.g. `todos_create_task` or `todos.list`)
  const prefixes = Array.from(
    new Set([
      slot.key.replace(/\.\*$/, ''),
      ...slot.aliases.map((a) => a.replace(/(\.\*|_\*)$/, '')),
    ]),
  );
  const matchingModes: UiSkillPolicyMode[] = [];
  for (const [k, v] of Object.entries(toolsPolicy)) {
    if (prefixes.some((p) => k === p || k.startsWith(`${p}_`) || k.startsWith(`${p}.`))) {
      const m = normalizeSkillPolicyMode(v);
      if (m !== 'NONE') matchingModes.push(m);
    }
  }
  if (matchingModes.includes('AUTO')) return 'AUTO';
  if (matchingModes.includes('APPROVE')) return 'APPROVE';
  if (matchingModes.includes('READ')) return 'READ';
  if ('*' in toolsPolicy) {
    return normalizeSkillPolicyMode(toolsPolicy['*']);
  }
  return 'NONE';
}

export function buildUpdatedToolsPolicy(
  current: Record<string, SkillPolicyMode>,
  slotKey: string,
  nextMode: UiSkillPolicyMode,
): Record<string, SkillPolicyMode> {
  const next: Record<string, SkillPolicyMode> = { ...current };
  const descriptor = STANDARD_SKILL_SLOTS.find(
    (s) => s.key === slotKey || s.aliases.includes(slotKey),
  );

  // If wildcard '*' is present, expand it into explicit entries for all other standard slots first
  if ('*' in next && typeof next['*'] === 'string') {
    const wildcardMode = normalizeSkillPolicyMode(next['*']);
    delete next['*'];
    if (wildcardMode !== 'NONE') {
      for (const otherSlot of STANDARD_SKILL_SLOTS) {
        if (descriptor && otherSlot.key === descriptor.key) continue;
        if (!descriptor && (otherSlot.key === slotKey || otherSlot.aliases.includes(slotKey))) {
          continue;
        }
        const existingMode = resolveSkillSlotMode(next, otherSlot);
        if (existingMode === 'NONE') {
          next[otherSlot.key] = wildcardMode;
          const otherPrefix = otherSlot.key.replace(/\.\*$/, '');
          next[otherPrefix] = wildcardMode;
          if (otherSlot.key === 'portfolio.*') {
            next['finance.*'] = wildcardMode;
            next['finance'] = wildcardMode;
          }
        }
      }
    }
  }

  const prefixes = descriptor
    ? Array.from(
        new Set([
          descriptor.key.replace(/\.\*$/, ''),
          ...descriptor.aliases.map((a) => a.replace(/(\.\*|_\*)$/, '')),
        ]),
      )
    : [slotKey.replace(/(\.\*|_\*)$/, '')];

  const keysToClear = descriptor ? descriptor.aliases : [slotKey];
  for (const k of Object.keys(next)) {
    if (
      keysToClear.includes(k) ||
      prefixes.some((p) => k === p || k.startsWith(`${p}_`) || k.startsWith(`${p}.`))
    ) {
      delete next[k];
    }
  }

  if (nextMode !== 'NONE') {
    if (descriptor && descriptor.key === 'portfolio.*') {
      next['portfolio.*'] = nextMode;
      next['portfolio'] = nextMode;
      next['finance.*'] = nextMode;
      next['finance'] = nextMode;
    } else if (descriptor) {
      const prefix = descriptor.key.replace(/\.\*$/, '');
      next[descriptor.key] = nextMode;
      next[prefix] = nextMode;
    } else {
      const prefix = slotKey.replace(/\.\*$/, '');
      next[slotKey] = nextMode;
      next[prefix] = nextMode;
    }
  }

  return next;
}

export function insertSoulTemplateVariable(
  currentPrompt: string,
  token: string,
  selectionStart?: number | null,
  selectionEnd?: number | null,
): string {
  if (
    typeof selectionStart === 'number' &&
    typeof selectionEnd === 'number' &&
    selectionStart >= 0 &&
    selectionEnd >= selectionStart &&
    selectionEnd <= currentPrompt.length
  ) {
    const before = currentPrompt.slice(0, selectionStart);
    const after = currentPrompt.slice(selectionEnd);
    return `${before}${token}${after}`;
  }
  const sep =
    currentPrompt.length === 0 || currentPrompt.endsWith(' ') || currentPrompt.endsWith('\n')
      ? ''
      : ' ';
  return `${currentPrompt}${sep}${token}`;
}

export function slugifyAgentName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'knight-unit';
}

export interface KnightForgeValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateKnightForgeInput(input: {
  name: string;
  systemPrompt?: string;
  crestColor: string;
  monthlyBudgetCents?: number;
  monthlyBudgetUsd?: number;
  epMaxTokens?: number;
  cronExpr?: string;
}): KnightForgeValidationResult {
  const errors: string[] = [];
  if (!input.name || !input.name.trim()) {
    errors.push('Knight name is required.');
  }
  if (input.systemPrompt !== undefined && !input.systemPrompt.trim()) {
    errors.push('System Oath (SOUL.md prompt) is required.');
  }
  if (!/^#[0-9a-fA-F]{6}$/.test((input.crestColor || '').trim())) {
    errors.push('Crest color must be a 6-digit hex code (e.g. #F87C18).');
  }
  if (
    input.monthlyBudgetCents !== undefined &&
    (!Number.isFinite(input.monthlyBudgetCents) || input.monthlyBudgetCents < 0)
  ) {
    errors.push('Monthly HP budget must be 0 or greater (in cents).');
  }
  if (
    input.monthlyBudgetUsd !== undefined &&
    (!Number.isFinite(input.monthlyBudgetUsd) || input.monthlyBudgetUsd < 0)
  ) {
    errors.push('Monthly HP budget must be 0 or greater.');
  }
  if (
    input.epMaxTokens !== undefined &&
    (!Number.isFinite(input.epMaxTokens) || input.epMaxTokens < 1000)
  ) {
    errors.push('EP context token cap must be at least 1,000 tokens.');
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Builds the Turn-Order Timeline (`recent runs -> [ACTIVE] Knight -> upcoming scheduled runs`)
 * while strictly excluding paused / Standby Barracks / circuit-broken Knights from upcoming scheduled execution.
 */
export function buildTurnOrderChain(params: {
  knights: ComputedKnightTelemetry[];
  queueItems: TurnOrderQueueItem[];
  recentRuns: AgentRun[];
  activeKnightId?: string | null;
  castingKnightId?: string | null;
}): {
  recentNodes: Array<{
    id: string;
    knightName: string;
    crestColor: string;
    status: string;
    isDryRun: boolean;
    tokens: number;
    costUsd: string;
  }>;
  activeKnight: ComputedKnightTelemetry | null;
  upcomingNodes: Array<{
    id: string;
    agentId: string;
    knightName: string;
    crestColor: string;
    triggerType: string;
    label: string;
    scheduledAt: string | null;
  }>;
} {
  const { knights, queueItems, recentRuns, activeKnightId, castingKnightId } = params;
  const byId = new Map<string, ComputedKnightTelemetry>();
  const bySlug = new Map<string, ComputedKnightTelemetry>();
  for (const k of knights) {
    byId.set(k.id, k);
    bySlug.set(k.slug, k);
  }

  const isEligibleForQueue = (k: ComputedKnightTelemetry) =>
    !k.isPaused && !k.isCircuitBroken && k.enabled && k.zone !== 'standby_barracks';

  const recentNodes = recentRuns.slice(0, 3).map((r) => {
    const k = byId.get(r.agent_id) ?? bySlug.get(r.agent_id);
    const parsedCost =
      r.estimated_cost_usd != null
        ? Number.parseFloat(String(r.estimated_cost_usd).trim().replace(/^\$/, ''))
        : typeof (r as any).cost_cents === 'number'
          ? (r as any).cost_cents / 100
          : 0;
    const costUsd =
      r.is_dry_run || !Number.isFinite(parsedCost)
        ? '0.00'
        : Math.max(0, parsedCost).toFixed(2);
    return {
      id: r.id,
      knightName: k?.name ?? r.agent_id,
      crestColor: k?.crestColor ?? '#F87C18',
      status: String(r.status ?? 'ok'),
      isDryRun: Boolean(r.is_dry_run),
      tokens: Math.max(0, Number(r.input_tokens || 0) + Number(r.output_tokens || 0)),
      costUsd,
    };
  });

  const runningRun = recentRuns.find((r) => r.status === 'running');
  const activeKnight =
    (castingKnightId ? (byId.get(castingKnightId) ?? bySlug.get(castingKnightId)) : null) ??
    (runningRun ? (byId.get(runningRun.agent_id) ?? bySlug.get(runningRun.agent_id)) : null) ??
    (activeKnightId
      ? (byId.get(activeKnightId) ?? bySlug.get(activeKnightId))
      : null) ??
    knights.find((k) => isEligibleForQueue(k)) ??
    knights[0] ??
    null;

  // Filter queue items to exclude paused, circuit-broken, disabled, or standby_barracks Knights
  const validQueue = queueItems.filter((item) => {
    const k = byId.get(item.agent_id) ?? bySlug.get(item.agent_slug);
    if (!k) return true;
    return isEligibleForQueue(k);
  });

  const upcomingNodes =
    validQueue.length > 0
      ? validQueue.slice(0, 6).map((item) => {
          const k = byId.get(item.agent_id) ?? bySlug.get(item.agent_slug);
          return {
            id: item.trigger_id || `${item.agent_id}-${item.label}`,
            agentId: item.agent_id,
            knightName: item.agent_name || k?.name || item.agent_slug,
            crestColor: k?.crestColor ?? '#2CE5F2',
            triggerType: item.trigger_type,
            label: item.label,
            scheduledAt: item.scheduled_at ?? null,
          };
        })
      : knights
          .filter((k) => isEligibleForQueue(k))
          .flatMap((k) =>
            k.triggers
              .filter((t) => t.enabled)
              .map((t) => {
                const cfg =
                  t.config_json && typeof t.config_json === 'object'
                    ? (t.config_json as Record<string, any>)
                    : {};
                const label =
                  t.type === 'cron'
                    ? String(cfg.description || cfg.cron || 'Scheduled Cron')
                    : String(cfg.event || cfg.description || 'Event Ambush');
                return {
                  id: t.id,
                  agentId: k.id,
                  knightName: k.name,
                  crestColor: k.crestColor,
                  triggerType: t.type,
                  label,
                  scheduledAt: t.next_run_at ?? null,
                };
              }),
          )
          .slice(0, 6);

  return {
    recentNodes,
    activeKnight,
    upcomingNodes,
  };
}
