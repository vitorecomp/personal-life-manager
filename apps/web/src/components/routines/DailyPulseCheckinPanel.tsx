import React, { useEffect, useState } from 'react';
import { FuiBadge, FuiButton, FuiInput, FuiPanel, FuiSelect, FUI_TOKENS } from '@hermes/ui';
import type {
  DailyCheckin,
  RoutineDayProfile,
  UpsertDailyCheckinPayload,
} from '../../api/routines';
import { safeNumber } from './routinesModel';

export interface DailyPulseCheckinPanelProps {
  selectedDate: string;
  onDateChange: (nextDate: string) => void;
  checkin?: DailyCheckin | null;
  onSaveCheckin: (date: string, payload: UpsertDailyCheckinPayload) => Promise<DailyCheckin>;
  saving?: boolean;
}

const SCORE_LEVELS = [1, 2, 3, 4, 5] as const;

export function DailyPulseCheckinPanel({
  selectedDate,
  onDateChange,
  checkin,
  onSaveCheckin,
  saving = false,
}: DailyPulseCheckinPanelProps) {
  const [dayProfile, setDayProfile] = useState<RoutineDayProfile>('workday');
  const [energyScore, setEnergyScore] = useState<number>(4);
  const [moodScore, setMoodScore] = useState<number>(4);
  const [sleepHours, setSleepHours] = useState<string>('7.5');
  const [highlight, setHighlight] = useState<string>('');
  const [reflectionMd, setReflectionMd] = useState<string>('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!checkin) return;
    if (checkin.day_profile_used && checkin.day_profile_used !== 'all') {
      setDayProfile(checkin.day_profile_used);
    }
    const e = safeNumber(checkin.energy_score, 4);
    setEnergyScore(Math.max(1, Math.min(5, Math.round(e))));
    const m = safeNumber(checkin.mood_score, 4);
    setMoodScore(Math.max(1, Math.min(5, Math.round(m))));
    if (checkin.sleep_hours !== null && checkin.sleep_hours !== undefined) {
      setSleepHours(String(safeNumber(checkin.sleep_hours, 7.5)));
    }
    setHighlight(checkin.highlight ?? '');
    setReflectionMd(checkin.reflection_md ?? '');
  }, [checkin]);

  const vaultPath = checkin?.obsidian_vault_path || `Daily/${selectedDate}.md`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMessage(null);
    setErrorMessage(null);

    const parsedSleep = Number(sleepHours);
    if (!Number.isFinite(parsedSleep) || parsedSleep < 0 || parsedSleep > 24) {
      setErrorMessage('INVALID_SLEEP // Sleep hours must be between 0 and 24.');
      return;
    }

    try {
      const saved = await onSaveCheckin(selectedDate, {
        day_profile_used: dayProfile,
        energy_score: energyScore,
        mood_score: moodScore,
        sleep_hours: parsedSleep,
        highlight: highlight.trim() || null,
        reflection_md: reflectionMd.trim() || null,
      });
      setSaveMessage(
        `EXPORTED // Daily Check-In synced to Second Brain Vault (${saved.obsidian_vault_path || vaultPath}).`,
      );
    } catch (err: any) {
      setErrorMessage(
        err?.message ? String(err.message) : 'ERROR // Failed to save Daily Pulse Check-In.',
      );
    }
  };

  return (
    <FuiPanel
      headerTitle="DAILY PULSE CHECK-IN // BIO TELEMETRY & OBSIDIAN VAULT MIRROR"
      headerProps={{
        title: 'DAILY PULSE CHECK-IN // BIO TELEMETRY & OBSIDIAN VAULT MIRROR',
        code: 'MOD_08 // PULSE',
        accent: 'phosphor',
      }}
    >
      <form
        onSubmit={handleSubmit}
        data-testid="daily-pulse-checkin-panel"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          borderRadius: '0px',
        }}
      >
        {/* Top Metadata & Vault Path Strip */}
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
            <FuiBadge tone="phosphor" data-testid="daily-checkin-vault-path">
              VAULT MIRROR: {vaultPath}
            </FuiBadge>
            <FuiBadge tone="orange">ENERGY: {energyScore}/5</FuiBadge>
            <FuiBadge tone="cyan">MOOD: {moodScore}/5</FuiBadge>
            <FuiBadge tone="amber">SLEEP: {safeNumber(sleepHours, 7.5)}H</FuiBadge>
          </div>
          <span
            style={{
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: FUI_TOKENS.inkMuted,
              borderRadius: '0px',
            }}
          >
            PRESERVES &lt;!-- keep --&gt; BLOCKS ON EXPORT
          </span>
        </div>

        {errorMessage && (
          <div
            role="alert"
            data-testid="daily-checkin-error"
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

        {saveMessage && (
          <div
            data-testid="daily-checkin-saved-banner"
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
            {saveMessage}
          </div>
        )}

        {/* Date, Day Profile & Sleep Hours Row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '12px',
            borderRadius: '0px',
          }}
        >
          <FuiInput
            label="LOG DATE (YYYY-MM-DD)"
            type="date"
            value={selectedDate}
            onChange={(e) => onDateChange(e.target.value)}
            data-testid="daily-checkin-date-input"
          />
          <FuiSelect
            label="DAY PROFILE USED"
            value={dayProfile}
            onChange={(e) => setDayProfile(e.target.value as RoutineDayProfile)}
            options={[
              { value: 'workday', label: 'WORKDAY' },
              { value: 'weekend', label: 'WEEKEND' },
              { value: 'travel', label: 'TRAVEL' },
              { value: 'minimum_viable', label: 'MINIMUM VIABLE (MVD)' },
            ]}
            data-testid="daily-checkin-profile-select"
          />
          <FuiInput
            label="SLEEP HOURS"
            type="number"
            step="0.25"
            min="0"
            max="24"
            value={sleepHours}
            onChange={(e) => setSleepHours(e.target.value)}
            data-testid="daily-checkin-sleep-input"
          />
        </div>

        {/* Energy (1..5) & Mood (1..5) Selectors */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '12px',
            borderRadius: '0px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              padding: '10px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
            }}
          >
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 600,
                color: FUI_TOKENS.inkMuted,
                borderRadius: '0px',
              }}
            >
              ENERGY SCORE (1–5)
            </span>
            <div style={{ display: 'flex', gap: '6px', borderRadius: '0px' }}>
              {SCORE_LEVELS.map((lvl) => {
                const active = energyScore === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setEnergyScore(lvl)}
                    data-testid={`daily-checkin-energy-${lvl}`}
                    style={{
                      flex: 1,
                      minHeight: '34px',
                      backgroundColor: active ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgPanel,
                      color: active ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                      border: `1px solid ${
                        active ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                      }`,
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      borderRadius: '0px',
                    }}
                  >
                    {lvl}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              padding: '10px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
            }}
          >
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 600,
                color: FUI_TOKENS.inkMuted,
                borderRadius: '0px',
              }}
            >
              MOOD SCORE (1–5)
            </span>
            <div style={{ display: 'flex', gap: '6px', borderRadius: '0px' }}>
              {SCORE_LEVELS.map((lvl) => {
                const active = moodScore === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setMoodScore(lvl)}
                    data-testid={`daily-checkin-mood-${lvl}`}
                    style={{
                      flex: 1,
                      minHeight: '34px',
                      backgroundColor: active ? FUI_TOKENS.accentCyan : FUI_TOKENS.bgPanel,
                      color: active ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                      border: `1px solid ${
                        active ? FUI_TOKENS.accentCyan : FUI_TOKENS.borderHairline
                      }`,
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      borderRadius: '0px',
                    }}
                  >
                    {lvl}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Highlight of the Day */}
        <FuiInput
          label="DAILY HIGHLIGHT (1-LINE KEYSTONE FOCUS OR WIN)"
          type="text"
          value={highlight}
          onChange={(e) => setHighlight(e.target.value)}
          placeholder="Shipped Raft consensus module and completed 90m deep work..."
          data-testid="daily-checkin-highlight-input"
        />

        {/* Evening Reflection Markdown */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            borderRadius: '0px',
          }}
        >
          <label
            htmlFor="daily-checkin-reflection-textarea"
            style={{
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 600,
              color: FUI_TOKENS.inkMuted,
              borderRadius: '0px',
            }}
          >
            EVENING REFLECTION & FRICTION NOTES (MARKDOWN)
          </label>
          <textarea
            id="daily-checkin-reflection-textarea"
            data-testid="daily-checkin-reflection-input"
            rows={4}
            value={reflectionMd}
            onChange={(e) => setReflectionMd(e.target.value)}
            placeholder="What went well today? Any energy drains or adjustments for tomorrow?"
            style={{
              width: '100%',
              padding: '8px 10px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              color: FUI_TOKENS.inkStark,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              borderRadius: '0px',
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', borderRadius: '0px' }}>
          <FuiButton
            type="submit"
            variant="primary"
            loading={saving}
            data-testid="daily-checkin-save-btn"
          >
            💾 SAVE DAILY CHECK-IN & EXPORT VAULT NOTE
          </FuiButton>
        </div>
      </form>
    </FuiPanel>
  );
}
