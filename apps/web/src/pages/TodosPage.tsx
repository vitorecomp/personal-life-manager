import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FuiBadge,
  FuiButton,
  FuiPanel,
  FuiTabs,
  FUI_TOKENS,
  fuiHatchStyle,
} from '@hermes/ui';
import {
  createProject,
  createTask,
  createTimeSession,
  deleteTask,
  deleteTimeSession,
  getActiveTimer,
  getTaskFlow,
  getTodayCapacity,
  listProjects,
  listTasks,
  listTimeSessions,
  startTimer,
  stopTimer,
  updateTask,
  updateTaskStatus,
  type ProjectArea,
  type ProjectItem,
  type TaskEnergyLevel,
  type TaskPriority,
  type TaskStatus,
  type TodoTask,
  type UpdateTaskPayload,
} from '../api/todos';
import {
  computeTodayCapacity,
  extractCycleDetectedError,
  FALLBACK_PROJECTS,
  FALLBACK_TASKS,
  filterTasksForView,
  parseInlineQuickCapture,
  type GtdPerspective,
  type TodoLayoutMode,
} from '../components/todos/todosModel';
import { SignalListView } from '../components/todos/SignalListView';
import { ProjectFlowView } from '../components/todos/ProjectFlowView';
import { EisenhowerMatrixView } from '../components/todos/EisenhowerMatrixView';
import { TaskInspectorModal } from '../components/todos/TaskInspectorModal';
import { useAppStore } from '../store/appStore';

export function TodosPage() {
  const queryClient = useQueryClient();
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity);

  const [perspective, setPerspective] = useState<GtdPerspective>('all');
  const [layoutMode, setLayoutMode] = useState<TodoLayoutMode>('signal');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all');
  const [energyFilter, setEnergyFilter] = useState<TaskEnergyLevel | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [quickCaptureText, setQuickCaptureText] = useState<string>('');
  const [pageBannerError, setPageBannerError] = useState<string | null>(null);

  const [showNewProjectForm, setShowNewProjectForm] = useState<boolean>(false);
  const [newProjectName, setNewProjectName] = useState<string>('');
  const [newProjectArea, setNewProjectArea] = useState<ProjectArea>('system');

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [inspectedTask, setInspectedTask] = useState<TodoTask | null>(null);
  const [inspectorError, setInspectorError] = useState<string | null>(null);

  // 1. Queries
  const { data: fetchedTasks, isError: tasksError } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => listTasks(),
  });

  const { data: fetchedProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      try {
        return await listProjects();
      } catch {
        return [];
      }
    },
  });

  const { data: apiCapacity } = useQuery({
    queryKey: ['tasks-capacity'],
    queryFn: async () => {
      try {
        return await getTodayCapacity();
      } catch {
        return null;
      }
    },
  });

  const activeProjectFilterId =
    selectedProjectId && selectedProjectId !== 'all' ? selectedProjectId : null;

  const { data: apiFlow } = useQuery({
    queryKey: ['tasks-flow', activeProjectFilterId],
    queryFn: async () => {
      try {
        return await getTaskFlow(activeProjectFilterId);
      } catch {
        return null;
      }
    },
  });

  const { data: activeTimer } = useQuery({
    queryKey: ['active-timer'],
    queryFn: async () => {
      try {
        return await getActiveTimer();
      } catch {
        return { running: false, session: null, elapsed_seconds: 0 };
      }
    },
  });

  const { data: inspectedTaskSessions = [] } = useQuery({
    queryKey: ['time-sessions', inspectedTask?.id],
    queryFn: async () => {
      if (!inspectedTask?.id) return [];
      try {
        return await listTimeSessions({ task_id: inspectedTask.id, limit: 25 });
      } catch {
        return [];
      }
    },
    enabled: Boolean(inspectedTask?.id),
  });

  const projects: readonly ProjectItem[] = useMemo(() => {
    if (fetchedProjects && fetchedProjects.length > 0) return fetchedProjects;
    return FALLBACK_PROJECTS;
  }, [fetchedProjects]);

  const allTasks: readonly TodoTask[] = useMemo(() => {
    if (fetchedTasks && fetchedTasks.length > 0) return fetchedTasks;
    if (tasksError || !fetchedTasks) return FALLBACK_TASKS;
    return FALLBACK_TASKS;
  }, [fetchedTasks, tasksError]);

  const invalidateTodoQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['tasks-capacity'] });
    queryClient.invalidateQueries({ queryKey: ['tasks-flow'] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    queryClient.invalidateQueries({ queryKey: ['goals'] });
  };

  // 2. Mutations
  const createTaskMutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      setPageBannerError(null);
      invalidateTodoQueries();
    },
    onError: (err: unknown) => {
      setPageBannerError(extractCycleDetectedError(err));
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTaskPayload }) =>
      updateTask(id, payload),
    onSuccess: (updated) => {
      setInspectorError(null);
      setPageBannerError(null);
      setInspectedTask(updated);
      invalidateTodoQueries();
    },
    onError: (err: unknown) => {
      const formatted = extractCycleDetectedError(err);
      setInspectorError(formatted);
      setPageBannerError(formatted);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      updateTaskStatus(id, status),
    onSuccess: () => {
      invalidateTodoQueries();
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: () => {
      setInspectedTask(null);
      invalidateTodoQueries();
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (created) => {
      setNewProjectName('');
      setShowNewProjectForm(false);
      setSelectedProjectId(created.id);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['tasks-flow'] });
    },
  });

  const toggleTimerMutation = useMutation({
    mutationFn: async (task: TodoTask) => {
      const runningTaskId = activeTimer?.running ? activeTimer?.session?.task_id : null;
      if (activeTimer?.running && runningTaskId && String(runningTaskId) === String(task.id)) {
        await stopTimer({ notes: `Completed focus block on ${task.title}` });
        return { stopped: true };
      }
      await startTimer({
        task_id: task.id,
        category: task.energy_level === 'deep' ? 'deep_work' : 'admin',
        timer_mode: 'pomodoro_25_5',
        work_minutes: 25,
        break_minutes: 5,
      });
      return { stopped: false };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-timer'] });
      queryClient.invalidateQueries({ queryKey: ['time-stats'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks-capacity'] });
      queryClient.invalidateQueries({ queryKey: ['tasks-flow'] });
    },
  });

  const logSessionMutation = useMutation({
    mutationFn: ({
      taskId,
      durationMinutes,
      notes,
    }: {
      taskId: string;
      durationMinutes: number;
      notes: string;
    }) =>
      createTimeSession({
        task_id: taskId,
        category: 'deep_work',
        timer_mode: 'pomodoro_25_5',
        duration_seconds: durationMinutes * 60,
        notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks-capacity'] });
      queryClient.invalidateQueries({ queryKey: ['time-stats'] });
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => deleteTimeSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks-capacity'] });
      queryClient.invalidateQueries({ queryKey: ['time-stats'] });
    },
  });

  // 3. Derived Model State
  const liveQuickPreview = useMemo(() => {
    const trimmed = quickCaptureText.trim();
    if (!trimmed) return null;
    return parseInlineQuickCapture(trimmed);
  }, [quickCaptureText]);

  const capacity = useMemo(
    () => computeTodayCapacity(allTasks, apiCapacity),
    [allTasks, apiCapacity],
  );

  const filtered = useMemo(
    () =>
      filterTasksForView(
        allTasks,
        {
          perspective,
          selectedProjectId,
          searchQuery,
          priorityFilter,
          energyFilter,
        },
        projects,
      ),
    [allTasks, perspective, selectedProjectId, searchQuery, priorityFilter, energyFilter, projects],
  );

  const selectedProjectObj = useMemo(
    () =>
      selectedProjectId && selectedProjectId !== 'all'
        ? (projects.find((p) => p.id === selectedProjectId) ?? null)
        : null,
    [projects, selectedProjectId],
  );

  // 4. Handlers
  const handleQuickCaptureSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = quickCaptureText.trim();
    // CRITICAL E2E Rule (T2:361-385): Empty or whitespace-only string must do nothing!
    if (!trimmed) {
      return;
    }

    const parsed = parseInlineQuickCapture(trimmed);
    const cleanTitle = (parsed.clean_title || parsed.title || trimmed).trim();
    if (!cleanTitle) {
      return;
    }

    let resolvedProjectId: string | undefined =
      selectedProjectId && selectedProjectId !== 'all' ? selectedProjectId : undefined;
    if (!resolvedProjectId && parsed.project_hint) {
      const hintLower = parsed.project_hint.toLowerCase();
      const matchedProj = projects.find(
        (p) => p.name.toLowerCase().replace(/\s+/g, '') === hintLower.replace(/\s+/g, ''),
      );
      if (matchedProj) {
        resolvedProjectId = matchedProj.id;
      }
    }

    await createTaskMutation.mutateAsync({
      title: cleanTitle,
      quick_capture: trimmed,
      tags: parsed.tags,
      priority: (parsed.priority as TaskPriority) ?? 'medium',
      energy_level: (parsed.energy_level as TaskEnergyLevel) ?? null,
      scheduled_date: parsed.scheduled_date ?? null,
      due_date: parsed.due_at ?? null,
      estimated_minutes: parsed.estimated_minutes ?? null,
      status: (parsed.status as TaskStatus) ?? 'todo',
      project_id: resolvedProjectId ?? null,
    });

    setQuickCaptureText('');
  };

  const handleCreateNewProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newProjectName.trim();
    if (!clean) return;
    await createProjectMutation.mutateAsync({
      name: clean,
      area: newProjectArea,
      status: 'active',
      color: '#F87C18',
    });
  };

  const handleSelectTask = (task: TodoTask) => {
    setSelectedTaskId(task.id);
    setSelectedEntity(task.id, task.title);
  };

  const handleInspectTask = (task: TodoTask) => {
    setSelectedTaskId(task.id);
    setSelectedEntity(task.id, task.title);
    setInspectorError(null);
    setInspectedTask(task);
  };

  const handleCreateSubtask = (parentTask: TodoTask, subTitle: string) => {
    const clean = subTitle.trim();
    if (!clean) return;
    createTaskMutation.mutate({
      title: clean,
      status: 'todo',
      priority: parentTask.priority,
      project_id: parentTask.project_id ?? null,
      parent_task_id: parentTask.id,
      scheduled_date: parentTask.scheduled_date ?? null,
      estimated_minutes: 20,
    });
  };

  const plannedHours = Number((capacity.planned_minutes / 60).toFixed(1));
  const capacityHours = Number((capacity.focus_capacity_minutes / 60).toFixed(1));
  const clampedUtilBarPct = Math.min(100, Math.max(0, Math.round(capacity.utilization_pct)));

  const activeTimerTaskId = activeTimer?.running ? activeTimer?.session?.task_id : null;

  const perspectiveTabs = useMemo(
    () => [
      { id: 'all' as const, code: '00', label: 'ALL TASKS' },
      { id: 'inbox' as const, code: '01', label: 'INBOX' },
      { id: 'today' as const, code: '02', label: 'TODAY' },
      { id: 'upcoming' as const, code: '03', label: 'UPCOMING' },
      { id: 'projects' as const, code: '04', label: 'PROJECTS' },
      { id: 'someday' as const, code: '05', label: 'SOMEDAY' },
    ],
    [],
  );

  const layoutTabs = useMemo(
    () => [
      {
        id: 'signal' as const,
        code: 'REF-05',
        label: 'SIGNAL LIST (REF-05)',
      },
      {
        id: 'flow' as const,
        code: 'REF-04',
        label: 'PROJECT FLOW (TERMINAL-I/O)',
      },
      {
        id: 'matrix' as const,
        code: '2x2',
        label: 'EISENHOWER MATRIX (URGENT / IMPORTANT)',
      },
    ],
    [],
  );

  return (
    <div
      data-testid="todos-page"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        minWidth: 0,
        overflowX: 'hidden',
        borderRadius: '0px',
      }}
    >
      {/* 1. Today Capacity Meter & Top Telemetry Deck */}
      <FuiPanel
        data-testid="today-capacity-meter"
        padding="md"
        headerProps={{
          title: 'TODO LIST // TERMINAL-I/O EXECUTION MATRIX (MODULE 07)',
          code: 'MOD_07',
          accent: capacity.overloaded ? 'vermilion' : 'orange',
          actions: (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '0px' }}>
              <FuiBadge tone={capacity.overloaded ? 'vermilion' : 'phosphor'} solid={capacity.overloaded}>
                {capacity.overloaded ? 'CAPACITY OVERLOAD' : 'CAPACITY NOMINAL'}
              </FuiBadge>
              <FuiBadge tone="cyan">
                {allTasks.length} TASKS
              </FuiBadge>
            </div>
          ),
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            borderRadius: '0px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              borderRadius: '0px',
            }}
          >
            <span style={{ fontWeight: 700, color: FUI_TOKENS.inkStark }}>
              TODAY CAPACITY // PLANNED: {capacity.planned_minutes} MIN ({plannedHours} HR) /{' '}
              {capacity.focus_capacity_minutes} MIN ({capacityHours} HR) • ACTUAL:{' '}
              {capacity.actual_minutes} MIN
            </span>
            <span
              style={{
                fontWeight: 700,
                color: capacity.overloaded
                  ? FUI_TOKENS.accentVermilion
                  : FUI_TOKENS.accentPhosphor,
              }}
            >
              UTILIZATION: {capacity.utilization_pct}% • REMAINING: {capacity.remaining_minutes} MIN
            </span>
          </div>

          {/* Segmented 0px Capacity Bar */}
          <div
            style={{
              width: '100%',
              height: '10px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${
                capacity.overloaded ? FUI_TOKENS.accentVermilion : FUI_TOKENS.borderHairline
              }`,
              borderRadius: '0px',
            }}
          >
            <div
              style={{
                width: `${clampedUtilBarPct}%`,
                height: '100%',
                backgroundColor: capacity.overloaded
                  ? FUI_TOKENS.accentVermilion
                  : FUI_TOKENS.accentOrange,
                borderRadius: '0px',
              }}
            />
          </div>

          {/* Overload Warning Banner when planned_minutes > focus_capacity_minutes */}
          {capacity.overloaded && (
            <div
              data-testid="capacity-overload-banner"
              role="status"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                padding: '8px 12px',
                border: `1px solid ${FUI_TOKENS.accentVermilion}`,
                color: FUI_TOKENS.inkStark,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                ...fuiHatchStyle(FUI_TOKENS.accentVermilion, 2, 8, '#2A0D08'),
                borderRadius: '0px',
              }}
            >
              <span>
                OVERLOAD WARNING // PLANNED {capacity.planned_minutes} MIN ({plannedHours} HR) EXCEEDS{' '}
                {capacity.focus_capacity_minutes} MIN ({capacityHours} HR) TODAY FOCUS CAPACITY
              </span>
              <FuiBadge tone="vermilion" solid>
                OVERLOAD {capacity.planned_minutes}M
              </FuiBadge>
            </div>
          )}
        </div>
      </FuiPanel>

      {/* 2. Inline NLP Quick-Capture Bar (MUST be first input[type="text"]) + Search Input (input[type="search"]) */}
      <FuiPanel
        padding="md"
        headerProps={{
          title: 'INLINE NLP QUICK CAPTURE & TACTICAL FILTER',
          code: 'NLP_INGEST',
          accent: 'cyan',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            borderRadius: '0px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 2fr) minmax(220px, 1fr)',
              gap: '10px',
              alignItems: 'center',
              borderRadius: '0px',
            }}
          >
            {/* First input[type="text"] on /todos: Inline NLP Quick-Capture */}
            <form
              onSubmit={handleQuickCaptureSubmit}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                minWidth: 0,
                borderRadius: '0px',
              }}
            >
              <input
                type="text"
                data-testid="todos-quick-capture-input"
                aria-label="Quick capture task with NLP tokens"
                placeholder="Quick capture task... (#tag @deep_work !high today 45m)"
                value={quickCaptureText}
                onChange={(e) => setQuickCaptureText(e.target.value)}
                style={{
                  flex: 1,
                  minHeight: '34px',
                  padding: '6px 10px',
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${FUI_TOKENS.accentOrange}`,
                  color: FUI_TOKENS.inkStark,
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '13px',
                  borderRadius: '0px',
                }}
              />
              <FuiButton
                data-testid="todos-quick-capture-submit"
                type="submit"
                variant="primary"
                size="md"
              >
                + CAPTURE
              </FuiButton>
            </form>

            {/* Search Input: MUST be input[type="search"] */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                minWidth: 0,
                borderRadius: '0px',
              }}
            >
              <input
                type="search"
                data-testid="todos-search-input"
                aria-label="Search or filter tasks"
                placeholder="Search or filter tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  flex: 1,
                  minHeight: '34px',
                  padding: '6px 10px',
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  color: FUI_TOKENS.inkStark,
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '13px',
                  borderRadius: '0px',
                }}
              />
              {searchQuery && (
                <FuiButton
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearchQuery('')}
                >
                  CLEAR
                </FuiButton>
              )}
            </div>
          </div>

          {/* Live NLP Token Preview Strip */}
          {liveQuickPreview && (
            <div
              data-testid="todos-quick-capture-preview"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '6px',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              <FuiBadge tone="stark">
                TITLE: {liveQuickPreview.clean_title}
              </FuiBadge>
              {liveQuickPreview.tags.map((t) => (
                <FuiBadge key={t} tone="orange">
                  #{t}
                </FuiBadge>
              ))}
              {liveQuickPreview.project_hint && (
                <FuiBadge tone="cyan">+{liveQuickPreview.project_hint}</FuiBadge>
              )}
              {liveQuickPreview.energy_level && (
                <FuiBadge tone="cyan">@{liveQuickPreview.energy_level}</FuiBadge>
              )}
              {liveQuickPreview.priority && (
                <FuiBadge tone="vermilion">!{liveQuickPreview.priority}</FuiBadge>
              )}
              {liveQuickPreview.scheduled_date && (
                <FuiBadge tone="phosphor">SCHED: {liveQuickPreview.scheduled_date}</FuiBadge>
              )}
              {liveQuickPreview.estimated_minutes && (
                <FuiBadge tone="amber">~{liveQuickPreview.estimated_minutes}M</FuiBadge>
              )}
            </div>
          )}

          {pageBannerError && (
            <div
              data-testid="todos-page-error-banner"
              role="alert"
              style={{
                padding: '8px 12px',
                backgroundColor: '#2A0D08',
                border: `1px solid ${FUI_TOKENS.accentVermilion}`,
                color: FUI_TOKENS.accentVermilion,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '0px',
              }}
            >
              {pageBannerError}
            </div>
          )}
        </div>
      </FuiPanel>

      {/* 3. GTD Smart Perspectives & 3-Layout Switcher Deck */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          backgroundColor: FUI_TOKENS.bgPanel,
          border: `1px solid ${FUI_TOKENS.borderHairline}`,
          padding: '10px',
          borderRadius: '0px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            borderRadius: '0px',
          }}
        >
          <FuiTabs
            ariaLabel="GTD Smart Perspectives"
            tabs={perspectiveTabs}
            activeTab={perspective}
            onTabChange={(next) => setPerspective(next)}
          />

          <FuiTabs
            ariaLabel="Tactical Layout Mode Switcher"
            variant="solid"
            tabs={layoutTabs}
            activeTab={layoutMode}
            onTabChange={(next) => setLayoutMode(next)}
          />
        </div>

        {/* Project & Attribute Filter Strip */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            paddingTop: '6px',
            borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            borderRadius: '0px',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', borderRadius: '0px' }}>
            <span style={{ color: FUI_TOKENS.inkMuted }}>PROJECT SCOPE:</span>
            <FuiButton
              variant={selectedProjectId === 'all' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSelectedProjectId('all')}
            >
              ALL PROJECTS
            </FuiButton>
            {projects.map((p) => (
              <FuiButton
                key={p.id}
                data-testid={`project-filter-btn-${p.id}`}
                variant={selectedProjectId === p.id ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setSelectedProjectId(p.id)}
              >
                {p.name}
              </FuiButton>
            ))}
            <FuiButton
              data-testid="toggle-new-project-btn"
              variant="ghost"
              size="sm"
              onClick={() => setShowNewProjectForm((prev) => !prev)}
            >
              {showNewProjectForm ? '✕ CANCEL' : '+ NEW PROJECT'}
            </FuiButton>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', borderRadius: '0px' }}>
            <select
              data-testid="todos-priority-filter"
              aria-label="Filter by priority"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | 'all')}
              style={{
                minHeight: '28px',
                padding: '4px 8px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                color: FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              <option value="all">PRIORITY: ALL</option>
              <option value="urgent">!URGENT</option>
              <option value="high">!HIGH</option>
              <option value="medium">!MEDIUM</option>
              <option value="low">!LOW</option>
            </select>

            <select
              data-testid="todos-energy-filter"
              aria-label="Filter by energy level"
              value={energyFilter}
              onChange={(e) => setEnergyFilter(e.target.value as TaskEnergyLevel | 'all')}
              style={{
                minHeight: '28px',
                padding: '4px 8px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                color: FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              <option value="all">ENERGY: ALL</option>
              <option value="deep">@DEEP</option>
              <option value="shallow">@SHALLOW</option>
              <option value="quick">@QUICK</option>
            </select>
          </div>
        </div>

        {showNewProjectForm && (
          <form
            data-testid="new-project-form"
            onSubmit={handleCreateNewProject}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '8px',
              padding: '8px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.accentOrange}`,
              borderRadius: '0px',
            }}
          >
            <input
              type="text"
              data-testid="new-project-name-input"
              aria-label="New project name"
              placeholder="Project name (e.g. Raft Storage Engine)"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              style={{
                flex: 1,
                minWidth: '180px',
                minHeight: '30px',
                padding: '4px 8px',
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                color: FUI_TOKENS.inkStark,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            />
            <select
              data-testid="new-project-area-select"
              aria-label="New project area"
              value={newProjectArea}
              onChange={(e) => setNewProjectArea(e.target.value as ProjectArea)}
              style={{
                minHeight: '30px',
                padding: '4px 8px',
                backgroundColor: FUI_TOKENS.bgPanel,
                color: FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              <option value="system">AREA: SYSTEM</option>
              <option value="work">AREA: WORK</option>
              <option value="learning">AREA: LEARNING</option>
              <option value="health">AREA: HEALTH</option>
              <option value="finance">AREA: FINANCE</option>
              <option value="personal">AREA: PERSONAL</option>
            </select>
            <FuiButton
              data-testid="create-project-submit-btn"
              type="submit"
              variant="primary"
              size="sm"
            >
              CREATE PROJECT
            </FuiButton>
          </form>
        )}
      </div>

      {/* 4. Active Layout Canvas (Signal List REF-05, Project Flow REF-04, Eisenhower Matrix) */}
      <FuiPanel
        padding="md"
        headerProps={{
          title:
            layoutMode === 'signal'
              ? `TACTICAL SIGNAL LIST // REF-05 (${perspective.toUpperCase()})`
              : layoutMode === 'flow'
                ? `PROJECT FLOW TOPOLOGY // REF-04 TERMINAL-I/O`
                : `EISENHOWER MATRIX // 4-QUADRANT PRIORITIZATION`,
          code:
            layoutMode === 'signal'
              ? 'REF_05'
              : layoutMode === 'flow'
                ? 'REF_04'
                : 'MAT_2X2',
          accent: 'orange',
          actions: (
            <FuiBadge tone="stark">
              SHOWING {filtered.allMatchingTasks.length} TASKS
            </FuiBadge>
          ),
        }}
      >
        {filtered.allMatchingTasks.length === 0 ? (
          <div
            data-testid="todos-empty-state"
            style={{
              padding: '24px 16px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px dashed ${FUI_TOKENS.borderHairline}`,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: FUI_TOKENS.inkMuted,
              textAlign: 'center',
              borderRadius: '0px',
            }}
          >
            ZERO TASKS MATCH CURRENT PERSPECTIVE ({perspective.toUpperCase()}) OR FILTER QUERY.
          </div>
        ) : layoutMode === 'signal' ? (
          <SignalListView
            tasks={filtered.allMatchingTasks}
            allTasks={allTasks}
            projects={projects}
            activeTimerTaskId={activeTimerTaskId}
            isTimerRunning={Boolean(activeTimer?.running)}
            selectedTaskId={selectedTaskId}
            onSelectTask={handleSelectTask}
            onInspectTask={handleInspectTask}
            onToggleTaskStatus={(task, nextStatus) =>
              statusMutation.mutate({
                id: task.id,
                status: nextStatus ?? (task.status === 'done' ? 'todo' : 'done'),
              })
            }
            onChangePriority={(task, priority) =>
              updateTaskMutation.mutate({
                id: task.id,
                payload: { priority },
              })
            }
            onToggleTimer={(task) => toggleTimerMutation.mutate(task)}
            onCreateSubtask={handleCreateSubtask}
          />
        ) : layoutMode === 'flow' ? (
          <ProjectFlowView
            tasks={filtered.allMatchingTasks}
            allTasks={allTasks}
            apiFlow={apiFlow}
            selectedProject={selectedProjectObj}
            activeTimerTaskId={activeTimerTaskId}
            isTimerRunning={Boolean(activeTimer?.running)}
            onInspectTask={handleInspectTask}
            onTransitionStage={(taskId, nextStatus) =>
              statusMutation.mutate({ id: taskId, status: nextStatus })
            }
            onToggleTimer={(task) => toggleTimerMutation.mutate(task)}
          />
        ) : (
          <EisenhowerMatrixView
            tasks={filtered.allMatchingTasks}
            activeTimerTaskId={activeTimerTaskId}
            isTimerRunning={Boolean(activeTimer?.running)}
            onInspectTask={handleInspectTask}
            onChangePriority={(task, priority) =>
              updateTaskMutation.mutate({
                id: task.id,
                payload: { priority },
              })
            }
            onToggleTaskStatus={(task, nextStatus) =>
              statusMutation.mutate({
                id: task.id,
                status: nextStatus ?? (task.status === 'done' ? 'todo' : 'done'),
              })
            }
            onToggleTimer={(task) => toggleTimerMutation.mutate(task)}
          />
        )}
      </FuiPanel>

      {/* 5. Task & Dependency & TimeSession Inspector Modal */}
      <TaskInspectorModal
        open={Boolean(inspectedTask)}
        task={inspectedTask}
        allTasks={allTasks}
        projects={projects}
        timeSessions={inspectedTaskSessions}
        errorMessage={inspectorError}
        isSaving={updateTaskMutation.isPending}
        onClose={() => {
          setInspectedTask(null);
          setInspectorError(null);
        }}
        onSaveTask={async (taskId, payload) => {
          try {
            await updateTaskMutation.mutateAsync({ id: taskId, payload });
          } catch {
            // Handled via updateTaskMutation.onError -> setInspectorError
          }
        }}
        onDeleteTask={async (taskId) => {
          try {
            await deleteTaskMutation.mutateAsync(taskId);
          } catch {
            // Handled via mutation state
          }
        }}
        onLogTimeSession={async (taskId, durationMinutes, notes) => {
          try {
            await logSessionMutation.mutateAsync({ taskId, durationMinutes, notes });
          } catch {
            // Handled via mutation state
          }
        }}
        onDeleteTimeSession={async (sessionId) => {
          try {
            await deleteSessionMutation.mutateAsync(sessionId);
          } catch {
            // Handled via mutation state
          }
        }}
      />
    </div>
  );
}
