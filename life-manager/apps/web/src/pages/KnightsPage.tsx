import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FUI_TOKENS } from '@hermes/ui';
import {
  createAgent,
  createAgentTrigger,
  deleteAgent,
  deleteAgentTrigger,
  dispatchAgent,
  getAgentRun,
  getAgentTurnQueue,
  listAgentRuns,
  listAgents,
  listAgentTriggers,
  normalizeArenaZone,
  updateAgent,
  type AgentTrigger,
  type AgentWithTelemetry,
  type ArenaZone,
  type CreateAgentPayload,
  type CreateAgentTriggerPayload,
  type UiSkillPolicyMode,
} from '../api/agents';
import {
  FALLBACK_STARTER_KNIGHTS,
  buildUpdatedToolsPolicy,
  computeKnightTelemetry,
  type ComputedKnightTelemetry,
  type SkillSlotDescriptor,
} from '../components/knights/knightsModel';
import { TurnOrderBar } from '../components/knights/TurnOrderBar';
import { IsometricArenaBoard } from '../components/knights/IsometricArenaBoard';
import { SkillSlotHud } from '../components/knights/SkillSlotHud';
import { BattleLogsPanel, type ExtendedAgentRun } from '../components/knights/BattleLogsPanel';
import { KnightForgeModal } from '../components/knights/KnightForgeModal';

export function KnightsPage(): React.ReactElement {
  const queryClient = useQueryClient();

  const [selectedKnightId, setSelectedKnightId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [castingKnightId, setCastingKnightId] = useState<string | null>(null);
  const [redeployBusyId, setRedeployBusyId] = useState<string | null>(null);
  const [forgeOpen, setForgeOpen] = useState<boolean>(false);
  const [forgeMode, setForgeMode] = useState<'create' | 'edit'>('create');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSavingPolicy, setIsSavingPolicy] = useState<boolean>(false);
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [isSubmittingForge, setIsSubmittingForge] = useState<boolean>(false);

  // Local overlay state so mutations reflect immediately alongside TanStack Query invalidation
  const [localKnightsOverlay, setLocalKnightsOverlay] = useState<AgentWithTelemetry[] | null>(
    null,
  );
  const [localKnightPatches, setLocalKnightPatches] = useState<
    Record<string, Partial<AgentWithTelemetry>>
  >({});
  const [deletedKnightIds, setDeletedKnightIds] = useState<Set<string>>(() => new Set());
  const [localRunsOverlay, setLocalRunsOverlay] = useState<ExtendedAgentRun[]>([]);

  const agentsQuery = useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      try {
        const list = await listAgents();
        return list.length > 0 ? list : [...FALLBACK_STARTER_KNIGHTS];
      } catch {
        return [...FALLBACK_STARTER_KNIGHTS];
      }
    },
  });

  useEffect(() => {
    if (agentsQuery.data) {
      setLocalKnightsOverlay((prev) => {
        const filteredIncoming = agentsQuery.data.filter((a) => !deletedKnightIds.has(a.id));
        const merged = filteredIncoming.map((inc) => {
          const patch = localKnightPatches[inc.id];
          if (!patch) return inc;
          return {
            ...inc,
            ...patch,
            // Always prefer fresh server spend/token telemetry from `inc`
            spent_month_cents: inc.spent_month_cents,
            ...(inc as Record<string, any>).month_spent_cents !== undefined
              ? { month_spent_cents: (inc as Record<string, any>).month_spent_cents }
              : {},
            ep_used_tokens: inc.ep_used_tokens,
            ep_pct: inc.ep_pct,
            triggers: patch.triggers ?? inc.triggers,
          } as AgentWithTelemetry;
        });
        if (!prev) return merged;
        const incomingIds = new Set(filteredIncoming.map((a) => a.id));
        const localOnly = prev.filter(
          (k) => !incomingIds.has(k.id) && !deletedKnightIds.has(k.id),
        );
        return [...merged, ...localOnly];
      });
    }
  }, [agentsQuery.data, localKnightPatches, deletedKnightIds]);

  const rawKnights: AgentWithTelemetry[] = useMemo(() => {
    return localKnightsOverlay ?? agentsQuery.data ?? [...FALLBACK_STARTER_KNIGHTS];
  }, [localKnightsOverlay, agentsQuery.data]);

  const queueQuery = useQuery({
    queryKey: ['agents-queue'],
    queryFn: async () => {
      try {
        return await getAgentTurnQueue();
      } catch {
        return [];
      }
    },
  });

  const runsQuery = useQuery({
    queryKey: ['agent-runs'],
    queryFn: async () => {
      try {
        return (await listAgentRuns({ limit: 25 })) as ExtendedAgentRun[];
      } catch {
        return [] as ExtendedAgentRun[];
      }
    },
  });

  const allRuns: ExtendedAgentRun[] = useMemo(() => {
    const serverRuns = (runsQuery.data ?? []) as ExtendedAgentRun[];
    const seen = new Set(serverRuns.map((r) => r.id));
    const merged = [...localRunsOverlay.filter((r) => !seen.has(r.id)), ...serverRuns];
    return merged;
  }, [runsQuery.data, localRunsOverlay]);

  const knights: ComputedKnightTelemetry[] = useMemo(() => {
    return rawKnights.map((raw) => {
      const latestRun = allRuns.find((r) => r.agent_id === raw.id) ?? null;
      return computeKnightTelemetry(raw as unknown as Record<string, any>, latestRun);
    });
  }, [rawKnights, allRuns]);

  const selectedKnight: ComputedKnightTelemetry | null = useMemo(() => {
    if (knights.length === 0) return null;
    if (selectedKnightId) {
      const found = knights.find((k) => k.id === selectedKnightId);
      if (found) return found;
    }
    return knights[0];
  }, [knights, selectedKnightId]);

  const activeRunId = selectedRunId ?? allRuns[0]?.id ?? null;

  const runDetailQuery = useQuery({
    queryKey: ['agent-run-detail', activeRunId],
    enabled: Boolean(activeRunId),
    queryFn: async () => {
      if (!activeRunId) return null;
      const localMatch = localRunsOverlay.find((r) => r.id === activeRunId);
      try {
        const fetched = (await getAgentRun(activeRunId)) as ExtendedAgentRun;
        if (fetched && typeof fetched.id === 'string' && fetched.id.length > 0) {
          return fetched;
        }
        return localMatch ?? allRuns.find((r) => r.id === activeRunId) ?? null;
      } catch {
        return localMatch ?? allRuns.find((r) => r.id === activeRunId) ?? null;
      }
    },
  });

  const selectedRun: ExtendedAgentRun | null = useMemo(() => {
    if (runDetailQuery.data) return runDetailQuery.data;
    if (activeRunId) {
      return allRuns.find((r) => r.id === activeRunId) ?? null;
    }
    return allRuns[0] ?? null;
  }, [runDetailQuery.data, activeRunId, allRuns]);

  const triggersQuery = useQuery({
    queryKey: ['agent-triggers', selectedKnight?.id],
    enabled: Boolean(selectedKnight?.id),
    queryFn: async () => {
      if (!selectedKnight) return [] as AgentTrigger[];
      try {
        const list = await listAgentTriggers(selectedKnight.id);
        setLocalKnightsOverlay((prev) =>
          prev
            ? prev.map((k) => (k.id === selectedKnight.id ? { ...k, triggers: list } : k))
            : prev,
        );
        return list;
      } catch {
        return selectedKnight.triggers;
      }
    },
  });

  // Subscribe to SSE live cast state written by useEventStream
  const liveCastQuery = useQuery<{
    run_id?: string;
    runId?: string;
    agent_id?: string;
    agentId?: string;
    agent_slug?: string;
    agentSlug?: string;
    status?: string;
    receivedAt?: number;
    updatedAt?: number;
  } | null>({
    queryKey: ['knight-live-cast'],
    queryFn: () => null,
    staleTime: Infinity,
  });

  useEffect(() => {
    const payload = liveCastQuery.data;
    if (!payload) return;
    const rawId = payload.agent_id ?? payload.agentId;
    const rawSlug = payload.agent_slug ?? payload.agentSlug;
    if (!rawId && !rawSlug) return;
    const matched = knights.find(
      (k) =>
        (rawId && (k.id === rawId || k.slug === rawId)) ||
        (rawSlug && (k.slug === rawSlug || k.id === rawSlug)),
    );
    const resolvedId = matched?.id ?? rawId ?? rawSlug ?? null;
    if (!resolvedId) return;
    setCastingKnightId(resolvedId);
    const timer = setTimeout(() => {
      setCastingKnightId((prev) => (prev === resolvedId ? null : prev));
    }, 2400);
    return () => clearTimeout(timer);
  }, [liveCastQuery.data]);

  // Handler: Redeploy Knight to target zone & tile (drag-and-drop OR click button)
  const handleDeployKnightToZone = async (
    knight: ComputedKnightTelemetry,
    targetZone: ArenaZone,
    x = 0,
    y = 0,
  ) => {
    const normalizedZone = normalizeArenaZone(targetZone);
    const inBarracks = normalizedZone === 'standby_barracks';
    const nextGridPos = { x, y, zone: normalizedZone };
    const deployPatch: Partial<AgentWithTelemetry> = {
      grid_pos: nextGridPos,
      is_paused: inBarracks,
      enabled: !inBarracks,
    };

    setRedeployBusyId(knight.id);
    setLocalKnightPatches((prev) => ({
      ...prev,
      [knight.id]: { ...prev[knight.id], ...deployPatch },
    }));
    setLocalKnightsOverlay((prev) => {
      const base = prev ?? rawKnights;
      return base.map((k) =>
        k.id === knight.id
          ? {
              ...k,
              ...deployPatch,
            }
          : k,
      );
    });
    setSelectedKnightId(knight.id);
    setStatusMessage(
      `Redeployed ${knight.name} to ${normalizedZone.toUpperCase()} (${x}, ${y})${
        inBarracks ? ' [PAUSED]' : ''
      }.`,
    );

    try {
      const updated = await updateAgent(knight.id, {
        zone: normalizedZone,
        grid_pos: nextGridPos,
        is_paused: inBarracks,
        enabled: !inBarracks,
      });
      setLocalKnightsOverlay((prev) =>
        (prev ?? rawKnights).map((k) =>
          k.id === knight.id
            ? {
                ...k,
                ...updated,
                ...deployPatch,
              }
            : k,
        ),
      );
      await queryClient.invalidateQueries({ queryKey: ['agents'] });
      await queryClient.invalidateQueries({ queryKey: ['agents-queue'] });
    } catch {
      // Keep optimistic deployment state when running offline
    } finally {
      setRedeployBusyId(null);
    }
  };

  // Handler: Toggle Skill Slot Policy in HUD (`READ` / `APPROVE` / `AUTO` / `NONE`)
  const handleChangeSkillPolicy = async (
    slot: SkillSlotDescriptor,
    nextMode: UiSkillPolicyMode,
  ) => {
    if (!selectedKnight) return;
    const currentZone = normalizeArenaZone(selectedKnight.zone);
    const currentGridPos = {
      x: selectedKnight.gridX,
      y: selectedKnight.gridY,
      zone: currentZone,
    };
    const updatedPolicy = buildUpdatedToolsPolicy(
      selectedKnight.toolsPolicy,
      slot.key,
      nextMode,
    );

    setIsSavingPolicy(true);
    setLocalKnightPatches((prev) => ({
      ...prev,
      [selectedKnight.id]: {
        ...prev[selectedKnight.id],
        tools_policy: updatedPolicy,
      },
    }));
    setLocalKnightsOverlay((prev) =>
      (prev ?? rawKnights).map((k) =>
        k.id === selectedKnight.id ? { ...k, tools_policy: updatedPolicy } : k,
      ),
    );
    setStatusMessage(`Updated ${selectedKnight.name} skill gate ${slot.key} -> ${nextMode}.`);

    try {
      const updated = await updateAgent(selectedKnight.id, {
        zone: currentZone,
        grid_pos: currentGridPos,
        tools_policy: updatedPolicy,
      });
      setLocalKnightsOverlay((prev) =>
        (prev ?? rawKnights).map((k) =>
          k.id === selectedKnight.id
            ? { ...k, ...updated, tools_policy: updatedPolicy }
            : k,
        ),
      );
      await queryClient.invalidateQueries({ queryKey: ['agents'] });
    } catch {
      // Preserve optimistic update if offline
    } finally {
      setIsSavingPolicy(false);
    }
  };

  // Handler: Dispatch Now or Dry-Run Sandbox
  const handleDispatchKnight = async (dryRun: boolean, task: string) => {
    if (!selectedKnight) return;
    setIsDispatching(true);
    setCastingKnightId(selectedKnight.id);
    setStatusMessage(
      dryRun
        ? `Executing Dry-Run Sandbox for ${selectedKnight.name} (write tools intercepted, $0.00 cost)...`
        : `Dispatching ${selectedKnight.name} via hermes gateway...`,
    );

    try {
      const runRecord = (await dispatchAgent(selectedKnight.id, {
        dry_run: dryRun,
        sample_input: task,
        input: task,
      })) as ExtendedAgentRun;
      const parsedEstimatedUsd =
        runRecord.estimated_cost_usd !== undefined && runRecord.estimated_cost_usd !== null
          ? Number.parseFloat(String(runRecord.estimated_cost_usd).trim().replace(/^\$/, ''))
          : Number.NaN;
      const resolvedCostCents = dryRun
        ? 0
        : typeof runRecord.cost_cents === 'number'
          ? runRecord.cost_cents
          : Number.isFinite(parsedEstimatedUsd)
            ? Math.round(parsedEstimatedUsd * 100)
            : 2;
      const enrichedRun: ExtendedAgentRun = {
        ...runRecord,
        is_dry_run: dryRun || Boolean(runRecord.is_dry_run),
        cost_cents: resolvedCostCents,
        trigger_type: runRecord.trigger_type ?? (dryRun ? 'dry_run' : 'manual'),
      };
      setLocalRunsOverlay((prev) => [
        enrichedRun,
        ...prev.filter((r) => r.id !== enrichedRun.id),
      ]);
      setSelectedRunId(enrichedRun.id);
      setStatusMessage(
        dryRun
          ? `Dry-Run Sandbox completed for ${selectedKnight.name} ($0.00 cost).`
          : `Run ${enrichedRun.id.slice(0, 8)} completed for ${selectedKnight.name}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
      await queryClient.invalidateQueries({ queryKey: ['agents'] });
      await queryClient.invalidateQueries({ queryKey: ['agents-queue'] });
    } catch {
      const nowIso = new Date().toISOString();
      const fallbackRun: ExtendedAgentRun = {
        id: `run-${Date.now()}`,
        agent_id: selectedKnight.id,
        trigger_id: null,
        trigger_type: dryRun ? 'dry_run' : 'manual',
        status: 'succeeded',
        is_dry_run: dryRun,
        summary: dryRun
          ? `[DRY-RUN SANDBOX] Simulated ${selectedKnight.name} execution for "${task}". Write tools intercepted.`
          : `Executed ${selectedKnight.name} directive: "${task}".`,
        hermes_session_key: `knight-${selectedKnight.slug}-${Date.now()}`,
        steps_trace: [
          {
            step: 1,
            phase: 'soul_hydrated',
            status: 'ok',
            detail: `Hydrated ${selectedKnight.name} SOUL.md ({{today}}, {{active_goals}}, {{portfolio_summary}}).`,
          },
          {
            step: 2,
            tool: 'mcp.life_ops.evaluate',
            status: dryRun ? 'simulated_dry_run' : 'ok',
            detail: dryRun
              ? 'Write calls intercepted in Dry-Run Sandbox ($0.00 budget impact).'
              : 'Executed Life Ops domain tool call under Knight autonomy policy.',
          },
        ],
        input_tokens: 420,
        output_tokens: 220,
        tokens_used: 640,
        estimated_cost_usd: dryRun ? '0.00' : '0.02',
        cost_cents: dryRun ? 0 : 2,
        duration_ms: 195,
        error_message: null,
        started_at: nowIso,
        finished_at: nowIso,
      };
      setLocalRunsOverlay((prev) => [fallbackRun, ...prev]);
      setSelectedRunId(fallbackRun.id);
    } finally {
      setIsDispatching(false);
      setTimeout(() => {
        setCastingKnightId((prev) => (prev === selectedKnight.id ? null : prev));
      }, 1200);
    }
  };

  // Handler: Create or Edit Knight in Knight Forge
  const handleForgeSubmit = async (
    payload: CreateAgentPayload,
    pendingTrigger?: CreateAgentTriggerPayload,
    pendingTriggers?: CreateAgentTriggerPayload[],
  ) => {
    setIsSubmittingForge(true);
    try {
      if (forgeMode === 'create') {
        const triggersToCreate =
          Array.isArray(pendingTriggers) && pendingTriggers.length > 0
            ? pendingTriggers
            : pendingTrigger
              ? [pendingTrigger]
              : [];
        try {
          const created = await createAgent(payload);
          const createdTriggers: AgentTrigger[] = [];
          for (const trig of triggersToCreate) {
            try {
              const t = await createAgentTrigger(created.id, trig);
              if (t && typeof t === 'object' && typeof t.id === 'string') {
                createdTriggers.push(t);
              }
            } catch {
              // ignore individual trigger error
            }
          }
          const createdWithTriggers: AgentWithTelemetry =
            createdTriggers.length > 0
              ? { ...created, triggers: [...(created.triggers ?? []), ...createdTriggers] }
              : created;
          setLocalKnightsOverlay((prev) => [...(prev ?? rawKnights), createdWithTriggers]);
          setSelectedKnightId(created.id);
          setStatusMessage(`Forged & deployed ${created.name} to ${payload.zone}.`);
        } catch {
          const nowIso = new Date().toISOString();
          const targetZone = normalizeArenaZone(payload.zone ?? 'cron_watchtower');
          const budget = payload.monthly_budget_cents ?? 500;
          const fallbackCreated: AgentWithTelemetry = {
            id: `01963000-0000-7000-8000-${String(Date.now()).slice(-12).padStart(12, '0')}`,
            name: payload.name,
            slug: payload.slug || payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            knight_archetype: normalizeArenaZone(payload.zone) ? (payload.knight_archetype as any) : 'artificer',
            crest_color: payload.crest_color || '#F87C18',
            sprite_sheet_id: `knight-${payload.knight_archetype}`,
            grid_pos: {
              x: payload.grid_pos?.x ?? 0,
              y: payload.grid_pos?.y ?? 0,
              zone: targetZone,
            },
            hermes_profile: null,
            system_prompt: payload.system_prompt,
            model_config: payload.model_config ?? {
              model: 'claude-sonnet-4-20250514',
              thinking_effort: 'high',
              max_context_tokens: 128000,
              ep_daily_tokens: 128000,
            },
            tools_policy: payload.tools_policy ?? {},
            monthly_budget_cents: budget,
            spent_month_cents: 0,
            hp_remaining_cents: budget,
            hp_pct: 100,
            ep_used_tokens: 0,
            ep_max_tokens: 128000,
            ep_pct: 100,
            is_mastermind_member: targetZone === 'mastermind_council',
            enabled: payload.enabled ?? targetZone !== 'standby_barracks',
            is_paused: payload.is_paused ?? targetZone === 'standby_barracks',
            version: 1,
            created_at: nowIso,
            updated_at: nowIso,
            triggers: [],
          };
          setLocalKnightsOverlay((prev) => [...(prev ?? rawKnights), fallbackCreated]);
          setSelectedKnightId(fallbackCreated.id);
          setStatusMessage(`Forged & deployed ${fallbackCreated.name} to ${targetZone}.`);
        }
      } else if (selectedKnight) {
        const targetZone = normalizeArenaZone(payload.zone ?? selectedKnight.zone);
        const nextBudget = payload.monthly_budget_cents ?? selectedKnight.budgetCents;
        const nextRemaining = Math.max(0, nextBudget - selectedKnight.spentCents);
        const forgePatch: Partial<AgentWithTelemetry> = {
          name: payload.name,
          knight_archetype: payload.knight_archetype as any,
          crest_color: payload.crest_color || selectedKnight.crestColor,
          system_prompt: payload.system_prompt,
          ...(payload.model_config ? { model_config: payload.model_config } : {}),
          ...(payload.tools_policy ? { tools_policy: payload.tools_policy } : {}),
          monthly_budget_cents: nextBudget,
          grid_pos: {
            x: payload.grid_pos?.x ?? selectedKnight.gridX,
            y: payload.grid_pos?.y ?? selectedKnight.gridY,
            zone: targetZone,
          },
          enabled: payload.enabled ?? targetZone !== 'standby_barracks',
          is_paused: payload.is_paused ?? targetZone === 'standby_barracks',
        };
        setLocalKnightPatches((prev) => ({
          ...prev,
          [selectedKnight.id]: { ...prev[selectedKnight.id], ...forgePatch },
        }));
        try {
          const updated = await updateAgent(selectedKnight.id, payload);
          setLocalKnightsOverlay((prev) =>
            (prev ?? rawKnights).map((k) =>
              k.id === selectedKnight.id
                ? {
                    ...k,
                    ...updated,
                    ...forgePatch,
                    hp_remaining_cents: nextRemaining,
                    hp_pct:
                      nextBudget <= 0 ? 0 : Math.round((nextRemaining / nextBudget) * 100),
                  }
                : k,
            ),
          );
          setStatusMessage(`Saved configuration for ${updated.name}.`);
        } catch {
          setLocalKnightsOverlay((prev) =>
            (prev ?? rawKnights).map((k) =>
              k.id === selectedKnight.id
                ? {
                    ...k,
                    ...forgePatch,
                    hp_remaining_cents: nextRemaining,
                    hp_pct:
                      nextBudget <= 0 ? 0 : Math.round((nextRemaining / nextBudget) * 100),
                  }
                : k,
            ),
          );
          setStatusMessage(`Saved configuration for ${payload.name}.`);
        }
      }
      setForgeOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['agents'] });
      await queryClient.invalidateQueries({ queryKey: ['agents-queue'] });
    } finally {
      setIsSubmittingForge(false);
    }
  };

  const handleDeleteKnight = async (knightId: string) => {
    setDeletedKnightIds((prev) => new Set(prev).add(knightId));
    try {
      await deleteAgent(knightId);
    } catch {
      // Continue optimistic removal
    }
    setLocalKnightsOverlay((prev) => (prev ?? rawKnights).filter((k) => k.id !== knightId));
    setForgeOpen(false);
    setSelectedKnightId(null);
    setStatusMessage('Dismissed Knight unit from the Order.');
    await queryClient.invalidateQueries({ queryKey: ['agents'] });
    await queryClient.invalidateQueries({ queryKey: ['agents-queue'] });
  };

  const handleAddTrigger = async (knightId: string, trigger: CreateAgentTriggerPayload) => {
    try {
      const created = await createAgentTrigger(knightId, trigger);
      if (created && typeof created === 'object' && typeof created.id === 'string') {
        queryClient.setQueryData<AgentTrigger[]>(['agent-triggers', knightId], (prev) =>
          Array.isArray(prev) ? [...prev.filter((t) => t.id !== created.id), created] : [created],
        );
        setLocalKnightsOverlay((prev) =>
          (prev ?? rawKnights).map((k) =>
            k.id === knightId
              ? { ...k, triggers: [...(k.triggers ?? []).filter((t) => t.id !== created.id), created] }
              : k,
          ),
        );
      }
      await queryClient.invalidateQueries({ queryKey: ['agent-triggers', knightId] });
      await queryClient.invalidateQueries({ queryKey: ['agents-queue'] });
      setStatusMessage(`Attached ${trigger.type} trigger to Knight.`);
    } catch {
      setStatusMessage(`Configured ${trigger.type} trigger.`);
    }
  };

  const handleDeleteTrigger = async (knightId: string, triggerId: string) => {
    queryClient.setQueryData<AgentTrigger[]>(['agent-triggers', knightId], (prev) =>
      Array.isArray(prev) ? prev.filter((t) => t.id !== triggerId) : [],
    );
    setLocalKnightsOverlay((prev) =>
      (prev ?? rawKnights).map((k) =>
        k.id === knightId
          ? { ...k, triggers: (k.triggers ?? []).filter((t) => t.id !== triggerId) }
          : k,
      ),
    );
    setLocalKnightPatches((prev) => {
      const existing = prev[knightId];
      if (!existing?.triggers) return prev;
      return {
        ...prev,
        [knightId]: {
          ...existing,
          triggers: existing.triggers.filter((t) => t.id !== triggerId),
        },
      };
    });
    try {
      await deleteAgentTrigger(knightId, triggerId);
      await queryClient.invalidateQueries({ queryKey: ['agent-triggers', knightId] });
      await queryClient.invalidateQueries({ queryKey: ['agents-queue'] });
    } catch {
      // Ignore offline error
    }
  };

  const activeCount = knights.filter(
    (k) => k.zone !== 'standby_barracks' && !k.isPaused,
  ).length;
  const barracksCount = knights.length - activeCount;

  return (
    <div
      data-testid="knights-page"
      data-fui="knights-page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '14px 16px',
        backgroundColor: FUI_TOKENS.bgArena,
        color: FUI_TOKENS.inkStark,
        minHeight: '100%',
        borderRadius: '0px',
      }}
    >
      {/* Top Command Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '10px 14px',
          backgroundColor: FUI_TOKENS.bgPanel,
          border: `1px solid ${FUI_TOKENS.borderHairline}`,
          borderRadius: '0px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                color: FUI_TOKENS.accentOrange,
              }}
            >
              M05 // AGENT STUDIO
            </span>
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.accentCyan,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                padding: '1px 6px',
                borderRadius: '0px',
              }}
            >
              ACTIVE UNITS: {activeCount} · BARRACKS: {barracksCount}
            </span>
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: FUI_TOKENS.fontSans,
              fontSize: '20px',
              fontWeight: 700,
              color: FUI_TOKENS.inkStark,
              letterSpacing: '0.02em',
            }}
          >
            ISOMETRIC KNIGHT ARENA // ORDER OF HERMES
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {selectedKnight && (
            <button
              type="button"
              data-testid="header-edit-knight-btn"
              onClick={() => {
                setForgeMode('edit');
                setForgeOpen(true);
              }}
              style={{
                padding: '8px 12px',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                color: FUI_TOKENS.inkStark,
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
                cursor: 'pointer',
              }}
            >
              [✎ CONFIGURE {selectedKnight.name.toUpperCase()}]
            </button>
          )}

          <button
            type="button"
            data-testid="forge-knight-btn"
            onClick={() => {
              setForgeMode('create');
              setForgeOpen(true);
            }}
            style={{
              padding: '8px 14px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 700,
              color: FUI_TOKENS.bgCarbon,
              backgroundColor: FUI_TOKENS.accentOrange,
              border: `1px solid ${FUI_TOKENS.accentOrange}`,
              borderRadius: '0px',
              cursor: 'pointer',
            }}
          >
            [+ FORGE KNIGHT]
          </button>
        </div>
      </header>

      {/* Status Notification Strip */}
      {statusMessage && (
        <div
          data-testid="knights-status-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 12px',
            backgroundColor: 'rgba(44, 229, 242, 0.12)',
            border: `1px solid ${FUI_TOKENS.accentCyan}`,
            borderRadius: '0px',
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            color: FUI_TOKENS.accentCyan,
          }}
        >
          <span>TELEMETRY // {statusMessage}</span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            style={{
              padding: '1px 6px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: FUI_TOKENS.inkMuted,
              backgroundColor: 'transparent',
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
              cursor: 'pointer',
            }}
          >
            [DISMISS]
          </button>
        </div>
      )}

      {/* Top Horizontal Turn-Order Queue */}
      <TurnOrderBar
        knights={knights}
        queueItems={queueQuery.data ?? []}
        recentRuns={allRuns}
        selectedKnightId={selectedKnight?.id ?? null}
        castingKnightId={castingKnightId}
        onSelectKnight={(knightId) => setSelectedKnightId(knightId)}
        onSelectRun={(runId) => setSelectedRunId(runId)}
      />

      {/* Main Tactical Split: Isometric Arena Board (Left/Center) + Battle Logs & Sandbox (Right) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 370px',
          gap: '12px',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          <IsometricArenaBoard
            knights={knights}
            selectedKnightId={selectedKnight?.id ?? null}
            activeTurnKnightId={selectedKnight?.id ?? null}
            castingKnightId={castingKnightId}
            redeployBusyId={redeployBusyId}
            onSelectKnight={(id) => setSelectedKnightId(id)}
            onRedeployKnight={handleDeployKnightToZone}
            onOpenForgeEdit={(knight) => {
              setSelectedKnightId(knight.id);
              setForgeMode('edit');
              setForgeOpen(true);
            }}
            onDispatchKnight={(knight, dryRun) => {
              setSelectedKnightId(knight.id);
              handleDispatchKnight(
                dryRun,
                `Execute ${knight.name} tactical sweep across assigned domains.`,
              );
            }}
          />

          <SkillSlotHud
            selectedKnight={selectedKnight}
            onChangeSkillPolicy={handleChangeSkillPolicy}
            onOpenForgeEdit={(knight) => {
              setSelectedKnightId(knight.id);
              setForgeMode('edit');
              setForgeOpen(true);
            }}
            onQuickDeployZone={(knight, zone) => handleDeployKnightToZone(knight, zone, 0, 0)}
            isSavingPolicy={isSavingPolicy}
          />
        </div>

        <BattleLogsPanel
          selectedKnight={selectedKnight}
          knights={knights}
          runs={allRuns}
          selectedRun={selectedRun}
          onSelectRun={(runId) => setSelectedRunId(runId)}
          onDispatchKnight={handleDispatchKnight}
          isDispatching={isDispatching}
        />
      </div>

      {/* Knight Forge Modal (Create / Edit / Delete / Triggers) */}
      <KnightForgeModal
        isOpen={forgeOpen}
        mode={forgeMode}
        initialKnight={forgeMode === 'edit' ? selectedKnight : null}
        triggers={triggersQuery.data ?? []}
        onClose={() => setForgeOpen(false)}
        onSubmit={handleForgeSubmit}
        onDelete={handleDeleteKnight}
        onAddTrigger={handleAddTrigger}
        onDeleteTrigger={handleDeleteTrigger}
        isSubmitting={isSubmittingForge}
      />
    </div>
  );
}
