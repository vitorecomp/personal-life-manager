import {
  FUI_TOKENS,
  FuiBadge,
  FuiBatteryCapsule,
  FuiButton,
  FuiInput,
  FuiPanel,
  FuiPanelHeader,
} from '@hermes/ui';
import React, { useMemo, useState } from 'react';
import { parseTodoQuickCapture } from '../db/nlpParser';
import type {
  MobileProjectRow,
  MobileTaskRow,
  MobileTimeSessionRow,
  TimerMode,
} from '../db/sqliteEngine';

export type TodoPerspective = 'INBOX' | 'TODAY' | 'UPCOMING' | 'DONE';

const PERSPECTIVES: readonly TodoPerspective[] = ['INBOX', 'TODAY', 'UPCOMING', 'DONE'];

const TIMER_MODES: ReadonlyArray<{ id: TimerMode; label: string }> = [
  { id: 'pomodoro_25_5', label: '25/5 POMO' },
  { id: 'pomodoro_50_10', label: '50/10 DEEP' },
  { id: 'pomodoro_90_15', label: '90/15 BLOCK' },
  { id: 'stopwatch', label: 'STOPWATCH' },
];

export interface TodosSurfaceProps {
  tasks: MobileTaskRow[];
  projects: MobileProjectRow[];
  activeTimer: MobileTimeSessionRow | null;
  onQuickCapture: (rawText: string) => void;
  onToggleTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onStartTimer: (taskId: string | null, mode: TimerMode) => void;
  onStopTimer: () => void;
}

export function TodosSurface({
  tasks,
  projects,
  activeTimer,
  onQuickCapture,
  onToggleTask,
  onDeleteTask,
  onStartTimer,
  onStopTimer,
}: TodosSurfaceProps) {
  const [perspective, setPerspective] = useState<TodoPerspective>('TODAY');
  const [quickInput, setQuickInput] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [selectedTimerMode, setSelectedTimerMode] = useState<TimerMode>('pomodoro_25_5');
  const todayIso = new Date().toISOString().slice(0, 10);

  const livePreview = useMemo(
    () => (quickInput.trim() ? parseTodoQuickCapture(quickInput, todayIso) : null),
    [quickInput, todayIso],
  );

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (perspective === 'DONE') {
        return t.status === 'done';
      }
      if (t.status === 'done' || t.status === 'canceled') {
        return false;
      }
      if (perspective === 'INBOX') {
        return t.status === 'inbox' || !t.scheduled_date;
      }
      if (perspective === 'TODAY') {
        return !t.scheduled_date || t.scheduled_date <= todayIso;
      }
      // UPCOMING
      return Boolean(t.scheduled_date && t.scheduled_date > todayIso);
    });
  }, [tasks, perspective, todayIso]);

  const plannedTodayMinutes = useMemo(() => {
    return tasks
      .filter((t) => t.status !== 'done' && (!t.scheduled_date || t.scheduled_date <= todayIso))
      .reduce((acc, t) => acc + (t.estimated_minutes ?? 25), 0);
  }, [tasks, todayIso]);

  const capacityMinutes = 240; // 4h deep work field capacity
  const capacityPct = Math.min(100, Math.round((plannedTodayMinutes / capacityMinutes) * 100));

  const handleCaptureSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseTodoQuickCapture(quickInput, todayIso);
    if (!parsed.valid) {
      setValidationError(parsed.error ?? 'Task title cannot be blank');
      return;
    }
    setValidationError(null);
    onQuickCapture(quickInput);
    setQuickInput('');
  };

  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) {
      map.set(p.id, p.name);
    }
    return map;
  }, [projects]);

  return (
    <div
      data-testid="mobile-surface-todos"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        borderRadius: '0px',
      }}
    >
      {/* NLP Quick Capture Panel */}
      <FuiPanel
        surface="panel"
        padding="sm"
        header={
          <FuiPanelHeader
            title="QUICK CAPTURE // DETERMINISTIC NLP"
            code="UUIDv7 // 0ms"
            accent="orange"
          />
        }
      >
        <form
          onSubmit={handleCaptureSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            borderRadius: '0px',
          }}
        >
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', borderRadius: '0px' }}>
            <div style={{ flex: 1, minWidth: 0, borderRadius: '0px' }}>
              <FuiInput
                data-testid="todo-quick-capture-input"
                aria-label="Quick capture todo"
                placeholder="Deploy relay #ops @deep !p1 tomorrow 30m"
                value={quickInput}
                onChange={(e) => {
                  setQuickInput(e.target.value);
                  if (validationError) setValidationError(null);
                }}
              />
            </div>
            <FuiButton
              type="submit"
              variant="primary"
              data-testid="todo-quick-capture-submit"
              prefixBadge="+"
            >
              CAPTURE
            </FuiButton>
          </div>

          {validationError && (
            <div
              data-testid="todo-capture-error"
              style={{
                padding: '6px 8px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.accentVermilion}`,
                color: FUI_TOKENS.accentVermilion,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              [ERROR] {validationError}
            </div>
          )}

          {livePreview && livePreview.valid && (
            <div
              data-testid="todo-nlp-preview"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                alignItems: 'center',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              <FuiBadge tone="orange">PRI:{livePreview.priority.toUpperCase()}</FuiBadge>
              {livePreview.energyLevel && (
                <FuiBadge tone="cyan">@{livePreview.energyLevel.toUpperCase()}</FuiBadge>
              )}
              {livePreview.estimatedMinutes && (
                <FuiBadge tone="phosphor">~{livePreview.estimatedMinutes}M</FuiBadge>
              )}
              {livePreview.scheduledDate && (
                <FuiBadge tone="amber">DUE:{livePreview.scheduledDate}</FuiBadge>
              )}
              {livePreview.tags.map((tag) => (
                <FuiBadge key={tag} tone="muted">
                  #{tag}
                </FuiBadge>
              ))}
            </div>
          )}
        </form>
      </FuiPanel>

      {/* Focus Timer Control Strip */}
      <FuiPanel
        surface="panel"
        padding="sm"
        header={
          <FuiPanelHeader
            title="FOCUS TIMER // POMODORO & STOPWATCH"
            code={activeTimer ? 'RUNNING' : 'STANDBY'}
            accent={activeTimer ? 'phosphor' : 'cyan'}
          />
        }
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            borderRadius: '0px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '4px',
              borderRadius: '0px',
            }}
          >
            {TIMER_MODES.map((m) => {
              const active = selectedTimerMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`timer-mode-${m.id}`}
                  onClick={() => setSelectedTimerMode(m.id)}
                  style={{
                    padding: '6px 4px',
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    fontWeight: 700,
                    backgroundColor: active ? FUI_TOKENS.accentCyan : FUI_TOKENS.bgCarbon,
                    color: active ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                    border: `1px solid ${
                      active ? FUI_TOKENS.accentCyan : FUI_TOKENS.borderHairline
                    }`,
                    cursor: 'pointer',
                    borderRadius: '0px',
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {activeTimer ? (
            <div
              data-testid="active-focus-timer-banner"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                padding: '8px 10px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.accentPhosphor}`,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              <span style={{ color: FUI_TOKENS.accentPhosphor, borderRadius: '0px' }}>
                [● ACTIVE_SESSION // {activeTimer.timer_mode.toUpperCase()}]
              </span>
              <FuiButton
                size="sm"
                variant="danger"
                data-testid="stop-focus-timer-btn"
                onClick={onStopTimer}
              >
                ■ STOP & LOG
              </FuiButton>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                borderRadius: '0px',
              }}
            >
              <span
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  color: FUI_TOKENS.inkMuted,
                  borderRadius: '0px',
                }}
              >
                MODE: {selectedTimerMode.toUpperCase()}
              </span>
              <FuiButton
                size="sm"
                variant="secondary"
                data-testid="start-general-timer-btn"
                onClick={() => onStartTimer(filteredTasks[0]?.id ?? null, selectedTimerMode)}
              >
                ▶ START FOCUS SESSION
              </FuiButton>
            </div>
          )}
        </div>
      </FuiPanel>

      {/* Perspectives & Capacity Meter */}
      <FuiPanel
        surface="panel"
        padding="sm"
        header={
          <FuiPanelHeader
            title={`TASK QUEUE // ${perspective}`}
            code={`${filteredTasks.length} ITEMS`}
            accent="orange"
          />
        }
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            borderRadius: '0px',
          }}
        >
          {/* Perspective Filter Buttons */}
          <div
            role="group"
            aria-label="Todo Perspectives"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '6px',
              borderRadius: '0px',
            }}
          >
            {PERSPECTIVES.map((p) => {
              const isSelected = perspective === p;
              return (
                <button
                  key={p}
                  type="button"
                  data-testid={`todo-perspective-${p.toLowerCase()}`}
                  onClick={() => setPerspective(p)}
                  style={{
                    padding: '6px 4px',
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    fontWeight: 700,
                    backgroundColor: isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                    color: isSelected ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                    border: `1px solid ${
                      isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                    }`,
                    cursor: 'pointer',
                    borderRadius: '0px',
                  }}
                >
                  {p}
                </button>
              );
            })}
          </div>

          {/* Deep Work Capacity Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              padding: '6px 8px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
            }}
          >
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkStark,
                borderRadius: '0px',
              }}
            >
              CAPACITY: {plannedTodayMinutes}m / {capacityMinutes}m
            </span>
            <FuiBatteryCapsule progressPct={capacityPct} segments={8} />
          </div>

          {/* Task List */}
          <div
            data-testid="todo-task-list"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              borderRadius: '0px',
            }}
          >
            {filteredTasks.map((task) => {
              const isDone = task.status === 'done';
              const projName = task.project_id ? projectMap.get(task.project_id) : null;
              const actualMin = Math.round(task.actual_seconds / 60);

              return (
                <div
                  key={task.id}
                  data-testid={`todo-task-row-${task.id}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '8px',
                    backgroundColor: FUI_TOKENS.bgCarbon,
                    border: `1px solid ${
                      isDone ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.borderHairline
                    }`,
                    borderRadius: '0px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      borderRadius: '0px',
                    }}
                  >
                    <button
                      type="button"
                      data-testid={`todo-task-toggle-${task.id}`}
                      aria-label={`Toggle ${task.title}`}
                      onClick={() => onToggleTask(task.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        flex: 1,
                        minWidth: 0,
                        textAlign: 'left',
                        backgroundColor: 'transparent',
                        border: 'none',
                        color: isDone ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.inkStark,
                        fontFamily: FUI_TOKENS.fontMono,
                        fontSize: '12px',
                        cursor: 'pointer',
                        padding: '2px 0',
                        borderRadius: '0px',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '22px',
                          height: '22px',
                          border: `1px solid ${
                            isDone ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.accentOrange
                          }`,
                          backgroundColor: isDone ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.bgPanel,
                          color: isDone ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                          fontWeight: 700,
                          fontSize: '12px',
                          flexShrink: 0,
                          borderRadius: '0px',
                        }}
                      >
                        {isDone ? '✓' : '□'}
                      </span>
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: '12px',
                          textDecoration: isDone ? 'line-through' : 'none',
                          borderRadius: '0px',
                        }}
                      >
                        {task.title}
                      </span>
                    </button>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        flexShrink: 0,
                        borderRadius: '0px',
                      }}
                    >
                      {!isDone && (
                        <button
                          type="button"
                          data-testid={`todo-task-focus-${task.id}`}
                          aria-label={`Start focus timer for ${task.title}`}
                          onClick={() => onStartTimer(task.id, selectedTimerMode)}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: FUI_TOKENS.bgPanel,
                            border: `1px solid ${FUI_TOKENS.accentCyan}`,
                            color: FUI_TOKENS.accentCyan,
                            fontFamily: FUI_TOKENS.fontMono,
                            fontSize: '12px',
                            cursor: 'pointer',
                            borderRadius: '0px',
                          }}
                        >
                          ▶
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid={`todo-task-delete-${task.id}`}
                        aria-label={`Delete ${task.title}`}
                        onClick={() => onDeleteTask(task.id)}
                        style={{
                          padding: '4px 8px',
                          backgroundColor: FUI_TOKENS.bgPanel,
                          border: `1px solid ${FUI_TOKENS.borderHairline}`,
                          color: FUI_TOKENS.inkMuted,
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                          cursor: 'pointer',
                          borderRadius: '0px',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Metadata Badges */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '4px',
                      alignItems: 'center',
                      borderRadius: '0px',
                    }}
                  >
                    <FuiBadge
                      tone={
                        task.priority === 'urgent' || task.priority === 'high'
                          ? 'orange'
                          : 'muted'
                      }
                    >
                      !{task.priority.toUpperCase()}
                    </FuiBadge>
                    {task.energy_level && (
                      <FuiBadge tone="cyan">@{task.energy_level.toUpperCase()}</FuiBadge>
                    )}
                    {projName && <FuiBadge tone="amber">+{projName}</FuiBadge>}
                    {task.estimated_minutes && (
                      <FuiBadge tone="phosphor">
                        {actualMin}m/{task.estimated_minutes}m
                      </FuiBadge>
                    )}
                    {task.tags.map((tag) => (
                      <FuiBadge key={tag} tone="muted">
                        #{tag}
                      </FuiBadge>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </FuiPanel>
    </div>
  );
}
