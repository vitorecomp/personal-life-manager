import { E2E_URLS } from './env';

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: any;
}

export interface JsonRpcEnvelope<T = any> {
  jsonrpc: string;
  id?: number | string | null;
  result?: T;
  error?: JsonRpcErrorObject;
  method?: string;
  params?: any;
}

export interface McpRawResponse<T = any> {
  status: number;
  ok: boolean;
  headers: Headers;
  sessionId?: string;
  rpc: JsonRpcEnvelope<T> | null;
  notifications: JsonRpcEnvelope[];
  json: any;
  rawText: string;
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, any>;
  outputSchema?: Record<string, any>;
  annotations?: Record<string, any>;
}

export type McpToolList = McpTool[] & {
  tools: McpTool[];
  status: number;
  raw: McpRawResponse;
};

export interface McpToolCallResult<T = any> {
  status: number;
  ok: boolean;
  isError: boolean;
  content: Array<{ type: string; text?: string; [k: string]: any }>;
  structuredContent?: T;
  text: string;
  parsed: T | null;
  undoId?: string;
  approvalId?: string;
  autonomyStatus?: string;
  raw: McpRawResponse;
}

export class McpHttpError extends Error {
  public readonly status: number;
  public readonly headers: Headers;
  public readonly raw: McpRawResponse;

  constructor(message: string, raw: McpRawResponse);
  constructor(message: string, status: number, headers: Headers, raw: McpRawResponse);
  constructor(
    message: string,
    rawOrStatus: McpRawResponse | number,
    headers?: Headers,
    rawArg?: McpRawResponse,
  ) {
    super(message);
    this.name = 'McpHttpError';
    if (typeof rawOrStatus === 'number') {
      this.status = rawOrStatus;
      this.headers = headers ?? new Headers();
      this.raw =
        rawArg ?? {
          status: rawOrStatus,
          ok: rawOrStatus >= 200 && rawOrStatus < 300,
          headers: this.headers,
          rpc: null,
          notifications: [],
          json: null,
          rawText: '',
        };
    } else {
      this.status = rawOrStatus.status;
      this.headers = rawOrStatus.headers;
      this.raw = rawOrStatus;
    }
  }
}

function tryParseJson(str: string): any {
  const trimmed = str.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export class McpClient {
  public readonly mcpUrl: string;
  public readonly bearerToken?: string;
  public sessionId?: string;
  public protocolVersion: string = '2025-03-26';
  public initialized: boolean = false;
  private rpcIdCounter = 0;

  constructor(mcpUrl?: string, bearerToken?: string) {
    this.mcpUrl = (mcpUrl || E2E_URLS.mcpUrl).replace(/\/+$/, '');
    this.bearerToken = bearerToken;
  }

  private nextId(): number {
    this.rpcIdCounter += 1;
    return this.rpcIdCounter;
  }

  private buildHeaders(
    extraHeaders?: Record<string, string>,
    includeProtocolHeader = true,
  ): Headers {
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    });

    if (this.bearerToken) {
      headers.set(
        'Authorization',
        this.bearerToken.startsWith('Bearer ')
          ? this.bearerToken
          : `Bearer ${this.bearerToken}`,
      );
    }

    if (this.sessionId) {
      headers.set('Mcp-Session-Id', this.sessionId);
    }

    if (includeProtocolHeader && this.initialized && this.protocolVersion < '2026-07-28') {
      headers.set('MCP-Protocol-Version', this.protocolVersion);
    }

    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) {
        if (v === '') {
          headers.delete(k);
        } else {
          headers.set(k, v);
        }
      }
    }

    return headers;
  }

  public async sendRawRpc<T = any>(
    payload: unknown,
    extraHeaders?: Record<string, string>,
    options?: { includeProtocolHeader?: boolean; timeoutMs?: number },
  ): Promise<McpRawResponse<T>> {
    const timeoutMs = options?.timeoutMs ?? 15_000;
    let timedOut = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref();

    const requestId =
      payload && typeof payload === 'object' && 'id' in (payload as Record<string, unknown>)
        ? ((payload as Record<string, unknown>).id as number | string | undefined)
        : undefined;

    try {
      const headers = this.buildHeaders(
        extraHeaders,
        options?.includeProtocolHeader ?? true,
      );

      const res = await fetch(this.mcpUrl, {
        method: 'POST',
        headers,
        body: typeof payload === 'string' ? payload : JSON.stringify(payload),
        signal: controller.signal,
      });

      const returnedSessionId = res.headers.get('mcp-session-id') ?? undefined;
      if (returnedSessionId) {
        this.sessionId = returnedSessionId;
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const notifications: JsonRpcEnvelope[] = [];

      if (contentType.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        const rawChunks: string[] = [];
        let rpcResult: JsonRpcEnvelope<T> | null = null;

        let currentEvent = '';
        let currentDataLines: string[] = [];
        let hasDataLine = false;

        const resetBlock = () => {
          currentEvent = '';
          currentDataLines = [];
          hasDataLine = false;
        };

        const flushBlock = (): boolean => {
          if (!hasDataLine) {
            resetBlock();
            return false;
          }
          const data = currentDataLines.join('\n');
          const evType = currentEvent;
          resetBlock();

          // Skip SEP-1699 priming frame (empty data line) emitted by rmcp 3.10.0
          if (data.trim() === '') {
            return false;
          }

          if (evType && evType !== 'message') {
            return false;
          }

          const parsed = tryParseJson(data);
          if (parsed && typeof parsed === 'object') {
            if ('method' in parsed && !('id' in parsed)) {
              notifications.push(parsed as JsonRpcEnvelope);
              return false;
            }
            if ('result' in parsed || 'error' in parsed) {
              if (requestId === undefined || parsed.id === requestId || parsed.id == null) {
                rpcResult = parsed as JsonRpcEnvelope<T>;
                return true;
              }
            }
          }
          return false;
        };

        const processLine = (line: string): boolean => {
          if (line === '') {
            return flushBlock();
          }
          if (line.startsWith(':')) {
            return false;
          }
          const idx = line.indexOf(':');
          const field = idx === -1 ? line : line.slice(0, idx);
          let val = idx === -1 ? '' : line.slice(idx + 1);
          if (val.startsWith(' ')) val = val.slice(1);

          if (field === 'event') {
            currentEvent = val;
          } else if (field === 'data') {
            hasDataLine = true;
            currentDataLines.push(val);
          }
          return false;
        };

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              const tail = decoder.decode();
              if (tail) {
                rawChunks.push(tail);
                buffer += tail;
              }
              if (buffer.length > 0) {
                for (const line of buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
                  if (processLine(line)) break;
                }
              }
              flushBlock();
              break;
            }

            const chunkText = decoder.decode(value, { stream: true });
            rawChunks.push(chunkText);
            buffer += chunkText;

            let holdCr = false;
            if (buffer.endsWith('\r')) {
              holdCr = true;
              buffer = buffer.slice(0, -1);
            }

            const lines = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
            buffer = (lines.pop() ?? '') + (holdCr ? '\r' : '');

            let matched = false;
            for (const line of lines) {
              if (processLine(line)) {
                matched = true;
                break;
              }
            }
            if (matched) {
              controller.abort();
              await reader.cancel().catch(() => {});
              break;
            }
          }
        } catch (err: any) {
          if (rpcResult === null) {
            if (timedOut) {
              const timeoutRaw: McpRawResponse<T> = {
                status: res.status,
                ok: false,
                headers: res.headers,
                sessionId: this.sessionId,
                rpc: null,
                notifications,
                json: null,
                rawText: rawChunks.join(''),
              };
              throw new McpHttpError(
                `MCP SSE request timed out after ${timeoutMs}ms without JSON-RPC response`,
                res.status,
                res.headers,
                timeoutRaw,
              );
            }
            if (err?.name !== 'AbortError') {
              throw err;
            }
          }
        }

        if (timedOut && rpcResult === null) {
          const timeoutRaw: McpRawResponse<T> = {
            status: res.status,
            ok: false,
            headers: res.headers,
            sessionId: this.sessionId,
            rpc: null,
            notifications,
            json: null,
            rawText: rawChunks.join(''),
          };
          throw new McpHttpError(
            `MCP SSE request timed out after ${timeoutMs}ms without JSON-RPC response`,
            res.status,
            res.headers,
            timeoutRaw,
          );
        }

        return {
          status: res.status,
          ok: res.ok,
          headers: res.headers,
          sessionId: this.sessionId,
          rpc: rpcResult,
          notifications,
          json: rpcResult,
          rawText: rawChunks.join(''),
        };
      }

      const rawText = await res.text();
      const parsed = tryParseJson(rawText);
      const rpc =
        parsed && typeof parsed === 'object' && 'jsonrpc' in parsed
          ? (parsed as JsonRpcEnvelope<T>)
          : null;

      return {
        status: res.status,
        ok: res.ok,
        headers: res.headers,
        sessionId: this.sessionId,
        rpc,
        notifications,
        json: parsed,
        rawText,
      };
    } catch (err: any) {
      if (timedOut && !(err instanceof McpHttpError)) {
        const emptyHeaders = new Headers();
        throw new McpHttpError(
          `MCP request timed out after ${timeoutMs}ms without JSON-RPC response`,
          0,
          emptyHeaders,
          {
            status: 0,
            ok: false,
            headers: emptyHeaders,
            sessionId: this.sessionId,
            rpc: null,
            notifications: [],
            json: null,
            rawText: '',
          },
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  public async initialize(overrides?: {
    protocolVersion?: string;
    capabilities?: Record<string, unknown>;
    clientInfo?: { name: string; version: string };
  }): Promise<{
    status: number;
    sessionId?: string;
    protocolVersion: string;
    serverInfo?: any;
    capabilities?: any;
    raw: McpRawResponse;
  }> {
    const requestedVersion = overrides?.protocolVersion ?? '2025-03-26';
    const buildInitPayload = (protocolVersion: string) => ({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'initialize',
      params: {
        protocolVersion,
        capabilities: overrides?.capabilities ?? {},
        clientInfo: overrides?.clientInfo ?? {
          name: 'hermes-e2e',
          version: '1.0.0',
        },
      },
    });

    let raw = await this.sendRawRpc(buildInitPayload(requestedVersion), undefined, {
      includeProtocolHeader: false,
    });

    if (raw.status >= 400) {
      throw new McpHttpError(
        `MCP initialize failed with HTTP ${raw.status}: ${raw.rawText.slice(0, 300)}`,
        raw,
      );
    }

    if (
      raw.rpc?.error &&
      !overrides?.protocolVersion &&
      requestedVersion !== '2024-11-05'
    ) {
      this.sessionId = undefined;
      raw = await this.sendRawRpc(buildInitPayload('2024-11-05'), undefined, {
        includeProtocolHeader: false,
      });
      if (raw.status >= 400) {
        throw new McpHttpError(
          `MCP fallback initialize failed with HTTP ${raw.status}: ${raw.rawText.slice(0, 300)}`,
          raw,
        );
      }
    }

    if (!raw.rpc || (!('result' in raw.rpc) && !('error' in raw.rpc))) {
      throw new McpHttpError(
        'MCP response missing JSON-RPC result/error envelope',
        raw.status,
        raw.headers,
        raw,
      );
    }

    if (raw.rpc?.error) {
      throw new McpHttpError(
        `MCP initialize JSON-RPC error ${raw.rpc.error.code}: ${raw.rpc.error.message}`,
        raw,
      );
    }

    const result = raw.rpc?.result ?? {};
    this.protocolVersion = result.protocolVersion || requestedVersion;

    // Mandatory notifications/initialized transition required by rmcp LocalSessionManager
    const notifyRaw = await this.sendRawRpc(
      {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      },
      undefined,
      { includeProtocolHeader: this.protocolVersion < '2026-07-28' },
    );

    if (notifyRaw.status >= 400) {
      throw new McpHttpError(
        `MCP notifications/initialized failed with HTTP ${notifyRaw.status}: ${notifyRaw.rawText.slice(0, 300)}`,
        notifyRaw,
      );
    }

    this.initialized = true;

    return {
      status: raw.status,
      sessionId: this.sessionId,
      protocolVersion: this.protocolVersion,
      serverInfo: result.serverInfo,
      capabilities: result.capabilities,
      raw,
    };
  }

  public async listToolsRaw(): Promise<McpRawResponse<{ tools: McpTool[] }>> {
    return this.sendRawRpc<{ tools: McpTool[] }>({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'tools/list',
      params: {},
    });
  }

  public async listTools(): Promise<McpToolList> {
    if (!this.initialized) {
      await this.initialize();
    }
    const raw = await this.listToolsRaw();
    if (raw.status >= 400) {
      throw new McpHttpError(
        `MCP tools/list failed with HTTP ${raw.status}: ${raw.rawText.slice(0, 300)}`,
        raw,
      );
    }
    if (!raw.rpc || (!('result' in raw.rpc) && !('error' in raw.rpc))) {
      throw new McpHttpError(
        'MCP response missing JSON-RPC result/error envelope',
        raw.status,
        raw.headers,
        raw,
      );
    }
    if (raw.rpc?.error) {
      throw new McpHttpError(
        `MCP tools/list JSON-RPC error ${raw.rpc.error.code}: ${raw.rpc.error.message}`,
        raw,
      );
    }

    const toolsArray: McpTool[] = Array.isArray(raw.rpc?.result?.tools)
      ? [...raw.rpc!.result!.tools]
      : [];

    Object.defineProperties(toolsArray, {
      tools: { value: toolsArray, enumerable: false },
      status: { value: raw.status, enumerable: false },
      raw: { value: raw, enumerable: false },
    });

    return toolsArray as McpToolList;
  }

  public async callToolRaw(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<McpRawResponse> {
    return this.sendRawRpc({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    });
  }

  public async callTool<T = any>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<McpToolCallResult<T>> {
    if (!this.initialized) {
      await this.initialize();
    }
    const raw = await this.callToolRaw(name, args);
    if (raw.status >= 400) {
      throw new McpHttpError(
        `MCP tools/call "${name}" failed with HTTP ${raw.status}: ${raw.rawText.slice(0, 300)}`,
        raw,
      );
    }
    if (!raw.rpc || (!('result' in raw.rpc) && !('error' in raw.rpc))) {
      throw new McpHttpError(
        'MCP response missing JSON-RPC result/error envelope',
        raw.status,
        raw.headers,
        raw,
      );
    }

    const resultObj = raw.rpc?.result ?? {};
    const rpcError = raw.rpc?.error;
    const content: Array<{ type: string; text?: string; [k: string]: any }> = Array.isArray(
      resultObj.content,
    )
      ? resultObj.content
      : [];

    const textBlocks = content
      .filter((c) => typeof c?.text === 'string')
      .map((c) => c.text as string);
    const combinedText = rpcError ? rpcError.message : textBlocks.join('\n');

    let parsed: any = resultObj.structuredContent ?? null;
    if (parsed === null) {
      for (const tb of textBlocks) {
        const candidate = tryParseJson(tb);
        if (candidate !== null) {
          parsed = candidate;
          break;
        }
      }
    }

    const undoId: string | undefined =
      parsed && typeof parsed === 'object'
        ? (parsed.undo_id ?? parsed.undoId ?? parsed.data?.undo_id ?? parsed.data?.undoId)
        : undefined;
    const approvalId: string | undefined =
      parsed && typeof parsed === 'object'
        ? (parsed.approval_id ??
          parsed.approvalId ??
          parsed.pending_approval_id ??
          parsed.pendingApprovalId ??
          parsed.data?.approval_id ??
          parsed.data?.approvalId)
        : undefined;
    const autonomyStatus: string | undefined =
      parsed && typeof parsed === 'object'
        ? (parsed.status ?? parsed.autonomy_tier ?? parsed.autonomyTier)
        : undefined;

    const isError = Boolean(rpcError || resultObj.isError === true);

    return {
      status: raw.status,
      ok: raw.ok && !isError,
      isError,
      content,
      structuredContent: resultObj.structuredContent,
      text: combinedText,
      parsed: parsed as T | null,
      undoId: typeof undoId === 'string' ? undoId : undefined,
      approvalId: typeof approvalId === 'string' ? approvalId : undefined,
      autonomyStatus: typeof autonomyStatus === 'string' ? autonomyStatus : undefined,
      raw,
    };
  }

  public async closeSession(): Promise<number> {
    if (!this.sessionId) {
      this.initialized = false;
      return 200;
    }
    const headers = this.buildHeaders(undefined, true);
    const res = await fetch(this.mcpUrl, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    await res.arrayBuffer().catch(() => {});
    this.sessionId = undefined;
    this.initialized = false;
    return res.status;
  }
}

export function createMcpClient(mcpUrl?: string, bearerToken?: string): McpClient {
  return new McpClient(mcpUrl, bearerToken);
}
