import React, { useEffect, useMemo, useState } from 'react';
import { FuiBadge, FuiButton, FuiInput, FuiModal, FuiSelect, FUI_TOKENS } from '@hermes/ui';
import type {
  RoutineItem,
  RoutineLog,
  RoutineLogStatus,
  RoutineStackWithItems,
} from '../../api/routines';
import {
  formatQuantitativeHabitProgress,
  isItemMvdIncluded,
  safeNumber,
} from './routinesModel';

export interface GuidedRoutineRunnerModalProps {
  open: boolean;
  onClose: () => void;
  stacks: RoutineStackWithItems[];
  initialStackId?: string | null;
  todayDate: string;
  todayLogsByItemId: Map<string, RoutineLog>;
  onLogStep: (payload: {
    routine_item_id: string;
    log_date: string;
    status: RoutineLogStatus;
    numeric_value?: number | null;
    notes?: string;
  }) => Promise<void>;
}

function formatTimerClock(secondsRemaining: number): string {
  const safe = Math.max(0, Math.round(safeNumber(secondsRemaining, 0)));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function GuidedRoutineRunnerModal({
  open,
  onClose,
  stacks,
  initialStackId,
  todayDate,
  todayLogsByItemId,
  onLogStep,
}: GuidedRoutineRunnerModalProps) {
  const [selectedStackId, setSelectedStackId] = useState<string>('');
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [timerRunning, setTimerRunning] = useState<boolean>(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(300);
  const [numericInput, setNumericInput] = useState<string>('');
  const [stepNotes, setStepNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [sessionOutcomes, setSessionOutcomes] = useState<Record<string, RoutineLogStatus>>({});
  const [runnerCompleted, setRunnerCompleted] = useState<boolean>(false);

  const activeStack = useMemo(() => {
    if (!stacks || stacks.length === 0) return null;
    if (selectedStackId) {
      const match = stacks.find((s) => s.id === selectedStackId);
      if (match) return match;
    }
    const withItems = stacks.find((s) => (s.items ?? []).length > 0);
    return withItems ?? stacks[0] ?? null;
  }, [stacks, selectedStackId]);

  const steps: RoutineItem[] = useMemo(() => {
    return activeStack?.items ?? [];
  }, [activeStack]);

  const currentItem: RoutineItem | null = useMemo(() => {
    if (steps.length === 0) return null;
    const clampedIdx = Math.max(0, Math.min(steps.length - 1, stepIndex));
    return steps[clampedIdx] ?? null;
  }, [steps, stepIndex]);

  useEffect(() => {
    if (!open) return;
    const initial =
      (initialStackId && stacks.find((s) => s.id === initialStackId)?.id) ||
      stacks.find((s) => (s.items ?? []).length > 0)?.id ||
      stacks[0]?.id ||
      '';
    setSelectedStackId(initial);
    setStepIndex(0);
    setRunnerCompleted(false);
    setSessionOutcomes({});
  }, [open, initialStackId, stacks]);

  useEffect(() => {
    if (!currentItem) {
      setSecondsLeft(300);
      setNumericInput('');
      setStepNotes('');
      setTimerRunning(false);
      return;
    }
    const estMins = Math.max(1, safeNumber(currentItem.estimated_minutes, 5));
    setSecondsLeft(estMins * 60);
    setTimerRunning(false);
    const existingLog = todayLogsByItemId.get(currentItem.id);
    const defaultNum =
      existingLog?.numeric_value ??
      currentItem.target_value ??
      (currentItem.tracking_type === 'duration' ? estMins : '');
    setNumericInput(defaultNum !== null && defaultNum !== undefined && defaultNum !== '' ? String(defaultNum) : '');
    setStepNotes(existingLog?.notes ?? '');
  }, [currentItem, todayLogsByItemId]);

  useEffect(() => {
    if (!open || !timerRunning) return undefined;
    const handle = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setTimerRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(handle);
  }, [open, timerRunning]);

  const handleStepAction = async (status: RoutineLogStatus) => {
    if (!currentItem || submitting) return;
    setSubmitting(true);
    try {
      const isQuant =
        currentItem.tracking_type === 'numeric' || currentItem.tracking_type === 'duration';
      let numericValue: number | null = null;
      if (isQuant) {
        const parsed = Number(numericInput);
        if (Number.isFinite(parsed) && numericInput.trim() !== '') {
          numericValue = parsed;
        } else if (status === 'completed') {
          numericValue = safeNumber(
            currentItem.target_value,
            Math.max(1, safeNumber(currentItem.estimated_minutes, 5)),
          );
        } else if (status === 'partial') {
          const target = safeNumber(
            currentItem.target_value,
            Math.max(1, safeNumber(currentItem.estimated_minutes, 5)),
          );
          numericValue = Number((target * 0.5).toFixed(1));
        }
      }

      await onLogStep({
        routine_item_id: currentItem.id,
        log_date: todayDate,
        status,
        numeric_value: numericValue,
        notes: stepNotes.trim() || undefined,
      });

      setSessionOutcomes((prev) => ({
        ...prev,
        [currentItem.id]: status,
      }));

      if (stepIndex + 1 < steps.length) {
        setStepIndex((idx) => idx + 1);
      } else {
        setRunnerCompleted(true);
        setTimerRunning(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const totalSteps = steps.length;
  const completedCount = useMemo(() => {
    let count = 0;
    for (const step of steps) {
      const status = sessionOutcomes[step.id] ?? todayLogsByItemId.get(step.id)?.status;
      if (status === 'completed' || status === 'partial') count += 1;
    }
    return count;
  }, [steps, sessionOutcomes, todayLogsByItemId]);

  const progressPct =
    totalSteps > 0 ? Math.min(100, Math.round((completedCount / totalSteps) * 100)) : 0;

  return (
    <FuiModal
      open={open}
      onClose={onClose}
      title="GUIDED ROUTINE RUNNER // SEQUENTIAL EXECUTION"
      code="RUNNER_08"
      accent="orange"
      maxWidthPx={680}
      footer={
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
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
            DATE: {todayDate} • PROGRESS: {completedCount}/{totalSteps} ({progressPct}%)
          </span>
          <FuiButton
            variant="secondary"
            onClick={onClose}
            data-testid="guided-runner-close-btn"
          >
            CLOSE RUNNER
          </FuiButton>
        </div>
      }
    >
      <div
        data-testid="guided-routine-runner-modal"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          borderRadius: '0px',
        }}
      >
        {/* Stack Selector & Step Progress Bar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            borderRadius: '0px',
          }}
        >
          <div style={{ flex: '1 1 260px', borderRadius: '0px' }}>
            <FuiSelect
              label="ACTIVE ROUTINE STACK"
              value={activeStack?.id ?? ''}
              onChange={(e) => {
                setSelectedStackId(e.target.value);
                setStepIndex(0);
                setRunnerCompleted(false);
              }}
              options={stacks.map((s) => ({
                value: s.id,
                label: `${s.name} (${s.time_slot.toUpperCase()} • ${(s.items ?? []).length} STEPS)`,
              }))}
            />
          </div>
          <div
            style={{
              display: 'flex',
              gap: '6px',
              alignItems: 'center',
              borderRadius: '0px',
            }}
          >
            <FuiBadge tone="orange">
              STEP {totalSteps > 0 ? Math.min(totalSteps, stepIndex + 1) : 0} OF {totalSteps}
            </FuiBadge>
            <FuiBadge tone="phosphor">{progressPct}% ADHERENCE</FuiBadge>
          </div>
        </div>

        {/* Rectilinear Step Progress Track */}
        <div
          style={{
            width: '100%',
            height: '8px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            borderRadius: '0px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progressPct}%`,
              height: '100%',
              backgroundColor: FUI_TOKENS.accentOrange,
              borderRadius: '0px',
            }}
          />
        </div>

        {totalSteps === 0 ? (
          <div
            data-testid="guided-runner-empty"
            style={{
              padding: '20px',
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              backgroundColor: FUI_TOKENS.bgCarbon,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: FUI_TOKENS.inkMuted,
              borderRadius: '0px',
            }}
          >
            NO HABIT STEPS IN SELECTED STACK // Add habit steps on the Routine Stacks deck to run
            sequential execution.
          </div>
        ) : runnerCompleted ? (
          <div
            data-testid="guided-runner-summary"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              padding: '16px',
              border: `1px solid ${FUI_TOKENS.accentPhosphor}`,
              backgroundColor: FUI_TOKENS.bgCarbon,
              borderRadius: '0px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0px' }}>
              <span
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '14px',
                  fontWeight: 700,
                  color: FUI_TOKENS.accentPhosphor,
                  borderRadius: '0px',
                }}
              >
                STACK EXECUTION COMPLETE // {activeStack?.name}
              </span>
              <FuiBadge tone="phosphor" solid>
                {completedCount}/{totalSteps} LOGGED
              </FuiBadge>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderRadius: '0px' }}>
              {steps.map((step, i) => {
                const outcome =
                  sessionOutcomes[step.id] ?? todayLogsByItemId.get(step.id)?.status ?? 'skipped';
                return (
                  <div
                    key={step.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 10px',
                      border: `1px solid ${FUI_TOKENS.borderHairline}`,
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      borderRadius: '0px',
                    }}
                  >
                    <span>
                      {i + 1}. {step.title}
                    </span>
                    <FuiBadge
                      tone={
                        outcome === 'completed'
                          ? 'phosphor'
                          : outcome === 'partial'
                            ? 'cyan'
                            : 'amber'
                      }
                    >
                      {outcome.toUpperCase()}
                    </FuiBadge>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '8px', borderRadius: '0px' }}>
              <FuiButton
                variant="secondary"
                onClick={() => {
                  setStepIndex(0);
                  setRunnerCompleted(false);
                }}
              >
                ↺ RESTART STACK
              </FuiButton>
              <FuiButton variant="primary" onClick={onClose}>
                ✓ FINISH & RETURN
              </FuiButton>
            </div>
          </div>
        ) : (
          currentItem && (
            <div
              data-testid="guided-runner-active-step"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                padding: '16px',
                border: `1px solid ${FUI_TOKENS.accentOrange}`,
                backgroundColor: FUI_TOKENS.bgCarbon,
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                  <span
                    style={{
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '15px',
                      fontWeight: 700,
                      color: FUI_TOKENS.inkStark,
                      borderRadius: '0px',
                    }}
                  >
                    {currentItem.title}
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', borderRadius: '0px' }}>
                    <FuiBadge tone="cyan">{currentItem.tracking_type.toUpperCase()}</FuiBadge>
                    <FuiBadge tone="muted">{currentItem.frequency_type.toUpperCase()}</FuiBadge>
                    <FuiBadge tone="amber">{currentItem.estimated_minutes} MIN EST</FuiBadge>
                    {isItemMvdIncluded(currentItem) && <FuiBadge tone="phosphor">MVD CORE</FuiBadge>}
                  </div>
                </div>

                {/* Step Focus Countdown Clock */}
                <div
                  data-fui-ring="true"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: ' flex-end',
                    padding: '8px 12px',
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    backgroundColor: FUI_TOKENS.bgPanel,
                    borderRadius: '0px',
                  }}
                >
                  <span
                    data-testid="guided-runner-timer-readout"
                    style={{
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '20px',
                      fontWeight: 700,
                      color: timerRunning ? FUI_TOKENS.accentCyan : FUI_TOKENS.inkStark,
                      fontVariantNumeric: 'tabular-nums',
                      borderRadius: '0px',
                    }}
                  >
                    {formatTimerClock(secondsLeft)}
                  </span>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', borderRadius: '0px' }}>
                    <FuiButton
                      size="sm"
                      variant={timerRunning ? 'secondary' : 'cyan'}
                      onClick={() => setTimerRunning((r) => !r)}
                      data-testid="guided-runner-timer-toggle"
                    >
                      {timerRunning ? '⏸ PAUSE' : '▶ START'}
                    </FuiButton>
                    <FuiButton
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setTimerRunning(false);
                        setSecondsLeft(Math.max(1, safeNumber(currentItem.estimated_minutes, 5)) * 60);
                      }}
                      data-testid="guided-runner-timer-reset"
                    >
                      ↺ RESET
                    </FuiButton>
                  </div>
                </div>
              </div>

              {(currentItem.tracking_type === 'numeric' ||
                currentItem.tracking_type === 'duration') && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '10px',
                    alignItems: 'end',
                    borderRadius: '0px',
                  }}
                >
                  <FuiInput
                    label={`QUANTITATIVE VALUE (${
                      currentItem.unit || (currentItem.tracking_type === 'duration' ? 'min' : 'units')
                    })`}
                    type="number"
                    step="0.5"
                    value={numericInput}
                    onChange={(e) => setNumericInput(e.target.value)}
                    placeholder={String(currentItem.target_value ?? currentItem.estimated_minutes ?? 1)}
                    data-testid="guided-runner-numeric-input"
                  />
                  <div
                    style={{
                      padding: '8px 10px',
                      border: `1px solid ${FUI_TOKENS.borderHairline}`,
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      color: FUI_TOKENS.accentCyan,
                      borderRadius: '0px',
                    }}
                  >
                    TARGET:{' '}
                    {
                      formatQuantitativeHabitProgress(currentItem, {
                        status: 'partial',
                        numeric_value: numericInput !== '' ? Number(numericInput) : null,
                      }).formattedReadout
                    }
                  </div>
                </div>
              )}

              <FuiInput
                label="STEP EXECUTION NOTES (OPTIONAL)"
                type="text"
                value={stepNotes}
                onChange={(e) => setStepNotes(e.target.value)}
                placeholder="Observations, reps, or context..."
                data-testid="guided-runner-notes-input"
              />

              {/* Step Action Controls */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '6px',
                  borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
                  borderRadius: '0px',
                }}
              >
                <div style={{ display: 'flex', gap: '6px', borderRadius: '0px' }}>
                  <FuiButton
                    size="sm"
                    variant="secondary"
                    disabled={stepIndex <= 0 || submitting}
                    onClick={() => setStepIndex((idx) => Math.max(0, idx - 1))}
                  >
                    ◀ PREV STEP
                  </FuiButton>
                  <FuiButton
                    size="sm"
                    variant="secondary"
                    disabled={stepIndex + 1 >= totalSteps || submitting}
                    onClick={() => setStepIndex((idx) => Math.min(totalSteps - 1, idx + 1))}
                  >
                    NEXT STEP ▶
                  </FuiButton>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', borderRadius: '0px' }}>
                  <FuiButton
                    variant="primary"
                    loading={submitting}
                    onClick={() => handleStepAction('completed')}
                    data-testid="guided-runner-complete-step"
                  >
                    ✓ COMPLETE STEP
                  </FuiButton>
                  <FuiButton
                    variant="cyan"
                    loading={submitting}
                    onClick={() => handleStepAction('partial')}
                    data-testid="guided-runner-partial-step"
                  >
                    ◐ PARTIAL STEP
                  </FuiButton>
                  <FuiButton
                    variant="secondary"
                    loading={submitting}
                    onClick={() => handleStepAction('skipped')}
                    data-testid="guided-runner-skip-step"
                  >
                    ⏭ SKIP STEP
                  </FuiButton>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </FuiModal>
  );
}
