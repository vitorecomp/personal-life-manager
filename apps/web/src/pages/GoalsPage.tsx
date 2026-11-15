import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FuiBadge,
  FuiButton,
  FuiInput,
  FuiModal,
  FuiPanel,
  FuiSelect,
  FUI_TOKENS,
} from '@hermes/ui';
import {
  clampPercentage,
  createGoal,
  createGoalCheckin,
  createKeyResult,
  deleteGoal,
  deleteKeyResult,
  getGoalBlueprint,
  GOAL_PILLAR_LABELS,
  KR_METRIC_LABELS,
  listGoalCheckins,
  listGoals,
  listYearlyCycles,
  normalizeBlueprintLayout,
  normalizeYearlyCycle,
  OKR_QUARTERS,
  safeFiniteNumber,
  updateGoal,
  updateGoalBlueprintPos,
  updateKeyResult,
  upsertYearlyCycle,
  type BlueprintPos,
  type CycleStatus,
  type GoalKeyResult,
  type GoalPillar,
  type GoalStatus,
  type GoalWithDetails,
  type KrMetricType,
  type OkrQuarter,
  type PaceHealthStatus,
} from '../api/goals';
import { Ref03BlueprintCanvas } from '../components/goals/Ref03BlueprintCanvas';

type GoalsViewMode = 'all' | 'blueprint' | 'okr';

function getPaceBadgeMeta(pace: PaceHealthStatus): {
  label: string;
  tone: 'phosphor' | 'amber' | 'vermilion';
} {
  if (pace === 'off_track') {
    return { label: 'OFF TRACK // PACE RISK', tone: 'vermilion' };
  }
  if (pace === 'at_risk') {
    return { label: 'AT RISK // PACE DRIFT', tone: 'amber' };
  }
  return { label: 'ON TRACK // PACE NOMINAL', tone: 'phosphor' };
}

export function GoalsPage() {
  const queryClient = useQueryClient();

  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [viewMode, setViewMode] = useState<GoalsViewMode>('all');
  const [pillarFilter, setPillarFilter] = useState<string>('ALL');
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Cycle Editor Modal state
  const [cycleModalOpen, setCycleModalOpen] = useState(false);
  const [cycleThemeInput, setCycleThemeInput] = useState('');
  const [cycleVisionInput, setCycleVisionInput] = useState('');
  const [cycleAntiGoalsInput, setCycleAntiGoalsInput] = useState('');
  const [cycleFocusCapInput, setCycleFocusCapInput] = useState('6');
  const [cycleStatusInput, setCycleStatusInput] = useState<CycleStatus>('active');

  // New Goal Modal state
  const [newGoalModalOpen, setNewGoalModalOpen] = useState(false);
  const [goalTitleInput, setGoalTitleInput] = useState('');
  const [goalCodeInput, setGoalCodeInput] = useState('');
  const [goalPillarInput, setGoalPillarInput] = useState<GoalPillar>('systems');
  const [goalStatusInput, setGoalStatusInput] = useState<GoalStatus>('in_progress');
  const [goalPriorityInput, setGoalPriorityInput] = useState('1');
  const [goalConfidenceInput, setGoalConfidenceInput] = useState('8');
  const [goalTargetDateInput, setGoalTargetDateInput] = useState('2026-12-31');
  const [goalWhyInput, setGoalWhyInput] = useState('');

  // Add Key Result Modal state
  const [krModalGoalId, setKrModalGoalId] = useState<string | null>(null);
  const [krTitleInput, setKrTitleInput] = useState('');
  const [krCodeInput, setKrCodeInput] = useState('');
  const [krQuarterInput, setKrQuarterInput] = useState<OkrQuarter>('Q1');
  const [krMetricTypeInput, setKrMetricTypeInput] = useState<KrMetricType>('numeric');
  const [krStartInput, setKrStartInput] = useState('0');
  const [krCurrentInput, setKrCurrentInput] = useState('0');
  const [krTargetInput, setKrTargetInput] = useState('100');
  const [krUnitInput, setKrUnitInput] = useState('%');
  const [krWeightInput, setKrWeightInput] = useState('1');
  const [krLinkedEntityInput, setKrLinkedEntityInput] = useState('');
  const [krMilestonesInput, setKrMilestonesInput] = useState(
    'Design Spec, Implement Engine, Verify Telemetry',
  );

  // Goal Check-in Drawer/Modal state
  const [checkinGoalId, setCheckinGoalId] = useState<string | null>(null);
  const [checkinConfidenceInput, setCheckinConfidenceInput] = useState('8');
  const [checkinWinsInput, setCheckinWinsInput] = useState('');
  const [checkinBlockersInput, setCheckinBlockersInput] = useState('');
  const [checkinNextStepsInput, setCheckinNextStepsInput] = useState('');
  const [checkinKrIdInput, setCheckinKrIdInput] = useState('');
  const [checkinKrValueInput, setCheckinKrValueInput] = useState('');

  // Queries
  const { data: cycles = [] } = useQuery({
    queryKey: ['goals', 'cycles'],
    queryFn: async () => {
      try {
        return await listYearlyCycles();
      } catch {
        return [
          normalizeYearlyCycle({ year: 2026 }, 2026),
          normalizeYearlyCycle({ year: 2027, status: 'planning' }, 2027),
        ];
      }
    },
  });

  const activeCycle = useMemo(() => {
    const found = cycles.find((c) => c.year === selectedYear);
    return found ?? normalizeYearlyCycle({ year: selectedYear }, selectedYear);
  }, [cycles, selectedYear]);

  const { data: goals = [] } = useQuery({
    queryKey: ['goals', 'list', selectedYear],
    queryFn: async () => {
      try {
        return await listGoals({ year: selectedYear });
      } catch {
        return [];
      }
    },
  });

  const filteredGoals = useMemo(() => {
    if (pillarFilter === 'ALL') return goals;
    return goals.filter((g) => g.pillar === pillarFilter);
  }, [goals, pillarFilter]);

  const { data: blueprintData } = useQuery({
    queryKey: ['goals-blueprint', selectedYear, goals.length],
    queryFn: async () => {
      try {
        return await getGoalBlueprint(selectedYear, goals, activeCycle);
      } catch {
        return normalizeBlueprintLayout({}, selectedYear, goals, activeCycle);
      }
    },
  });

  const effectiveBlueprint = useMemo(() => {
    return normalizeBlueprintLayout(blueprintData ?? {}, selectedYear, goals, activeCycle);
  }, [blueprintData, selectedYear, goals, activeCycle]);

  const activeCheckinGoal = useMemo(() => {
    const targetId = checkinGoalId ?? selectedGoalId ?? goals[0]?.id ?? null;
    return goals.find((g) => g.id === targetId) ?? null;
  }, [checkinGoalId, selectedGoalId, goals]);

  const { data: activeGoalCheckins = [] } = useQuery({
    queryKey: ['goals', 'checkins', activeCheckinGoal?.id],
    enabled: Boolean(activeCheckinGoal?.id),
    queryFn: async () => {
      if (!activeCheckinGoal?.id) return [];
      try {
        return await listGoalCheckins(activeCheckinGoal.id);
      } catch {
        return activeCheckinGoal.checkins ?? [];
      }
    },
  });

  // Focus Cap calculation
  const activeGoalsCount = useMemo(() => {
    const localActive = goals.filter(
      (g) => g.status === 'not_started' || g.status === 'in_progress',
    ).length;
    const serverReported = goals.reduce(
      (max, g) => Math.max(max, safeFiniteNumber(g.active_goals_in_cycle, 0)),
      0,
    );
    return Math.max(localActive, serverReported);
  }, [goals]);

  const focusCapLimit = useMemo(() => {
    const goalCap = goals[0]?.focus_cap_limit;
    return Math.max(1, safeFiniteNumber(goalCap ?? activeCycle.focus_cap_limit, 6));
  }, [goals, activeCycle.focus_cap_limit]);

  const focusCapExceeded = useMemo(() => {
    return (
      activeGoalsCount > focusCapLimit || goals.some((g) => Boolean(g.focus_cap_exceeded))
    );
  }, [activeGoalsCount, focusCapLimit, goals]);

  const refreshGoalsQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['goals'] }),
      queryClient.invalidateQueries({ queryKey: ['goals-blueprint'] }),
    ]);
  };

  // Mutations
  const upsertCycleMutation = useMutation({
    mutationFn: (payload: {
      year: number;
      theme: string;
      vision_md: string;
      anti_goals_md: string;
      focus_cap_limit: number;
      status: CycleStatus;
    }) => upsertYearlyCycle(payload.year, payload),
    onSuccess: async () => {
      await refreshGoalsQueries();
    },
  });

  const createGoalMutation = useMutation({
    mutationFn: createGoal,
    onSuccess: async () => {
      await refreshGoalsQueries();
    },
  });

  const updateGoalMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateGoal>[1] }) =>
      updateGoal(id, payload),
    onSuccess: async () => {
      await refreshGoalsQueries();
    },
  });

  const deleteGoalMutation = useMutation({
    mutationFn: deleteGoal,
    onSuccess: async () => {
      await refreshGoalsQueries();
    },
  });

  const pinGoalPosMutation = useMutation({
    mutationFn: ({ goalId, pos }: { goalId: string; pos: BlueprintPos }) =>
      updateGoalBlueprintPos(goalId, pos),
    onSuccess: async () => {
      await refreshGoalsQueries();
    },
  });

  const createKrMutation = useMutation({
    mutationFn: ({
      goalId,
      payload,
    }: {
      goalId: string;
      payload: Parameters<typeof createKeyResult>[1];
    }) => createKeyResult(goalId, payload),
    onSuccess: async () => {
      await refreshGoalsQueries();
    },
  });

  const updateKrMutation = useMutation({
    mutationFn: ({
      krId,
      payload,
    }: {
      krId: string;
      payload: Parameters<typeof updateKeyResult>[1];
    }) => updateKeyResult(krId, payload),
    onSuccess: async () => {
      await refreshGoalsQueries();
    },
  });

  const deleteKrMutation = useMutation({
    mutationFn: deleteKeyResult,
    onSuccess: async () => {
      await refreshGoalsQueries();
    },
  });

  const createCheckinMutation = useMutation({
    mutationFn: ({
      goalId,
      payload,
    }: {
      goalId: string;
      payload: Parameters<typeof createGoalCheckin>[1];
    }) => createGoalCheckin(goalId, payload),
    onSuccess: async () => {
      await refreshGoalsQueries();
    },
  });

  // Handlers
  const handleOpenCycleEditor = () => {
    setCycleThemeInput(activeCycle.theme);
    setCycleVisionInput(activeCycle.vision_md);
    setCycleAntiGoalsInput(activeCycle.anti_goals_md);
    setCycleFocusCapInput(String(activeCycle.focus_cap_limit));
    setCycleStatusInput(activeCycle.status);
    setErrorMessage(null);
    setCycleModalOpen(true);
  };

  const handleSaveCycle = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const trimmedTheme = cycleThemeInput.trim();
    if (!trimmedTheme) {
      setErrorMessage('Cycle theme must not be empty.');
      return;
    }
    const cap = Math.max(1, Math.round(safeFiniteNumber(cycleFocusCapInput, 6)));
    try {
      await upsertCycleMutation.mutateAsync({
        year: selectedYear,
        theme: trimmedTheme,
        vision_md: cycleVisionInput.trim(),
        anti_goals_md: cycleAntiGoalsInput.trim(),
        focus_cap_limit: cap,
        status: cycleStatusInput,
      });
      setCycleModalOpen(false);
      setStatusMessage(`Cycle ${selectedYear} strategic blueprint updated.`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to update annual cycle.');
    }
  };

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const cleanTitle = goalTitleInput.trim();
    if (!cleanTitle) {
      setErrorMessage('Goal title must not be empty.');
      return;
    }
    try {
      const created = await createGoalMutation.mutateAsync({
        year: selectedYear,
        pillar: goalPillarInput,
        code: goalCodeInput.trim() || undefined,
        title: cleanTitle,
        status: goalStatusInput,
        priority_rank: Math.max(1, Math.round(safeFiniteNumber(goalPriorityInput, 1))),
        confidence_score: Math.min(
          10,
          Math.max(1, Math.round(safeFiniteNumber(goalConfidenceInput, 8))),
        ),
        target_date: goalTargetDateInput.trim() || null,
        why_motivation_md: goalWhyInput.trim(),
      });
      setSelectedGoalId(created.id);
      setGoalTitleInput('');
      setGoalCodeInput('');
      setGoalWhyInput('');
      setNewGoalModalOpen(false);
      setStatusMessage(`Objective ${created.code} (${created.title}) created.`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to create objective.');
    }
  };

  const handlePinGoalPosition = async (goalId: string, pos: BlueprintPos) => {
    if (!goalId || goalId.startsWith('cycle-')) return;
    try {
      await pinGoalPosMutation.mutateAsync({ goalId, pos });
      setStatusMessage(`Pinned room node coordinates (${pos.x}, ${pos.y}).`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to persist blueprint node position.');
    }
  };

  const handleCreateKr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!krModalGoalId) return;
    setErrorMessage(null);
    const cleanTitle = krTitleInput.trim();
    if (!cleanTitle) {
      setErrorMessage('Key Result title must not be empty.');
      return;
    }
    const milestones_json =
      krMetricTypeInput === 'milestones'
        ? krMilestonesInput
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((title, idx) => ({
              id: `ms-${idx + 1}`,
              title,
              done: false,
              weight: 1,
            }))
        : undefined;

    try {
      await createKrMutation.mutateAsync({
        goalId: krModalGoalId,
        payload: {
          quarter: krQuarterInput,
          code: krCodeInput.trim() || undefined,
          title: cleanTitle,
          metric_type: krMetricTypeInput,
          start_value: safeFiniteNumber(krStartInput, 0),
          current_value: safeFiniteNumber(krCurrentInput, 0),
          target_value:
            krMetricTypeInput === 'binary' ? 1 : safeFiniteNumber(krTargetInput, 100),
          unit: krUnitInput.trim() || '%',
          weight: Math.max(0.1, safeFiniteNumber(krWeightInput, 1)),
          linked_entity_id: krLinkedEntityInput.trim() || null,
          milestones_json,
        },
      });
      setKrTitleInput('');
      setKrCodeInput('');
      setKrModalGoalId(null);
      setStatusMessage('Key Result added and weighted rollup recalculated.');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to create Key Result.');
    }
  };

  const handleStepOrToggleKr = async (kr: GoalKeyResult) => {
    setErrorMessage(null);
    try {
      if (kr.metric_type === 'binary') {
        const nextVal = kr.current_value_num >= 1 ? 0 : 1;
        await updateKrMutation.mutateAsync({
          krId: kr.id,
          payload: { current_value: nextVal },
        });
        return;
      }
      if (kr.metric_type === 'milestones' && kr.milestones_json.length > 0) {
        const firstIncompleteIdx = kr.milestones_json.findIndex((m) => !m.done);
        const updatedMilestones = kr.milestones_json.map((m, idx) =>
          idx === (firstIncompleteIdx === -1 ? 0 : firstIncompleteIdx)
            ? { ...m, done: firstIncompleteIdx !== -1, completed: firstIncompleteIdx !== -1 }
            : m,
        );
        await updateKrMutation.mutateAsync({
          krId: kr.id,
          payload: { milestones_json: updatedMilestones },
        });
        return;
      }
      const step = Math.max(1, Math.abs(kr.target_value_num - kr.start_value_num) * 0.25);
      const nextVal = Math.min(kr.target_value_num, kr.current_value_num + step);
      await updateKrMutation.mutateAsync({
        krId: kr.id,
        payload: { current_value: Math.round(nextVal * 100) / 100 },
      });
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to update Key Result.');
    }
  };

  const handleSubmitCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetGoal = activeCheckinGoal;
    if (!targetGoal) return;
    setErrorMessage(null);
    const conf = Math.min(
      10,
      Math.max(1, Math.round(safeFiniteNumber(checkinConfidenceInput, 8))),
    );
    try {
      await createCheckinMutation.mutateAsync({
        goalId: targetGoal.id,
        payload: {
          confidence_score: conf,
          wins_md: checkinWinsInput.trim() || 'Maintained execution cadence.',
          blockers_md: checkinBlockersInput.trim(),
          next_steps_md: checkinNextStepsInput.trim(),
          ...(checkinKrIdInput
            ? {
                kr_id: checkinKrIdInput,
                kr_current_value: safeFiniteNumber(checkinKrValueInput, 0),
              }
            : {}),
        },
      });
      setCheckinWinsInput('');
      setCheckinBlockersInput('');
      setCheckinNextStepsInput('');
      setCheckinKrIdInput('');
      setCheckinKrValueInput('');
      setStatusMessage(`Check-in logged for ${targetGoal.code}.`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to submit goal check-in.');
    }
  };

  const cycleYears = useMemo(() => {
    const set = new Set<number>([2026, 2027, ...cycles.map((c) => c.year)]);
    return Array.from(set).sort((a, b) => a - b);
  }, [cycles]);

  return (
    <div
      data-testid="goals-page"
      style={{
        flex: 1,
        padding: '16px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        borderRadius: '0px',
      }}
    >
      {/* Top Strategic Command Header & Annual Cycle Switcher */}
      <FuiPanel
        surface="carbon"
        headerTitle={`YEARLY GOALS & QUARTERLY OKRS // CYCLE ${selectedYear} (${activeCycle.theme.toUpperCase()})`}
        headerProps={{
          title: `YEARLY GOALS & QUARTERLY OKRS // CYCLE ${selectedYear} (${activeCycle.theme.toUpperCase()})`,
          code: 'MOD_09',
          accent: 'orange',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            borderRadius: '0px',
          }}
        >
          {/* Cycle Switcher + View Mode Tabs + Action Controls */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
              borderRadius: '0px',
            }}
          >
            {/* Annual Cycle Buttons (2026 / 2027) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  color: FUI_TOKENS.inkMuted,
                }}
              >
                ANNUAL CYCLE:
              </span>
              {cycleYears.map((yr) => {
                const isSelected = yr === selectedYear;
                return (
                  <button
                    key={yr}
                    type="button"
                    data-testid={`cycle-btn-${yr}`}
                    onClick={() => {
                      setSelectedYear(yr);
                      setSelectedGoalId(null);
                      setStatusMessage(null);
                      setErrorMessage(null);
                    }}
                    style={{
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      fontWeight: 700,
                      padding: '6px 12px',
                      backgroundColor: isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgPanel,
                      color: isSelected ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                      border: `1px solid ${isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline}`,
                      cursor: 'pointer',
                      borderRadius: '0px',
                    }}
                  >
                    CYCLE {yr}
                  </button>
                );
              })}
              <FuiButton
                size="sm"
                variant="ghost"
                data-testid="edit-cycle-btn"
                onClick={handleOpenCycleEditor}
              >
                EDIT CYCLE VISION
              </FuiButton>
            </div>

            {/* View Mode Switcher */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                data-testid="view-mode-all"
                onClick={() => setViewMode('all')}
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  padding: '6px 10px',
                  backgroundColor: viewMode === 'all' ? '#1A242F' : FUI_TOKENS.bgPanel,
                  color: viewMode === 'all' ? FUI_TOKENS.accentCyan : FUI_TOKENS.inkStark,
                  border: `1px solid ${viewMode === 'all' ? FUI_TOKENS.accentCyan : FUI_TOKENS.borderHairline}`,
                  cursor: 'pointer',
                  borderRadius: '0px',
                }}
              >
                ALL // SCHEMATIC + OKRS
              </button>
              <button
                type="button"
                data-testid="view-mode-blueprint"
                onClick={() => setViewMode('blueprint')}
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  padding: '6px 10px',
                  backgroundColor: viewMode === 'blueprint' ? '#1A242F' : FUI_TOKENS.bgPanel,
                  color: viewMode === 'blueprint' ? FUI_TOKENS.accentCyan : FUI_TOKENS.inkStark,
                  border: `1px solid ${viewMode === 'blueprint' ? FUI_TOKENS.accentCyan : FUI_TOKENS.borderHairline}`,
                  cursor: 'pointer',
                  borderRadius: '0px',
                }}
              >
                BLUEPRINT SCHEMATIC MAP
              </button>
              <button
                type="button"
                data-testid="view-mode-okr"
                onClick={() => setViewMode('okr')}
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  padding: '6px 10px',
                  backgroundColor: viewMode === 'okr' ? '#1A242F' : FUI_TOKENS.bgPanel,
                  color: viewMode === 'okr' ? FUI_TOKENS.accentCyan : FUI_TOKENS.inkStark,
                  border: `1px solid ${viewMode === 'okr' ? FUI_TOKENS.accentCyan : FUI_TOKENS.borderHairline}`,
                  cursor: 'pointer',
                  borderRadius: '0px',
                }}
              >
                Q1–Q4 OKR MATRIX
              </button>
            </div>

            {/* Primary CTA Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <FuiButton
                size="sm"
                variant="secondary"
                data-testid="global-checkin-btn"
                onClick={() => {
                  const target = selectedGoalId ?? goals[0]?.id ?? null;
                  setCheckinGoalId(target);
                }}
              >
                CHECK-IN / LOG PROGRESS
              </FuiButton>
              <FuiButton
                size="sm"
                variant="primary"
                data-testid="new-goal-btn"
                onClick={() => {
                  setErrorMessage(null);
                  setNewGoalModalOpen(true);
                }}
              >
                + NEW GOAL
              </FuiButton>
            </div>
          </div>

          {/* Cycle Theme, Vision & Anti-Goals Summary Strip */}
          <div
            data-testid="cycle-vision-strip"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '10px',
              padding: '10px',
              backgroundColor: FUI_TOKENS.bgPanel,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              borderRadius: '0px',
            }}
          >
            <div>
              <div style={{ color: FUI_TOKENS.accentOrange, fontWeight: 700 }}>
                ANNUAL THEME ({activeCycle.year}) // {activeCycle.status.toUpperCase()}
              </div>
              <div style={{ color: FUI_TOKENS.inkStark, marginTop: '2px' }}>
                {activeCycle.theme}
              </div>
            </div>
            <div>
              <div style={{ color: FUI_TOKENS.accentCyan, fontWeight: 700 }}>
                STRATEGIC VISION // NORTH STAR
              </div>
              <div style={{ color: FUI_TOKENS.inkProse, marginTop: '2px' }}>
                {activeCycle.vision_md}
              </div>
            </div>
            <div>
              <div style={{ color: FUI_TOKENS.accentAmber, fontWeight: 700 }}>
                ANTI-GOALS & FOCUS GUARDRAILS
              </div>
              <div style={{ color: FUI_TOKENS.inkProse, marginTop: '2px' }}>
                {activeCycle.anti_goals_md} (ACTIVE CAP: {activeGoalsCount}/{focusCapLimit})
              </div>
            </div>
          </div>

          {/* Non-Blocking Focus Cap Warning Banner */}
          {focusCapExceeded && (
            <div
              role="alert"
              data-testid="focus-cap-warning-banner"
              style={{
                padding: '10px 12px',
                backgroundColor: '#261409',
                border: `1px solid ${FUI_TOKENS.accentAmber}`,
                color: FUI_TOKENS.accentAmber,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                borderRadius: '0px',
              }}
            >
              <span>
                FOCUS CAP WARNING // Active goals ({activeGoalsCount}) exceed cycle {selectedYear} focus cap limit ({focusCapLimit}) — non-blocking guardrail active.
              </span>
              <FuiBadge tone="amber">FOCUS CAP LIMIT EXCEEDED</FuiBadge>
            </div>
          )}

          {statusMessage && (
            <div
              data-testid="goals-status-banner"
              style={{
                padding: '8px 10px',
                backgroundColor: '#0E1F14',
                border: `1px solid ${FUI_TOKENS.accentPhosphor}`,
                color: FUI_TOKENS.accentPhosphor,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              {statusMessage}
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              data-testid="goals-error-banner"
              style={{
                padding: '8px 10px',
                backgroundColor: '#290E0B',
                border: `1px solid ${FUI_TOKENS.accentVermilion}`,
                color: FUI_TOKENS.accentVermilion,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              {errorMessage}
            </div>
          )}
        </div>
      </FuiPanel>

      {/* REF-03 90-Degree Orthogonal Architectural Blueprint Canvas (Always rendered & visible on /goals) */}
      <Ref03BlueprintCanvas
        layout={effectiveBlueprint}
        selectedGoalId={selectedGoalId}
        onSelectGoal={(id) => setSelectedGoalId(id)}
        onPinGoalPosition={handlePinGoalPosition}
      />

      {/* Goal Cards & Q1-Q4 Key Result Execution Matrix */}
      <FuiPanel
        surface="carbon"
        headerTitle={`OBJECTIVES & Q1–Q4 KEY RESULTS MATRIX // ${filteredGoals.length} GOALS IN ${selectedYear}`}
        headerProps={{
          title: `OBJECTIVES & Q1–Q4 KEY RESULTS MATRIX // ${filteredGoals.length} GOALS IN ${selectedYear}`,
          code: 'OKR_MATRIX',
          accent: 'cyan',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderRadius: '0px' }}>
          {/* Pillar Filter Strip */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkMuted,
              }}
            >
              FILTER PILLAR:
            </span>
            {(['ALL', ...Object.keys(GOAL_PILLAR_LABELS)] as string[]).map((pillarKey) => {
              const active = pillarFilter === pillarKey;
              return (
                <button
                  key={pillarKey}
                  type="button"
                  onClick={() => setPillarFilter(pillarKey)}
                  style={{
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    padding: '4px 8px',
                    backgroundColor: active ? FUI_TOKENS.accentCyan : FUI_TOKENS.bgPanel,
                    color: active ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                    border: `1px solid ${active ? FUI_TOKENS.accentCyan : FUI_TOKENS.borderHairline}`,
                    cursor: 'pointer',
                    borderRadius: '0px',
                  }}
                >
                  {pillarKey === 'ALL'
                    ? 'ALL PILLARS'
                    : GOAL_PILLAR_LABELS[pillarKey as GoalPillar]}
                </button>
              );
            })}
          </div>

          {filteredGoals.length === 0 ? (
            <div
              data-testid="goals-empty-state"
              style={{
                padding: '16px',
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkMuted,
                borderRadius: '0px',
              }}
            >
              NO OBJECTIVES REGISTERED FOR CYCLE {selectedYear} // CLICK &quot;+ NEW GOAL&quot; TO INITIALIZE Q1–Q4 OKRS.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                borderRadius: '0px',
              }}
            >
              {filteredGoals.map((goal: GoalWithDetails) => {
                const paceBadge = getPaceBadgeMeta(goal.pace_health);
                const safeGoalPct = clampPercentage(goal.progress_pct_num, 0);

                return (
                  <div
                    key={goal.id}
                    data-testid={`goal-card-${goal.id}`}
                    data-goal-code={goal.code}
                    style={{
                      backgroundColor: FUI_TOKENS.bgPanel,
                      border: `1px solid ${
                        selectedGoalId === goal.id
                          ? FUI_TOKENS.accentOrange
                          : FUI_TOKENS.borderHairline
                      }`,
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      borderRadius: '0px',
                    }}
                  >
                    {/* Goal Card Header */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '10px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <FuiBadge tone="orange">{goal.code}</FuiBadge>
                          <FuiBadge tone="cyan">{GOAL_PILLAR_LABELS[goal.pillar]}</FuiBadge>
                          <FuiBadge tone={paceBadge.tone}>{paceBadge.label}</FuiBadge>
                          <FuiBadge tone="muted">{goal.status.toUpperCase()}</FuiBadge>
                          <span
                            style={{
                              fontFamily: FUI_TOKENS.fontMono,
                              fontSize: '12px',
                              color: FUI_TOKENS.inkMuted,
                            }}
                          >
                            CONFIDENCE: {goal.confidence_score}/10 · INVESTED (14D): {goal.invested_hours}H
                            {goal.target_date ? ` · TARGET: ${goal.target_date}` : ''}
                            {goal.blueprint_pos
                              ? ` · PINNED (${goal.blueprint_pos.x}, ${goal.blueprint_pos.y})`
                              : ''}
                          </span>
                        </div>
                        <div
                          style={{
                            fontFamily: FUI_TOKENS.fontSans,
                            fontSize: '15px',
                            fontWeight: 700,
                            color: FUI_TOKENS.inkStark,
                          }}
                        >
                          {goal.title}
                        </div>
                        {goal.why_motivation_md && (
                          <div
                            style={{
                              fontFamily: FUI_TOKENS.fontMono,
                              fontSize: '12px',
                              color: FUI_TOKENS.inkProse,
                            }}
                          >
                            WHY // {goal.why_motivation_md}
                          </div>
                        )}
                      </div>

                      {/* Goal Actions & Progress Readout */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <FuiBadge tone={safeGoalPct >= 100 ? 'phosphor' : 'orange'}>
                          {safeGoalPct}% COMPLETE
                        </FuiBadge>
                        <FuiButton
                          size="sm"
                          variant="secondary"
                          data-testid={`goal-checkin-btn-${goal.id}`}
                          onClick={() => {
                            setSelectedGoalId(goal.id);
                            setCheckinGoalId(goal.id);
                            setCheckinConfidenceInput(String(goal.confidence_score));
                          }}
                        >
                          Check-In / Log Progress
                        </FuiButton>
                        <FuiButton
                          size="sm"
                          variant="ghost"
                          data-testid={`add-kr-btn-${goal.id}`}
                          onClick={() => {
                            setKrModalGoalId(goal.id);
                            setErrorMessage(null);
                          }}
                        >
                          + ADD KR
                        </FuiButton>
                        <FuiButton
                          size="sm"
                          variant="ghost"
                          data-testid={`pin-goal-btn-${goal.id}`}
                          onClick={() =>
                            handlePinGoalPosition(goal.id, {
                              x: (goal.blueprint_pos?.x ?? 380) + 20,
                              y: (goal.blueprint_pos?.y ?? 160) + 20,
                            })
                          }
                        >
                          PIN NODE
                        </FuiButton>
                        <FuiButton
                          size="sm"
                          variant="danger"
                          data-testid={`delete-goal-btn-${goal.id}`}
                          onClick={async () => {
                            try {
                              await deleteGoalMutation.mutateAsync(goal.id);
                            } catch {
                              // Ignore error
                            }
                          }}
                        >
                          DELETE
                        </FuiButton>
                      </div>
                    </div>

                    {/* Goal Progress Bar */}
                    <div
                      style={{
                        width: '100%',
                        height: '8px',
                        backgroundColor: FUI_TOKENS.bgCarbon,
                        border: `1px solid ${FUI_TOKENS.borderHairline}`,
                        borderRadius: '0px',
                      }}
                    >
                      <div
                        style={{
                          width: `${safeGoalPct}%`,
                          height: '100%',
                          backgroundColor:
                            safeGoalPct >= 100
                              ? FUI_TOKENS.accentPhosphor
                              : FUI_TOKENS.accentOrange,
                          borderRadius: '0px',
                        }}
                      />
                    </div>

                    {/* Q1-Q4 Key Results List */}
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        marginTop: '4px',
                        borderRadius: '0px',
                      }}
                    >
                      <div
                        style={{
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                          color: FUI_TOKENS.accentCyan,
                          fontWeight: 700,
                        }}
                      >
                        KEY RESULTS (Q1 / Q2 / Q3 / Q4 / ANNUAL) // {goal.key_results.length} TOTAL
                      </div>

                      {goal.key_results.length === 0 ? (
                        <div
                          style={{
                            fontFamily: FUI_TOKENS.fontMono,
                            fontSize: '12px',
                            color: FUI_TOKENS.inkMuted,
                            padding: '6px',
                            border: `1px solid ${FUI_TOKENS.borderHairline}`,
                            borderRadius: '0px',
                          }}
                        >
                          No Key Results defined yet for {goal.code}. Click &quot;+ ADD KR&quot; to attach Q1–Q4 metrics.
                        </div>
                      ) : (
                        goal.key_results.map((kr) => {
                          const safeKrPct = clampPercentage(kr.progress_pct_num, 0);
                          return (
                            <div
                              key={kr.id}
                              data-testid={`kr-row-${kr.id}`}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: '8px',
                                padding: '8px 10px',
                                backgroundColor: FUI_TOKENS.bgCarbon,
                                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                                fontFamily: FUI_TOKENS.fontMono,
                                fontSize: '12px',
                                borderRadius: '0px',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <FuiBadge tone="orange">{kr.quarter}</FuiBadge>
                                <FuiBadge tone="cyan">{kr.code}</FuiBadge>
                                <FuiBadge tone="muted">
                                  {KR_METRIC_LABELS[kr.metric_type]}
                                </FuiBadge>
                                <span style={{ color: FUI_TOKENS.inkStark, fontWeight: 600 }}>
                                  {kr.title}
                                </span>
                                <span style={{ color: FUI_TOKENS.inkMuted }}>
                                  ({kr.current_value_num} / {kr.target_value_num} {kr.unit} · W:{kr.weight_num})
                                </span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <FuiBadge tone={safeKrPct >= 100 ? 'phosphor' : 'cyan'}>
                                  {safeKrPct}%
                                </FuiBadge>
                                <button
                                  type="button"
                                  data-testid={`kr-step-btn-${kr.id}`}
                                  onClick={() => handleStepOrToggleKr(kr)}
                                  style={{
                                    fontFamily: FUI_TOKENS.fontMono,
                                    fontSize: '12px',
                                    padding: '4px 8px',
                                    backgroundColor: FUI_TOKENS.bgPanel,
                                    color: FUI_TOKENS.accentPhosphor,
                                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                                    cursor: 'pointer',
                                    borderRadius: '0px',
                                  }}
                                >
                                  {kr.metric_type === 'binary' ? 'TOGGLE 0/1' : '+ PROGRESS'}
                                </button>
                                <button
                                  type="button"
                                  data-testid={`kr-delete-btn-${kr.id}`}
                                  onClick={async () => {
                                    try {
                                      await deleteKrMutation.mutateAsync(kr.id);
                                    } catch {
                                      // Ignore error
                                    }
                                  }}
                                  style={{
                                    fontFamily: FUI_TOKENS.fontMono,
                                    fontSize: '12px',
                                    padding: '4px 8px',
                                    backgroundColor: FUI_TOKENS.bgPanel,
                                    color: FUI_TOKENS.accentVermilion,
                                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                                    cursor: 'pointer',
                                    borderRadius: '0px',
                                  }}
                                >
                                  DEL
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </FuiPanel>

      {/* Inline / Drawer Goal Check-In & Progress Log Panel */}
      {activeCheckinGoal && (
        <FuiPanel
          surface="carbon"
          data-testid="goal-checkin-drawer"
          headerTitle={`GOAL CHECK-IN & PROGRESS LOG // ${activeCheckinGoal.code} — ${activeCheckinGoal.title}`}
          headerProps={{
            title: `GOAL CHECK-IN & PROGRESS LOG // ${activeCheckinGoal.code} — ${activeCheckinGoal.title}`,
            code: 'CHECKIN_LOG',
            accent: 'phosphor',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '14px',
              borderRadius: '0px',
            }}
          >
            {/* Log Check-in Form */}
            <form
              onSubmit={handleSubmitCheckin}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              <div style={{ color: FUI_TOKENS.accentPhosphor, fontWeight: 700 }}>
                SUBMIT PERIODIC CHECK-IN ({activeCheckinGoal.code})
              </div>
              <FuiInput
                label="CONFIDENCE SCORE (1..10)"
                type="number"
                min={1}
                max={10}
                value={checkinConfidenceInput}
                onChange={(e) => setCheckinConfidenceInput(e.target.value)}
              />
              <FuiInput
                label="WINS & MILESTONES ACHIEVED"
                placeholder="Completed initial architecture review..."
                value={checkinWinsInput}
                onChange={(e) => setCheckinWinsInput(e.target.value)}
              />
              <FuiInput
                label="BLOCKERS & DRIFT RISKS"
                placeholder="Waiting on upstream integration..."
                value={checkinBlockersInput}
                onChange={(e) => setCheckinBlockersInput(e.target.value)}
              />
              <FuiInput
                label="NEXT STEPS"
                placeholder="Ship Q2 milestone benchmark..."
                value={checkinNextStepsInput}
                onChange={(e) => setCheckinNextStepsInput(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <FuiButton
                  type="button"
                  variant="primary"
                  size="sm"
                  data-testid="submit-goal-checkin-btn"
                  onClick={(e) => void handleSubmitCheckin(e)}
                >
                  SAVE CHECK-IN
                </FuiButton>
              </div>
            </form>

            {/* Historical Check-ins List */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              <div style={{ color: FUI_TOKENS.accentCyan, fontWeight: 700 }}>
                CHECK-IN HISTORY ({activeGoalCheckins.length})
              </div>
              {activeGoalCheckins.length === 0 ? (
                <div style={{ color: FUI_TOKENS.inkMuted }}>
                  No check-ins recorded yet for {activeCheckinGoal.code}.
                </div>
              ) : (
                activeGoalCheckins.map((ci) => (
                  <div
                    key={ci.id}
                    data-testid={`checkin-item-${ci.id}`}
                    style={{
                      padding: '8px',
                      backgroundColor: FUI_TOKENS.bgPanel,
                      border: `1px solid ${FUI_TOKENS.borderHairline}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      borderRadius: '0px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: FUI_TOKENS.accentOrange, fontWeight: 700 }}>
                        {ci.checkin_date}
                      </span>
                      <FuiBadge tone="phosphor">CONFIDENCE {ci.confidence_score}/10</FuiBadge>
                    </div>
                    {ci.wins_md && (
                      <div style={{ color: FUI_TOKENS.inkStark }}>WINS: {ci.wins_md}</div>
                    )}
                    {ci.blockers_md && (
                      <div style={{ color: FUI_TOKENS.accentAmber }}>
                        BLOCKERS: {ci.blockers_md}
                      </div>
                    )}
                    {ci.next_steps_md && (
                      <div style={{ color: FUI_TOKENS.inkMuted }}>
                        NEXT: {ci.next_steps_md}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </FuiPanel>
      )}

      {/* Modal: Edit Cycle Vision & Focus Cap */}
      <FuiModal
        open={cycleModalOpen}
        onClose={() => setCycleModalOpen(false)}
        title={`EDIT ANNUAL CYCLE // ${selectedYear}`}
      >
        <form
          onSubmit={handleSaveCycle}
          style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderRadius: '0px' }}
        >
          <FuiInput
            label="ANNUAL THEME"
            value={cycleThemeInput}
            onChange={(e) => setCycleThemeInput(e.target.value)}
            required
          />
          <FuiInput
            label="STRATEGIC VISION (MARKDOWN)"
            value={cycleVisionInput}
            onChange={(e) => setCycleVisionInput(e.target.value)}
          />
          <FuiInput
            label="ANTI-GOALS (GUARDRAILS)"
            value={cycleAntiGoalsInput}
            onChange={(e) => setCycleAntiGoalsInput(e.target.value)}
          />
          <FuiInput
            label="FOCUS CAP LIMIT (MAX ACTIVE GOALS)"
            type="number"
            min={1}
            max={20}
            value={cycleFocusCapInput}
            onChange={(e) => setCycleFocusCapInput(e.target.value)}
          />
          <FuiSelect
            label="CYCLE STATUS"
            value={cycleStatusInput}
            onChange={(e) => setCycleStatusInput(e.target.value as CycleStatus)}
            options={[
              { value: 'planning', label: 'PLANNING' },
              { value: 'active', label: 'ACTIVE' },
              { value: 'closed', label: 'CLOSED' },
            ]}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <FuiButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCycleModalOpen(false)}
            >
              CANCEL
            </FuiButton>
            <FuiButton
              type="button"
              variant="primary"
              size="sm"
              data-testid="save-cycle-btn"
              onClick={(e) => void handleSaveCycle(e)}
            >
              SAVE CYCLE
            </FuiButton>
          </div>
        </form>
      </FuiModal>

      {/* Modal: Create New Goal */}
      <FuiModal
        open={newGoalModalOpen}
        onClose={() => setNewGoalModalOpen(false)}
        title={`CREATE STRATEGIC OBJECTIVE // CYCLE ${selectedYear}`}
      >
        <form
          onSubmit={handleCreateGoal}
          style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderRadius: '0px' }}
        >
          <FuiInput
            label="OBJECTIVE TITLE"
            placeholder="Ship Resilient Distributed Core Engine"
            value={goalTitleInput}
            onChange={(e) => setGoalTitleInput(e.target.value)}
            required
          />
          <FuiInput
            label="OBJECTIVE CODE (OPTIONAL, E.G. G01)"
            placeholder="G01"
            value={goalCodeInput}
            onChange={(e) => setGoalCodeInput(e.target.value)}
          />
          <FuiSelect
            label="LIFE PILLAR"
            value={goalPillarInput}
            onChange={(e) => setGoalPillarInput(e.target.value as GoalPillar)}
            options={(Object.keys(GOAL_PILLAR_LABELS) as GoalPillar[]).map((k) => ({
              value: k,
              label: GOAL_PILLAR_LABELS[k],
            }))}
          />
          <FuiSelect
            label="STATUS"
            value={goalStatusInput}
            onChange={(e) => setGoalStatusInput(e.target.value as GoalStatus)}
            options={[
              { value: 'in_progress', label: 'IN PROGRESS' },
              { value: 'not_started', label: 'NOT STARTED' },
              { value: 'completed', label: 'COMPLETED' },
              { value: 'paused', label: 'PAUSED' },
              { value: 'dropped', label: 'DROPPED' },
            ]}
          />
          <FuiInput
            label="PRIORITY RANK (>= 1)"
            type="number"
            min={1}
            max={99}
            value={goalPriorityInput}
            onChange={(e) => setGoalPriorityInput(e.target.value)}
          />
          <FuiInput
            label="CONFIDENCE SCORE (1..10)"
            type="number"
            min={1}
            max={10}
            value={goalConfidenceInput}
            onChange={(e) => setGoalConfidenceInput(e.target.value)}
          />
          <FuiInput
            label="TARGET DATE (YYYY-MM-DD)"
            value={goalTargetDateInput}
            onChange={(e) => setGoalTargetDateInput(e.target.value)}
          />
          <FuiInput
            label="WHY / MOTIVATION"
            value={goalWhyInput}
            onChange={(e) => setGoalWhyInput(e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <FuiButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setNewGoalModalOpen(false)}
            >
              CANCEL
            </FuiButton>
            <FuiButton
              type="button"
              variant="primary"
              size="sm"
              data-testid="confirm-create-goal-btn"
              onClick={(e) => void handleCreateGoal(e)}
            >
              CREATE OBJECTIVE
            </FuiButton>
          </div>
        </form>
      </FuiModal>

      {/* Modal: Add Key Result */}
      <FuiModal
        open={Boolean(krModalGoalId)}
        onClose={() => setKrModalGoalId(null)}
        title="ADD QUARTERLY KEY RESULT (Q1–Q4)"
      >
        <form
          onSubmit={handleCreateKr}
          style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderRadius: '0px' }}
        >
          <FuiInput
            label="KEY RESULT TITLE"
            placeholder="Complete 12 Deep Systems Benchmarks"
            value={krTitleInput}
            onChange={(e) => setKrTitleInput(e.target.value)}
            required
          />
          <FuiSelect
            label="QUARTER"
            value={krQuarterInput}
            onChange={(e) => setKrQuarterInput(e.target.value as OkrQuarter)}
            options={OKR_QUARTERS.map((q) => ({ value: q, label: q }))}
          />
          <FuiSelect
            label="METRIC TYPE (7 SUPPORTED TYPES)"
            value={krMetricTypeInput}
            onChange={(e) => setKrMetricTypeInput(e.target.value as KrMetricType)}
            options={(Object.keys(KR_METRIC_LABELS) as KrMetricType[]).map((m) => ({
              value: m,
              label: KR_METRIC_LABELS[m],
            }))}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <FuiInput
              label="START VALUE"
              type="number"
              value={krStartInput}
              onChange={(e) => setKrStartInput(e.target.value)}
            />
            <FuiInput
              label="CURRENT VALUE"
              type="number"
              value={krCurrentInput}
              onChange={(e) => setKrCurrentInput(e.target.value)}
            />
            <FuiInput
              label="TARGET VALUE"
              type="number"
              value={krTargetInput}
              onChange={(e) => setKrTargetInput(e.target.value)}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <FuiInput
              label="UNIT"
              value={krUnitInput}
              onChange={(e) => setKrUnitInput(e.target.value)}
            />
            <FuiInput
              label="WEIGHT (> 0)"
              type="number"
              min={0.1}
              step={0.1}
              value={krWeightInput}
              onChange={(e) => setKrWeightInput(e.target.value)}
            />
          </div>
          {krMetricTypeInput === 'milestones' && (
            <FuiInput
              label="MILESTONES (COMMA SEPARATED)"
              value={krMilestonesInput}
              onChange={(e) => setKrMilestonesInput(e.target.value)}
            />
          )}
          {krMetricTypeInput.startsWith('linked_') && (
            <FuiInput
              label="LINKED ENTITY UUID (PROJECT / COURSE / HABIT / ASSET)"
              placeholder="01963000-0000-7000-8000-000000000001"
              value={krLinkedEntityInput}
              onChange={(e) => setKrLinkedEntityInput(e.target.value)}
            />
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <FuiButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setKrModalGoalId(null)}
            >
              CANCEL
            </FuiButton>
            <FuiButton
              type="button"
              variant="primary"
              size="sm"
              data-testid="confirm-create-kr-btn"
              onClick={(e) => void handleCreateKr(e)}
            >
              ADD KEY RESULT
            </FuiButton>
          </div>
        </form>
      </FuiModal>
    </div>
  );
}
