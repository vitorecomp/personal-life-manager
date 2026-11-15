import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, streamHermesChat, type HermesStreamFrame } from './client';
import { reduceTurnFrame, type LiveTurn } from '../components/hermes/useHermesChat';

function makeSseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function makeInitialTurn(): LiveTurn {
  return {
    localId: 'turn-1',
    sessionKey: 'sess_test',
    userText: 'Audit @vault',
    startedAtMs: 1000,
    finishedAtMs: null,
    phase: 'waiting',
    requestedMentions: ['@vault'],
    slashCommand: null,
    highLevelRequested: true,
    thinkingText: '',
    thinkingReceived: false,
    orbActive: null,
    orbState: null,
    gatewayMode: null,
    toolCalls: [],
    undoEvents: [],
    approvalEvents: [],
    text: '',
    tokenFrames: 0,
    unknownFrames: 0,
    done: null,
    error: null,
    baselineCount: 0,
    baselineLastId: undefined,
  };
}

describe('streamHermesChat & reduceTurnFrame SSE pipeline', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses chunked SSE frames across arbitrary boundaries and folds thinking, tool_call, undo, approval, token, and done frames', async () => {
    const frames: HermesStreamFrame[] = [];
    const tokens: string[] = [];

    const sseChunks = [
      'event: thinking\ndata: {"type":"thinking","session_key":"sess_test","step":1,"content":"Scanning Second Brain","thinking_orb_active":true,"orb_state":{"active":true,"vertices_lit":14,"rings_locked":2,"phase":"rag"},"gateway_mode":"offline_mock"}\n\n',
      'event: tool_call\ndata: {"type":"tool_call","session_key":"sess_test","tool_name":"todo_create","autonomy_tier":"IMMEDIATE_UNDO","status":"executed","arguments":{"title":"Review KR1"},"undo_id":"undo_1"}\n',
      '\nevent: undo_available\ndata: {"type":"undo_available","session_key":"sess_test","undo_id":"undo_1","tool_name":"todo_create","entity_table":"tasks","entity_id":"t_1","expires_at":"2026-11-15T09:00:00Z"}\n\n',
      'event: approval_required\ndata: {"type":"approval_required","session_key":"sess_test","approval_id":"appr_1","tool_name":"finance_rebalance","payload_json":{"symbol":"VT"},"status":"pending"}\n\n',
      'event: token\ndata: {"type":"token","session_key":"sess_test","delta":"Hello ","content":"Hello "}\n\n',
      'event: token\ndata: {"type":"token","session_key":"sess_test","delta":"Hermes!","content":"Hello Hermes!"}\n\n',
      'event: done\ndata: {"type":"done","session_key":"sess_test","message":"Hello Hermes!","thinking":"Scanning Second Brain","resolved_mentions":["@vault"],"message_count":2,"token_count":42,"thinking_orb_active":true,"gateway_mode":"offline_mock","tool_calls":[],"undo_ids":["undo_1"],"approval_ids":["appr_1"]}\n\n',
    ];

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeSseResponse(sseChunks));

    const finalReply = await streamHermesChat(
      {
        sessionKey: 'sess_test',
        message: 'Audit @vault',
        origin: 'hermes_view',
        highLevelMode: true,
        mentions: ['@vault'],
        slashCommand: '/deep-plan',
        profileSlug: 'paladin-strategist',
      },
      {
        onToken: (delta) => tokens.push(delta),
        onFrame: (f) => frames.push(f),
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0]!;
    const sentBody = JSON.parse(String(init?.body));
    expect(sentBody.session_key).toBe('sess_test');
    expect(sentBody.mentions).toEqual(['@vault']);
    expect(sentBody.slash_command).toBe('/deep-plan');
    expect(sentBody.profile_slug).toBe('paladin-strategist');

    expect(finalReply).toBe('Hello Hermes!');
    expect(tokens).toEqual(['Hello ', 'Hermes!']);
    expect(frames).toHaveLength(7);

    let state = makeInitialTurn();
    for (const frame of frames) {
      state = reduceTurnFrame(state, frame);
    }

    expect(state.thinkingText).toBe('Scanning Second Brain');
    expect(state.orbActive).toBe(true);
    expect(state.orbState?.ringsLocked).toBe(2);
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0]?.toolName).toBe('todo_create');
    expect(state.undoEvents).toHaveLength(1);
    expect(state.undoEvents[0]?.undoId).toBe('undo_1');
    expect(state.approvalEvents).toHaveLength(1);
    expect(state.approvalEvents[0]?.approvalId).toBe('appr_1');
    expect(state.text).toBe('Hello Hermes!');
    expect(state.done?.tokenCount).toBe(42);
  });

  it('throws structured ApiError when /api/hermes/chat/stream returns non-2xx JSON error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'bad_request', message: 'message must not be empty' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      streamHermesChat({
        sessionKey: 'sess_err',
        message: '   ',
        emptyReplyFallback: false,
      }),
    ).rejects.toThrowError(ApiError);
  });
});
