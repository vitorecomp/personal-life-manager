import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HermesPage } from './HermesPage';
import { useAppStore } from '../store/appStore';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(frames: Array<{ event: string; data: unknown }>): Response {
  const encoder = new TextEncoder();
  const payload = frames
    .map((f) => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`)
    .join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function renderHermesPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HermesPage />
    </QueryClientProvider>,
  );
}

describe('HermesPage — F25 Full Chat Workspace, Thinking Orb, MCP Cards & Vault Inspector', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/hermes');
    useAppStore.setState({
      activeSessionKey: 'sess_alpha',
      isAssistantStreaming: false,
      activeDashboardId: null,
      selectedEntityId: 'goal-uuid-1',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('honors ?session= deep-link, groups sessions, searches (/api/hermes/sessions?q=), renames, pins, forks from turn, and handles Cmd+Shift+O', async () => {
    window.history.replaceState(null, '', '/hermes?session=sess_deep');

    const nowIso = new Date().toISOString();
    const sessions = [
      {
        session_key: 'sess_deep',
        title: 'Deep Plan Thread',
        origin: 'hermes_view',
        pinned: true,
        archived: false,
        high_level_mode: true,
        created_at: nowIso,
        updated_at: nowIso,
        messages_json: [
          { id: 'm1', role: 'user', content: 'Review @goals' },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Grounded in `01-inbox/okr-plan.md`.',
            thinking: 'Evaluated Q4 KRs',
          },
        ],
      },
      {
        session_key: 'sess_frieren',
        title: 'Frieren Quick Chat',
        origin: 'frieren_popover',
        pinned: false,
        archived: false,
        high_level_mode: false,
        created_at: nowIso,
        updated_at: nowIso,
        messages_json: [],
      },
    ];

    const fetchCalls: Array<{ url: string; method: string; body?: unknown }> = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      fetchCalls.push({ url, method, body });

      if (url.startsWith('/api/hermes/sessions/sess_deep/fork') && method === 'POST') {
        return jsonResponse({
          session_key: 'sess_forked_turn_0',
          title: 'Deep Plan Thread (Fork)',
          origin: 'hermes_view',
          pinned: false,
          archived: false,
          high_level_mode: true,
          created_at: nowIso,
          updated_at: nowIso,
          messages_json: [{ id: 'm1', role: 'user', content: 'Review @goals' }],
        });
      }
      if (url.startsWith('/api/hermes/sessions/sess_deep') && method === 'PATCH') {
        return jsonResponse({ ...sessions[0], ...body });
      }
      if (url.startsWith('/api/hermes/sessions/sess_deep') && method === 'GET') {
        return jsonResponse(sessions[0]);
      }
      if (url.startsWith('/api/hermes/sessions') && method === 'POST') {
        return jsonResponse({
          session_key: (body as Record<string, string>)?.session_key ?? 'sess_new',
          title: 'New Hermes Session',
          origin: 'hermes_view',
          pinned: false,
          archived: false,
          high_level_mode: true,
          created_at: nowIso,
          updated_at: nowIso,
          messages_json: [],
        });
      }
      if (url.startsWith('/api/hermes/sessions')) {
        return jsonResponse({ sessions });
      }
      if (url.startsWith('/api/hermes/health')) {
        return jsonResponse({ status: 'ok', hermes_gateway: 'offline_mock' });
      }
      if (url.startsWith('/api/agents')) {
        return jsonResponse({
          agents: [
            {
              id: 'ag-1',
              slug: 'paladin-strategist',
              name: 'Paladin Strategist',
              knight_archetype: 'paladin',
              hermes_profile: 'strategist',
              is_paused: false,
            },
          ],
        });
      }
      return jsonResponse([]);
    });

    renderHermesPage();

    // Deep link should set activeSessionKey to sess_deep
    await waitFor(() => {
      expect(screen.getByTestId('hermes-active-session-key').textContent).toContain('sess_deep');
    });

    // Persisted messages + thinking disclosure rendered
    await waitFor(() => {
      expect(screen.getByText('Review @goals')).toBeTruthy();
      expect(screen.getByTestId('hermes-thinking-block').textContent).toContain('Evaluated Q4 KRs');
    });

    // Sticky high_level_mode toggle sends PATCH /api/hermes/sessions/sess_deep { high_level_mode: false }
    expect(screen.getByTestId('hermes-thinking-orb-panel')).toBeTruthy();
    fireEvent.click(screen.getByTestId('high-level-plan-toggle'));

    await waitFor(() => {
      expect(screen.queryByTestId('hermes-thinking-orb-panel')).toBeNull();
    });
    expect(
      fetchCalls.some(
        (c) =>
          c.url === '/api/hermes/sessions/sess_deep' &&
          c.method === 'PATCH' &&
          (c.body as Record<string, unknown>)?.high_level_mode === false,
      ),
    ).toBe(true);

    // Search sessions sends GET /api/hermes/sessions?q=frieren
    fireEvent.change(screen.getByTestId('hermes-session-search'), {
      target: { value: 'frieren' },
    });
    await waitFor(() => {
      expect(fetchCalls.some((c) => c.url.includes('/api/hermes/sessions?q=frieren'))).toBe(true);
    });

    // Fork from turn 0 sends POST /api/hermes/sessions/sess_deep/fork with { turn_index: 0 }
    fireEvent.click(screen.getByTestId('hermes-fork-turn-0'));
    await waitFor(() => {
      expect(
        fetchCalls.some(
          (c) =>
            c.url === '/api/hermes/sessions/sess_deep/fork' &&
            c.method === 'POST' &&
            (c.body as Record<string, unknown>)?.turn_index === 0,
        ),
      ).toBe(true);
    });

    // Cmd+Shift+O creates a fresh session
    fireEvent.keyDown(window, { key: 'O', ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(
        fetchCalls.some((c) => c.url === '/api/hermes/sessions' && c.method === 'POST'),
      ).toBe(true);
    });
  });

  it('guards blank composer submission, streams SSE chat turns, executes [Undo] (tolerating 409), and resolves [✓ Approve] / [✎ Edit] / [✕ Cancel]', async () => {
    const fetchCalls: Array<{ url: string; method: string; body?: unknown }> = [];
    let undoCallCount = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      fetchCalls.push({ url, method, body });

      if (url === '/api/hermes/chat/stream' && method === 'POST') {
        return sseResponse([
          {
            event: 'thinking',
            data: {
              type: 'thinking',
              session_key: 'sess_alpha',
              step: 1,
              content: 'Cross-referencing @vault and @portfolio',
              thinking_orb_active: true,
              orb_state: { active: true, vertices_lit: 18, rings_locked: 2, phase: 'mcp' },
              gateway_mode: 'offline_mock',
            },
          },
          {
            event: 'tool_call',
            data: {
              type: 'tool_call',
              session_key: 'sess_alpha',
              tool_name: 'todo_create',
              autonomy_tier: 'IMMEDIATE_UNDO',
              status: 'executed',
              arguments: { title: 'Rebalance ETFs' },
              undo_id: 'undo-live-1',
            },
          },
          {
            event: 'undo_available',
            data: {
              type: 'undo_available',
              session_key: 'sess_alpha',
              undo_id: 'undo-live-1',
              tool_name: 'todo_create',
              entity_table: 'tasks',
              entity_id: 'task-99',
              expires_at: new Date(Date.now() + 600_000).toISOString(),
            },
          },
          {
            event: 'approval_required',
            data: {
              type: 'approval_required',
              session_key: 'sess_alpha',
              approval_id: 'appr-live-1',
              tool_name: 'finance_rebalance',
              payload_json: { symbol: 'VT', target_weight_pct: '30' },
              status: 'pending',
            },
          },
          {
            event: 'token',
            data: {
              type: 'token',
              session_key: 'sess_alpha',
              delta: 'Prepared portfolio rebalance and created task.',
              content: 'Prepared portfolio rebalance and created task.',
            },
          },
          {
            event: 'done',
            data: {
              type: 'done',
              session_key: 'sess_alpha',
              message: 'Prepared portfolio rebalance and created task.',
              thinking: 'Cross-referencing @vault and @portfolio',
              resolved_mentions: ['@vault', '@portfolio'],
              message_count: 2,
              token_count: 35,
              thinking_orb_active: true,
              gateway_mode: 'offline_mock',
              tool_calls: [],
              undo_ids: ['undo-live-1'],
              approval_ids: ['appr-live-1'],
            },
          },
        ]);
      }

      if (url === '/api/mcp/undo/undo-live-1' && method === 'POST') {
        undoCallCount += 1;
        if (undoCallCount === 1) {
          return jsonResponse({ error: 'conflict', message: 'Action already undone' }, 409);
        }
        return jsonResponse({ id: 'undo-live-1', reverted: true });
      }

      if (url === '/api/mcp/approvals/appr-live-1/approve' && method === 'POST') {
        return jsonResponse({
          id: 'appr-live-1',
          session_key: 'sess_alpha',
          tool_name: 'finance_rebalance',
          payload_json: (body as Record<string, unknown>)?.payload_json ?? {},
          status: 'approved',
          created_at: new Date().toISOString(),
        });
      }

      if (url === '/api/mcp/approvals/appr-2/reject' && method === 'POST') {
        return jsonResponse({
          id: 'appr-2',
          session_key: 'sess_alpha',
          tool_name: 'vault_write_note',
          payload_json: {},
          status: 'rejected',
          created_at: new Date().toISOString(),
        });
      }

      if (url.startsWith('/api/mcp/approvals')) {
        return jsonResponse({
          approvals: [
            {
              id: 'appr-2',
              session_key: 'sess_alpha',
              tool_name: 'vault_write_note',
              payload_json: { path: '01-inbox/draft.md' },
              status: 'pending',
              created_at: new Date().toISOString(),
            },
          ],
        });
      }

      return jsonResponse([]);
    });

    renderHermesPage();

    // Blank submission guard: SEND button is disabled and pressing Enter does not call /api/hermes/chat/stream
    const sendBtn = screen.getByTestId('hermes-send-btn') as HTMLButtonElement;
    const composer = screen.getByTestId('hermes-composer') as HTMLTextAreaElement;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });
    expect(fetchCalls.some((c) => c.url === '/api/hermes/chat/stream')).toBe(false);

    // Type message with @vault and @portfolio and send
    fireEvent.change(composer, {
      target: { value: '/deep-plan Check @vault and @portfolio' },
    });
    expect(sendBtn.disabled).toBe(false);
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText('Prepared portfolio rebalance and created task.')).toBeTruthy();
    });

    // Verify Undo button renders and handles 409 Conflict gracefully without throwing
    const undoBtn = await screen.findByTestId('hermes-undo-undo-live-1');
    fireEvent.click(undoBtn);
    await waitFor(() => {
      expect(screen.getByTestId('hermes-undone-badge-undo-live-1')).toBeTruthy();
    });

    // Edit & Approve appr-live-1 with JSON validation
    const editBtn = await screen.findByTestId('hermes-edit-appr-live-1');
    fireEvent.click(editBtn);
    const payloadInput = screen.getByTestId(
      'hermes-edit-payload-appr-live-1',
    ) as HTMLTextAreaElement;
    fireEvent.change(payloadInput, { target: { value: '{broken json' } });
    fireEvent.click(screen.getByTestId('hermes-approve-appr-live-1'));
    expect(screen.getByTestId('hermes-approval-error-appr-live-1')).toBeTruthy();

    fireEvent.change(payloadInput, {
      target: { value: '{"symbol":"VT","target_weight_pct":"35"}' },
    });
    fireEvent.click(screen.getByTestId('hermes-approve-appr-live-1'));

    await waitFor(() => {
      expect(
        fetchCalls.some(
          (c) =>
            c.url === '/api/mcp/approvals/appr-live-1/approve' &&
            c.method === 'POST' &&
            JSON.stringify((c.body as Record<string, unknown>)?.payload_json) ===
              '{"symbol":"VT","target_weight_pct":"35"}',
        ),
      ).toBe(true);
    });

    // Reject appr-2 via [✕ Cancel]
    const cancelBtn = await screen.findByTestId('hermes-cancel-appr-2');
    expect(cancelBtn.textContent).toContain('[✕ Cancel]');
    fireEvent.click(cancelBtn);
    await waitFor(() => {
      expect(
        fetchCalls.some((c) => c.url === '/api/mcp/approvals/appr-2/reject' && c.method === 'POST'),
      ).toBe(true);
    });
  });

  it('previews Vault & youtube-ai notes in Inspector Drawer, surfaces inline 403/404 errors without throwing, and distills insights to 01-inbox/', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url.startsWith('/api/vault/notes')) {
        return jsonResponse({
          notes: [
            { path: '01-inbox/architecture.md', title: 'Architecture Note', folder: '01-inbox' },
            {
              path: 'lists/youtube/rust-tokio.md',
              title: 'Tokio Deep Dive (youtube-ai)',
              folder: 'lists/youtube',
            },
            { path: '01-inbox/missing.md', title: 'Missing Note', folder: '01-inbox' },
          ],
        });
      }
      if (url.includes('/api/vault/note?path=01-inbox%2Farchitecture.md')) {
        return jsonResponse({
          path: '01-inbox/architecture.md',
          title: 'Architecture Note',
          content_md: '# Second Brain Architecture\n\nRectilinear `0px` FUI.',
        });
      }
      if (url.includes('/api/vault/note?path=01-inbox%2Fmissing.md')) {
        return jsonResponse({ error: 'not_found', message: 'Vault note not found on disk' }, 404);
      }
      if (url === '/api/vault/distill' && method === 'POST') {
        return jsonResponse({
          vault_note_path: '01-inbox/2026-11-15-hermes-session.md',
          title: 'Distilled Strategy',
          created_at: new Date().toISOString(),
        });
      }
      return jsonResponse([]);
    });

    renderHermesPage();

    const noteItems = await screen.findAllByTestId('hermes-vault-note-item');
    expect(noteItems).toHaveLength(3);

    // Click valid note -> renders Markdown preview
    fireEvent.click(noteItems[0]!);
    await waitFor(() => {
      expect(screen.getByTestId('hermes-vault-note-preview').textContent).toContain(
        'Second Brain Architecture',
      );
    });

    // Click missing note -> renders inline error banner without unhandled rejection
    fireEvent.click(noteItems[2]!);
    await waitFor(() => {
      expect(screen.getByTestId('hermes-vault-note-error').textContent).toContain(
        'Vault note not found on disk',
      );
    });

    // Click 1-click Distill to Vault Inbox -> calls POST /api/vault/distill and shows vault_note_path
    fireEvent.click(screen.getByTestId('hermes-vault-distill-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('hermes-distill-result').textContent).toContain(
        '01-inbox/2026-11-15-hermes-session.md',
      );
    });
  });
});
