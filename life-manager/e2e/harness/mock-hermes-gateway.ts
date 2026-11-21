import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { createMcpClient } from './mcp-helpers';

export interface MockHermesGatewayTriggerMcp {
  mcpUrl: string;
  toolName: string;
  args: Record<string, unknown>;
  bearerToken?: string;
}

export interface MockHermesGatewayOptions {
  failStatus?: number;
  hangMs?: number;
  triggerMcpCall?: MockHermesGatewayTriggerMcp;
  highLevelThinking?: boolean;
  responseText?: string;
  runStatus?: string;
}

export interface RecordedGatewayRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  sessionKey?: string;
  authorization?: string;
  body: any;
  timestamp: string;
}

export interface MockHermesGatewayHandle {
  host: string;
  port: number;
  url: string;
  baseV1Url: string;
  requests: RecordedGatewayRequest[];
  setOptions: (next: Partial<MockHermesGatewayOptions>) => void;
  clearRequests: () => void;
  close: () => Promise<void>;
}

function firstHeader(val: string | string[] | undefined): string | undefined {
  if (Array.isArray(val)) return val[0];
  return val;
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function parseJsonOrString(raw: string): any {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

function detectHighLevelThinking(options: MockHermesGatewayOptions, body: any): boolean {
  if (options.highLevelThinking === true) return true;
  if (options.highLevelThinking === false) return false;
  if (!body || typeof body !== 'object') return false;
  if (body.high_level_mode === false || body.highLevelMode === false) return false;
  if (body.high_level_mode === true || body.highLevelMode === true) return true;
  if (body.reasoning_effort === 'high') return true;
  const serialized = JSON.stringify(body);
  return (
    serialized.includes('HIGH_LEVEL_PLAN') ||
    serialized.includes('/deep-plan') ||
    /"high_level_mode"\s*:\s*true|"highLevelMode"\s*:\s*true/.test(serialized)
  );
}

export async function startMockHermesGateway(
  initialOptions: MockHermesGatewayOptions = {},
): Promise<MockHermesGatewayHandle> {
  let currentOptions: MockHermesGatewayOptions = { ...initialOptions };
  const requests: RecordedGatewayRequest[] = [];
  const runsStore = new Map<string, Record<string, any>>();
  const sockets = new Set<net.Socket>();
  const activeTimers = new Set<ReturnType<typeof setTimeout>>();
  const timerAbortCallbacks = new Set<() => void>();
  let closed = false;

  const waitAbortable = (ms: number, req: http.IncomingMessage): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      if (closed || ms <= 0) {
        resolve(closed);
        return;
      }
      let settled = false;
      const finish = (aborted: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        activeTimers.delete(t);
        timerAbortCallbacks.delete(abortNow);
        req.removeListener('close', onReqClose);
        resolve(aborted);
      };
      const abortNow = () => finish(true);
      const onReqClose = () => finish(true);
      const t = setTimeout(() => finish(false), ms);
      t.unref();
      activeTimers.add(t);
      timerAbortCallbacks.add(abortNow);
      req.once('close', onReqClose);
    });

  const executeConfiguredMcpCall = async () => {
    if (!currentOptions.triggerMcpCall) return null;
    const { mcpUrl, toolName, args, bearerToken } = currentOptions.triggerMcpCall;
    const mcp = createMcpClient(mcpUrl, bearerToken);
    const callRes = await mcp.callTool(toolName, args);
    return {
      tool_name: toolName,
      arguments: args,
      is_error: callRes.isError,
      undo_id: callRes.undoId,
      approval_id: callRes.approvalId,
      autonomy_status: callRes.autonomyStatus,
      parsed: callRes.parsed,
      text: callRes.text,
    };
  };

  const server = http.createServer(async (req, res) => {
    const rawBody = await readRequestBody(req);
    const parsedBody = parseJsonOrString(rawBody);
    const sessionKey = firstHeader(req.headers['x-hermes-session-key']);
    const authorization = firstHeader(req.headers['authorization']);

    requests.push({
      method: req.method || 'GET',
      path: req.url || '/',
      headers: { ...req.headers },
      sessionKey,
      authorization,
      body: parsedBody,
      timestamp: new Date().toISOString(),
    });

    if (currentOptions.hangMs && currentOptions.hangMs > 0) {
      const aborted = await waitAbortable(currentOptions.hangMs, req);
      if (aborted || res.writableEnded || res.destroyed) {
        return;
      }
    }

    if (currentOptions.failStatus && currentOptions.failStatus >= 400) {
      res.statusCode = currentOptions.failStatus;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          error: {
            message: `Mock hermes gateway forced failure (${currentOptions.failStatus})`,
            type: 'gateway_error',
            code: currentOptions.failStatus,
          },
        }),
      );
      return;
    }

    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const normalizedPath = reqUrl.pathname
      .replace(/^\/v1\/v1(?=\/|$)/, '/v1')
      .replace(/^(?!\/v1(?:\/|$))/, '/v1')
      .replace(/\/+$/, '');

    // 1. Models / Health check
    if (
      req.method === 'GET' &&
      (normalizedPath === '/v1/models' || normalizedPath === '/v1/health' || normalizedPath === '/v1')
    ) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          object: 'list',
          status: 'ok',
          data: [
            {
              id: 'nousresearch/hermes-3-llama-3.1-70b',
              object: 'model',
              created: 1730000000,
              owned_by: 'nous-research',
            },
          ],
        }),
      );
      return;
    }

    // 2. Chat Completions (SSE stream & JSON)
    if (req.method === 'POST' && normalizedPath === '/v1/chat/completions') {
      let mcpSummary: any = null;
      if (currentOptions.triggerMcpCall) {
        try {
          mcpSummary = await executeConfiguredMcpCall();
        } catch (err: any) {
          mcpSummary = { error: String(err?.message || err) };
        }
      }

      const includeThinking = detectHighLevelThinking(currentOptions, parsedBody);
      const model =
        (parsedBody && typeof parsedBody === 'object' && parsedBody.model) ||
        'nousresearch/hermes-3-llama-3.1-70b';
      const completionId = `chatcmpl-${crypto.randomUUID().slice(0, 12)}`;
      const created = Math.floor(Date.now() / 1000);

      const userPromptSnippet =
        parsedBody && typeof parsedBody === 'object' && Array.isArray(parsedBody.messages)
          ? String(parsedBody.messages[parsedBody.messages.length - 1]?.content ?? '').slice(0, 120)
          : '';
      const baseReply =
        currentOptions.responseText ||
        `HERMES mock response${sessionKey ? ` [session=${sessionKey}]` : ''}${userPromptSnippet ? `: ${userPromptSnippet}` : '.'}` +
          (mcpSummary
            ? ` [mcp=${mcpSummary.tool_name}${mcpSummary.undo_id ? ` undo=${mcpSummary.undo_id}` : ''}${mcpSummary.approval_id ? ` approval=${mcpSummary.approval_id}` : ''}]`
            : '');

      const thinkingBlock = includeThinking
        ? '<thinking>Analyzing multi-horizon constraints, OKR dependencies, and Life Ops state.</thinking>\n\n'
        : '';

      const isStream = Boolean(parsedBody && typeof parsedBody === 'object' && parsedBody.stream);
      if (isStream) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        if (sessionKey) {
          res.setHeader('X-Hermes-Session-Key', sessionKey);
        }

        const writeChunk = (delta: Record<string, any>, finishReason: string | null = null, extra?: Record<string, any>) => {
          const frame = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model,
            ...(sessionKey ? { session_key: sessionKey } : {}),
            ...(mcpSummary ? { mcp_call: mcpSummary } : {}),
            choices: [
              {
                index: 0,
                delta,
                finish_reason: finishReason,
              },
            ],
            ...(extra || {}),
          };
          res.write(`data: ${JSON.stringify(frame)}\n\n`);
        };

        writeChunk({ role: 'assistant', content: '' });
        if (includeThinking) {
          writeChunk({ content: '<thinking>Analyzing multi-horizon constraints, ' });
          writeChunk({ content: 'OKR dependencies, and Life Ops state.</thinking>\n\n' });
        }
        const mid = Math.max(1, Math.floor(baseReply.length / 2));
        writeChunk({ content: baseReply.slice(0, mid) });
        if (mid < baseReply.length) {
          writeChunk({ content: baseReply.slice(mid) });
        }
        writeChunk({}, 'stop', {
          usage: {
            prompt_tokens: 128,
            completion_tokens: 64,
            total_tokens: 192,
          },
        });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (sessionKey) {
        res.setHeader('X-Hermes-Session-Key', sessionKey);
      }
      res.end(
        JSON.stringify({
          id: completionId,
          object: 'chat.completion',
          created,
          model,
          session_key: sessionKey ?? null,
          mcp_call: mcpSummary,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: `${thinkingBlock}${baseReply}`,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 128,
            completion_tokens: 64,
            total_tokens: 192,
          },
        }),
      );
      return;
    }

    // 3. Agent Runs (POST /v1/runs, GET /v1/runs/:id, GET /v1/runs/:id/events)
    if (req.method === 'POST' && normalizedPath === '/v1/runs') {
      let mcpSummary: any = null;
      if (currentOptions.triggerMcpCall) {
        try {
          mcpSummary = await executeConfiguredMcpCall();
        } catch (err: any) {
          mcpSummary = { error: String(err?.message || err) };
        }
      }

      const runId = `run_${crypto.randomUUID().slice(0, 12)}`;
      const resolvedStatus =
        currentOptions.runStatus ||
        (mcpSummary?.approval_id ? 'awaiting_approval' : 'completed');
      const outputText =
        currentOptions.responseText ||
        `Knight run ${runId} executed cleanly${sessionKey ? ` [session=${sessionKey}]` : ''}.`;

      const runPayload = {
        id: runId,
        run_id: runId,
        object: 'agent.run',
        status: resolvedStatus,
        session_key:
          sessionKey ??
          (parsedBody && typeof parsedBody === 'object' ? parsedBody.session_key : undefined) ??
          `knight-session-${runId}`,
        output: outputText,
        output_text: outputText,
        steps_trace: [
          {
            step: 1,
            type: 'reasoning',
            summary: 'Evaluated Knight SOUL.md directives and active triggers.',
          },
          ...(mcpSummary
            ? [
                {
                  step: 2,
                  type: 'tool_call',
                  tool_name: mcpSummary.tool_name,
                  result: mcpSummary,
                },
              ]
            : []),
        ],
        mcp_call: mcpSummary,
        usage: {
          prompt_tokens: 320,
          completion_tokens: 180,
          input_tokens: 320,
          output_tokens: 180,
          total_tokens: 500,
        },
        input_tokens: 320,
        output_tokens: 180,
        estimated_cost_usd: 0.0045,
        created_at: new Date().toISOString(),
      };

      runsStore.set(runId, runPayload);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(runPayload));
      return;
    }

    const runEventsMatch = normalizedPath.match(/^\/v1\/runs\/([^/]+)\/events$/);
    if (req.method === 'GET' && runEventsMatch) {
      const runId = runEventsMatch[1];
      const stored = runsStore.get(runId) ?? {
        id: runId,
        run_id: runId,
        status: 'completed',
        output_text: `Knight run ${runId} completed.`,
      };
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.write(`event: run.step\ndata: ${JSON.stringify({ run_id: runId, step: 1 })}\n\n`);
      res.write(`event: run.completed\ndata: ${JSON.stringify(stored)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const runGetMatch = normalizedPath.match(/^\/v1\/runs\/([^/]+)$/);
    if (req.method === 'GET' && runGetMatch) {
      const runId = runGetMatch[1];
      const stored = runsStore.get(runId);
      if (!stored) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'not_found', message: `Run ${runId} not found` }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(stored));
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'not_found', path: req.url }));
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });

  const host = '127.0.0.1';
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.removeListener('error', reject);
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind mock hermes gateway'));
        return;
      }
      resolve(addr.port);
    });
  });

  const url = `http://${host}:${port}`;
  const baseV1Url = `${url}/v1`;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const abortFn of Array.from(timerAbortCallbacks)) {
      abortFn();
    }
    for (const t of Array.from(activeTimers)) {
      clearTimeout(t);
    }
    activeTimers.clear();
    for (const sock of Array.from(sockets)) {
      sock.destroy();
    }
    sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return {
    host,
    port,
    url,
    baseV1Url,
    requests,
    setOptions: (next: Partial<MockHermesGatewayOptions>) => {
      currentOptions = { ...currentOptions, ...next };
    },
    clearRequests: () => {
      requests.length = 0;
    },
    close,
  };
}
