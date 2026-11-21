import React, { useEffect, useMemo, useState } from 'react';
import { FuiBadge, FuiButton, FuiInput, FuiPanel, FUI_TOKENS } from '@hermes/ui';
import type {
  UpsertWeeklyReviewPayload,
  WeeklyReviewSummaryResponse,
} from '../../api/routines';
import { formatWeeklyReviewMetrics } from './routinesModel';

export interface WeeklyReviewWizardPanelProps {
  summary?: WeeklyReviewSummaryResponse | null;
  todayDate: string;
  onExportReview: (
    isoWeek: string,
    payload: UpsertWeeklyReviewPayload,
    todayDate: string,
  ) => Promise<{ vaultPath: string }>;
  exporting?: boolean;
}

const WIZARD_STEPS = [
  { step: 1, code: 'STEP_01', label: '1. CLEAR INBOXES' },
  { step: 2, code: 'STEP_02', label: '2. INSPECT TELEMETRY' },
  { step: 3, code: 'STEP_03', label: '3. REFLECT (WINS & FRICTION)' },
  { step: 4, code: 'STEP_04', label: '4. PLAN NEXT WEEK & EXPORT' },
] as const;

export function WeeklyReviewWizardPanel({
  summary,
  todayDate,
  onExportReview,
  exporting = false,
}: WeeklyReviewWizardPanelProps) {
  const [activeStep, setActiveStep] = useState<number>(1);
  const [winsMd, setWinsMd] = useState<string>('');
  const [challengesMd, setChallengesMd] = useState<string>('');
  const [priority1, setPriority1] = useState<string>('');
  const [priority2, setPriority2] = useState<string>('');
  const [priority3, setPriority3] = useState<string>('');
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const metrics = useMemo(() => {
    return formatWeeklyReviewMetrics(summary);
  }, [summary]);

  useEffect(() => {
    if (!summary) return;
    if (summary.wins_md || summary.wins) {
      setWinsMd(String(summary.wins_md ?? summary.wins ?? ''));
    }
    if (summary.challenges_md || summary.challenges || summary.blockers_md || summary.blockers) {
      setChallengesMd(
        String(
          summary.challenges_md ??
            summary.challenges ??
            summary.blockers_md ??
            summary.blockers ??
            '',
        ),
      );
    }
    const rawPriorities = summary.next_week_priorities;
    if (Array.isArray(rawPriorities)) {
      setPriority1(String(rawPriorities[0] ?? ''));
      setPriority2(String(rawPriorities[1] ?? ''));
      setPriority3(String(rawPriorities[2] ?? ''));
    } else if (typeof rawPriorities === 'string' && rawPriorities.trim().length > 0) {
      const lines = rawPriorities
        .split('\n')
        .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
        .filter(Boolean);
      setPriority1(lines[0] ?? '');
      setPriority2(lines[1] ?? '');
      setPriority3(lines[2] ?? '');
    }
  }, [summary]);

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setExportedPath(null);

    const priorities = [priority1.trim(), priority2.trim(), priority3.trim()].filter(Boolean);
    const payload: UpsertWeeklyReviewPayload = {
      week_key: metrics.isoWeek,
      iso_week: metrics.isoWeek,
      wins: winsMd.trim() || 'Maintained baseline cadence.',
      wins_md: winsMd.trim() || 'Maintained baseline cadence.',
      challenges: challengesMd.trim() || 'No critical blockers logged.',
      challenges_md: challengesMd.trim() || 'No critical blockers logged.',
      blockers_md: challengesMd.trim() || 'No critical blockers logged.',
      next_week_priorities:
        priorities.length > 0 ? priorities : ['Lock Deep Work blocks', 'Maintain MVD streak'],
      next_steps_md:
        priorities.length > 0
          ? priorities.map((p, i) => `${i + 1}. ${p}`).join('\n')
          : '1. Lock Deep Work blocks',
    };

    try {
      const res = await onExportReview(metrics.isoWeek, payload, todayDate);
      setExportedPath(res.vaultPath || metrics.vaultExportPath);
    } catch (err: any) {
      setErrorMessage(
        err?.message ? String(err.message) : 'ERROR // Failed to export Weekly Review.',
      );
    }
  };

  return (
    <FuiPanel
      headerTitle="4-STEP WEEKLY REVIEW WIZARD // SECOND BRAIN VAULT SYNTHESIS"
      headerProps={{
        title: '4-STEP WEEKLY REVIEW WIZARD // SECOND BRAIN VAULT SYNTHESIS',
        code: 'MOD_08 // WEEKLY_REVIEW',
        accent: 'orange',
      }}
    >
      <form
        onSubmit={handleExport}
        data-testid="weekly-review-wizard-panel"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          borderRadius: '0px',
        }}
      >
        {/* Top Week Key & Vault Export Status */}
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', borderRadius: '0px' }}>
            <FuiBadge tone="orange">ISO WEEK: {metrics.isoWeek}</FuiBadge>
            <FuiBadge tone="cyan">
              WINDOW: {metrics.weekStart} → {metrics.weekEnd}
            </FuiBadge>
            <FuiBadge tone="phosphor" data-testid="weekly-review-vault-path">
              VAULT EXPORT: {exportedPath || metrics.vaultExportPath}
            </FuiBadge>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', borderRadius: '0px' }}>
            {WIZARD_STEPS.map((s) => (
              <button
                key={s.step}
                type="button"
                role="tab"
                aria-selected={activeStep === s.step}
                onClick={() => setActiveStep(s.step)}
                data-testid={`weekly-review-step-tab-${s.step}`}
                style={{
                  minHeight: '30px',
                  padding: '4px 10px',
                  backgroundColor:
                    activeStep === s.step ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                  color: activeStep === s.step ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                  border: `1px solid ${
                    activeStep === s.step ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                  }`,
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: '0px',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {errorMessage && (
          <div
            role="alert"
            data-testid="weekly-review-error"
            style={{
              padding: '8px 12px',
              backgroundColor: '#2A0D08',
              border: `1px solid ${FUI_TOKENS.accentVermilion}`,
              color: FUI_TOKENS.inkStark,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              borderRadius: '0px',
            }}
          >
            {errorMessage}
          </div>
        )}

        {exportedPath && (
          <div
            data-testid="weekly-review-exported-banner"
            style={{
              padding: '8px 12px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.accentPhosphor}`,
              color: FUI_TOKENS.accentPhosphor,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              borderRadius: '0px',
            }}
          >
            EXPORTED TO VAULT // {exportedPath}
          </div>
        )}

        {/* 4-Step Grid (All 4 steps visible & interactive; active step highlighted) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '12px',
            borderRadius: '0px',
          }}
        >
          {/* STEP 1: Collect & Clear Inboxes */}
          <div
            data-testid="weekly-review-step-1"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '12px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${
                activeStep === 1 ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
              }`,
              borderRadius: '0px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0px' }}>
              <span
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  fontWeight: 700,
                  color: FUI_TOKENS.accentOrange,
                  borderRadius: '0px',
                }}
              >
                STEP 1 // COLLECT & CLEAR INBOXES
              </span>
              <FuiBadge tone={metrics.inboxTasksCount === 0 ? 'phosphor' : 'amber'}>
                INBOX: {metrics.inboxTasksCount}
              </FuiBadge>
            </div>
            <p
              style={{
                margin: 0,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkProse,
                borderRadius: '0px',
              }}
            >
              UNPROCESSED INBOX TASKS: {metrics.inboxTasksCount} • COMPLETED THIS WEEK:{' '}
              {metrics.completedTasksCount}
            </p>
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkMuted,
                borderRadius: '0px',
              }}
            >
              {metrics.inboxTasksCount === 0
                ? 'INBOX ZERO ACHIEVED // All captured tasks triaged.'
                : `TRIAGE REQUIRED // ${metrics.inboxTasksCount} item(s) awaiting assignment in /todos.`}
            </span>
          </div>

          {/* STEP 2: Habit & Life Ops Telemetry Audit */}
          <div
            data-testid="weekly-review-step-2"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '12px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${
                activeStep === 2 ? FUI_TOKENS.accentCyan : FUI_TOKENS.borderHairline
              }`,
              borderRadius: '0px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0px' }}>
              <span
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  fontWeight: 700,
                  color: FUI_TOKENS.accentCyan,
                  borderRadius: '0px',
                }}
              >
                STEP 2 // HABIT & TELEMETRY AUDIT
              </span>
              <FuiBadge tone="cyan">{metrics.routineConsistencyReadout} ADHERENCE</FuiBadge>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '6px',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkStark,
                borderRadius: '0px',
              }}
            >
              <span>DEEP WORK: {metrics.focusReadout}</span>
              <span>CONSISTENCY: {metrics.routineConsistencyReadout}</span>
              <span>LESSONS DONE: {metrics.completedLessonsCount}</span>
              <span>OKR PACE: {metrics.goalsProgressReadout}</span>
              <span style={{ gridColumn: '1 / -1', color: FUI_TOKENS.accentPhosphor }}>
                INVESTABLE SURPLUS: {metrics.investableSurplusReadout}
              </span>
            </div>
          </div>

          {/* STEP 3: Reflect (Wins & Friction) */}
          <div
            data-testid="weekly-review-step-3"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '12px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${
                activeStep === 3 ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.borderHairline
              }`,
              borderRadius: '0px',
            }}
          >
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                color: FUI_TOKENS.accentPhosphor,
                borderRadius: '0px',
              }}
            >
              STEP 3 // REFLECT (WINS & FRICTION)
            </span>
            <FuiInput
              label="KEY WINS THIS WEEK"
              type="text"
              value={winsMd}
              onChange={(e) => setWinsMd(e.target.value)}
              placeholder="Shipped core milestones, maintained morning stack..."
              data-testid="weekly-review-wins-input"
            />
            <FuiInput
              label="BLOCKERS & FRICTION"
              type="text"
              value={challengesMd}
              onChange={(e) => setChallengesMd(e.target.value)}
              placeholder="Context switching on Wednesday afternoon..."
              data-testid="weekly-review-challenges-input"
            />
          </div>

          {/* STEP 4: Plan Next Week & Export to Second Brain Vault */}
          <div
            data-testid="weekly-review-step-4"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '12px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${
                activeStep === 4 ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
              }`,
              borderRadius: '0px',
            }}
          >
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                color: FUI_TOKENS.accentOrange,
                borderRadius: '0px',
              }}
            >
              STEP 4 // TOP 3 NEXT-WEEK PRIORITIES & VAULT EXPORT
            </span>
            <FuiInput
              label="PRIORITY #1"
              type="text"
              value={priority1}
              onChange={(e) => setPriority1(e.target.value)}
              placeholder="Primary Q1–Q4 OKR Deliverable..."
              data-testid="weekly-review-priority-1"
            />
            <FuiInput
              label="PRIORITY #2"
              type="text"
              value={priority2}
              onChange={(e) => setPriority2(e.target.value)}
              placeholder="Course Module & Spaced Review..."
              data-testid="weekly-review-priority-2"
            />
            <FuiInput
              label="PRIORITY #3"
              type="text"
              value={priority3}
              onChange={(e) => setPriority3(e.target.value)}
              placeholder="Portfolio Rebalance & Bio Cadence..."
              data-testid="weekly-review-priority-3"
            />
          </div>
        </div>

        {/* Wizard Stepper & Export Action Footer */}
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
          <div style={{ display: 'flex', gap: '8px', borderRadius: '0px' }}>
            <FuiButton
              type="button"
              variant="secondary"
              disabled={activeStep <= 1}
              onClick={() => setActiveStep((s) => Math.max(1, s - 1))}
            >
              ◀ PREV STEP
            </FuiButton>
            <FuiButton
              type="button"
              variant="secondary"
              disabled={activeStep >= 4}
              onClick={() => setActiveStep((s) => Math.min(4, s + 1))}
            >
              NEXT STEP ▶
            </FuiButton>
          </div>

          <FuiButton
            type="submit"
            variant="primary"
            loading={exporting}
            data-testid="weekly-review-export-btn"
          >
            📤 COMPLETE & EXPORT WEEKLY REVIEW ({metrics.vaultExportPath})
          </FuiButton>
        </div>
      </form>
    </FuiPanel>
  );
}
