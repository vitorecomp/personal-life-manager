import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FuiBadge, FuiButton, FUI_TOKENS, MicroAnimIcon } from '@hermes/ui';
import {
  apiGet,
  apiPost,
  unwrapList,
  type ActiveTimerStatus,
  type TaskRecord,
} from '../../api/client';

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function ActiveTimerBar() {
  const queryClient = useQueryClient();

  const { data: rawTimer } = useQuery({
    queryKey: ['active-timer'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/time/timer');
        return (res?.timer ?? res?.data ?? res) as ActiveTimerStatus | null;
      } catch {
        return { running: false, session: null, elapsed_seconds: 0 } as ActiveTimerStatus;
      }
    },
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/tasks');
        return unwrapList<TaskRecord>(res, ['tasks']);
      } catch {
        return [];
      }
    },
  });

  const session = rawTimer?.session ?? (rawTimer as any)?.id ? ((rawTimer?.session ?? rawTimer) as any) : null;
  const isRunning = Boolean(
    rawTimer?.running === true ||
      rawTimer?.active === true ||
      (session && session.id && !session.ended_at && rawTimer?.running !== false),
  );

  const [tickOffset, setTickOffset] = useState(0);

  useEffect(() => {
    setTickOffset(0);
    if (!isRunning) return undefined;
    const id = window.setInterval(() => {
      setTickOffset((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [isRunning, session?.id, rawTimer?.elapsed_seconds]);

  const baseElapsed = Number(
    rawTimer?.elapsed_seconds ??
      session?.duration_seconds ??
      (session?.started_at
        ? Math.max(0, Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000))
        : 0),
  );
  const elapsedSeconds = isRunning ? baseElapsed + tickOffset : 0;

  const activeTaskId = isRunning ? String(session?.task_id ?? (rawTimer as any)?.task_id ?? '') : '';
  const matchedTask = activeTaskId ? tasks.find((t) => String(t.id) === activeTaskId) : undefined;
  const activeTaskTitle = isRunning
    ? matchedTask?.title ||
      String((rawTimer as any)?.task_title ?? session?.task_title ?? '') ||
      (activeTaskId ? `TASK:${activeTaskId.slice(0, 8)}` : 'FOCUS_SESSION')
    : '';

  const rawMode = String(session?.timer_mode ?? session?.mode ?? (rawTimer as any)?.mode ?? 'pomodoro').toLowerCase();
  const modeLabel = rawMode.includes('stopwatch') ? 'STOPWATCH' : 'POMODORO';

  const startMutation = useMutation({
    mutationFn: async (mode: 'pomodoro' | 'stopwatch') => {
      return apiPost('/api/time/timer/start', {
        mode,
        timer_mode: mode === 'stopwatch' ? 'stopwatch' : 'pomodoro_25_5',
        work_minutes: 25,
        break_minutes: 5,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-timer'] });
      queryClient.invalidateQueries({ queryKey: ['time-stats'] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      return apiPost('/api/time/timer/stop', {
        notes: 'Completed via ActiveTimerBar',
      });
    },
    onSuccess: () => {
      queryClient.setQueryData(['active-timer'], {
        running: false,
        session: null,
        elapsed_seconds: 0,
      });
      queryClient.invalidateQueries({ queryKey: ['active-timer'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['time-stats'] });
    },
  });

  const discardMutation = useMutation({
    mutationFn: async () => {
      return apiPost('/api/time/timer/discard', {});
    },
    onSuccess: () => {
      queryClient.setQueryData(['active-timer'], {
        running: false,
        session: null,
        elapsed_seconds: 0,
      });
      queryClient.invalidateQueries({ queryKey: ['active-timer'] });
      queryClient.invalidateQueries({ queryKey: ['time-stats'] });
    },
  });

  return (
    <div
      data-testid="active-timer-bar"
      data-fui="active-timer-bar"
      data-active-timer={isRunning ? 'true' : 'false'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 8px',
        backgroundColor: FUI_TOKENS.bgPanel,
        border: `1px solid ${isRunning ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline}`,
        fontFamily: FUI_TOKENS.fontMono,
        fontSize: '12px',
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
      }}
    >
      <MicroAnimIcon variant="TIME" size={16} active={isRunning} ariaLabel="Focus timer status" />

      {isRunning ? (
        <>
          <FuiBadge tone="orange">{modeLabel}</FuiBadge>
          <span
            data-testid="active-timer-task-title"
            style={{
              fontWeight: 700,
              color: FUI_TOKENS.inkStark,
              maxWidth: '220px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {activeTaskTitle}
          </span>
          <span
            data-testid="active-timer-clock"
            style={{
              fontVariantNumeric: 'tabular-nums',
              color: FUI_TOKENS.accentPhosphor,
              fontWeight: 700,
            }}
          >
            {formatClock(elapsedSeconds)}
          </span>
          <FuiButton
            data-testid="timer-stop-btn"
            variant="primary"
            size="sm"
            onClick={() => stopMutation.mutate()}
          >
            STOP
          </FuiButton>
          <FuiButton
            data-testid="timer-discard-btn"
            variant="danger"
            size="sm"
            onClick={() => discardMutation.mutate()}
          >
            DISCARD
          </FuiButton>
        </>
      ) : (
        <>
          <span style={{ color: FUI_TOKENS.inkMuted }}>TIMER // IDLE 00:00</span>
          <FuiButton
            data-testid="timer-start-pomodoro-btn"
            variant="secondary"
            size="sm"
            onClick={() => startMutation.mutate('pomodoro')}
          >
            ▶ POMODORO
          </FuiButton>
          <FuiButton
            data-testid="timer-start-stopwatch-btn"
            variant="ghost"
            size="sm"
            onClick={() => startMutation.mutate('stopwatch')}
          >
            STOPWATCH
          </FuiButton>
        </>
      )}
    </div>
  );
}
