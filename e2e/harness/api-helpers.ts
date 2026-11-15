import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  E2E_PATHS,
  E2E_URLS,
  VAULT_OWNERSHIP_MARKER_FILE,
  assertSafeE2eDataPath,
  getVaultOwnershipInfo,
  registerHarnessOwnedVaultRoot,
} from './env';

export interface ApiResponse<T = any> {
  status: number;
  ok: boolean;
  headers: Headers;
  json: T;
  text: string;
  url: string;
}

export interface SseEventRecord<T = any> {
  event: string;
  data: string;
  id?: string;
  retry?: number;
  parsed?: T;
}

const DEFAULT_LIST_CANDIDATE_KEYS: readonly string[] = [
  'items',
  'data',
  'results',
  'rows',
  'records',
  'entries',
  'dashboards',
  'widgets',
  'servers',
  'nodes',
  'sessions',
  'nudges',
  'phrases',
  'approvals',
  'notes',
  'agents',
  'triggers',
  'runs',
  'agent_runs',
  'queue',
  'projects',
  'tasks',
  'time_sessions',
  'routines',
  'routine_items',
  'routine_logs',
  'blocks',
  'cycles',
  'goals',
  'key_results',
  'checkins',
  'courses',
  'modules',
  'lessons',
  'playlists',
  'reviews',
  'spaced_reviews',
  'assets',
  'candles',
  'plans',
  'monthly_plans',
  'snapshots',
  'tokens',
  'changes',
  'tools',
];

function tryJsonParse(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export class ApiClient {
  public readonly baseUrl: string;
  public readonly bearerToken?: string;
  private cookieHeader?: string;

  constructor(baseUrl?: string, bearerToken?: string, cookieHeader?: string) {
    this.baseUrl = (baseUrl || E2E_URLS.apiBaseUrl).replace(/\/+$/, '');
    this.bearerToken = bearerToken;
    this.cookieHeader = cookieHeader;
  }

  public withToken(bearerToken?: string): ApiClient {
    return new ApiClient(this.baseUrl, bearerToken, this.cookieHeader);
  }

  public withCookie(cookieHeader?: string): ApiClient {
    return new ApiClient(this.baseUrl, this.bearerToken, cookieHeader);
  }

  public resolveUrl(targetPath: string): string {
    if (/^https?:\/\//i.test(targetPath)) {
      return targetPath;
    }
    const trimmedBase = this.baseUrl.replace(/\/+$/, '');
    const origin = trimmedBase.endsWith('/api') ? trimmedBase.slice(0, -4) : trimmedBase;
    const cleanPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;

    if (
      cleanPath === '/mcp' ||
      cleanPath.startsWith('/mcp/') ||
      cleanPath.startsWith('/mcp?')
    ) {
      return `${origin}${cleanPath}`;
    }

    if (
      cleanPath === '/api' ||
      cleanPath.startsWith('/api/') ||
      cleanPath.startsWith('/api?')
    ) {
      return `${origin}${cleanPath}`;
    }

    return `${origin}/api${cleanPath}`;
  }

  public async raw<T = any>(
    targetPath: string,
    init?: RequestInit & { timeoutMs?: number },
  ): Promise<ApiResponse<T>> {
    const headers = new Headers({ Accept: 'application/json' });

    if (this.bearerToken) {
      headers.set(
        'Authorization',
        this.bearerToken.startsWith('Bearer ')
          ? this.bearerToken
          : `Bearer ${this.bearerToken}`,
      );
    }
    if (this.cookieHeader) {
      headers.set('Cookie', this.cookieHeader);
    }

    if (init?.headers) {
      const overrideEntries =
        init.headers instanceof Headers
          ? Array.from(init.headers.entries())
          : Array.isArray(init.headers)
            ? init.headers
            : Object.entries(init.headers);
      for (const [key, value] of overrideEntries) {
        if (value === undefined) continue;
        if (value === '') {
          headers.delete(key);
        } else {
          headers.set(key, String(value));
        }
      }
    }

    const accept = (headers.get('Accept') ?? '').toLowerCase();
    const trimmedBase = this.baseUrl.replace(/\/+$/, '');
    const origin = trimmedBase.endsWith('/api') ? trimmedBase.slice(0, -4) : trimmedBase;
    const cleanPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
    const isSpaHtmlRequest =
      !(/^https?:\/\//i.test(targetPath)) &&
      !cleanPath.startsWith('/api') &&
      !cleanPath.startsWith('/mcp') &&
      (accept.includes('text/html') ||
        cleanPath === '/' ||
        cleanPath === '/dashboard' ||
        cleanPath === '/monitor');
    const url = isSpaHtmlRequest
      ? `${origin}${cleanPath}`
      : this.resolveUrl(targetPath);

    const timeoutMs = init?.timeoutMs ?? 15_000;
    const signal = init?.signal ?? AbortSignal.timeout(timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers,
        signal,
      });
    } catch (err: any) {
      const method = (init?.method ?? 'GET').toUpperCase();
      const msg = String(err?.cause?.code || err?.code || err?.message || err);
      const sharedOrigin = E2E_URLS.baseUrl.replace(/\/+$/, '');
      if (
        method === 'DELETE' &&
        (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) &&
        origin !== sharedOrigin &&
        !(/^https?:\/\//i.test(targetPath))
      ) {
        const fallbackUrl = url.replace(origin, sharedOrigin);
        res = await fetch(fallbackUrl, {
          ...init,
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } else {
        throw err;
      }
    }

    const text = await res.text();
    const json = tryJsonParse(text) as T;

    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      json,
      text,
      url,
    };
  }

  public async get<T = any>(
    targetPath: string,
    headers?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    return this.raw<T>(targetPath, { method: 'GET', headers });
  }

  public async post<T = any>(
    targetPath: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    const mergedHeaders: Record<string, string> = {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {}),
    };
    return this.raw<T>(targetPath, {
      method: 'POST',
      headers: mergedHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public async put<T = any>(
    targetPath: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    const mergedHeaders: Record<string, string> = {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {}),
    };
    return this.raw<T>(targetPath, {
      method: 'PUT',
      headers: mergedHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public async patch<T = any>(
    targetPath: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    const mergedHeaders: Record<string, string> = {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {}),
    };
    return this.raw<T>(targetPath, {
      method: 'PATCH',
      headers: mergedHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public async delete<T = any>(
    targetPath: string,
    headers?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    return this.raw<T>(targetPath, { method: 'DELETE', headers });
  }
}

export function createApiClient(baseUrl?: string, bearerToken?: string): ApiClient {
  return new ApiClient(baseUrl, bearerToken);
}

export function unwrapList<T = any>(payload: any, candidateKeys?: string[]): T[] {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload as T[];
  if (typeof payload !== 'object') return [];

  if (
    'status' in payload &&
    'ok' in payload &&
    'json' in payload &&
    payload.headers instanceof Headers
  ) {
    return unwrapList<T>(payload.json, candidateKeys);
  }

  const keysToTry = [
    ...(candidateKeys || []),
    ...DEFAULT_LIST_CANDIDATE_KEYS,
  ];
  for (const key of keysToTry) {
    if (key in payload && Array.isArray(payload[key])) {
      return payload[key] as T[];
    }
  }

  const arrayValues = Object.values(payload).filter(Array.isArray);
  if (arrayValues.length === 1) {
    return arrayValues[0] as T[];
  }

  return [];
}

let uniqueCounter = 0;

export function uniqueId(prefix: string): string {
  uniqueCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uniqueCounter.toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

export async function createPatToken(
  api: ApiClient,
  name: string = uniqueId('e2e-pat'),
): Promise<{ id: string; token: string; tokenPrefix?: string }> {
  let res = await api.post('/api/auth/tokens', { name });

  if (res.status === 401) {
    const loginRes = await api.post('/api/auth/login', {
      username: process.env.HERMES_ADMIN_USER || 'operator',
      password: process.env.HERMES_ADMIN_PASSWORD || 'hermes-os-local',
    });
    if (loginRes.ok) {
      const setCookies =
        typeof (loginRes.headers as any).getSetCookie === 'function'
          ? ((loginRes.headers as any).getSetCookie() as string[])
          : loginRes.headers.get('set-cookie')
            ? [loginRes.headers.get('set-cookie')!]
            : [];
      const cookiePairs = setCookies
        .map((c) => c.split(';')[0]?.trim())
        .filter(Boolean)
        .join('; ');
      const sessionBearer =
        loginRes.json?.token || loginRes.json?.access_token || loginRes.json?.session_token;
      let authedApi = api;
      if (cookiePairs) {
        authedApi = authedApi.withCookie(cookiePairs);
      }
      if (typeof sessionBearer === 'string' && sessionBearer.length > 0) {
        authedApi = authedApi.withToken(sessionBearer);
      }
      res = await authedApi.post('/api/auth/tokens', { name });
    }
  }

  if (!res.ok || !res.json) {
    throw new Error(
      `Failed to create PAT token "${name}" (HTTP ${res.status}): ${res.text.slice(0, 300)}`,
    );
  }

  const rawData = res.json?.data && typeof res.json.data === 'object' ? res.json.data : res.json;
  const token = rawData.token ?? rawData.plaintext_token ?? rawData.pat;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(
      `POST /api/auth/tokens succeeded (HTTP ${res.status}) but returned no plaintext token: ${res.text.slice(0, 300)}`,
    );
  }

  const id = String(rawData.id ?? rawData.token_id ?? '');
  const tokenPrefix =
    typeof (rawData.token_prefix ?? rawData.tokenPrefix) === 'string'
      ? (rawData.token_prefix ?? rawData.tokenPrefix)
      : undefined;

  return { id, token, tokenPrefix };
}

export async function readSseEvents(
  url: string,
  init?: RequestInit & { maxEvents?: number; timeoutMs?: number; stopOnEvent?: string },
): Promise<Array<{ event: string; data: string; parsed?: any }>> {
  const { maxEvents, timeoutMs = 8_000, stopOnEvent, signal: callerSignal, ...fetchInit } =
    init || {};
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref();

  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  const headers = new Headers(fetchInit.headers || {});
  if (!headers.has('Accept')) {
    headers.set('Accept', 'text/event-stream');
  }

  const events: Array<{ event: string; data: string; id?: string; retry?: number; parsed?: any }> =
    [];

  try {
    const res = await fetch(url, {
      ...fetchInit,
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw Object.assign(new Error(`SSE HTTP ${res.status}: ${errText}`), {
        status: res.status,
        body: errText,
      });
    }

    if (!res.body) {
      return events;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    let currentEvent = 'message';
    let currentDataLines: string[] = [];
    let currentId: string | undefined;
    let currentRetry: number | undefined;
    let hasDataLine = false;

    const resetCurrent = () => {
      currentEvent = 'message';
      currentDataLines = [];
      currentId = undefined;
      currentRetry = undefined;
      hasDataLine = false;
    };

    const flushEvent = (): boolean => {
      if (!hasDataLine) {
        resetCurrent();
        return false;
      }
      const data = currentDataLines.join('\n');
      const record: { event: string; data: string; id?: string; retry?: number; parsed?: any } = {
        event: currentEvent || 'message',
        data,
      };
      if (currentId !== undefined) record.id = currentId;
      if (currentRetry !== undefined) record.retry = currentRetry;
      if (data !== '' && data !== '[DONE]') {
        const parsed = tryJsonParse(data);
        if (parsed !== null) {
          record.parsed = parsed;
        }
      }
      events.push(record);
      const shouldStop =
        (maxEvents !== undefined && events.length >= maxEvents) ||
        (stopOnEvent !== undefined && record.event === stopOnEvent) ||
        data === '[DONE]';
      resetCurrent();
      return shouldStop;
    };

    const processLine = (line: string): boolean => {
      if (line === '') {
        return flushEvent();
      }
      if (line.startsWith(':')) {
        return false;
      }
      const colonIdx = line.indexOf(':');
      const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
      let value = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }

      if (field === 'event') {
        currentEvent = value;
      } else if (field === 'data') {
        hasDataLine = true;
        currentDataLines.push(value);
      } else if (field === 'id') {
        currentId = value;
      } else if (field === 'retry') {
        const n = Number.parseInt(value, 10);
        if (!Number.isNaN(n)) currentRetry = n;
      }
      return false;
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer.length > 0) {
            const tailLines = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
            for (const line of tailLines) {
              if (processLine(line)) break;
            }
          }
          flushEvent();
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let holdTrailingCr = false;
        if (buffer.endsWith('\r')) {
          holdTrailingCr = true;
          buffer = buffer.slice(0, -1);
        }

        const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const parts = normalized.split('\n');
        buffer = (parts.pop() ?? '') + (holdTrailingCr ? '\r' : '');

        let stopped = false;
        for (const line of parts) {
          if (processLine(line)) {
            stopped = true;
            break;
          }
        }
        if (stopped) {
          controller.abort();
          await reader.cancel().catch(() => {});
          break;
        }
      }
    } catch (err: any) {
      if (timedOut || err?.name === 'AbortError') {
        await reader.cancel().catch(() => {});
        return events;
      }
      throw err;
    }

    return events;
  } catch (err: any) {
    if (timedOut && err?.name === 'AbortError') {
      return events;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }
}

export class CleanupRegistry {
  private readonly callbacks: Array<() => unknown | Promise<unknown>> = [];

  public defer(fn: () => unknown | Promise<unknown>): void {
    this.callbacks.push(fn);
  }

  public async runAll(): Promise<void> {
    const errors: unknown[] = [];
    while (this.callbacks.length > 0) {
      const fn = this.callbacks.pop()!;
      try {
        await fn();
      } catch (err: any) {
        const msg = String(err?.message ?? err ?? '');
        const causeCode = String(err?.cause?.code ?? err?.code ?? '');
        if (
          msg.includes('ECONNREFUSED') ||
          msg.includes('ECONNRESET') ||
          causeCode === 'ECONNREFUSED' ||
          causeCode === 'ECONNRESET' ||
          (msg.includes('fetch failed') &&
            (causeCode === 'ECONNREFUSED' ||
              causeCode === 'ECONNRESET' ||
              String(err?.cause ?? '').includes('ECONNREFUSED') ||
              String(err?.cause ?? '').includes('ECONNRESET')))
        ) {
          continue;
        }
        errors.push(err);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `CleanupRegistry encountered ${errors.length} error(s) during teardown.`,
      );
    }
  }
}

const SNAPSHOT_EXISTING_DIRS = new WeakMap<
  Set<string>,
  { rootRealPath: string; dirs: Set<string> }
>();

export function assertSafeCleanupRoot(
  rootDir: string,
  callerLabel: string,
  allowAutoRegisterHarnessPrefix = false,
): { realRoot: string; initialDirs: Set<string> } {
  assertSafeE2eDataPath(rootDir, callerLabel, { requireInsideTmp: true });

  if (!fs.existsSync(rootDir)) {
    throw new Error(
      `[E2E-SAFETY-GUARD] R4: Cleanup root does not exist: "${rootDir}".`,
    );
  }

  if (fs.lstatSync(rootDir).isSymbolicLink()) {
    throw new Error(
      `[E2E-SAFETY-GUARD] R4: Refusing symlinked cleanup root: "${rootDir}".`,
    );
  }

  const realRoot = fs.realpathSync(rootDir);
  const realTmp = fs.realpathSync(os.tmpdir());
  if (!realRoot.startsWith(realTmp + path.sep) || realRoot === realTmp) {
    throw new Error(
      `[E2E-SAFETY-GUARD] R4: Cleanup root "${rootDir}" (resolved to "${realRoot}") must reside inside a subdirectory of os.tmpdir() ("${realTmp}").`,
    );
  }

  if (
    fs.existsSync(path.join(realRoot, '.git')) ||
    fs.existsSync(path.join(realRoot, '.obsidian'))
  ) {
    throw new Error(
      `[E2E-SAFETY-GUARD] R4: Refusing cleanup root containing .git or .obsidian: "${realRoot}".`,
    );
  }

  const ownership = getVaultOwnershipInfo(realRoot);
  if (ownership.owned) {
    return { realRoot, initialDirs: ownership.initialDirs };
  }

  const baseName = path.basename(realRoot);
  if (
    allowAutoRegisterHarnessPrefix &&
    (baseName.startsWith('hermes-e2e-sbtest-') ||
      baseName.startsWith('hermes-e2e-vault-'))
  ) {
    registerHarnessOwnedVaultRoot(realRoot);
    const registered = getVaultOwnershipInfo(realRoot);
    return { realRoot, initialDirs: registered.initialDirs };
  }

  throw new Error(
    `[E2E-SAFETY-GUARD] R4: Refusing unowned cleanup root "${rootDir}" (resolved to "${realRoot}"); cleanup is confined to vault roots created by the harness for this run.`,
  );
}

export function snapshotSecondBrainFiles(rootDir: string = E2E_PATHS.secondBrainDir): Set<string> {
  const { realRoot, initialDirs } = assertSafeCleanupRoot(
    rootDir,
    'snapshotSecondBrainFiles',
    true,
  );
  const snapshot = new Set<string>();
  const existingDirs = new Set<string>(initialDirs);

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.obsidian') {
        throw new Error(
          `[E2E-SAFETY-GUARD] R4: Refusing to snapshot directory containing ${entry.name}: "${dir}".`,
        );
      }
      if (entry.name === VAULT_OWNERSHIP_MARKER_FILE) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      const relPosix = path.relative(realRoot, fullPath).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        snapshot.add(relPosix);
      } else if (entry.isDirectory()) {
        existingDirs.add(relPosix);
        walk(fullPath);
      } else {
        snapshot.add(relPosix);
      }
    }
  };

  walk(realRoot);
  SNAPSHOT_EXISTING_DIRS.set(snapshot, { rootRealPath: realRoot, dirs: existingDirs });
  return snapshot;
}

export function cleanupNewSecondBrainFiles(
  before: Set<string>,
  rootDir: string = E2E_PATHS.secondBrainDir,
): void {
  const { realRoot, initialDirs } = assertSafeCleanupRoot(
    rootDir,
    'cleanupNewSecondBrainFiles',
    false,
  );
  const meta = SNAPSHOT_EXISTING_DIRS.get(before);
  if (meta && meta.rootRealPath !== realRoot) {
    throw new Error(
      `[E2E-SAFETY-GUARD] R4: cleanupNewSecondBrainFiles rootDir "${realRoot}" does not match snapshot rootDir "${meta.rootRealPath}".`,
    );
  }

  const walkPostOrder = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.obsidian') {
        throw new Error(
          `[E2E-SAFETY-GUARD] R4: Refusing to clean directory containing ${entry.name}: "${dir}".`,
        );
      }
      if (entry.name === '.gitkeep' || entry.name === VAULT_OWNERSHIP_MARKER_FILE) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      const relPosix = path.relative(realRoot, fullPath).split(path.sep).join('/');

      if (entry.isSymbolicLink()) {
        if (!before.has(relPosix) && !before.has(fullPath)) {
          try {
            fs.unlinkSync(fullPath);
          } catch {
            // Ignore if already removed
          }
        }
      } else if (entry.isDirectory()) {
        walkPostOrder(fullPath);
        const existedBefore =
          (meta ? meta.dirs.has(relPosix) : true) ||
          initialDirs.has(relPosix) ||
          before.has(relPosix) ||
          before.has(`${relPosix}/`) ||
          before.has(`__dir__:${relPosix}`) ||
          Array.from(before).some((p) => p.startsWith(`${relPosix}/`));

        if (!existedBefore) {
          try {
            const remaining = fs
              .readdirSync(fullPath)
              .filter((name) => name !== VAULT_OWNERSHIP_MARKER_FILE);
            if (remaining.length === 0) {
              fs.rmdirSync(fullPath);
            }
          } catch {
            // Ignore non-empty or concurrent directory cleanup
          }
        }
      } else {
        if (!before.has(relPosix) && !before.has(fullPath)) {
          try {
            fs.unlinkSync(fullPath);
          } catch {
            // Ignore if already removed
          }
        }
      }
    }
  };

  walkPostOrder(realRoot);
}
