import React from 'react';
import {
  FuiBadge,
  FuiBatteryCapsule,
  FuiButton,
  FuiPanel,
  FUI_TOKENS,
} from '@hermes/ui';
import type {
  TaskPriority,
  TaskStatus,
  TodoTask,
} from '../../api/todos';
import {
  computeTaskBatteryProgressPct,
  groupTasksIntoEisenhowerMatrix,
} from './todosModel';

export interface EisenhowerMatrixViewProps {
  tasks: readonly TodoTask[];
  activeTimerTaskId?: string | null;
  isTimerRunning?: boolean;
  onInspectTask: (task: TodoTask) => void;
  onChangePriority: (task: TodoTask, priority: TaskPriority) => void;
  onToggleTaskStatus: (task: TodoTask, nextStatus?: TaskStatus) => void;
  onToggleTimer: (task: TodoTask) => void;
}

export function EisenhowerMatrixView({
  tasks,
  activeTimerTaskId,
  isTimerRunning = false,
  onInspectTask,
  onChangePriority,
  onToggleTaskStatus,
  onToggleTimer,
}: EisenhowerMatrixViewProps) {
  const quadrants = groupTasksIntoEisenhowerMatrix(tasks);

  return (
    <div
      data-testid="eisenhower-matrix-view"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '12px',
        width: '100%',
        minWidth: 0,
        borderRadius: '0px',
      }}
    >
      {quadrants.map((q) => {
        const accentTone =
          q.id === 'q1'
            ? 'vermilion'
            : q.id === 'q2'
              ? 'orange'
              : q.id === 'q3'
                ? 'cyan'
                : 'amber';

        return (
          <FuiPanel
            key={q.id}
            data-testid={`eisenhower-quadrant-${q.id}`}
            padding="md"
            headerProps={{
              title: q.title,
              code: q.code,
              accent: accentTone,
              actions: (
                <FuiBadge tone={accentTone}>
                  {q.tasks.length} TASKS • {q.totalMinutes}M
                </FuiBadge>
              ),
            }}
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
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  color: FUI_TOKENS.inkMuted,
                  borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
                  paddingBottom: '6px',
                  borderRadius: '0px',
                }}
              >
                {q.subtitle}
              </div>

              {q.tasks.length === 0 ? (
                <div
                  style={{
                    padding: '14px 10px',
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    color: FUI_TOKENS.inkMuted,
                    border: `1px dashed ${FUI_TOKENS.borderHairline}`,
                    borderRadius: '0px',
                  }}
                >
                  ZERO TASKS IN {q.code}
                </div>
              ) : (
                q.tasks.map((task) => {
                  const isRunningForTask = Boolean(
                    isTimerRunning &&
                      activeTimerTaskId &&
                      String(activeTimerTaskId) === String(task.id),
                  );
                  const progressPct = computeTaskBatteryProgressPct(task);

                  return (
                    <div
                      key={task.id}
                      data-testid={`matrix-task-card-${task.id}`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        padding: '8px 10px',
                        backgroundColor: FUI_TOKENS.bgCarbon,
                        border: `1px solid ${q.accentColor}`,
                        fontFamily: FUI_TOKENS.fontMono,
                        fontSize: '12px',
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
                        <span
                          style={{
                            fontWeight: 700,
                            color: FUI_TOKENS.inkStark,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {task.title}
                        </span>
                        <FuiBadge tone={accentTone}>
                          PRIORITY: {task.priority.toUpperCase()}
                        </FuiBadge>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '6px',
                          borderRadius: '0px',
                        }}
                      >
                        <FuiBatteryCapsule
                          progressPct={progressPct}
                          segments={4}
                          fillColor={q.accentColor}
                          isPlaying={isRunningForTask}
                          playAriaLabel={`Start focus timer for ${task.title}`}
                          onTriggerPlay={() => onToggleTimer(task)}
                        />

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', borderRadius: '0px' }}>
                          {(['urgent', 'high', 'medium', 'low'] as const).map((p) => (
                            <FuiButton
                              key={p}
                              variant={task.priority === p ? 'primary' : 'ghost'}
                              size="sm"
                              aria-label={`Set ${task.title} priority to ${p}`}
                              onClick={() => onChangePriority(task, p)}
                            >
                              !{p.toUpperCase()}
                            </FuiButton>
                          ))}
                          <FuiButton
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              onToggleTaskStatus(
                                task,
                                task.status === 'done' ? 'todo' : 'done',
                              )
                            }
                          >
                            {task.status === 'done' ? '↺' : '✓ DONE'}
                          </FuiButton>
                          <FuiButton
                            variant="ghost"
                            size="sm"
                            onClick={() => onInspectTask(task)}
                          >
                            EDIT
                          </FuiButton>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </FuiPanel>
        );
      })}
    </div>
  );
}
