import {
  FUI_TOKENS,
  FuiBadge,
  FuiBatteryCapsule,
  FuiButton,
  FuiInput,
  FuiPanel,
  FuiPanelHeader,
} from '@hermes/ui';
import React, { useEffect, useState } from 'react';
import type {
  DayProfile,
  MobileDailyCheckinRow,
  MobileRoutineStackView,
} from '../db/sqliteEngine';

const DAY_PROFILES: ReadonlyArray<{ id: DayProfile; label: string; code: string }> = [
  { id: 'workday', label: 'WORKDAY', code: 'PROF // 01' },
  { id: 'weekend', label: 'WEEKEND', code: 'PROF // 02' },
  { id: 'travel', label: 'TRAVEL', code: 'PROF // 03' },
  { id: 'minimum_viable', label: 'MVD', code: 'PROF // 04' },
];

const TIME_SLOT_LABELS: Record<string, string> = {
  morning: 'MORNING STACK',
  afternoon: 'AFTERNOON STACK',
  shutdown: 'SHUTDOWN STACK',
  evening: 'EVENING STACK',
  custom: 'CUSTOM STACK',
};

export interface RoutinesSurfaceProps {
  dayProfile: DayProfile;
  onChangeDayProfile: (profile: DayProfile) => void;
  stacks: MobileRoutineStackView[];
  dailyCheckin: MobileDailyCheckinRow | null;
  onToggleHabit: (routineItemId: string) => void;
  onStepHabitValue: (routineItemId: string, delta: number) => void;
  onAddHabitItem: (routineId: string, title: string) => void;
  onSaveDailyCheckin: (input: {
    energyScore: number;
    moodScore: number;
    sleepHours: number;
    highlight: string;
  }) => void;
}

export function RoutinesSurface({
  dayProfile,
  onChangeDayProfile,
  stacks,
  dailyCheckin,
  onToggleHabit,
  onStepHabitValue,
  onAddHabitItem,
  onSaveDailyCheckin,
}: RoutinesSurfaceProps) {
  const [energyScore, setEnergyScore] = useState<number>(dailyCheckin?.energy_score ?? 4);
  const [moodScore, setMoodScore] = useState<number>(dailyCheckin?.mood_score ?? 4);
  const [sleepHours, setSleepHours] = useState<string>(
    dailyCheckin?.sleep_hours !== null && dailyCheckin?.sleep_hours !== undefined
      ? String(dailyCheckin.sleep_hours)
      : '7.5',
  );
  const [highlight, setHighlight] = useState<string>(dailyCheckin?.highlight ?? '');
  const [checkinSavedBanner, setCheckinSavedBanner] = useState<boolean>(false);
  const [newHabitTitleByRoutine, setNewHabitTitleByRoutine] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!dailyCheckin) return;
    if (dailyCheckin.energy_score !== null && dailyCheckin.energy_score !== undefined) {
      setEnergyScore(dailyCheckin.energy_score);
    }
    if (dailyCheckin.mood_score !== null && dailyCheckin.mood_score !== undefined) {
      setMoodScore(dailyCheckin.mood_score);
    }
    if (dailyCheckin.sleep_hours !== null && dailyCheckin.sleep_hours !== undefined) {
      setSleepHours(String(dailyCheckin.sleep_hours));
    }
    setHighlight(dailyCheckin.highlight ?? '');
  }, [
    dailyCheckin?.log_date,
    dailyCheckin?.updated_at,
    dailyCheckin?.energy_score,
    dailyCheckin?.mood_score,
    dailyCheckin?.sleep_hours,
    dailyCheckin?.highlight,
  ]);

  const totalItems = stacks.reduce((acc, s) => acc + s.totalCount, 0);
  const totalCompleted = stacks.reduce((acc, s) => acc + s.completedCount, 0);
  const overallAdherencePct =
    totalItems > 0 ? Math.round((totalCompleted / totalItems) * 100) : 0;

  const handleCheckinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedSleep = Number.parseFloat(sleepHours);
    onSaveDailyCheckin({
      energyScore,
      moodScore,
      sleepHours: Number.isFinite(parsedSleep) ? parsedSleep : 7.5,
      highlight,
    });
    setCheckinSavedBanner(true);
  };

  return (
    <div
      data-testid="mobile-surface-routines"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        borderRadius: '0px',
      }}
    >
      {/* Day Profile Switcher + Overall Adherence */}
      <FuiPanel
        surface="panel"
        padding="sm"
        header={
          <FuiPanelHeader
            title="DAY PROFILE // CADENCE ENGINE"
            code={`ADHERENCE ${overallAdherencePct}%`}
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
          <div
            role="group"
            aria-label="Day Profile Selector"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '6px',
              borderRadius: '0px',
            }}
          >
            {DAY_PROFILES.map((prof) => {
              const isSelected = dayProfile === prof.id;
              return (
                <button
                  key={prof.id}
                  type="button"
                  data-testid={`day-profile-btn-${prof.id}`}
                  aria-pressed={isSelected}
                  onClick={() => onChangeDayProfile(prof.id)}
                  style={{
                    padding: '8px 4px',
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
                  {prof.label}
                </button>
              );
            })}
          </div>

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
                color: FUI_TOKENS.inkStark,
                borderRadius: '0px',
              }}
            >
              COMPLETED: {totalCompleted} / {totalItems} HABITS
            </span>
            <FuiBatteryCapsule progressPct={overallAdherencePct} segments={10} />
          </div>
        </div>
      </FuiPanel>

      {/* Collapsible Time-Slot Routine Stacks */}
      {stacks.map((stack) => (
        <FuiPanel
          key={stack.id}
          data-testid={`routine-stack-${stack.time_slot}`}
          surface="panel"
          padding="sm"
          header={
            <FuiPanelHeader
              title={`${TIME_SLOT_LABELS[stack.time_slot] ?? stack.name.toUpperCase()} // ${stack.name}`}
              code={stack.target_start_time ?? stack.time_slot.toUpperCase()}
              accent={stack.adherencePct === 100 ? 'phosphor' : 'orange'}
              actions={
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    borderRadius: '0px',
                  }}
                >
                  <FuiBadge tone="orange" data-testid={`routine-streak-${stack.id}`}>
                    🔥 {stack.streakDays}d
                  </FuiBadge>
                  <FuiBadge tone={stack.adherencePct === 100 ? 'phosphor' : 'cyan'}>
                    {stack.completedCount}/{stack.totalCount}
                  </FuiBadge>
                </div>
              }
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
            {stack.items.map((item) => {
              const isCompleted = item.todayLog?.status === 'completed';
              const currentNum = item.todayLog?.numeric_value ?? 0;

              return (
                <div
                  key={item.id}
                  data-testid={`routine-item-row-${item.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    padding: '8px',
                    backgroundColor: FUI_TOKENS.bgCarbon,
                    border: `1px solid ${
                      isCompleted ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.borderHairline
                    }`,
                    borderRadius: '0px',
                  }}
                >
                  <button
                    type="button"
                    data-testid={`routine-item-toggle-${item.id}`}
                    aria-label={`Toggle ${item.title}`}
                    onClick={() => onToggleHabit(item.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      backgroundColor: 'transparent',
                      border: 'none',
                      color: isCompleted ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.inkStark,
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      cursor: 'pointer',
                      padding: '4px 0',
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
                          isCompleted ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.accentOrange
                        }`,
                        backgroundColor: isCompleted
                          ? FUI_TOKENS.accentPhosphor
                          : FUI_TOKENS.bgPanel,
                        color: isCompleted ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                        fontWeight: 700,
                        fontSize: '12px',
                        flexShrink: 0,
                        borderRadius: '0px',
                      }}
                    >
                      {isCompleted ? '✓' : '·'}
                    </span>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: '12px',
                        textDecoration: isCompleted ? 'line-through' : 'none',
                        borderRadius: '0px',
                      }}
                    >
                      {item.title}
                    </span>
                  </button>

                  {item.tracking_type !== 'boolean' ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        flexShrink: 0,
                        borderRadius: '0px',
                      }}
                    >
                      <button
                        type="button"
                        data-testid={`routine-item-dec-${item.id}`}
                        aria-label={`Decrease ${item.title}`}
                        onClick={() => onStepHabitValue(item.id, -5)}
                        style={{
                          padding: '4px 8px',
                          backgroundColor: FUI_TOKENS.bgPanel,
                          border: `1px solid ${FUI_TOKENS.borderHairline}`,
                          color: FUI_TOKENS.inkStark,
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                          cursor: 'pointer',
                          borderRadius: '0px',
                        }}
                      >
                        -
                      </button>
                      <span
                        style={{
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                          color: FUI_TOKENS.accentCyan,
                          minWidth: '52px',
                          textAlign: 'center',
                          borderRadius: '0px',
                        }}
                      >
                        {currentNum}/{item.target_value ?? 10}
                        {item.unit ?? ''}
                      </span>
                      <button
                        type="button"
                        data-testid={`routine-item-inc-${item.id}`}
                        aria-label={`Increase ${item.title}`}
                        onClick={() => onStepHabitValue(item.id, 5)}
                        style={{
                          padding: '4px 8px',
                          backgroundColor: FUI_TOKENS.bgPanel,
                          border: `1px solid ${FUI_TOKENS.accentOrange}`,
                          color: FUI_TOKENS.accentOrange,
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                          cursor: 'pointer',
                          borderRadius: '0px',
                        }}
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <FuiBadge tone={isCompleted ? 'phosphor' : 'muted'}>
                      🔥 {item.streakDays}d
                    </FuiBadge>
                  )}
                </div>
              );
            })}

            {/* Inline Quick-Add Habit for Stack */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const val = (newHabitTitleByRoutine[stack.id] ?? '').trim();
                if (!val) return;
                onAddHabitItem(stack.id, val);
                setNewHabitTitleByRoutine((prev) => ({ ...prev, [stack.id]: '' }));
              }}
              style={{
                display: 'flex',
                gap: '6px',
                alignItems: 'center',
                borderRadius: '0px',
              }}
            >
              <div style={{ flex: 1, minWidth: 0, borderRadius: '0px' }}>
                <FuiInput
                  data-testid={`routine-add-item-input-${stack.time_slot}`}
                  aria-label={`Add habit to ${stack.name}`}
                  placeholder={`+ Add habit to ${stack.name}...`}
                  value={newHabitTitleByRoutine[stack.id] ?? ''}
                  onChange={(e) =>
                    setNewHabitTitleByRoutine((prev) => ({
                      ...prev,
                      [stack.id]: e.target.value,
                    }))
                  }
                />
              </div>
              <FuiButton
                type="submit"
                size="sm"
                variant="secondary"
                data-testid={`routine-add-item-btn-${stack.time_slot}`}
              >
                + ADD
              </FuiButton>
            </form>
          </div>
        </FuiPanel>
      ))}

      {/* Daily Pulse Check-In Card */}
      <FuiPanel
        data-testid="daily-pulse-checkin-card"
        surface="panel"
        padding="sm"
        header={
          <FuiPanelHeader
            title="DAILY PULSE // BIOMETRIC & HIGHLIGHT LOG"
            code="CHECKIN"
            accent="cyan"
          />
        }
      >
        <form
          onSubmit={handleCheckinSubmit}
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
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '8px',
              borderRadius: '0px',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
              <span
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  color: FUI_TOKENS.inkMuted,
                  borderRadius: '0px',
                }}
              >
                ENERGY (1-5)
              </span>
              <div style={{ display: 'flex', gap: '4px', borderRadius: '0px' }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    data-testid={`checkin-energy-${n}`}
                    onClick={() => setEnergyScore(n)}
                    style={{
                      flex: 1,
                      padding: '6px 0',
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      fontWeight: 700,
                      backgroundColor:
                        energyScore === n ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                      color: energyScore === n ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                      border: `1px solid ${
                        energyScore === n ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                      }`,
                      cursor: 'pointer',
                      borderRadius: '0px',
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
              <span
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  color: FUI_TOKENS.inkMuted,
                  borderRadius: '0px',
                }}
              >
                MOOD (1-5)
              </span>
              <div style={{ display: 'flex', gap: '4px', borderRadius: '0px' }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    data-testid={`checkin-mood-${n}`}
                    onClick={() => setMoodScore(n)}
                    style={{
                      flex: 1,
                      padding: '6px 0',
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      fontWeight: 700,
                      backgroundColor:
                        moodScore === n ? FUI_TOKENS.accentCyan : FUI_TOKENS.bgCarbon,
                      color: moodScore === n ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                      border: `1px solid ${
                        moodScore === n ? FUI_TOKENS.accentCyan : FUI_TOKENS.borderHairline
                      }`,
                      cursor: 'pointer',
                      borderRadius: '0px',
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '110px minmax(0, 1fr)',
              gap: '8px',
              borderRadius: '0px',
            }}
          >
            <FuiInput
              data-testid="checkin-sleep-input"
              label="SLEEP HRS"
              value={sleepHours}
              onChange={(e) => setSleepHours(e.target.value)}
            />
            <FuiInput
              data-testid="checkin-highlight-input"
              label="DAILY HIGHLIGHT"
              placeholder="Key win or field observation..."
              value={highlight}
              onChange={(e) => setHighlight(e.target.value)}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              borderRadius: '0px',
            }}
          >
            {checkinSavedBanner ? (
              <span
                data-testid="checkin-saved-status"
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  color: FUI_TOKENS.accentPhosphor,
                  borderRadius: '0px',
                }}
              >
                [✓ PULSE SAVED TO LOCAL SQLITE]
              </span>
            ) : (
              <span
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  color: FUI_TOKENS.inkMuted,
                  borderRadius: '0px',
                }}
              >
                SYNC_TARGET // daily_checkins
              </span>
            )}
            <FuiButton type="submit" variant="primary" size="sm" data-testid="checkin-save-btn">
              SAVE DAILY PULSE
            </FuiButton>
          </div>
        </form>
      </FuiPanel>
    </div>
  );
}
