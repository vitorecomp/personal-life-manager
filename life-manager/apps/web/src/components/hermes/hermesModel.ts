/**
 * Pure model logic for the Hermes Chat Workspace (`/hermes`, module 04).
 * No React, no I/O: everything here is deterministic and unit-tested.
 */
import type { HermesSessionDto } from '../../api/hermes';

// ---------------------------------------------------------------------------
// Domain @mentions and / commands (04-hermes-chat-interface.md §2.2)
// ---------------------------------------------------------------------------

export type OrbQuerySource = 'vault' | 'mcp' | 'gateway';

export interface HermesMentionSpec {
  token: string;
  label: string;
  /** What the gateway queries for this scope: Vault notes or a `/mcp` Life Ops module. */
  source: OrbQuerySource;
  /** `spec` = named in the locked specification; `backend` = extra scope the Rust gateway resolves. */
  origin: 'spec' | 'backend';
}

export const HERMES_MENTIONS: readonly HermesMentionSpec[] = [
  { token: '@vault', label: 'Obsidian Second Brain notes', source: 'vault', origin: 'spec' },
  { token: '@youtube', label: 'youtube-ai notes and playlists', source: 'mcp', origin: 'spec' },
  { token: '@goals', label: 'Yearly goals and key results', source: 'mcp', origin: 'spec' },
  { token: '@todos', label: 'Open tasks and focus timer', source: 'mcp', origin: 'spec' },
  { token: '@routines', label: 'Routines and streaks', source: 'mcp', origin: 'spec' },
  { token: '@courses', label: 'Courses and due reviews', source: 'mcp', origin: 'spec' },
  { token: '@portfolio', label: 'Portfolio allocation and FIRE', source: 'mcp', origin: 'spec' },
  { token: '@servers', label: 'Server prober summary', source: 'mcp', origin: 'backend' },
];

/** Scope aliases the Rust gateway also accepts (`gateway.rs` resolve_chat_context). */
const MENTION_ALIASES: Readonly<Record<string, string>> = {
  '@tasks': '@todos',
  '@finance': '@portfolio',
};

export interface HermesSlashCommandSpec {
  command: string;
  label: string;
  /** Scopes the gateway attaches on its own for this command. */
  impliedMentions: readonly string[];
  activatesOrb: boolean;
  origin: 'spec' | 'backend';
  /** Only resolved by the deterministic offline mock (`/mcp <tool> <json>`). */
  offlineMockOnly?: boolean;
  /** Sent as `slash_command`; `/mcp` is parsed from the message text by the gateway instead. */
  sendAsSlashCommand: boolean;
}

export const HERMES_SLASH_COMMANDS: readonly HermesSlashCommandSpec[] = [
  {
    command: '/deep-plan',
    label: 'High-level plan across goals and todos (activates the Thinking Orb)',
    impliedMentions: ['@goals', '@todos'],
    activatesOrb: true,
    origin: 'spec',
    sendAsSlashCommand: true,
  },
  {
    command: '/weekly-review',
    label: 'Weekly review across routines, todos and goals',
    impliedMentions: ['@routines', '@todos', '@goals'],
    activatesOrb: false,
    origin: 'spec',
    sendAsSlashCommand: true,
  },
  {
    command: '/quiz-me',
    label: 'Active-recall quiz from your courses',
    impliedMentions: ['@courses'],
    activatesOrb: false,
    origin: 'spec',
    sendAsSlashCommand: true,
  },
  {
    command: '/rebalance',
    label: 'Portfolio rebalancing brief',
    impliedMentions: ['@portfolio'],
    activatesOrb: false,
    origin: 'backend',
    sendAsSlashCommand: true,
  },
  {
    command: '/mcp',
    label: 'Run a Life Ops tool: /mcp <tool_name> <json>',
    impliedMentions: [],
    activatesOrb: false,
    origin: 'backend',
    offlineMockOnly: true,
    sendAsSlashCommand: false,
  },
];

export interface ParsedComposerDraft {
  /** Known `/command` at the start of the draft, lower-case, or `null`. */
  slashCommand: string | null;
  slashSpec: HermesSlashCommandSpec | null;
  /** Recognised scopes in order of first appearance, de-duplicated (`@vault:<path>` kept verbatim). */
  mentions: string[];
  /** Whether the Thinking Orb will be active because of the command alone. */
  commandActivatesOrb: boolean;
}

const MENTION_TOKEN_RE = /(^|[\s([{"'])(@[A-Za-z][\w-]*(?::[^\s)\]}"']+)?)/g;

function canonicalMention(raw: string): string | null {
  const trimmed = raw.replace(/[.,;!?]+$/, '');
  if (/^@vault:.+/i.test(trimmed)) {
    return `@vault:${trimmed.slice('@vault:'.length)}`;
  }
  const lower = trimmed.toLowerCase();
  if (HERMES_MENTIONS.some((m) => m.token === lower)) return lower;
  if (MENTION_ALIASES[lower]) return lower;
  return null;
}

export function parseComposerDraft(draft: string): ParsedComposerDraft {
  const trimmed = draft.trim();
  let slashSpec: HermesSlashCommandSpec | null = null;
  if (trimmed.startsWith('/')) {
    const head = (trimmed.split(/\s+/, 1)[0] ?? '').toLowerCase();
    slashSpec = HERMES_SLASH_COMMANDS.find((c) => c.command === head) ?? null;
  }

  const mentions: string[] = [];
  MENTION_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null = MENTION_TOKEN_RE.exec(draft);
  while (match) {
    const canonical = canonicalMention(match[2] ?? '');
    if (canonical && !mentions.includes(canonical)) mentions.push(canonical);
    match = MENTION_TOKEN_RE.exec(draft);
  }

  return {
    slashCommand: slashSpec ? slashSpec.command : null,
    slashSpec,
    mentions,
    commandActivatesOrb: Boolean(slashSpec?.activatesOrb),
  };
}

/** Which data source a (possibly aliased or path-qualified) mention makes the gateway query. */
export function mentionSource(mention: string): OrbQuerySource {
  const lower = mention.toLowerCase();
  if (lower === '@vault' || lower.startsWith('@vault:')) return 'vault';
  const base = MENTION_ALIASES[lower] ?? lower;
  return HERMES_MENTIONS.find((m) => m.token === base)?.source ?? 'gateway';
}

export interface ComposerSuggestion {
  kind: 'mention' | 'command';
  value: string;
  label: string;
  /** Text range in the draft that accepting the suggestion replaces. */
  replaceFrom: number;
  replaceTo: number;
}

/**
 * Autocomplete candidates for the token under the caret: `/…` at the very start of the draft
 * lists commands, `@…` anywhere lists domain scopes.
 */
export function suggestForCaret(
  draft: string,
  caret: number,
  options: { includeOfflineMockOnly?: boolean } = {},
): ComposerSuggestion[] {
  const safeCaret = Math.max(0, Math.min(caret, draft.length));
  let start = safeCaret;
  while (start > 0 && !/\s/.test(draft[start - 1] ?? ' ')) start -= 1;
  const token = draft.slice(start, safeCaret);
  if (token.length === 0) return [];

  if (token.startsWith('/')) {
    if (draft.slice(0, start).trim().length > 0) return [];
    const needle = token.toLowerCase();
    return HERMES_SLASH_COMMANDS.filter(
      (c) =>
        c.command.startsWith(needle) &&
        c.command !== needle &&
        (!c.offlineMockOnly || options.includeOfflineMockOnly),
    ).map((c) => ({
      kind: 'command' as const,
      value: c.command,
      label: c.label,
      replaceFrom: start,
      replaceTo: safeCaret,
    }));
  }

  if (token.startsWith('@') && !token.includes(':')) {
    const needle = token.toLowerCase();
    return HERMES_MENTIONS.filter((m) => m.token.startsWith(needle) && m.token !== needle).map(
      (m) => ({
        kind: 'mention' as const,
        value: m.token,
        label: m.label,
        replaceFrom: start,
        replaceTo: safeCaret,
      }),
    );
  }
  return [];
}

export function applySuggestion(
  draft: string,
  suggestion: ComposerSuggestion,
): { draft: string; caret: number } {
  const before = draft.slice(0, suggestion.replaceFrom);
  const after = draft.slice(suggestion.replaceTo);
  const needsSpace = after.length === 0 || !/^\s/.test(after);
  const inserted = `${suggestion.value}${needsSpace ? ' ' : ''}`;
  return { draft: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

/** Adds a scope token to the end of the draft, or removes every occurrence if already present. */
export function toggleMentionInDraft(draft: string, token: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const present = new RegExp(`(^|\\s)${escaped}(?=$|[\\s.,;!?])`, 'i');
  if (present.test(draft)) {
    return draft
      .replace(new RegExp(`(^|\\s)${escaped}(?=$|[\\s.,;!?])`, 'gi'), '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^[ \t]+/, '');
  }
  if (draft.length === 0) return `${token} `;
  return /\s$/.test(draft) ? `${draft}${token} ` : `${draft} ${token} `;
}

/** Sets, swaps or clears (when already active) the leading `/command` of the draft. */
export function toggleSlashCommandInDraft(draft: string, command: string): string {
  const leading = draft.match(/^\s*(\/[\w-]+)(\s+|$)/);
  if (leading) {
    const rest = draft.slice(leading[0].length);
    if ((leading[1] ?? '').toLowerCase() === command) return rest;
    return `${command} ${rest}`;
  }
  return `${command} ${draft.replace(/^\s+/, '')}`;
}

// ---------------------------------------------------------------------------
// Session rail grouping (04 §2.1: Pinned, Today, Previous 7 Days, Archived/Folders)
// ---------------------------------------------------------------------------

export type RailGroupId = 'pinned' | 'today' | 'previous7' | 'older' | 'archive';

export interface RailFolder {
  /** `null` = archived sessions without the folder distinction. */
  name: string;
  kind: 'archived' | 'folder';
  sessions: HermesSessionDto[];
}

export interface RailGroup {
  id: RailGroupId;
  label: string;
  sessions: HermesSessionDto[];
  folders: RailFolder[];
  count: number;
}

export function sessionActivityIso(session: HermesSessionDto): string {
  return session.last_message_at || session.updated_at || session.created_at || '';
}

function activityMs(session: HermesSessionDto): number {
  const ms = Date.parse(sessionActivityIso(session));
  return Number.isNaN(ms) ? 0 : ms;
}

function startOfLocalDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Buckets sessions for the rail. Precedence: archived → Archived/Folders; pinned → Pinned;
 * foldered (e.g. `Knight Runs`) → Archived/Folders; otherwise by last activity in local time.
 * Sessions older than seven days that are neither archived nor foldered go to `Older`, a bucket
 * the specification does not name but without which they would be unreachable.
 */
export function groupSessionsForRail(sessions: readonly HermesSessionDto[], now: Date): RailGroup[] {
  const dayStart = startOfLocalDay(now);
  const weekStart = dayStart - 7 * 86_400_000;

  const pinned: HermesSessionDto[] = [];
  const today: HermesSessionDto[] = [];
  const previous7: HermesSessionDto[] = [];
  const older: HermesSessionDto[] = [];
  const archived: HermesSessionDto[] = [];
  const folders = new Map<string, HermesSessionDto[]>();

  const ordered = [...sessions].sort((a, b) => activityMs(b) - activityMs(a));
  for (const session of ordered) {
    const folder = (session.folder_name ?? '').trim();
    if (session.archived) {
      archived.push(session);
    } else if (session.pinned) {
      pinned.push(session);
    } else if (folder) {
      const list = folders.get(folder) ?? [];
      list.push(session);
      folders.set(folder, list);
    } else {
      const ms = activityMs(session);
      if (ms >= dayStart) today.push(session);
      else if (ms >= weekStart) previous7.push(session);
      else older.push(session);
    }
  }

  const archiveFolders: RailFolder[] = [];
  for (const name of [...folders.keys()].sort((a, b) => a.localeCompare(b))) {
    archiveFolders.push({ name, kind: 'folder', sessions: folders.get(name) ?? [] });
  }
  if (archived.length > 0) {
    archiveFolders.push({ name: 'Archived', kind: 'archived', sessions: archived });
  }
  const archiveCount = archiveFolders.reduce((sum, f) => sum + f.sessions.length, 0);

  const groups: RailGroup[] = [
    { id: 'pinned', label: 'Pinned', sessions: pinned, folders: [], count: pinned.length },
    { id: 'today', label: 'Today', sessions: today, folders: [], count: today.length },
    {
      id: 'previous7',
      label: 'Previous 7 Days',
      sessions: previous7,
      folders: [],
      count: previous7.length,
    },
    { id: 'older', label: 'Older', sessions: older, folders: [], count: older.length },
    {
      id: 'archive',
      label: 'Archived / Folders',
      sessions: [],
      folders: archiveFolders,
      count: archiveCount,
    },
  ];
  return groups;
}

export function originLabel(origin: string | null | undefined): string {
  switch (origin) {
    case 'frieren_popover':
      return 'FRIEREN';
    case 'knight_run':
      return 'KNIGHT_RUN';
    case 'hermes_view':
      return 'HERMES';
    default:
      return origin ? String(origin).toUpperCase() : 'HERMES';
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Compact local timestamp for rail rows and message headers. */
export function formatActivityTime(iso: string | null | undefined, now: Date): string {
  if (!iso) return '--:--';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '--:--';
  const d = new Date(ms);
  const dayStart = startOfLocalDay(now);
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (ms >= dayStart && ms < dayStart + 86_400_000) return clock;
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return ms >= dayStart - 7 * 86_400_000 ? `${date.slice(5)} ${clock}` : date;
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export interface ToolCallView {
  toolName: string;
  arguments: unknown;
  autonomyTier: string;
  status: string;
  result?: unknown;
  error?: string;
  undoId?: string;
  approvalId?: string;
}

export interface HermesMessageView {
  /** 0-based index in `messages_json`; the value `turn_index` takes when forking here. */
  index: number;
  id: string;
  role: 'user' | 'assistant' | 'system' | 'other';
  rawRole: string;
  content: string;
  thinking: string;
  toolCalls: ToolCallView[];
  undoIds: string[];
  approvalIds: string[];
  gatewayMode: string | null;
  createdAt: string | null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

export function toToolCallView(raw: unknown): ToolCallView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const toolName = typeof r.tool_name === 'string' ? r.tool_name : typeof r.name === 'string' ? r.name : '';
  if (!toolName) return null;
  const resultObj = r.result && typeof r.result === 'object' ? (r.result as Record<string, unknown>) : null;
  const error =
    typeof r.error === 'string'
      ? r.error
      : resultObj && typeof resultObj.error === 'string'
        ? resultObj.error
        : undefined;
  return {
    toolName,
    arguments: r.arguments ?? {},
    autonomyTier: typeof r.autonomy_tier === 'string' ? r.autonomy_tier : 'READ',
    status: typeof r.status === 'string' ? r.status : 'unknown',
    result: r.result ?? undefined,
    error,
    undoId: typeof r.undo_id === 'string' && r.undo_id ? r.undo_id : undefined,
    approvalId: typeof r.approval_id === 'string' && r.approval_id ? r.approval_id : undefined,
  };
}

/** Normalises `messages_json` (untyped JSON from the session index) into renderable turns. */
export function readSessionMessages(
  session: { messages_json?: unknown; messages?: unknown } | null | undefined,
): HermesMessageView[] {
  const raw = Array.isArray(session?.messages_json)
    ? (session?.messages_json as unknown[])
    : Array.isArray(session?.messages)
      ? (session?.messages as unknown[])
      : [];
  const out: HermesMessageView[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const m = entry as Record<string, unknown>;
    const rawRole = typeof m.role === 'string' ? m.role : 'assistant';
    const role =
      rawRole === 'user' || rawRole === 'assistant' || rawRole === 'system' ? rawRole : 'other';
    const content = typeof m.content === 'string' ? m.content : m.content == null ? '' : String(m.content);
    const toolCalls = Array.isArray(m.tool_calls)
      ? m.tool_calls.map(toToolCallView).filter((t): t is ToolCallView => t !== null)
      : [];
    out.push({
      index,
      id: typeof m.id === 'string' && m.id ? m.id : `idx-${index}`,
      role,
      rawRole,
      content,
      thinking: typeof m.thinking === 'string' ? m.thinking : '',
      toolCalls,
      undoIds: asStringArray(m.undo_ids),
      approvalIds: asStringArray(m.approval_ids),
      gatewayMode: typeof m.gateway_mode === 'string' ? m.gateway_mode : null,
      createdAt: typeof m.created_at === 'string' ? m.created_at : null,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// `/mcp` action cards: the backend sends no `summary`, so the text is built here
// ---------------------------------------------------------------------------

export interface ToolHeadline {
  domain: string;
  action: string;
}

export function humanizeToolName(toolName: string): ToolHeadline {
  const clean = String(toolName || '').trim();
  if (!clean) return { domain: 'MCP', action: 'TOOL' };
  const sep = clean.search(/[_.]/);
  if (sep <= 0) return { domain: 'MCP', action: clean.toUpperCase() };
  return {
    domain: clean.slice(0, sep).toUpperCase(),
    action: clean
      .slice(sep + 1)
      .replace(/[_.]+/g, ' ')
      .toUpperCase(),
  };
}

const SALIENT_KEYS = [
  'title',
  'name',
  'symbol',
  'ticker',
  'slug',
  'label',
  'task_id',
  'routine_id',
  'goal_id',
  'course_id',
  'asset_id',
  'dashboard_id',
  'id',
  'status',
  'priority',
  'quantity',
  'amount_cents',
  'target_weight_pct',
];

function formatScalar(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
    return `"${t.length > 48 ? `${t.slice(0, 45)}…` : t}"`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

/** One-line digest of a tool payload: salient keys first, then other scalars, at most `limit`. */
export function summarizePayload(payload: unknown, limit = 4): string {
  if (payload == null) return 'no arguments';
  if (typeof payload !== 'object') return formatScalar(payload) ?? 'no arguments';
  if (Array.isArray(payload)) return `${payload.length} item${payload.length === 1 ? '' : 's'}`;
  const obj = payload as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return 'no arguments';
  const ordered = [
    ...SALIENT_KEYS.filter((k) => k in obj),
    ...keys.filter((k) => !SALIENT_KEYS.includes(k)),
  ];
  const parts: string[] = [];
  let nested = 0;
  for (const key of ordered) {
    const formatted = formatScalar(obj[key]);
    if (formatted === null) {
      if (obj[key] !== null && obj[key] !== undefined) nested += 1;
      continue;
    }
    if (parts.length < limit) parts.push(`${key}=${formatted}`);
  }
  const shown = parts.length;
  const scalarTotal = ordered.filter((k) => formatScalar(obj[k]) !== null).length;
  const hidden = scalarTotal - shown + nested;
  if (parts.length === 0) return `${keys.length} field${keys.length === 1 ? '' : 's'}`;
  return hidden > 0 ? `${parts.join(' · ')} · +${hidden} more` : parts.join(' · ');
}

export function describeUndoTarget(
  entityTable: string | null | undefined,
  entityId: string | null | undefined,
): string {
  const table = (entityTable ?? '').trim();
  const id = (entityId ?? '').trim();
  if (!table && !id) return 'reversible write';
  const shortId = id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
  if (table && id) return `${table} #${shortId}`;
  return table || `#${shortId}`;
}

/** `mm:ss` left in an undo window, or `null` once it has closed. */
export function formatCountdown(expiresAtIso: string | null | undefined, nowMs: number): string | null {
  if (!expiresAtIso) return null;
  const expMs = Date.parse(expiresAtIso);
  if (Number.isNaN(expMs)) return null;
  const left = Math.floor((expMs - nowMs) / 1000);
  if (left <= 0) return null;
  return `${pad2(Math.floor(left / 60))}:${pad2(left % 60)}`;
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2) ?? '{}';
  } catch {
    return String(value);
  }
}

export type PayloadEditResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Validates the `[✎ Edit]` buffer: it must be a JSON object, as tool arguments are. */
export function parseEditedPayload(text: string): PayloadEditResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Payload is empty. Enter a JSON object.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'parse error';
    return { ok: false, error: `Invalid JSON: ${detail}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Payload must be a JSON object ({ … }).' };
  }
  return { ok: true, value: parsed };
}

// ---------------------------------------------------------------------------
// Source & Tool Inspector: cited Vault notes
// ---------------------------------------------------------------------------

const QUOTED_NOTE_PATH_RE = /(?:\(|\[\[|`)((?:[\w .-]+\/)+[\w .-]+\.md)(?=[)\]`]|\]\])/g;
const BARE_NOTE_PATH_RE = /(?:@vault:|^|\s)((?:[\w.-]+\/)+[\w.-]+\.md|[\w.-]+\.md)(?=$|[\s)\]`,;:!?])/gm;

function isSafeRelativeNotePath(path: string): boolean {
  if (!path || path.length > 240) return false;
  if (path.startsWith('/') || path.includes('\\') || path.includes('://') || path.includes('..')) {
    return false;
  }
  return !path
    .split('/')
    .some((seg) => seg === '..' || seg === '.' || seg.startsWith('.') || !seg.trim());
}

/**
 * Vault-relative Markdown paths a conversation cites: `@vault:<path>` scopes, the
 * `[VAULT NOTE: Title (path)]` grounding blocks of the gateway, wiki-links and bare `Folder/note.md`.
 */
export function extractCitedNotePaths(texts: readonly string[]): string[] {
  const found: string[] = [];
  const pushIfValid = (raw: string) => {
    const path = raw.trim();
    if (isSafeRelativeNotePath(path) && !found.includes(path)) {
      found.push(path);
    }
  };
  for (const text of texts) {
    if (!text) continue;
    QUOTED_NOTE_PATH_RE.lastIndex = 0;
    let match: RegExpExecArray | null = QUOTED_NOTE_PATH_RE.exec(text);
    while (match) {
      pushIfValid(match[1] ?? '');
      match = QUOTED_NOTE_PATH_RE.exec(text);
    }
    BARE_NOTE_PATH_RE.lastIndex = 0;
    match = BARE_NOTE_PATH_RE.exec(text);
    while (match) {
      pushIfValid(match[1] ?? '');
      match = BARE_NOTE_PATH_RE.exec(text);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Distill to Vault Inbox
// ---------------------------------------------------------------------------

export function transcriptToMarkdown(
  title: string,
  sessionKey: string,
  messages: readonly Pick<HermesMessageView, 'role' | 'rawRole' | 'content'>[],
): string {
  const lines: string[] = [`# ${title}`, '', `> Distilled from Hermes session \`${sessionKey}\`.`, ''];
  for (const message of messages) {
    if (message.role === 'system') continue;
    const who = message.role === 'user' ? 'Operator' : message.role === 'assistant' ? 'Hermes' : message.rawRole;
    lines.push(`## ${who}`, '', message.content.trim(), '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/** Session key for a session started in the full Hermes view. */
export function newHermesSessionKey(): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `sess_${cryptoObj.randomUUID().replace(/-/g, '')}`;
  }
  const rand = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `sess_${Date.now().toString(16)}${rand()}${rand()}`;
}
