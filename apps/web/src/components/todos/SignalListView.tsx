import React, { useState } from 'react';
import {
  FuiBadge,
  FuiBatteryCapsule,
  FuiButton,
  FuiFigureRow,
  FUI_TOKENS,
} from '@hermes/ui';
import type {
  ProjectItem,
  TaskPriority,
  TaskStatus,
  TodoTask,
} from '../../api/todos';
import {
  buildSignalListGraph,
  type SignalTaskRowViewModel,
} from './todosModel';

export interface SignalListViewProps {
  tasks: readonly TodoTask[];
  allTasks: readonly TodoTask[];
  projects: readonly ProjectItem[];
  activeTimerTaskId?: string | null;
  isTimerRunning?: boolean;
  selectedTaskId?: string | null;
  onSelectTask: (task: TodoTask) => void;
  onInspectTask: (task: TodoTask) => void;
  onToggleTaskStatus: (task: TodoTask, nextStatus?: TaskStatus) => void;
  onChangePriority: (task: TodoTask, priority: TaskPriority) => void;
  onToggleTimer: (task: TodoTask) => void;
  onCreateSubtask: (parentTask: TodoTask, title: string) => void;
}

function getPriorityTone(
  priority: TaskPriority,
): 'vermilion' | 'orange' | 'cyan' | 'muted' {
  if (priority === 'urgent') return 'vermilion';
  if (priority === 'high') return 'orange';
  if (priority === 'medium') return 'cyan';
  return 'muted';
}

export function SignalListView({
  tasks,
  allTasks,
  projects,
  activeTimerTaskId,
  isTimerRunning = false,
  selectedTaskId,
  onSelectTask,
  onInspectTask,
  onToggleTaskStatus,
  onChangePriority,
  onToggleTimer,
  onCreateSubtask,
}: SignalListViewProps) {
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({});
  const [expandedSubtaskRows, setExpandedSubtaskRows] = useState<Record<string, boolean>>({});

  const projectMap = new Map<string, ProjectItem>();
  for (const p of projects) {
    projectMap.set(p.id, p);
  }

  const graph = buildSignalListGraph(tasks, allTasks);

  const handleSubtaskSubmit = (e: React.FormEvent, parentTask: TodoTask) => {
    e.preventDefault();
    const raw = (subtaskDrafts[parentTask.id] ?? '').trim();
    if (!raw) return;
    onCreateSubtask(parentTask, raw);
    setSubtaskDrafts((prev) => ({ ...prev, [parentTask.id]: '' }));
  };

  return (
    <div
      data-testid="signal-list-view"
      style={{
        display: 'grid',
        gridTemplateColumns: '56px minmax(0, 1fr)',
        gap: '8px',
        alignItems: 'stretch',
        width: '100%',
        minWidth: 0,
        borderRadius: '0px',
      }}
    >
      {/* Left Gutter: REF-05 180-Degree Semicircular Dependency Arcs */}
      <div
        data-testid="signal-dependency-gutter"
        style={{
          position: 'relative',
          backgroundColor: FUI_TOKENS.bgCarbon,
          border: `1px solid ${FUI_TOKENS.borderHairline}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: '4px',
          borderRadius: '0px',
        }}
      >
        <span
          style={{
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            color: FUI_TOKENS.inkMuted,
            letterSpacing: '0.04em',
            borderRadius: '0px',
          }}
        >
          ARC
        </span>
        <svg
          data-testid="signal-dependency-svg"
          data-fui-chart="signal-dependency-arcs"
          width="52"
          height={graph.svgHeight}
          viewBox={`0 0 52 ${graph.svgHeight}`}
          aria-label="REF-05 180-degree dependency arcs"
          style={{ display: 'block', overflow: 'visible', borderRadius: '0px' }}
        >
          {/* Baseline vertical signal bus */}
          <line
            x1="40"
            y1="8"
            x2="40"
            y2={Math.max(24, graph.svgHeight - 8)}
            stroke={FUI_TOKENS.borderHairline}
            strokeWidth="1"
            strokeDasharray="2 3"
          />

          {/* Row anchor nodes */}
          {graph.rows.map((row) => {
            const cy = row.index * 68 + 34;
            const nodeColor = row.isBlocked
              ? FUI_TOKENS.accentVermilion
              : row.task.status === 'done'
                ? FUI_TOKENS.accentPhosphor
                : row.task.status === 'in_progress'
                  ? FUI_TOKENS.accentCyan
                  : FUI_TOKENS.accentOrange;
            return (
              <g key={`anchor-${row.task.id}`}>
                <line
                  x1="34"
                  y1={cy}
                  x2="50"
                  y2={cy}
                  stroke={nodeColor}
                  strokeWidth="1.2"
                />
                <circle
                  cx="40"
                  cy={cy}
                  r="3.5"
                  fill={FUI_TOKENS.bgCarbon}
                  stroke={nodeColor}
                  strokeWidth="1.5"
                />
              </g>
            );
          })}

          {/* 180° Semicircular Dependency Arcs */}
          {graph.dependencyArcs.length > 0 ? (
            graph.dependencyArcs.map((arc) => (
              <g key={arc.id} data-testid={`dependency-arc-${arc.toTaskId}`}>
                <path
                  d={arc.pathD}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth="1.75"
                />
                <circle cx="40" cy={arc.startY} r="3" fill={arc.color} />
                <circle cx="40" cy={arc.endY} r="3.5" fill={arc.color} />
              </g>
            ))
          ) : (
            /* Calibration reference arc so REF-05 SVG arc geometry is always present */
            <path
              d="M 40 24 A 16 16 0 0 0 40 56"
              fill="none"
              stroke={FUI_TOKENS.accentCyan}
              strokeWidth="1.25"
              strokeDasharray="3 2"
            />
          )}
        </svg>
      </div>

      {/* Center & Right Columns: Task Strips + Bezier Subtask Trees */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          minWidth: 0,
          borderRadius: '0px',
        }}
      >
        {graph.rows.map((row: SignalTaskRowViewModel) => {
          const { task, figCode, isBlocked, blockers, subtasks, doneSubtasksCount, totalSubtasksCount, batteryProgressPct } = row;
          const isRunningForTask = Boolean(
            isTimerRunning && activeTimerTaskId && String(activeTimerTaskId) === String(task.id),
          );
          const isSelected = selectedTaskId === task.id;
          const proj = task.project_id ? projectMap.get(task.project_id) : undefined;
          const isExpanded = Boolean(expandedSubtaskRows[task.id] || subtasks.length > 0);
          const actualMinutes = Math.round((task.actual_seconds ?? 0) / 60);
          const estMinutes = task.estimated_minutes ?? 30;

          return (
            <div
              key={task.id}
              data-testid={`signal-task-row-${task.id}`}
              data-blocked={isBlocked ? 'true' : 'false'}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                border: `1px solid ${
                  isBlocked
                    ? FUI_TOKENS.accentVermilion
                    : isSelected
                      ? FUI_TOKENS.accentOrange
                      : FUI_TOKENS.borderHairline
                }`,
                backgroundColor: FUI_TOKENS.bgPanel,
                padding: '6px',
                minWidth: 0,
                borderRadius: '0px',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: '8px',
                  alignItems: 'center',
                  minWidth: 0,
                  borderRadius: '0px',
                }}
              >
                <FuiFigureRow
                  code={figCode}
                  title={task.title}
                  active={isSelected || task.status === 'in_progress'}
                  tabColor={
                    isBlocked
                      ? FUI_TOKENS.accentVermilion
                      : task.status === 'done'
                        ? FUI_TOKENS.accentPhosphor
                        : FUI_TOKENS.accentAmber
                  }
                  statusDotColor={
                    isBlocked
                      ? FUI_TOKENS.accentVermilion
                      : task.status === 'done'
                        ? FUI_TOKENS.accentPhosphor
                        : task.status === 'in_progress'
                          ? FUI_TOKENS.accentCyan
                          : FUI_TOKENS.accentOrange
                  }
                  phosphorSplitPct={batteryProgressPct}
                  onSelect={() => onSelectTask(task)}
                  subtitle={
                    <span
                      style={{
                        display: 'inline-flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: '6px',
                        borderRadius: '0px',
                      }}
                    >
                      <span>STATUS: {task.status.toUpperCase()}</span>
                      <span>•</span>
                      <span>PRIORITY: {task.priority.toUpperCase()}</span>
                      <span>•</span>
                      <span>
                        EST: {actualMinutes}M / {estMinutes}M
                      </span>
                      {task.scheduled_date && (
                        <>
                          <span>•</span>
                          <span>SCHED: {task.scheduled_date}</span>
                        </>
                      )}
                      {proj && (
                        <>
                          <span>•</span>
                          <span>PROJ: {proj.name}</span>
                        </>
                      )}
                      {isBlocked && (
                        <>
                          <span>•</span>
                          <span style={{ color: FUI_TOKENS.accentVermilion, fontWeight: 700 }}>
                            BLOCKED BY: {blockers.filter((b) => !b.resolved).map((b) => b.title).join(', ')}
                          </span>
                        </>
                      )}
                    </span>
                  }
                />

                {/* Right Tactical Controls & REF-05 Battery Capsule with Play Trigger */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: '6px',
                    borderRadius: '0px',
                  }}
                >
                  {isBlocked && (
                    <span
                      data-testid={`task-blocked-badge-${task.id}`}
                      style={{ display: 'inline-flex', borderRadius: '0px' }}
                    >
                      <FuiBadge tone="vermilion" solid>
                        BLOCKED
                      </FuiBadge>
                    </span>
                  )}

                  <FuiBadge tone={getPriorityTone(task.priority)}>
                    !{task.priority}
                  </FuiBadge>

                  {task.energy_level && (
                    <FuiBadge tone="cyan">@{task.energy_level}</FuiBadge>
                  )}

                  {task.tags.slice(0, 2).map((tag) => (
                    <FuiBadge key={tag} tone="orange">
                      #{tag}
                    </FuiBadge>
                  ))}

                  {totalSubtasksCount > 0 && (
                    <FuiBadge tone="phosphor" code="SUB">
                      {doneSubtasksCount}/{totalSubtasksCount}
                    </FuiBadge>
                  )}

                  <FuiBatteryCapsule
                    progressPct={batteryProgressPct}
                    segments={5}
                    fillColor={
                      isBlocked
                        ? FUI_TOKENS.accentVermilion
                        : task.status === 'done'
                          ? FUI_TOKENS.accentPhosphor
                          : isRunningForTask
                            ? FUI_TOKENS.accentOrange
                            : FUI_TOKENS.accentCyan
                    }
                    isPlaying={isRunningForTask}
                    playAriaLabel={`Start focus timer for ${task.title}`}
                    onTriggerPlay={() => onToggleTimer(task)}
                  />

                  <FuiButton
                    data-testid={`task-complete-btn-${task.id}`}
                    variant={task.status === 'done' ? 'secondary' : 'primary'}
                    size="sm"
                    aria-label={
                      task.status === 'done'
                        ? `Reopen ${task.title}`
                        : `Complete ${task.title}`
                    }
                    onClick={() =>
                      onToggleTaskStatus(task, task.status === 'done' ? 'todo' : 'done')
                    }
                  >
                    {task.status === 'done' ? '↺ REOPEN' : '✓ DONE'}
                  </FuiButton>

                  <FuiButton
                    data-testid={`task-subtasks-toggle-${task.id}`}
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setExpandedSubtaskRows((prev) => ({
                        ...prev,
                        [task.id]: !isExpanded,
                      }))
                    }
                  >
                    SUB ({doneSubtasksCount}/{totalSubtasksCount})
                  </FuiButton>

                  <FuiButton
                    data-testid={`task-inspect-btn-${task.id}`}
                    variant="secondary"
                    size="sm"
                    aria-label={`Inspect task ${task.title}`}
                    onClick={() => onInspectTask(task)}
                  >
                    INSPECT
                  </FuiButton>
                </div>
              </div>

              {/* Right-Hand Expandable Bezier Subtask Tree (REF-05 Rule 3) */}
              {isExpanded && (
                <div
                  data-testid={`signal-subtask-tree-${task.id}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '48px minmax(0, 1fr)',
                    gap: '6px',
                    alignItems: 'center',
                    padding: '6px 8px',
                    backgroundColor: FUI_TOKENS.bgCarbon,
                    borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
                    borderRadius: '0px',
                  }}
                >
                  <svg
                    data-testid={`signal-subtask-svg-${task.id}`}
                    data-fui-chart="signal-subtask-tree"
                    width="48"
                    height={Math.max(32, subtasks.length * 26 + 12)}
                    viewBox={`0 0 48 ${Math.max(32, subtasks.length * 26 + 12)}`}
                    aria-label="REF-05 cubic Bezier subtask connectors"
                    style={{ display: 'block', borderRadius: '0px' }}
                  >
                    <circle
                      cx="6"
                      cy="14"
                      r="3"
                      fill={FUI_TOKENS.accentOrange}
                    />
                    {subtasks.length > 0 ? (
                      subtasks.map((sub, sIdx) => {
                        const endY = 14 + sIdx * 26;
                        const stroke =
                          sub.status === 'done'
                            ? FUI_TOKENS.accentPhosphor
                            : FUI_TOKENS.accentCyan;
                        return (
                          <g key={sub.id}>
                            <path
                              d={`M 6 14 C 22 14, 24 ${endY}, 42 ${endY}`}
                              fill="none"
                              stroke={stroke}
                              strokeWidth="1.5"
                            />
                            <circle cx="42" cy={endY} r="2.5" fill={stroke} />
                          </g>
                        );
                      })
                    ) : (
                      <path
                        d="M 6 14 C 20 14, 24 22, 42 22"
                        fill="none"
                        stroke={FUI_TOKENS.borderHairline}
                        strokeWidth="1.2"
                      />
                    )}
                  </svg>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      minWidth: 0,
                      borderRadius: '0px',
                    }}
                  >
                    {subtasks.map((sub) => (
                      <div
                        key={sub.id}
                        data-testid={`subtask-item-${sub.id}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          padding: '3px 6px',
                          border: `1px solid ${FUI_TOKENS.borderHairline}`,
                          backgroundColor: FUI_TOKENS.bgPanel,
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                          borderRadius: '0px',
                        }}
                      >
                        <span
                          style={{
                            color:
                              sub.status === 'done'
                                ? FUI_TOKENS.accentPhosphor
                                : FUI_TOKENS.inkStark,
                            textDecoration:
                              sub.status === 'done' ? 'line-through' : 'none',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            borderRadius: '0px',
                          }}
                        >
                          [{sub.status === 'done' ? '✓' : ' '}] {sub.title}
                        </span>
                        <div style={{ display: 'flex', gap: '4px', borderRadius: '0px' }}>
                          <FuiButton
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              onToggleTaskStatus(
                                sub,
                                sub.status === 'done' ? 'todo' : 'done',
                              )
                            }
                          >
                            {sub.status === 'done' ? 'UNDO' : 'DONE'}
                          </FuiButton>
                          <FuiButton
                            variant="ghost"
                            size="sm"
                            onClick={() => onChangePriority(sub, 'high')}
                          >
                            !HIGH
                          </FuiButton>
                        </div>
                      </div>
                    ))}

                    <form
                      onSubmit={(e) => handleSubtaskSubmit(e, task)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        borderRadius: '0px',
                      }}
                    >
                      <input
                        type="text"
                        aria-label={`Add subtask under ${task.title}`}
                        placeholder="+ Add subtask..."
                        value={subtaskDrafts[task.id] ?? ''}
                        onChange={(e) =>
                          setSubtaskDrafts((prev) => ({
                            ...prev,
                            [task.id]: e.target.value,
                          }))
                        }
                        style={{
                          flex: 1,
                          minHeight: '28px',
                          padding: '4px 8px',
                          backgroundColor: FUI_TOKENS.bgPanel,
                          border: `1px solid ${FUI_TOKENS.borderHairline}`,
                          color: FUI_TOKENS.inkStark,
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                          borderRadius: '0px',
                        }}
                      />
                      <FuiButton type="submit" variant="secondary" size="sm">
                        + SUBTASK
                      </FuiButton>
                    </form>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
