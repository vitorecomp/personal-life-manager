import React, { useEffect, useState } from 'react';
import { FUI_TOKENS, IsometricKnightSprite } from '@hermes/ui';
import type {
  AgentTrigger,
  AgentTriggerType,
  ArenaZone,
  CreateAgentPayload,
  CreateAgentTriggerPayload,
  KnightArchetype,
  SkillPolicyMode,
  UiSkillPolicyMode,
} from '../../api/agents';
import { normalizeArenaZone, normalizeKnightArchetype } from '../../api/agents';
import {
  ARENA_ZONES,
  ARCHETYPE_DESCRIPTORS,
  CREST_PALETTE,
  DOMAIN_EVENT_TRIGGERS,
  SOUL_TEMPLATE_VARIABLES,
  STANDARD_SKILL_SLOTS,
  buildUpdatedToolsPolicy,
  formatUsdFromCents,
  insertSoulTemplateVariable,
  resolveSkillSlotMode,
  slugifyAgentName,
  validateKnightForgeInput,
  type ComputedKnightTelemetry,
} from './knightsModel';

export interface KnightForgeModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialKnight: ComputedKnightTelemetry | null;
  triggers: AgentTrigger[];
  onClose: () => void;
  onSubmit: (
    payload: CreateAgentPayload,
    pendingTrigger?: CreateAgentTriggerPayload,
  ) => Promise<void>;
  onDelete?: (knightId: string) => Promise<void>;
  onAddTrigger?: (knightId: string, trigger: CreateAgentTriggerPayload) => Promise<void>;
  onDeleteTrigger?: (knightId: string, triggerId: string) => Promise<void>;
  isSubmitting?: boolean;
}

export function KnightForgeModal({
  isOpen,
  mode,
  initialKnight,
  triggers,
  onClose,
  onSubmit,
  onDelete,
  onAddTrigger,
  onDeleteTrigger,
  isSubmitting = false,
}: KnightForgeModalProps): React.ReactElement | null {
  const [name, setName] = useState<string>('');
  const [slug, setSlug] = useState<string>('');
  const [slugTouched, setSlugTouched] = useState<boolean>(false);
  const [archetype, setArchetype] = useState<KnightArchetype>('paladin');
  const [crestColor, setCrestColor] = useState<string>('#F87C18');
  const [systemPrompt, setSystemPrompt] = useState<string>(
    'Stand watch over HERMES // OS telemetry on {{today}}, align execution with {{active_goals}}, and safeguard {{portfolio_summary}}.',
  );
  const [model, setModel] = useState<string>('claude-sonnet-4-20250514');
  const [thinkingEffort, setThinkingEffort] = useState<'low' | 'medium' | 'high'>('high');
  const [zone, setZone] = useState<ArenaZone>('cron_watchtower');
  const [gridX, setGridX] = useState<number>(1);
  const [gridY, setGridY] = useState<number>(1);
  const [monthlyBudgetCents, setMonthlyBudgetCents] = useState<number>(500);
  const [epMaxTokens, setEpMaxTokens] = useState<number>(128000);
  const [cronSchedule, setCronSchedule] = useState<string>('0 8 * * *');
  const [eventTriggers, setEventTriggers] = useState<string[]>(['GoalPaceAtRisk']);
  const [toolsPolicy, setToolsPolicy] = useState<Record<string, SkillPolicyMode>>({
    'todos.*': 'AUTO',
    'routines.*': 'READ',
    'goals.*': 'READ',
    'portfolio.*': 'READ',
    'vault.*': 'APPROVE',
    'courses.*': 'READ',
    'dashboards.*': 'READ',
    'servers.*': 'READ',
  });
  const [newTriggerType, setNewTriggerType] = useState<AgentTriggerType>('cron');
  const [newTriggerValue, setNewTriggerValue] = useState<string>('0 9 * * 1-5');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setValidationError(null);
    if (mode === 'edit' && initialKnight) {
      const normArch = normalizeKnightArchetype(initialKnight.archetype);
      const normZone = normalizeArenaZone(initialKnight.zone);
      const archDesc =
        ARCHETYPE_DESCRIPTORS.find((a) => a.archetype === normArch) ?? ARCHETYPE_DESCRIPTORS[0];
      setName(initialKnight.name);
      setSlug(initialKnight.slug);
      setSlugTouched(true);
      setArchetype(normArch);
      setCrestColor(initialKnight.crestColor || archDesc.defaultCrest);
      setSystemPrompt(initialKnight.systemPrompt || archDesc.defaultOath);
      setModel(initialKnight.model || 'claude-sonnet-4-20250514');
      setThinkingEffort(initialKnight.thinkingEffort || 'high');
      setZone(normZone);
      setGridX(initialKnight.gridX ?? 0);
      setGridY(initialKnight.gridY ?? 0);
      setMonthlyBudgetCents(initialKnight.budgetCents ?? 500);
      setEpMaxTokens(initialKnight.epMaxTokens ?? 128000);
      setToolsPolicy({ ...(initialKnight.toolsPolicy ?? {}) });
    } else {
      setName('');
      setSlug('');
      setSlugTouched(false);
      setArchetype('artificer');
      setCrestColor('#F87C18');
      setSystemPrompt(
        'Stand watch over HERMES // OS telemetry on {{today}}, align execution with {{active_goals}}, and safeguard {{portfolio_summary}}.',
      );
      setModel('claude-sonnet-4-20250514');
      setThinkingEffort('high');
      setZone('cron_watchtower');
      setGridX(2);
      setGridY(0);
      setMonthlyBudgetCents(500);
      setEpMaxTokens(128000);
      setCronSchedule('0 8 * * *');
      setEventTriggers(['GoalPaceAtRisk']);
      setToolsPolicy({
        'todos.*': 'AUTO',
        'routines.*': 'READ',
        'goals.*': 'READ',
        'portfolio.*': 'READ',
        'vault.*': 'APPROVE',
      });
    }
  }, [isOpen, mode, initialKnight]);

  if (!isOpen) return null;

  const currentArchDesc =
    ARCHETYPE_DESCRIPTORS.find((a) => a.archetype === archetype) ?? ARCHETYPE_DESCRIPTORS[0];

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugTouched) {
      setSlug(slugifyAgentName(val));
    }
  };

  const handleInsertVariable = (token: string) => {
    setSystemPrompt((prev) => insertSoulTemplateVariable(prev, token));
  };

  const toggleEventTrigger = (topic: string) => {
    setEventTriggers((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic],
    );
  };

  const handleFormSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;
    const resolvedName = name.trim() || 'Vanguard Sentinel';
    const resolvedSlug = slug.trim() || slugifyAgentName(resolvedName);
    const resolvedCrest = /^#[0-9a-fA-F]{6}$/.test(crestColor.trim())
      ? crestColor.trim()
      : '#F87C18';

    const check = validateKnightForgeInput({
      name: resolvedName,
      systemPrompt,
      crestColor: resolvedCrest,
      monthlyBudgetCents,
      epMaxTokens,
    });
    if (!check.valid) {
      setValidationError(check.errors.join(' '));
      return;
    }

    setValidationError(null);
    const inBarracks = zone === 'standby_barracks';
    const payload: CreateAgentPayload = {
      name: resolvedName,
      slug: resolvedSlug,
      knight_archetype: archetype,
      crest_color: resolvedCrest,
      system_prompt: systemPrompt.trim(),
      model_config: {
        model: model.trim() || 'claude-sonnet-4-20250514',
        thinking_effort: thinkingEffort,
        max_context_tokens: Math.max(4096, Math.round(Number(epMaxTokens) || 128000)),
      },
      tools_policy: toolsPolicy,
      zone,
      grid_pos: {
        x: Number(gridX) || 0,
        y: Number(gridY) || 0,
        zone,
      },
      monthly_budget_cents: Math.max(0, Math.round(Number(monthlyBudgetCents) || 0)),
      is_mastermind_member: zone === 'mastermind_council',
      enabled: !inBarracks,
      is_paused: inBarracks,
    };

    const pendingTrigger: CreateAgentTriggerPayload | undefined =
      zone === 'event_ambush' && eventTriggers.length > 0
        ? {
            type: 'event',
            config_json: {
              event: eventTriggers[0],
              description: `Reactive Ambush hook for ${eventTriggers[0]}`,
            },
            enabled: true,
          }
        : cronSchedule.trim()
          ? {
              type: 'cron',
              config_json: {
                cron: cronSchedule.trim(),
                description: `Cron Watchtower schedule (${cronSchedule.trim()})`,
              },
              enabled: true,
            }
          : undefined;

    await onSubmit(payload, pendingTrigger);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Knight Forge"
      data-testid="knight-forge-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        backgroundColor: 'rgba(8, 8, 11, 0.84)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <form
        onSubmit={handleFormSubmit}
        style={{
          width: '100%',
          maxWidth: '920px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: FUI_TOKENS.bgPanel,
          border: `1px solid ${FUI_TOKENS.accentOrange}`,
          borderRadius: '0px',
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          color: FUI_TOKENS.inkStark,
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
            paddingBottom: '10px',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                color: FUI_TOKENS.accentOrange,
              }}
            >
              ARMORY // KNIGHT FORGE ({mode === 'create' ? 'NEW UNIT COMMISSION' : `EDITING ${initialKnight?.name}`})
            </div>
            <div
              style={{
                fontFamily: FUI_TOKENS.fontSans,
                fontSize: '16px',
                fontWeight: 700,
                color: FUI_TOKENS.inkStark,
              }}
            >
              Configure Armor Archetype, System Oath (SOUL.md), Budget HP &amp; /mcp Autonomy Gates
            </div>
          </div>

          <button
            type="button"
            data-testid="forge-cancel-btn"
            onClick={onClose}
            style={{
              padding: '6px 12px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 700,
              color: FUI_TOKENS.inkMuted,
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
              cursor: 'pointer',
            }}
          >
            [✕ CANCEL]
          </button>
        </div>

        {validationError && (
          <div
            data-testid="forge-validation-error"
            style={{
              padding: '8px 10px',
              backgroundColor: 'rgba(235, 69, 17, 0.16)',
              border: `1px solid ${FUI_TOKENS.accentVermilion}`,
              borderRadius: '0px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: FUI_TOKENS.accentVermilion,
            }}
          >
            FORGE VALIDATION ERROR: {validationError}
          </div>
        )}

        {/* Top Grid: Sprite Preview + Identity & Archetype */}
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '14px' }}>
          {/* Live Sprite Preview Box */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '12px',
              backgroundColor: FUI_TOKENS.bgArena,
              border: `1px solid ${crestColor}`,
              borderRadius: '0px',
            }}
          >
            <IsometricKnightSprite
              archetype={archetype}
              state={zone === 'standby_barracks' ? 'barracks_rest' : 'idle'}
              scale={2}
              name={name || 'New Knight'}
              crestColor={crestColor}
              showHud={false}
            />
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                color: crestColor,
                textTransform: 'uppercase',
                textAlign: 'center',
              }}
            >
              {currentArchDesc.label}
            </span>
          </div>

          {/* Identity Fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label
                htmlFor="forge-name-input"
                style={{ fontFamily: FUI_TOKENS.fontMono, fontSize: '12px', color: FUI_TOKENS.inkMuted }}
              >
                KNIGHT TITLE / NAME
              </label>
              <input
                id="forge-name-input"
                data-testid="forge-name-input"
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Artificer Orion"
                style={{
                  padding: '6px 8px',
                  fontFamily: FUI_TOKENS.fontSans,
                  fontSize: '12px',
                  color: FUI_TOKENS.inkStark,
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  borderRadius: '0px',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label
                htmlFor="forge-slug-input"
                style={{ fontFamily: FUI_TOKENS.fontMono, fontSize: '12px', color: FUI_TOKENS.inkMuted }}
              >
                UNIT SLUG (UNIQUE KEY)
              </label>
              <input
                id="forge-slug-input"
                data-testid="forge-slug-input"
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                placeholder="artificer-orion"
                style={{
                  padding: '6px 8px',
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  color: FUI_TOKENS.inkStark,
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  borderRadius: '0px',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label
                htmlFor="forge-archetype-select"
                style={{ fontFamily: FUI_TOKENS.fontMono, fontSize: '12px', color: FUI_TOKENS.inkMuted }}
              >
                ARMOR ARCHETYPE (LOWERCASE WIRE ID)
              </label>
              <select
                id="forge-archetype-select"
                data-testid="forge-archetype-select"
                value={archetype}
                onChange={(e) => {
                  const next = normalizeKnightArchetype(e.target.value);
                  setArchetype(next);
                  const found = ARCHETYPE_DESCRIPTORS.find((a) => a.archetype === next);
                  if (found) setCrestColor(found.defaultCrest);
                }}
                style={{
                  padding: '6px 8px',
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  color: FUI_TOKENS.inkStark,
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  borderRadius: '0px',
                }}
              >
                <option value="paladin">paladin — Gold &amp; White Heavy Armor</option>
                <option value="vanguard">vanguard — Ranger Emerald &amp; Bronze Cloak</option>
                <option value="lore_warden">lore_warden — Scholar Cobalt &amp; Silver Robes</option>
                <option value="inquisitor">inquisitor — Crimson &amp; Obsidian Plate</option>
                <option value="artificer">artificer — Amber &amp; Copper Gear</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label
                htmlFor="forge-crest-input"
                style={{ fontFamily: FUI_TOKENS.fontMono, fontSize: '12px', color: FUI_TOKENS.inkMuted }}
              >
                HERALDIC CREST COLOR
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  id="forge-crest-input"
                  data-testid="forge-crest-input"
                  type="text"
                  value={crestColor}
                  onChange={(e) => setCrestColor(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    color: FUI_TOKENS.inkStark,
                    backgroundColor: FUI_TOKENS.bgCarbon,
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    borderRadius: '0px',
                  }}
                />
                {CREST_PALETTE.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    data-testid={`forge-swatch-${swatch.replace('#', '')}`}
                    onClick={() => setCrestColor(swatch)}
                    style={{
                      width: '26px',
                      height: '26px',
                      backgroundColor: swatch,
                      border: `2px solid ${
                        crestColor === swatch ? FUI_TOKENS.inkStark : FUI_TOKENS.bgCarbon
                      }`,
                      borderRadius: '0px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      color: FUI_TOKENS.bgCarbon,
                    }}
                    title={`Select crest color ${swatch}`}
                  >
                    ■
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* System Oath (SOUL.md) Editor + 1-Click Template Variable Pills */}
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <label
              htmlFor="forge-soul-textarea"
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                color: FUI_TOKENS.accentOrange,
              }}
            >
              SYSTEM OATH (SOUL.MD // SYSTEM_PROMPT)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: FUI_TOKENS.fontMono, fontSize: '12px', color: FUI_TOKENS.inkMuted }}>
                INSERT VARIABLE:
              </span>
              {SOUL_TEMPLATE_VARIABLES.map((v) => {
                const cleanKey = v.token.replace(/[{}]/g, '');
                return (
                  <button
                    key={v.token}
                    type="button"
                    data-testid={`soul-var-${cleanKey}`}
                    onClick={() => handleInsertVariable(v.token)}
                    style={{
                      padding: '3px 8px',
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      fontWeight: 700,
                      color: FUI_TOKENS.accentCyan,
                      backgroundColor: 'rgba(44, 229, 242, 0.14)',
                      border: `1px solid ${FUI_TOKENS.accentCyan}`,
                      borderRadius: '0px',
                      cursor: 'pointer',
                    }}
                  >
                    + {v.token}
                  </button>
                );
              })}
            </div>
          </div>

          <textarea
            id="forge-soul-textarea"
            data-testid="forge-soul-textarea"
            rows={3}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Write the Knight's System Oath (SOUL.md)..."
            style={{
              width: '100%',
              padding: '8px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: FUI_TOKENS.inkStark,
              backgroundColor: FUI_TOKENS.bgPanel,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Model, Thinking Effort, Arena Zone, Budget HP & Context EP */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label
              htmlFor="forge-model-input"
              style={{ fontFamily: FUI_TOKENS.fontMono, fontSize: '12px', color: FUI_TOKENS.inkMuted }}
            >
              GATEWAY MODEL ID
            </label>
            <input
              id="forge-model-input"
              data-testid="forge-model-input"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={{
                padding: '6px 8px',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkStark,
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label
              htmlFor="forge-effort-select"
              style={{ fontFamily: FUI_TOKENS.fontMono, fontSize: '12px', color: FUI_TOKENS.inkMuted }}
            >
              THINKING EFFORT
            </label>
            <select
              id="forge-effort-select"
              data-testid="forge-effort-select"
              value={thinkingEffort}
              onChange={(e) =>
                setThinkingEffort(e.target.value as 'low' | 'medium' | 'high')
              }
              style={{
                padding: '6px 8px',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkStark,
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
              }}
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label
              htmlFor="forge-zone-select"
              style={{ fontFamily: FUI_TOKENS.fontMono, fontSize: '12px', color: FUI_TOKENS.inkMuted }}
            >
              ARENA DEPLOYMENT ZONE
            </label>
            <select
              id="forge-zone-select"
              data-testid="forge-zone-select"
              value={zone}
              onChange={(e) => setZone(normalizeArenaZone(e.target.value))}
              style={{
                padding: '6px 8px',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkStark,
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
              }}
            >
              {ARENA_ZONES.map((z) => (
                <option key={z.zone} value={z.zone}>
                  {z.zone} — {z.title}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label
              htmlFor="forge-budget-input"
              style={{ fontFamily: FUI_TOKENS.fontMono, fontSize: '12px', color: FUI_TOKENS.inkMuted }}
            >
              MONTHLY HP BUDGET (CENTS · {formatUsdFromCents(monthlyBudgetCents)})
            </label>
            <input
              id="forge-budget-input"
              data-testid="forge-budget-input"
              type="number"
              min={0}
              step={50}
              value={monthlyBudgetCents}
              onChange={(e) => setMonthlyBudgetCents(Number(e.target.value))}
              style={{
                padding: '6px 8px',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkStark,
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label
              htmlFor="forge-ep-max-input"
              style={{ fontFamily: FUI_TOKENS.fontMono, fontSize: '12px', color: FUI_TOKENS.inkMuted }}
            >
              MAX CONTEXT WINDOW (EP TOKENS)
            </label>
            <input
              id="forge-ep-max-input"
              data-testid="forge-ep-max-input"
              type="number"
              min={4096}
              step={4096}
              value={epMaxTokens}
              onChange={(e) => setEpMaxTokens(Number(e.target.value))}
              style={{
                padding: '6px 8px',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkStark,
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label
                htmlFor="forge-grid-x-input"
                style={{ fontFamily: FUI_TOKENS.fontMono, fontSize: '12px', color: FUI_TOKENS.inkMuted }}
              >
                TILE X (0-3)
              </label>
              <input
                id="forge-grid-x-input"
                data-testid="forge-grid-x-input"
                type="number"
                min={0}
                max={3}
                value={gridX}
                onChange={(e) => setGridX(Number(e.target.value))}
                style={{
                  padding: '6px 8px',
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  color: FUI_TOKENS.inkStark,
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  borderRadius: '0px',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label
                htmlFor="forge-grid-y-input"
                style={{ fontFamily: FUI_TOKENS.fontMono, fontSize: '12px', color: FUI_TOKENS.inkMuted }}
              >
                TILE Y (0-3)
              </label>
              <input
                id="forge-grid-y-input"
                data-testid="forge-grid-y-input"
                type="number"
                min={0}
                max={3}
                value={gridY}
                onChange={(e) => setGridY(Number(e.target.value))}
                style={{
                  padding: '6px 8px',
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  color: FUI_TOKENS.inkStark,
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  borderRadius: '0px',
                }}
              />
            </div>
          </div>
        </div>

        {/* Trigger Configuration: Cron Watchtower + Event Ambush Topics */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
            padding: '10px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            borderRadius: '0px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label
              htmlFor="forge-cron-input"
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                color: FUI_TOKENS.accentOrange,
              }}
            >
              CRON WATCHTOWER EXPRESSION
            </label>
            <input
              id="forge-cron-input"
              data-testid="forge-cron-input"
              type="text"
              value={cronSchedule}
              onChange={(e) => setCronSchedule(e.target.value)}
              placeholder="0 8 * * *"
              style={{
                padding: '6px 8px',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkStark,
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
              }}
            />

            <div style={{ fontFamily: FUI_TOKENS.fontMono, fontSize: '12px', color: FUI_TOKENS.inkMuted }}>
              EVENT AMBUSH BUS SUBSCRIPTIONS:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {DOMAIN_EVENT_TRIGGERS.map((topic) => {
                const active = eventTriggers.includes(topic.event);
                return (
                  <button
                    key={topic.event}
                    type="button"
                    data-testid={`forge-event-toggle-${topic.event}`}
                    aria-pressed={active}
                    onClick={() => toggleEventTrigger(topic.event)}
                    style={{
                      padding: '4px 8px',
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      fontWeight: active ? 700 : 500,
                      color: active ? FUI_TOKENS.accentCyan : FUI_TOKENS.inkMuted,
                      backgroundColor: active
                        ? 'rgba(44, 229, 242, 0.14)'
                        : FUI_TOKENS.bgPanel,
                      border: `1px solid ${
                        active ? FUI_TOKENS.accentCyan : FUI_TOKENS.borderHairline
                      }`,
                      borderRadius: '0px',
                      cursor: 'pointer',
                    }}
                  >
                    [{active ? '✓' : ' '}] {topic.event}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Trigger Records (POST / DELETE /api/agents/{id}/triggers) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                color: FUI_TOKENS.accentCyan,
              }}
            >
              BOUND TRIGGER RULES ({triggers.length})
            </div>

            {mode === 'edit' && initialKnight && onAddTrigger && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <select
                  data-testid="forge-new-trigger-type"
                  value={newTriggerType}
                  onChange={(e) => {
                    const t = e.target.value as AgentTriggerType;
                    setNewTriggerType(t);
                    setNewTriggerValue(t === 'cron' ? '0 9 * * 1-5' : 'YoutubeCrawlerSynced');
                  }}
                  style={{
                    padding: '4px 6px',
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    color: FUI_TOKENS.inkStark,
                    backgroundColor: FUI_TOKENS.bgPanel,
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    borderRadius: '0px',
                  }}
                >
                  <option value="cron">cron</option>
                  <option value="event">event</option>
                </select>
                <input
                  type="text"
                  data-testid="forge-new-trigger-value"
                  value={newTriggerValue}
                  onChange={(e) => setNewTriggerValue(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    color: FUI_TOKENS.inkStark,
                    backgroundColor: FUI_TOKENS.bgPanel,
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    borderRadius: '0px',
                  }}
                />
                <button
                  type="button"
                  data-testid="forge-add-trigger-btn"
                  onClick={() =>
                    onAddTrigger(
                      initialKnight.id,
                      newTriggerType === 'cron'
                        ? { type: 'cron', config_json: { cron: newTriggerValue }, enabled: true }
                        : { type: 'event', config_json: { event: newTriggerValue }, enabled: true },
                    )
                  }
                  style={{
                    padding: '4px 8px',
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    fontWeight: 700,
                    color: FUI_TOKENS.accentCyan,
                    backgroundColor: 'rgba(44, 229, 242, 0.14)',
                    border: `1px solid ${FUI_TOKENS.accentCyan}`,
                    borderRadius: '0px',
                    cursor: 'pointer',
                  }}
                >
                  [+ ATTACH TRIGGER]
                </button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '90px', overflowY: 'auto' }}>
              {triggers.map((trig) => {
                const cfg = (trig.config_json ?? {}) as Record<string, any>;
                const exprLabel = cfg.cron || cfg.event || cfg.description || 'active';
                return (
                  <div
                    key={trig.id}
                    data-testid={`forge-trigger-row-${trig.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 8px',
                      backgroundColor: FUI_TOKENS.bgPanel,
                      border: `1px solid ${FUI_TOKENS.borderHairline}`,
                      borderRadius: '0px',
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                    }}
                  >
                    <span>
                      {String(trig.type || 'cron').toUpperCase()} // {exprLabel}
                    </span>
                    {mode === 'edit' && initialKnight && onDeleteTrigger && (
                      <button
                        type="button"
                        data-testid={`forge-delete-trigger-${trig.id}`}
                        onClick={() => onDeleteTrigger(initialKnight.id, trig.id)}
                        style={{
                          padding: '1px 6px',
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                          color: FUI_TOKENS.accentVermilion,
                          backgroundColor: 'transparent',
                          border: `1px solid ${FUI_TOKENS.accentVermilion}`,
                          borderRadius: '0px',
                          cursor: 'pointer',
                        }}
                      >
                        [✕]
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Tool Autonomy Matrix inside Forge */}
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
          <div
            style={{
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 700,
              color: FUI_TOKENS.accentOrange,
            }}
          >
            /MCP SKILL AUTONOMY MATRIX (READ · APPROVE · AUTO · NONE)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
            {STANDARD_SKILL_SLOTS.map((slot) => {
              const modeVal = resolveSkillSlotMode(toolsPolicy, slot);
              const shortKey = slot.key.replace(/\.\*$/, '');
              return (
                <div
                  key={slot.key}
                  style={{
                    padding: '6px 8px',
                    backgroundColor: FUI_TOKENS.bgPanel,
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    borderRadius: '0px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <span style={{ fontFamily: FUI_TOKENS.fontMono, fontSize: '12px', fontWeight: 700 }}>
                    {slot.key}
                  </span>
                  <div style={{ display: 'flex', gap: '3px' }}>
                    {(['READ', 'APPROVE', 'AUTO', 'NONE'] as UiSkillPolicyMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        data-testid={`forge-policy-${shortKey}-${m.toLowerCase()}`}
                        onClick={() => setToolsPolicy((prev) => buildUpdatedToolsPolicy(prev, slot.key, m))}
                        style={{
                          flex: 1,
                          padding: '2px 3px',
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                          fontWeight: modeVal === m ? 700 : 400,
                          color: modeVal === m ? FUI_TOKENS.accentOrange : FUI_TOKENS.inkMuted,
                          backgroundColor:
                            modeVal === m
                              ? 'rgba(248, 124, 24, 0.16)'
                              : FUI_TOKENS.bgCarbon,
                          border: `1px solid ${
                            modeVal === m ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                          }`,
                          borderRadius: '0px',
                          cursor: 'pointer',
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
            paddingTop: '10px',
          }}
        >
          <div>
            {mode === 'edit' && initialKnight && onDelete && (
              <button
                type="button"
                data-testid="forge-delete-btn"
                onClick={() => onDelete(initialKnight.id)}
                style={{
                  padding: '8px 14px',
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  fontWeight: 700,
                  color: FUI_TOKENS.accentVermilion,
                  backgroundColor: 'rgba(235, 69, 17, 0.14)',
                  border: `1px solid ${FUI_TOKENS.accentVermilion}`,
                  borderRadius: '0px',
                  cursor: 'pointer',
                }}
              >
                [🗑 DISMISS UNIT]
              </button>
            )}
          </div>

          <button
            type="button"
            data-testid="forge-submit-btn"
            disabled={isSubmitting}
            onClick={handleFormSubmit}
            style={{
              padding: '8px 18px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 700,
              color: FUI_TOKENS.bgCarbon,
              backgroundColor: FUI_TOKENS.accentOrange,
              border: `1px solid ${FUI_TOKENS.accentOrange}`,
              borderRadius: '0px',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {mode === 'create' ? '[⚒ FORGE & DEPLOY KNIGHT]' : '[💾 SAVE & DEPLOY KNIGHT]'}
          </button>
        </div>
      </form>
    </div>
  );
}
