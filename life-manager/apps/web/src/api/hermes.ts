/**
 * Typed bindings for the Hermes Chat Workspace (`/hermes`, module 04):
 * `/api/hermes/*` sessions + gateway health, `/api/mcp/*` approvals + undo,
 * `/api/vault/*` notes + distill, and `/api/agents` (profile / Knight selector).
 *
 * Wire shapes are the Rust DTOs in `backend/crates/domain/src/hermes.rs`; the TypeScript
 * types are imported (type-only) from the generated `@hermes/api-client`.
 * Requests go through the local `client.ts` wrapper so that tests can spy on `fetch(url, init)`.
 */
import type {
  AgentWithTelemetry,
  DistillVaultResponse,
  HermesChatMessage,
  HermesSession,
  McpUndoAction,
  PendingMcpApproval,
  VaultNoteDetail,
  VaultNoteSummary,
} from '@hermes/api-client';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, unwrapList } from './client';

export type HermesSessionDto = HermesSession;
export type HermesMessageDto = HermesChatMessage;
export type PendingMcpApprovalDto = PendingMcpApproval;
export type McpUndoActionDto = McpUndoAction;
export type VaultNoteSummaryDto = VaultNoteSummary;
export type VaultNoteDetailDto = VaultNoteDetail;
export type DistillVaultResponseDto = DistillVaultResponse;
export type AgentProfileDto = Pick<
  AgentWithTelemetry,
  'id' | 'slug' | 'name' | 'knight_archetype' | 'hermes_profile' | 'is_paused'
>;

export type HermesSessionOrigin = HermesSession['origin'];

export interface HermesGatewayHealth {
  status: string;
  hermes_gateway: 'online' | 'offline_mock' | string;
  gateway_url?: string;
}

/** Result of `POST /api/mcp/approvals/{id}/approve`: the approval row plus the executed tool result. */
export interface ApproveMcpActionResult extends PendingMcpApproval {
  result?: {
    status?: string;
    tool_name?: string;
    autonomy_tier?: string;
    undo_id?: string | null;
    expires_at?: string | null;
    result?: unknown;
  } | null;
}

export interface UndoMcpActionResult extends McpUndoAction {
  reverted?: boolean;
}

function sessionPath(sessionKey: string): string {
  return `/api/hermes/sessions/${encodeURIComponent(sessionKey)}`;
}

function withQuery(path: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Human-readable text for any failure of the calls below (server `message` wins over the error code). */
export function describeApiError(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    const body = err.body;
    const serverMessage =
      body && typeof body === 'object' && typeof body.message === 'string' && body.message.trim()
        ? body.message.trim()
        : err.message;
    const text = serverMessage || fallback;
    return err.status ? `${text} (HTTP ${err.status})` : text;
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'Request aborted';
    if (err instanceof TypeError) return `Backend unreachable — ${err.message || 'network error'}`;
    return err.message || fallback;
  }
  return fallback;
}

export function apiErrorStatus(err: unknown): number | null {
  return err instanceof ApiError ? err.status : null;
}

// ---------------------------------------------------------------------------
// Sessions (`hermes_sessions_index`, unified X-Hermes-Session-Key store)
// ---------------------------------------------------------------------------

export interface ListHermesSessionsParams {
  /** Full-text query: title, key, folder, profile, last preview and message bodies. */
  q?: string;
  archived?: boolean;
  pinned?: boolean;
  origin?: HermesSessionOrigin;
  limit?: number;
}

export async function listHermesSessions(
  params: ListHermesSessionsParams = {},
): Promise<HermesSessionDto[]> {
  const res = await apiGet<unknown>(
    withQuery('/api/hermes/sessions', {
      q: params.q?.trim() || undefined,
      archived: params.archived,
      pinned: params.pinned,
      origin: params.origin,
      limit: params.limit,
    }),
  );
  return unwrapList<HermesSessionDto>(res, ['sessions']).filter(
    (s) => s && typeof s === 'object' && typeof s.session_key === 'string',
  );
}

/** `null` when the session does not exist yet (404); any other failure throws. */
export async function getHermesSession(sessionKey: string): Promise<HermesSessionDto | null> {
  try {
    const res = await apiGet<any>(sessionPath(sessionKey));
    const record = res && typeof res === 'object' && res.data && !res.session_key ? res.data : res;
    return record && typeof record === 'object' ? (record as HermesSessionDto) : null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export interface CreateHermesSessionBody {
  session_key?: string;
  title?: string;
  origin?: HermesSessionOrigin;
  profile_slug?: string | null;
  pinned?: boolean;
  high_level_mode?: boolean;
  folder_name?: string | null;
}

export function createHermesSession(body: CreateHermesSessionBody): Promise<HermesSessionDto> {
  return apiPost<HermesSessionDto>('/api/hermes/sessions', body);
}

export interface UpdateHermesSessionBody {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  folder_name?: string;
  high_level_mode?: boolean;
  profile_slug?: string;
}

export function updateHermesSession(
  sessionKey: string,
  patch: UpdateHermesSessionBody,
): Promise<HermesSessionDto> {
  return apiPatch<HermesSessionDto>(sessionPath(sessionKey), patch);
}

export function deleteHermesSession(
  sessionKey: string,
): Promise<{ session_key: string; deleted: boolean }> {
  return apiDelete(sessionPath(sessionKey));
}

export interface ForkHermesSessionBody {
  title?: string;
  /** 0-based index of the last message kept in the branch (`0..=turn_index`). */
  turn_index?: number;
  new_session_key?: string;
}

export function forkHermesSession(
  sessionKey: string,
  body: ForkHermesSessionBody = {},
): Promise<HermesSessionDto> {
  return apiPost<HermesSessionDto>(`${sessionPath(sessionKey)}/fork`, body);
}

export function getHermesGatewayHealth(): Promise<HermesGatewayHealth> {
  return apiGet<HermesGatewayHealth>('/api/hermes/health');
}

// ---------------------------------------------------------------------------
// Tiered `/mcp` write autonomy: approvals (REQUIRE_APPROVAL) and undo (IMMEDIATE_UNDO)
// ---------------------------------------------------------------------------

export async function listMcpApprovals(
  params: { sessionKey?: string; status?: 'pending' | 'approved' | 'rejected' } = {},
): Promise<PendingMcpApprovalDto[]> {
  const res = await apiGet<unknown>(
    withQuery('/api/mcp/approvals', { session_key: params.sessionKey, status: params.status }),
  );
  return unwrapList<PendingMcpApprovalDto>(res, ['approvals']);
}

/**
 * Approves a pending write. An edited payload is sent under `payload_json`; the backend merges
 * object keys onto the stored payload. If the tool fails the request rejects and the approval
 * stays `pending`.
 */
export function approveMcpAction(
  approvalId: string,
  editedPayload?: unknown,
): Promise<ApproveMcpActionResult> {
  return apiPost<ApproveMcpActionResult>(
    `/api/mcp/approvals/${encodeURIComponent(approvalId)}/approve`,
    editedPayload === undefined ? {} : { payload_json: editedPayload },
  );
}

export function rejectMcpAction(approvalId: string): Promise<PendingMcpApprovalDto> {
  return apiPost<PendingMcpApprovalDto>(
    `/api/mcp/approvals/${encodeURIComponent(approvalId)}/reject`,
    {},
  );
}

export async function listMcpUndoActions(sessionKey?: string): Promise<McpUndoActionDto[]> {
  const res = await apiGet<unknown>(withQuery('/api/mcp/undo', { session_key: sessionKey }));
  return unwrapList<McpUndoActionDto>(res, ['undo_actions', 'undos', 'actions']);
}

/** Reverts a low-risk write. A second undo, or one after the 15 min window, answers 409. */
export function undoMcpAction(undoId: string): Promise<UndoMcpActionResult> {
  return apiPost<UndoMcpActionResult>(`/api/mcp/undo/${encodeURIComponent(undoId)}`, {});
}

// ---------------------------------------------------------------------------
// Vault (Obsidian Second Brain): cited notes, `youtube-ai` notes, distill
// ---------------------------------------------------------------------------

export async function listVaultNotes(
  params: { q?: string; folder?: string; limit?: number } = {},
): Promise<VaultNoteSummaryDto[]> {
  const res = await apiGet<unknown>(
    withQuery('/api/vault/notes', {
      q: params.q?.trim() || undefined,
      folder: params.folder,
      limit: params.limit,
    }),
  );
  return unwrapList<VaultNoteSummaryDto>(res, ['notes', 'items']);
}

/** Rejects with 400 (invalid path), 403 (escapes the vault) or 404 (missing note). */
export function getVaultNote(path: string): Promise<VaultNoteDetailDto> {
  return apiGet<VaultNoteDetailDto>(withQuery('/api/vault/note', { path }));
}

export interface DistillToVaultBody {
  title: string;
  content_md: string;
  tags?: string[];
  session_key?: string;
}

/** Writes `Inbox/<date>-<slug>.md`; answers `{ vault_note_path, title, created_at }`. */
export function distillToVault(body: DistillToVaultBody): Promise<DistillVaultResponseDto> {
  return apiPost<DistillVaultResponseDto>('/api/vault/distill', body);
}

// ---------------------------------------------------------------------------
// Agent Knights (profile / Knight selector)
// ---------------------------------------------------------------------------

export async function listAgentProfiles(): Promise<AgentProfileDto[]> {
  const res = await apiGet<unknown>('/api/agents');
  return unwrapList<AgentProfileDto>(res, ['agents']).filter(
    (a) => a && typeof a === 'object' && typeof a.name === 'string',
  );
}
