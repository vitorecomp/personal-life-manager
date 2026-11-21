import React, { useMemo, useState } from 'react';
import { FuiBadge, FuiButton, FuiInput, FuiPanel, FuiSelect, FUI_TOKENS } from '@hermes/ui';
import type {
  IdealWeekBlock,
  IdealWeekCategory,
  IdealWeekResponse,
} from '../../api/routines';
import {
  IDEAL_WEEK_CATEGORY_META,
  IDEAL_WEEK_DAYS,
  VALID_IDEAL_WEEK_CATEGORIES,
  formatIdealWeekVariance,
  parseTimeMinutes,
  safeNumber,
  validateIdealWeekBlock,
} from './routinesModel';

export interface IdealWeekBlueprintPanelProps {
  idealWeek?: IdealWeekResponse | null;
  onSaveBlocks: (blocks: IdealWeekBlock[]) => Promise<IdealWeekResponse>;
  saving?: boolean;
}

export function IdealWeekBlueprintPanel({
  idealWeek,
  onSaveBlocks,
  saving = false,
}: IdealWeekBlueprintPanelProps) {
  const [dayOfWeek, setDayOfWeek] = useState<number>(0);
  const [startTime, setStartTime] = useState<string>('08:00');
  const [endTime, setEndTime] = useState<string>('10:00');
  const [category, setCategory] = useState<IdealWeekCategory>('deep_work');
  const [label, setLabel] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const blocks = useMemo(() => {
    return Array.isArray(idealWeek?.blocks) ? idealWeek!.blocks : [];
  }, [idealWeek]);

  const blocksByDay = useMemo(() => {
    const map = new Map<number, IdealWeekBlock[]>();
    for (let d = 0; d < 7; d++) {
      map.set(d, []);
    }
    for (const b of blocks) {
      const d = Math.max(0, Math.min(6, Math.round(safeNumber(b.day_of_week, 0))));
      map.get(d)!.push(b);
    }
    for (const [d, list] of map.entries()) {
      list.sort(
        (a, b) => (parseTimeMinutes(a.start_time) ?? 0) - (parseTimeMinutes(b.start_time) ?? 0),
      );
      map.set(d, list);
    }
    return map;
  }, [blocks]);

  const varianceRows = useMemo(() => {
    return formatIdealWeekVariance(idealWeek?.variance_by_category, blocks);
  }, [idealWeek, blocks]);

  const totalPlannedMins = useMemo(() => {
    if (idealWeek && safeNumber(idealWeek.total_planned_minutes, 0) > 0) {
      return Math.round(safeNumber(idealWeek.total_planned_minutes, 0));
    }
    return varianceRows.reduce((acc, r) => acc + r.plannedMinutes, 0);
  }, [idealWeek, varianceRows]);

  const totalActualMins = useMemo(() => {
    return Math.round(safeNumber(idealWeek?.total_actual_minutes, 0));
  }, [idealWeek]);

  const handleAddBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setSaveNotice(null);

    const candidate: IdealWeekBlock = {
      day_of_week: dayOfWeek,
      start_time: startTime.length === 5 ? `${startTime}:00` : startTime,
      end_time: endTime.length === 5 ? `${endTime}:00` : endTime,
      category,
      label: label.trim() || `${IDEAL_WEEK_CATEGORY_META[category].label} BLOCK`,
      color: IDEAL_WEEK_CATEGORY_META[category].color,
    };

    const validation = validateIdealWeekBlock(candidate, blocks);
    if (!validation.valid) {
      setValidationError(validation.error);
      return;
    }

    try {
      await onSaveBlocks([...blocks, candidate]);
      setLabel('');
      setSaveNotice(`SAVED // Added "${candidate.label}" on ${IDEAL_WEEK_DAYS[dayOfWeek]?.short}.`);
    } catch (err: any) {
      setValidationError(
        err?.message ? String(err.message) : 'REJECTED // Failed to save Ideal Week blueprint.',
      );
    }
  };

  const handleRemoveBlock = async (targetIdx: number) => {
    setValidationError(null);
    setSaveNotice(null);
    const next = blocks.filter((_, idx) => idx !== targetIdx);
    try {
      await onSaveBlocks(next);
      setSaveNotice('UPDATED // Removed time block from Ideal Week blueprint.');
    } catch (err: any) {
      setValidationError(
        err?.message ? String(err.message) : 'REJECTED // Failed to update Ideal Week blueprint.',
      );
    }
  };

  return (
    <div
      data-testid="ideal-week-blueprint-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        borderRadius: '0px',
      }}
    >
      {/* Top Designer & Block Creation Form */}
      <FuiPanel
        headerTitle="7x24 IDEAL WEEK BLUEPRINT // TIME-BLOCK ALLOCATION & VARIANCE"
        headerProps={{
          title: '7x24 IDEAL WEEK BLUEPRINT // TIME-BLOCK ALLOCATION & VARIANCE',
          code: 'MOD_08 // IDEAL_WEEK',
          accent: 'cyan',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderRadius: '0px' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderRadius: '0px',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', borderRadius: '0px' }}>
              <FuiBadge tone="cyan">
                PLANNED: {(totalPlannedMins / 60).toFixed(1)}H ({totalPlannedMins}M)
              </FuiBadge>
              <FuiBadge tone="phosphor">
                ACTUAL (7D): {(totalActualMins / 60).toFixed(1)}H ({totalActualMins}M)
              </FuiBadge>
              <FuiBadge tone="orange">BLOCKS: {blocks.length}</FuiBadge>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', borderRadius: '0px' }}>
              {VALID_IDEAL_WEEK_CATEGORIES.map((cat) => (
                <FuiBadge key={cat} tone={IDEAL_WEEK_CATEGORY_META[cat].tone}>
                  {IDEAL_WEEK_CATEGORY_META[cat].label}
                </FuiBadge>
              ))}
            </div>
          </div>

          {validationError && (
            <div
              role="alert"
              data-testid="ideal-week-validation-error"
              style={{
                padding: '10px 12px',
                backgroundColor: '#2A0D08',
                border: `1px solid ${FUI_TOKENS.accentVermilion}`,
                color: FUI_TOKENS.inkStark,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              {validationError}
            </div>
          )}

          {saveNotice && !validationError && (
            <div
              data-testid="ideal-week-save-notice"
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
              {saveNotice}
            </div>
          )}

          {/* Block Creation Form */}
          <form
            onSubmit={handleAddBlock}
            data-testid="ideal-week-add-block-form"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '10px',
              alignItems: 'end',
              padding: '12px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
            }}
          >
            <FuiSelect
              label="DAY OF WEEK (0..6)"
              value={String(dayOfWeek)}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
              options={IDEAL_WEEK_DAYS.map((d) => ({
                value: String(d.dayOfWeek),
                label: `${d.short} // ${d.full}`,
              }))}
              data-testid="ideal-week-day-select"
            />
            <FuiInput
              label="START TIME (HH:MM)"
              type="text"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              placeholder="08:00"
              data-testid="ideal-week-start-input"
            />
            <FuiInput
              label="END TIME (HH:MM)"
              type="text"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              placeholder="10:00"
              data-testid="ideal-week-end-input"
            />
            <FuiSelect
              label="CATEGORY"
              value={category}
              onChange={(e) => setCategory(e.target.value as IdealWeekCategory)}
              options={VALID_IDEAL_WEEK_CATEGORIES.map((cat) => ({
                value: cat,
                label: IDEAL_WEEK_CATEGORY_META[cat].label,
              }))}
              data-testid="ideal-week-category-select"
            />
            <FuiInput
              label="TIME-BLOCK LABEL"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Deep Systems Engineering..."
              data-testid="ideal-week-label-input"
            />
            <FuiButton
              type="submit"
              variant="primary"
              loading={saving}
              data-testid="ideal-week-submit-btn"
            >
              + ASSIGN TIME BLOCK
            </FuiButton>
          </form>

          {/* 7-Day (MON..SUN) Rectilinear Blueprint Matrix */}
          <div
            data-testid="ideal-week-7x24-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '8px',
              borderRadius: '0px',
            }}
          >
            {IDEAL_WEEK_DAYS.map((day) => {
              const dayBlocks = blocksByDay.get(day.dayOfWeek) ?? [];
              return (
                <div
                  key={day.dayOfWeek}
                  data-testid={`ideal-week-day-col-${day.dayOfWeek}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '10px',
                    backgroundColor: FUI_TOKENS.bgCarbon,
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    borderRadius: '0px',
                    minHeight: '140px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingBottom: '6px',
                      borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
                      borderRadius: '0px',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: FUI_TOKENS.fontMono,
                        fontSize: '12px',
                        fontWeight: 700,
                        color: FUI_TOKENS.accentCyan,
                        borderRadius: '0px',
                      }}
                    >
                      {day.short}
                    </span>
                    <span
                      style={{
                        fontFamily: FUI_TOKENS.fontMono,
                        fontSize: '12px',
                        color: FUI_TOKENS.inkMuted,
                        borderRadius: '0px',
                      }}
                    >
                      {dayBlocks.length} BLK
                    </span>
                  </div>

                  {dayBlocks.length === 0 ? (
                    <span
                      style={{
                        fontFamily: FUI_TOKENS.fontMono,
                        fontSize: '12px',
                        color: FUI_TOKENS.inkMuted,
                        borderRadius: '0px',
                      }}
                    >
                      UNALLOCATED // 00:00–24:00
                    </span>
                  ) : (
                    dayBlocks.map((b, i) => {
                      const catMeta =
                        IDEAL_WEEK_CATEGORY_META[b.category] ??
                        IDEAL_WEEK_CATEGORY_META.deep_work;
                      const globalIdx = blocks.indexOf(b);
                      return (
                        <div
                          key={b.id ?? `${day.dayOfWeek}-${b.start_time}-${i}`}
                          data-testid="ideal-week-block-card"
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            padding: '6px 8px',
                            backgroundColor: FUI_TOKENS.bgPanel,
                            border: `1px solid ${catMeta.color}`,
                            borderRadius: '0px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '4px',
                              borderRadius: '0px',
                            }}
                          >
                            <span
                              style={{
                                fontFamily: FUI_TOKENS.fontMono,
                                fontSize: '12px',
                                fontWeight: 700,
                                color: catMeta.color,
                                borderRadius: '0px',
                              }}
                            >
                              {b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveBlock(globalIdx)}
                              aria-label={`Remove block ${b.label}`}
                              style={{
                                background: 'transparent',
                                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                                color: FUI_TOKENS.inkMuted,
                                fontFamily: FUI_TOKENS.fontMono,
                                fontSize: '12px',
                                padding: '0px 6px',
                                cursor: 'pointer',
                                borderRadius: '0px',
                              }}
                            >
                              ✕
                            </button>
                          </div>
                          <span
                            style={{
                              fontFamily: FUI_TOKENS.fontMono,
                              fontSize: '12px',
                              color: FUI_TOKENS.inkStark,
                              borderRadius: '0px',
                              wordBreak: 'break-word',
                            }}
                          >
                            {b.label}
                          </span>
                          <span
                            style={{
                              fontFamily: FUI_TOKENS.fontMono,
                              fontSize: '12px',
                              color: FUI_TOKENS.inkMuted,
                              borderRadius: '0px',
                            }}
                          >
                            {catMeta.label}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </FuiPanel>

      {/* Planned vs. Actual Category Variance (REF-07) */}
      <FuiPanel
        headerTitle="PLANNED VS. ACTUAL CATEGORY VARIANCE // TRAILING 7D TIME SESSIONS"
        headerProps={{
          title: 'PLANNED VS. ACTUAL CATEGORY VARIANCE // TRAILING 7D TIME SESSIONS',
          code: 'REF_07 // VARIANCE',
          accent: 'orange',
        }}
      >
        <div
          data-fui-chart="ideal-week-variance"
          style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRadius: '0px' }}
        >
          {varianceRows.map((row) => (
            <div
              key={row.category}
              data-testid={`ideal-week-variance-row-${row.category}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                padding: '8px 10px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
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
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                <span style={{ color: row.color, fontWeight: 700, borderRadius: '0px' }}>
                  {row.label}
                </span>
                <span style={{ color: FUI_TOKENS.inkStark, borderRadius: '0px' }}>
                  PLANNED: {row.plannedHoursText} ({row.plannedMinutes}m) • ACTUAL:{' '}
                  {row.actualHoursText} ({row.actualMinutes}m) • DELTA: {row.varianceText} (
                  {row.adherencePct}%)
                </span>
              </div>
              <div
                style={{
                  width: '100%',
                  height: '6px',
                  backgroundColor: FUI_TOKENS.bgPanel,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  borderRadius: '0px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${row.adherencePct}%`,
                    height: '100%',
                    backgroundColor: row.color,
                    borderRadius: '0px',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </FuiPanel>
    </div>
  );
}
