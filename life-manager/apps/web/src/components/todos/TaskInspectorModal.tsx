import React, { useEffect, useState } from 'react';
import {
  FuiBadge,
  FuiButton,
  FuiInput,
  FuiModal,
  FuiSelect,
  FUI_TOKENS,
} from '@hermes/ui';
import type {
  ProjectItem,
  TaskEnergyLevel,
  TaskPriority,
  TaskStatus,
  TimeSessionItem,
  TodoTask,
  UpdateTaskPayload,
} from '../../api/todos';

export interface TaskInspectorModalProps {
  open: boolean;
  task: TodoTask | null;
  allTasks: readonly TodoTask[];
  projects: readonly ProjectItem[];
  timeSessions: readonly TimeSessionItem[];
  errorMessage?: string | null;
  isSaving?: boolean;
  onClose: () => void;
  onSaveTask: (taskId: string, payload: UpdateTaskPayload) => Promise<void> | void;
  onDeleteTask: (taskId: string) => Promise<void> | void;
  onLogTimeSession: (taskId: string, durationMinutes: number, notes: string) => Promise<void> | void;
  onDeleteTimeSession: (sessionId: string) => Promise<void> | void;
}

export function TaskInspectorModal({
  open,
  task,
  allTasks,
  projects,
  timeSessions,
  errorMessage,
  isSaving = false,
  onClose,
  onSaveTask,
  onDeleteTask,
  onLogTimeSession,
  onDeleteTimeSession,
}: TaskInspectorModalProps) {
  const [title, setTitle] = useState('');
  const [descriptionMd, setDescriptionMd] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [energyLevel, setEnergyLevel] = useState<TaskEnergyLevel | ''>('deep');
  const [projectId, setProjectId] = useState<string>('');
  const [goalId, setGoalId] = useState<string>('');
  const [courseId, setCourseId] = useState<string>('');
  const [parentTaskId, setParentTaskId] = useState<string>('');
  const [blockedByIds, setBlockedByIds] = useState<string[]>([]);
  const [scheduledDate, setScheduledDate] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [estimatedMinutes, setEstimatedMinutes] = useState<string>('30');
  const [tagsText, setTagsText] = useState<string>('');
  const [vaultNotePath, setVaultNotePath] = useState<string>('');

  const [sessionMinutes, setSessionMinutes] = useState<string>('25');
  const [sessionNotes, setSessionNotes] = useState<string>('');

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescriptionMd(task.description_md ?? '');
    setStatus(task.status);
    setPriority(task.priority);
    setEnergyLevel(task.energy_level ?? '');
    setProjectId(task.project_id ?? '');
    setGoalId(task.goal_id ?? '');
    setCourseId(task.course_id ?? '');
    setParentTaskId(task.parent_task_id ?? '');
    setBlockedByIds(task.blocked_by_task_ids ?? []);
    setScheduledDate(task.scheduled_date ? task.scheduled_date.slice(0, 10) : '');
    setDueDate(task.due_date ? task.due_date.slice(0, 10) : '');
    setEstimatedMinutes(String(task.estimated_minutes ?? 30));
    setTagsText((task.tags ?? []).join(', '));
    setVaultNotePath(task.vault_note_path ?? '');
  }, [task]);

  if (!open || !task) return null;

  const candidateTasks = allTasks.filter((t) => !t.deleted_at);

  const toggleBlocker = (blockerId: string) => {
    setBlockedByIds((prev) =>
      prev.includes(blockerId)
        ? prev.filter((id) => id !== blockerId)
        : [...prev, blockerId],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;

    const estNum = Number.parseInt(estimatedMinutes, 10);
    const parsedTags = tagsText
      .split(',')
      .map((s) => s.trim().replace(/^#/, '').toLowerCase())
      .filter(Boolean);

    await onSaveTask(task.id, {
      title: cleanTitle,
      description_md: descriptionMd,
      status,
      priority,
      energy_level: energyLevel || null,
      project_id: projectId || null,
      goal_id: goalId.trim() || null,
      course_id: courseId.trim() || null,
      parent_task_id: parentTaskId || null,
      blocked_by_task_ids: blockedByIds,
      scheduled_date: scheduledDate || null,
      due_date: dueDate || null,
      estimated_minutes: Number.isFinite(estNum) && estNum >= 0 ? estNum : 30,
      tags: parsedTags,
      vault_note_path: vaultNotePath.trim() || null,
    });
  };

  const handleLogSession = async (e: React.FormEvent) => {
    e.preventDefault();
    const mins = Number.parseInt(sessionMinutes, 10);
    if (!Number.isFinite(mins) || mins <= 0) return;
    await onLogTimeSession(task.id, mins, sessionNotes.trim());
    setSessionNotes('');
  };

  return (
    <FuiModal
      open={open}
      onClose={onClose}
      title={`TASK INSPECTOR // ${task.title}`}
      code={`ID:${task.id.slice(0, 8)}`}
      accent="orange"
      maxWidthPx={720}
      footer={
        <div
          style={{
            display: 'flex',
            width: '100%',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            borderRadius: '0px',
          }}
        >
          <FuiButton
            data-testid="inspector-delete-task-btn"
            variant="danger"
            size="sm"
            onClick={() => onDeleteTask(task.id)}
          >
            DELETE TASK
          </FuiButton>
          <div style={{ display: 'flex', gap: '8px', borderRadius: '0px' }}>
            <FuiButton variant="secondary" size="sm" onClick={onClose}>
              CLOSE
            </FuiButton>
            <FuiButton
              data-testid="inspector-save-task-btn"
              variant="primary"
              size="sm"
              loading={isSaving}
              onClick={handleSubmit}
            >
              SAVE CHANGES
            </FuiButton>
          </div>
        </div>
      }
    >
      <div
        data-testid="task-inspector-modal"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          maxHeight: '72vh',
          overflowY: 'auto',
          fontFamily: FUI_TOKENS.fontMono,
          fontSize: '12px',
          borderRadius: '0px',
        }}
      >
        {errorMessage && (
          <div
            data-testid="task-cycle-error-alert"
            role="alert"
            style={{
              padding: '10px 12px',
              backgroundColor: '#2A0D08',
              border: `1px solid ${FUI_TOKENS.accentVermilion}`,
              color: FUI_TOKENS.accentVermilion,
              fontWeight: 700,
              fontSize: '12px',
              borderRadius: '0px',
            }}
          >
            {errorMessage}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '10px',
            borderRadius: '0px',
          }}
        >
          <div style={{ gridColumn: '1 / -1', borderRadius: '0px' }}>
            <FuiInput
              data-testid="inspector-title-input"
              label="TASK TITLE"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <FuiSelect
            data-testid="inspector-status-select"
            label="STATUS"
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
            options={[
              { value: 'inbox', label: 'INBOX' },
              { value: 'backlog', label: 'BACKLOG / SOMEDAY' },
              { value: 'todo', label: 'TODO' },
              { value: 'in_progress', label: 'IN PROGRESS' },
              { value: 'review', label: 'REVIEW' },
              { value: 'done', label: 'DONE' },
              { value: 'canceled', label: 'CANCELED' },
            ]}
          />

          <FuiSelect
            data-testid="inspector-priority-select"
            label="PRIORITY"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            options={[
              { value: 'urgent', label: '!URGENT (P0)' },
              { value: 'high', label: '!HIGH (P1)' },
              { value: 'medium', label: '!MEDIUM (P2)' },
              { value: 'low', label: '!LOW (P3)' },
            ]}
          />

          <FuiSelect
            data-testid="inspector-energy-select"
            label="ENERGY LEVEL"
            value={energyLevel}
            onChange={(e) => setEnergyLevel(e.target.value as TaskEnergyLevel | '')}
            options={[
              { value: '', label: 'NONE' },
              { value: 'deep', label: '@DEEP_WORK' },
              { value: 'shallow', label: '@SHALLOW' },
              { value: 'quick', label: '@QUICK (5M)' },
            ]}
          />

          <FuiSelect
            data-testid="inspector-project-select"
            label="PROJECT"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            options={[
              { value: '', label: 'UNASSIGNED' },
              ...projects.map((p) => ({
                value: p.id,
                label: `${p.name} (${p.area.toUpperCase()})`,
              })),
            ]}
          />

          <FuiSelect
            data-testid="inspector-parent-select"
            label="PARENT TASK (SUBTASK OF)"
            value={parentTaskId}
            onChange={(e) => setParentTaskId(e.target.value)}
            options={[
              { value: '', label: 'ROOT TASK (NO PARENT)' },
              ...candidateTasks.map((t) => ({
                value: t.id,
                label: `${t.title}${t.id === task.id ? ' [SELF]' : ''}`,
              })),
            ]}
          />

          <FuiInput
            data-testid="inspector-estimate-input"
            label="ESTIMATED MINUTES"
            type="number"
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(e.target.value)}
          />

          <FuiInput
            data-testid="inspector-scheduled-input"
            label="SCHEDULED DATE (YYYY-MM-DD)"
            type="text"
            placeholder="YYYY-MM-DD"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
          />

          <FuiInput
            data-testid="inspector-due-input"
            label="DEADLINE / DUE DATE (YYYY-MM-DD)"
            type="text"
            placeholder="YYYY-MM-DD"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />

          <FuiInput
            data-testid="inspector-tags-input"
            label="TAGS (COMMA SEPARATED)"
            type="text"
            placeholder="systems, rust, deep"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
          />

          <FuiInput
            data-testid="inspector-vault-path-input"
            label="OBSIDIAN VAULT NOTE PATH"
            type="text"
            placeholder="Notes/Project-Spec.md"
            value={vaultNotePath}
            onChange={(e) => setVaultNotePath(e.target.value)}
          />

          <FuiInput
            data-testid="inspector-goal-id-input"
            label="LINKED GOAL ID (OPTIONAL)"
            type="text"
            placeholder="UUIDv7 Goal ID"
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
          />

          <FuiInput
            data-testid="inspector-course-id-input"
            label="LINKED COURSE ID (OPTIONAL)"
            type="text"
            placeholder="UUIDv7 Course ID"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
          />

          <div style={{ gridColumn: '1 / -1', borderRadius: '0px' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '4px',
                color: FUI_TOKENS.inkMuted,
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              MARKDOWN NOTES / DESCRIPTION
            </label>
            <textarea
              data-testid="inspector-description-textarea"
              rows={3}
              value={descriptionMd}
              onChange={(e) => setDescriptionMd(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                color: FUI_TOKENS.inkStark,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            />
          </div>
        </form>

        {/* Dependencies (blocked_by_task_ids) Selector */}
        <div
          style={{
            padding: '10px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            borderRadius: '0px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '6px',
              borderRadius: '0px',
            }}
          >
            <span style={{ fontWeight: 700, color: FUI_TOKENS.inkStark }}>
              DEPENDENCIES // BLOCKED BY TASKS (REF-05 DAG)
            </span>
            <FuiBadge tone={blockedByIds.length > 0 ? 'vermilion' : 'muted'}>
              {blockedByIds.length} SELECTED
            </FuiBadge>
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              borderRadius: '0px',
            }}
          >
            {candidateTasks.map((cand) => {
              const active = blockedByIds.includes(cand.id);
              return (
                <FuiButton
                  key={cand.id}
                  data-testid={`inspector-blocker-toggle-${cand.id}`}
                  variant={active ? 'danger' : 'secondary'}
                  size="sm"
                  onClick={() => toggleBlocker(cand.id)}
                >
                  {active ? '■ BLOCKED BY: ' : '+ '}
                  {cand.title}
                  {cand.id === task.id ? ' (SELF)' : ''}
                </FuiButton>
              );
            })}
          </div>
        </div>

        {/* Manual Time Session Logger & History */}
        <div
          style={{
            padding: '10px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            borderRadius: '0px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderRadius: '0px',
            }}
          >
            <span style={{ fontWeight: 700, color: FUI_TOKENS.inkStark }}>
              FOCUS TIME SESSIONS // LOGGED: {Math.round((task.actual_seconds ?? 0) / 60)} MIN
            </span>
            <FuiBadge tone="cyan">{timeSessions.length} SESSIONS</FuiBadge>
          </div>

          <form
            onSubmit={handleLogSession}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              gap: '8px',
              borderRadius: '0px',
            }}
          >
            <div style={{ width: '120px', borderRadius: '0px' }}>
              <FuiInput
                data-testid="inspector-log-minutes-input"
                label="MINUTES"
                type="number"
                value={sessionMinutes}
                onChange={(e) => setSessionMinutes(e.target.value)}
              />
            </div>
            <div style={{ flex: 1, minWidth: '180px', borderRadius: '0px' }}>
              <FuiInput
                data-testid="inspector-log-notes-input"
                label="SESSION NOTES"
                type="text"
                placeholder="Completed deep work block..."
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
              />
            </div>
            <FuiButton
              data-testid="inspector-log-session-btn"
              type="submit"
              variant="cyan"
              size="md"
            >
              + LOG SESSION
            </FuiButton>
          </form>

          {timeSessions.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                borderRadius: '0px',
              }}
            >
              {timeSessions.slice(0, 6).map((sess) => (
                <div
                  key={sess.id}
                  data-testid={`time-session-row-${sess.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 8px',
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    backgroundColor: FUI_TOKENS.bgPanel,
                    borderRadius: '0px',
                  }}
                >
                  <span>
                    {Math.round((sess.duration_seconds ?? 0) / 60)}M • {sess.timer_mode} •{' '}
                    {sess.notes || 'Focus block'}
                  </span>
                  <FuiButton
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteTimeSession(sess.id)}
                  >
                    DELETE
                  </FuiButton>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </FuiModal>
  );
}
