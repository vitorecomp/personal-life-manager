import type {
  CompanionApprovalRequest,
  CompanionNudge,
  CompanionUndoAction,
} from '@hermes/ui';
import type { MobileSqliteEngine, SyncPullChangeEntry } from '../db/sqliteEngine';

export interface UplinkProbeResult {
  online: boolean;
  authenticated: boolean;
  activeUrl: string;
  activeRole: 'PRIMARY' | 'FALLBACK' | 'NONE';
  latencyMs: number | null;
  latestServerSeq: number;
  tokenName: string | null;
  statusCode: number | null;
  error: string | null;
}

export interface DeltaSyncResult {
  success: boolean;
  pushedCount: number;
  pulledCount: number;
  conflictsResolved: number;
  latestServerSeq: number;
  activeUrl: string;
  statusCode: number | null;
  error: string | null;
}

export function normalizeBaseUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 2500,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes `primary_server_url/api/auth/verify` first and automatically fails over to
 * `fallback_server_url/api/auth/verify` on network error, timeout, or non-200 status.
 */
export async function probeAndVerifyUplink(
  engine: MobileSqliteEngine,
  options?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<UplinkProbeResult> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? 2500;
  const cfg = engine.getUplinkConfig();
  const decryptedPat = engine.getDecryptedPat();

  const candidates: Array<{ role: 'PRIMARY' | 'FALLBACK'; url: string }> = [];
  const primary = normalizeBaseUrl(cfg.primary_server_url);
  const fallback = normalizeBaseUrl(cfg.fallback_server_url);
  if (primary) {
    candidates.push({ role: 'PRIMARY', url: primary });
  }
  if (fallback && fallback !== primary) {
    candidates.push({ role: 'FALLBACK', url: fallback });
  }

  let lastStatus: number | null = null;
  let lastError: string | null = null;

  for (const candidate of candidates) {
    const t0 = Date.now();
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (decryptedPat) {
        headers.Authorization = `Bearer ${decryptedPat}`;
      }

      const res = await fetchWithTimeout(
        `${candidate.url}/api/auth/verify`,
        {
          method: 'GET',
          headers,
        },
        timeoutMs,
        fetchImpl,
      );
      const latencyMs = Math.max(1, Date.now() - t0);
      lastStatus = res.status;

      if (res.status === 200) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const latestSeq = Number(body.latest_server_seq ?? cfg.last_server_seq ?? 0);
        const nowIso = new Date().toISOString();
        engine.saveUplinkConfig({
          activeServerUrl: candidate.url,
          uplinkStatus: 'online',
          lastLatencyMs: latencyMs,
          lastVerifiedAt: nowIso,
          lastServerSeq: latestSeq,
        });
        return {
          online: true,
          authenticated: Boolean(body.authenticated ?? true),
          activeUrl: candidate.url,
          activeRole: candidate.role,
          latencyMs,
          latestServerSeq: latestSeq,
          tokenName: body.token_name ? String(body.token_name) : null,
          statusCode: 200,
          error: null,
        };
      }

      if (res.status === 401) {
        lastError = '401 Unauthorized — Personal Access Token missing, invalid, or revoked';
      } else {
        lastError = `HTTP ${res.status} on ${candidate.url}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Network unreachable';
    }
  }

  engine.saveUplinkConfig({
    uplinkStatus: lastStatus === 401 ? 'auth_error' : 'offline',
  });

  return {
    online: false,
    authenticated: false,
    activeUrl: normalizeBaseUrl(cfg.active_server_url || cfg.primary_server_url),
    activeRole: 'NONE',
    latencyMs: null,
    latestServerSeq: cfg.last_server_seq,
    tokenName: null,
    statusCode: lastStatus,
    error: lastError ?? 'All uplink endpoints unreachable',
  };
}

/**
 * Executes bidirectional Delta Sync with automatic Primary -> Fallback URL failover:
 * 1. Tries deduplicated `[primary_server_url, fallback_server_url, active_server_url]`
 * 2. Drains `sync_outbox` in topological FK order via `POST /api/sync/push`
 * 3. Pulls monotonic server changes across all pages (`has_more` / `next_seq`) via `GET /api/sync/pull?since={cursor}`
 */
export async function runDeltaSync(
  engine: MobileSqliteEngine,
  options?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    maxPullPages?: number;
  },
): Promise<DeltaSyncResult> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? 4000;
  const maxPullPages = Math.max(1, options?.maxPullPages ?? 50);
  const cfg = engine.getUplinkConfig();
  const decryptedPat = engine.getDecryptedPat();

  const candidates: string[] = [];
  for (const rawCandidate of [
    cfg.primary_server_url,
    cfg.fallback_server_url,
    cfg.active_server_url,
  ]) {
    const normalized = normalizeBaseUrl(rawCandidate);
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  }

  if (candidates.length === 0) {
    return {
      success: false,
      pushedCount: 0,
      pulledCount: 0,
      conflictsResolved: 0,
      latestServerSeq: cfg.last_server_seq,
      activeUrl: '',
      statusCode: null,
      error: 'No server URL configured',
    };
  }

  const pushHeaders: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const pullHeaders: Record<string, string> = {
    Accept: 'application/json',
  };
  if (decryptedPat) {
    pushHeaders.Authorization = `Bearer ${decryptedPat}`;
    pullHeaders.Authorization = `Bearer ${decryptedPat}`;
  }

  engine.saveUplinkConfig({ uplinkStatus: 'syncing' });

  const outbox = engine.getOutboxMutations();
  const mutationIds = outbox.map((m) => m.mutation_id);
  let pushCompleted = outbox.length === 0;

  let pushedCount = 0;
  let conflictsResolved = 0;
  let totalPulledCount = 0;
  let latestSeq = cfg.last_server_seq;
  let lastAttemptedUrl = candidates[0]!;
  let lastStatusCode: number | null = null;
  let lastError: string | null = null;

  for (const candidateUrl of candidates) {
    lastAttemptedUrl = candidateUrl;

    // Step 1: Push pending sync_outbox mutations (if not yet acknowledged on an earlier candidate)
    if (!pushCompleted) {
      try {
        const pushRes = await fetchWithTimeout(
          `${candidateUrl}/api/sync/push`,
          {
            method: 'POST',
            headers: pushHeaders,
            body: JSON.stringify({
              client_id: cfg.client_id,
              mutations: outbox.map((m) => ({
                mutation_id: m.mutation_id,
                entity_table: m.entity_table,
                entity_id: m.entity_id,
                op: m.op,
                payload: m.payload,
                client_updated_at: m.client_updated_at,
              })),
            }),
          },
          timeoutMs,
          fetchImpl,
        );

        if (pushRes.status !== 200 && pushRes.status !== 201) {
          lastStatusCode = pushRes.status;
          lastError = `Push failed with HTTP ${pushRes.status}`;
          if (pushRes.status >= 500) {
            // 5xx (500, 502, 503, 504): fail over to next candidate URL if available
            continue;
          }
          // 400 / 401 / 4xx: terminal client or auth error, do not fail over
          break;
        }

        const pushBody = (await pushRes.json().catch(() => ({}))) as Record<string, unknown>;
        pushedCount = Number(pushBody.applied_count ?? outbox.length);
        conflictsResolved = Number(pushBody.conflicts_resolved ?? 0);
        const pushSeq = Number(
          pushBody.server_seq ?? pushBody.current_server_seq ?? latestSeq,
        );
        if (Number.isFinite(pushSeq) && pushSeq > latestSeq) {
          latestSeq = pushSeq;
        }

        engine.acknowledgeOutboxMutations(mutationIds, latestSeq);
        pushCompleted = true;
      } catch (err) {
        lastStatusCode = null;
        lastError = err instanceof Error ? err.message : 'Network error during push';
        continue;
      }
    }

    // Step 2: Pull delta changes across all pages (`has_more` & `next_seq`)
    let cursor = engine.getUplinkConfig().last_server_seq;
    let pullRetriableError = false;
    let pullTerminalError = false;

    try {
      for (let page = 0; page < maxPullPages; page += 1) {
        const pullRes = await fetchWithTimeout(
          `${candidateUrl}/api/sync/pull?since=${cursor}`,
          {
            method: 'GET',
            headers: pullHeaders,
          },
          timeoutMs,
          fetchImpl,
        );

        if (pullRes.status !== 200) {
          lastStatusCode = pullRes.status;
          lastError = `Pull failed with HTTP ${pullRes.status}`;
          if (pullRes.status >= 500) {
            pullRetriableError = true;
          } else {
            pullTerminalError = true;
          }
          break;
        }

        const pullBody = (await pullRes.json().catch(() => ({}))) as Record<string, unknown>;
        const changes = Array.isArray(pullBody.changes)
          ? (pullBody.changes as SyncPullChangeEntry[])
          : [];
        const hasMore = Boolean(pullBody.has_more);
        const rawNextSeq =
          pullBody.next_seq !== undefined && pullBody.next_seq !== null
            ? Number(pullBody.next_seq)
            : Number.NaN;
        const rawLatestSeq =
          pullBody.latest_server_seq !== undefined && pullBody.latest_server_seq !== null
            ? Number(pullBody.latest_server_seq)
            : Number.NaN;

        if (hasMore) {
          const pageSeq = Number.isFinite(rawNextSeq) ? rawNextSeq : cursor;
          totalPulledCount += engine.applyPulledChanges(changes, pageSeq);
          if (!Number.isFinite(rawNextSeq) || rawNextSeq <= cursor) {
            const fallbackSeq = Number.isFinite(rawLatestSeq) ? rawLatestSeq : pageSeq;
            if (fallbackSeq > latestSeq) {
              latestSeq = fallbackSeq;
            }
            break;
          }
          cursor = rawNextSeq;
          if (cursor > latestSeq) {
            latestSeq = cursor;
          }
          engine.saveUplinkConfig({ lastServerSeq: cursor });
        } else {
          const finalSeq = Number.isFinite(rawLatestSeq)
            ? rawLatestSeq
            : Number.isFinite(rawNextSeq)
              ? rawNextSeq
              : Math.max(latestSeq, cursor);
          if (finalSeq > latestSeq) {
            latestSeq = finalSeq;
          }
          totalPulledCount += engine.applyPulledChanges(changes, latestSeq);
          break;
        }
      }
    } catch (err) {
      lastStatusCode = null;
      lastError = err instanceof Error ? err.message : 'Network error during pull';
      pullRetriableError = true;
    }

    if (pullRetriableError) {
      continue;
    }
    if (pullTerminalError) {
      break;
    }

    const nowIso = new Date().toISOString();
    engine.saveUplinkConfig({
      activeServerUrl: candidateUrl,
      uplinkStatus: 'online',
      lastVerifiedAt: nowIso,
      lastServerSeq: latestSeq,
      lastSyncAt: nowIso,
    });

    return {
      success: true,
      pushedCount,
      pulledCount: totalPulledCount,
      conflictsResolved,
      latestServerSeq: latestSeq,
      activeUrl: candidateUrl,
      statusCode: 200,
      error: null,
    };
  }

  // Record outbox failure at most ONCE per runDeltaSync invocation
  if (!pushCompleted && mutationIds.length > 0) {
    engine.recordOutboxFailure(mutationIds, lastError ?? 'Delta sync push failed');
  }
  engine.saveUplinkConfig({ uplinkStatus: 'offline' });

  return {
    success: false,
    pushedCount: pushCompleted ? pushedCount : 0,
    pulledCount: totalPulledCount,
    conflictsResolved: pushCompleted ? conflictsResolved : 0,
    latestServerSeq: latestSeq,
    activeUrl: lastAttemptedUrl,
    statusCode: lastStatusCode,
    error: lastError ?? 'All sync endpoints unreachable',
  };
}

export interface StreamCompanionChatCallbacks {
  onThinking?: (thinkingText: string, gatewayMode: 'online' | 'offline_mock') => void;
  onToken?: (delta: string, accumulated: string) => void;
  onUndoAvailable?: (undo: CompanionUndoAction) => void;
  onApprovalRequired?: (approval: CompanionApprovalRequest) => void;
  onDone?: (finalMessage: string, gatewayMode: 'online' | 'offline_mock') => void;
}

/**
 * Streams a live chat turn with Frieren (`POST /api/hermes/chat/stream`) using
 * `X-Hermes-Session-Key` and `origin: 'frieren_popover'`.
 */
export async function streamCompanionChat(options: {
  activeUrl: string;
  decryptedPat: string;
  sessionKey: string;
  message: string;
  activeRoute?: string;
  entityIds?: string[];
  fetchImpl?: typeof fetch;
  callbacks?: StreamCompanionChatCallbacks;
}): Promise<{
  finalMessage: string;
  thinkingText: string;
  gatewayMode: 'online' | 'offline_mock';
  undoActions: CompanionUndoAction[];
  pendingApprovals: CompanionApprovalRequest[];
}> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = normalizeBaseUrl(options.activeUrl);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream, application/json',
    'X-Hermes-Session-Key': options.sessionKey,
  };
  if (options.decryptedPat) {
    headers.Authorization = `Bearer ${options.decryptedPat}`;
  }

  const selectedEntityId = options.entityIds?.[0];
  const res = await fetchImpl(`${baseUrl}/api/hermes/chat/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      session_key: options.sessionKey,
      message: options.message,
      origin: 'frieren_popover',
      page_context: {
        active_route: options.activeRoute ?? '/companion',
        entity_ids: options.entityIds ?? [],
        ...(selectedEntityId ? { selected_entity_id: selectedEntityId } : {}),
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Companion chat stream returned HTTP ${res.status}`);
  }

  const rawText = await res.text();
  let finalMessage = '';
  let thinkingText = '';
  let gatewayMode: 'online' | 'offline_mock' = 'online';
  const undoActions: CompanionUndoAction[] = [];
  const pendingApprovals: CompanionApprovalRequest[] = [];

  const blocks = rawText.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    let eventType = '';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    const rawData = dataLines.join('\n');
    if (!rawData) continue;

    try {
      const parsed = JSON.parse(rawData) as Record<string, unknown>;
      const resolvedType = String(parsed.type || eventType || '').toLowerCase();

      if (parsed.gateway_mode === 'offline_mock') {
        gatewayMode = 'offline_mock';
      }

      if (resolvedType === 'thinking') {
        thinkingText = String(parsed.content ?? parsed.thinking ?? thinkingText);
        options.callbacks?.onThinking?.(thinkingText, gatewayMode);
      } else if (resolvedType === 'token') {
        const delta = String(parsed.delta ?? '');
        finalMessage = parsed.content ? String(parsed.content) : `${finalMessage}${delta}`;
        options.callbacks?.onToken?.(delta, finalMessage);
      } else if (resolvedType === 'undo_available') {
        const undo: CompanionUndoAction = {
          undoId: String(parsed.undo_id ?? parsed.id ?? ''),
          toolName: String(parsed.tool_name ?? 'mcp_tool'),
          summary: String(parsed.summary ?? `Reversible ${parsed.tool_name ?? 'action'}`),
        };
        if (undo.undoId) {
          undoActions.push(undo);
          options.callbacks?.onUndoAvailable?.(undo);
        }
      } else if (resolvedType === 'approval_required') {
        const approval: CompanionApprovalRequest = {
          id: String(parsed.approval_id ?? parsed.id ?? ''),
          toolName: String(parsed.tool_name ?? 'mcp_tool'),
          summary: String(parsed.summary ?? `Approval required for ${parsed.tool_name ?? 'tool'}`),
          payloadJson: (parsed.payload_json as Record<string, unknown>) ?? {},
          status: 'pending',
        };
        if (approval.id) {
          pendingApprovals.push(approval);
          options.callbacks?.onApprovalRequired?.(approval);
        }
      } else if (resolvedType === 'done') {
        if (parsed.message) {
          finalMessage = String(parsed.message);
        }
        if (parsed.thinking) {
          thinkingText = String(parsed.thinking);
        }
        options.callbacks?.onDone?.(finalMessage, gatewayMode);
      }
    } catch {
      // Ignore malformed SSE lines
    }
  }

  return {
    finalMessage: finalMessage || 'Spell complete.',
    thinkingText,
    gatewayMode,
    undoActions,
    pendingApprovals,
  };
}

export async function executeMcpUndo(options: {
  activeUrl: string;
  decryptedPat: string;
  undoId: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = normalizeBaseUrl(options.activeUrl);
  const res = await fetchImpl(`${baseUrl}/api/mcp/undo/${encodeURIComponent(options.undoId)}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...(options.decryptedPat ? { Authorization: `Bearer ${options.decryptedPat}` } : {}),
    },
  });
  return res.ok;
}

export async function executeMcpApproval(options: {
  activeUrl: string;
  decryptedPat: string;
  approvalId: string;
  decision: 'approve' | 'reject';
  payloadJson?: Record<string, unknown> | string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = normalizeBaseUrl(options.activeUrl);
  const res = await fetchImpl(
    `${baseUrl}/api/mcp/approvals/${encodeURIComponent(options.approvalId)}/${options.decision}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.decryptedPat ? { Authorization: `Bearer ${options.decryptedPat}` } : {}),
      },
      body:
        options.decision === 'approve' && options.payloadJson
          ? JSON.stringify({
              payload_json:
                typeof options.payloadJson === 'string'
                  ? JSON.parse(options.payloadJson)
                  : options.payloadJson,
            })
          : JSON.stringify({}),
    },
  );
  return res.ok;
}

export async function fetchCompanionNudges(options: {
  activeUrl: string;
  decryptedPat: string;
  fetchImpl?: typeof fetch;
}): Promise<CompanionNudge[]> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = normalizeBaseUrl(options.activeUrl);
  try {
    const res = await fetchImpl(`${baseUrl}/api/companion/nudges`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.decryptedPat ? { Authorization: `Bearer ${options.decryptedPat}` } : {}),
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    const rawList = Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown>)?.nudges)
        ? ((data as Record<string, unknown>).nudges as unknown[])
        : [];
    return rawList.map((item) => {
      const n = item as Record<string, unknown>;
      return {
        id: String(n.id ?? ''),
        title: String(n.title ?? n.category ?? 'NUDGE'),
        message: String(n.message ?? n.detail ?? ''),
        severity: 'info',
      };
    });
  } catch {
    return [];
  }
}

export async function dismissCompanionNudge(options: {
  activeUrl: string;
  decryptedPat: string;
  nudgeId: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = normalizeBaseUrl(options.activeUrl);
  try {
    const res = await fetchImpl(
      `${baseUrl}/api/companion/nudges/${encodeURIComponent(options.nudgeId)}/dismiss`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...(options.decryptedPat ? { Authorization: `Bearer ${options.decryptedPat}` } : {}),
        },
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
