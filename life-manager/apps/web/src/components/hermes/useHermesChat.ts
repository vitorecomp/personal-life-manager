import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { streamHermesChat, type HermesStreamFrame } from '../../api/client';
import { apiErrorStatus, describeApiError } from '../../api/hermes';
import { useAppStore } from '../../store/appStore';
import { readSessionMessages, toToolCallView, type ToolCallView } from './hermesModel';

export type TurnPhase = 'waiting' | 'streaming' | 'done' | 'error' | 'aborted';

export interface TurnUndoEvent {
  undoId: string;
  toolName: string;
  entityTable: string | null;
  entityId: string | null;
  expiresAt: string | null;
}

export interface TurnApprovalEvent {
  approvalId: string;
  toolName: string;
  payloadJson: unknown;
  status: string;
}

export interface TurnOrbState {
  verticesLit: number;
  ringsLocked: number;
  phase: string;
}

export interface TurnDoneInfo {
  resolvedMentions: string[];
  slashCommand: string | null;
  messageCount: number;
  tokenCount: number;
  thinkingOrbActive: boolean;
  gatewayMode: string | null;
}

/** One chat turn as seen by this client, from the click on SEND until the server history has it. */
export interface LiveTurn {
  localId: string;
  sessionKey: string;
  userText: string;
  startedAtMs: number;
  finishedAtMs: number | null;
  phase: TurnPhase;
  requestedMentions: string[];
  slashCommand: string | null;
  highLevelRequested: boolean;
  thinkingText: string;
  thinkingReceived: boolean;
  /** `thinking_orb_active` of the `thinking` frame; `null` until that frame arrives. */
  orbActive: boolean | null;
  orbState: TurnOrbState | null;
  gatewayMode: string | null;
  toolCalls: ToolCallView[];
  undoEvents: TurnUndoEvent[];
  approvalEvents: TurnApprovalEvent[];
  text: string;
  tokenFrames: number;
  unknownFrames: number;
  done: TurnDoneInfo | null;
  error: { message: string; status: number | null } | null;
  /** Persisted history at send time; the turn is absorbed once the history moves past it. */
  baselineCount: number;
  baselineLastId: string | undefined;
}

export interface SendTurnArgs {
  sessionKey: string;
  text: string;
  highLevelMode: boolean;
  mentions: string[];
  slashCommand: string | null;
  profileSlug?: string | null;
}

function nextLocalId(seq: number): string {
  return `turn-${Date.now().toString(36)}-${seq}`;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Folds one SSE frame into the turn. Unknown event types are counted, never thrown on. */
export function reduceTurnFrame(turn: LiveTurn, frame: HermesStreamFrame): LiveTurn {
  switch (frame.type) {
    case 'thinking': {
      const orb = frame.orb_state && typeof frame.orb_state === 'object' ? frame.orb_state : null;
      return {
        ...turn,
        phase: 'streaming',
        thinkingReceived: true,
        thinkingText: typeof frame.content === 'string' ? frame.content : turn.thinkingText,
        orbActive: Boolean(frame.thinking_orb_active),
        orbState: orb
          ? {
              verticesLit: Number.isFinite(Number(orb.vertices_lit)) ? Number(orb.vertices_lit) : 0,
              ringsLocked: Number.isFinite(Number(orb.rings_locked)) ? Number(orb.rings_locked) : 0,
              phase: typeof orb.phase === 'string' ? orb.phase : '',
            }
          : turn.orbState,
        gatewayMode: typeof frame.gateway_mode === 'string' ? frame.gateway_mode : turn.gatewayMode,
      };
    }
    case 'tool_call': {
      const view = toToolCallView(frame);
      return view ? { ...turn, phase: 'streaming', toolCalls: [...turn.toolCalls, view] } : turn;
    }
    case 'undo_available': {
      const undoId = typeof frame.undo_id === 'string' ? frame.undo_id : '';
      if (!undoId || turn.undoEvents.some((u) => u.undoId === undoId)) return turn;
      return {
        ...turn,
        phase: 'streaming',
        undoEvents: [
          ...turn.undoEvents,
          {
            undoId,
            toolName: typeof frame.tool_name === 'string' ? frame.tool_name : 'mcp_tool',
            entityTable: typeof frame.entity_table === 'string' ? frame.entity_table : null,
            entityId: typeof frame.entity_id === 'string' ? frame.entity_id : null,
            expiresAt: typeof frame.expires_at === 'string' ? frame.expires_at : null,
          },
        ],
      };
    }
    case 'approval_required': {
      const approvalId = typeof frame.approval_id === 'string' ? frame.approval_id : '';
      if (!approvalId || turn.approvalEvents.some((a) => a.approvalId === approvalId)) return turn;
      return {
        ...turn,
        phase: 'streaming',
        approvalEvents: [
          ...turn.approvalEvents,
          {
            approvalId,
            toolName: typeof frame.tool_name === 'string' ? frame.tool_name : 'mcp_tool',
            payloadJson: frame.payload_json ?? {},
            status: typeof frame.status === 'string' ? frame.status : 'pending',
          },
        ],
      };
    }
    case 'token': {
      // `delta` is the new chunk, `content` the cumulative text; the cumulative value wins on drift.
      let text = turn.text;
      if (typeof frame.delta === 'string') text += frame.delta;
      if (typeof frame.content === 'string' && frame.content.length >= text.length) {
        text = frame.content;
      }
      return { ...turn, phase: 'streaming', text, tokenFrames: turn.tokenFrames + 1 };
    }
    case 'done': {
      const message = typeof frame.message === 'string' ? frame.message : '';
      return {
        ...turn,
        text: message.length > 0 ? message : turn.text,
        thinkingText:
          typeof frame.thinking === 'string' && frame.thinking.length > 0
            ? frame.thinking
            : turn.thinkingText,
        gatewayMode: typeof frame.gateway_mode === 'string' ? frame.gateway_mode : turn.gatewayMode,
        orbActive:
          typeof frame.thinking_orb_active === 'boolean' ? frame.thinking_orb_active : turn.orbActive,
        done: {
          resolvedMentions: stringList(frame.resolved_mentions),
          slashCommand: typeof frame.slash_command === 'string' ? frame.slash_command : null,
          messageCount: Number.isFinite(Number(frame.message_count)) ? Number(frame.message_count) : 0,
          tokenCount: Number.isFinite(Number(frame.token_count)) ? Number(frame.token_count) : 0,
          thinkingOrbActive: Boolean(frame.thinking_orb_active),
          gatewayMode: typeof frame.gateway_mode === 'string' ? frame.gateway_mode : null,
        },
      };
    }
    default:
      return { ...turn, unknownFrames: turn.unknownFrames + 1 };
  }
}

interface PersistedSnapshot {
  count: number;
  lastId: string | undefined;
}

function snapshotPersisted(record: unknown): PersistedSnapshot {
  const messages = readSessionMessages(record as { messages_json?: unknown; messages?: unknown } | null);
  return {
    count: messages.length,
    lastId: messages.length > 0 ? messages[messages.length - 1]?.id : undefined,
  };
}

/** True once the server history has moved past the point where the turn was sent. */
export function isTurnAbsorbed(turn: LiveTurn, persisted: PersistedSnapshot): boolean {
  return (
    persisted.count > turn.baselineCount ||
    (persisted.count > 0 && persisted.lastId !== turn.baselineLastId)
  );
}

export interface UseHermesChatResult {
  /** Turn currently shown for `sessionKey` (in flight, failed, aborted, or done but not yet in history). */
  turn: LiveTurn | null;
  /** Last turn of `sessionKey` that completed, kept after its bubbles were absorbed into history. */
  lastCompleted: LiveTurn | null;
  /** A request is in flight (in any session). */
  isBusy: boolean;
  busySessionKey: string | null;
  send: (args: SendTurnArgs) => Promise<void>;
  stop: () => void;
  dismiss: (sessionKey: string) => void;
}

/**
 * Chat turn state machine for `/hermes`.
 *
 * The backend buffers a turn and sends every SSE frame in one burst after it has been stored, so
 * the waiting state is driven by the request being in flight, not by gaps between frames.
 * Failures are JSON error responses (there is no `error` SSE event) and surface as `phase: 'error'`.
 */
export function useHermesChat(sessionKey: string): UseHermesChatResult {
  const queryClient = useQueryClient();
  const setAssistantStreaming = useAppStore((s) => s.setAssistantStreaming);

  const [turns, setTurns] = useState<Record<string, LiveTurn>>({});
  const [completed, setCompleted] = useState<Record<string, LiveTurn>>({});
  const [busySessionKey, setBusySessionKey] = useState<string | null>(null);

  const aliveRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      // Leaving /hermes must not leak a stream or leave the shell in "thinking".
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
        busyRef.current = false;
        setAssistantStreaming(false);
      }
    };
  }, [setAssistantStreaming]);

  const patchTurn = useCallback((key: string, localId: string, fn: (t: LiveTurn) => LiveTurn) => {
    if (!aliveRef.current) return;
    setTurns((prev) => {
      const current = prev[key];
      if (!current || current.localId !== localId) return prev;
      return { ...prev, [key]: fn(current) };
    });
  }, []);

  const send = useCallback(
    async (args: SendTurnArgs) => {
      const text = args.text;
      if (text.trim().length === 0) return;
      if (busyRef.current) return;

      const key = args.sessionKey;
      const baseline = snapshotPersisted(queryClient.getQueryData(['hermes-session', key]));
      const localId = nextLocalId(++seqRef.current);
      const turn: LiveTurn = {
        localId,
        sessionKey: key,
        userText: text,
        startedAtMs: Date.now(),
        finishedAtMs: null,
        phase: 'waiting',
        requestedMentions: args.mentions,
        slashCommand: args.slashCommand,
        highLevelRequested: args.highLevelMode,
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
        baselineCount: baseline.count,
        baselineLastId: baseline.lastId,
      };

      const controller = new AbortController();
      controllerRef.current = controller;
      busyRef.current = true;
      setBusySessionKey(key);
      setAssistantStreaming(true);
      setTurns((prev) => ({ ...prev, [key]: turn }));
      setCompleted((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });

      let sawToolFrames = false;
      let failed: unknown = null;
      try {
        await streamHermesChat(
          {
            sessionKey: key,
            message: text,
            origin: 'hermes_view',
            highLevelMode: args.highLevelMode,
            pageContext: {
              active_route: '/hermes',
              active_dashboard_id: useAppStore.getState().activeDashboardId ?? null,
              selected_entity_id: useAppStore.getState().selectedEntityId ?? null,
            },
            mentions: args.mentions,
            slashCommand: args.slashCommand,
            profileSlug: args.profileSlug ?? null,
            signal: controller.signal,
            emptyReplyFallback: false,
          },
          {
            onFrame: (frame) => {
              if (
                frame.type === 'tool_call' ||
                frame.type === 'undo_available' ||
                frame.type === 'approval_required'
              ) {
                sawToolFrames = true;
              }
              patchTurn(key, localId, (t) => reduceTurnFrame(t, frame));
            },
          },
        );
      } catch (err) {
        failed = err;
      }

      const aborted =
        controller.signal.aborted || (failed instanceof Error && failed.name === 'AbortError');
      if (controllerRef.current === controller) controllerRef.current = null;
      busyRef.current = false;
      if (!aliveRef.current) return;

      const finishedAtMs = Date.now();
      if (aborted) {
        patchTurn(key, localId, (t) => ({ ...t, phase: 'aborted', finishedAtMs }));
      } else if (failed) {
        patchTurn(key, localId, (t) => ({
          ...t,
          phase: 'error',
          finishedAtMs,
          error: {
            message: describeApiError(failed, 'Hermes did not answer'),
            status: apiErrorStatus(failed),
          },
        }));
      } else {
        patchTurn(key, localId, (t) => ({ ...t, phase: 'done', finishedAtMs }));
      }
      setBusySessionKey(null);
      setAssistantStreaming(false);

      // Reconcile with the server: a stored turn replaces the local bubbles (no duplicates even
      // when the same prompt is sent twice), an unstored one stays visible.
      try {
        await queryClient.refetchQueries({ queryKey: ['hermes-session', key], exact: true });
      } catch {
        // The transcript keeps the local turn; the session query reports its own failure.
      }
      if (!aliveRef.current) return;

      const persisted = snapshotPersisted(queryClient.getQueryData(['hermes-session', key]));
      setTurns((prev) => {
        const current = prev[key];
        if (!current || current.localId !== localId) return prev;
        if (!isTurnAbsorbed(current, persisted)) return prev;
        if (current.phase === 'done' || current.phase === 'aborted') {
          if (current.phase === 'done') {
            setCompleted((c) => ({ ...c, [key]: current }));
          }
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return prev;
      });
      if (!failed && !aborted) {
        setCompleted((c) => {
          if (c[key]?.localId === localId) return c;
          const settled = { ...turn, phase: 'done' as const, finishedAtMs };
          return c[key] ? c : { ...c, [key]: settled };
        });
      }

      queryClient.invalidateQueries({ queryKey: ['hermes-sessions'] });
      if (sawToolFrames) {
        queryClient.invalidateQueries({ queryKey: ['mcp-approvals'] });
        queryClient.invalidateQueries({ queryKey: ['mcp-undo'] });
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      }
    },
    [patchTurn, queryClient, setAssistantStreaming],
  );

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const dismiss = useCallback((key: string) => {
    setTurns((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  return {
    turn: turns[sessionKey] ?? null,
    lastCompleted: completed[sessionKey] ?? null,
    isBusy: busySessionKey !== null,
    busySessionKey,
    send,
    stop,
    dismiss,
  };
}
