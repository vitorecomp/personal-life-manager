import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BinaryDotMatrix8x12,
  FuiBadge,
  FuiButton,
  FuiInput,
  FuiPanel,
  FuiSelect,
  FUI_TOKENS,
} from '@hermes/ui';
import {
  createRoutine,
  createRoutineItem,
  deleteRoutine,
  deleteRoutineItem,
  exportWeeklyReviewByKey,
  getDailyCheckin,
  getIdealWeek,
  getRoutineAnalytics,
  getWeeklyReviewSummary,
  listRoutineLogs,
  listRoutines,
  logRoutineItem,
  setActiveDayProfile,
  upsertDailyCheckin,
  upsertIdealWeek,
  upsertWeeklyReviewByKey,
  type IdealWeekBlock,
  type RoutineDayProfile,
  type RoutineFrequencyType,
  type RoutineItem,
  type RoutineLog,
  type RoutineLogStatus,
  type RoutineStackWithItems,
  type RoutineTimeSlot,
  type RoutineTrackingType,
  type UpsertDailyCheckinPayload,
  type UpsertWeeklyReviewPayload,
} from '../api/routines';
import { DailyPulseCheckinPanel } from '../components/routines/DailyPulseCheckinPanel';
import { GuidedRoutineRunnerModal } from '../components/routines/GuidedRoutineRunnerModal';
import { IdealWeekBlueprintPanel } from '../components/routines/IdealWeekBlueprintPanel';
import { WeeklyReviewWizardPanel } from '../components/routines/WeeklyReviewWizardPanel';
import {
  DAY_PROFILE_OPTIONS,
  ROUTINE_TIME_SLOT_ORDER,
  computeTopHabitStreak,
  filterRoutinesByDayProfile,
  formatQuantitativeHabitProgress,
  groupRoutinesByTimeSlot,
  isItemMvdIncluded,
  normalizeHeatmap365d,
  normalizeMatrix8x12,
  safeNumber,
} from '../components/routines/routinesModel';

type RoutinesWorkspaceTab = 'stacks' | 'ideal_week' | 'daily_pulse' | 'weekly_review';

const WORKSPACE_TABS: ReadonlyArray<{
  id: RoutinesWorkspaceTab;
  label: string;
  code: string;
}> = [
  { id: 'stacks', label: 'ROUTINES & HABIT STACKS', code: 'TAB_01' },
  { id: 'ideal_week', label: '7x24 IDEAL WEEK BLUEPRINT', code: 'TAB_02' },
  { id: 'daily_pulse', label: 'DAILY PULSE CHECK-IN', code: 'TAB_03' },
  { id: 'weekly_review', label: 'WEEKLY REVIEW WIZARD', code: 'TAB_04' },
];

export function RoutinesPage() {
  const queryClient = useQueryClient();
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [activeProfile, setActiveProfile] = useState<RoutineDayProfile>('workday');
  const [activeTab, setActiveTab] = useState<RoutinesWorkspaceTab>('stacks');
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);

  // Guided Routine Runner state
  const [runnerOpen, setRunnerOpen] = useState<boolean>(false);
  const [runnerStackId, setRunnerStackId] = useState<string | null>(null);

  // New Routine Stack form state
  const [showNewStackForm, setShowNewStackForm] = useState<boolean>(false);
  const [newStackName, setNewStackName] = useState<string>('');
  const [newStackSlot, setNewStackSlot] = useState<RoutineTimeSlot>('morning');
  const [newStackProfile, setNewStackProfile] = useState<RoutineDayProfile>('workday');
  const [newStackStartTime, setNewStackStartTime] = useState<string>('07:00');

  // Inline Add Habit Item state per stack
  const [addingItemForStackId, setAddingItemForStackId] = useState<string | null>(null);
  const [newItemTitle, setNewItemTitle] = useState<string>('');
  const [newItemTrackingType, setNewItemTrackingType] =
    useState<RoutineTrackingType>('boolean');
  const [newItemTargetValue, setNewItemTargetValue] = useState<string>('20');
  const [newItemUnit, setNewItemUnit] = useState<string>('min');
  const [newItemFrequency, setNewItemFrequency] = useState<RoutineFrequencyType>('daily');
  const [newItemMinutes, setNewItemMinutes] = useState<string>('10');
  const [newItemMvd, setNewItemMvd] = useState<boolean>(true);

  // Quantitative habit numeric draft values keyed by item.id
  const [quantDrafts, setQuantDrafts] = useState<Record<string, string>>({});

  // Queries
  const { data: routines = [] } = useQuery({
    queryKey: ['routines'],
    queryFn: async () => {
      try {
        return await listRoutines();
      } catch {
        return [];
      }
    },
  });

  const { data: routineLogs = [] } = useQuery({
    queryKey: ['routine-logs', selectedDate],
    queryFn: async () => {
      try {
        return await listRoutineLogs(selectedDate);
      } catch {
        return [];
      }
    },
  });

  const { data: analytics } = useQuery({
    queryKey: ['routines-analytics'],
    queryFn: async () => {
      try {
        return await getRoutineAnalytics();
      } catch {
        return null;
      }
    },
  });

  const { data: idealWeek } = useQuery({
    queryKey: ['ideal-week'],
    queryFn: async () => {
      try {
        return await getIdealWeek();
      } catch {
        return null;
      }
    },
  });

  const { data: dailyCheckin } = useQuery({
    queryKey: ['daily-checkin', selectedDate],
    queryFn: async () => {
      try {
        return await getDailyCheckin(selectedDate);
      } catch {
        return null;
      }
    },
  });

  const { data: weeklyReviewSummary } = useQuery({
    queryKey: ['weekly-review'],
    queryFn: async () => {
      try {
        return await getWeeklyReviewSummary();
      } catch {
        return null;
      }
    },
  });

  const invalidateAllRoutineQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['routines'] });
    queryClient.invalidateQueries({ queryKey: ['routine-logs'] });
    queryClient.invalidateQueries({ queryKey: ['routines-analytics'] });
    queryClient.invalidateQueries({ queryKey: ['ideal-week'] });
    queryClient.invalidateQueries({ queryKey: ['daily-checkin'] });
    queryClient.invalidateQueries({ queryKey: ['weekly-review'] });
    queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    queryClient.invalidateQueries({ queryKey: ['life-score'] });
  };

  // Mutations
  const switchDayProfileMutation = useMutation({
    mutationFn: async (profile: RoutineDayProfile) => {
      if (profile === 'all') return null;
      return setActiveDayProfile(profile, selectedDate);
    },
    onSuccess: () => {
      invalidateAllRoutineQueries();
    },
  });

  const logHabitMutation = useMutation({
    mutationFn: async (payload: {
      routine_item_id: string;
      log_date: string;
      status: RoutineLogStatus;
      numeric_value?: number | null;
      notes?: string;
    }) => {
      return logRoutineItem(payload);
    },
    onSuccess: () => {
      invalidateAllRoutineQueries();
    },
  });

  const createStackMutation = useMutation({
    mutationFn: async () => {
      const trimmed = newStackName.trim();
      if (!trimmed) throw new Error('Routine stack name cannot be empty.');
      return createRoutine({
        name: trimmed,
        time_slot: newStackSlot,
        day_profile: newStackProfile === 'all' ? 'workday' : newStackProfile,
        target_start_time:
          newStackStartTime.length === 5 ? `${newStackStartTime}:00` : newStackStartTime,
        active: true,
      });
    },
    onSuccess: () => {
      setNewStackName('');
      setShowNewStackForm(false);
      invalidateAllRoutineQueries();
    },
  });

  const deleteStackMutation = useMutation({
    mutationFn: async (stackId: string) => deleteRoutine(stackId),
    onSuccess: () => {
      invalidateAllRoutineQueries();
    },
  });

  const createItemMutation = useMutation({
    mutationFn: async (routineId: string) => {
      const trimmed = newItemTitle.trim();
      if (!trimmed) throw new Error('Habit title cannot be empty.');
      const isQuant =
        newItemTrackingType === 'numeric' || newItemTrackingType === 'duration';
      return createRoutineItem(routineId, {
        title: trimmed,
        tracking_type: newItemTrackingType,
        target_value: isQuant ? safeNumber(newItemTargetValue, 20) : null,
        unit: isQuant ? newItemUnit.trim() || 'min' : null,
        frequency_type: newItemFrequency,
        frequency_config: { mvd_included: newItemMvd },
        estimated_minutes: Math.max(1, Math.round(safeNumber(newItemMinutes, 10))),
      });
    },
    onSuccess: () => {
      setNewItemTitle('');
      setAddingItemForStackId(null);
      invalidateAllRoutineQueries();
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: string) => deleteRoutineItem(itemId),
    onSuccess: () => {
      invalidateAllRoutineQueries();
    },
  });

  const saveIdealWeekMutation = useMutation({
    mutationFn: async (blocks: IdealWeekBlock[]) => upsertIdealWeek(blocks),
    onSuccess: () => {
      invalidateAllRoutineQueries();
    },
  });

  const saveCheckinMutation = useMutation({
    mutationFn: async ({
      date,
      payload,
    }: {
      date: string;
      payload: UpsertDailyCheckinPayload;
    }) => upsertDailyCheckin(date, payload),
    onSuccess: () => {
      invalidateAllRoutineQueries();
    },
  });

  const exportWeeklyReviewMutation = useMutation({
    mutationFn: async ({
      isoWeek,
      payload,
      date,
    }: {
      isoWeek: string;
      payload: UpsertWeeklyReviewPayload;
      date: string;
    }) => {
      let exported: any = null;
      try {
        exported = await exportWeeklyReviewByKey(isoWeek, payload);
      } catch {
        exported = await upsertWeeklyReviewByKey(isoWeek, payload);
      }
      try {
        await upsertDailyCheckin(date, {
          day_profile_used: activeProfile === 'all' ? 'workday' : activeProfile,
          weekly_review_json: {
            week: isoWeek,
            wins_md: payload.wins_md ?? payload.wins,
            blockers_md: payload.blockers_md ?? payload.challenges_md,
            next_week_priorities: payload.next_week_priorities,
          },
        });
      } catch {
        // Non-fatal if checkin mirror already written by /reviews/{iso_week}/export
      }
      return {
        vaultPath:
          exported?.obsidian_vault_path ||
          exported?.vault_export_path ||
          `Reviews/${isoWeek}.md`,
      };
    },
    onSuccess: () => {
      invalidateAllRoutineQueries();
    },
  });

  // Lookup maps
  const todayLogsByItemId = useMemo(() => {
    const map = new Map<string, RoutineLog>();
    for (const stack of routines) {
      for (const l of stack.today_logs ?? []) {
        if (l?.routine_item_id) map.set(l.routine_item_id, l);
      }
    }
    for (const l of routineLogs) {
      if (l?.routine_item_id) map.set(l.routine_item_id, l);
    }
    return map;
  }, [routines, routineLogs]);

  const streaksByItemId = useMemo(() => {
    const map = new Map<
      string,
      { currentStreak: number; longestStreak: number; rate30d: number }
    >();
    for (const s of analytics?.streaks ?? []) {
      const id = s.routine_item_id || s.item_id || '';
      if (!id) continue;
      map.set(id, {
        currentStreak: Math.max(0, Math.round(safeNumber(s.current_streak, 0))),
        longestStreak: Math.max(
          0,
          Math.round(safeNumber(s.longest_streak ?? s.best_streak, 0)),
        ),
        rate30d: Math.max(0, Math.min(100, safeNumber(s.completion_rate_30d_pct, 0))),
      });
    }
    return map;
  }, [analytics]);

  const filteredStacks = useMemo(() => {
    return filterRoutinesByDayProfile(routines, activeProfile, {
      todayLogs: Array.from(todayLogsByItemId.values()),
      includeNonMatchingStacksInWorkday: true,
    });
  }, [routines, activeProfile, todayLogsByItemId]);

  const groupedSlotStacks = useMemo(() => {
    return groupRoutinesByTimeSlot(filteredStacks);
  }, [filteredStacks]);

  const matrix96 = useMemo(() => {
    return normalizeMatrix8x12(analytics?.matrix_8x12);
  }, [analytics]);

  const heatmap365 = useMemo(() => {
    return normalizeHeatmap365d(analytics?.heatmap_365d);
  }, [analytics]);

  const { maxCurrentStreak, maxLongestStreak } = useMemo(() => {
    return computeTopHabitStreak(analytics);
  }, [analytics]);

  const liveAdherencePct = useMemo(() => {
    return Math.max(0, Math.min(100, safeNumber(analytics?.consistency_score_pct, 0)));
  }, [analytics]);

  const totalHabitItemsCount = useMemo(() => {
    return routines.reduce((sum, r) => sum + (r.items?.length ?? 0), 0);
  }, [routines]);

  const handleSelectDayProfile = (profile: RoutineDayProfile) => {
    setActiveProfile(profile);
    if (profile !== 'all') {
      switchDayProfileMutation.mutate(profile);
    }
  };

  const handleQuickLogHabit = async (
    item: RoutineItem,
    status: RoutineLogStatus,
  ) => {
    const isQuant =
      item.tracking_type === 'numeric' || item.tracking_type === 'duration';
    const rawDraft = quantDrafts[item.id];
    let numericValue: number | null = null;

    if (isQuant) {
      if (rawDraft !== undefined && rawDraft.trim() !== '' && Number.isFinite(Number(rawDraft))) {
        numericValue = Number(rawDraft);
      } else if (status === 'completed') {
        numericValue = safeNumber(
          item.target_value,
          Math.max(1, safeNumber(item.estimated_minutes, 10)),
        );
      } else if (status === 'partial') {
        const target = safeNumber(
          item.target_value,
          Math.max(1, safeNumber(item.estimated_minutes, 10)),
        );
        numericValue = Number((target * 0.5).toFixed(1));
      }
    }

    await logHabitMutation.mutateAsync({
      routine_item_id: item.id,
      log_date: selectedDate,
      status,
      numeric_value: numericValue,
    });
  };

  const renderHabitItemRow = (item: RoutineItem) => {
    const existingLog = todayLogsByItemId.get(item.id) ?? null;
    const streakInfo = streaksByItemId.get(item.id) ?? {
      currentStreak: 0,
      longestStreak: 0,
      rate30d: 0,
    };
    const quantProgress = formatQuantitativeHabitProgress(item, existingLog);
    const isMvd = isItemMvdIncluded(item);
    const currentStatus = existingLog?.status ?? null;

    return (
      <div
        key={item.id}
        data-testid={`routine-habit-row-${item.id}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: '10px 12px',
          backgroundColor: FUI_TOKENS.bgCarbon,
          border: `1px solid ${
            currentStatus === 'completed'
              ? FUI_TOKENS.accentPhosphor
              : currentStatus === 'partial'
                ? FUI_TOKENS.accentCyan
                : FUI_TOKENS.borderHairline
          }`,
          borderRadius: '0px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            borderRadius: '0px',
          }}
        >
          {/* Left: Habit Title & Metadata Badges */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '8px',
              borderRadius: '0px',
            }}
          >
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '13px',
                fontWeight: 700,
                color:
                  currentStatus === 'completed'
                    ? FUI_TOKENS.accentPhosphor
                    : FUI_TOKENS.inkStark,
                borderRadius: '0px',
              }}
            >
              {item.title}
            </span>
            <FuiBadge tone="cyan">{item.tracking_type.toUpperCase()}</FuiBadge>
            <FuiBadge tone="muted">{item.frequency_type.toUpperCase()}</FuiBadge>
            <FuiBadge tone="amber">{item.estimated_minutes}M</FuiBadge>
            {isMvd && <FuiBadge tone="phosphor">MVD</FuiBadge>}
            <FuiBadge tone="orange">
              STREAK: {streakInfo.currentStreak}D (BEST {streakInfo.longestStreak}D)
            </FuiBadge>
            {currentStatus && (
              <FuiBadge
                tone={
                  currentStatus === 'completed'
                    ? 'phosphor'
                    : currentStatus === 'partial'
                      ? 'cyan'
                      : 'amber'
                }
                solid
              >
                {currentStatus.toUpperCase()}
              </FuiBadge>
            )}
          </div>

          {/* Right: Quantitative Input & Checkoff Buttons */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '0px',
            }}
          >
            {quantProgress.isQuantitative && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  borderRadius: '0px',
                }}
              >
                <input
                  type="number"
                  step="0.5"
                  aria-label={`Quantitative value for ${item.title}`}
                  value={
                    quantDrafts[item.id] !== undefined
                      ? quantDrafts[item.id]
                      : existingLog?.numeric_value !== null &&
                          existingLog?.numeric_value !== undefined
                        ? String(existingLog.numeric_value)
                        : ''
                  }
                  onChange={(e) =>
                    setQuantDrafts((prev) => ({
                      ...prev,
                      [item.id]: e.target.value,
                    }))
                  }
                  placeholder={quantProgress.formattedTarget}
                  data-testid={`habit-quant-input-${item.id}`}
                  style={{
                    width: '76px',
                    minHeight: '30px',
                    padding: '2px 6px',
                    backgroundColor: FUI_TOKENS.bgPanel,
                    color: FUI_TOKENS.inkStark,
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    borderRadius: '0px',
                  }}
                />
                <span
                  data-testid={`habit-quant-readout-${item.id}`}
                  style={{
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    color: FUI_TOKENS.accentCyan,
                    borderRadius: '0px',
                  }}
                >
                  {quantProgress.formattedReadout}
                </span>
              </div>
            )}

            <FuiButton
              size="sm"
              variant={currentStatus === 'completed' ? 'primary' : 'secondary'}
              onClick={() => handleQuickLogHabit(item, 'completed')}
              data-testid={`habit-complete-btn-${item.id}`}
            >
              ✓ COMPLETE
            </FuiButton>
            <FuiButton
              size="sm"
              variant={currentStatus === 'partial' ? 'cyan' : 'secondary'}
              onClick={() => handleQuickLogHabit(item, 'partial')}
              data-testid={`habit-partial-btn-${item.id}`}
            >
              ◐ PARTIAL
            </FuiButton>
            <FuiButton
              size="sm"
              variant={currentStatus === 'skipped' ? 'danger' : 'secondary'}
              onClick={() => handleQuickLogHabit(item, 'skipped')}
              data-testid={`habit-skip-btn-${item.id}`}
            >
              ⏭ SKIP
            </FuiButton>
            <button
              type="button"
              onClick={() => deleteItemMutation.mutate(item.id)}
              aria-label={`Delete habit ${item.title}`}
              style={{
                minHeight: '28px',
                padding: '4px 8px',
                backgroundColor: 'transparent',
                color: FUI_TOKENS.inkMuted,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
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

        {/* Quantitative Progress Bar */}
        {quantProgress.isQuantitative && (
          <div
            style={{
              width: '100%',
              height: '5px',
              backgroundColor: FUI_TOKENS.bgPanel,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${quantProgress.completionPct}%`,
                height: '100%',
                backgroundColor:
                  quantProgress.completionPct >= 100
                    ? FUI_TOKENS.accentPhosphor
                    : FUI_TOKENS.accentCyan,
                borderRadius: '0px',
              }}
            />
          </div>
        )}
      </div>
    );
  };

  const renderRoutineStackCard = (stack: RoutineStackWithItems) => {
    const items = stack.items ?? [];
    const completedInStack = items.filter((item) => {
      const st = todayLogsByItemId.get(item.id)?.status;
      return st === 'completed' || st === 'partial';
    }).length;
    const stackAdherencePct =
      items.length > 0 ? Math.round((completedInStack / items.length) * 100) : 0;

    return (
      <div
        key={stack.id}
        data-testid={`routine-stack-card-${stack.id}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '12px',
          backgroundColor: FUI_TOKENS.bgPanel,
          border: `1px solid ${FUI_TOKENS.borderHairline}`,
          borderRadius: '0px',
        }}
      >
        {/* Stack Header */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            paddingBottom: '8px',
            borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
            borderRadius: '0px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '8px',
              borderRadius: '0px',
            }}
          >
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '14px',
                fontWeight: 700,
                color: FUI_TOKENS.inkStark,
                borderRadius: '0px',
              }}
            >
              {stack.name}
            </span>
            <FuiBadge tone="orange">{stack.time_slot.toUpperCase()}</FuiBadge>
            <FuiBadge tone="cyan">PROFILE: {stack.day_profile.toUpperCase()}</FuiBadge>
            {stack.target_start_time && (
              <FuiBadge tone="muted">START: {stack.target_start_time.slice(0, 5)}</FuiBadge>
            )}
            <FuiBadge tone="phosphor">
              {completedInStack}/{items.length} STEPS ({stackAdherencePct}%)
            </FuiBadge>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', borderRadius: '0px' }}>
            <FuiButton
              size="sm"
              variant="cyan"
              onClick={() => {
                setRunnerStackId(stack.id);
                setRunnerOpen(true);
              }}
              data-testid={`run-stack-btn-${stack.id}`}
            >
              ▶ RUN STACK
            </FuiButton>
            <FuiButton
              size="sm"
              variant="secondary"
              onClick={() =>
                setAddingItemForStackId((prev) => (prev === stack.id ? null : stack.id))
              }
              data-testid={`add-habit-toggle-btn-${stack.id}`}
            >
              + ADD HABIT STEP
            </FuiButton>
            <button
              type="button"
              onClick={() => deleteStackMutation.mutate(stack.id)}
              aria-label={`Delete routine stack ${stack.name}`}
              style={{
                minHeight: '28px',
                padding: '4px 8px',
                backgroundColor: 'transparent',
                color: FUI_TOKENS.inkMuted,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
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

        {/* Inline Add Habit Form */}
        {addingItemForStackId === stack.id && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createItemMutation.mutate(stack.id);
            }}
            data-testid={`add-habit-form-${stack.id}`}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '8px',
              alignItems: 'end',
              padding: '10px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.accentCyan}`,
              borderRadius: '0px',
            }}
          >
            <FuiInput
              label="HABIT STEP TITLE"
              type="text"
              value={newItemTitle}
              onChange={(e) => setNewItemTitle(e.target.value)}
              placeholder="Hydrate 500ml + Electrolytes..."
              data-testid={`new-habit-title-input-${stack.id}`}
            />
            <FuiSelect
              label="TRACKING TYPE"
              value={newItemTrackingType}
              onChange={(e) => setNewItemTrackingType(e.target.value as RoutineTrackingType)}
              options={[
                { value: 'boolean', label: 'BOOLEAN (CHECKMARK)' },
                { value: 'numeric', label: 'NUMERIC (TARGET)' },
                { value: 'duration', label: 'DURATION (MINUTES)' },
              ]}
            />
            {(newItemTrackingType === 'numeric' || newItemTrackingType === 'duration') && (
              <>
                <FuiInput
                  label="TARGET VALUE"
                  type="number"
                  step="0.5"
                  value={newItemTargetValue}
                  onChange={(e) => setNewItemTargetValue(e.target.value)}
                />
                <FuiInput
                  label="UNIT"
                  type="text"
                  value={newItemUnit}
                  onChange={(e) => setNewItemUnit(e.target.value)}
                  placeholder="pages / L / min"
                />
              </>
            )}
            <FuiSelect
              label="CADENCE"
              value={newItemFrequency}
              onChange={(e) => setNewItemFrequency(e.target.value as RoutineFrequencyType)}
              options={[
                { value: 'daily', label: 'DAILY' },
                { value: 'weekdays', label: 'WEEKDAYS (MON–FRI)' },
                { value: 'times_per_week', label: 'TIMES PER WEEK' },
              ]}
            />
            <FuiInput
              label="EST. MINUTES"
              type="number"
              min="1"
              value={newItemMinutes}
              onChange={(e) => setNewItemMinutes(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', borderRadius: '0px' }}>
              <button
                type="button"
                onClick={() => setNewItemMvd((m) => !m)}
                style={{
                  minHeight: '34px',
                  padding: '4px 10px',
                  backgroundColor: newItemMvd ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.bgPanel,
                  color: newItemMvd ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                  border: `1px solid ${
                    newItemMvd ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.borderHairline
                  }`,
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: '0px',
                }}
              >
                {newItemMvd ? '✓ MVD CORE' : 'OPTIONAL'}
              </button>
              <FuiButton
                type="submit"
                variant="primary"
                loading={createItemMutation.isPending}
                data-testid={`submit-habit-btn-${stack.id}`}
              >
                SAVE STEP
              </FuiButton>
            </div>
          </form>
        )}

        {/* Empty Stack State vs Habit Steps List */}
        {items.length === 0 ? (
          <div
            data-testid={`empty-routine-stack-${stack.id}`}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
              padding: '12px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: FUI_TOKENS.inkMuted,
              borderRadius: '0px',
            }}
          >
            <span>
              EMPTY ROUTINE STACK ({stack.name}) // 0 HABIT STEPS CONFIGURED FOR THIS RITUAL.
            </span>
            <FuiButton
              size="sm"
              variant="primary"
              onClick={() => setAddingItemForStackId(stack.id)}
              data-testid={`empty-stack-add-first-btn-${stack.id}`}
            >
              + ADD FIRST HABIT STEP
            </FuiButton>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              borderRadius: '0px',
            }}
          >
            {items.map(renderHabitItemRow)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      data-testid="routines-page"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '16px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
        maxWidth: '100%',
        boxSizing: 'border-box',
        overflowX: 'hidden',
      }}
    >
      {/* 1. Persistent Top Telemetry, Day Profile Switcher, BinaryDotMatrix8x12 & 365d Heatmap */}
      <FuiPanel
        headerTitle="ROUTINE PLANNING // DAY PROFILES, STREAK TELEMETRY & BIO ADHERENCE"
        headerProps={{
          title: 'ROUTINE PLANNING // DAY PROFILES, STREAK TELEMETRY & BIO ADHERENCE',
          code: 'MOD_08',
          accent: 'phosphor',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            borderRadius: '0px',
          }}
        >
          {/* Day Profile Switcher + Guided Runner + New Stack Action Bar */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '10px',
              borderRadius: '0px',
            }}
          >
            <div
              role="tablist"
              aria-label="Day Profile Switcher"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                alignItems: 'center',
                borderRadius: '0px',
              }}
            >
              {DAY_PROFILE_OPTIONS.map((opt) => {
                const isActive = activeProfile === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => handleSelectDayProfile(opt.value)}
                    data-testid={`day-profile-btn-${opt.value}`}
                    style={{
                      minHeight: '32px',
                      padding: '4px 12px',
                      backgroundColor: isActive ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                      color: isActive ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                      border: `1px solid ${
                        isActive ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                      }`,
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      borderRadius: '0px',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                alignItems: 'center',
                borderRadius: '0px',
              }}
            >
              <FuiButton
                variant="cyan"
                onClick={() => {
                  setRunnerStackId(filteredStacks[0]?.id ?? null);
                  setRunnerOpen(true);
                }}
                data-testid="launch-guided-runner-btn"
              >
                ▶ LAUNCH GUIDED RUNNER
              </FuiButton>
              <FuiButton
                variant="primary"
                onClick={() => setShowNewStackForm((s) => !s)}
                data-testid="toggle-new-routine-stack-btn"
              >
                + NEW ROUTINE STACK
              </FuiButton>
            </div>
          </div>

          {/* Summary KPI Badges */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              alignItems: 'center',
              borderRadius: '0px',
            }}
          >
            <FuiBadge tone="phosphor">
              ACTIVE STACKS: {routines.length} • HABITS: {totalHabitItemsCount}
            </FuiBadge>
            <FuiBadge tone="orange">PROFILE: {activeProfile.toUpperCase()}</FuiBadge>
            <FuiBadge tone="cyan">
              30D CONSISTENCY: {liveAdherencePct.toFixed(1)}%
            </FuiBadge>
            <FuiBadge tone="amber">
              TOP STREAK: {maxCurrentStreak}D (RECORD {maxLongestStreak}D)
            </FuiBadge>
          </div>

          {/* Inline Create Routine Stack Form */}
          {showNewStackForm && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createStackMutation.mutate();
              }}
              data-testid="create-routine-stack-form"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: '10px',
                alignItems: 'end',
                padding: '12px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.accentOrange}`,
                borderRadius: '0px',
              }}
            >
              <FuiInput
                label="ROUTINE STACK NAME"
                type="text"
                value={newStackName}
                onChange={(e) => setNewStackName(e.target.value)}
                placeholder="Morning Launch Ritual..."
                data-testid="new-stack-name-input"
              />
              <FuiSelect
                label="TIME SLOT"
                value={newStackSlot}
                onChange={(e) => setNewStackSlot(e.target.value as RoutineTimeSlot)}
                options={ROUTINE_TIME_SLOT_ORDER.map((slot) => ({
                  value: slot,
                  label: slot.toUpperCase(),
                }))}
              />
              <FuiSelect
                label="DAY PROFILE"
                value={newStackProfile}
                onChange={(e) => setNewStackProfile(e.target.value as RoutineDayProfile)}
                options={[
                  { value: 'workday', label: 'WORKDAY' },
                  { value: 'weekend', label: 'WEEKEND' },
                  { value: 'travel', label: 'TRAVEL' },
                  { value: 'minimum_viable', label: 'MINIMUM VIABLE (MVD)' },
                ]}
              />
              <FuiInput
                label="TARGET START (HH:MM)"
                type="text"
                value={newStackStartTime}
                onChange={(e) => setNewStackStartTime(e.target.value)}
                placeholder="07:00"
              />
              <FuiButton
                type="submit"
                variant="primary"
                loading={createStackMutation.isPending}
                data-testid="create-stack-submit-btn"
              >
                CREATE STACK
              </FuiButton>
            </form>
          )}

          {/* Persistent Telemetry Strip: BinaryDotMatrix8x12 (96 cells) + 365d Heatmap + Streak Leaderboard */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '12px',
              alignItems: 'stretch',
              borderRadius: '0px',
            }}
          >
            {/* 8x12 Binary Dot Matrix (96 cells) */}
            <BinaryDotMatrix8x12
              values={matrix96}
              adherencePct={liveAdherencePct}
              streakCount={maxCurrentStreak}
            />

            {/* 365-Day Rectilinear Consistency Heatmap (0px SVG cells) */}
            <div
              data-testid="routines-heatmap-365d"
              data-fui-chart="heatmap-365d"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '6px',
                padding: '8px 10px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
                overflowX: 'auto',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderRadius: '0px',
                }}
              >
                <span style={{ color: FUI_TOKENS.inkMuted }}>CONSISTENCY_HEATMAP_365D</span>
                <span style={{ color: FUI_TOKENS.accentPhosphor }}>
                  365 DAYS // {liveAdherencePct.toFixed(1)}%
                </span>
              </div>
              <svg
                width={318}
                height={42}
                viewBox="0 0 318 42"
                role="img"
                aria-label="365-day habit consistency heatmap"
                style={{ display: 'block', maxWidth: '100%', borderRadius: '0px' }}
              >
                {heatmap365.map((cell, idx) => {
                  const col = Math.floor(idx / 7);
                  const row = idx % 7;
                  return (
                    <rect
                      key={idx}
                      data-heatmap-cell={idx}
                      x={col * 6}
                      y={row * 6}
                      width={4}
                      height={4}
                      rx={0}
                      ry={0}
                      fill={cell.fillHex}
                    />
                  );
                })}
              </svg>
            </div>

            {/* Per-Habit Streak Leaderboard */}
            <div
              data-testid="routines-streak-leaderboard"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                padding: '8px 10px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
                maxHeight: '110px',
                overflowY: 'auto',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: FUI_TOKENS.inkMuted,
                  borderRadius: '0px',
                }}
              >
                <span>RESILIENT_STREAK_LEADERBOARD</span>
                <span>CUR / BEST (30D)</span>
              </div>
              {(analytics?.streaks ?? []).length === 0 ? (
                <span style={{ color: FUI_TOKENS.inkMuted }}>
                  NO ACTIVE STREAK LOGS YET // Complete a habit step below.
                </span>
              ) : (
                (analytics?.streaks ?? []).slice(0, 5).map((s) => (
                  <div
                    key={s.routine_item_id || s.item_id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                      color: FUI_TOKENS.inkStark,
                      borderRadius: '0px',
                    }}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.title}
                    </span>
                    <span style={{ color: FUI_TOKENS.accentOrange, flexShrink: 0 }}>
                      {safeNumber(s.current_streak, 0)}D /{' '}
                      {safeNumber(s.longest_streak ?? s.best_streak, 0)}D (
                      {safeNumber(s.completion_rate_30d_pct, 0).toFixed(0)}%)
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Sub-View Workspace Navigation Tabs */}
          <div
            role="tablist"
            aria-label="Routines Workspace Views"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              paddingTop: '8px',
              borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
            }}
          >
            {WORKSPACE_TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  data-testid={`routines-subtab-${tab.id}`}
                  style={{
                    minHeight: '32px',
                    padding: '6px 12px',
                    backgroundColor: active ? FUI_TOKENS.inkStark : FUI_TOKENS.bgPanel,
                    color: active ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                    border: `1px solid ${
                      active ? FUI_TOKENS.inkStark : FUI_TOKENS.borderHairline
                    }`,
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    borderRadius: '0px',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </FuiPanel>

      {/* 2. Sub-View Panels (Ideal Week Blueprint / Daily Pulse Check-In / Weekly Review Wizard) */}
      {activeTab === 'ideal_week' && (
        <IdealWeekBlueprintPanel
          idealWeek={idealWeek}
          saving={saveIdealWeekMutation.isPending}
          onSaveBlocks={async (blocks) => saveIdealWeekMutation.mutateAsync(blocks)}
        />
      )}

      {activeTab === 'daily_pulse' && (
        <DailyPulseCheckinPanel
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          checkin={dailyCheckin}
          saving={saveCheckinMutation.isPending}
          onSaveCheckin={async (date, payload) =>
            saveCheckinMutation.mutateAsync({ date, payload })
          }
        />
      )}

      {activeTab === 'weekly_review' && (
        <WeeklyReviewWizardPanel
          summary={weeklyReviewSummary}
          todayDate={selectedDate}
          exporting={exportWeeklyReviewMutation.isPending}
          onExportReview={async (isoWeek, payload, date) =>
            exportWeeklyReviewMutation.mutateAsync({ isoWeek, payload, date })
          }
        />
      )}

      {/* 3. Routine Stacks & Sequenced Habit Checkoff Deck (Always rendered so stacks/items stay visible across views) */}
      <FuiPanel
        headerTitle="SEQUENCED ROUTINE STACKS // MORNING • AFTERNOON • SHUTDOWN • EVENING"
        headerProps={{
          title: 'SEQUENCED ROUTINE STACKS // MORNING • AFTERNOON • SHUTDOWN • EVENING',
          code: 'MOD_08 // STACKS',
          accent: 'orange',
        }}
      >
        {groupedSlotStacks.length === 0 ? (
          <div
            data-testid="routines-no-stacks-empty"
            style={{
              padding: '20px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: FUI_TOKENS.inkMuted,
              borderRadius: '0px',
            }}
          >
            NO ROUTINE STACKS MATCHING PROFILE [{activeProfile.toUpperCase()}] // Click &ldquo;+ NEW
            ROUTINE STACK&rdquo; above or switch Day Profile to WORKDAY / ALL PROFILES.
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              borderRadius: '0px',
            }}
          >
            {groupedSlotStacks.map((group) => (
              <div
                key={group.timeSlot}
                data-testid={`routine-slot-group-${group.timeSlot}`}
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
                    alignItems: 'center',
                    gap: '8px',
                    borderRadius: '0px',
                  }}
                >
                  <FuiBadge tone={group.badgeTone} code={group.code}>
                    {group.label}
                  </FuiBadge>
                  <span
                    style={{
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      color: FUI_TOKENS.inkMuted,
                      borderRadius: '0px',
                    }}
                  >
                    ({group.stacks.length} STACK{group.stacks.length === 1 ? '' : 'S'})
                  </span>
                </div>
                {group.stacks.map(renderRoutineStackCard)}
              </div>
            ))}
          </div>
        )}
      </FuiPanel>

      {/* Guided Routine Runner Modal */}
      <GuidedRoutineRunnerModal
        open={runnerOpen}
        onClose={() => setRunnerOpen(false)}
        stacks={filteredStacks.length > 0 ? filteredStacks : routines}
        initialStackId={runnerStackId}
        todayDate={selectedDate}
        todayLogsByItemId={todayLogsByItemId}
        onLogStep={async (payload) => {
          await logHabitMutation.mutateAsync(payload);
        }}
      />
    </div>
  );
}
