import { describe, expect, it } from 'vitest';
import {
  normalizeArenaZone,
  normalizeKnightArchetype,
  normalizeSkillPolicyMode,
} from '../../api/agents';
import {
  buildTurnOrderChain,
  buildUpdatedToolsPolicy,
  computeKnightTelemetry,
  FALLBACK_STARTER_KNIGHTS,
  insertSoulTemplateVariable,
  resolveSkillSlotMode,
  slugifyAgentName,
  STANDARD_SKILL_SLOTS,
  validateKnightForgeInput,
} from './knightsModel';

describe('knightsModel unit tests (F26)', () => {
  it('normalizes Knight archetypes and Arena zones case-insensitively and maps aliases', () => {
    expect(normalizeKnightArchetype('Paladin')).toBe('paladin');
    expect(normalizeKnightArchetype('Ranger')).toBe('vanguard');
    expect(normalizeKnightArchetype('Scholar')).toBe('lore_warden');
    expect(normalizeKnightArchetype('Lore-Warden')).toBe('lore_warden');
    expect(normalizeKnightArchetype('Artificer')).toBe('artificer');
    expect(normalizeKnightArchetype('unknown_class')).toBe('paladin');

    expect(normalizeArenaZone('cron_watchtower')).toBe('cron_watchtower');
    expect(normalizeArenaZone('watchtower')).toBe('cron_watchtower');
    expect(normalizeArenaZone('event_ambush')).toBe('event_ambush');
    expect(normalizeArenaZone('scriptorium')).toBe('event_ambush');
    expect(normalizeArenaZone('mastermind_council')).toBe('mastermind_council');
    expect(normalizeArenaZone('command_citadel')).toBe('mastermind_council');
    expect(normalizeArenaZone('standby_barracks')).toBe('standby_barracks');
  });

  it('computes HP ($remaining / $budget) and EP (used / max ctx) telemetry accurately', () => {
    const telemetry = computeKnightTelemetry({
      id: 'k-1',
      slug: 'sir-chronos',
      name: 'Sir Chronos',
      knight_archetype: 'paladin',
      crest_color: '#F87C18',
      grid_pos: { x: 1, y: 1, zone: 'cron_watchtower' },
      monthly_budget_cents: 500,
      spent_month_cents: 160,
      ep_used_tokens: 14000,
      ep_max_tokens: 128000,
      enabled: true,
    });

    expect(telemetry.remainingCents).toBe(340);
    expect(telemetry.hpPct).toBe(68);
    expect(telemetry.hpLabel).toBe('$3.40 / $5.00');
    expect(telemetry.epLabel).toBe('14k / 128k ctx');
    expect(telemetry.isCircuitBroken).toBe(false);
    expect(telemetry.isPaused).toBe(false);

    const zeroBudget = computeKnightTelemetry({
      id: 'k-0',
      name: 'Exhausted Knight',
      knight_archetype: 'vanguard',
      monthly_budget_cents: 0,
      spent_month_cents: 0,
    });
    expect(zeroBudget.hpPct).toBe(0);
    expect(zeroBudget.hpLabel).toBe('$0.00 / $0.00');
    expect(zeroBudget.isCircuitBroken).toBe(true);
    expect(zeroBudget.isPaused).toBe(true);
  });

  it('resolves and updates /mcp skill slot policies across READ, APPROVE, AUTO, and NONE', () => {
    expect(normalizeSkillPolicyMode('REQUIRE_APPROVAL')).toBe('APPROVE');
    expect(normalizeSkillPolicyMode('IMMEDIATE_UNDO')).toBe('AUTO');
    expect(normalizeSkillPolicyMode('read')).toBe('READ');
    expect(normalizeSkillPolicyMode('')).toBe('NONE');

    const portfolioSlot = STANDARD_SKILL_SLOTS.find((s) => s.key === 'portfolio.*')!;
    expect(resolveSkillSlotMode({ 'finance.*': 'APPROVE' }, portfolioSlot)).toBe('APPROVE');

    const updated = buildUpdatedToolsPolicy({ 'todos.*': 'READ' }, 'portfolio.*', 'AUTO');
    expect(updated['portfolio.*']).toBe('AUTO');
    expect(updated['finance.*']).toBe('AUTO');
    expect(updated['todos.*']).toBe('READ');

    const cleared = buildUpdatedToolsPolicy(updated, 'portfolio.*', 'NONE');
    expect(cleared['portfolio.*']).toBeUndefined();
    expect(cleared['finance.*']).toBeUndefined();
  });

  it('inserts SOUL.md template variables and validates Knight Forge inputs', () => {
    const base = '# SOUL.md\nToday:';
    expect(insertSoulTemplateVariable(base, '{{today}}')).toBe('# SOUL.md\nToday: {{today}}');
    expect(slugifyAgentName('Sentinel — The Vault Watcher!')).toBe('sentinel-the-vault-watcher');

    expect(
      validateKnightForgeInput({
        name: '   ',
        systemPrompt: 'Oath',
        crestColor: '#F87C18',
        monthlyBudgetCents: 500,
        epMaxTokens: 128000,
      }).valid,
    ).toBe(false);

    expect(
      validateKnightForgeInput({
        name: 'Valid Zero Budget',
        systemPrompt: 'Oath',
        crestColor: '#F87C18',
        monthlyBudgetCents: 0,
        epMaxTokens: 128000,
      }).valid,
    ).toBe(true);

    expect(
      validateKnightForgeInput({
        name: 'Negative Budget',
        systemPrompt: 'Oath',
        crestColor: '#F87C18',
        monthlyBudgetCents: -100,
        epMaxTokens: 128000,
      }).valid,
    ).toBe(false);
  });

  it('excludes Standby Barracks Knights from upcoming Turn-Order Queue nodes', () => {
    const knights = FALLBACK_STARTER_KNIGHTS.map((k, idx) =>
      computeKnightTelemetry(
        idx === 0
          ? { ...k, grid_pos: { x: 2, y: 2, zone: 'standby_barracks' }, is_paused: true, enabled: false }
          : k,
      ),
    );
    const chain = buildTurnOrderChain({
      knights,
      queueItems: [
        {
          trigger_id: 't-1',
          agent_id: knights[0].id,
          agent_slug: knights[0].slug,
          agent_name: knights[0].name,
          trigger_type: 'cron',
          label: '0 0 7 * * *',
          scheduled_at: null,
        },
        {
          trigger_id: 't-2',
          agent_id: knights[1].id,
          agent_slug: knights[1].slug,
          agent_name: knights[1].name,
          trigger_type: 'event',
          label: 'PortfolioPriceAlert',
          scheduled_at: null,
        },
      ],
      recentRuns: [],
    });

    expect(chain.upcomingNodes.some((n) => n.agentId === knights[0].id)).toBe(false);
    expect(chain.upcomingNodes.some((n) => n.agentId === knights[1].id)).toBe(true);
  });

  it('adv_02: marks Knights with is_paused: false as paused when circuit-broken (spent >= budget) or disabled, and excludes them from buildTurnOrderChain', () => {
    const circuitBrokenKnight = computeKnightTelemetry({
      ...FALLBACK_STARTER_KNIGHTS[0],
      is_paused: false,
      enabled: true,
      monthly_budget_cents: 500,
      spent_month_cents: 500,
    });
    expect(circuitBrokenKnight.remainingCents).toBe(0);
    expect(circuitBrokenKnight.hpLabel).toBe('$0.00 / $5.00');
    expect(circuitBrokenKnight.isCircuitBroken).toBe(true);
    expect(circuitBrokenKnight.isPaused).toBe(true);

    const disabledKnight = computeKnightTelemetry({
      ...FALLBACK_STARTER_KNIGHTS[1],
      is_paused: false,
      enabled: false,
      monthly_budget_cents: 500,
      spent_month_cents: 0,
    });
    expect(disabledKnight.isPaused).toBe(true);

    const activeKnight = computeKnightTelemetry(FALLBACK_STARTER_KNIGHTS[2]);
    const chain = buildTurnOrderChain({
      knights: [circuitBrokenKnight, disabledKnight, activeKnight],
      queueItems: [
        {
          trigger_id: 'trig-cb',
          agent_id: circuitBrokenKnight.id,
          agent_slug: circuitBrokenKnight.slug,
          agent_name: circuitBrokenKnight.name,
          trigger_type: 'cron',
          label: '0 0 7 * * *',
          scheduled_at: null,
        },
        {
          trigger_id: 'trig-dis',
          agent_id: disabledKnight.id,
          agent_slug: disabledKnight.slug,
          agent_name: disabledKnight.name,
          trigger_type: 'event',
          label: 'PortfolioPriceAlert',
          scheduled_at: null,
        },
        {
          trigger_id: 'trig-act',
          agent_id: activeKnight.id,
          agent_slug: activeKnight.slug,
          agent_name: activeKnight.name,
          trigger_type: 'event',
          label: 'YoutubeCrawlerSynced',
          scheduled_at: null,
        },
      ],
      recentRuns: [],
    });

    expect(chain.upcomingNodes.map((n) => n.agentId)).toEqual([activeKnight.id]);
    expect(chain.activeKnight?.id).toBe(activeKnight.id);
  });

  it('adv_06: revokes (NONE) skill slots populated via wildcard * or domain_prefix tool keys while preserving other slots', () => {
    const wildcardPolicy = { '*': 'AUTO' as const };
    const afterRevokeTodos = buildUpdatedToolsPolicy(wildcardPolicy, 'todos.*', 'NONE');
    expect(resolveSkillSlotMode(afterRevokeTodos, 'todos.*')).toBe('NONE');
    expect(resolveSkillSlotMode(afterRevokeTodos, 'portfolio.*')).toBe('AUTO');
    expect(resolveSkillSlotMode(afterRevokeTodos, 'vault.*')).toBe('AUTO');

    const prefixPolicy = {
      todos_create_task: 'AUTO' as const,
      finance_get_portfolio: 'READ' as const,
    };
    const afterRevokePrefix = buildUpdatedToolsPolicy(prefixPolicy, 'todos.*', 'NONE');
    expect(resolveSkillSlotMode(afterRevokePrefix, 'todos.*')).toBe('NONE');
    expect(resolveSkillSlotMode(afterRevokePrefix, 'portfolio.*')).toBe('READ');
  });

  it('adv_computeKnightTelemetry_and_turnOrderChain_handle_paused_barracks_and_wildcard_policy', () => {
    const pausedScholar = computeKnightTelemetry({
      id: 'k-scholar',
      name: 'Lady Archive',
      archetype: 'scholar',
      enabled: false,
      monthly_budget_cents: 500,
      spent_month_cents: 600,
      ep_used_tokens: 32000,
      ep_max_tokens: 128000,
    });
    expect(pausedScholar.archetype).toBe('lore_warden');
    expect(pausedScholar.zone).toBe('standby_barracks');
    expect(pausedScholar.hpPct).toBe(0);
    expect(pausedScholar.isCircuitBroken).toBe(true);
    expect(pausedScholar.isPaused).toBe(true);

    const expanded = buildUpdatedToolsPolicy({ '*': 'READ' }, 'todos.*', 'AUTO');
    expect(resolveSkillSlotMode(expanded, 'todos.*')).toBe('AUTO');
    expect(resolveSkillSlotMode(expanded, 'routines.*')).toBe('READ');

    expect(insertSoulTemplateVariable('Hello ', '{{today}}')).toBe('Hello {{today}}');
    expect(
      validateKnightForgeInput({
        name: '',
        crestColor: 'invalid',
        monthlyBudgetCents: -5,
        epMaxTokens: 500,
      }).valid,
    ).toBe(false);

    const chain = buildTurnOrderChain({
      knights: [pausedScholar],
      queueItems: [
        {
          trigger_id: 'trig-1',
          agent_id: 'k-scholar',
          agent_slug: 'lady-archive',
          agent_name: 'Lady Archive',
          trigger_type: 'cron',
          label: '07:00 Pulse',
          scheduled_at: '2026-11-16T07:00:00Z',
        },
      ],
      recentRuns: [],
    });
    expect(chain.upcomingNodes).toEqual([]);
  });
});
